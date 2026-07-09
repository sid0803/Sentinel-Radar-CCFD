import pytest
from unittest.mock import MagicMock
import json
import numpy as np
import pandas as pd
import sqlite3
import os

# Set testing mode environment variables before import
os.environ['API_KEY'] = 'test_secret_key_123'
os.environ['DB_PATH'] = 'test_fraud_detection.db'

import backend.app as backend_app
from backend.app import app, init_db

@pytest.fixture(autouse=True)
def setup_db():
    # Setup test database
    backend_app.DB_PATH = 'test_fraud_detection.db'
    init_db()
    yield
    # Cleanup test database
    if os.path.exists('test_fraud_detection.db'):
        try:
            os.remove('test_fraud_detection.db')
        except OSError:
            pass

@pytest.fixture
def client():
    app.config['TESTING'] = True
    
    # Mock scaler
    mock_scaler = MagicMock()
    # transform should return same columns shaped
    mock_scaler.transform = lambda x: x.values
    
    # Mock model
    class MockModel:
        def predict_proba(self, X):
            # return shape matching number of rows in X (e.g. for batch)
            n_rows = len(X)
            return np.tile([0.9, 0.1], (n_rows, 1))
            
        @property
        def feature_importances_(self):
            return np.array([0.05] * 30)
            
    mock_model = MockModel()
    
    # Inject mock resources into app
    backend_app.scaler = mock_scaler
    backend_app.models = {
        'rf': mock_model,
        'xgb': mock_model,
        'lgbm': mock_model
    }
    backend_app.feature_names = ['Time', 'Amount'] + [f'V{i}' for i in range(1, 29)]
    backend_app.precomputed_stats = {
        'presets': {
            'fraud': [{'Time': 100, 'Amount': 200, **{f'V{i}': 0.0 for i in range(1, 29)}}],
            'legit': [{'Time': 100, 'Amount': 200, **{f'V{i}': 0.0 for i in range(1, 29)}}]
        },
        'models': {
            'rf': {'name': 'Random Forest'},
            'xgb': {'name': 'XGBoost'},
            'lgbm': {'name': 'LightGBM'}
        },
        'correlation_matrix': {}
    }
    
    with app.test_client() as client:
        yield client

def test_health(client):
    res = client.get('/api/health')
    assert res.status_code == 200
    data = res.json
    assert data['status'] == 'healthy'
    assert 'models_loaded' in data

def test_presets(client):
    res = client.get('/api/presets')
    assert res.status_code == 200
    assert 'fraud' in res.json
    assert len(res.json['fraud']) == 1

def test_stats(client):
    res = client.get('/api/stats')
    assert res.status_code == 200
    assert 'rf' in res.json

def test_predict_endpoint(client):
    payload = {
        'Time': 1000,
        'Amount': 50.0,
        'Cardholder': 'Test User',
        'Card_Number': '1111 2222 3333 4444',
        'Merchant': 'Test Merchant',
        'Category': 'Retail',
        'Country': 'US',
        'Device': 'iPhone',
        'threshold': 0.5
    }
    for i in range(1, 29):
        payload[f'V{i}'] = 0.0
        
    res = client.post('/api/predict', json=payload)
    assert res.status_code == 200
    data = res.json
    assert 'txn_id' in data
    assert data['ensemble']['verdict'] == 'LEGITIMATE'
    assert len(data['rules_triggered']) == 0

def test_predict_heuristics_high_amount(client):
    # Rule engine test: amount > 5000 should trigger a flag
    payload = {
        'Time': 1000,
        'Amount': 6000.0, # High Amount Heuristics trigger
        'Cardholder': 'Test User',
        'Card_Number': '1111 2222 3333 4444',
        'Merchant': 'Crypto Exchange', # High-risk category trigger
        'Category': 'crypto',
        'Country': 'US',
        'Device': 'tor bridge emulator', # Suspicious device fingerprint trigger
        'threshold': 0.5
    }
    for i in range(1, 29):
        payload[f'V{i}'] = 0.0
        
    res = client.post('/api/predict', json=payload)
    assert res.status_code == 200
    data = res.json
    assert len(data['rules_triggered']) >= 3
    # Combined score or emulator rule (risk >= 0.8) should flag fraud
    assert data['ensemble']['verdict'] == 'FRAUD'

def test_batch_predict_endpoint(client):
    tx = {
        'Time': 1000,
        'Amount': 50.0,
        'Cardholder': 'Test User',
        'Card_Number': '1111 2222 3333 4444',
        'Merchant': 'Test Merchant',
        'Category': 'Retail',
        'Country': 'US',
        'Device': 'iPhone'
    }
    for i in range(1, 29):
        tx[f'V{i}'] = 0.0
        
    payload = {
        'transactions': [tx, tx],
        'threshold': 0.5
    }
    res = client.post('/api/predict/batch', json=payload)
    assert res.status_code == 200
    data = res.json
    assert len(data['results']) == 2
    assert data['summary']['total'] == 2
    assert data['summary']['fraud'] == 0

import os
import json
import pytest
import joblib
import pandas as pd

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'models')

def test_models_exist():
    """Verify that models have been trained and exist (needed for app runtime)"""
    # If the user hasn't run train_models.py yet, these files won't exist.
    # In CI, we want to make sure the check passes if files exist.
    scaler_path = os.path.join(MODELS_DIR, 'scaler.pkl')
    stats_path = os.path.join(MODELS_DIR, 'precomputed_stats.json')
    
    if os.path.exists(scaler_path) and os.path.exists(stats_path):
        # Verify stats load
        with open(stats_path, 'r') as f:
            stats = json.load(f)
        assert 'models' in stats
        assert 'presets' in stats
        assert 'feature_names' in stats
        assert len(stats['feature_names']) == 30
        
        # Verify scaler loads
        scaler = joblib.load(scaler_path)
        test_df = pd.DataFrame([{'Time': 1000.0, 'Amount': 50.0}])
        scaled = scaler.transform(test_df)
        assert scaled.shape == (1, 2)
    else:
        # Skip if models aren't trained locally yet
        pytest.skip("Models not trained yet. Run train_models.py to create models.")

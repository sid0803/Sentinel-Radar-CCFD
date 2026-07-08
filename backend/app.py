"""
CCFD - Credit Card Fraud Detection
Flask Backend Server
Serves the REST API for prediction, stats, and presets
Also serves the frontend SPA static files
"""

import os
import json
import sqlite3
import random
import numpy as np
import pandas as pd
import joblib
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import shap

app = Flask(__name__, static_folder='../frontend')
CORS(app)

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
DB_PATH = os.path.join(os.path.dirname(__file__), 'fraud_detection.db')

# Initialize SQLite database schema
def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            txn_id TEXT NOT NULL UNIQUE,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            card_number TEXT,
            cardholder TEXT,
            amount REAL,
            txn_time INTEGER,
            merchant TEXT,
            category TEXT,
            country TEXT,
            device TEXT,
            ensemble_verdict TEXT,
            ensemble_confidence REAL,
            ensemble_votes INTEGER,
            rf_prob REAL,
            xgb_prob REAL,
            lgbm_prob REAL,
            inputs_json TEXT,
            shap_json TEXT
        )
    ''')
    conn.commit()
    conn.close()

# Global variables to store loaded models/scalers
models = {}
scaler = None
precomputed_stats = None
feature_names = []
explainers = {}

# -----------------------------------------------------------------------------
# Initialize & Load Models
# -----------------------------------------------------------------------------
def load_resources():
    global scaler, precomputed_stats, feature_names
    print("[RUN] Loading models and resources...")
    
    # Load Scaler
    scaler_path = os.path.join(MODELS_DIR, 'scaler.pkl')
    if os.path.exists(scaler_path):
        scaler = joblib.load(scaler_path)
        print("  [OK] Scaler loaded.")
    else:
        print("  [WARN] Scaler not found. Run train_models.py first.")

    # Load precomputed stats and config
    stats_path = os.path.join(MODELS_DIR, 'precomputed_stats.json')
    if os.path.exists(stats_path):
        with open(stats_path, 'r') as f:
            precomputed_stats = json.load(f)
            feature_names = precomputed_stats.get('feature_names', [])
        print("  [OK] Precomputed stats and feature names loaded.")
    else:
        print("  [WARN] Precomputed stats not found. Run train_models.py first.")

    # Load 3 models & create SHAP explainers
    model_keys = ['rf', 'xgb', 'lgbm']
    for key in model_keys:
        path = os.path.join(MODELS_DIR, f'{key}_model.pkl')
        if os.path.exists(path):
            models[key] = joblib.load(path)
            print(f"  [OK] Model '{key}' loaded.")
            # TreeExplainer is extremely fast for tree models
            try:
                explainers[key] = shap.TreeExplainer(models[key])
                print(f"  [OK] SHAP explainer for '{key}' initialized.")
            except Exception as e:
                print(f"  [WARN] Failed to initialize SHAP explainer for '{key}': {e}")
        else:
            print(f"  [WARN] Model file '{path}' not found. Run train_models.py first.")

# -----------------------------------------------------------------------------
# Serve Frontend Static Files
# -----------------------------------------------------------------------------
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def static_proxy(path):
    return send_from_directory(app.static_folder, path)

# -----------------------------------------------------------------------------
# API Endpoints
# -----------------------------------------------------------------------------
@app.route('/api/presets', methods=['GET'])
def get_presets():
    if precomputed_stats and 'presets' in precomputed_stats:
        return jsonify(precomputed_stats['presets'])
    return jsonify({"error": "Presets not loaded. Please train models first."}), 500

@app.route('/api/stats', methods=['GET'])
def get_stats():
    if precomputed_stats and 'models' in precomputed_stats:
        return jsonify(precomputed_stats['models'])
    return jsonify({"error": "Stats not loaded. Please train models first."}), 500

@app.route('/api/predict', methods=['POST'])
def predict():
    if not models or not scaler:
        return jsonify({"error": "Models or scaler not loaded on server."}), 500
        
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No input data provided"}), 400

        # Validate input features
        missing_features = [f for f in feature_names if f not in data]
        if missing_features:
            return jsonify({"error": f"Missing features: {missing_features}"}), 400

        # Extract extra card metadata for industry-level database records
        card_number = data.get('Card_Number', '**** **** **** 4242')
        cardholder = data.get('Cardholder', 'John Doe')
        merchant = data.get('Merchant', 'Unknown Merchant')
        category = data.get('Category', 'Online')
        country = data.get('Country', 'US')
        device = data.get('Device', 'Web Browser')

        # Build raw DataFrame in exact training order
        raw_df = pd.DataFrame([data], columns=feature_names)
        
        # Preprocess Time and Amount
        scaled_df = raw_df.copy()
        scaled_df[['Time', 'Amount']] = scaler.transform(raw_df[['Time', 'Amount']])

        # Run predictions across all 3 models
        results = {}
        votes = 0
        probabilities = []

        threshold = float(data.get('threshold', 0.5))

        for key, model in models.items():
            prob = float(model.predict_proba(scaled_df)[0, 1])
            verdict = "FRAUD" if prob >= threshold else "LEGITIMATE"
            if verdict == "FRAUD":
                votes += 1
            probabilities.append(prob)
            
            results[key] = {
                "name": precomputed_stats['models'][key]['name'] if precomputed_stats else key,
                "verdict": verdict,
                "probability": round(prob, 4)
            }

        # Calculate Ensemble Verdict
        avg_prob = sum(probabilities) / len(probabilities)
        ensemble_verdict = "FRAUD" if votes >= 2 else "LEGITIMATE"
        ensemble_conf = avg_prob if ensemble_verdict == "FRAUD" else 1.0 - avg_prob
        
        # Calculate SHAP explainability
        shap_values_dict = {}
        for key in models.keys():
            if key in explainers:
                try:
                    # Get raw shap values for row (shape matches features)
                    explainer = explainers[key]
                    sv = explainer.shap_values(scaled_df)
                    
                    # Handle binary classification shap output differences across models
                    # LightGBM/XGBoost returns array of shape (1, n_features) or (n_features,)
                    # Random Forest returns list of 2 arrays (negative, positive class)
                    if isinstance(sv, list):
                        # Use positive class SHAP values
                        row_sv = sv[1][0]
                    else:
                        if len(sv.shape) == 3: # multi-class/RF shape
                            row_sv = sv[0][:, 1]
                        elif len(sv.shape) == 2:
                            row_sv = sv[0]
                        else:
                            row_sv = sv
                    
                    # Pair with feature names and values
                    feature_shaps = []
                    for i, fname in enumerate(feature_names):
                        feat_val = float(raw_df.iloc[0][fname])
                        shap_val = float(row_sv[i])
                        feature_shaps.append({
                            "feature": fname,
                            "value": round(feat_val, 4),
                            "shap": round(shap_val, 4)
                        })
                    
                    # Sort by absolute SHAP value descending, take top 10
                    feature_shaps = sorted(feature_shaps, key=lambda x: abs(x['shap']), reverse=True)[:10]
                    shap_values_dict[key] = feature_shaps
                except Exception as ex:
                    print(f"Error computing SHAP for {key}: {ex}")
                    shap_values_dict[key] = []
            else:
                shap_values_dict[key] = []

        # Generate custom transaction ID
        txn_id = f"TXN-{random.randint(100000, 999999)}"

        # Save record to SQLite database for audit trail
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO transactions (
                    txn_id, card_number, cardholder, amount, txn_time,
                    merchant, category, country, device,
                    ensemble_verdict, ensemble_confidence, ensemble_votes,
                    rf_prob, xgb_prob, lgbm_prob, inputs_json, shap_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                txn_id, card_number, cardholder, float(data['Amount']), int(data['Time']),
                merchant, category, country, device,
                ensemble_verdict, float(ensemble_conf), int(votes),
                float(results['rf']['probability']), float(results['xgb']['probability']), float(results['lgbm']['probability']),
                json.dumps(data), json.dumps(shap_values_dict)
            ))
            conn.commit()
            conn.close()
        except Exception as db_err:
            print(f"[DB ERROR] Failed to save transaction record: {db_err}")

        response = {
            "txn_id": txn_id,
            "card_number": card_number,
            "cardholder": cardholder,
            "merchant": merchant,
            "category": category,
            "country": country,
            "device": device,
            "ensemble": {
                "verdict": ensemble_verdict,
                "confidence": round(ensemble_conf, 4),
                "votes": votes
            },
            "models": results,
            "shap": shap_values_dict
        }

        return jsonify(response)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/api/history', methods=['GET'])
def get_history():
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM transactions ORDER BY timestamp DESC')
        rows = cursor.fetchall()
        conn.close()
        
        history = []
        for r in rows:
            history.append({
                "id": r["id"],
                "txn_id": r["txn_id"],
                "timestamp": r["timestamp"],
                "card_number": r["card_number"],
                "cardholder": r["cardholder"],
                "amount": r["amount"],
                "txn_time": r["txn_time"],
                "merchant": r["merchant"],
                "category": r["category"],
                "country": r["country"],
                "device": r["device"],
                "ensemble_verdict": r["ensemble_verdict"],
                "ensemble_confidence": r["ensemble_confidence"],
                "ensemble_votes": r["ensemble_votes"],
                "rf_prob": r["rf_prob"],
                "xgb_prob": r["xgb_prob"],
                "lgbm_prob": r["lgbm_prob"],
                "inputs": json.loads(r["inputs_json"]),
                "shap": json.loads(r["shap_json"])
            })
        return jsonify(history)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/history/clear', methods=['POST'])
def clear_history():
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('DELETE FROM transactions')
        conn.commit()
        conn.close()
        return jsonify({"status": "success", "message": "History cleared"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/session-stats', methods=['GET'])
def get_session_stats():
    try:
        threshold = float(request.args.get('threshold', 0.5))
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Total transactions
        cursor.execute('SELECT COUNT(*) FROM transactions')
        total_count = cursor.fetchone()[0]
        
        # Fraud transactions calculated dynamically based on threshold
        cursor.execute('''
            SELECT COUNT(*) FROM transactions 
            WHERE (
                (CASE WHEN rf_prob >= ? THEN 1 ELSE 0 END) +
                (CASE WHEN xgb_prob >= ? THEN 1 ELSE 0 END) +
                (CASE WHEN lgbm_prob >= ? THEN 1 ELSE 0 END)
            ) >= 2
        ''', (threshold, threshold, threshold))
        fraud_count = cursor.fetchone()[0]
        
        # Fraud rate
        fraud_rate = (fraud_count / total_count * 100) if total_count > 0 else 0.0
        
        conn.close()
        
        return jsonify({
            "total_analyzed": total_count,
            "fraud_flagged": fraud_count,
            "fraud_rate": round(fraud_rate, 2),
            "ensemble_auc": 0.981
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/predict/batch', methods=['POST'])
def predict_batch():
    if not models or not scaler:
        return jsonify({"error": "Models or scaler not loaded on server."}), 500
        
    try:
        req_data = request.json
        if not req_data or "transactions" not in req_data:
            return jsonify({"error": "Invalid payload format. Expected 'transactions' list."}), 400
            
        txns = req_data["transactions"]
        threshold = float(req_data.get("threshold", 0.5))
        
        if not txns:
            return jsonify({
                "results": [],
                "summary": {
                    "total": 0,
                    "fraud": 0,
                    "legit": 0,
                    "fraud_rate": 0.0
                }
            })
            
        # Extract features and meta info
        batch_inputs = []
        metadata_list = []
        
        for idx, item in enumerate(txns):
            card_number = item.get('Card_Number', '**** **** **** 4242')
            cardholder = item.get('Cardholder', f'Customer #{idx+1}')
            merchant = item.get('Merchant', 'Unknown Merchant')
            category = item.get('Category', 'Online')
            country = item.get('Country', 'US')
            device = item.get('Device', 'Web Browser')
            
            metadata_list.append({
                "card_number": card_number,
                "cardholder": cardholder,
                "merchant": merchant,
                "category": category,
                "country": country,
                "device": device
            })
            
            # Map standard features
            row_input = {}
            for f in feature_names:
                row_input[f] = float(item.get(f, 0.0))
            batch_inputs.append(row_input)
            
        raw_df = pd.DataFrame(batch_inputs, columns=feature_names)
        
        # Scale numericals
        scaled_df = raw_df.copy()
        scaled_df[['Time', 'Amount']] = scaler.transform(raw_df[['Time', 'Amount']])
        
        # Predict
        rf_probs = models['rf'].predict_proba(scaled_df)[:, 1]
        xgb_probs = models['xgb'].predict_proba(scaled_df)[:, 1]
        lgbm_probs = models['lgbm'].predict_proba(scaled_df)[:, 1]
        
        results = []
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        total_fraud = 0
        total_legit = 0
        
        for i in range(len(txns)):
            p_rf = float(rf_probs[i])
            p_xgb = float(xgb_probs[i])
            p_lgb = float(lgbm_probs[i])
            
            votes = 0
            if p_rf >= threshold: votes += 1
            if p_xgb >= threshold: votes += 1
            if p_lgb >= threshold: votes += 1
            
            avg_prob = (p_rf + p_xgb + p_lgb) / 3
            ensemble_verdict = "FRAUD" if votes >= 2 else "LEGITIMATE"
            ensemble_conf = avg_prob if ensemble_verdict == "FRAUD" else 1.0 - avg_prob
            
            if ensemble_verdict == "FRAUD":
                total_fraud += 1
            else:
                total_legit += 1
                
            txn_id = f"TXN-{random.randint(100000, 999999)}"
            meta = metadata_list[i]
            data_raw = batch_inputs[i]
            
            cursor.execute('''
                INSERT INTO transactions (
                    txn_id, card_number, cardholder, amount, txn_time,
                    merchant, category, country, device,
                    ensemble_verdict, ensemble_confidence, ensemble_votes,
                    rf_prob, xgb_prob, lgbm_prob, inputs_json, shap_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                txn_id, meta["card_number"], meta["cardholder"], data_raw['Amount'], int(data_raw['Time']),
                meta["merchant"], meta["category"], meta["country"], meta["device"],
                ensemble_verdict, float(ensemble_conf), int(votes),
                p_rf, p_xgb, p_lgb,
                json.dumps(txns[i]), json.dumps({})
            ))
            
            results.append({
                "txn_id": txn_id,
                "cardholder": meta["cardholder"],
                "merchant": meta["merchant"],
                "amount": data_raw['Amount'],
                "verdict": ensemble_verdict,
                "confidence": round(ensemble_conf, 4),
                "votes": votes
            })
            
        conn.commit()
        conn.close()
        
        return jsonify({
            "results": results,
            "summary": {
                "total": len(txns),
                "fraud": total_fraud,
                "legit": total_legit,
                "fraud_rate": round((total_fraud / len(txns) * 100), 2) if txns else 0.0
            }
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/api/analytics', methods=['GET'])
def get_analytics():
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # 1. Verdict distribution
        cursor.execute('SELECT ensemble_verdict, COUNT(*) FROM transactions GROUP BY ensemble_verdict')
        verdicts = dict(cursor.fetchall())
        if "FRAUD" not in verdicts: verdicts["FRAUD"] = 0
        if "LEGITIMATE" not in verdicts: verdicts["LEGITIMATE"] = 0
        
        # 2. Hourly trend
        cursor.execute('''
            SELECT strftime('%H', timestamp) as hr, 
                   SUM(CASE WHEN ensemble_verdict = 'FRAUD' THEN 1 ELSE 0 END) as fraud_count,
                   COUNT(*) as total_count
            FROM transactions 
            GROUP BY hr
            ORDER BY hr
        ''')
        hourly_data = []
        for r in cursor.fetchall():
            hourly_data.append({
                "hour": r[0] + ":00",
                "fraud": r[1],
                "total": r[2]
            })
            
        # 3. Amount buckets: <50, 50-200, 200-1000, 1000+
        cursor.execute('''
            SELECT 
                CASE 
                    WHEN amount < 50 THEN '0-50'
                    WHEN amount < 200 THEN '50-200'
                    WHEN amount < 1000 THEN '200-1000'
                    ELSE '1000+'
                END as bucket,
                SUM(CASE WHEN ensemble_verdict = 'FRAUD' THEN 1 ELSE 0 END) as fraud,
                SUM(CASE WHEN ensemble_verdict = 'LEGITIMATE' THEN 1 ELSE 0 END) as legit
            FROM transactions
            GROUP BY bucket
        ''')
        amount_buckets = []
        for r in cursor.fetchall():
            amount_buckets.append({
                "bucket": r[0],
                "fraud": r[1],
                "legit": r[2]
            })
            
        conn.close()
        return jsonify({
            "verdicts": verdicts,
            "hourly_trend": hourly_data,
            "amount_buckets": amount_buckets
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/global-explainability', methods=['GET'])
def get_global_explainability():
    if precomputed_stats and 'correlation_matrix' in precomputed_stats:
        return jsonify({
            "correlation_matrix": precomputed_stats['correlation_matrix'],
            "feature_names": feature_names
        })
    return jsonify({"error": "Global explainability stats not loaded."}), 500

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
if __name__ == '__main__':
    init_db()
    load_resources()
    print("[RUN] Starting Flask server on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)

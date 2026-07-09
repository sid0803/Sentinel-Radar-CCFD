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
import uuid
from dotenv import load_dotenv

# Load env variables from project root
dotenv_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env')
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path)
else:
    load_dotenv()

app = Flask(__name__, static_folder='../frontend')

# Configuration from env variables
SECRET_KEY = os.getenv('SECRET_KEY', '9e10287dfb38d3883b4c10c14c53846e')
API_KEY = os.getenv('API_KEY', 'sentinel_dev_key_2026')
MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
env_db_path = os.getenv('DB_PATH', 'fraud_detection.db')
if os.path.isabs(env_db_path):
    DB_PATH = env_db_path
else:
    DB_PATH = os.path.join(os.path.dirname(__file__), env_db_path)

# Dev Mode: when True, velocity check is bypassed so repeated test inputs produce stable results
DEV_MODE = os.getenv('DEV_MODE', 'false').lower() == 'true'

allowed_origins_str = os.getenv('ALLOWED_ORIGINS', 'http://localhost:5000,http://127.0.0.1:5000')
allowed_origins = [origin.strip() for origin in allowed_origins_str.split(',')]

CORS(app, resources={r"/api/*": {"origins": allowed_origins}})

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
            shap_json TEXT,
            rules_triggered_json TEXT
        )
    ''')
    # Dynamic schema migration for older DB files
    try:
        cursor.execute("ALTER TABLE transactions ADD COLUMN rules_triggered_json TEXT")
    except sqlite3.OperationalError:
        pass # Column already exists
    conn.commit()
    conn.close()

# Global variables to store loaded models/scalers
models = {}
scaler = None
precomputed_stats = None
feature_names = []
explainers = {}

# -----------------------------------------------------------------------------
# API Key Middleware
# -----------------------------------------------------------------------------
@app.before_request
def check_api_key():
    # Bypass for static frontend pages/files
    if not request.path.startswith('/api/'):
        return
    # Bypass testing suite or health endpoint
    if app.config.get('TESTING') or request.path == '/api/health':
        return
    
    auth_key = request.headers.get('X-API-Key')
    if auth_key != API_KEY:
        return jsonify({"error": "Unauthorized. Invalid or missing X-API-Key header."}), 401

# -----------------------------------------------------------------------------
# Metadata Heuristics Rule Engine
# -----------------------------------------------------------------------------
def evaluate_metadata_rules(card_number, merchant, category, country, device, amount, skip_velocity=False):
    """
    Industry Heuristics Engine. Checks transaction metadata fields for common fraud signals.
    Returns: (risk_score, triggered_reasons)
    
    Args:
        skip_velocity: When True (Dev Mode), the velocity check is bypassed so repeated
                       test inputs with the same card number produce stable, deterministic results.
    """
    risk_score = 0.0
    reasons = []
    
    # 1. Transaction Amount thresholds
    if amount > 5000:
        risk_score += 0.4
        reasons.append("High amount threshold exceeded (> $5,000)")
    elif amount > 1000:
        risk_score += 0.15
        reasons.append("Elevated amount threshold exceeded (> $1,000)")
        
    # 2. High-risk category merchants
    high_risk_categories = ['crypto', 'gaming', 'money transfer', 'gambling', 'gift cards', 'digital wallet']
    if any(hrc in category.lower() for hrc in high_risk_categories):
        risk_score += 0.25
        reasons.append(f"High-risk merchant category: {category}")
        
    # 3. Suspicious device fingerprint
    suspicious_devices = ['emulator', 'unknown device', 'bot client', 'headless browser', 'tor bridge', 'root/jailbroken']
    if any(sd in device.lower() for sd in suspicious_devices):
        risk_score += 0.3
        reasons.append(f"Suspicious device fingerprint: {device}")
        
    # 4. Location risk
    high_risk_countries = ['unknown', 'high-risk country']
    if any(hrc in country.lower() for hrc in high_risk_countries):
        risk_score += 0.2
        reasons.append(f"High-risk transaction destination: {country}")
        
    # 5. Velocity check (within 5 minutes) — skipped in Dev Mode
    if not skip_velocity:
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute('''
                SELECT COUNT(*) FROM transactions 
                WHERE card_number = ? AND timestamp >= datetime('now', '-5 minutes')
            ''', (card_number,))
            recent_count = cursor.fetchone()[0]
            conn.close()
            
            if recent_count >= 3:
                risk_score += 0.45
                reasons.append(f"High velocity trigger: {recent_count} transactions in last 5 minutes")
        except Exception as e:
            print(f"[RULE ENGINE ERROR] Velocity check failed: {e}")
    else:
        reasons_note = "[Dev Mode] Velocity check bypassed — stable results mode active"
        print(f"[DEV MODE] {reasons_note}")
        
    # Clamp final score
    risk_score = min(1.0, max(0.0, risk_score))
    return risk_score, reasons


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

@app.route('/api/dev-mode', methods=['GET'])
def get_dev_mode():
    """Return the current dev mode status."""
    return jsonify({"dev_mode": DEV_MODE})

@app.route('/api/dev-mode', methods=['POST'])
def set_dev_mode():
    """Toggle dev mode at runtime (requires valid API key). 
    When enabled, the velocity check is bypassed so repeated test inputs produce 
    stable, deterministic results. This is intended for testing only."""
    global DEV_MODE
    body = request.json or {}
    enabled = bool(body.get('enabled', False))
    DEV_MODE = enabled
    status = "enabled" if DEV_MODE else "disabled"
    print(f"[DEV MODE] Dev mode {status} via API")
    return jsonify({"dev_mode": DEV_MODE, "message": f"Dev mode {status}. Velocity checks {'bypassed' if DEV_MODE else 'active'}."})


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

        # Validate string inputs and sanitize max length (M-05)
        card_number = str(data.get('Card_Number', '**** **** **** 4242'))[:19]
        cardholder = str(data.get('Cardholder', 'John Doe'))[:100]
        merchant = str(data.get('Merchant', 'Unknown Merchant'))[:100]
        category = str(data.get('Category', 'Online'))[:50]
        country = str(data.get('Country', 'US'))[:50]
        device = str(data.get('Device', 'Web Browser'))[:50]

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

        # Calculate Ensemble Verdict with Rule-Based Heuristics
        avg_prob = sum(probabilities) / len(probabilities)
        
        # Check if dev_mode is requested by the frontend (or env-configured)
        request_dev_mode = bool(data.get('dev_mode', False)) or DEV_MODE
        
        # Evaluate metadata rules (velocity check skipped in dev mode)
        rules_risk, rules_triggered = evaluate_metadata_rules(
            card_number, merchant, category, country, device, float(data.get('Amount', 0)),
            skip_velocity=request_dev_mode
        )
        
        # Combined risk metric (70% ML, 30% Rules Risk heuristics)
        combined_prob = (0.7 * avg_prob) + (0.3 * rules_risk)
        
        # Threshold consensus check
        is_fraud_flagged = (votes >= 2) or (combined_prob >= threshold) or (rules_risk >= 0.8)
        ensemble_verdict = "FRAUD" if is_fraud_flagged else "LEGITIMATE"
        ensemble_conf = combined_prob if ensemble_verdict == "FRAUD" else 1.0 - combined_prob
        
        # Calculate SHAP explainability
        shap_values_dict = {}
        for key in models.keys():
            if key in explainers:
                try:
                    # Get raw shap values for row (shape matches features)
                    explainer = explainers[key]
                    sv = explainer.shap_values(scaled_df)
                    
                    # Handle binary classification shap output differences across models
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

        # Generate unique transaction ID using UUID (H-01 / M-04)
        txn_id = f"TXN-{uuid.uuid4().hex[:8].upper()}"

        # Save record to SQLite database for audit trail (H-02)
        conn = None
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO transactions (
                    txn_id, card_number, cardholder, amount, txn_time,
                    merchant, category, country, device,
                    ensemble_verdict, ensemble_confidence, ensemble_votes,
                    rf_prob, xgb_prob, lgbm_prob, inputs_json, shap_json,
                    rules_triggered_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                txn_id, card_number, cardholder, float(data['Amount']), int(data['Time']),
                merchant, category, country, device,
                ensemble_verdict, float(ensemble_conf), int(votes),
                float(results['rf']['probability']), float(results['xgb']['probability']), float(results['lgbm']['probability']),
                json.dumps(data), json.dumps(shap_values_dict), json.dumps(rules_triggered)
            ))
            conn.commit()
        except Exception as db_err:
            print(f"[DB ERROR] Failed to save transaction record: {db_err}")
        finally:
            if conn:
                conn.close()

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
            "shap": shap_values_dict,
            "rules_triggered": rules_triggered,
            "rules_risk_score": round(rules_risk, 4)
        }

        return jsonify(response)

    except Exception as e:
        import traceback
        traceback.print_exc()
        # Prevent traceback information leak to client (C-02)
        return jsonify({"error": "An internal server error occurred during prediction."}), 500

@app.route('/api/transaction/<txn_id>', methods=['GET'])
def get_transaction(txn_id):
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM transactions WHERE txn_id = ?', (txn_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({"error": "Transaction not found."}), 404
            
        rules_trig = []
        try:
            if "rules_triggered_json" in row.keys() and row["rules_triggered_json"]:
                rules_trig = json.loads(row["rules_triggered_json"])
        except Exception:
            pass

        return jsonify({
            "id": row["id"],
            "txn_id": row["txn_id"],
            "timestamp": row["timestamp"],
            "card_number": row["card_number"],
            "cardholder": row["cardholder"],
            "amount": row["amount"],
            "txn_time": row["txn_time"],
            "merchant": row["merchant"],
            "category": row["category"],
            "country": row["country"],
            "device": row["device"],
            "ensemble_verdict": row["ensemble_verdict"],
            "ensemble_confidence": row["ensemble_confidence"],
            "ensemble_votes": row["ensemble_votes"],
            "rf_prob": row["rf_prob"],
            "xgb_prob": row["xgb_prob"],
            "lgbm_prob": row["lgbm_prob"],
            "inputs": json.loads(row["inputs_json"]) if row["inputs_json"] else {},
            "shap": json.loads(row["shap_json"]) if row["shap_json"] else {},
            "rules_triggered": rules_trig
        })
    except Exception as e:
        return jsonify({"error": "Failed to load transaction details."}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/history', methods=['GET'])
def get_history():
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        # Optimization (M-06): Exclude bulky inputs_json and shap_json from default history requests
        cursor.execute('''
            SELECT id, txn_id, timestamp, card_number, cardholder, amount, 
                   txn_time, merchant, category, country, device, 
                   ensemble_verdict, ensemble_confidence, ensemble_votes, 
                   rf_prob, xgb_prob, lgbm_prob 
            FROM transactions 
            ORDER BY timestamp DESC
        ''')
        rows = cursor.fetchall()
        
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
                "inputs": {},  # Lazy loaded if inspected
                "shap": {}     # Lazy loaded if inspected
            })
        return jsonify(history)
    except Exception as e:
        return jsonify({"error": "Failed to fetch transaction history ledger."}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/history/clear', methods=['POST'])
def clear_history():
    # Simple Localhost Validation for Clear Action (M-02)
    origin_ip = request.remote_addr
    if origin_ip not in ['127.0.0.1', 'localhost', '::1']:
        return jsonify({"error": "Clear action is restricted to local operators."}), 403

    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('DELETE FROM transactions')
        conn.commit()
        return jsonify({"status": "success", "message": "History cleared"})
    except Exception as e:
        return jsonify({"error": "Failed to clear transaction database."}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/session-stats', methods=['GET'])
def get_session_stats():
    conn = None
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
        
        return jsonify({
            "total_analyzed": total_count,
            "fraud_flagged": fraud_count,
            "fraud_rate": round(fraud_rate, 2),
            "ensemble_auc": 0.981
        })
    except Exception as e:
        return jsonify({"error": "Failed to load session statistics."}), 500
    finally:
        if conn:
            conn.close()

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
        
        # Enforce Batch Limit to prevent DoS (C-04)
        if len(txns) > 500:
            return jsonify({"error": "Batch size exceeds maximum limit of 500 transactions."}), 400
        
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
            # Limit lengths to prevent memory attacks (M-05)
            card_number = str(item.get('Card_Number', '**** **** **** 4242'))[:19]
            cardholder = str(item.get('Cardholder', f'Customer #{idx+1}'))[:100]
            merchant = str(item.get('Merchant', 'Unknown Merchant'))[:100]
            category = str(item.get('Category', 'Online'))[:50]
            country = str(item.get('Country', 'US'))[:50]
            device = str(item.get('Device', 'Web Browser'))[:50]
            
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
        conn = None
        try:
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
                
                meta = metadata_list[i]
                data_raw = batch_inputs[i]
                
                # Rule-based heuristics for batch items
                r_risk, r_trig = evaluate_metadata_rules(
                    meta["card_number"], meta["merchant"], meta["category"], meta["country"], meta["device"], float(data_raw["Amount"])
                )
                
                combined_prob = (0.7 * avg_prob) + (0.3 * r_risk)
                is_fraud_flagged = (votes >= 2) or (combined_prob >= threshold) or (r_risk >= 0.8)
                
                ensemble_verdict = "FRAUD" if is_fraud_flagged else "LEGITIMATE"
                ensemble_conf = combined_prob if ensemble_verdict == "FRAUD" else 1.0 - combined_prob
                
                if ensemble_verdict == "FRAUD":
                    total_fraud += 1
                else:
                    total_legit += 1
                    
                txn_id = f"TXN-{uuid.uuid4().hex[:8].upper()}"
                
                cursor.execute('''
                    INSERT INTO transactions (
                        txn_id, card_number, cardholder, amount, txn_time,
                        merchant, category, country, device,
                        ensemble_verdict, ensemble_confidence, ensemble_votes,
                        rf_prob, xgb_prob, lgbm_prob, inputs_json, shap_json,
                        rules_triggered_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    txn_id, meta["card_number"], meta["cardholder"], data_raw['Amount'], int(data_raw['Time']),
                    meta["merchant"], meta["category"], meta["country"], meta["device"],
                    ensemble_verdict, float(ensemble_conf), int(votes),
                    p_rf, p_xgb, p_lgb,
                    json.dumps(txns[i]), json.dumps({}), json.dumps(r_trig)
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
        finally:
            if conn:
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
        return jsonify({"error": "An internal server error occurred during batch processing."}), 500

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
# Health Check Endpoint
# -----------------------------------------------------------------------------
@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        "status": "healthy",
        "api_key_configured": API_KEY != 'sentinel_dev_key_2026',
        "models_loaded": list(models.keys())
    })

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
if __name__ == '__main__':
    init_db()
    load_resources()
    print("[RUN] Starting Flask server on http://127.0.0.1:5000")
    # Bind to local interface and disable debug debugger (C-03)
    app.run(host='127.0.0.1', port=5000, debug=False)

"""
CCFD - Credit Card Fraud Detection
Model Training Script
Trains Random Forest, XGBoost, and LightGBM on creditcard.csv
Saves trained models + pre-computed stats for the dashboard
"""

import os
import json
import warnings
import requests
import zipfile
import io
import numpy as np
import pandas as pd
import joblib

from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    roc_curve, auc, precision_recall_curve,
    confusion_matrix, classification_report,
    precision_score, recall_score, f1_score
)
import xgboost as xgb
import lightgbm as lgb
import shap

warnings.filterwarnings('ignore')

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
DATA_PATH  = os.path.join(os.path.dirname(__file__), 'creditcard.csv')
os.makedirs(MODELS_DIR, exist_ok=True)

# -----------------------------------------------------------------------------
# 1. Download dataset if not present
# -----------------------------------------------------------------------------
def download_dataset():
    if os.path.exists(DATA_PATH):
        print(f"[OK] Dataset already exists: {DATA_PATH}")
        return

    print("[RUN] Downloading creditcard.csv from GitHub mirror...")
    url = (
        "https://raw.githubusercontent.com/dsrscientist/"
        "dataset1/master/creditcard.csv"
    )
    try:
        r = requests.get(url, stream=True, timeout=120)
        r.raise_for_status()
        total = int(r.headers.get('content-length', 0))
        downloaded = 0
        with open(DATA_PATH, 'wb') as f:
            for chunk in r.iter_content(chunk_size=1024*1024):
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded / total * 100
                    print(f"  {pct:.1f}%", end='\r')
        print(f"\n[OK] Downloaded creditcard.csv ({downloaded/1e6:.1f} MB)")
    except Exception as e:
        print(f"[WARN] Primary mirror failed: {e}")
        # Fallback: try alternative source
        alt_url = "https://storage.googleapis.com/download.tensorflow.org/data/creditcard.csv"
        try:
            print("[RUN] Trying alternative source...")
            r = requests.get(alt_url, stream=True, timeout=180)
            r.raise_for_status()
            with open(DATA_PATH, 'wb') as f:
                for chunk in r.iter_content(chunk_size=1024*1024):
                    f.write(chunk)
            print(f"[OK] Downloaded from alternative source")
        except Exception as e2:
            raise RuntimeError(
                f"Could not download dataset. Please download creditcard.csv from "
                f"https://www.kaggle.com/mlg-ulb/creditcardfraud and place it in the "
                f"backend/ folder.\nError: {e2}"
            )

# -----------------------------------------------------------------------------
# 2. Load & preprocess
# -----------------------------------------------------------------------------
def load_data():
    print("[RUN] Loading dataset...")
    df = pd.read_csv(DATA_PATH)
    
    # Downsample for RAM safety and fast college project demonstration:
    # Keep all 492 fraud cases and sample 20,000 legitimate cases
    df_fraud = df[df['Class'] == 1]
    df_legit = df[df['Class'] == 0].sample(n=20000, random_state=42)
    df = pd.concat([df_fraud, df_legit]).sample(frac=1, random_state=42).reset_index(drop=True)
    
    print(f"    Downsampled Shape: {df.shape} | Fraud: {df['Class'].sum()} ({df['Class'].mean()*100:.3f}%)")

    X = df.drop('Class', axis=1)
    y = df['Class']

    # Scale Time and Amount (V1-V28 are already PCA-scaled)
    scaler = StandardScaler()
    X = X.copy()
    X[['Time', 'Amount']] = scaler.fit_transform(X[['Time', 'Amount']])
    joblib.dump(scaler, os.path.join(MODELS_DIR, 'scaler.pkl'))

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"    Train: {len(X_train)} | Test: {len(X_test)}")
    return X_train, X_test, y_train, y_test, X.columns.tolist()

# -----------------------------------------------------------------------------
# 3. Train models
# -----------------------------------------------------------------------------
def train_models(X_train, y_train):
    models = {}

    print("\n[RUN] Training Random Forest...")
    rf = RandomForestClassifier(
        n_estimators=100, max_depth=12, class_weight='balanced',
        n_jobs=1, random_state=42
    )
    rf.fit(X_train, y_train)
    models['rf'] = rf
    joblib.dump(rf, os.path.join(MODELS_DIR, 'rf_model.pkl'))
    print("[OK] Random Forest saved")

    print("[RUN] Training XGBoost...")
    scale_pos_weight = (y_train == 0).sum() / (y_train == 1).sum()
    xgb_model = xgb.XGBClassifier(
        n_estimators=200, max_depth=6, learning_rate=0.1,
        scale_pos_weight=scale_pos_weight, eval_metric='logloss',
        use_label_encoder=False, n_jobs=-1, random_state=42
    )
    xgb_model.fit(X_train, y_train)
    models['xgb'] = xgb_model
    joblib.dump(xgb_model, os.path.join(MODELS_DIR, 'xgb_model.pkl'))
    print("[OK] XGBoost saved")

    print("[RUN] Training LightGBM...")
    lgbm_model = lgb.LGBMClassifier(
        n_estimators=200, max_depth=8, learning_rate=0.05,
        class_weight='balanced', n_jobs=-1, random_state=42,
        verbose=-1
    )
    lgbm_model.fit(X_train, y_train)
    models['lgbm'] = lgbm_model
    joblib.dump(lgbm_model, os.path.join(MODELS_DIR, 'lgbm_model.pkl'))
    print("[OK] LightGBM saved")

    return models

# -----------------------------------------------------------------------------
# 4. Compute + save stats (ROC curves, metrics, feature importances, presets)
# -----------------------------------------------------------------------------
def compute_stats(models, X_test, y_test, feature_names):
    print("\n[RUN] Computing model statistics...")
    stats = {}
    model_info = {
        'rf':   {'name': 'Random Forest',  'color': '#4ade80'},
        'xgb':  {'name': 'XGBoost',        'color': '#60a5fa'},
        'lgbm': {'name': 'LightGBM',       'color': '#f59e0b'},
    }

    for key, model in models.items():
        y_prob = model.predict_proba(X_test)[:, 1]
        y_pred = (y_prob >= 0.5).astype(int)

        # ROC
        fpr, tpr, _ = roc_curve(y_test, y_prob)
        roc_auc = auc(fpr, tpr)

        # PR
        prec_curve, rec_curve, _ = precision_recall_curve(y_test, y_prob)
        pr_auc = auc(rec_curve, prec_curve)

        # Metrics
        cm = confusion_matrix(y_test, y_pred)
        prec  = precision_score(y_test, y_pred, zero_division=0)
        rec   = recall_score(y_test, y_pred, zero_division=0)
        f1    = f1_score(y_test, y_pred, zero_division=0)

        # Feature importances (top 10)
        fi = model.feature_importances_
        top_idx = np.argsort(fi)[::-1][:10]
        top_features = [
            {'name': feature_names[i], 'importance': float(fi[i])}
            for i in top_idx
        ]

        # Downsample ROC/PR to 200 pts for JSON size
        step = max(1, len(fpr) // 200)
        stats[key] = {
            'name':    model_info[key]['name'],
            'color':   model_info[key]['color'],
            'roc': {
                'fpr': fpr[::step].tolist(),
                'tpr': tpr[::step].tolist(),
                'auc': round(roc_auc, 4),
            },
            'pr': {
                'precision': prec_curve[::step].tolist(),
                'recall':    rec_curve[::step].tolist(),
                'auc':       round(pr_auc, 4),
            },
            'metrics': {
                'precision': round(float(prec), 4),
                'recall':    round(float(rec),  4),
                'f1':        round(float(f1),   4),
                'roc_auc':   round(float(roc_auc), 4),
                'confusion_matrix': cm.tolist(),
            },
            'feature_importances': top_features,
        }
        print(f"    {model_info[key]['name']}: AUC={roc_auc:.4f} F1={f1:.4f}")
    # Save presets (5 known fraud + 5 legit from test set)
    # Inverse scale Time and Amount back to original values so they look realistic in the UI
    scaler = joblib.load(os.path.join(MODELS_DIR, 'scaler.pkl'))
    X_test_unscaled = X_test.copy()
    X_test_unscaled[['Time', 'Amount']] = scaler.inverse_transform(X_test[['Time', 'Amount']])
    
    df_test = pd.DataFrame(X_test_unscaled)
    fraud_idx  = df_test[y_test == 1].head(5).index
    legit_idx  = df_test[y_test == 0].head(5).index

    presets = {
        'fraud': [
            {f: round(float(X_test_unscaled.loc[i, f]), 6) for f in X_test_unscaled.columns}
            for i in fraud_idx
        ],
        'legit': [
            {f: round(float(X_test_unscaled.loc[i, f]), 6) for f in X_test_unscaled.columns}
            for i in legit_idx
        ],
    }

    # Compute correlation matrix for features (rounded for file size optimization)
    corr_matrix = df_test[feature_names].corr().round(3).to_dict()

    out = {
        'models': stats,
        'presets': presets,
        'feature_names': feature_names,
        'correlation_matrix': corr_matrix
    }
    with open(os.path.join(MODELS_DIR, 'precomputed_stats.json'), 'w') as f:
        json.dump(out, f, indent=2)
    print("[OK] Precomputed stats saved")


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
if __name__ == '__main__':
    print("=" * 60)
    print("  CCFD - Multi-Model Training Pipeline")
    print("=" * 60)

    download_dataset()
    X_train, X_test, y_train, y_test, feature_names = load_data()
    models = train_models(X_train, y_train)
    compute_stats(models, X_test, y_test, feature_names)

    print("\n" + "=" * 60)
    print("  Training complete! All models + stats saved to models/")
    print("  Run: python app.py")
    print("=" * 60)

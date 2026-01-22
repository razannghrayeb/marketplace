"""
Outfit Ranker API - XGBoost model serving for recommendation ranking.

Endpoints:
  GET  /health   - Health check + model info
  POST /predict  - Score candidate rows
  GET  /features - List expected feature names
"""
import json
import os
import xgboost as xgb
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List, Optional

app = FastAPI(title="Outfit Ranker API", version="1.0.0")

# Model paths (relative to working directory or absolute)
MODEL_PATH = os.getenv("RANKER_MODEL_PATH", "models/xgb_ranker_model.json")
META_PATH = os.getenv("RANKER_META_PATH", "models/ranker_model_metadata.json")

# Load model at startup
booster: Optional[xgb.Booster] = None
feature_names: List[str] = []

def load_model():
    """Load XGBoost model and metadata."""
    global booster, feature_names
    
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f"Model file not found: {MODEL_PATH}")
    if not os.path.exists(META_PATH):
        raise FileNotFoundError(f"Metadata file not found: {META_PATH}")
    
    booster = xgb.Booster()
    booster.load_model(MODEL_PATH)
    
    with open(META_PATH, 'r') as f:
        meta = json.load(f)
    
    feature_names = meta.get('feature_names', [])
    print(f"[RankerAPI] Loaded model with {len(feature_names)} features")

# Load on import
try:
    load_model()
except FileNotFoundError as e:
    print(f"[RankerAPI] Warning: {e} - model will need to be loaded before predictions")


class PredictionRequest(BaseModel):
    rows: List[Dict[str, Any]]

class PredictionResponse(BaseModel):
    scores: List[float]
    count: int

class HealthResponse(BaseModel):
    ok: bool
    model: str
    n_features: int
    features_sample: List[str]


@app.get("/health", response_model=HealthResponse)
def health_check():
    """Health check endpoint with model info."""
    return {
        "ok": booster is not None,
        "model": MODEL_PATH,
        "n_features": len(feature_names),
        "features_sample": feature_names[:10] if feature_names else []
    }


@app.get("/features")
def get_features():
    """Return full list of expected feature names."""
    return {
        "feature_names": feature_names,
        "count": len(feature_names)
    }


@app.post("/predict", response_model=PredictionResponse)
def predict(request: PredictionRequest):
    """
    Score candidate rows using the XGBoost ranker model.
    
    Each row should contain feature values. Missing features are filled with 0.0.
    Returns scores in the same order as input rows.
    """
    if booster is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    if not request.rows:
        return {"scores": [], "count": 0}
    
    try:
        # Convert to DataFrame
        df = pd.DataFrame(request.rows)
        
        # Ensure all required features exist (fill missing with 0.0)
        for col in feature_names:
            if col not in df.columns:
                df[col] = 0.0
        
        # Select only the features the model expects, in the correct order
        df = df[feature_names].fillna(0.0).astype(float)
        
        # Create DMatrix and predict
        dmatrix = xgb.DMatrix(df, feature_names=feature_names)
        scores = booster.predict(dmatrix).tolist()
        
        return {"scores": scores, "count": len(scores)}
    
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Prediction failed: {str(e)}")


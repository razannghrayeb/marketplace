"""
Create a dummy XGBoost ranker model for testing.
Run this to generate placeholder model files before training real data.
"""
import json
import xgboost as xgb
import numpy as np
import os

# Feature names matching our TypeScript feature builder
FEATURE_NAMES = [
    # Core similarity scores
    "clip_sim",
    "text_sim",
    "opensearch_score",
    "candidate_score",
    
    # pHash features
    "phash_dist",
    "phash_sim",
    
    # Rule-based scores
    "style_score",
    "color_score",
    "formality_score",
    "occasion_score",
    
    # Price features
    "price_ratio",
    "price_diff_normalized",
    
    # Brand/vendor
    "same_brand",
    "same_vendor",
    
    # Position
    "original_position",
    
    # Common category pairs (one-hot encoded)
    "cat_dress__shoes",
    "cat_dress__bag",
    "cat_dress__jewelry",
    "cat_jeans__top",
    "cat_jeans__shoes",
    "cat_shirt__pants",
    "cat_top__jeans",
    "cat_top__skirt",
    "cat_shoes__bag",
    "cat_unknown__unknown",
]

def create_dummy_model():
    """Create a simple XGBoost model with random weights for testing."""
    
    # Create synthetic training data
    np.random.seed(42)
    n_samples = 1000
    n_features = len(FEATURE_NAMES)
    
    # Generate random features
    X = np.random.rand(n_samples, n_features)
    
    # Generate labels: weighted combination of features + noise
    # This simulates a simple ranking objective
    weights = np.array([
        0.25,  # clip_sim - high weight
        0.15,  # text_sim
        0.05,  # opensearch_score
        0.10,  # candidate_score
        -0.05, # phash_dist - negative (lower = better)
        0.10,  # phash_sim
        0.15,  # style_score - high weight
        0.10,  # color_score
        0.05,  # formality_score
        0.05,  # occasion_score
        -0.02, # price_ratio - slight negative
        -0.01, # price_diff_normalized
        0.03,  # same_brand
        0.01,  # same_vendor
        -0.02, # original_position - negative (lower = better)
    ] + [0.01] * (n_features - 15))  # category features
    
    y = X @ weights[:n_features] + np.random.randn(n_samples) * 0.1
    y = (y - y.min()) / (y.max() - y.min())  # Normalize to 0-1
    
    # Create DMatrix
    dtrain = xgb.DMatrix(X, label=y, feature_names=FEATURE_NAMES)
    
    # Train a simple model
    params = {
        "objective": "reg:squarederror",
        "max_depth": 4,
        "eta": 0.1,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "seed": 42,
    }
    
    booster = xgb.train(params, dtrain, num_boost_round=50)
    
    return booster

def main():
    # Ensure models directory exists
    os.makedirs("models", exist_ok=True)
    
    print("Creating dummy XGBoost ranker model...")
    
    # Create and save model
    booster = create_dummy_model()
    model_path = "models/xgb_ranker_model.json"
    booster.save_model(model_path)
    print(f"Saved model to {model_path}")
    
    # Save metadata
    meta = {
        "feature_names": FEATURE_NAMES,
        "n_features": len(FEATURE_NAMES),
        "model_type": "xgboost_regressor",
        "objective": "reg:squarederror",
        "description": "Dummy ranker model for testing - replace with trained model",
        "created_at": "2026-01-15",
        "version": "0.1.0-dummy",
    }
    
    meta_path = "models/ranker_model_metadata.json"
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"Saved metadata to {meta_path}")
    
    # Verify by loading
    print("\nVerifying model...")
    loaded = xgb.Booster()
    loaded.load_model(model_path)
    
    # Test prediction
    test_data = np.random.rand(3, len(FEATURE_NAMES))
    dtest = xgb.DMatrix(test_data, feature_names=FEATURE_NAMES)
    preds = loaded.predict(dtest)
    print(f"Test predictions: {preds}")
    
    print("\n✓ Dummy model created successfully!")
    print("  Run the ranker API with: python -m uvicorn src.lib.model.ranker_api:app --reload")

if __name__ == "__main__":
    main()

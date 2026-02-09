import json
import joblib
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score, accuracy_score
from sklearn.preprocessing import LabelEncoder
import pandas as pd
import numpy as np
from pathlib import Path
import os

# Updated paths
csv_file_path = r'C:\Users\USER\Desktop\marketplace\data\reco_training.csv'
model_outpath = 'models/xgb_ranker_model.json'
meta_out = "models/ranker_model_metadata.json"

# Create models directory
Path(model_outpath).parent.mkdir(parents=True, exist_ok=True)

# Load and prepare data
print("Loading training data...")
df = pd.read_csv(csv_file_path)
print(f"Loaded {len(df)} samples")

# Label mapping: good=2, ok=1, bad=0 (for regression-style ranking)
label_map = {"good": 2, "ok": 1, "bad": 0}
df['y'] = df['label'].map(label_map)

# Remove rows without labels
df = df.dropna(subset=["y"]).copy()
print(f"After removing unlabeled: {len(df)} samples")

# Feature columns (matching your schema)
feature_cols = [
    "candidate_score",
    "style_score", 
    "color_score",
    "clip_sim",
    "text_sim",
    "opensearch_score",
    "final_match_score",
    "price_ratio",
    "p_hash_dist",
    "position",
    "same_brand",
    "same_vendor"
]

# Check which features are available
available_features = []
for col in feature_cols:
    if col in df.columns:
        available_features.append(col)
        print(f"✓ Found feature: {col}")
    else:
        print(f"✗ Missing feature: {col} (will be set to 0)")
        df[col] = 0.0

print(f"\nUsing {len(available_features)} features")

# Fill missing values
df[feature_cols] = df[feature_cols].fillna(0.0)

# Handle categorical features (category_pair)
categorical_features = []
if 'category_pair' in df.columns:
    cat_dummies = pd.get_dummies(df["category_pair"].fillna("unknown"), prefix="cat")
    categorical_features = list(cat_dummies.columns)
    X = pd.concat([df[feature_cols], cat_dummies], axis=1)
    print(f"Added {len(categorical_features)} category pair features")
else:
    X = df[feature_cols].copy()
    print("No category_pair column found")

y = df["y"].astype(int)

# Keep feature order for serving
feature_names = list(X.columns)
print(f"\nTotal features for training: {len(feature_names)}")

# Train/test split
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
print(f"Train samples: {len(X_train)}, Test samples: {len(X_test)}")

# Print label distribution
print("\nLabel distribution:")
print("Training:", pd.Series(y_train).value_counts().sort_index())
print("Testing:", pd.Series(y_test).value_counts().sort_index())

# Train XGBoost model
print("\nTraining XGBoost model...")
model = xgb.XGBRegressor(
    n_estimators=100,
    max_depth=6,
    learning_rate=0.1,
    subsample=0.8,
    colsample_bytree=0.8,
    reg_alpha=0.1,
    reg_lambda=1.0,
    random_state=42,
    eval_metric='rmse'
)

# Fit model
model.fit(X_train, y_train, 
          eval_set=[(X_test, y_test)], 
          verbose=True)

# Save model in JSON format for serving
print(f"\nSaving model to {model_outpath}")
model.save_model(model_outpath)

# Make predictions
y_pred = model.predict(X_test)

# Convert to classification for evaluation
y_pred_class = np.round(y_pred).astype(int)
y_pred_class = np.clip(y_pred_class, 0, 2)  # Ensure in range [0, 2]

print("\n" + "="*60)
print("EVALUATION RESULTS")
print("="*60)

# Classification metrics
accuracy = accuracy_score(y_test, y_pred_class)
print(f"Accuracy: {accuracy:.3f}")

# Classification report
print("\nClassification Report:")
target_names = ['bad', 'ok', 'good']
print(classification_report(y_test, y_pred_class, target_names=target_names))

# Feature importance
print("\nTop 10 Feature Importances:")
feature_importance = list(zip(feature_names, model.feature_importances_))
feature_importance.sort(key=lambda x: x[1], reverse=True)
for i, (feature, importance) in enumerate(feature_importance[:10]):
    print(f"{i+1:2d}. {feature:20s}: {importance:.4f}")

# Save metadata
metadata = {
    'model_type': 'XGBRegressor',
    'feature_names': feature_names,
    'label_mapping': {'bad': 0, 'ok': 1, 'good': 2},
    'num_features': len(feature_names),
    'train_samples': len(X_train),
    'test_samples': len(X_test),
    'accuracy': float(accuracy),
    'feature_importance': {name: float(importance) for name, importance in feature_importance[:20]}  # Top 20, convert to float
}

print(f"\nSaving metadata to {meta_out}")
with open(meta_out, 'w') as f:
    json.dump(metadata, f, indent=2)

print("\n✅ Training completed successfully!")
print(f"✅ Model saved: {model_outpath}")
print(f"✅ Metadata saved: {meta_out}")
print(f"✅ Ready for serving with ranker_api.py")

model.fit(X_train, y_train)

probs = model.predict_proba(X_test)[:, 1]
auc = roc_auc_score(y_test, probs)
print(f"Test AUC: {auc:.4f}")
y_pred = model.predict(X_test)
print(classification_report(y_test, y_pred))

model.save_model(model_outpath)
meta = {
    "feature_names": feature_names,
    "label_map": label_map,
    "model_params": model.get_params(),
    "test_auc": auc,
}
with open(meta_out, "w") as f:
    json.dump(meta, f, indent=4)
print(model_outpath, meta_out)
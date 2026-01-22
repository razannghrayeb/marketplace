import json
import joblib
import xgboost as xgbClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score
import pandas as pd

csv_file_path = 'training_data.csv'
model_outpath = 'xgb_classifier_model.json'
meta_out="model_metadata.json"

df=pd.read_csv(csv_file_path)
label_map ={"good":1, "bad":0,"ok":0.5}
df['y']=df['label'].map(label_map)

df.dropna(subset=["y"]).copy()

feature_cols = [
    "style_score",
    "color_score",
    "clip_sim",
    "text_sim",
    "opensearch_score",
    "candidate_score",
    "price_ratio",
    "phash_dist",
]

for c in feature_cols:
    if c not in df.columns:
        df[c] = 0.0

df[feature_cols] = df[feature_cols].fillna(0.0)

cat = pd.get_dummies(df["category_pair"].fillna("unknown"), prefix="cat")
X = pd.concat([df[feature_cols], cat], axis=1)
y = df["y"].astype(int)

# keep feature order for serving
feature_names = X.columns.tolist()

X_train , X_test,y_train,y_test = train_test_split(X,y,test_size=0.2,random_state=42)

model= xgbClassifier.XGBClassifier(
    n_estimators=100,
    max_depth=6,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    reg_lambda=1.0,
    objective='binary:logistic',
    eval_metric='auc',
    n_jobs=8,
)

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
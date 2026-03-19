# Ranker Runbook

This runbook explains how to train, start, verify, and operate the recommendation ranker service.

## Scope

The ranker is a Python FastAPI service used by the Node API to score recommendation candidates.

- Node client config: src/lib/ranker/client.ts
- Node ranking pipeline and fallback logic: src/lib/ranker/pipeline.ts
- Python startup helper: scripts/start-ranker.ps1
- Python training script: scripts/train_xgboost_ranker.py
- Model artifacts:
  - models/xgb_ranker_model.json
  - models/ranker_model_metadata.json

## Runtime Contract

Node expects these ranker endpoints:

- GET /health
- GET /features
- POST /predict

Node environment variables:

- RANKER_API_URL (default: http://0.0.0.0:8000)
- RANKER_TIMEOUT_MS (default: 5000)
- RANKER_RETRY_ATTEMPTS (default: 2)
- RANKER_RETRY_DELAY_MS (default: 50)

Ranker service environment variables:

- RANKER_MODEL_PATH (default used by startup script: models/xgb_ranker_model.json)
- RANKER_META_PATH (default used by startup script: models/ranker_model_metadata.json)

Optional heuristic fallback weight overrides in Node:

- HW_CLIP_SIM
- HW_TEXT_SIM
- HW_STYLE
- HW_COLOR
- HW_PHASH
- HW_SAME_BRAND

## Start Ranker Locally (Windows)

From repository root:

1. Activate your Python environment in src/lib/model (if not already active).
2. Start the service:

   powershell -ExecutionPolicy Bypass -File scripts/start-ranker.ps1

The script sets model paths and launches:

- uvicorn src.lib.model.ranker_api:app --host 0.0.0.0 --port 8000 --reload

## Verify Service Health

- curl http://0.0.0.0:8000/health
- curl http://0.0.0.0:8000/features

For end-to-end API-side verification:

- curl http://0.0.0.0:4000/health/ready
- Trigger a recommendation flow that invokes rankCandidatesWithModel

## Train a New Model

The training script pulls recommendation impressions/labels and trains an XGBoost rank:ndcg model.

Basic run:

- python scripts/train_xgboost_ranker.py

See options:

- python scripts/train_xgboost_ranker.py --help

Important data expectations:

- recommendation_impressions has candidate-level feature logs
- recommendation_labels has optional manual labels (good, ok, bad)

Training script DB variables (Python side):

- DB_HOST (default: 0.0.0.0)
- DB_PORT (default: 5432)
- DB_NAME (default: fashion_marketplace)
- DB_USER (default: postgres)
- DB_PASSWORD

After training, ensure the latest model and metadata are placed at:

- models/xgb_ranker_model.json
- models/ranker_model_metadata.json

Then restart ranker service.

## Fallback Behavior (Critical)

If ranker API is unavailable, Node falls back to heuristic scoring.

Current behavior:

- Client-side fallback exists in src/lib/ranker/client.ts
- Pipeline performs retries and emits fallback metric in src/lib/ranker/pipeline.ts
- Score mismatch also triggers heuristic fallback

Operational implication:

- Recommendations keep working when ranker is down
- Ranking quality may shift compared to model-scored results

## Troubleshooting

### Service returns 500 on /predict

Check:

- RANKER_MODEL_PATH and RANKER_META_PATH are valid
- Model/metadata files exist and are readable
- Feature schema expected by model matches current request rows

### Node always uses heuristic

Check:

- RANKER_API_URL is reachable from Node process
- /health endpoint returns ok=true
- Timeout is not too low for your environment

### Slow ranking latency

Check:

- RANKER_TIMEOUT_MS and retry settings
- CPU and memory pressure on ranker container
- Candidate set size before ranking

## Deployment Notes

In Docker Compose examples, set:

- RANKER_API_URL=http://ranker:8000 for Node
- RANKER_MODEL_PATH=/app/models/xgb_ranker_model.json for ranker
- RANKER_META_PATH=/app/models/ranker_model_metadata.json for ranker

If models are mounted read-only from host, verify file presence before startup.

## Change Management Checklist

When updating ranking features or model:

1. Re-train model with current feature set.
2. Update model + metadata artifacts.
3. Validate /features response matches Node rows.
4. Run smoke recommendations and compare top-k quality.
5. Watch fallback and mismatch logs/metrics after deploy.

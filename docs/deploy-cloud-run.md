# Deploy to Google Cloud Run

The root **`Dockerfile`** builds **one image**: Node + ONNX (CLIP/BLIP) and, when the container starts with **`SERVICE_ROLE=all`** or **`ml`**, an embedded **YOLO** API on loopback. You can run it as **one Cloud Run service** (recommended simple setup) or split it into two.

### Option A — Single service (`SERVICE_ROLE=all`)  ← you chose this
- One Cloud Run revision serves **both** “API” routes (`/api/auth`, cart, …) and **ML** routes (`/search`, `/products`, `/api/images`, …).
- **Do not set** `ML_SERVICE_URL` (leave it unset or empty). If it is set, `SERVICE_ROLE=api` would proxy ML routes elsewhere; with `SERVICE_ROLE=all` the app serves ML in-process and does not need a peer URL.
- Set **`SERVICE_ROLE=all`** (or omit it — the default in `config.ts` is `"all"` when unset).
- Use the same secrets as in §3 (database, OpenSearch, Redis, R2, JWT, etc.).
- **YOLO (shop-the-look):** the root **`Dockerfile`** starts an in-container YOLO API on **`127.0.0.1:8001`** when **`SERVICE_ROLE=all`** (or **`ml`**). You normally **do not** set `YOLOV8_SERVICE_URL`. Set it only if you use a **separate** YOLO service (see §7).

**Minimal env shape (Option A)**  
`NODE_ENV=production`, `SERVICE_ROLE=all`, no `ML_SERVICE_URL`, plus your DB/OpenSearch/Redis/Supabase/R2/JWT/Gemini secrets as usual.

### Option B — Two services (same image, `cloudbuild.cloudrun.yaml` default)
- `marketplace-ml` with `SERVICE_ROLE=ml`
- `marketplace-api` with `SERVICE_ROLE=api` and `ML_SERVICE_URL=<ml-service-url>`

## Why two services (when you use option B)
The app supports split roles in `src/config.ts` and `src/server.ts`.
- API routes can proxy ML endpoints through `ML_SERVICE_URL`.
- ML endpoints (search, image processing, indexing paths) run on the ML service.

## 1) Prerequisites
- Google Cloud project with billing enabled.
- `gcloud` CLI installed and authenticated.
- Artifact Registry API, Cloud Build API, Cloud Run Admin API, Secret Manager API enabled.
- A Docker build that can download HuggingFace models (set `HF_TOKEN` only if model repo is private).

## 2) One-time GCP setup

```bash
gcloud config set project <PROJECT_ID>
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com

gcloud artifacts repositories create marketplace \
  --repository-format=docker \
  --location=us-central1
```

## 3) Create required secrets
Do not put real tokens directly in `cloudbuild.cloudrun.yaml`.
Keep real values in a local env file and push them to Secret Manager.

Create one secret for each runtime variable listed below. Example pattern:

```bash
echo -n '<VALUE>' | gcloud secrets create database-url --data-file=-
```

If secret exists, add a new version:

```bash
echo -n '<VALUE>' | gcloud secrets versions add database-url --data-file=-
```

Required secret names used by `cloudbuild.cloudrun.yaml`:
- `database-url`
- `supabase-url`
- `supabase-anon-key`
- `supabase-service-role-key`
- `os-node`
- `redis-url`
- `jwt-secret`
- `gemini-api-key`
- `gcloud-project`
- `r2-account-id`
- `r2-access-key-id`
- `r2-secret-access-key`
- `r2-bucket`
- `r2-public-base-url`

### PowerShell automation (recommended on Windows)

This repository includes a script that reads env values and creates/updates the matching Secret Manager secrets:

```powershell
# Preview what will be updated
powershell -ExecutionPolicy Bypass -File scripts/gcp/sync-secrets-from-env.ps1 -EnvFile .env -ProjectId marketplace-490613 -DryRun

# Apply changes
powershell -ExecutionPolicy Bypass -File scripts/gcp/sync-secrets-from-env.ps1 -EnvFile .env -ProjectId marketplace-490613
```

Grant Cloud Run runtime service account secret access (replace project number):

```bash
PROJECT_NUMBER=$(gcloud projects describe <PROJECT_ID> --format='value(projectNumber)')
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for s in database-url supabase-url supabase-anon-key supabase-service-role-key os-node redis-url jwt-secret gemini-api-key gcloud-project r2-account-id r2-access-key-id r2-secret-access-key r2-bucket r2-public-base-url; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor"
done
```

## 4a) Option A: deploy one Cloud Run service

Build the root image (same as local production), then deploy **one** service.

```bash
# From repo root — adjust REGION / PROJECT / REPO / SERVICE_NAME
export REGION=us-central1
export PROJECT_ID=<PROJECT_ID>
export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/marketplace/marketplace:latest"

docker build -t "$IMAGE" .
docker push "$IMAGE"

gcloud run deploy marketplace \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$IMAGE" \
  --port 8080 \
  --memory 4Gi \
  --set-env-vars "NODE_ENV=production,SERVICE_ROLE=all"
```

Use **at least 4 GiB** memory so **Node + ONNX + YOLO (PyTorch)** fit in one revision. Add **Secret Manager** bindings in the console or with repeated `--update-secrets` / `--set-secrets` so env vars like `DATABASE_URL`, `OS_NODE`, etc. match what `src/config.ts` expects. Omit **`ML_SERVICE_URL`** entirely for Option A. You usually **omit `YOLOV8_SERVICE_URL`** so the entrypoint starts YOLO on loopback (§7).

**Cloud Build without the two-service YAML:** you can use a minimal `cloudbuild.yaml` that only builds/pushes the image, then run `gcloud run deploy` once with `SERVICE_ROLE=all`, or run the `docker` + `gcloud run deploy` steps from your laptop/CI.

## 4b) Option B: deploy both services with Cloud Build

From repo root (two Cloud Run services, API proxies to ML):

```bash
gcloud builds submit \
  --config cloudbuild.cloudrun.yaml \
  --substitutions _REGION=us-central1,_REPOSITORY=marketplace,_SERVICE_API=marketplace-api,_SERVICE_ML=marketplace-ml,_IMAGE_NAME=marketplace
```

PowerShell-safe single-line command:

```powershell
& "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" builds submit --config cloudbuild.cloudrun.yaml --substitutions _REGION=us-central1,_REPOSITORY=marketplace,_SERVICE_API=marketplace-api,_SERVICE_ML=marketplace-ml,_IMAGE_NAME=marketplace --project marketplace-490613
```

Optional (if HuggingFace model repo is private):

```bash
gcloud builds submit \
  --config cloudbuild.cloudrun.yaml \
  --substitutions _REGION=us-central1,_REPOSITORY=marketplace,_SERVICE_API=marketplace-api,_SERVICE_ML=marketplace-ml,_IMAGE_NAME=marketplace,_HF_TOKEN=<HF_TOKEN>
```

## 5) Verify rollout

**Option A (single URL):**

```bash
gcloud run services describe marketplace --region us-central1 --format='value(status.url)'
```

```bash
curl https://<SERVICE_URL>/health/live
curl "https://<SERVICE_URL>/products/search?q=blazer&limit=24&page=1"
curl https://<SERVICE_URL>/   # shows serviceRole and routes.ml / routes.api
```

**Option B (two URLs):**

```bash
gcloud run services list --region us-central1

gcloud run services describe marketplace-ml --region us-central1 --format='value(status.url)'
gcloud run services describe marketplace-api --region us-central1 --format='value(status.url)'
```

```bash
curl https://<ML_URL>/health/live
curl https://<API_URL>/health/live
curl "https://<API_URL>/products/search?q=blazer&limit=24&page=1"
```

## 6) Recommended production hardening
- Restrict ingress to internal + load balancer if public exposure is not required.
- Use a dedicated runtime service account instead of default compute service account.
- Configure custom domain + managed SSL on the Cloud Run service (Option A: one hostname; Option B: often API public, ML internal).
- Add min instances for reduced cold starts on the service that takes user traffic (`marketplace` or `marketplace-api`).
- Add Cloud Monitoring alerting on 5xx rate and latency.

## 7) Shop-the-look: YOLO in the root Docker image

The production **`Dockerfile`** ships **Node + ONNX** (CLIP/BLIP) and a **Python venv** under `/app/yolo` with **`yolov8_api.py`** (dual-model detector). **`docker-entrypoint.sh`** does the following:

- **`SERVICE_ROLE=api`**: runs **Node only** (same as before). Image/ML routes are proxied to **`ML_SERVICE_URL`**; that **ML** revision should use `ml` or `all` so YOLO runs there.
- **`SERVICE_ROLE=all`** or **`SERVICE_ROLE=ml`**: starts **uvicorn** on **`127.0.0.1:${YOLO_INTERNAL_PORT:-8001}`**, waits for **`GET /health`**, sets **`YOLOV8_SERVICE_URL=http://127.0.0.1:…`**, then starts Node on **`$PORT`**.

**Sizing:** YOLO loads **PyTorch** in-process. Use at least **4 GiB memory** (and enough CPU) on the Cloud Run revision that runs **`ml`** or **`all`**. The sample **`cloudbuild.cloudrun.yaml`** already uses **`_MEMORY_ML: 4Gi`** for **`marketplace-ml`**.

**External YOLO instead:** set **`YOLOV8_SERVICE_URL`** (or **`YOLO_API_URL`**) to a URL that is **not** loopback (for example another Cloud Run service). The entrypoint will **not** start the embedded server in that case.

**Cold starts:** First request may download Hugging Face weights; **`docker-entrypoint.sh`** waits up to **~180s** for YOLO **`/health`**. Optionally set **`HF_TOKEN`** at runtime if those repos are private.

If YOLO is unreachable, routes **fall back** to whole-image embedding search.

## 8) Optional: BLIP external service (HF model baked at build time)

The API supports two BLIP modes:

1. **Local ONNX BLIP in Node** (default) — `BLIP_API_URL` unset.
2. **External BLIP service** (recommended for large HF instruct BLIP models) — set `BLIP_API_URL` and run the dedicated service built from `src/lib/model/Dockerfile.blip`.

### Build and deploy BLIP service (Cloud Run GPU)

```bash
# Build image with model baked into image layers
gcloud builds submit src/lib/model \
  --tag us-central1-docker.pkg.dev/<PROJECT_ID>/marketplace/blip-service:latest \
  --substitutions=_HF_TOKEN=<HF_TOKEN>,_BLIP_HF_REPO=Salesforce/instructblip-flan-t5-xl
```

Then deploy:

```bash
gcloud run deploy blip-service \
  --image us-central1-docker.pkg.dev/<PROJECT_ID>/marketplace/blip-service:latest \
  --region us-central1 \
  --gpu 1 \
  --gpu-type nvidia-l4 \
  --cpu 4 \
  --memory 16Gi \
  --concurrency 4 \
  --min-instances 1 \
  --max-instances 5 \
  --no-cpu-throttling \
  --timeout 120
```

Finally point API at BLIP:

```bash
gcloud run services update marketplace \
  --region us-central1 \
  --set-env-vars BLIP_API_URL=https://blip-service-<hash>-uc.a.run.app,BLIP_API_TIMEOUT_MS=8000
```

Notes:
- BLIP service image is offline at runtime (`HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`).
- HF token is used at build time only.
- API automatically falls back to local ONNX BLIP when `BLIP_API_URL` is unset.

## 9) Optional: GPU for CLIP text/image search (faster embeddings)

Text and image search embeddings use **ONNX Runtime** in `src/lib/image/clip.ts`. By default the server uses **CPU** only. On a **GPU** machine or **[Cloud Run with GPU](https://cloud.google.com/run/docs/configuring/services/gpu)** (where available in your region), you can enable CUDA:

1. Deploy a revision with **GPU** attached (NVIDIA L4, etc.) and a **CUDA-capable** ONNX Runtime stack. The stock `onnxruntime-node` package can still run CPU-only depending on runtime libraries; for production GPU you may need a custom base image or build that ships CUDA-compatible ONNX runtime native libraries — validate in a staging revision first.
2. Set runtime env:
   - **`CLIP_USE_GPU=true`** — tries `cuda` then `cpu`, or  
   - **`CLIP_EXECUTION_PROVIDERS=cuda,cpu`** — explicit order (also supports **`dml,cpu`** on Windows with DirectML).
   - **`BLIP_USE_GPU=true`** or **`BLIP_EXECUTION_PROVIDERS=cuda,cpu`** — enable CUDA for local ONNX BLIP sessions.
3. If GPU session creation fails, the code **falls back to CPU** automatically and logs a warning.

For embedded YOLO in the root image, GPU-capable torch wheels are now the default build behavior. You can still force CPU explicitly:

```bash
docker build --build-arg YOLO_TORCH_VARIANT=cpu -t "$IMAGE" .
```

**Concurrency:** Try-on, search, and other API routes are independent HTTP requests; the storefront **React Query** client runs multiple queries in parallel. Try-on state is kept in a **global provider** so polling continues while users navigate (see marketplace `TryOnProvider`).

## Notes
- The production image sets **`PORT=8080`** (`Dockerfile`); align Cloud Run **`--port`** with the port your process listens on (the included `cloudbuild.cloudrun.yaml` uses **8080** for API/ML services).
- Keep `.env` local only. Use Secret Manager for all production secrets.

# Deploy to Google Cloud Run

This runbook deploys the backend as **two Cloud Run services** from the same image:
- `marketplace-ml` with `SERVICE_ROLE=ml`
- `marketplace-api` with `SERVICE_ROLE=api` and `ML_SERVICE_URL=<ml-service-url>`

## Why two services
The app already supports split roles in `src/config.ts` and `src/server.ts`.
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

## 4) Deploy both services with Cloud Build
From repo root:

```bash
gcloud builds submit \
  --config cloudbuild.cloudrun.yaml \
  --substitutions _REGION=us-central1,_REPOSITORY=marketplace,_SERVICE_API=marketplace-api,_SERVICE_ML=marketplace-ml,_IMAGE_NAME=marketplace
```

Optional (if HuggingFace model repo is private):

```bash
gcloud builds submit \
  --config cloudbuild.cloudrun.yaml \
  --substitutions _REGION=us-central1,_REPOSITORY=marketplace,_SERVICE_API=marketplace-api,_SERVICE_ML=marketplace-ml,_IMAGE_NAME=marketplace,_HF_TOKEN=<HF_TOKEN>
```

## 5) Verify rollout

```bash
gcloud run services list --region us-central1

gcloud run services describe marketplace-ml --region us-central1 --format='value(status.url)'
gcloud run services describe marketplace-api --region us-central1 --format='value(status.url)'
```

Check health endpoints:

```bash
curl https://<ML_URL>/health/live
curl https://<API_URL>/health/live
curl "https://<API_URL>/products/search?q=blazer&limit=24&page=1"
```

## 6) Recommended production hardening
- Restrict ingress to internal + load balancer if public exposure is not required.
- Use a dedicated runtime service account instead of default compute service account.
- Configure custom domain + managed SSL on API service.
- Add min instances for reduced cold starts on `marketplace-api`.
- Add Cloud Monitoring alerting on 5xx rate and latency.

## Notes
- Container listens on `PORT=3000` and Cloud Run deploy uses `--port 3000`.
- Keep `.env` local only. Use Secret Manager for all production secrets.

# Virtual Try-On Setup Guide - Google Cloud Vertex AI

## Prerequisites

- Google Cloud Account (with billing enabled)
- GCP Project ID
- Appropriate permissions to enable APIs and create service accounts

## Step 1: Create or Select a GCP Project

```bash
# List your projects
gcloud projects list

# Set your project (replace PROJECT_ID with your actual ID)
gcloud config set project PROJECT_ID
```

## Step 2: Enable Required APIs

```bash
# Enable Vertex AI API
gcloud services enable aiplatform.googleapis.com

# Enable Cloud Resource Manager API
gcloud services enable cloudresourcemanager.googleapis.com

# Verify Vertex AI is enabled
gcloud services list --enabled | grep aiplatform
```

## Step 3: Set Environment Variables

### For Local Development

**Option A: Using Application Default Credentials (Recommended)**

```bash
# Login to Google Cloud locally
gcloud auth application-default login

# Set project ID
export GCLOUD_PROJECT="your-project-id"
export TRYON_LOCATION="us-central1"
export TRYON_MODEL="virtual-try-on@002"
```

**Option B: Using Service Account Key**

```bash
# Create a service account
gcloud iam service-accounts create try-on-service \
  --display-name="Virtual Try-On Service"

# Grant Vertex AI permissions
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member=serviceAccount:try-on-service@PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/aiplatform.user

# Create and download key
gcloud iam service-accounts keys create /path/to/key.json \
  --iam-account=try-on-service@PROJECT_ID.iam.gserviceaccount.com

# Set environment variables
export GCLOUD_PROJECT="your-project-id"
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json"
```

### For Production (Cloud Run)

Set environment variables in your Cloud Run service:

```bash
gcloud run services update marketplace \
  --set-env-vars GCLOUD_PROJECT=your-project-id,\
TRYON_LOCATION=us-central1,\
TRYON_MODEL=virtual-try-on@002
```

## Step 4: Environment Variables Summary

| Variable                         | Required | Default              | Description                                      |
| -------------------------------- | -------- | -------------------- | ------------------------------------------------ |
| `GCLOUD_PROJECT`                 | ✅ Yes   | -                    | GCP Project ID                                   |
| `TRYON_LOCATION`                 | ❌ No    | `us-central1`        | Vertex AI region                                 |
| `TRYON_MODEL`                    | ❌ No    | `virtual-try-on@002` | Model version                                    |
| `GOOGLE_APPLICATION_CREDENTIALS` | ❌ No\*  | ADC                  | Path to service account key (if not using ADC)   |
| `TRYON_TIMEOUT`                  | ❌ No    | `60000`              | Request timeout in ms                            |
| `TRYON_RATE_LIMIT`               | ❌ No    | `10`                 | Try-ons per user per hour                        |
| `TRYON_INLINE_PROCESSING`        | ❌ No    | Auto-detect          | Process immediately (true) or async (false)      |
| `TRYON_BASE_STEPS`               | ❌ No    | `32`                 | Quality level (1-50; higher = better but slower) |
| `TRYON_ADD_WATERMARK`            | ❌ No    | `true`               | Add Google watermark to results                  |

\*If running locally and using `gcloud auth application-default login`, you don't need this.

## Step 5: Test Configuration

### Check Try-On Service Health

```bash
# Make a health check request
curl -X GET http://localhost:4000/api/tryon/service/health \
  -H "x-user-id: 1"
```

Expected response (when configured correctly):

```json
{
  "ok": true,
  "backend": "vertex-ai-virtual-try-on",
  "model_loaded": true,
  "gpu_available": false,
  "project": "your-project-id",
  "location": "us-central1",
  "model": "virtual-try-on@002",
  "version": "vertex-ai"
}
```

### Troubleshooting

| Error                  | Cause                             | Solution                                                                     |
| ---------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| `TRYON_NOT_CONFIGURED` | `GCLOUD_PROJECT` not set          | Set `GCLOUD_PROJECT` environment variable                                    |
| `Permission denied`    | Service account lacks permissions | Re-run `gcloud projects add-iam-policy-binding` with `roles/aiplatform.user` |
| `API not enabled`      | Vertex AI API not enabled         | Run `gcloud services enable aiplatform.googleapis.com`                       |
| `401 Unauthorized`     | Invalid or expired credentials    | Re-authenticate: `gcloud auth application-default login`                     |
| `Resource not found`   | Wrong region or model name        | Verify `TRYON_LOCATION` and `TRYON_MODEL` match your project                 |

## Step 6: Submit Your First Try-On

```bash
# Create a multipart form request
curl -X POST http://localhost:4000/api/tryon/ \
  -F "person_image=@person.jpg" \
  -F "garment_image=@garment.jpg" \
  -H "x-user-id: 1"
```

Expected response:

```json
{
  "success": true,
  "data": {
    "job": {
      "id": "uuid-here",
      "user_id": 1,
      "status": "pending",
      "created_at": "2026-04-05T10:00:00Z"
    },
    "jobId": "uuid-here"
  },
  "meta": {
    "statusUrl": "/api/tryon/uuid-here",
    "estimatedWaitTime": "30-120 seconds"
  }
}
```

Poll the status URL until `status` is `completed`:

```bash
curl -X GET http://localhost:4000/api/tryon/uuid-here \
  -H "x-user-id: 1"
```

## References

- [Vertex AI Virtual Try-On API Documentation](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/virtual-try-on-api)
- [GCP Authentication Best Practices](https://cloud.google.com/docs/authentication/getting-started)
- [Cloud Run Service Account Setup](https://cloud.google.com/run/docs/quickstarts/build-and-deploy)

## Support

For issues, check:

1. `GCLOUD_PROJECT` is set correctly
2. Vertex AI API is enabled: `gcloud services list --enabled | grep aiplatform`
3. Service account has `roles/aiplatform.user` permission
4. Region `TRYON_LOCATION` supports Virtual Try-On (usually `us-central1`, `europe-west1`)

# Ranker API Startup Script (PowerShell)
# Run from the marketplace root directory

$ErrorActionPreference = "Stop"

Write-Host "Starting Outfit Ranker API..." -ForegroundColor Cyan

# Check if models exist
$modelPath = "models/xgb_ranker_model.json"
$metaPath = "models/ranker_model_metadata.json"

if (-not (Test-Path $modelPath)) {
    Write-Host "Warning: Model file not found at $modelPath" -ForegroundColor Yellow
    Write-Host "The API will start but predictions will fail until a model is loaded." -ForegroundColor Yellow
}

if (-not (Test-Path $metaPath)) {
    Write-Host "Warning: Metadata file not found at $metaPath" -ForegroundColor Yellow
}

# Set environment variables
$env:RANKER_MODEL_PATH = $modelPath
$env:RANKER_META_PATH = $metaPath

# Start the API
Write-Host "Starting uvicorn server on http://0.0.0.0:8000" -ForegroundColor Green
uvicorn src.lib.model.ranker_api:app --host 0.0.0.0 --port 8000 --reload

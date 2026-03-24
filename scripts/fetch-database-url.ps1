# Fetch DATABASE_URL from Google Secret Manager and update .env
# Requires: gcloud CLI installed and authenticated (gcloud auth login)

$project = "marketplace-490613"
$secret = "database-url"
$envPath = Join-Path $PSScriptRoot ".." ".env"

Write-Host "Fetching DATABASE_URL from Secret Manager..." -ForegroundColor Cyan
try {
    $url = gcloud secrets versions access latest --secret=$secret --project=$project 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: gcloud not found or not authenticated." -ForegroundColor Red
        Write-Host "1. Install: https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
        Write-Host "2. Run: gcloud auth login" -ForegroundColor Yellow
        exit 1
    }
    
    $content = Get-Content $envPath -Raw
    if ($content -match "DATABASE_URL=.*") {
        $content = $content -replace "DATABASE_URL=.*", "DATABASE_URL=$url"
    } else {
        $content = "DATABASE_URL=$url`n" + $content
    }
    Set-Content $envPath $content -NoNewline
    Write-Host "Updated .env with DATABASE_URL" -ForegroundColor Green
} catch {
    Write-Host "Failed: $_" -ForegroundColor Red
    exit 1
}

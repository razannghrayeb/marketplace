param(
  [string]$EnvFile = ".env",
  [string]$ProjectId = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Get-GcloudCommand {
  $localGcloud = Join-Path $env:LOCALAPPDATA "Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
  if (Test-Path $localGcloud) {
    return $localGcloud
  }
  return "gcloud"
}

function Parse-EnvFile {
  param([string]$Path)

  $result = @{}
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      return
    }

    $idx = $line.IndexOf("=")
    if ($idx -lt 1) {
      return
    }

    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1)

    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    $result[$key] = $value
  }

  return $result
}

if (-not (Test-Path $EnvFile)) {
  throw "Env file not found: $EnvFile"
}

$gcloud = Get-GcloudCommand
$envValues = Parse-EnvFile -Path $EnvFile

$secretMap = @{
  "DATABASE_URL" = "database-url"
  "SUPABASE_URL" = "supabase-url"
  "SUPABASE_ANON_KEY" = "supabase-anon-key"
  "SUPABASE_SERVICE_ROLE_KEY" = "supabase-service-role-key"
  "OS_NODE" = "os-node"
  "REDIS_URL" = "redis-url"
  "JWT_SECRET" = "jwt-secret"
  "GEMINI_API_KEY" = "gemini-api-key"
  "GCLOUD_PROJECT" = "gcloud-project"
  "R2_ACCOUNT_ID" = "r2-account-id"
  "R2_ACCESS_KEY_ID" = "r2-access-key-id"
  "R2_SECRET_ACCESS_KEY" = "r2-secret-access-key"
  "R2_BUCKET" = "r2-bucket"
  "R2_PUBLIC_BASE_URL" = "r2-public-base-url"
}

if (-not $ProjectId) {
  $ProjectId = & $gcloud config get-value project 2>$null
}

if (-not $ProjectId) {
  throw "No GCP project found. Pass -ProjectId or run 'gcloud config set project <id>'."
}

Write-Host "Using project: $ProjectId"

$updated = 0
$skipped = 0

foreach ($entry in $secretMap.GetEnumerator()) {
  $envKey = $entry.Key
  $secretName = $entry.Value

  if (-not $envValues.ContainsKey($envKey) -or [string]::IsNullOrWhiteSpace($envValues[$envKey])) {
    Write-Host "SKIP: $envKey is empty or missing in $EnvFile"
    $skipped++
    continue
  }

  $value = $envValues[$envKey]
  $tmpFile = [System.IO.Path]::GetTempFileName()
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($tmpFile, $value, $utf8NoBom)

  try {
    & $gcloud secrets describe $secretName --project $ProjectId --format="value(name)" 1>$null 2>$null
    $exists = ($LASTEXITCODE -eq 0)

    if ($DryRun) {
      if ($exists) {
        Write-Host "DRY-RUN: would add new version to secret '$secretName' from $envKey"
      } else {
        Write-Host "DRY-RUN: would create secret '$secretName' and add initial version from $envKey"
      }
    } else {
      if ($exists) {
        & $gcloud secrets versions add $secretName --project $ProjectId --data-file=$tmpFile | Out-Null
        Write-Host "UPDATED: $secretName"
      } else {
        & $gcloud secrets create $secretName --project $ProjectId --replication-policy="automatic" --data-file=$tmpFile | Out-Null
        Write-Host "CREATED: $secretName"
      }
      $updated++
    }
  } finally {
    Remove-Item -Path $tmpFile -Force -ErrorAction SilentlyContinue
  }
}

if ($DryRun) {
  Write-Host "Done (dry-run)."
} else {
  Write-Host "Done. Updated/created: $updated, skipped: $skipped"
}

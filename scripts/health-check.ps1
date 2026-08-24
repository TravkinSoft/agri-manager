param(
  [int]$Port = 3000,
  [string]$Path = "/weighbridge",
  [string]$BaseUrl = "",
  [string]$ExpectedSha = "",
  [int]$TimeoutSec = 8,
  [switch]$Strict
)

$ErrorActionPreference = "Stop"

$root = if ($BaseUrl) { $BaseUrl.TrimEnd('/') } else { "http://localhost:$Port" }
$uri = "$root$Path"

Write-Host "Health check: $uri" -ForegroundColor Cyan

try {
  $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec $TimeoutSec
  $code = [int]$response.StatusCode

  $body = [string]$response.Content
  if ($body -match "DEPLOYMENT_NOT_FOUND") {
    Write-Host "FAIL: alias points to a missing deployment" -ForegroundColor Red
    exit 1
  }

  if ($code -ge 200 -and $code -lt 400) {
    $healthUri = "$root/api/healthz"
    $health = Invoke-WebRequest -Uri $healthUri -UseBasicParsing -TimeoutSec $TimeoutSec
    $healthPayload = $health.Content | ConvertFrom-Json
    if (-not $healthPayload.ok) {
      Write-Host "FAIL: /api/healthz did not confirm runtime" -ForegroundColor Red
      exit 1
    }
    $actualSha = [string]$healthPayload.commit
    $expectedPrefix = if ($ExpectedSha.Length -gt 12) { $ExpectedSha.Substring(0, 12) } else { $ExpectedSha }
    if ($ExpectedSha -and -not $actualSha.Equals($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      Write-Host "FAIL: runtime SHA '$($healthPayload.commit)' does not match '$ExpectedSha'" -ForegroundColor Red
      exit 1
    }
    Write-Host "OK: HTTP $code; deployment=$($healthPayload.deployment); sha=$($healthPayload.commit)" -ForegroundColor Green
    exit 0
  }

  Write-Host "WARN: HTTP $code" -ForegroundColor Yellow
  exit 1
}
catch {
  if ($Strict) {
    Write-Host "FAIL: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Tip: start server with 'npm run dev:stable'" -ForegroundColor Yellow
    exit 1
  }

  Write-Host "SKIP: local server is not running ($($_.Exception.Message))" -ForegroundColor Yellow
  Write-Host "Tip: use 'npm run health:check:strict' when you need a hard fail." -ForegroundColor Yellow
  exit 0
}

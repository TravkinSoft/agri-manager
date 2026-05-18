param(
  [int]$Port = 3000,
  [string]$Path = "/weighbridge",
  [int]$TimeoutSec = 8
)

$ErrorActionPreference = "Stop"

$uri = "http://localhost:$Port$Path"

Write-Host "Health check: $uri" -ForegroundColor Cyan

try {
  $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec $TimeoutSec
  $code = [int]$response.StatusCode

  if ($code -ge 200 -and $code -lt 400) {
    Write-Host "OK: HTTP $code" -ForegroundColor Green
    exit 0
  }

  Write-Host "WARN: HTTP $code" -ForegroundColor Yellow
  exit 1
}
catch {
  Write-Host "FAIL: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Tip: start server with 'npm run dev:stable'" -ForegroundColor Yellow
  exit 1
}

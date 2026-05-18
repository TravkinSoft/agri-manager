param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

Write-Host "Starting AgriManager dev server..." -ForegroundColor Cyan
Write-Host "Port: $Port" -ForegroundColor Gray

$env:NEXT_DISABLE_SWC_WORKER = "1"

Write-Host "NEXT_DISABLE_SWC_WORKER=1" -ForegroundColor Gray
Write-Host "Run health check in another terminal: npm run health:check" -ForegroundColor Gray
Write-Host ""

npm run dev -- -p $Port

param(
  [switch]$WithOpenAI,
  [switch]$Detached,
  [ValidateSet("preflight", "owner")][string]$Mode = "preflight"
)

$ErrorActionPreference = "Stop"
$workspace = [System.IO.Path]::GetFullPath((Get-Location).Path)
$expectedWorkspace = "C:\Users\TRAVKIN\Downloads\CodecSaaS\project-assistant-v1"
if (-not $workspace.Equals($expectedWorkspace, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Unexpected workspace"
}

function Get-SelectedEnvValue {
  param([string]$Path, [string]$Name)
  foreach ($line in [System.IO.File]::ReadLines($Path)) {
    $pattern = "^\s*" + [regex]::Escape($Name) + "\s*=\s*(.*)$"
    if ($line -match $pattern) {
      $value = $Matches[1].Trim()
      if (
        ($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))
      ) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      return $value
    }
  }
  return $null
}

$branchRef = "gsglkmudcwkdetqtocae"
$allowedHostname = "gsglkmudcwkdetqtocae.supabase.co"
$productionRef = "bhsemlvmkikpntabctml"
$envLocalPath = Join-Path $workspace ".env.local"
$branchUrl = Get-SelectedEnvValue -Path $envLocalPath -Name "A106_SUPABASE_URL"
$branchAnonKey = Get-SelectedEnvValue -Path $envLocalPath -Name "A106_SUPABASE_ANON_KEY"
if ([string]::IsNullOrWhiteSpace($branchUrl) -or [string]::IsNullOrWhiteSpace($branchAnonKey)) {
  throw "Branch public credentials are missing"
}
$branchUri = [Uri]$branchUrl
if ($branchUri.Scheme -ne "https" -or $branchUri.Host -ne $allowedHostname) {
  throw "Branch URL is not allowed"
}

$buildOutput = Join-Path $workspace ".next"
if (-not (Test-Path -LiteralPath $buildOutput -PathType Container)) {
  throw "Safe build is missing"
}
$productionRefMatches = @(& rg.exe -l --hidden --fixed-strings $productionRef $buildOutput 2>$null).Count
$productionUrlMatches = @(& rg.exe -l --hidden --fixed-strings "$productionRef.supabase.co" $buildOutput 2>$null).Count
$branchRefMatches = @(& rg.exe -l --hidden --fixed-strings $branchRef $buildOutput 2>$null).Count
$branchUrlMatches = @(& rg.exe -l --hidden --fixed-strings $allowedHostname $buildOutput 2>$null).Count
if ($productionRefMatches -ne 0 -or $productionUrlMatches -ne 0 -or $branchRefMatches -eq 0 -or $branchUrlMatches -eq 0) {
  throw "Bundle deny scan failed"
}

$openAiKey = $null
if ($WithOpenAI) {
  $openAiKey = Get-SelectedEnvValue -Path (Join-Path $workspace ".env") -Name "OPENAI_API_KEY"
  if ([string]::IsNullOrWhiteSpace($openAiKey)) {
    throw "OPENAI_API_KEY is missing"
  }
}

$runtimeContext = [System.IO.Path]::GetFullPath((Join-Path $workspace ".a107-runtime-$Mode"))
$workspacePrefix = $workspace.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $runtimeContext.StartsWith($workspacePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe runtime context"
}
if (Test-Path -LiteralPath $runtimeContext) {
  throw "Runtime context already exists: stop and clean it first"
}
[System.IO.Directory]::CreateDirectory($runtimeContext) | Out-Null
New-Item -ItemType Junction -Path (Join-Path $runtimeContext ".next") -Target $buildOutput | Out-Null
New-Item -ItemType Junction -Path (Join-Path $runtimeContext "public") -Target (Join-Path $workspace "public") | Out-Null
[System.IO.File]::Copy((Join-Path $workspace "package.json"), (Join-Path $runtimeContext "package.json"), $true)
[System.IO.File]::Copy((Join-Path $workspace "next.config.js"), (Join-Path $runtimeContext "next.config.js"), $true)

$dotenvCount = @(Get-ChildItem -LiteralPath $runtimeContext -Force -File -Filter ".env*").Count
if ($dotenvCount -ne 0) {
  throw "Dotenv file exists in runtime context"
}

$keepNames = @(
  "Path", "SystemRoot", "TEMP", "TMP", "ComSpec", "PATHEXT", "APPDATA",
  "LOCALAPPDATA", "USERPROFILE", "ProgramFiles", "ProgramFiles(x86)",
  "ProgramData", "HOMEDRIVE", "HOMEPATH", "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE", "OS", "windir"
)
$keptEnvironment = @{}
foreach ($name in $keepNames) {
  $value = [Environment]::GetEnvironmentVariable($name, "Process")
  if ($null -ne $value) { $keptEnvironment[$name] = $value }
}
Get-ChildItem Env: | ForEach-Object {
  [Environment]::SetEnvironmentVariable($_.Name, $null, "Process")
}
foreach ($entry in $keptEnvironment.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, "Process")
}

$env:NEXT_PUBLIC_SUPABASE_URL = $branchUrl
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $branchAnonKey
$env:SUPABASE_URL = $branchUrl
$env:SUPABASE_ANON_KEY = $branchAnonKey
$env:A107_BRANCH_REF = $branchRef
$env:A106_BRANCH_REF = $branchRef
$env:A106_LOCAL_RUNTIME = "1"
$env:ASSISTANT_ACCESS_STRICT = "1"
$env:ASSISTANT_RUNTIME_MODE = "responses_v2"
$env:ASSISTANT_LOCAL_QA_MODEL_OVERRIDE = "gpt-5.6-terra"
$env:OPENAI_ASSISTANT_MODEL = "gpt-5.6-terra"
$env:REASONING_EFFORT = "medium"
$env:ASSISTANT_RESPONSES_STORE = "false"
$env:ASSISTANT_MEMORY_V2_ENABLED = "1"
$env:ASSISTANT_MEMORY_V1_ENABLED = "1"
$env:NEXT_PUBLIC_ASSISTANT_DEBUG = "1"
$env:ASSISTANT_DEBUG = "1"
$env:NODE_ENV = "production"
$env:NEXT_TELEMETRY_DISABLED = "1"
if ($WithOpenAI) { $env:OPENAI_API_KEY = $openAiKey }

$forbiddenNames = @(
  "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_ADMIN_KEY",
  "SUPABASE_ADMIN_TOKEN", "SUPABASE_ACCESS_TOKEN", "SUPABASE_MANAGEMENT_API_TOKEN",
  "SUPABASE_DB_URL", "DATABASE_URL", "DIRECT_URL", "POSTGRES_URL",
  "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING", "PGHOST", "PGUSER",
  "PGPASSWORD", "PGDATABASE"
)
$forbiddenPresent = @($forbiddenNames | Where-Object {
  -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_, "Process"))
})
if ($forbiddenPresent.Count -ne 0) {
  throw "Forbidden runtime credential is loaded"
}

Write-Output "RUNTIME_CONTEXT_DOTENV_COUNT=$dotenvCount"
Write-Output "RUNTIME_ALLOWED_HOSTNAME=$allowedHostname"
Write-Output "PRODUCTION_REF_IN_BUNDLE=$productionRefMatches"
Write-Output "PRODUCTION_URL_IN_BUNDLE=$productionUrlMatches"
Write-Output "SERVICE_ROLE_LOADED=NO"
Write-Output "DATABASE_CREDENTIALS_LOADED=NO"
Write-Output ("OPENAI_KEY_PRESENT=" + $(if ($WithOpenAI) { "YES" } else { "NO" }))

$nextCommand = Join-Path $workspace "node_modules\.bin\next.cmd"
if (-not $Detached) {
  & $nextCommand start $runtimeContext -p 3106 -H 127.0.0.1
  exit $LASTEXITCODE
}

$auditDirectory = Join-Path $workspace "audit-output\TZ-A107"
[System.IO.Directory]::CreateDirectory($auditDirectory) | Out-Null
$stdoutPath = Join-Path $auditDirectory "owner-runtime.stdout.log"
$stderrPath = Join-Path $auditDirectory "owner-runtime.stderr.log"
$runtimeProcess = Start-Process `
  -FilePath $nextCommand `
  -ArgumentList @("start", $runtimeContext, "-p", "3106", "-H", "127.0.0.1") `
  -WorkingDirectory $workspace `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

$ready = $false
for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
  if ($runtimeProcess.HasExited) {
    throw "Detached runtime exited before readiness"
  }
  $listener = Get-NetTCPConnection -LocalPort 3106 -State Listen -ErrorAction SilentlyContinue
  if ($null -ne $listener) {
    $ready = $true
    break
  }
  Start-Sleep -Milliseconds 250
}
if (-not $ready) {
  Stop-Process -Id $runtimeProcess.Id -Force -ErrorAction SilentlyContinue
  throw "Detached runtime did not start on port 3106"
}

Write-Output "LOCAL_SERVER_STATUS=RUNNING"
Write-Output "LOCAL_SERVER_PORT=3106"
Write-Output "LOCAL_SERVER_PROCESS_ID=$($runtimeProcess.Id)"

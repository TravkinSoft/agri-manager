$ErrorActionPreference = "Stop"

$workspace = [System.IO.Path]::GetFullPath((Get-Location).Path)
$expectedWorkspace = "C:\Users\TRAVKIN\Downloads\CodecSaaS\project-assistant-v1"
if (-not $workspace.Equals($expectedWorkspace, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Unexpected workspace"
}

function Get-SelectedEnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )

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

function Assert-ChildPath {
  param(
    [Parameter(Mandatory = $true)][string]$Parent,
    [Parameter(Mandatory = $true)][string]$Child
  )

  $parentPrefix = $Parent.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $Child.StartsWith($parentPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe child path"
  }
}

$envLocalPath = Join-Path $workspace ".env.local"
if (-not (Test-Path -LiteralPath $envLocalPath -PathType Leaf)) {
  throw ".env.local is missing"
}

$branchUrl = Get-SelectedEnvValue -Path $envLocalPath -Name "A106_SUPABASE_URL"
$branchAnonKey = Get-SelectedEnvValue -Path $envLocalPath -Name "A106_SUPABASE_ANON_KEY"
if ([string]::IsNullOrWhiteSpace($branchUrl) -or [string]::IsNullOrWhiteSpace($branchAnonKey)) {
  throw "Branch URL or anon key is missing"
}

$branchRef = "gsglkmudcwkdetqtocae"
$productionRef = "bhsemlvmkikpntabctml"
$branchUri = [Uri]$branchUrl
if ($branchUri.Scheme -ne "https" -or $branchUri.Host -ne "$branchRef.supabase.co") {
  throw "Branch URL validation failed"
}

$buildRoot = [System.IO.Path]::GetFullPath((Join-Path $workspace ".a107-build-context"))
$buildOutput = [System.IO.Path]::GetFullPath((Join-Path $buildRoot ".next"))
$workspaceOutput = [System.IO.Path]::GetFullPath((Join-Path $workspace ".next"))
Assert-ChildPath -Parent $workspace -Child $buildRoot
Assert-ChildPath -Parent $buildRoot -Child $buildOutput
Assert-ChildPath -Parent $workspace -Child $workspaceOutput

if (Test-Path -LiteralPath $buildRoot) {
  [System.IO.Directory]::Delete($buildRoot, $true)
}
[System.IO.Directory]::CreateDirectory($buildRoot) | Out-Null

$sourceFiles = & git.exe ls-files -co --exclude-standard
if ($LASTEXITCODE -ne 0) {
  throw "Unable to enumerate source files"
}

foreach ($relativePath in $sourceFiles) {
  $normalized = $relativePath.Replace("\", "/")
  if (
    $normalized -eq ".env" -or
    $normalized.StartsWith(".env.") -or
    $normalized.StartsWith("audit-output/") -or
    $normalized.StartsWith(".next/") -or
    $normalized.StartsWith(".a107-build-context/")
  ) {
    continue
  }

  $source = [System.IO.Path]::GetFullPath((Join-Path $workspace $relativePath))
  $destination = [System.IO.Path]::GetFullPath((Join-Path $buildRoot $relativePath))
  Assert-ChildPath -Parent $workspace -Child $source
  Assert-ChildPath -Parent $buildRoot -Child $destination
  $destinationDirectory = [System.IO.Path]::GetDirectoryName($destination)
  [System.IO.Directory]::CreateDirectory($destinationDirectory) | Out-Null
  [System.IO.File]::Copy($source, $destination, $true)
}

$dotenvFilesCopied = @(Get-ChildItem -LiteralPath $buildRoot -Force -File -Filter ".env*").Count
if ($dotenvFilesCopied -ne 0) {
  throw "Dotenv file copied into safe build context"
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
  if ($null -ne $value) {
    $keptEnvironment[$name] = $value
  }
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
$env:NODE_ENV = "production"
$env:NEXT_TELEMETRY_DISABLED = "1"
$env:ASSISTANT_RUNTIME_MODE = "responses_v2"
$env:ASSISTANT_LOCAL_QA_MODEL_OVERRIDE = "gpt-5.6-terra"
$env:OPENAI_ASSISTANT_MODEL = "gpt-5.6-terra"
$env:REASONING_EFFORT = "medium"
$env:ASSISTANT_RESPONSES_STORE = "false"

$productionMatches = @(
  Get-ChildItem Env: | Where-Object { [string]$_.Value -like "*$productionRef*" }
).Count
$serviceRolePresent = -not [string]::IsNullOrWhiteSpace(
  [Environment]::GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY", "Process")
)
$databaseCredentialsPresent = @(
  "DATABASE_URL", "DIRECT_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING", "PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE"
) | Where-Object {
  -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_, "Process"))
}

Write-Output "DOTENV_FILES_IN_BUILD_CONTEXT=$dotenvFilesCopied"
Write-Output "BRANCH_BUILD_ENV_VALIDATED=YES"
Write-Output ("PRODUCTION_REF_PRESENT_IN_BUILD_PROCESS=" + $(if ($productionMatches -eq 0) { "NO" } else { "YES" }))
Write-Output ("SERVICE_ROLE_PRESENT_IN_BUILD_PROCESS=" + $(if ($serviceRolePresent) { "YES" } else { "NO" }))
Write-Output ("DATABASE_CREDENTIALS_PRESENT_IN_BUILD_PROCESS=" + $(if ($databaseCredentialsPresent.Count -gt 0) { "YES" } else { "NO" }))

if ($productionMatches -ne 0 -or $serviceRolePresent -or $databaseCredentialsPresent.Count -gt 0) {
  throw "Unsafe build environment"
}

$nextCommand = Join-Path $workspace "node_modules\.bin\next.cmd"
& $nextCommand build $buildRoot
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$productionRefFiles = @(& rg.exe -l --hidden --fixed-strings $productionRef $buildOutput 2>$null).Count
$productionUrlFiles = @(& rg.exe -l --hidden --fixed-strings "$productionRef.supabase.co" $buildOutput 2>$null).Count
$branchRefFiles = @(& rg.exe -l --hidden --fixed-strings $branchRef $buildOutput 2>$null).Count
$branchUrlFiles = @(& rg.exe -l --hidden --fixed-strings "$branchRef.supabase.co" $buildOutput 2>$null).Count

Write-Output "PRODUCTION_REF_FILE_MATCHES=$productionRefFiles"
Write-Output "PRODUCTION_URL_FILE_MATCHES=$productionUrlFiles"
Write-Output "BRANCH_REF_FILE_MATCHES=$branchRefFiles"
Write-Output "BRANCH_URL_FILE_MATCHES=$branchUrlFiles"
Write-Output "SERVICE_ROLE_SECRET_LOADED=NO"

if ($productionRefFiles -ne 0 -or $productionUrlFiles -ne 0 -or $branchRefFiles -eq 0 -or $branchUrlFiles -eq 0) {
  Write-Output "SAFE_BUILD=NO"
  exit 86
}

if (Test-Path -LiteralPath $workspaceOutput) {
  [System.IO.Directory]::Delete($workspaceOutput, $true)
}
[System.IO.Directory]::Move($buildOutput, $workspaceOutput)
[System.IO.Directory]::Delete($buildRoot, $true)
Write-Output "SAFE_BUILD=YES"
Write-Output "A107_BUILD_CONTEXT_CLEANED=YES"

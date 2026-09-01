[CmdletBinding()]
param(
    [string]$KeystorePath = 'C:\Users\TRAVKIN\Documents\TravkinFlow Secure\Google Play\travkinflow-upload.jks'
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundlePath = Join-Path $projectDirectory 'app\build\outputs\bundle\release\app-release.aab'
$generatedBuildConfig = Join-Path $projectDirectory 'app\build\generated\source\buildConfig\release\com\travkin\flow\BuildConfig.java'

$bundledJdk = Join-Path $env:USERPROFILE '.bubblewrap\jdk\jdk-17.0.11+9'
$bundledAndroidSdk = Join-Path $env:USERPROFILE '.bubblewrap\android_sdk'
if ([string]::IsNullOrWhiteSpace($env:JAVA_HOME) -and (Test-Path -LiteralPath $bundledJdk -PathType Container)) {
    $env:JAVA_HOME = $bundledJdk
}
if ([string]::IsNullOrWhiteSpace($env:ANDROID_HOME) -and (Test-Path -LiteralPath $bundledAndroidSdk -PathType Container)) {
    $env:ANDROID_HOME = $bundledAndroidSdk
}
if ([string]::IsNullOrWhiteSpace($env:ANDROID_SDK_ROOT)) {
    $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
}

if ([string]::IsNullOrWhiteSpace($env:JAVA_HOME) -or -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe') -PathType Leaf)) {
    throw 'JDK 17 не найден. Задайте JAVA_HOME в текущем терминале.'
}
if ([string]::IsNullOrWhiteSpace($env:ANDROID_HOME) -or -not (Test-Path -LiteralPath $env:ANDROID_HOME -PathType Container)) {
    throw 'Android SDK не найден. Задайте ANDROID_HOME в текущем терминале.'
}

function ConvertTo-PlainText {
    param([Security.SecureString]$SecureValue)

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

if (-not (Test-Path -LiteralPath $KeystorePath -PathType Leaf)) {
    throw "Upload keystore не найден: $KeystorePath"
}

if ([string]::IsNullOrWhiteSpace($env:TRAVKINFLOW_SUPABASE_URL)) {
    throw 'Перед запуском задайте TRAVKINFLOW_SUPABASE_URL только в текущем терминале.'
}

$supabaseUri = $null
if (-not [Uri]::TryCreate($env:TRAVKINFLOW_SUPABASE_URL, [UriKind]::Absolute, [ref]$supabaseUri) -or
    $supabaseUri.Scheme -ne 'https' -or
    $supabaseUri.AbsolutePath -ne '/' -or
    -not [string]::IsNullOrEmpty($supabaseUri.Query) -or
    -not [string]::IsNullOrEmpty($supabaseUri.Fragment) -or
    -not [string]::IsNullOrEmpty($supabaseUri.UserInfo)) {
    throw 'TRAVKINFLOW_SUPABASE_URL должен быть корневым HTTPS URL без credentials, query или fragment.'
}

if ([string]::IsNullOrWhiteSpace($env:TRAVKINFLOW_SUPABASE_ANON_KEY)) {
    throw 'Перед запуском задайте TRAVKINFLOW_SUPABASE_ANON_KEY только в текущем терминале.'
}

$keyAlias = $env:TRAVKINFLOW_UPLOAD_KEY_ALIAS
if ([string]::IsNullOrWhiteSpace($keyAlias)) {
    $keyAlias = Read-Host 'Введите alias upload key [travkinflow-upload]'
    if ([string]::IsNullOrWhiteSpace($keyAlias)) {
        $keyAlias = 'travkinflow-upload'
    }
}
if ([string]::IsNullOrWhiteSpace($keyAlias)) {
    throw 'Alias upload key не может быть пустым.'
}

$storePassword = $null
$keyPassword = $null

try {
    $storePassword = ConvertTo-PlainText (Read-Host 'Введите пароль keystore' -AsSecureString)
    $keyPassword = ConvertTo-PlainText (Read-Host 'Введите пароль upload key' -AsSecureString)
    if ([string]::IsNullOrWhiteSpace($storePassword) -or [string]::IsNullOrWhiteSpace($keyPassword)) {
        throw 'Пароли keystore/upload key не могут быть пустыми.'
    }

    $env:TRAVKINFLOW_UPLOAD_KEYSTORE = $KeystorePath
    $env:TRAVKINFLOW_UPLOAD_KEY_ALIAS = $keyAlias
    $env:TRAVKINFLOW_UPLOAD_STORE_PASSWORD = $storePassword
    $env:TRAVKINFLOW_UPLOAD_KEY_PASSWORD = $keyPassword
    $env:TRAVKINFLOW_QA_WEIGHBRIDGE_WRITES = 'false'

    Push-Location $projectDirectory
    try {
        & .\gradlew.bat bundleRelease --no-daemon
        if ($LASTEXITCODE -ne 0) {
            throw "Gradle bundleRelease завершился с кодом $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }

    if (-not (Test-Path -LiteralPath $bundlePath -PathType Leaf)) {
        throw "Release AAB не создан: $bundlePath"
    }

    if (-not (Test-Path -LiteralPath $generatedBuildConfig -PathType Leaf) -or
        -not (Select-String -LiteralPath $generatedBuildConfig -SimpleMatch 'WEIGHBRIDGE_WRITE_ENABLED = false' -Quiet)) {
        throw 'Release BuildConfig не подтвердил WEIGHBRIDGE_WRITE_ENABLED=false.'
    }

    $jarsigner = Join-Path $env:JAVA_HOME 'bin\jarsigner.exe'
    $signatureCheck = & $jarsigner -verify -strict $bundlePath 2>&1
    if ($LASTEXITCODE -ne 0 -or $signatureCheck -match 'jar is unsigned') {
        throw 'Release AAB не прошёл проверку upload-подписи.'
    }

    $bundle = Get-Item -LiteralPath $bundlePath
    $hash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256
    Write-Output 'Upload-подпись AAB проверена.'
    Write-Output "Release AAB готов: $($bundle.FullName)"
    Write-Output "Размер: $($bundle.Length) bytes"
    Write-Output "SHA-256: $($hash.Hash)"
}
finally {
    $storePassword = $null
    $keyPassword = $null
    Remove-Item Env:TRAVKINFLOW_UPLOAD_KEYSTORE -ErrorAction SilentlyContinue
    Remove-Item Env:TRAVKINFLOW_UPLOAD_KEY_ALIAS -ErrorAction SilentlyContinue
    Remove-Item Env:TRAVKINFLOW_UPLOAD_STORE_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:TRAVKINFLOW_UPLOAD_KEY_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:TRAVKINFLOW_QA_WEIGHBRIDGE_WRITES -ErrorAction SilentlyContinue
}

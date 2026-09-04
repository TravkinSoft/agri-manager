[CmdletBinding()]
param(
    [string]$KeystorePath = 'C:\Users\TRAVKIN\Documents\TravkinFlow Secure\Google Play\travkinflow-upload-reset-20260902.jks',
    [string]$PasswordVaultPath = 'C:\Users\TRAVKIN\Documents\TravkinFlow Secure\Google Play\travkinflow-upload-reset-20260902.password.clixml'
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$readinessPath = Join-Path (Split-Path -Parent $projectDirectory) 'docs\google-play\agronomist-release-readiness.json'
if (-not (Test-Path -LiteralPath $readinessPath -PathType Leaf)) { throw 'Full Agronomist acceptance manifest is missing. Play signing is blocked.' }
$readiness = Get-Content -LiteralPath $readinessPath -Raw | ConvertFrom-Json
if ($readiness.readyForInternalTest -ne $true -or $readiness.deviceAcceptance -ne $true -or $readiness.roleRealisticQa -ne $true) {
    throw 'Full Agronomist cabinet has not passed acceptance. Do not sign or upload the previous minimal AAB. Signing keys have not been opened.'
}
$bundlePath = Join-Path $projectDirectory 'app\build\outputs\bundle\release\app-release.aab'
$generatedBuildConfig = Join-Path $projectDirectory 'app\build\generated\source\buildConfig\release\com\travkin\flow\BuildConfig.java'
$expectedRepositoryRoot = 'C:\Users\TRAVKIN\Downloads\CodecSaaS\project-google-market-native-v1'
$expectedProjectDirectory = Join-Path $expectedRepositoryRoot 'android'
$legacyProjectDirectory = 'C:\Users\TRAVKIN\Downloads\CodecSaaS\project-google-market\android'
$expectedBranch = 'codex/google-market-native-v1'
$nativeReleaseBaseline = '909bd1eed3c367f0fcca68c2d765ef567d09e300'
$expectedPackage = 'com.travkin.flow'
$expectedVersionCode = 3
$expectedVersionName = '3.0.0'
$expectedTargetSdk = 36
$expectedKeyAlias = 'travkinflow-upload'
$expectedUploadFingerprint = '8B:29:80:B8:07:E2:99:1F:A5:54:C2:B6:61:7D:89:9F:9F:58:AA:EC:2D:77:DE:37:12:A3:89:70:38:C5:A3:CB'

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

function Get-GitText {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $result = & git -C $projectDirectory @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Git preflight failed: git $($Arguments -join ' ')"
    }
    ($result | Out-String).Trim()
}

function Assert-NativeReleaseSource {
    $actualProjectDirectory = [IO.Path]::GetFullPath($projectDirectory).TrimEnd('\')
    $requiredProjectDirectory = [IO.Path]::GetFullPath($expectedProjectDirectory).TrimEnd('\')
    $rejectedLegacyDirectory = [IO.Path]::GetFullPath($legacyProjectDirectory).TrimEnd('\')

    if ($actualProjectDirectory -ieq $rejectedLegacyDirectory) {
        throw 'Legacy TWA source project-google-market\android is forbidden for Play V3 signing.'
    }
    if ($actualProjectDirectory -ine $requiredProjectDirectory) {
        throw "Play V3 signing is allowed only from: $requiredProjectDirectory"
    }

    $repositoryRoot = [IO.Path]::GetFullPath((Get-GitText @('rev-parse', '--show-toplevel'))).TrimEnd('\')
    if ($repositoryRoot -ine [IO.Path]::GetFullPath($expectedRepositoryRoot).TrimEnd('\')) {
        throw "Unexpected Git worktree: $repositoryRoot"
    }

    $branch = Get-GitText @('branch', '--show-current')
    if ($branch -cne $expectedBranch) {
        throw "Unexpected Git branch: $branch. Required: $expectedBranch"
    }

    $head = Get-GitText @('rev-parse', 'HEAD')
    & git -C $projectDirectory merge-base --is-ancestor $nativeReleaseBaseline $head
    if ($LASTEXITCODE -ne 0) {
        throw "HEAD $head is not in the approved native release family rooted at $nativeReleaseBaseline."
    }

    $status = Get-GitText @('status', '--porcelain=v1', '--untracked-files=all')
    if (-not [string]::IsNullOrWhiteSpace($status)) {
        throw 'Git worktree is not clean. Commit or remove every change before Play signing.'
    }

    $buildGradle = Get-Content -LiteralPath (Join-Path $projectDirectory 'app\build.gradle') -Raw
    $requiredBuildValues = @(
        "applicationId `"$expectedPackage`"",
        "versionCode $expectedVersionCode",
        "versionName `"$expectedVersionName`"",
        "targetSdk $expectedTargetSdk"
    )
    foreach ($requiredValue in $requiredBuildValues) {
        if (-not $buildGradle.Contains($requiredValue)) {
            throw "Native release build.gradle failed required invariant: $requiredValue"
        }
    }

    $runtimeSourceRoot = Join-Path $projectDirectory 'app\src\main'
    $runtimeFiles = Get-ChildItem -LiteralPath $runtimeSourceRoot -Recurse -File |
        Where-Object { $_.Extension -in @('.kt', '.java', '.xml') }
    $forbiddenRuntimePatterns = @(
        'android\.webkit',
        '\bWebView\b',
        '\bloadUrl\s*\(',
        'TrustedWebActivity',
        'androidx\.browser',
        'androidbrowserhelper',
        '\bbubblewrap\b',
        '\bCustomTabs?\b',
        '\bweighman\b',
        '\bcopilot\b',
        'api/assistant',
        'api/traffic/operator',
        'api/traffic/session'
    )
    if (@($runtimeFiles | Select-String -Pattern $forbiddenRuntimePatterns).Count -gt 0) {
        throw 'Forbidden mobile runtime or out-of-scope feature detected in app/src/main.'
    }

    Push-Location $projectDirectory
    try {
        $dependencyReport = & .\gradlew.bat :app:dependencies --configuration releaseRuntimeClasspath --no-daemon --console=plain 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw 'Unable to resolve releaseRuntimeClasspath for native-runtime verification.'
        }
    }
    finally {
        Pop-Location
    }
    if (($dependencyReport | Out-String) -match '(?i)androidx\.browser|androidx\.webkit|androidbrowserhelper|trustedwebactivity|bubblewrap|customtabs') {
        throw 'Forbidden WebView/TWA/custom-tabs dependency detected in releaseRuntimeClasspath.'
    }

    Write-Output "Native release source verified: $branch @ $head"
    Write-Output 'Forbidden mobile runtime, feature, and dependency matches: 0'
}

function Assert-UploadCertificate {
    param(
        [Parameter(Mandatory)][string]$Keytool,
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Alias
    )

    $certificateDetails = & $Keytool -list -v -keystore $Path -alias $Alias '-storepass:env' TRAVKINFLOW_UPLOAD_STORE_PASSWORD 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw 'Upload keystore could not be opened with the supplied password and alias.'
    }
    $fingerprintMatch = [regex]::Match(
        ($certificateDetails | Out-String),
        '(?im)^\s*SHA256:\s*([0-9A-F:]{95})\s*$'
    )
    if (-not $fingerprintMatch.Success -or $fingerprintMatch.Groups[1].Value -cne $expectedUploadFingerprint) {
        throw 'Upload certificate SHA-256 does not match the Google Play Upload key. Do not sign or upload.'
    }
}

function Assert-BundletoolValid {
    param([Parameter(Mandatory)][string]$Path)

    $gradleCache = Join-Path $env:USERPROFILE '.gradle\caches\modules-2\files-2.1'
    $bundletoolArtifacts = @(
        'com.android.tools.build\bundletool',
        'com.android.tools.build\aapt2-proto',
        'com.google.auto.value\auto-value-annotations',
        'com.google.errorprone\error_prone_annotations',
        'com.google.guava\guava',
        'com.google.guava\failureaccess',
        'com.google.guava\listenablefuture',
        'com.google.protobuf\protobuf-java',
        'com.google.protobuf\protobuf-java-util',
        'com.google.dagger\dagger',
        'javax.inject\javax.inject',
        'org.bitbucket.b_c\jose4j',
        'org.slf4j\slf4j-api',
        'com.google.code.gson\gson',
        'org.checkerframework\checker-qual',
        'com.google.j2objc\j2objc-annotations',
        'com.google.code.findbugs\jsr305'
    )
    $bundletoolClasspath = foreach ($artifact in $bundletoolArtifacts) {
        $artifactRoot = Join-Path $gradleCache $artifact
        if (Test-Path -LiteralPath $artifactRoot -PathType Container) {
            Get-ChildItem -LiteralPath $artifactRoot -Recurse -File -Filter '*.jar' |
                Select-Object -ExpandProperty FullName
        }
    }
    if (-not ($bundletoolClasspath | Where-Object { $_ -match '\\bundletool-[^\\]+\.jar$' })) {
        throw 'bundletool library is not available in the local Gradle cache.'
    }

    $java = Join-Path $env:JAVA_HOME 'bin\java.exe'
    $bundletoolResult = & $java -cp ($bundletoolClasspath -join [IO.Path]::PathSeparator) `
        com.android.tools.build.bundletool.BundleToolMain validate "--bundle=$Path" 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw 'Release AAB failed bundletool validate.'
    }
}

if (-not (Test-Path -LiteralPath $KeystorePath -PathType Leaf)) {
    throw "Upload keystore не найден: $KeystorePath"
}

Assert-NativeReleaseSource

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

$keyAlias = $expectedKeyAlias
if (-not [string]::IsNullOrWhiteSpace($env:TRAVKINFLOW_UPLOAD_KEY_ALIAS) -and
    $env:TRAVKINFLOW_UPLOAD_KEY_ALIAS -cne $expectedKeyAlias) {
    throw "Upload key alias must be exactly $expectedKeyAlias."
}

$storePassword = $null
$keyPassword = $null

try {
    if (Test-Path -LiteralPath $PasswordVaultPath -PathType Leaf) {
        $storedCredential = Import-Clixml -LiteralPath $PasswordVaultPath
        if ($storedCredential -isnot [Management.Automation.PSCredential] -or
            $storedCredential.UserName -cne $expectedKeyAlias) {
            throw 'DPAPI password vault has an unexpected format or alias.'
        }
        $storePassword = ConvertTo-PlainText $storedCredential.Password
        $keyPassword = $storePassword
    }
    else {
        $storePassword = ConvertTo-PlainText (Read-Host 'Введите пароль keystore' -AsSecureString)
        $keyPassword = ConvertTo-PlainText (Read-Host 'Введите пароль upload key' -AsSecureString)
    }
    if ([string]::IsNullOrWhiteSpace($storePassword) -or [string]::IsNullOrWhiteSpace($keyPassword)) {
        throw 'Пароли keystore/upload key не могут быть пустыми.'
    }

    $env:TRAVKINFLOW_UPLOAD_KEYSTORE = $KeystorePath
    $env:TRAVKINFLOW_UPLOAD_KEY_ALIAS = $keyAlias
    $env:TRAVKINFLOW_UPLOAD_STORE_PASSWORD = $storePassword
    $env:TRAVKINFLOW_UPLOAD_KEY_PASSWORD = $keyPassword

    $keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
    Assert-UploadCertificate -Keytool $keytool -Path $KeystorePath -Alias $keyAlias

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

    if (-not (Test-Path -LiteralPath $generatedBuildConfig -PathType Leaf)) {
        throw 'Release BuildConfig не создан.'
    }

    Assert-BundletoolValid -Path $bundlePath

    $jarsigner = Join-Path $env:JAVA_HOME 'bin\jarsigner.exe'
    $signatureCheck = & $jarsigner -verify -verbose -certs $bundlePath 2>&1
    $jarsignerExitCode = $LASTEXITCODE
    $signatureText = $signatureCheck | Out-String
    $jarVerified = @($signatureCheck | ForEach-Object { "$_".Trim() }) -contains 'jar verified.'
    if ($jarsignerExitCode -ne 0 -or
        -not $jarVerified -or
        $signatureText -match '(?i)jar is unsigned|unsigned entry') {
        throw 'Release AAB не прошёл проверку upload-подписи.'
    }

    $signedCertificate = & $keytool -printcert -jarfile $bundlePath 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to read the release AAB signer certificate.'
    }
    $signedFingerprintMatch = [regex]::Match(
        ($signedCertificate | Out-String),
        '(?im)^\s*SHA256:\s*([0-9A-F:]{95})\s*$'
    )
    if (-not $signedFingerprintMatch.Success -or
        $signedFingerprintMatch.Groups[1].Value -cne $expectedUploadFingerprint) {
        throw 'Release AAB signer does not match the Google Play Upload key. Do not upload.'
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
}

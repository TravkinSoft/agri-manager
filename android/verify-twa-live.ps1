[CmdletBinding()]
param(
    [string]$Origin = 'https://travkinflow.com',
    [string]$ExpectedPackage = 'com.travkin.flow',
    [string]$ExpectedPlayFingerprint = '72:0D:D0:43:18:F8:A4:DC:38:CB:44:0E:53:E8:27:EE:B3:FA:EF:BF:3A:21:68:9E:D6:C9:A0:DB:A0:5E:3A:34'
)

$ErrorActionPreference = 'Stop'

function Get-ExactResponse {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$ExpectedContentType
    )

    $uri = [Uri]::new([Uri]$Origin, $Path)
    $response = Invoke-WebRequest -Uri $uri -MaximumRedirection 0 -SkipHttpErrorCheck
    if ($response.StatusCode -ne 200) {
        throw "$uri returned HTTP $($response.StatusCode), expected 200."
    }
    if ($response.BaseResponse.RequestMessage.RequestUri.AbsoluteUri -ne $uri.AbsoluteUri) {
        throw "$uri redirected to $($response.BaseResponse.RequestMessage.RequestUri)."
    }
    $contentType = [string]$response.Headers.'Content-Type'
    if (-not $contentType.StartsWith($ExpectedContentType, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$uri returned Content-Type '$contentType', expected '$ExpectedContentType'."
    }
    $response
}

function Get-ResponseText {
    param([Parameter(Mandatory)]$Response)

    if ($Response.Content -is [byte[]]) {
        return [Text.Encoding]::UTF8.GetString($Response.Content)
    }
    [string]$Response.Content
}

$manifestResponse = Get-ExactResponse -Path '/manifest.webmanifest' -ExpectedContentType 'application/manifest+json'
$manifest = (Get-ResponseText -Response $manifestResponse) | ConvertFrom-Json
if ($manifest.name -ne 'TravkinFlow' -or
    $manifest.start_url -ne '/dashboard' -or
    $manifest.scope -ne '/' -or
    $manifest.display -ne 'standalone') {
    throw 'Production web manifest identity/start_url/scope/display is not the approved TWA contract.'
}

$requiredIcons = @(
    '/brand/tilt45-v1/icons/icon-192-compact-v2.png',
    '/brand/tilt45-v1/icons/icon-512-compact-v2.png',
    '/brand/tilt45-v1/icons/maskable-192-compact-v2.png',
    '/brand/tilt45-v1/icons/maskable-512-compact-v2.png'
)
$manifestIconPaths = @($manifest.icons | ForEach-Object { [string]$_.src })
foreach ($iconPath in $requiredIcons) {
    if ($iconPath -notin $manifestIconPaths) {
        throw "Production manifest is missing required icon: $iconPath"
    }
    $null = Get-ExactResponse -Path $iconPath -ExpectedContentType 'image/png'
}

$serviceWorkerResponse = Get-ExactResponse -Path '/sw.js' -ExpectedContentType 'application/javascript'
$serviceWorker = Get-ResponseText -Response $serviceWorkerResponse
$requiredServiceWorkerGuards = @(
    'isApiRequest(request)',
    'isNextRuntimeAsset(request)',
    'isNextRscRequest(request)',
    'request.mode === "navigate"',
    'fetch(request).catch(() => offlinePageResponse())'
)
foreach ($guard in $requiredServiceWorkerGuards) {
    if (-not $serviceWorker.Contains($guard)) {
        throw "Production service worker is missing freshness guard: $guard"
    }
}

$assetLinksResponse = Get-ExactResponse -Path '/.well-known/assetlinks.json' -ExpectedContentType 'application/json'
$assetLinks = @((Get-ResponseText -Response $assetLinksResponse) | ConvertFrom-Json)
$approvedStatement = $assetLinks | Where-Object {
    $_.target.namespace -eq 'android_app' -and
    $_.target.package_name -eq $ExpectedPackage -and
    $ExpectedPlayFingerprint -in @($_.target.sha256_cert_fingerprints) -and
    'delegate_permission/common.handle_all_urls' -in @($_.relation)
} | Select-Object -First 1
if ($null -eq $approvedStatement) {
    throw 'Digital Asset Links does not contain the approved package and Play App Signing certificate.'
}

$dalQuery = 'https://digitalassetlinks.googleapis.com/v1/assetlinks:check' +
    '?source.web.site=' + [Uri]::EscapeDataString($Origin) +
    '&relation=' + [Uri]::EscapeDataString('delegate_permission/common.handle_all_urls') +
    '&target.android_app.package_name=' + [Uri]::EscapeDataString($ExpectedPackage) +
    '&target.android_app.certificate.sha256_fingerprint=' + [Uri]::EscapeDataString($ExpectedPlayFingerprint)
$dalResult = Invoke-RestMethod -Uri $dalQuery
if ($dalResult.linked -ne $true) {
    throw 'Google Digital Asset Links API does not confirm the website-to-app relationship.'
}

Write-Output 'Production TWA contract verified.'
Write-Output "Manifest: $($manifestResponse.BaseResponse.RequestMessage.RequestUri) -> 200, no redirect"
Write-Output "Service worker: $($serviceWorkerResponse.BaseResponse.RequestMessage.RequestUri) -> 200, network-first authenticated navigation/data"
Write-Output "Digital Asset Links: $($assetLinksResponse.BaseResponse.RequestMessage.RequestUri) -> 200, $ExpectedPackage + Play App Signing SHA-256"
Write-Output 'Google Digital Asset Links API: linked=true'

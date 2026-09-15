# TravkinFlow Google Play — official web-parity app

This Android project is the Google Play shell for the existing Play identity
`com.travkin.flow`. Version `4.0.0` (`versionCode 4`) launches the real
TravkinFlow product at `https://travkinflow.com/dashboard` as a Trusted Web
Activity (TWA).

The web application is the product and the source of truth. Android does not
reimplement roles, menus, forms, cards or business commands. The authenticated
server session determines every page and action available to the signed-in
user, exactly as it does in Chrome.

## Runtime behavior

- Verified Play installations run without a browser address bar because
  `travkinflow.com/.well-known/assetlinks.json` links the domain to
  `com.travkin.flow` and the Google Play App Signing certificate.
- Authentication and session persistence use the user's installed browser
  profile. No password, token or business record is copied into a second native
  database.
- Android Back, same-origin navigation, external links, file upload/download,
  camera/file chooser, web document preview/print and the website's web push
  behavior are supplied by the Android browser engine.
- Notifications are delegated through Android Browser Helper.
- Geolocation is delegated through the optional location-delegation service and
  still requires the normal Android/site permission.
- The fallback is a Custom Tab with a visible browser bar if the device has no
  compatible TWA provider or domain verification fails. A custom WebView is not
  used.

## Update model

Compatible website UI and API changes appear in the installed app on the next
network navigation/reload. Production HTML, Next.js runtime assets, RSC
responses and API data are network-first and are not persisted as stale
authenticated pages by the service worker.

A new signed AAB is still required for Android-wrapper changes such as package
metadata, permissions, icons, target SDK or native integration.

## Isolation

- Worktree: `project-google-market-twa-v4`
- Branch: `codex/google-market-twa-v4`
- Release package: `com.travkin.flow`
- Release URL: `https://travkinflow.com/dashboard`
- Debug package: `com.travkin.flow.qa`
- Debug URL: `https://qa.travkinflow.com/dashboard`

The existing versionCode 3 Internal Testing release remains untouched until the
versionCode 4 candidate is accepted by Google Play.

## Verification

Static and debug build:

```powershell
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
./gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Live Production PWA/Digital Asset Links verification:

```powershell
./verify-twa-live.ps1
```

Signed release (uses the existing external DPAPI password vault and upload
keystore; never stores a password in Git or Gradle properties):

```powershell
./build-play-bundle.ps1
```

Building is not device acceptance. Before Production rollout, install the
Play-delivered artifact and verify all required server roles, navigation,
documents, lifecycle and network-recovery scenarios without writing test data
to Production.

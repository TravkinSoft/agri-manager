# Google Play V4 — Production web-parity TWA

Date: 2026-09-16

## Goal

Replace the separately implemented six-cabinet Android UI with a Trusted Web
Activity over the current `https://travkinflow.com` product. Every existing
web page and action remains governed by the authenticated server role. Android
adds no role picker and does not change server authorization.

## Fixed identity

- Package: `com.travkin.flow`
- Version: `4.0.0`
- Version code: `4`
- Start URL: `https://travkinflow.com/dashboard`
- Full scope: `https://travkinflow.com/`
- Play App Signing SHA-256:
  `72:0D:D0:43:18:F8:A4:DC:38:CB:44:0E:53:E8:27:EE:B3:FA:EF:BF:3A:21:68:9E:D6:C9:A0:DB:A0:5E:3A:34`

## Release sequence

1. Verify Production manifest, service worker, icons and Digital Asset Links
   read-only.
2. Run unit contract tests, lint and debug assembly.
3. Build and validate a signed AAB with the existing external upload key.
4. Upload versionCode 4 to Internal Testing without deactivating versionCode 3.
5. Install the Play-delivered build and verify trusted fullscreen mode plus
   required role/lifecycle/network scenarios.
6. Submit the accepted build to Production. If Google blocks Production, retain
   the exact Console requirement and do not report the release as published.

Production business/database test writes are prohibited throughout this gate.

## Verified before signing

- Production manifest, service worker, all required icons and
  `/.well-known/assetlinks.json`: HTTP 200 without redirect.
- Google Digital Asset Links API: `linked=true`.
- Mobile Production audit at 412×915 for Agronomist routes: dashboard, crop
  structure, field map, warehouses, traffic, weather, settings, notifications
  and tickets; all routes remained authorized and horizontal overflow failures
  were zero.
- Android contract tests: 4 passed.
- `lintDebug`: 0 errors, 0 warnings.
- `assembleDebug`: passed.
- Production web source, database schema and business records changed by this
  branch: 0.

Play-delivered device acceptance and all-role QA remain separate gates and are
not implied by these static/mobile-browser checks.

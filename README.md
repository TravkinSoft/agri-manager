# TravkinFlow Android — cloud preparation candidate (TRA-11)

Root-history copy derived ONLY from the35 tracked android/ files at
c511f5a44cbc94fc5626813600f74e72374fe513. No website, inherited history,
credentials, business fixtures or CI workflows. source-manifest.json lists all
35 original Git blob IDs/SHA256 values and preparation-only deviations.

Target EXISTING repository: https://github.com/TravkinSoft/agri-manager.git
Branch: codex/tra11-cloud-android-20260930. Headquarters reviews and pushes;
no remote is configured automatically. Never merge this tree into the website.
vercel.json disables Git deployments and defines no crons.

## Linux source-contract checks

Provision official Linux JDK17 with a verified checksum. Set JAVA_HOME to that
isolated JDK directory, then run `bash scripts/contract-tests.sh`.
No Android SDK/license required. The script downloads pinned JUnit4.13.2 and
Hamcrest1.3 from Maven Central, checks pinned SHA256, then compiles/runs the four
original TwaContractTest methods. Source read-only; outputs in ignored .runtime/.
This does not prove Gradle build, Android lint, installation or device behavior.

## Exact debug recipe — SDK license blocker

Required: JDK17, Gradle8.11.1(wrapper), AGP8.9.1, SDK platform36/build-tools35.0.0.
Owner must first approve applicable Android SDK License Agreement(s); a separate
authorized setup must install Linux platform-tools, platforms;android-36 and
build-tools;35.0.0 at this copy's .runtime/sdk. No global install, automatic
license acceptance or copying another user's license files.

After approved setup: set JAVA_HOME, run `bash scripts/debug-build.sh`.
The script checks SDK files, isolates Gradle/Android caches, then runs exactly
testDebugUnitTest lintDebug assembleDebug. Only standard disposable debug signing
at .runtime/android/debug.keystore. Expected artifact:
android/app/build/outputs/apk/debug/app-debug.apk, package com.travkin.flow.qa.
Do not install/launch: QA backend isolation is not certified by this task.

Official signing discovery is removed from app/build.gradle, release variants
disabled, explicit release/publish/signingReport requests fail closed, and
build-play-bundle.ps1 immediately throws. No keys/vault paths retained there.
Identity/version and four original contract tests unchanged. Retained Production
URL literals are not authorization to call Production.

Full Gradle build/lint/APK, device acceptance, cloud workspace creation and clean
cloud rerun are separate gates. Local preparation does not update Google Play.

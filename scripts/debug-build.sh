#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
: "${JAVA_HOME:?Set JAVA_HOME to the isolated Linux JDK17}"
[[ "$("$JAVA_HOME/bin/java" -version 2>&1)" == *'version "17.'* ]] || exit 78
export PATH="$JAVA_HOME/bin:$PATH"
export GRADLE_USER_HOME="$ROOT/.runtime/gradle"
export ANDROID_USER_HOME="$ROOT/.runtime/android"
export ANDROID_HOME="$ROOT/.runtime/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
unset TRAVKINFLOW_UPLOAD_KEYSTORE TRAVKINFLOW_UPLOAD_KEY_ALIAS
unset TRAVKINFLOW_UPLOAD_STORE_PASSWORD TRAVKINFLOW_UPLOAD_KEY_PASSWORD
unset GRADLE_OPTS JAVA_OPTS JAVA_TOOL_OPTIONS JDK_JAVA_OPTIONS _JAVA_OPTIONS
if [[ ! -f "$ANDROID_HOME/platforms/android-36/android.jar" || ! -x "$ANDROID_HOME/build-tools/35.0.0/aapt2" ]]; then
  echo 'BLOCKED: SDK36/build-tools35.0.0 missing. Obtain owner license approval and isolated setup; this script never accepts licenses.'
  exit 78
fi
if [[ -f "$ROOT/android/local.properties" || -f "$ROOT/android/app/local.properties" ]]; then
  echo 'BLOCKED: local.properties forbidden in this preparation.'; exit 78
fi
mkdir -p "$GRADLE_USER_HOME" "$ANDROID_USER_HOME"
cd "$ROOT/android"
bash ./gradlew --no-daemon --console=plain testDebugUnitTest lintDebug assembleDebug

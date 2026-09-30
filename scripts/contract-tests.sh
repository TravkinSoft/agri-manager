#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
: "${JAVA_HOME:?Set JAVA_HOME to the isolated Linux JDK17}"
[[ "$("$JAVA_HOME/bin/java" -version 2>&1)" == *'version "17.'* ]] || { echo 'JDK17 required'; exit 78; }
DEPS="$ROOT/.runtime/contract/deps"
CLASSES="$ROOT/.runtime/contract/classes"
mkdir -p "$DEPS" "$CLASSES"
fetch() {
  local rel="$1" expected="$2" file="$DEPS/${1##*/}"
  if [[ ! -f "$file" ]]; then
    curl --fail --silent --show-error --location "https://repo.maven.apache.org/maven2/$rel" -o "$file"
  fi
  [[ "$(sha256sum "$file" | cut -d ' ' -f1)" == "$expected" ]] || { echo 'Dependency checksum mismatch'; exit 65; }
}
fetch junit/junit/4.13.2/junit-4.13.2.jar 8e495b634469d64fb8acfa3495a065cbacc8a0fff55ce1e31007be4c16dc57d3
fetch org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar 66fdef91e9739348df7a096aa384a5685f4e875584cce89386a7a47251c4d8e9
CP="$DEPS/junit-4.13.2.jar:$DEPS/hamcrest-core-1.3.jar"
APP="$ROOT/android/app"
"$JAVA_HOME/bin/javac" -cp "$CP" -d "$CLASSES" "$APP/src/test/java/com/travkin/flow/TwaContractTest.java"
cd "$APP"
"$JAVA_HOME/bin/java" -cp "$CLASSES:$CP" org.junit.runner.JUnitCore com.travkin.flow.TwaContractTest

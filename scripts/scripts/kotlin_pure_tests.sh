#!/usr/bin/env bash
# Compiles the Kotlin files that use no Android classes, plus every unit test that only needs them, with the Kotlin compiler
# that ships inside Gradle (no Android SDK, no network), then runs the tests with JUnit. It does NOT compile WebServer.kt,
# RootShell.kt and the other files that import android/org.json/NanoHTTPD: only "gradle :app:testDebugUnitTest" does.
# usage: scripts/kotlin_pure_tests.sh [GRADLE_LIB_DIR]   (default: the lib folder of the gradle on PATH)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
L="${1:-$(dirname "$(dirname "$(readlink -f "$(command -v gradle)")")")/lib}"
J() { ls "$L"/$1 | head -1; }
KC="$(J 'kotlin-compiler-embeddable-*.jar')"; STD="$(J 'kotlin-stdlib-[0-9]*.jar')"; JU="$(J 'junit-4*.jar')"; HC="$(J 'hamcrest-core-*.jar')"
CP="$KC:$STD:$(J 'kotlin-script-runtime-*.jar'):$(J 'kotlin-reflect-*.jar'):$(J 'trove4j-*.jar'):$(J 'kotlinx-coroutines-core-jvm-*.jar'):$(J 'annotations-*.jar'):$(J 'kotlin-daemon-embeddable-*.jar')"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
K() { java -cp "$CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect "$@" 2>&1 | grep -v '^Picked up' || true; }
printf 'package com.matchi.tool\ndata class ShellResult(val success: Boolean, val content: String)\n' > "$W/Stub.kt"
MAIN="$W/Stub.kt"
for f in "$ROOT"/app/src/main/java/com/matchi/tool/*.kt; do grep -qE '^import (android|org\.json|fi\.iki)|NanoHTTPD|org\.json\.[A-Z]|[^./A-Za-z]android\.(content|util|os|net|app|text|view|widget)\.' "$f" || MAIN="$MAIN $f"; done   # also catches fully qualified uses (org.json.JSONArray(...)) that have no import line
OUT="$(K -cp "$STD" -d "$W/main" $MAIN)"; [ -z "$OUT" ] || { echo "$OUT"; echo "main sources do not compile"; exit 1; }
TESTS=""; SKIPPED=""
for f in "$ROOT"/app/src/test/java/com/matchi/tool/*.kt; do
  if [ -z "$(K -Xfriend-paths="$W/main" -cp "$STD:$JU:$W/main" -d "$W/t1" "$f")" ]; then TESTS="$TESTS $f"; else SKIPPED="$SKIPPED $(basename "$f")"; fi
done
OUT="$(K -Xfriend-paths="$W/main" -cp "$STD:$JU:$W/main" -d "$W/test" $TESTS)"; [ -z "$OUT" ] || { echo "$OUT"; exit 1; }
CLS="$(cd "$W/test" && find . -name '*Test.class' | sed 's#^\./##; s#\.class$##; s#/#.#g' | tr '\n' ' ')"
echo "not compiled here (need Android classes):${SKIPPED:- none}"
java -cp "$W/test:$W/main:$STD:$JU:$HC" org.junit.runner.JUnitCore $CLS 2>&1 | grep -v '^Picked up' | tail -15

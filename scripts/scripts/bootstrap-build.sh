#!/usr/bin/env bash
# One-time build bootstrap. Run on a machine WITH internet access and: JDK 17, Gradle 8.7, Android SDK 34
# (ANDROID_HOME set). It creates the Gradle wrapper, then does the first real build and unit-test run.
# Afterwards commit: gradlew, gradlew.bat, gradle/wrapper/. CI uses ./gradlew automatically once it exists.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v gradle >/dev/null || { echo "gradle 8.7 not found"; exit 1; }
[ -n "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" ] || { echo "set ANDROID_HOME to the Android SDK"; exit 1; }
gradle wrapper --gradle-version 8.7 --distribution-type bin
bash scripts/validate.sh
./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease --stacktrace
echo
echo "Build OK. Next:"
echo "  1. Add distributionSha256Sum (from https://gradle.org/release-checksums/) to gradle/wrapper/gradle-wrapper.properties."
echo "  2. Commit gradlew, gradlew.bat and gradle/wrapper/."
echo "  3. Then enable dependency locking and commit the lock files: add"
echo "       dependencyLocking { lockAllConfigurations() }"
echo "     to app/build.gradle.kts and run:  ./gradlew :app:dependencies --write-locks"
echo "  4. Follow docs/TESTING_1.2.3.md on the F50."

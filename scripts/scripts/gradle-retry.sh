#!/usr/bin/env bash
# Runs gradle with the given arguments and retries ONLY when the failure looks like a network problem (a dependency or the
# Android Gradle Plugin could not be downloaded). A failing test or a compile error is never retried: it fails the build
# at once, so a flaky test cannot pass on a second try without anybody noticing.
# usage: scripts/gradle-retry.sh :app:testDebugUnitTest --stacktrace
set -uo pipefail
cd "$(dirname "$0")/.."
G=gradle; [ -x ./gradlew ] && G=./gradlew
LOG="$(mktemp)"; trap 'rm -f "$LOG"' EXIT
NET='Read timed out|Connect timed out|Connection reset|Premature EOF|Remote host terminated|UnknownHostException|SocketTimeoutException|Could not GET|Could not HEAD|Could not resolve (all|com\.|org\.|androidx|io\.)|status code 5[0-9][0-9]|Received status code (429|5)'
for i in 1 2 3; do
  $G "$@" 2>&1 | tee "$LOG"
  rc=${PIPESTATUS[0]}
  [ "$rc" -eq 0 ] && exit 0
  # tests failed or code did not compile: a real failure, never retried
  if grep -qE 'Task :[A-Za-z:]*[Tt]est[A-Za-z]* FAILED|There were failing tests|error: |e: file://|Compilation error|Execution failed for task .*(compile|Compile)' "$LOG"; then
    echo "::error::Gradle failed (tests or compilation): not retrying"; exit "$rc"
  fi
  if [ "$i" = 3 ] || ! grep -qE "$NET" "$LOG"; then exit "$rc"; fi
  echo "::warning::Gradle failed on a network error (attempt $i/3), retrying in 20s"; sleep 20
done
exit 1

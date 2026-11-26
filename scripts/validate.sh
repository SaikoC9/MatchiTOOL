#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$ROOT/scripts/build-web.js" --check   # index.html must match app/src/main/web-src/ (edit web-src/, then run scripts/build-web.js)
python3 - "$ROOT" <<'PY'
from pathlib import Path
import re, subprocess, sys, xml.etree.ElementTree as ET
root = Path(sys.argv[1])
ET.parse(root / 'app/src/main/AndroidManifest.xml')
ET.parse(root / 'app/src/main/res/values/strings.xml')
html = (root / 'app/src/main/assets/web/index.html').read_text()
for i, js in enumerate(re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', html, re.S | re.I)):
    path = Path('/tmp') / f'matchitool-inline-{i}.js'
    path.write_text(js)
    subprocess.run(['node', '--check', str(path)], check=True)
tools = re.findall(r'<script type="text/plain" class="webtool" data-name="([^"]+)">(.*?)</script>', html, re.S)
assert tools, 'no embedded tools found in the page'   # the count is checked against README in check_repo.py
for name, js in tools:
    path = Path('/tmp') / ('matchitool-tool-' + name)
    path.write_text(js)
    subprocess.run(['node', '--check', str(path)], check=True)
print('XML, page scripts and embedded tools parse')
PY

python3 "$ROOT/scripts/check_repo.py" "$ROOT"      # version in one place, README counts, bundled binary hashes
python3 "$ROOT/scripts/check_sources.py" "$ROOT"    # legacy source-text tripwires (see its header)
python3 "$ROOT/scripts/check_footprint.py" "$ROOT"    # root-side footprint registry (docs/UNINSTALL_WIPE.md)
sh -n "$ROOT/app/src/main/assets/bin/matchi_reaper.sh" || exit 1   # reaper must parse
python3 "$ROOT/scripts/lint_resource_rules.py" "$ROOT"  # du/find without -x, /proc/*/cmdline reads, busy loops, timers on expensive routes (docs/PLUGIN_RULES.md)
python3 "$ROOT/scripts/test_lint_resource_rules.py"   # the lint itself
python3 "$ROOT/scripts/test_route_gates.py"          # who may call which route
python3 "$ROOT/scripts/test_plugin_undo.py"           # the undo script in a real sh (fake iptables)
python3 "$ROOT/scripts/test_update_binary_hashes.py"   # CI helper that writes new binary hashes into NOTICE.md
python3 "$ROOT/scripts/gen_binary_hashes.py" --check "$ROOT"   # BinaryHashes.kt (what the app checks its copies against) must match assets/bin
bash "$ROOT/scripts/pin-actions.sh" --check            # every "uses:" in the workflows is pinned to a full commit (run scripts/pin-actions.sh to fix)

# Kotlin unit tests that need no Android SDK (pure logic, the gate proxy, ...). Needs java and the Kotlin compiler inside gradle's lib folder; skipped where they are missing.
if [ -n "${CI:-}" ]; then
  echo "skipped: Kotlin pure tests (CI runs all Kotlin tests with gradle :app:testDebugUnitTest)"
elif command -v java >/dev/null 2>&1 && command -v gradle >/dev/null 2>&1; then
  bash "$ROOT/scripts/kotlin_pure_tests.sh" </dev/null | tee /tmp/matchitool-kotlin-pure.txt
  grep -q '^OK (' /tmp/matchitool-kotlin-pure.txt || { echo "Kotlin pure tests failed"; exit 1; }
else
  echo "skipped: Kotlin pure tests (java or gradle missing)"
fi

# Boot / log shell tests (need setsid, pgrep and node; skipped where they are missing).
if command -v setsid >/dev/null 2>&1 && command -v pgrep >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  bash "$(dirname "$0")/test_boot_tasks.sh" </dev/null || exit 1
  bash "$(dirname "$0")/test_logd.sh" </dev/null || exit 1
  bash "$(dirname "$0")/test_reaper_install.sh" </dev/null || exit 1   # uninstall reaper: install, update, stub, switch OFF, end-to-end wipe in a fake root folder
  bash "$(dirname "$0")/test_reaper_snapshot.sh" </dev/null || exit 1   # uninstall reaper: plugin snapshot writer, wipe from the snapshot, path-rule parity with Kotlin
else
  echo "skipped: boot / log shell tests (setsid, pgrep or node missing)"
fi

# The page's redaction rules must give the same results as Redactor.kt (same cases as RedactorTest).
if command -v node >/dev/null 2>&1; then
  node "$(dirname "$0")/test_page_redact.js" || exit 1
  node "$(dirname "$0")/test_plugin_api.js" || exit 1      # window.matchi: the plugin API (toast, modal, root, user, router, shell helpers)
  node "$(dirname "$0")/test_plugin_meta.js" || exit 1     # plugin header lines, add-plugin summary, stop declarations
  node "$(dirname "$0")/test_plugin_trace.js" || exit 1
  node "$(dirname "$0")/test_plugin_sandbox.js" || exit 1
  node "$(dirname "$0")/test_plugin_sweep_ui.js" || exit 1
  node "$(dirname "$0")/test_guard_ui.js" || exit 1
  node "$(dirname "$0")/test_cmd_card.js" || exit 1
  node "$(dirname "$0")/test_plugin_undo_ui.js" || exit 1
  node "$(dirname "$0")/test_plugin_disable_ui.js" || exit 1
  node "$(dirname "$0")/test_plugin_hook.js" || exit 1
  node "$(dirname "$0")/test_log_basket.js" || exit 1
  node "$(dirname "$0")/test_live_poll.js" || exit 1
  node "$(dirname "$0")/test_live_cpu.js" || exit 1
  node "$(dirname "$0")/test_live_window.js" || exit 1
  node "$(dirname "$0")/test_live_guard.js" || exit 1
  node "$(dirname "$0")/test_live_stream.js" || exit 1     # Live panel push stream, page side
  node "$(dirname "$0")/test_at_radio.js" || exit 1
  node "$(dirname "$0")/test_memclean.js" || exit 1       # Memory Cleaner logic: scan parsing, what is protected, the stop script
  node "$(dirname "$0")/test_cpu.js" || exit 1             # CPU logic: probe parsing, usage meter, mode / speed / boot scripts
  node "$(dirname "$0")/test_at_console.js" || exit 1       # AT & Radio window logic: reply cleaning, command check, switch read-back
  node "$(dirname "$0")/test_changeip.js" || exit 1        # Change IP logic: address checks, the data off/on script in a real sh, wording
  node "$(dirname "$0")/test_net_tools.js" || exit 1      # Network window: parsers, password never copied, what the window may write
  node "$(dirname "$0")/test_net_tools_ui.js" || exit 1   # the window itself against a fake DOM
  node "$(dirname "$0")/test_sms_seen.js" || exit 1      # SMS new-message count: first message, repeated text after a delete
  node "$(dirname "$0")/test_sms_findin.js" || exit 1    # SMS Delete picks the exact text, not the newest one with the same start
  node "$(dirname "$0")/check_innerhtml.js" || exit 1   # every innerHTML site is static, escaped or reviewed
  node "$(dirname "$0")/test_safe_html.js" || exit 1
  node "$(dirname "$0")/test_i18n.js" || exit 1
fi

# IMEI keeper: pure sh, runs against a fake sendat.
sh "$(dirname "$0")/test_sha256_tool.sh" </dev/null || exit 1
sh "$(dirname "$0")/test_imei_apply.sh" </dev/null || exit 1

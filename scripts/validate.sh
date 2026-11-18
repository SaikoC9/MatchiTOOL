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
python3 "$ROOT/scripts/test_route_gates.py"          # who may call which route
python3 "$ROOT/scripts/test_plugin_undo.py"           # Phase 3: the undo script in a real sh (fake iptables)

# Boot / log shell tests (need setsid, pgrep and node; skipped where they are missing).
if command -v setsid >/dev/null 2>&1 && command -v pgrep >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  bash "$(dirname "$0")/test_boot_tasks.sh" </dev/null || exit 1
  bash "$(dirname "$0")/test_logd.sh" </dev/null || exit 1
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
  node "$(dirname "$0")/test_plugin_undo_ui.js" || exit 1
  node "$(dirname "$0")/test_plugin_disable_ui.js" || exit 1
  node "$(dirname "$0")/test_plugin_hook.js" || exit 1
  node "$(dirname "$0")/test_log_basket.js" || exit 1
  node "$(dirname "$0")/test_live_poll.js" || exit 1
  node "$(dirname "$0")/test_live_cpu.js" || exit 1
  node "$(dirname "$0")/test_live_window.js" || exit 1
  node "$(dirname "$0")/test_live_guard.js" || exit 1
  node "$(dirname "$0")/test_live_stream.js" || exit 1     # Live panel push stream, page side (plan Phase 4)
  node "$(dirname "$0")/test_at_radio.js" || exit 1
  node "$(dirname "$0")/test_memclean.js" || exit 1       # Memory Cleaner logic: scan parsing, what is protected, the stop script
  node "$(dirname "$0")/test_cpu.js" || exit 1             # CPU logic: probe parsing, usage meter, mode / speed / boot scripts
  node "$(dirname "$0")/test_at_console.js" || exit 1       # AT & Radio window logic: reply cleaning, command check, switch read-back
  node "$(dirname "$0")/test_changeip.js" || exit 1        # Change IP logic: address checks, the data off/on script in a real sh, wording
  node "$(dirname "$0")/test_net_tools.js" || exit 1      # Network window, Phase 1: parsers, password never copied, window is read only
  node "$(dirname "$0")/test_net_tools_ui.js" || exit 1   # the window itself against a fake DOM
  node "$(dirname "$0")/test_sms_seen.js" || exit 1      # SMS new-message count: first message (C6), repeated text after a delete (C7)
  node "$(dirname "$0")/test_sms_findin.js" || exit 1    # SMS Delete picks the exact text, not the newest one with the same start
  node "$(dirname "$0")/check_innerhtml.js" || exit 1   # every innerHTML site is static, escaped or reviewed
  node "$(dirname "$0")/test_safe_html.js" || exit 1
  node "$(dirname "$0")/test_i18n.js" || exit 1
fi

# IMEI keeper: pure sh, runs against a fake sendat.
sh "$(dirname "$0")/test_sha256_tool.sh" </dev/null || exit 1
sh "$(dirname "$0")/test_imei_apply.sh" </dev/null || exit 1

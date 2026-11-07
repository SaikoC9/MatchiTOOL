#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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
assert len(tools) == 8, f'expected 8 embedded tools, found {len(tools)}'
for name, js in tools:
    path = Path('/tmp') / ('matchitool-tool-' + name)
    path.write_text(js)
    subprocess.run(['node', '--check', str(path)], check=True)
root_shell = (root / 'app/src/main/java/com/matchi/tool/RootShell.kt').read_text()
assert 'ProcessBuilder("su", "-c", "sh")' in root_shell
assert 'LocalSocket' not in root_shell
assert 'ArrayBlockingQueue' in root_shell and 'MAX_QUEUED_LINES' in root_shell, 'root output queue must be bounded'
assert 'Semaphore(MAX_SESSIONS' in root_shell and 'commandSlots.tryAcquire' in root_shell, 'root command concurrency must be bounded'
main = (root / 'app/src/main/java/com/matchi/tool/MainActivity.kt').read_text()
assert 'ufi_tools_boot' not in main and 'writeStartScript' not in main
prefs = (root / 'app/src/main/java/com/matchi/tool/Prefs.kt').read_text()
server = (root / 'app/src/main/java/com/matchi/tool/WebServer.kt').read_text()
service = (root / 'app/src/main/java/com/matchi/tool/HostService.kt').read_text()
assert 'fun lanAccess(c: Context): Boolean = true' in prefs and 'setLanAccess' not in prefs, 'LAN-only: no local-only mode'
assert 'isHotspotClient(ctx, ip)' in server and 'ZTE hotspot network access only' in server, 'only hotspot clients may connect'
assert 'hotspotIf' in (root / 'app/src/main/java/com/matchi/tool/HostControl.kt').read_text()
assert 'ip route show table all' in (root / 'app/src/main/java/com/matchi/tool/HostControl.kt').read_text() and 'case \\"\\$UP\\"' in (root / 'app/src/main/java/com/matchi/tool/HostControl.kt').read_text(), 'LAN firewall must skip current uplinks'
assert '"127.0.0.1"' in server, 'WebServer must default to loopback binding'
assert '"0.0.0.0"' in service and 'else "127.0.0.1"' not in service, 'host must always bind to the LAN'
assert 'PillSwitch' not in main and 'setLan' not in main, 'LAN switch must be gone'
assert '/api/device/adb' not in server and '/api/device/fastboot' not in server
assert 'deviceDiscovery' not in server
assert '/api/builtin' not in server and not (root / 'app/src/main/assets/builtin').exists(), 'tools must live in the web page, not as APK assets'
assert '/api/usb/status' in server and '/api/usb/control' in server
assert 'adb_enable' in server and 'rndis_enable' in server and 'ecm_enable' in server
assert 'USB controls' in html and 'rndison' in html and 'ecmon' in html and 'CDC-ECM' in html
assert 'ADB / Fastboot discovery' not in html and 'Detect Fastboot devices' not in html
assert 'adbbtn' not in html and 'fastbootbtn' not in html
assert 'command.length > 128_000' in server, 'root shell request size guard missing'
assert 'Xml.newPullParser()' in server, 'XML well-formedness validation missing'
assert 'id="selftest"' in html and 'runSelfTest' in html and 'copyText' in html, 'full diagnose missing'
assert "PAGE_VERSION='1.2.26'" in html, 'page version must match app version'
screen = (root / 'app/src/main/java/com/matchi/tool/ScreenCapture.kt').read_text()
assert '/api/screen/frame' in server and '/api/screen/input' in server, 'screen control routes missing'
stream = (root / 'app/src/main/java/com/matchi/tool/ScreenStreamer.kt').read_text()
assert 'screencap\\n' in stream and 'since' in server, 'smooth screen streamer missing'
assert 'p.waitFor(250' in stream and 'errThread.join' in stream, 'screen capture process cleanup missing'
assert 'screencap -p' in screen and 'input tap' in screen and 'input swipe' in screen, 'screen capture / input helpers missing'
assert 'Screen_Control.js' in dict(tools) or any(n == 'Screen_Control.js' for n, _ in tools), 'Screen Control tool missing'
assert 'Trusted hotspot only · HTTP is unencrypted' in main, 'native LAN warning missing'
assert (root / 'app/src/main/java/com/matchi/tool/Tls.kt').exists() and 'makeSecure' in service, 'HTTPS support missing'
gradle = (root / 'app/build.gradle.kts').read_text()
assert 'versionCode = 226' in gradle and 'versionName = "1.2.26"' in gradle
assert 'uri == "/api/root/status"' in server and 'getPackageInfo(ctx.packageName, 0)' in server
upd = (root / 'app/src/main/java/com/matchi/tool/ApkUpdater.kt').read_text()
manifest = (root / 'app/src/main/AndroidManifest.xml').read_text()
for marker in ('MAX_BYTES', 'archive.packageName != ctx.packageName', 'relation', 'fun check(', 'offered.containsAll(have)', 'STAGE_TTL_MS', 'expectedSha', 'renameTo(out)', 'THREAD_PRIORITY_BACKGROUND', 'nice -n 10', 'rm -f "$path"', 'cleanStale'):
    assert marker in upd, f'safe-update check missing: {marker}'
assert 'pm install $flags' in upd and '"-r -d"' in upd and 'pm uninstall -k' in upd and 'newCode < s.oldCode' in upd, 'rollback / same-version install logic missing'
assert 'newCode <= oldCode' not in upd, 'same-version and rollback installs must be allowed'
for r in ('/api/update/stage', '/api/update/check', '/api/update/fetch', '/api/update/install', '/api/update/status'):
    assert r in server, f'update route missing: {r}'
assert 'ApkUpdater.MAX_BYTES + 1_000_000L' in server, 'upload size guard missing'
assert 'legacySigners' in upd and 'looksSigned' in upd and 'GET_SIGNATURES' in upd, 'updater signature fallback missing'
assert 'else if (name == "release") signingConfig = signingConfigs.getByName("debug")' in (root / 'app/build.gradle.kts').read_text(), 'release builds must never be unsigned'
assert 'id="appupdate"' in html and "'/api/update/stage'" in html and "'/api/update/install'" in html, 'web update UI missing'
assert 'REQUEST_INSTALL_PACKAGES' not in manifest
ctl = (root / 'app/src/main/java/com/matchi/tool/HostControl.kt').read_text()
assert 'openLanFirewall' in ctl and 'openLanFirewall' in service and 'br*|ap*|swlan*|usb*|rndis*|ecm*' in ctl, 'LAN firewall opener missing'
prefs = (root / 'app/src/main/java/com/matchi/tool/Prefs.kt').read_text()
assert 'AES/GCM/NoPadding' in prefs and 'AndroidKeyStore' in prefs, 'router credential encryption missing'
assert 'zte_pass_enc' in prefs and 'remove(ZTE_PASS_LEGACY)' in prefs, 'legacy credential migration missing'
assert 'X-Content-Type-Options' in server and 'X-Frame-Options' in server and 'Referrer-Policy' in server
assert 'cross-origin request refused' in server, 'Origin validation missing'
assert 'originUri.port' in server and 'hostUri.port' in server, 'same-origin port validation missing'
sessions_src = (root / 'app/src/main/java/com/matchi/tool/SessionStore.kt').read_text()
assert 'ByteArray(32)' in sessions_src and 'SecureRandom' in sessions_src, 'session tokens must use 256-bit random material'
assert 'fun token(' not in prefs and 'resetToken' not in prefs, 'the permanent access token must be gone'
assert 'Prefs.token' not in server and 'Sessions.validate(ctx' in server and 'Sessions.issue(ctx)' in server, 'web API must use per-login sessions'
assert '/api/logout' in server and 'Sessions.revokeAll' in server, 'logout / revoke-on-password-change missing'
assert 'IDLE_MS' in sessions_src and 'MAX_AGE_MS' in sessions_src, 'session expiry missing'
assert (root / 'app/src/test/java/com/matchi/tool/SessionStoreTest.kt').is_file(), 'session unit tests missing'
assert 'sessionLost' in html and 'logoutbtn' in html, 'web sign-out / expired-session handling missing'
rel_path = root / '.github/workflows/release.yml'
if rel_path.is_file():   # the publish workflow is optional (not every checkout has it)
    rel = rel_path.read_text()
    assert 'assembleRelease' in rel and 'assembleDebug' not in rel and 'app-debug' not in rel, 'release workflow must publish a release build'
    assert 'application-debuggable' in rel and '/apksigner" verify' in rel, 'release workflow must refuse debuggable/unsigned APKs'
assert 'isDebuggable = false' in (root / 'app/build.gradle.kts').read_text(), 'release build type must not be debuggable'
assert 'fails.size >= 256' in server, 'login failure map must be bounded'
assert 'cachedV6Nets' in ctl and 'Inet6Address' in ctl, 'hotspot IPv6 subnet filtering missing'
assert (root / 'docs/ROOT_INTEGRATION_1.1.52.md').is_file(), 'root integration notes missing'
assert 'initialized.compareAndSet(false, true)' in service and 'bootTasksRunning.compareAndSet(false, true)' in service
assert 'Command rejected: maximum 128 KB' in root_shell, 'root command size guard missing'
assert 'data class RootStatus' in root_shell and 'fun status(ctx: Context)' in root_shell, 'root status model missing'
assert 'fun closeAll()' in root_shell and 'RootShell.closeAll()' in service, 'root shell lifecycle cleanup missing'
assert 'RootShell.status(this)' in main and 'managerHint' in main, 'native root manager status missing'
assert 'handler.postDelayed(this, 60000)' in main, 'root status polling should be rate-limited'
network = dict(tools)['Network_Diagnostics.js']
for marker in ('ip -4 route show default', 'ip -6 route show default', 'ping -c 2 -W 2 1.1.1.1', 'getent hosts example.com', 'Read-only checks'):
    assert marker in network, f'network diagnostics safety/check marker missing: {marker}'
live = dict(tools)['Live_Status.js']
assert 'atAt = 0, atCache = []' in live and 'Date.now() - atAt >= 60000' in live, 'modem AT cache missing'
assert 'thermalLevel' in live and 'return 180000' in live and 'return 120000' in live and 'return 60000' in live, 'thermal-aware polling missing'
for marker in ('/proc/stat', 'MemAvailable', '/proc/loadavg', '/proc/uptime', 'prevCpu'):
    assert marker in live, f'live status telemetry marker missing: {marker}'
assert 'liv-heat critical' in live and 'not a substitute for the firmware' in live, 'thermal safety messaging missing'
assert 'CPU-BEGIN' in live and 'data-liv-cpu' in live and 'boot.d' in live and 'boot.d' in service, 'CPU Governor window or boot.d runner missing'
for needle in ('OFFF=$D/disabled', 'kill_watchers()', 'kill_nfqws_all()', 'off_exit()', 'enable) rm -f "$OFFF" ;;'):
    assert html.count(needle) >= 1, 'Bypass off switch missing: ' + needle
assert html.count('apply) rm -f "$OFFF"; kill_legacy; apply ;;') == 2, 'explicit apply must lift the off switch in both helpers'
assert html.count('${LEGACY_SH}\nkill_legacy() { legacy_clean') == 2, 'both helpers must use the shared legacy cleanup'
for needle in ('const LEGACY = [', 'legacy_scan()', 'legacy_clean()', 'legacy_proc_hit()', 'nfq_mine()', 'legacyScriptOf', 'qs_legacy', 'legacyClean', 'OLD LEFTOVERS', 'MATCHI_LEGACY_STUB'):
    assert needle in html, 'legacy cleanup piece missing: ' + needle
assert 'await stopHelper(SCRIPT);\n      await refresh(true);' in html and 'still enabled and will restore' not in html, 'Remove must also turn off boot auto-apply'
assert "PAGE_VERSION='1.2.26'" in html and 'versionCode = 226' in gradle and 'versionName = "1.2.26"' in gradle, 'version metadata mismatch'
assert '/api/root/status' in server, 'root status API missing'
assert (root / 'docs/ROOT_INTEGRATION_1.1.52.md').is_file(), 'root integration notes missing'
assert 'ulimit -f 4194304' in root_shell and 'ulimit -f 2048' not in root_shell and 'head -c 1100000' in root_shell, 'root shell must not cap plugin file writes at 1 MiB'
assert '"/api/upload"' in server and '"/api/uploads/"' in server and 'uploadNameRx' in server, 'plugin upload/download routes missing'
for fn in ('uploadFileKano', 'downloadUrl', 'createFixedToast', 'requestInterval', 'fillUfiData'):
    assert f'function {fn}' in html or f'async function {fn}' in html, f'plugin host helper missing: {fn}'
assert 'matchi_changeip_btn' in dict(tools)['Change_IP.js'] and 'svc data disable' in dict(tools)['Change_IP.js'], 'Change IP tool missing'
print('MatchiTOOL 1.2.26 source validation passed: XML, web JavaScript, embedded tools, root lifecycle, LAN/API hardening, live device status, network diagnostics, and version metadata.')
PY

# Upgrade test for the old-leftovers cleanup (needs setsid, pgrep and node; skipped where they are missing).
if command -v setsid >/dev/null 2>&1 && command -v pgrep >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  bash "$(dirname "$0")/test_legacy_cleanup.sh" </dev/null || exit 1
else
  echo "skipped: legacy cleanup upgrade test (setsid, pgrep or node missing)"
fi

#!/usr/bin/env python3
"""Source-text guards: greps over the Kotlin and web sources for things that must (not) be there.

These are TRIPWIRES, not tests: they check what the source says, not what it does, so they can fail on a harmless refactor. The
rule for this file: do not add to it. When you touch one of these areas, replace the guard with a real test (a Kotlin unit test, a
node test, or a table like scripts/test_route_gates.py) and delete the line here. Version, documentation counts and binary
hashes live in scripts/check_repo.py; route gating in scripts/test_route_gates.py; the gate logic in RootGateTest.kt.

`server` is every file that makes up the web host (WebServer.kt, WebRoutes*.kt, PluginPaths.kt), so moving code between them does not
break a guard."""
from pathlib import Path
import re, sys
root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
kt = root / 'app/src/main/java/com/matchi/tool'
html = (root / 'app/src/main/assets/web/index.html').read_text()
tools = re.findall(r'<script type="text/plain" class="webtool" data-name="([^"]+)">(.*?)</script>', html, re.S)
SERVER_FILES = ['WebServer.kt'] + sorted(p.name for p in kt.glob('WebRoutes*.kt')) + ['PluginPaths.kt']
root_shell = (root / 'app/src/main/java/com/matchi/tool/RootShell.kt').read_text()
assert 'ProcessBuilder("su", "-c", "sh")' in root_shell
assert 'LocalSocket' not in root_shell
assert 'ArrayBlockingQueue' in root_shell and 'MAX_QUEUED_LINES' in root_shell, 'root output queue must be bounded'
assert 'Semaphore(MAX_SESSIONS' in root_shell and 'commandSlots.tryAcquire' in root_shell, 'root command concurrency must be bounded'
main = (root / 'app/src/main/java/com/matchi/tool/MainActivity.kt').read_text()
assert 'ufi_tools_boot' not in main and 'writeStartScript' not in main
prefs = (root / 'app/src/main/java/com/matchi/tool/Prefs.kt').read_text()
server = '\n'.join((kt / f).read_text() for f in SERVER_FILES)
service = (root / 'app/src/main/java/com/matchi/tool/HostService.kt').read_text()
assert 'lanAccess' not in prefs and 'setLanAccess' not in prefs, 'LAN-only: no local-only mode'
assert 'isHotspotClient(ctx, ip)' in server and 'ZTE hotspot network access only' in server, 'only hotspot clients may connect'
assert 'hotspotIf' in (root / 'app/src/main/java/com/matchi/tool/HostControl.kt').read_text()
assert 'ip route show table all' in (root / 'app/src/main/java/com/matchi/tool/HostControl.kt').read_text() and 'case "\u00a7UP" in' in (root / 'app/src/main/java/com/matchi/tool/HostControl.kt').read_text(), 'LAN firewall must skip current uplinks'
assert '"127.0.0.1"' in server, 'WebServer must default to loopback binding'
assert '"0.0.0.0"' in service and 'else "127.0.0.1"' not in service, 'host must always bind to the LAN'
assert 'PillSwitch' not in main and 'setLan' not in main, 'LAN switch must be gone'
assert '/api/device/adb' not in server and '/api/device/fastboot' not in server
assert 'deviceDiscovery' not in server
assert '/api/builtin' not in server and not (root / 'app/src/main/assets/builtin').exists(), 'tools must live in the web page, not as APK assets'
assert 'uri == "/api/AT"' not in server and 'ufiShellReply' not in server and '/api/root_shell' not in server and '/api/one_click_shell' not in server, 'UFI alias routes must stay gone'
assert "u.pathname==='/api/at'" in html, 'page fetch shim must ask the HTTP confirm for AT writes'
assert 'adb_enable' in server and 'rndis_enable' in server and 'ecm_enable' in server
assert 'USB controls' in html and 'rndison' in html and 'ecmon' in html and 'CDC-ECM' in html
assert 'ADB / Fastboot discovery' not in html and 'Detect Fastboot devices' not in html
assert 'adbbtn' not in html and 'fastbootbtn' not in html
assert 'command.length > 128_000' in server, 'root shell request size guard missing'
assert 'Xml.newPullParser()' in server, 'XML well-formedness validation missing'
assert 'id="selftest"' in html and 'runSelfTest' in html and 'copyText' in html, 'full diagnose missing'
assert 'refreshBusy' in html and 'setInterval(()=>{if(!historyMode && !document.hidden' in html, 'Log Catcher polling must be visibility-aware and overlap-safe'
assert 'setTimeout(()=>URL.revokeObjectURL(url),3000)' in html, 'export download URL must remain available briefly for mobile browsers'
screen = (root / 'app/src/main/java/com/matchi/tool/ScreenCapture.kt').read_text()
assert '/api/screen/frame' in server and '/api/screen/input' in server, 'screen control routes missing'
stream = (root / 'app/src/main/java/com/matchi/tool/ScreenStreamer.kt').read_text()
assert 'screencap\\n' in stream and 'since' in server, 'smooth screen streamer missing'
assert 'p.waitFor(250' in stream and 'errThread.join' in stream, 'screen capture process cleanup missing'
assert 'screencap -p' in screen and 'input tap' in screen and 'input swipe' in screen, 'screen capture / input helpers missing'
assert 'Screen_Control.js' in dict(tools) or any(n == 'Screen_Control.js' for n, _ in tools), 'Screen Control tool missing'
assert 'Trusted hotspot only · HTTP is unencrypted' in main, 'native LAN warning missing'
assert (root / 'app/src/main/java/com/matchi/tool/Tls.kt').exists() and 'makeSecure' in service, 'HTTPS support missing'
upd = (root / 'app/src/main/java/com/matchi/tool/ApkUpdater.kt').read_text()
manifest = (root / 'app/src/main/AndroidManifest.xml').read_text()
for marker in ('MAX_BYTES', 'archive.packageName != ctx.packageName', 'relation', 'fun check(', 'offered.containsAll(have)', 'STAGE_TTL_MS', 'expectedSha', 'renameTo(out)', 'THREAD_PRIORITY_BACKGROUND', 'nice -n 10', 'rm -f "$path"', 'cleanStale'):
    assert marker in upd, f'safe-update check missing: {marker}'
assert 'pm install $flags' in upd and '"-r -d"' in upd and 'pm uninstall -k' in upd and 'newCode < s.oldCode' in upd, 'rollback / same-version install logic missing'
assert 'newCode <= oldCode' not in upd, 'same-version and rollback installs must be allowed'
assert 'ApkUpdater.MAX_BYTES + 1_000_000L' in server, 'upload size guard missing'
assert 'legacySigners' in upd and 'looksSigned' in upd and 'GET_SIGNATURES' in upd, 'updater signature fallback missing'
logger = (root / 'app/src/main/java/com/matchi/tool/LogCatcher.kt').read_text()
for marker in ('newSingleThreadExecutor', 'MAX_RECENT = 3000', 'MAX_PENDING_WRITES = 4096',
               'MAX_SESSION_BYTES = 8L * 1024L * 1024L', 'MAX_SESSIONS = 30',
               'startLogcatCapture()', 'stopLogcatCapture()', 'ProcessBuilder("logcat"',
               'fun droppedWriteCount()', 'writer.execute'):
    assert marker in logger, f'Log Catcher stability marker missing: {marker}'
assert 'FileWriter(target, true)' in logger and 'recent.removeFirst()' in logger, 'Log Catcher async persistence / bounded history missing'
assert 'pruneSessions(target.parentFile ?: return@enqueueWrite, target)' in logger and 'count > MAX_PENDING_WRITES' in logger, 'session queue / rotation handling missing'
start_body = logger[logger.index('fun start(context: Context)'):logger.index('fun stop()')]
assert start_body.index('BufferedWriter(FileWriter(file, false))') < start_body.index('active = true'), 'session must be initialized before reporting active'
assert 'UUID.randomUUID()' in logger and 'enqueueWrite(critical = true)' in logger, 'session collision resistance / critical writer operations missing'
assert 'fun exportText(context: Context, onComplete: (File?) -> Unit)' in logger, 'log export must be asynchronous'
assert 'startLogcatCapture()' in logger and start_body.index('pruneSessions(dir, file)') < start_body.index('startLogcatCapture()'), 'logcat capture must wait for session initialization'
tools_kt = (root / 'app/src/main/java/com/matchi/tool/LogTools.kt').read_text()
for marker in ('object DeviceLogs', 'while read x; do dmesg', 'gen.get() != g', 'class LogStream', 'MAX_STREAMS = 3', 'MAX_LIFETIME_MS',
               'object LogSearch', 'Guarded(line, d)', 'BUDGET_NS', 'object LogExport', 'MAX_BYTES = 64L', 'class DeleteOnClose', 'class NoiseGate', 'gate.allow('):
    assert marker in tools_kt, f'Log Catcher tools marker missing: {marker}'
assert '"-v", "threadtime", "-T", "1"' in logger and 'NoiseGate {' in logger, 'process logcat must not replay old lines and must collapse floods'
assert 'DeviceLogs.start(' in logger and 'DeviceLogs.stop()' in logger, 'device capture must follow the session lifecycle'
assert 'fun deleteSession(context: Context, name: String)' in logger and 'flush(1500L)' in logger, 'delete / crash flush missing'
for marker in ('openStream', 'syncStream', 'lcsearchall', 'lcexportall', 'lcreport', 'lcdevapply', 'lcregex', 'lcgroup', 'jumpErr', 'matchi_lc_bookmarks', 'checkAlerts'):
    assert marker in html, f'web Log Catcher feature missing: {marker}'
assert not (root / 'app/src/main/java/com/matchi/tool/LogCatcherActivity.kt').exists(), 'Log Catcher is web-only: delete app/src/main/java/com/matchi/tool/LogCatcherActivity.kt (a file removed in a new version is not removed by copying over an old checkout)'
assert 'LogCatcherActivity' not in main, 'Log Catcher is web-only: MainActivity.kt still refers to LogCatcherActivity (use the MainActivity.kt from this version)'
gradle_src = (root / 'app/build.gradle.kts').read_text()
assert 'else if (name == "release") {' in gradle_src and 'signingConfig = signingConfigs.getByName("debug")' in gradle_src, 'release builds must never be unsigned'
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
assert 'sessionLost' in html and 'logoutbtn' in html, 'web sign-out / expired-session handling missing'
rel_path = root / '.github/workflows/release.yml'
if rel_path.is_file():   # the publish workflow is optional (not every checkout has it)
    rel = rel_path.read_text()
    assert 'assembleRelease' in rel and 'assembleDebug' not in rel and 'app-debug' not in rel, 'release workflow must publish a release build'
    assert 'application-debuggable' in rel and '/apksigner" verify' in rel, 'release workflow must refuse debuggable/unsigned APKs'
assert 'isDebuggable = false' in (root / 'app/build.gradle.kts').read_text(), 'release build type must not be debuggable'
guard_src = (root / 'app/src/main/java/com/matchi/tool/LoginGuard.kt').read_text()
assert 'ips.size >= MAX_TRACKED' in guard_src and 'MAX_TRACKED = 256' in guard_src, 'login failure map must be bounded'
assert 'guard.retryAfterMs' in server and 'guard.mayAskRouter(ip)' in server and 'enterLoopbackDelay' in server, 'login must use LoginGuard (global back-off, router budget, bounded loopback delay)'
assert 'RouterHost.isValid' in (root / 'app/src/main/java/com/matchi/tool/Prefs.kt').read_text(), 'router address must be validated as a local IPv4 address'
assert 'ImeiGuard.apply' in service, 'the IMEI keeper must run at boot'
assert 'CRC32' in (root / 'app/src/main/java/com/matchi/tool/ScreenStreamer.kt').read_text(), 'screen change detection must hash the whole frame'
assert 'persistLocked' in (root / 'app/src/main/java/com/matchi/tool/SessionStore.kt').read_text(), 'session snapshots must be saved under the lock'
assert 'startWithRetry' in service and 'destroyed' in service and service.index('Tls.active = secure') < service.index('startWithRetry(srv)'), 'web host start must be retried per server, set the scheme before listening and honour onDestroy'
assert 'AtBatch.newMarker()' in server and "##AT" not in server, '/api/at/batch must use a random per-request marker'
assert 'runone' in service and 'timeout §T' in service, 'every boot script must run with its own time limit'
assert 'Tls.ready' in service and 'Tls.ready' in (root / 'app/src/main/java/com/matchi/tool/MainActivity.kt').read_text(), 'the home screen must wait for the web host before showing or opening the console address'
assert 'cachedV6Nets' in ctl and 'Inet6Address' in ctl, 'hotspot IPv6 subnet filtering missing'
assert 'initialized.compareAndSet(false, true)' in service and 'bootTasksRunning.compareAndSet(false, true)' in service
assert 'Command rejected: maximum 128 KB' in root_shell, 'root command size guard missing'
assert 'data class RootStatus' in root_shell and 'fun status(ctx: Context)' in root_shell, 'root status model missing'
assert 'fun closeAll()' in root_shell and 'RootShell.closeAll()' in service, 'root shell lifecycle cleanup missing'
assert 'RootShell.status(this)' in main and 'managerHint' in main, 'native root manager status missing'
assert 'handler.postDelayed(this, 60000)' in main, 'root status polling should be rate-limited'
network = dict(tools)['Network_Diagnostics.js']
for marker in ('ip -4 route show table all', 'ip -6 route show table all', 'ping -c 2 -W 2 1.1.1.1', 'getent hosts example.com', 'Read-only checks'):
    assert marker in network, f'network diagnostics safety/check marker missing: {marker}'
live = dict(tools)['Live_Status.js']
assert 'atAt = 0, atCache = []' in live and 'Date.now() - atAt >= 60000' in live, 'modem AT cache missing'
assert 'thermalLevel' in live and 'collectFast' in live and 'collectSlow' in live and 'fast: [3000, 6000, 15000]' in live and 'slow: [15000, 30000, 90000]' in live, 'thermal-aware fast/slow polling missing (cool / warm / hot table)'
for marker in ('/proc/stat', 'MemAvailable', '/proc/loadavg', '/proc/uptime', 'prevCpu'):
    assert marker in live, f'live status telemetry marker missing: {marker}'
assert 'liv-heat critical' in live and 'not a substitute for the firmware' in live, 'thermal safety messaging missing'
assert 'CPU-BEGIN' in live and 'data-liv-cpu' in live and 'boot.d' in live and 'boot.d' in service, 'CPU Governor window or boot.d runner missing'
assert "modal.closest('.modal-bg')" in live, 'CPU Governor shown() must check the .modal-bg wrapper (showModal puts the show class there, not on the inner card)'
assert 'ulimit -f 4194304' in root_shell and 'ulimit -f 2048' not in root_shell and 'head -c 1100000' in root_shell, 'root shell must not cap plugin file writes at 1 MiB'
# UFI removal, stage 3: the plugin upload routes are gone; the app-update upload still uses the shared upload slot.
for needle in ('"/api/upload"', '"/api/upload_img"', '"/api/uploads/', 'fun WebServer.uploadFile', 'fun WebServer.serveUpload', 'viaUfiRoute'):
    assert needle not in server, 'removed upload route code is back: ' + needle
assert 'withUploadSlot(len)' in server and 'uploadSpaceOk(' in server, 'the app-update upload must keep the one-at-a-time slot and free-space check'
for fn in ('createFixedToast', 'requestInterval', 'createModal', 'runShellWithRoot', 'runShellWithUser', 'checkRoot', 'plugScan', 'plugStopDecls', 'plugSummary'):
    assert f'function {fn}' in html or f'async function {fn}' in html, f'plugin host helper missing: {fn}'
assert 'matchi_changeip_btn' in dict(tools)['Change_IP.js'] and 'svc data disable' in (root / 'app/src/main/web-src/changeip-core.js').read_text(), 'Change IP tool missing'   # the switch script is in changeip-core.js
assert 'installBundledBinary("bin/curl"' in server and 'files/curl' in html, 'bundled curl is not installed or not on the wrapper search path'
assert 'BUNDLED_TOOLS = listOf("jq", "sha256", "zreq")' in server and 'installBundledBinary("bin/$tool"' in server, 'jq/sha256/zreq are not installed at start-up'
# UFI removal, stage 2 (see UFI_REMOVAL_PATH.txt): the UFI plugin format, UFI_DATA poller, plugin store and UFI-only helpers must stay gone from the page.
for needle in ('ufiParse', 'ufiInject', 'ufiImport', 'ufiBuild', 'ufiCheck', 'ufiHash', 'ufiT(', 'ufiModalEl', 'UFI_DATA', 'UFIPOLL', 'ufiDataStart', 'plugin_store_open',
               'plugin_ufi_', 'storeParseUfi', 'storeInstall', 'plugCompat', 'pluginLanFix', '__matchiCompat', 'downloadUrl',
               'collapseBtn_menu', 'collapse_box', 'functions-container', 'UFIHOST', 'UFISTORE'):
    assert needle not in html, 'UFI code is back in the page: ' + needle
assert not any((root / 'app/src/main/web-src' / f).exists() for f in ('plugin-store-ui.js', 'plugin-store-pure.js')), 'plugin store source files are back'
assert 'window.matchi=Object.freeze(' in html and 'async function runShellWithUser' in html and 'const matchiSh=' in html, 'matchi plugin API missing'
assert 'id="matchi_menu_btn"' in html and 'matchi-menu-box' in html, 'plugin menu anchors missing'
for f in ('scan_plugins.js', 'deob_requests_js.js', 'run_plugins.js', 'test_store_browser.js', 'test_ufi_globals_browser.js', 'test_ufi_poll_browser.js'):
    assert not (root / 'scripts/phase0' / f).exists(), 'removed UFI script is back: ' + f
# Boot-time log capture (Magisk script): shipped, versioned, installable, and no new silent catches.
logd = (root / 'app/src/main/assets/bin/matchi_logd.sh').read_text()
logd_ver = re.search(r'^# MATCHI_LOGD_VERSION=(\d+)$', logd, re.M)
assert logd_ver, 'boot script must carry a "# MATCHI_LOGD_VERSION=n" header (the app re-installs it when the version changes)'
assert logd.startswith('#!/system/bin/sh'), 'boot script must use the Android shell'
assert 'logcat "$@" -f' in logd and '-b all' in logd and 'dmesg -w' in logd and '-r "$FILE_KB" -n "$FILES"' in logd, 'boot script must capture all buffers + dmesg -w into rotating files'
assert 'MIN_FREE_MB' in logd and 'size cap exceeded' in logd, 'boot script must keep its size cap and low-space guard'
assert 'MATCHI_LOGD_EOF' not in logd, 'boot script must not contain the installer heredoc delimiter'
bl = (root / 'app/src/main/java/com/matchi/tool/BootLogd.kt').read_text()
assert 'BootLogdModel.SCRIPT_PATH' in bl and 'fun ensureCurrent' in bl and 'bin/matchi_logd.sh' in bl, 'boot script installer missing'
assert 'BootLogd.ensureCurrent' in service, 'boot tasks must re-install an outdated boot script'
assert 'id="lcboot"' in html and '/api/logs/boot/read' in html, 'web page boot capture viewer missing'
silent = 0
for f in (root / 'app/src/main/java').rglob('*.kt'):
    n = len(re.findall(r'catch \(_: \w+\) *\{ *\}', f.read_text()))
    if f.name.startswith('BootLogd'): assert n == 0, f.name + ': log the exception instead of swallowing it'
    silent += n
SILENT_CATCH_BASELINE = 0   # every swallowed exception goes through Quiet.note / Quiet.attempt / Quiet.orElse
assert silent <= SILENT_CATCH_BASELINE, f'{silent} silent catch blocks (baseline {SILENT_CATCH_BASELINE}): log the exception (LogCatcher.log) instead of "catch (_: ...) {{ }}"'
# Viewer: parsed columns, per-source counters, one session list, and the quiet-failure helper.
pj = root / 'app/src/main/java/com/matchi/tool'
assert (pj / 'Quiet.kt').exists() and 'Quiet.sink' in logger, 'Quiet helper must be wired to the app log'
assert (pj / 'LogLineParser.kt').exists() and 'LogLineParser.parse' in bl, 'boot pages must carry parsed time/PID/thread/tag rows'
assert (pj / 'SourceCounters.kt').exists() and 'SourceStats' in logger and 'countersJson()' in server, 'per-source counters missing'
assert 'it.stats = SourceStats' in (pj / 'LogTools.kt').read_text(), 'noise gates must feed the counters'
assert 'id="lcbootnav"' in html and 'viewBoot(' in html and 'loadCounters' in html and "bootOptions(fl,'boot:','Boot capture" in html and 'function bootOptions(' in html, 'web page: boot files in the session list / columns / counters missing'
assert "x.pid>0" in html, 'viewer must show PID/thread when a line has them'
assert 'function maybeRedact(' in html and 'maybeRedact(rows.filter' in html and "id=\"lcdevkeepall\"" in html, 'web page: redaction of exports/copies or the keep-every-line switch missing'
assert 'keepEverything' in (root / 'app/src/main/java/com/matchi/tool/LogTools.kt').read_text(), 'NoiseGate keep-everything switch missing'
# UFI removal, stage 3: no UFI path rewriting, no UFI router routes, no UFI-only helper files.
for gone in ('UfiPathMap.kt', 'GatewayProxy.kt'):
    assert not (root / 'app/src/main/java/com/matchi/tool' / gone).exists(), 'removed file is back: ' + gone
for needle in ('UfiPathMap', 'GatewayProxy', '"/api/goform/', '"/api/proxy/', '"/api/get_cookie"', '"/api/set_cookie"'):
    assert needle not in server, 'removed UFI code is back in the host: ' + needle
assert 'ProcessBuilder("sh", "-c", command)' in (root / 'app/src/main/java/com/matchi/tool/UserShell.kt').read_text() and '"su"' not in (root / 'app/src/main/java/com/matchi/tool/UserShell.kt').read_text(), 'user shell must not use su'
zc = (root / 'app/src/main/java/com/matchi/tool/ZteClient.kt').read_text()
assert 'fun proxy(' not in zc and 'fun sessionCookie(' not in zc and 'fun setSessionCookie(' not in zc and 'GatewayProxy' not in zc, 'ZteClient must not expose a free-path proxy or the router session cookie'
assert 'resolveHost(ctx)' in zc and zc.count('URL(if (method == "GET")') == 1, 'only the saved-host request builder may open router connections'
# The session is an HttpOnly cookie. No route reads the token header itself, and the login reply carries no token.
assert 'headers["x-token"]' not in server.replace('requestToken(s.headers["cookie"], s.headers["x-token"])', ''), 'read the session through sessionToken(s), not the x-token header'
assert '.put("token"' not in server, 'the login reply must not hand the session token to the page'
assert 'sessionCookieHeader(Sessions.issue(ctx), Tls.active)' in server and 'clearSessionCookieHeader(Tls.active)' in server, 'login must set the session cookie and sign-out must clear it'
assert 'lr.token' not in html, 'the page must not expect a token in the login reply'
# Every plugin install asks for the password, new names included (a running plugin must not install another plugin silently).
assert '"install a plugin"' in server and 'val unchanged = oldBytes != null' in server and 'if (!unchanged)' in server, 'installing a plugin must need the password unless nothing changes'
print(f'source guards passed ({len(SERVER_FILES)} host files, tripwires only - see the header of this file)')

# Live panel CPU loop: the command the page sends and RootGate.CPU_LIVE_CMD must be the same text (the host recognises it exactly)
import re as _re
_js = _re.search(r"const CPU_LIVE_CMD = '(.*)';", html)
_kt = _re.search(r'val CPU_LIVE_CMD: String = """(.*?)"""', (root / 'app/src/main/java/com/matchi/tool/RootGate.kt').read_text(), _re.S)
assert _js and _kt, 'CPU_LIVE_CMD missing in the page or in RootGate.kt'
assert _js.group(1).replace('\\"', '"') == _kt.group(1).replace('\u00a7', '$'), 'CPU_LIVE_CMD differs between index.html and RootGate.kt'
assert 'RootGate.isCpuLiveRead' in (root / 'app/src/main/java/com/matchi/tool/WebRoutesRoot.kt').read_text(), 'cpu-live audit line missing in /api/shell'


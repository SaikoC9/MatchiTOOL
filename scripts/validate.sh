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
assert len(tools) == 6, f'expected 6 embedded tools, found {len(tools)}'
for name, js in tools:
    path = Path('/tmp') / ('matchitool-tool-' + name)
    path.write_text(js)
    subprocess.run(['node', '--check', str(path)], check=True)
root_shell = (root / 'app/src/main/java/com/matchi/tool/RootShell.kt').read_text()
assert 'ProcessBuilder("su", "-c", "sh")' in root_shell
assert 'LocalSocket' not in root_shell
main = (root / 'app/src/main/java/com/matchi/tool/MainActivity.kt').read_text()
assert 'ufi_tools_boot' not in main and 'writeStartScript' not in main
bypass = dict(tools)['Bypass_v65_13.js']
for legacy in ('/sdcard/ufi_tools_boot.sh', '/data/data/com.minikano.f50_sms', '/data/local/ufi_ttl', '/data/local/ufi_dpi'):
    assert legacy not in bypass, f'legacy UFI path remains: {legacy}'
assert '/data/local/matchitool/boot.sh' in bypass
prefs = (root / 'app/src/main/java/com/matchi/tool/Prefs.kt').read_text()
server = (root / 'app/src/main/java/com/matchi/tool/WebServer.kt').read_text()
service = (root / 'app/src/main/java/com/matchi/tool/HostService.kt').read_text()
assert 'getBoolean("lan_access", false)' in prefs, 'LAN access must default off'
assert '"127.0.0.1"' in server, 'WebServer must default to loopback binding'
assert 'if (Prefs.lanAccess(this)) "0.0.0.0" else "127.0.0.1"' in service
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
assert "PAGE_VERSION='1.1.24'" in html, 'page version must match app version'
gradle = (root / 'app/build.gradle.kts').read_text()
assert 'versionCode = 134' in gradle and 'versionName = \"1.1.24\"' in gradle
assert 'put(\"version\", \"1.1.24\")' in server
print('Source validation passed: XML, web JavaScript, bundled plugins, root backend, loopback-first network security, firmware preflight, and version metadata.')
PY

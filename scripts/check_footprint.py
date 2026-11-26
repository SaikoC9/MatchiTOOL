#!/usr/bin/env python3
"""Fails when the sources create a root-side item that Footprint.kt does not cover (docs/UNINSTALL_WIPE.md, Phase 2).

Checks, over app/src/main (Kotlin, assets/bin/*.sh, web-src/*.js):
  1. every literal /data/local/... and /data/adb/... path is inside /data/local/matchitool, or listed in Footprint.kt, or a known read-only path
  2. no new iptables/ip6tables "-N CHAIN" with a literal name other than Footprint.AGH_CHAIN
  3. "tc qdisc|class|filter add|replace" only in SpeedLimit.kt
  4. INPUT rules ("-I/-A INPUT") only in HostControl.kt
  5. Footprint constants agree with Prefs.PORT and HostService.OLD_TMP_CLEANUP
  6. assets/bin/matchi_reaper.sh constants agree with Footprint.kt
  7. ReaperModel.kt (install of the reaper, Phase 4) agrees with the reaper script and Footprint.kt, and ApkUpdater writes the "updating" marker
  8. Plugin snapshot (Phase 5): the files the app writes (ReaperModel.SNAP_PATH / MANIFEST_PATH) are the ones the reaper reads, the tag limit agrees,
     and the web server binds the snapshot source

Known blind spot (plan S9): templated paths (/data/local/$base, /data/local/tmp/$base in PluginPaths) are not literals. The plugin files
below are exempt; plugin leftovers are covered by the plugin ledger, not by this registry.
usage: check_footprint.py [ROOT]    (exit 1 on a problem)"""
from pathlib import Path
import re, sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
main = root / 'app/src/main'
kt = main / 'java/com/matchi/tool'

PLUGIN_EXEMPT = {'PluginPaths.kt', 'PluginSweep.kt', 'PluginUninstall.kt', 'PluginTrace.kt', 'PluginGuard.kt', 'PluginUndo.kt',
                 'PluginProbe.kt', 'WebRoutesPlugins.kt', 'PluginSnapshot.kt'}
ADB_READ_ONLY = {'/data/adb', '/data/adb/magisk', '/data/adb/ksu', '/data/adb/ap', '/data/adb/modules', '/data/adb/magisk.log',
                 '/data/adb/service.d', '/data/adb/post-fs-data.d'}
LOCAL_BARE = {'/data/local', '/data/local/tmp'}

fp_text = (kt / 'Footprint.kt').read_text()
fp_strings = set(re.findall(r'"(/data/[^"$]+)"', fp_text))
problems = []

files = [p for p in kt.glob('*.kt')] + list((main / 'assets/bin').glob('*.sh')) + list((main / 'web-src').glob('*.js'))
PATH_RX = re.compile(r'/data/(?:local|adb)(?:/[A-Za-z0-9_.\-]+)*')
for f in sorted(files):
    if f.name in PLUGIN_EXEMPT or f.name == 'Footprint.kt':
        continue
    path_check = f.name != 'matchi_reaper.sh'   # the reaper's constants are compared with Footprint.kt in check 6
    text = f.read_text(errors='replace')
    for no, line in enumerate(text.splitlines(), 1):
        for m in (PATH_RX.finditer(line) if path_check else ()):
            p = m.group(0).rstrip('.')
            if p == '/data/local/matchitool' or p.startswith('/data/local/matchitool/'): continue
            if p in LOCAL_BARE or p in ADB_READ_ONLY or p in fp_strings: continue
            problems.append(f'{f.relative_to(root)}:{no}: path not covered by Footprint: {p}')
        for m in re.finditer(r'ip6?tables\b[^\n"]*?\s-N\s+([A-Za-z][A-Za-z0-9_]*)', line):
            if m.group(1) != 'AGH_UI':
                problems.append(f'{f.relative_to(root)}:{no}: new iptables chain {m.group(1)} not in Footprint')
        if re.search(r'\btc (?:qdisc|class|filter) (?:add|replace)\b', line) and f.name != 'SpeedLimit.kt':
            problems.append(f'{f.relative_to(root)}:{no}: tc setup outside SpeedLimit.kt')
        if re.search(r'ip6?tables\b[^\n]*\s-[IA]\s+INPUT\b', line) and f.name != 'HostControl.kt':
            problems.append(f'{f.relative_to(root)}:{no}: INPUT rule outside HostControl.kt')

# 5. constants agree with the code they mirror
port = re.search(r'const val PORT\s*=\s*(\d+)', (kt / 'Prefs.kt').read_text())
fport = re.search(r'const val CONSOLE_PORT\s*=\s*(\d+)', fp_text)
if not port or not fport or port.group(1) != fport.group(1):
    problems.append('Footprint.CONSOLE_PORT differs from Prefs.PORT')
old = set(re.findall(r'/data/local/tmp/[A-Za-z0-9_.\-]+', re.search(r'OLD_TMP_CLEANUP\s*=(.*?)"exit 0"', (kt / 'HostService.kt').read_text(), re.S).group(1)))
legacy = set(re.findall(r'"(/data/local/tmp/[^"]+)"', re.search(r'LEGACY_TMP\s*=\s*listOf\((.*?)\)\n', fp_text, re.S).group(1)))
if old != legacy:
    problems.append(f'Footprint.LEGACY_TMP differs from HostService.OLD_TMP_CLEANUP: {sorted(old ^ legacy)}')

# 6. the reaper script's constants agree with Footprint.kt (it cannot read Kotlin, so they are copied; this keeps them from drifting)
reaper = (main / 'assets/bin/matchi_reaper.sh').read_text()
def sh(name):
    m = re.search(r'^' + name + r'=("?)(.*?)\1\s*$', reaper, re.M)
    return m.group(2) if m else None
def kt_str(name): m = re.search(r'val ' + name + r'\s*=\s*"([^"]*)"', fp_text); return m.group(1) if m else None
def kt_list(name): m = re.search(r'val ' + name + r'\s*=\s*listOf\((.*?)\)', fp_text, re.S); return re.findall(r'"([^"]+)"', m.group(1)) if m else None
def same(what, a, b):
    if a != b: problems.append(f'matchi_reaper.sh {what} = {a!r} but Footprint.kt has {b!r}')
same('B', sh('B'), kt_str('BASE_DIR'))
same('PORT', sh('PORT'), fport.group(1) if fport else None)
same('AGH', sh('AGH'), kt_str('AGH_CHAIN'))
same('IFP', (sh('IFP') or '').split(), kt_list('LAN_IF_PREFIXES'))
same('PROCS', (sh('PROCS') or '').split(), kt_list('PROCESS_NAMES'))
same('TCDEV', sh('TCDEV'), kt_str('TC_DEVICE'))
same('TCIN', (sh('TCIN') or '').split(), kt_list('TC_INGRESS_DEVICES'))
same('LEGACY', (sh('LEGACY') or '').split(), kt_list('LEGACY_TMP'))
same('BYPASS', (sh('BYPASS') or '').split(), kt_list('BYPASS_DIRS'))
same('PLUGDIRS', (sh('PLUGDIRS') or '').split(), kt_list('PLUGIN_KNOWN_DIRS'))
same('LOGF', sh('LOGF'), kt_str('REAPER_LOG'))
same('LOGD/STUB', [sh('LOGD'), sh('STUB')], kt_list('BOOT_STUBS'))
v4 = re.search(r'TC_PRIO_V4\s*=\s*(\d+)\.\.(\d+)', fp_text); v6 = re.search(r'TC_PRIO_V6\s*=\s*(\d+)\.\.(\d+)', fp_text)
same('V4', [re.search(r'^V4LO=(\d+)', reaper, re.M).group(1), re.search(r'V4HI=(\d+)', reaper).group(1)], list(v4.groups()) if v4 else None)
same('V6', [re.search(r'^V6LO=(\d+)', reaper, re.M).group(1), re.search(r'V6HI=(\d+)', reaper).group(1)], list(v6.groups()) if v6 else None)

# 7. ReaperModel (where the app installs the reaper and its stub, and the update marker) must be the places the reaper script watches and removes
rm_text = (kt / 'ReaperModel.kt').read_text()
def rm_const(name): m = re.search(r'const val ' + name + r'\s*=\s*"([^"]*)"', rm_text); return m.group(1) if m else None
base = kt_str('BASE_DIR') or (re.search(r'const val BASE_DIR\s*=\s*"([^"]*)"', fp_text) or [None, None])[1]
rd = (sh('RD') or '').replace('$B', base or '')
same('ReaperModel.DIR', (rm_const('DIR') or '').replace('$BASE_DIR', base or ''), rd)
same('ReaperModel.STUB_PATH', rm_const('STUB_PATH'), sh('STUB'))
same('ReaperModel.STUB_PATH in Footprint.BOOT_STUBS', rm_const('STUB_PATH') in (kt_list('BOOT_STUBS') or []), True)
marker_dir = (rm_const('UPDATING_MARKER') or '').replace('$BASE_DIR', base or '')
rp = re.search(r'f=\$R\$B/(\w+)', reaper)
same('updating marker file name (reaper reads $R$B/NAME)', marker_dir, f"{base}/{rp.group(1)}" if rp else None)
if 'ReaperModel.updatingMarkerCommand()' not in (kt / 'ApkUpdater.kt').read_text() or 'ReaperModel.UPDATING_MARKER' not in (kt / 'ApkUpdater.kt').read_text():
    problems.append('ApkUpdater.kt must write ReaperModel.updatingMarkerCommand() before the install and remove ReaperModel.UPDATING_MARKER after it succeeds')
if 'Reaper.ensureCurrent' not in (kt / 'HostService.kt').read_text():
    problems.append('HostService.kt must call Reaper.ensureCurrent (install and refresh of the reaper)')

# 8. plugin snapshot: the app writes the files the reaper reads; limits agree
same('ReaperModel.SNAP_PATH', (rm_const('SNAP_PATH') or '').replace('$DIR', (rm_const('DIR') or '').replace('$BASE_DIR', base or '')), f"{rd}/plugins.snap" if 'plugins.snap' in reaper else None)
same('ReaperModel.MANIFEST_PATH', (rm_const('MANIFEST_PATH') or '').replace('$DIR', (rm_const('DIR') or '').replace('$BASE_DIR', base or '')), f"{rd}/plugins.manifest" if 'plugins.manifest' in reaper else None)
snap_kt = (kt / 'PluginSnapshot.kt').read_text()
tm = re.search(r'const val SNAP_TAG_MAX\s*=\s*(\d+)', snap_kt); rt = re.search(r'valid_tag\(\) \{.*?\[ \$\{#1\} -le (\d+) \]', reaper)
same('plugin tag limit (PluginSnapshot.SNAP_TAG_MAX)', rt.group(1) if rt else None, tm.group(1) if tm else None)
cm = re.search(r'const val SNAP_COMMAND_MAX\s*=\s*(\d+)', snap_kt); rc = re.search(r'\[ \$\{#cmd\} -le (\d+) \]', reaper)
same('stop command limit (PluginSnapshot.SNAP_COMMAND_MAX)', rc.group(1) if rc else None, cm.group(1) if cm else None)
ws = (kt / 'WebServer.kt').read_text()
if 'Reaper.bindSnapshotSource' not in ws or 'traceStore.onChange' not in ws:
    problems.append('WebServer.kt must bind Reaper.bindSnapshotSource and traceStore.onChange (plugin snapshot, Phase 5)')
wp = (kt / 'WebRoutesPlugins.kt').read_text()
if wp.count('Reaper.scheduleSnapshot') < 4:
    problems.append('WebRoutesPlugins.kt must schedule the plugin snapshot after install, approve, mode change and delete')

if problems:
    print('\n'.join(problems)); sys.exit(1)
print(f'footprint ok ({len(files)} files scanned)')

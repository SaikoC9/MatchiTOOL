#!/bin/bash
# Phase 5 test: the plugin snapshot of the uninstall reaper, in a fake root folder (no device needed).
# Runs the REAL writer script from ReaperModel.kt (SNAPSHOT_TEMPLATE, "/data/" pointed at a temp folder) and the REAL assets/bin/matchi_reaper.sh
# (with MR_ROOT) against a fake iptables (a state file), a fake stat and real decoy processes. Checks:
#   writer: files written byte for byte, mode 600, no temp files; replaced on the next write; refused for a missing / symlinked / foreign folder;
#           a short write is refused and the old files stay;
#   wipe:   the snapshot's chain, rule (also with "+" and a long tag), paths, boot file, tagged processes and approved stop command are taken away;
#           everything else stays: a foreign chain, a rule with another text, unrelated files, a process with another tag, curl in /data/local/tmp;
#           a stop command that is not in the manifest does not run; a tampered manifest, a wrong owner, a wrong mode and a symlinked snapshot
#           make the reaper skip the snapshot (the fixed registry is still wiped); hand-edited lines (bad chain, bad rule, .., symlinked parent,
#           /sdcard, our own folder) do nothing;
#   parity: the reaper's plugin_path_ok gives the same answer as snapPathOk on the table in PluginSnapshotTest.PATH_CASES.
set -u
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
work=$(mktemp -d)
fail=0
ok()  { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
cleanup() { for p in $(jobs -p 2>/dev/null); do kill -9 "$p" 2>/dev/null; done; rm -rf "$work"; }
trap cleanup EXIT

REAPER="$root/app/src/main/assets/bin/matchi_reaper.sh"
KT="$root/app/src/main/java/com/matchi/tool/ReaperModel.kt"
TESTKT="$root/app/src/test/java/com/matchi/tool/PluginSnapshotTest.kt"

# ---- writer script, rendered for a given snapshot (size_delta makes the expected size wrong on purpose)
cat > "$work/mk.py" <<'PY'
import re, sys
kt, work, snapf, manf, out, delta = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], int(sys.argv[6])
src = open(kt).read()
m = re.search(r'private const val SNAPSHOT_TEMPLATE = """\n?(.*?)"""', src, re.S)
assert m, 'SNAPSHOT_TEMPLATE not found'
t = m.group(1).replace('\u00a7', '$').replace('/data/', work + '/data/')
snap = open(snapf).read().rstrip('\n'); man = open(manf).read().rstrip('\n')
t = t.replace('@@SNAP_SIZE@@', str(len(snap.encode()) + 1 + delta)).replace('@@MANIFEST_SIZE@@', str(len(man.encode()) + 1))
t = t.replace('@@SNAP_TEXT@@', snap).replace('@@MANIFEST_TEXT@@', man)
assert '@@' not in t.replace(snap, '').replace(man, '')
open(out, 'w').write(t)
PY
render() { python3 "$work/mk.py" "$KT" "$work" "$1" "$2" "$3" "${4:-0}" || exit 1; }

# ---- fakes
mkdir -p "$work/bin"
printf '#!/bin/sh\ncase "$1" in sys.boot_completed) echo 1;; sys.user.0.ce_available) echo true;; *) echo;; esac\n' > "$work/bin/getprop"
printf '#!/bin/sh\nexit 1\n' > "$work/bin/pm"
cat > "$work/bin/ps" <<'FAKE'
#!/bin/sh
[ "$*" = "-A -o PID,ARGS" ] && exec /usr/bin/ps -A -o pid,args
exec /usr/bin/ps "$@"
FAKE
cat > "$work/bin/stat" <<'FAKE'
#!/bin/sh
case "$2" in %u) echo "${FAKE_STAT_UID:-0}";; *) echo "0 ${FAKE_STAT_MODE:-drwx------}";; esac
FAKE
cat > "$work/bin/iptables" <<'FAKE'
#!/usr/bin/env python3
import sys, os
st = os.environ['FW_STATE'] + '.' + os.path.basename(sys.argv[0])
a = sys.argv[1:]; o = []; i = 0
while i < len(a):
    if a[i] == '-w':
        i += 1
        if i < len(a) and a[i].isdigit(): i += 1
        continue
    o.append(a[i]); i += 1
a = o; table = 'filter'
if len(a) >= 2 and a[0] == '-t': table = a[1]; a = a[2:]
lines = [l.rstrip('\n') for l in open(st)] if os.path.exists(st) else []
def save(): open(st, 'w').write(''.join(l + '\n' for l in lines))
if not a: sys.exit(2)
op, rest = a[0], a[1:]
if op == '-S':
    chain = rest[0] if rest else None
    for l in lines:
        t, r = l.split('|', 1)
        if t == table and (chain is None or r.startswith('-A ' + chain + ' ') or r == '-N ' + chain): print(r)
    sys.exit(0)
if op in ('-D', '-C'):
    target = table + '|-A ' + rest[0] + ' ' + ' '.join(rest[1:])
    if target in lines:
        if op == '-D': lines.remove(target); save()
        sys.exit(0)
    sys.exit(1)
if op == '-F':
    lines = [l for l in lines if not (l.startswith(table + '|-A ' + rest[0] + ' '))]; save(); sys.exit(0)
if op == '-X':
    c = rest[0]
    if (table + '|-N ' + c) not in lines: sys.exit(1)
    for l in lines:
        if l.startswith(table + '|-A ' + c + ' ') or l.endswith(' -j ' + c): sys.exit(1)
    lines.remove(table + '|-N ' + c); save(); sys.exit(0)
sys.exit(2)
FAKE
cp "$work/bin/iptables" "$work/bin/ip6tables"
chmod +x "$work/bin/"*
export PATH="$work/bin:$PATH" FW_STATE="$work/fw" MR_WATCH_S=1 MR_CONFIRM_S=1 MR_SETTLE_S=0 MR_RETRY_S=2
mode() { /usr/bin/stat -c %a "$1" 2>/dev/null; }

B="$work/data/local/matchitool"; D="$B/reaper"
sha() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

# ======================================================================== A. the writer
mkdir -p "$D"
printf '# MATCHI_PLUGIN_SNAP=1\nT A.js\nP /data/local/aaa\n' > "$work/s1"
printf '# MATCHI_PLUGIN_MANIFEST=1\n' > "$work/m1"
render "$work/s1" "$work/m1" "$work/w1.sh"
out=$(sh "$work/w1.sh" 2>&1)
[ "$out" = "SNAPSHOT=1" ] && ok "writer reports SNAPSHOT=1" || bad "writer output: $out"
cmp -s "$D/plugins.snap" "$work/s1" && cmp -s "$D/plugins.manifest" "$work/m1" && ok "both files written byte for byte" || bad "snapshot files differ from the input"
[ "$(mode "$D/plugins.snap")" = 600 ] && [ "$(mode "$D/plugins.manifest")" = 600 ] && ok "mode 600" || bad "mode $(mode "$D/plugins.snap") / $(mode "$D/plugins.manifest")"
ls "$D" | grep -q '\.new$' && bad "temp files left behind" || ok "no temp files left"

printf '# MATCHI_PLUGIN_SNAP=1\nT B.js\nP /data/local/bbb\n' > "$work/s2"
render "$work/s2" "$work/m1" "$work/w2.sh"
sh "$work/w2.sh" >/dev/null 2>&1
cmp -s "$D/plugins.snap" "$work/s2" && ok "second write replaces the first" || bad "second write did not replace"

render "$work/s1" "$work/m1" "$work/w3.sh" 1       # expects one byte more than is written
out=$(sh "$work/w3.sh" 2>&1)
echo "$out" | grep -q '^ERROR=.*not written completely' && cmp -s "$D/plugins.snap" "$work/s2" && ls "$D" | grep -vq '\.new$' && ok "short write refused, old snapshot kept" || bad "short write: $out"
[ -z "$(ls "$D" | grep '\.new$')" ] && ok "short write leaves no temp file" || bad "temp file after a short write"

mv "$D" "$D.away"
out=$(sh "$work/w1.sh" 2>&1)
echo "$out" | grep -q '^ERROR=.*folder is missing' && [ ! -e "$D" ] && ok "missing reaper folder refused (nothing created)" || bad "missing folder: $out"
mkdir -p "$work/elsewhere"; ln -s "$work/elsewhere" "$D"
out=$(sh "$work/w1.sh" 2>&1)
echo "$out" | grep -q '^ERROR=.*symlink' && [ -z "$(ls -A "$work/elsewhere")" ] && ok "symlinked reaper folder refused, nothing written through it" || bad "symlink trap: $out"
rm -f "$D"; mv "$D.away" "$D"
mv "$B" "$B.real"; ln -s "$work/elsewhere" "$B"
out=$(sh "$work/w1.sh" 2>&1)
echo "$out" | grep -q '^ERROR=.*symlink' && [ -z "$(ls -A "$work/elsewhere")" ] && ok "symlinked matchitool folder refused" || bad "symlink trap (base): $out"
rm -f "$B"; mv "$B.real" "$B"
out=$(FAKE_STAT_UID=1000 sh "$work/w1.sh" 2>&1)
echo "$out" | grep -q '^ERROR=.*not owned by root' && ok "folder owned by someone else refused" || bad "owner trap: $out"
rm -rf "$B" "$work/elsewhere"

# ======================================================================== B. the reaper reads it
mkdir -p "$work/decoy"
LONG="$(printf 'L%.0s' $(seq 1 76)).js"        # an 80 character plugin file name: the reaper must accept it as a tag
GOOD="touch $work/marker_good"; NOTPINNED="touch $work/marker_bad"
world() {   # a fresh fake phone: the app is gone, root-side leftovers are there
  rm -rf "$work/data" "$work/fw".* "$work/marker_good" "$work/marker_bad" "$work/elsewhere"
  mkdir -p "$work/data/local/tmp" "$work/data/adb/service.d" "$D" "$work/elsewhere"
  echo x > "$B/boot.sh"; echo x > "$work/data/local/keep.txt"; echo x > "$work/data/local/tmp/curl"
  mkdir -p "$work/data/local/dnsplug"; echo x > "$work/data/local/dnsplug/f"; echo x > "$work/data/local/tmp/dnsplug.log"; echo x > "$work/data/local/dnsboot.sh"
  echo x > "$work/data/local/b"; ln -s "$work/elsewhere" "$work/data/local/linkdir"; echo x > "$work/elsewhere/x"
  echo x > "$work/data/adb/service.d/other.sh"
  cat > "$work/fw.iptables" <<FW
nat|-N DNS_CH
nat|-A DNS_CH -p udp --dport 53 -j RETURN
nat|-A PREROUTING -j DNS_CH
nat|-A PREROUTING -i br0 -p udp --dport 53 -j REDIRECT --to-ports 5353
nat|-A PREROUTING -i br0 -p tcp --dport 80 -j REDIRECT --to-ports 8080
nat|-N FOREIGN_CH
nat|-N MY-CH
nat|-A PREROUTING -j FOREIGN_CH
mangle|-A POSTROUTING -o rmnet+ -j TTL --ttl-set 65
filter|-A INPUT -i br0 -p tcp -m tcp --dport 2334 -j ACCEPT
filter|-A INPUT -p tcp --dport 22 -j ACCEPT
FW
  : > "$work/fw.ip6tables"
}
snapfile() {
  cat > "$work/snap" <<SNAP
# MATCHI_PLUGIN_SNAP=1
T Dns_Plugin.js
T $LONG
P /data/local/dnsplug
P /data/local/tmp/dnsplug.log
P /data/local/tmp/curl
P /data/local/matchitool/x
P /sdcard/x
P /data/local/a/../b
P /data/local/linkdir/x
B /data/local/dnsboot.sh
C nat DNS_CH iptables
C nat INPUT iptables
C nat MY-CH iptables
R iptables nat PREROUTING -i br0 -p udp --dport 53 -j REDIRECT --to-ports 5353
R iptables mangle POSTROUTING -o rmnet+ -j TTL --ttl-set 65
R iptables nat PREROUTING -p tcp ; id
R iptables filter INPUT -p tcp --dport 22 -j ACCEPT; touch $work/marker_bad
X $GOOD
X $NOTPINNED
SNAP
  printf '# MATCHI_PLUGIN_MANIFEST=1\n%s\n' "${1:-$(sha "$GOOD")}" > "$work/manifest"
}
start_decoys() {
  MATCHI_PLUGIN=Dns_Plugin.js sleep 300 & d1=$!
  MATCHI_PLUGIN="$LONG" sleep 300 & d2=$!
  MATCHI_PLUGIN=Other.js sleep 300 & d3=$!
  sleep 300 & d4=$!
  sleep 1
}
stop_decoys() { kill $d1 $d2 $d3 $d4 2>/dev/null; wait $d1 $d2 $d3 $d4 2>/dev/null; }
alive() { st=$(ps -o stat= -p "$1" 2>/dev/null); [ -n "$st" ] || return 1; case $st in Z*) return 1;; esac; return 0; }
fw() { cat "$work/fw.iptables" 2>/dev/null; }
wipe() { env MR_ROOT="$work" "$@" sh "$REAPER" wipe; }
setup_case() {   # snapshot written through the real writer, decoys started
  world; snapfile "${1:-}"
  render "$work/snap" "$work/manifest" "$work/w.sh"; sh "$work/w.sh" >/dev/null 2>&1
  start_decoys
}

# ---- B1: everything in the snapshot is taken away, nothing else
setup_case
alive $d1 && alive $d2 && alive $d3 && alive $d4 && ok "decoys are running before the wipe" || bad "decoys did not start"
wipe; rc=$?
[ "$rc" = 0 ] && ok "reaper wipe finished clean (exit 0)" || bad "wipe exit code $rc"
fw | grep -q 'DNS_CH' && bad "plugin chain DNS_CH (and its jump) still there" || ok "plugin chain and its jump rule removed"
fw | grep -q 'nat|-A PREROUTING -i br0 -p udp --dport 53 -j REDIRECT --to-ports 5353' && bad "DNS redirect rule still there" || ok "DNS redirect removed by its exact text"
fw | grep -q 'nat|-A PREROUTING -i br0 -p tcp --dport 80' && ok "other PREROUTING rule (other text) kept" || bad "unrelated PREROUTING rule removed"
fw | grep -q 'mangle|-A POSTROUTING -o rmnet+' && bad "rule with a + interface still there" || ok "rule with a + interface removed"
fw | grep -q 'FOREIGN_CH' && ok "foreign chain kept" || bad "foreign chain removed"
fw | grep -q 'MY-CH' && ok "chain name with a dash ignored (reaper rule)" || bad "dash chain was touched"
fw | grep -q 'filter|-A INPUT -p tcp --dport 22 -j ACCEPT' && ok "INPUT rule on port 22 kept (bad hand-edited R line did nothing)" || bad "INPUT rule 22 removed"
fw | grep -q 'dport 2334' && bad "console port rule still there" || ok "console port rule removed (fixed registry)"
[ ! -e "$work/data/local/dnsplug" ] && [ ! -e "$work/data/local/tmp/dnsplug.log" ] && ok "ledger paths removed" || bad "ledger path left"
[ -f "$work/data/local/tmp/curl" ] && ok "curl in /data/local/tmp kept even though a line named it" || bad "curl removed"
[ -f "$work/data/local/b" ] && ok "a path with .. did nothing" || bad "path with .. removed a file"
[ -f "$work/elsewhere/x" ] && ok "a path below a symlinked folder did nothing" || bad "removed through a symlinked parent"
[ -f "$work/data/local/keep.txt" ] && [ -f "$work/data/adb/service.d/other.sh" ] && ok "unrelated files kept" || bad "unrelated file removed"
[ ! -e "$work/data/local/dnsboot.sh" ] && ok "boot file removed" || bad "boot file left"
[ -f "$work/marker_good" ] && ok "approved stop command ran" || bad "approved stop command did not run"
[ ! -e "$work/marker_bad" ] && ok "stop command that is not in the manifest did not run" || bad "unpinned command ran"
! alive $d1 && ok "process with the plugin tag stopped" || bad "tagged process still running"
! alive $d2 && ok "process with an 80 character tag stopped" || bad "long-tag process still running"
alive $d3 && ok "process with another tag left alone" || bad "foreign-tagged process killed"
alive $d4 && ok "plain process left alone" || bad "plain process killed"
[ ! -e "$B" ] && ok "matchitool folder, reaper folder and snapshot gone after a clean wipe" || bad "folder left: $(ls -A "$B")"
stop_decoys

# ---- B2: a changed manifest: the command does not run, everything else is wiped
setup_case "$(sha 'something else')"
wipe >/dev/null 2>&1
[ ! -e "$work/marker_good" ] && ok "manifest without the command's hash: command skipped" || bad "command ran without a matching hash"
[ ! -e "$work/data/local/dnsplug" ] && ! fw | grep -q DNS_CH && ok "same wipe still removed paths and chains" || bad "wipe incomplete after a manifest mismatch"
stop_decoys

# ---- B3: the snapshot is not trusted (wrong owner / wrong mode / a symlink): skipped as a whole, the fixed registry is still wiped
for variant in owner mode symlink; do
  setup_case
  case $variant in
    symlink) mv "$D/plugins.snap" "$work/realsnap"; ln -s "$work/realsnap" "$D/plugins.snap"; envs="env FAKE_STAT_UID=0";;
    owner) envs="env MR_OWNER_UID=1000";;
    mode) envs="env FAKE_STAT_MODE=-rw-rw-rw-";;
  esac
  $envs env MR_ROOT="$work" sh "$REAPER" wipe >/dev/null 2>&1
  if fw | grep -q 'DNS_CH' && [ -d "$work/data/local/dnsplug" ] && [ ! -e "$work/marker_good" ]; then ok "snapshot not trusted ($variant): nothing taken from it"; else bad "snapshot used although not trusted ($variant)"; fi
  [ ! -e "$B/boot.sh" ] && ! fw | grep -q 'dport 2334' && ok "... and the fixed registry was still wiped ($variant)" || bad "fixed registry not wiped ($variant)"
  stop_decoys
done

# ======================================================================== C. path rule parity (reaper plugin_path_ok vs PluginSnapshotTest.PATH_CASES)
python3 - "$REAPER" "$TESTKT" "$work" <<'PY' || { bad "could not build the parity test"; }
import re, sys
reaper, testkt, work = sys.argv[1:4]
r = open(reaper).read()
m = re.search(r'^plugin_path_ok\(\) \{\n.*?^\}\n', r, re.S | re.M)
assert m, 'plugin_path_ok not found'
open(work + '/pp.sh', 'w').write('R=' + work + '/nonexistent\n' + m.group(0))
t = open(testkt).read()
blk = re.search(r'val PATH_CASES.*?\n        \)\n', t, re.S).group(0)
cases = re.findall(r'^\s*"((?:[^"\\]|\\.)*)" to (true|false),$', blk, re.M)
assert len(cases) > 20, len(cases)
with open(work + '/cases.txt', 'w') as f:
    for p, want in cases:
        p = p.replace('\\$', '$').replace('\\\\', '\\')
        f.write(want + '|' + p + '\n')
PY
if [ -f "$work/pp.sh" ]; then
  . "$work/pp.sh"
  n=0; wrong=0
  while IFS= read -r line; do
    want=${line%%|*}; p=${line#*|}
    if plugin_path_ok "$p"; then got=true; else got=false; fi
    n=$((n + 1))
    [ "$got" = "$want" ] || { echo "     path rule differs for '$p': Kotlin says $want, reaper says $got"; wrong=$((wrong + 1)); }
  done < "$work/cases.txt"
  [ "$wrong" = 0 ] && ok "reaper plugin_path_ok agrees with snapPathOk on all $n cases" || bad "$wrong path case(s) differ"
fi

[ "$fail" = 0 ] && echo "reaper snapshot test passed" || exit 1

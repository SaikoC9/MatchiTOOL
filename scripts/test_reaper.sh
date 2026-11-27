#!/bin/bash
# Phase 7 test (A): the uninstall reaper's wipe decision and safety rules, in a fake root folder (no device needed).
# Runs the REAL assets/bin/matchi_reaper.sh ("wipe" mode, MR_ROOT) against a fake getprop / pm / iptables / tc / stat and real decoy processes.
# Complements test_reaper_install.sh (install, update, stub, end to end) and test_reaper_snapshot.sh (plugin snapshot, path parity). Checks:
#   "gone" must be certain: app data present, device-encrypted data present, APK folder present, fresh updating marker, early boot (boot_completed=0,
#       ce_available=false), pm path with text / a bad exit code / a path = NOTHING is deleted (exit 2);
#   a clean wipe: boot entries, console rule, tc, files, stub, reaper folder, log gone; unrelated files and foreign firewall rules stay; second run changes nothing;
#   reinstall during the wipe (the data folder appears after the rules step): the wipe stops, files and tc are not touched;
#   symlinked matchitool folder: refused, the target stays; a foreign tc setup stays and only our filter priorities go;
#   a step that fails: stub, reaper folder and one-line log stay (exit 1), the next run finishes clean and removes them; the retry limit stops it;
#   the reaper does not kill its parent shell even when that is named like one of our programs, and ends a real decoy of that name.
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
sh -n "$REAPER" || { echo "FAIL reaper does not parse"; exit 1; }

# ---- fakes (controlled through files in $work/ctl)
mkdir -p "$work/bin" "$work/ctl" "$work/decoy"
cat > "$work/bin/getprop" <<'F'
#!/bin/sh
d=$FAKE_CTL
case "$1" in sys.boot_completed) cat "$d/boot" 2>/dev/null || echo 1;; sys.user.0.ce_available) cat "$d/ce" 2>/dev/null || echo true;; *) echo;; esac
F
cat > "$work/bin/pm" <<'F'
#!/bin/sh
d=$FAKE_CTL
[ -f "$d/pm_out" ] && cat "$d/pm_out"
exit "$(cat "$d/pm_rc" 2>/dev/null || echo 1)"
F
cat > "$work/bin/ps" <<'F'
#!/bin/sh
[ "$*" = "-A -o PID,ARGS" ] && exec /usr/bin/ps -A -o pid,args
exec /usr/bin/ps "$@"
F
cat > "$work/bin/stat" <<'F'
#!/bin/sh
case "$2" in %u) echo 0;; *) echo "0 drwx------";; esac
F
cat > "$work/bin/iptables" <<'F'
#!/usr/bin/env python3
import sys, os
st = os.environ['FW_STATE'] + '.' + os.path.basename(sys.argv[0])
a = [x for x in sys.argv[1:]]; o = []; i = 0
while i < len(a):
    if a[i] == '-w':
        i += 1
        if i < len(a) and a[i].isdigit(): i += 1
        continue
    o.append(a[i]); i += 1
a = o; table = 'filter'
if len(a) >= 2 and a[0] == '-t': table = a[1]; a = a[2:]
# test hook: the app is "reinstalled" the first time the rule list is read
hook = os.environ.get('FAKE_CTL', '') + '/reinstall_on_iptables'
if os.path.exists(hook):
    os.makedirs(open(hook).read().strip(), exist_ok=True); os.remove(hook)
lines = [l.rstrip('\n') for l in open(st)] if os.path.exists(st) else []
def save(): open(st, 'w').write(''.join(l + '\n' for l in lines))
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
    lines = [l for l in lines if not l.startswith(table + '|-A ' + rest[0] + ' ')]; save(); sys.exit(0)
if op == '-X':
    c = rest[0]
    if (table + '|-N ' + c) not in lines: sys.exit(1)
    for l in lines:
        if l.startswith(table + '|-A ' + c + ' ') or l.endswith(' -j ' + c): sys.exit(1)
    lines.remove(table + '|-N ' + c); save(); sys.exit(0)
sys.exit(2)
F
cp "$work/bin/iptables" "$work/bin/ip6tables"
# fake tc: state "qdisc|DEV|TEXT" and "filter|DEV|PRIO" (parent ffff:), every call logged; "qdisc del" fails while ctl/tc_fail exists
cat > "$work/bin/tc" <<'F'
#!/usr/bin/env python3
import sys, os
d = os.environ['FAKE_CTL']; st = d + '/tc_state'; a = sys.argv[1:]
open(d + '/tc_calls', 'a').write(' '.join(a) + '\n')
lines = [l.rstrip('\n') for l in open(st)] if os.path.exists(st) else []
def save(): open(st, 'w').write(''.join(l + '\n' for l in lines))
if a[:2] == ['qdisc', 'show']:
    dev = a[3]
    for l in lines:
        k, dv, t = l.split('|', 2)
        if k == 'qdisc' and dv == dev: print('qdisc ' + t)
    sys.exit(0)
if a[:2] == ['filter', 'show']:
    dev = a[3]
    for l in lines:
        k, dv, t = l.split('|', 2)
        if k == 'filter' and dv == dev: print('filter protocol ip pref %s u32 chain 0' % t)
    sys.exit(0)
if a[:2] == ['filter', 'del']:
    dev = a[3]; p = a[a.index('prio') + 1]
    lines = [l for l in lines if l != 'filter|%s|%s' % (dev, p)]; save(); sys.exit(0)
if a[:2] == ['qdisc', 'del']:
    if os.path.exists(d + '/tc_fail'): sys.exit(2)
    dev = a[3]; lines = [l for l in lines if not (l.startswith('qdisc|%s|' % dev))]; save(); sys.exit(0)
sys.exit(2)
F
chmod +x "$work/bin/"*
export PATH="$work/bin:$PATH" FW_STATE="$work/fw" FAKE_CTL="$work/ctl" MR_WATCH_S=1 MR_CONFIRM_S=1 MR_SETTLE_S=0 MR_RETRY_S=2

B="$work/data/local/matchitool"; D="$B/reaper"; STUB="$work/data/adb/service.d/matchi_reaper.sh"; LOGD="$work/data/adb/service.d/matchi_logd.sh"; LOGF="$work/data/local/matchitool-uninstall.log"
PKG=com.matchi.tool
fw() { cat "$work/fw.iptables" 2>/dev/null; }
tcs() { cat "$work/ctl/tc_state" 2>/dev/null; }
wipe() { env MR_ROOT="$work" sh "$REAPER" wipe; }
alive() { st=$(ps -o stat= -p "$1" 2>/dev/null); [ -n "$st" ] || return 1; case $st in Z*) return 1;; esac; return 0; }

world() {   # a fresh fake phone: the app is gone, everything root-side is still there
  rm -rf "$work/data" "$work/elsewhere" "$work"/fw.* "$work/ctl"/* "$work/parent_done" "$work/parent_rc"
  mkdir -p "$work/data/local/tmp" "$work/data/adb/service.d" "$work/data/app" "$D" "$B/bootlogs" "$B/boot.d" "$work/elsewhere"
  echo x > "$B/boot.sh"; echo x > "$B/boot.d/p.sh"; echo x > "$B/bootlogs/a.log"; echo x > "$B/keepme"
  echo x > "$D/matchi_reaper.sh"; echo x > "$STUB"; echo x > "$LOGD"; echo x > "$work/data/adb/service.d/other.sh"
  echo x > "$work/data/local/tmp/mt_isms.sh"; echo x > "$work/data/local/tmp/curl"; echo x > "$work/data/local/keep.txt"
  for bd in matchi_ttl matchi_dpi matchi_lock matchi_boot; do mkdir -p "$work/data/local/$bd"; echo x > "$work/data/local/$bd/f"; done
  mkdir -p "$work/data/local/adguardhome/data" "$work/data/local/adguardhome2"; echo x > "$work/data/local/adguardhome/data/f"; echo x > "$work/data/local/adguardhome2/f"
  echo x > "$work/elsewhere/x"
  cat > "$work/fw.iptables" <<FW
filter|-A INPUT -i br0 -p tcp -m tcp --dport 2334 -j ACCEPT
filter|-A INPUT -i usb0 -p tcp -m tcp --dport 2334 -j ACCEPT
filter|-A INPUT -i wlan0 -p tcp -m tcp --dport 2334 -j ACCEPT
filter|-A INPUT -p tcp --dport 22 -j ACCEPT
nat|-A PREROUTING -i br0 -p tcp --dport 80 -j REDIRECT --to-ports 8080
FW
  : > "$work/fw.ip6tables"
  printf 'qdisc|br0|htb 1: root refcnt 2 r2q 10\nfilter|wlan0|1005\nfilter|wlan0|1300\nfilter|wlan0|5\nfilter|usb0|2000\nfilter|usb0|1255\n' > "$work/ctl/tc_state"
  echo 1 > "$work/ctl/boot"; echo true > "$work/ctl/ce"; echo 1 > "$work/ctl/pm_rc"
}
untouched() {   # nothing of ours was deleted
  [ -f "$B/boot.sh" ] && [ -f "$B/keepme" ] && [ -f "$D/matchi_reaper.sh" ] && [ -f "$STUB" ] && [ -f "$LOGD" ] && [ -f "$work/data/local/tmp/mt_isms.sh" ] \
    && fw | grep -q 'dport 2334' && tcs | grep -q 'htb 1:' && [ ! -e "$LOGF" ]
}

# ======================================================================== A. "gone" must be certain
refuse() {   # name, then the setup is already done: the wipe must exit 2 and delete nothing
  wipe; rc=$?
  [ "$rc" = 2 ] && untouched && ok "$1: nothing deleted (exit 2)" || bad "$1: exit $rc, untouched=$(untouched && echo yes || echo no)"
}
world; mkdir -p "$work/data/data/$PKG";            refuse "app data present (/data/data)"
world; mkdir -p "$work/data/user_de/0/$PKG";       refuse "device-encrypted data present (/data/user_de)"
world; mkdir -p "$work/data/app/~~x/$PKG-1";       refuse "APK folder present (/data/app/*/pkg-*)"
world; mkdir -p "$work/data/app/$PKG-1";           refuse "APK folder present (old layout)"
world; echo "$(date +%s)" > "$B/updating";         wipe; rc=$?
[ "$rc" = 2 ] && [ -f "$B/boot.sh" ] && [ -f "$STUB" ] && ok "fresh updating marker: nothing deleted" || bad "updating marker ignored (exit $rc)"
world; echo $(( $(date +%s) - 3600 )) > "$B/updating"; wipe; rc=$?
[ "$rc" = 0 ] && [ ! -e "$B" ] && ok "old updating marker (1 h): does not stop the wipe" || bad "stale marker blocked the wipe (exit $rc)"
world; echo 0 > "$work/ctl/boot";                  refuse "early boot: boot_completed=0, app data not visible yet"
world; echo false > "$work/ctl/ce";                refuse "early boot: user storage not unlocked (ce_available=false)"
world; echo "Error: package service not running" > "$work/ctl/pm_out"; refuse "pm path prints an error"
world; echo "package:/data/app/x/base.apk" > "$work/ctl/pm_out"; echo 0 > "$work/ctl/pm_rc"; refuse "pm path still finds the package"
world; echo 255 > "$work/ctl/pm_rc";               refuse "pm path exits 255 with no text"
world; echo 0 > "$work/ctl/pm_rc";                 wipe; rc=$?
[ "$rc" = 0 ] && ok "pm path exit 0 with no text counts as gone (same as exit 1)" || bad "pm exit 0 / no text: exit $rc"

# ======================================================================== B. a clean wipe, and a second run
world
start() { MATCHI_PLUGIN=Other.js sleep 300 & d3=$!; sleep 300 & d4=$!; ln -sf /bin/sleep "$work/decoy/matchi-guard"; "$work/decoy/matchi-guard" 300 & d1=$!
  ln -sf /bin/sleep "$work/decoy/AdGuardHome"; "$work/decoy/AdGuardHome" 300 & d5=$!
  printf 'while :; do mkdir -p "%s/data/local/matchi_lock"; sleep 0.2; done\n' "$work" > "$work/data/local/matchi_ttl/ttl.sh"   # Bypass watch loop that recreates the lock folder
  sh "$work/data/local/matchi_ttl/ttl.sh" watch & d6=$!; sleep 1; }
start
wipe; rc=$?
[ "$rc" = 0 ] && ok "wipe finished clean (exit 0)" || bad "wipe exit $rc"
[ ! -e "$B" ] && [ ! -e "$STUB" ] && [ ! -e "$LOGD" ] && [ ! -e "$LOGF" ] && [ ! -e "$work/data/local/tmp/mt_isms.sh" ] && ok "folder, reaper, both boot scripts, log and legacy temp file gone" || bad "left: $(find "$work/data" -name '*atchi*' -o -name 'mt_*' | tr '\n' ' ')"
fw | grep -q -e '-i br0 .*dport 2334' -e '-i usb0 .*dport 2334' && bad "console port rule still there" || ok "console port rules removed (br0 and usb0: hotspot / tether side)"
fw | grep -q '\-i wlan0 .*dport 2334' && ok "rule on wlan0 (not a hotspot-side interface) is not ours to remove" || bad "wlan0 rule removed"
fw | grep -q 'dport 22 ' && fw | grep -q 'dport 80' && ok "other firewall rules kept" || bad "foreign firewall rule removed"
tcs | grep -q 'qdisc|br0' && bad "our htb root qdisc still there" || ok "our htb 1: root qdisc removed"
tcs | grep -q 'filter|wlan0|1005' || tcs | grep -q 'filter|usb0|1255' && bad "our ingress filter still there" || ok "our ingress filters (1005, 1300, 1255) removed"
tcs | grep -q 'filter|wlan0|5$' && tcs | grep -q 'filter|usb0|2000' && ok "foreign ingress filters (prio 5, 2000) kept" || bad "foreign ingress filter removed"
! alive $d1 && ok "program named matchi-guard stopped" || bad "matchi-guard decoy still running"
! alive $d5 && ok "program named AdGuardHome stopped" || bad "AdGuardHome decoy still running"
[ ! -e "$work/data/local/adguardhome" ] && ok "AdGuard Home data folder removed (even with an empty plugin snapshot)" || bad "adguardhome folder left"
[ -f "$work/data/local/adguardhome2/f" ] && ok "look-alike folder adguardhome2 kept" || bad "adguardhome2 removed"
! alive $d6 && ok "Bypass script loop (matchi_ttl/ttl.sh watch) stopped" || bad "Bypass script loop still running"
sleep 1; [ ! -e "$work/data/local/matchi_lock" ] && ok "matchi_lock stays gone (nothing recreates it)" || bad "matchi_lock came back"
alive $d3 && alive $d4 && ok "other tag and plain process left alone" || bad "unrelated process killed"
[ ! -e "$work/data/local/matchi_ttl" ] && [ ! -e "$work/data/local/matchi_dpi" ] && [ ! -e "$work/data/local/matchi_lock" ] && [ ! -e "$work/data/local/matchi_boot" ] && ok "Bypass folders (matchi_ttl, matchi_dpi, matchi_lock, matchi_boot) removed" || bad "Bypass folders left: $(ls "$work/data/local" | tr '\n' ' ')"
[ -f "$work/data/local/keep.txt" ] && [ -f "$work/data/local/tmp/curl" ] && [ -f "$work/data/adb/service.d/other.sh" ] && ok "unrelated files kept" || bad "unrelated file removed"
cp "$work/fw.iptables" "$work/fw.before"; tcs > "$work/tc.before"; find "$work/data" | sort > "$work/tree.before"
wipe; rc=$?
find "$work/data" | sort > "$work/tree.after"
[ "$rc" = 0 ] && cmp -s "$work/fw.before" "$work/fw.iptables" && [ "$(tcs)" = "$(cat "$work/tc.before")" ] && cmp -s "$work/tree.before" "$work/tree.after" && ok "second run changes nothing (exit 0)" || bad "second run: exit $rc or something changed"
kill $d3 $d4 $d5 $d6 2>/dev/null; wait $d3 $d4 $d5 $d6 2>/dev/null

# ======================================================================== C. reinstall during the wipe
world; echo "$work/data/data/$PKG" > "$work/ctl/reinstall_on_iptables"
wipe; rc=$?
[ "$rc" = 2 ] && ok "app came back after the rules step: wipe stopped (exit 2)" || bad "reinstall mid-wipe: exit $rc"
[ -f "$B/keepme" ] && [ -f "$B/bootlogs/a.log" ] && [ -f "$work/data/local/tmp/mt_isms.sh" ] && ok "... data files were not deleted" || bad "files deleted after the app came back"
tcs | grep -q 'htb 1:' && ok "... traffic control was not touched" || bad "tc cleaned after the app came back"
[ -f "$D/matchi_reaper.sh" ] && [ -f "$STUB" ] && ok "... reaper and stub stay for the reinstalled app" || bad "reaper or stub deleted"
[ ! -e "$B/boot.sh" ] && ok "(boot entries go first, by design: they are the first step)" || bad "boot.sh still there"

# ======================================================================== D. traps: symlinked folder, foreign tc
world; rm -rf "$B"; ln -s "$work/elsewhere" "$B"
wipe; rc=$?
[ "$rc" = 1 ] && [ -f "$work/elsewhere/x" ] && ok "matchitool folder is a symlink: target untouched, wipe reports incomplete (exit 1)" || bad "symlink trap: exit $rc, target $(ls "$work/elsewhere" 2>&1 | tr '\n' ' ')"
world; printf 'qdisc|br0|fq_codel 0: root refcnt 2\nfilter|wlan0|1005\n' > "$work/ctl/tc_state"; : > "$work/ctl/tc_calls"
wipe; rc=$?
grep -q 'qdisc del' "$work/ctl/tc_calls" && bad "tc qdisc del was called for a qdisc that is not htb 1:" || ok "foreign root qdisc (fq_codel): never deleted"
tcs | grep -q 'fq_codel' && ok "foreign root qdisc still there" || bad "foreign qdisc gone"
tcs | grep -q 'filter|wlan0|1005' && bad "our filter prio 1005 stayed" || ok "our filter priority still removed on its own"
world; rm -f "$work/ctl/tc_state"; wipe; rc=$?
[ "$rc" = 0 ] && ok "no tc state at all: wipe finishes clean" || bad "no tc state: exit $rc"

# ======================================================================== E. a failing step: keep the stub, retry, finish
world; touch "$work/ctl/tc_fail"
wipe; rc=$?
[ "$rc" = 1 ] && ok "tc cannot be removed: wipe reports incomplete (exit 1)" || bad "failing step: exit $rc"
[ -f "$STUB" ] && [ -f "$D/matchi_reaper.sh" ] && ok "... boot stub and reaper stay for the retry" || bad "stub or reaper deleted before the wipe was clean"
[ -f "$LOGF" ] && [ "$(wc -l < "$LOGF")" = 1 ] && grep -q 'retry=1' "$LOGF" && grep -q 'tc-root' "$LOGF" && ok "... one-line log names the leftover (retry=1, tc-root)" || bad "log: $(cat "$LOGF" 2>&1)"
[ ! -e "$B/keepme" ] && [ ! -e "$B/boot.sh" ] && ok "... everything else was still wiped" || bad "other files were not wiped"
wipe; rc=$?; grep -q 'retry=2' "$LOGF" && ok "second failing run counts retry=2 (the counter is not reset by helper loops)" || bad "retry counter: $(cat "$LOGF" 2>&1)"
rm -f "$work/ctl/tc_fail"
wipe; rc=$?
[ "$rc" = 0 ] && [ ! -e "$STUB" ] && [ ! -e "$D" ] && [ ! -e "$LOGF" ] && [ ! -e "$B" ] && ok "next run is clean: stub, reaper folder, log and folder removed" || bad "retry did not finish (exit $rc): $(find "$work/data" -name '*atchi*' | tr '\n' ' ')"
world; touch "$work/ctl/tc_fail"
for i in 1 2 3 4 5; do wipe >/dev/null; done
grep -q 'retry=5' "$LOGF" && ok "five failing runs in a row reach retry=5" || bad "counter after 5 runs: $(cat "$LOGF" 2>&1)"
world; touch "$work/ctl/tc_fail"; echo "2026-01-01 00:00:00 retry=5 left=tc-root " > "$LOGF"
wipe; rc=$?
[ "$rc" = 0 ] && [ -f "$STUB" ] && [ -f "$B/keepme" ] && ok "after 5 tries it gives up and stops (exit 0), touching nothing more" || bad "retry limit: exit $rc"

# ======================================================================== F. the reaper never kills itself or its parent
world
ln -sf /bin/sh "$work/decoy/matchi-guard"
"$work/decoy/matchi-guard" -c "env MR_ROOT='$work' sh '$REAPER' wipe; echo \$? > '$work/parent_rc'; echo done > '$work/parent_done'" &
pp=$!
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do [ -f "$work/parent_done" ] && break; sleep 1; done
[ -f "$work/parent_done" ] && [ "$(cat "$work/parent_rc")" = 0 ] && ok "parent shell named matchi-guard survived the wipe and saw exit 0" || bad "parent was killed or the wipe failed (rc=$(cat "$work/parent_rc" 2>&1))"
wait $pp 2>/dev/null
[ ! -e "$B" ] && ok "... and the wipe itself was complete" || bad "wipe incomplete with a same-named parent"

[ "$fail" = 0 ] && echo "reaper wipe tests passed" || { echo "reaper wipe tests FAILED"; exit 1; }

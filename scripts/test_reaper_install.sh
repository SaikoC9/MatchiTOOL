#!/bin/bash
# Phase 4 test: install and lifecycle of the uninstall reaper, in a fake root folder (no device needed).
# Runs the REAL install / remove / status scripts from ReaperModel.kt (text extracted from the source, "/data/" pointed at a temp folder) together
# with the REAL assets/bin/matchi_reaper.sh. Checks:
#   install: one detached daemon, files and modes, boot stub; install again (= app update): still exactly one daemon, nothing wiped;
#   app present or "updating" marker fresh: nothing wiped; boot stub: starts no second daemon, removes itself when the reaper file is gone;
#   status script; switch OFF (remove): daemon stopped, stub and reaper folder gone, unrelated files kept;
#   symlink traps refused; a short write is refused and the old daemon keeps running;
#   end to end: app removed -> everything wiped, reaper and stub deleted, daemon gone, unrelated files kept; reinstall after that works;
#   processes: a program named like ours (matchi-guard) and a boot-tagged one are stopped, a foreign-tagged and a plain one are not;
#   no read of /proc/PID/cmdline anywhere (it never reaches end of file on the F50 kernel, docs/PLUGIN_RULES.md rule 2).
set -u
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
work=$(mktemp -d)
fail=0
ok()  { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
cleanup() {
  for p in $(pgrep -f "$work/data/local/matchitool/reaper/matchi_reaper.sh" 2>/dev/null); do kill -9 "$p" 2>/dev/null; done
  rm -rf "$work"
}
trap cleanup EXIT

python3 - "$root" "$work" <<'PY' || exit 1
import re, sys
root, work = sys.argv[1], sys.argv[2]
src = open(root + '/app/src/main/java/com/matchi/tool/ReaperModel.kt').read()
reaper = open(root + '/app/src/main/assets/bin/matchi_reaper.sh').read()
assert '\u00a7' not in reaper
def raw(name):
    m = re.search(r'private const val ' + name + r' = """\n?(.*?)"""', src, re.S)
    assert m, name
    return m.group(1)
fn = raw('RUNNING_FN')
def build(name, size_delta=0):
    t = raw(name).replace('$RUNNING_FN', fn).replace('\u00a7', '$').replace('/data/', work + '/data/')   # point the template at the temp folder
    body = reaper.rstrip('\n').replace('/data/', work + '/data/')                                           # ... and the script text inside it
    size = len(body.encode()) + 1 + size_delta                                                              # size of what the here-document writes
    t = t.replace('@@SIZE@@', str(size)).replace('@@REAPER_SCRIPT@@', body)
    assert '$RUNNING_FN' not in t
    return t
open(work + '/install.sh', 'w').write(build('INSTALL_TEMPLATE'))
open(work + '/install_short.sh', 'w').write(build('INSTALL_TEMPLATE', 1))   # expects one byte more than is written
open(work + '/remove.sh', 'w').write(build('REMOVE_SCRIPT'))
open(work + '/status.sh', 'w').write(build('STATUS_SCRIPT'))
PY

# fake phone commands
mkdir -p "$work/bin" "$work/data/local/tmp" "$work/data/adb/service.d" "$work/data/data/com.matchi.tool"
printf '#!/bin/sh\ncase "$1" in sys.boot_completed) echo 1;; sys.user.0.ce_available) echo true;; *) echo;; esac\n' > "$work/bin/getprop"
printf '#!/bin/sh\nexit 1\n' > "$work/bin/pm"                      # "pm path" of a missing package: no text, exit 1
printf '#!/bin/sh\nexit 0\n' > "$work/bin/chcon"
# Android's ps (toybox) takes "-A -o PID,ARGS", which the repo uses on the phone; procps on a PC wants lower case. Emulate toybox for that one call.
cat > "$work/bin/ps" <<'FAKE'
#!/bin/sh
[ "$*" = "-A -o PID,ARGS" ] && exec /usr/bin/ps -A -o pid,args
exec /usr/bin/ps "$@"
FAKE
cat > "$work/bin/stat" <<'FAKE'
#!/bin/sh
case "$2" in %u) echo 0;; *) echo "0 drwx------";; esac
FAKE
chmod +x "$work/bin/"*
export PATH="$work/bin:$PATH" MR_WATCH_S=1 MR_CONFIRM_S=1 MR_SETTLE_S=0 MR_RETRY_S=2

B="$work/data/local/matchitool"; D="$B/reaper"; S="$D/matchi_reaper.sh"; STUB="$work/data/adb/service.d/matchi_reaper.sh"
APP="$work/data/data/com.matchi.tool"
count() { pgrep -f "$S watch" 2>/dev/null | wc -l | tr -d ' '; }
mode() { /usr/bin/stat -c %a "$1" 2>/dev/null; }   # the real stat (the fake one only answers the owner question)

alive() { st=$(ps -o stat= -p "$1" 2>/dev/null); [ -n "$st" ] || return 1; case $st in Z*) return 1;; esac; return 0; }

# the F50 kernel never reaches end of file when tr/cat/grep read /proc/PID/cmdline: neither the reaper nor its install scripts may do it
if grep -v '^[[:space:]]*#' "$root/app/src/main/assets/bin/matchi_reaper.sh" | grep -q '/cmdline'; then bad "matchi_reaper.sh reads /proc/PID/cmdline"; else ok "reaper script never reads /proc/PID/cmdline"; fi
if cat "$work/install.sh" "$work/remove.sh" "$work/status.sh" | grep -v '^[[:space:]]*#' | grep -q '/cmdline'; then bad "install/remove/status read /proc/PID/cmdline"; else ok "install, remove and status never read /proc/PID/cmdline"; fi

# unrelated things that must survive everything
echo keep > "$work/data/local/keep.txt"; echo keep > "$work/data/local/tmp/curl"; echo keep > "$work/data/adb/service.d/other.sh"

# --- install ---------------------------------------------------------------------------------------------------------------------------------
out=$(sh "$work/install.sh" 2>&1)
echo "$out" | grep -q '^INSTALLED=1' && echo "$out" | grep -q '^RUNNING=1' && ok "install reports installed and running" || { bad "install output: $out"; }
sed "s#/data/#$work/data/#g" "$root/app/src/main/assets/bin/matchi_reaper.sh" > "$work/expected_reaper.sh"
[ -f "$S" ] && cmp -s "$S" "$work/expected_reaper.sh" && ok "reaper written byte for byte (paths pointed at the temp folder)" || bad "reaper file differs from the asset"
[ "$(mode "$S")" = 700 ] && ok "reaper mode 700" || bad "reaper mode $(mode "$S")"
[ "$(mode "$D")" = 700 ] && ok "reaper folder mode 700" || bad "reaper folder mode $(mode "$D")"
[ -f "$STUB" ] && grep -q '^# MATCHI_REAPER_STUB=1' "$STUB" && [ "$(mode "$STUB")" = 755 ] && ok "boot stub written (755)" || bad "boot stub missing or wrong mode"
[ ! -e "$S.new" ] && [ ! -e "$STUB.new" ] && ok "no temp files left" || bad "temp files left behind"
[ "$(count)" = 1 ] && ok "ps shows exactly one reaper" || bad "reapers running: $(count)"
sleep 4
[ -d "$B" ] && [ -f "$S" ] && [ "$(count)" = 1 ] && ok "app present: nothing wiped, reaper still one process" || bad "reaper wiped or died while the app is present"

# --- status ----------------------------------------------------------------------------------------------------------------------------------
st=$(sh "$work/status.sh" 2>&1)
v=$(sed -n 's/^# MATCHI_REAPER_VERSION=//p' "$root/app/src/main/assets/bin/matchi_reaper.sh" | head -n 1)
echo "$st" | grep -q '^INSTALLED_SCRIPT=1' && echo "$st" | grep -q "^INSTALLED_VERSION=$v\$" && echo "$st" | grep -q '^RUNNING=1' && echo "$st" | grep -q '^STUB=1' && echo "$st" | grep -q '^STUB_VERSION=1' && ok "status: installed, version $v, running, stub 1" || bad "status output: $st"

# --- install again (what an app update does) -------------------------------------------------------------------------------------------------
old=$(cat "$D/watch.pid")
out=$(sh "$work/install.sh" 2>&1)
echo "$out" | grep -q '^RUNNING=1' && ok "second install running" || bad "second install: $out"
[ "$(count)" = 1 ] && ok "after install again: still exactly one reaper" || bad "reapers after reinstall: $(count)"
new=$(cat "$D/watch.pid"); [ "$new" != "$old" ] && ! kill -0 "$old" 2>/dev/null && ok "old daemon replaced (pid $old -> $new)" || bad "old daemon not replaced"
sleep 3; [ -d "$B" ] && ok "update: nothing wiped" || bad "wiped during update"

# --- update / downgrade: data dir stays (pm uninstall -k) and the marker is fresh; even with the data dir gone nothing is wiped ----------------
mv "$APP" "$APP.away"; date +%s > "$B/updating"
sleep 14      # a real wipe takes about 8 s here (3 looks, 1 s apart, plus the watch loop), so 14 s proves the marker held it back
[ -d "$B" ] && [ -f "$STUB" ] && [ "$(count)" = 1 ] && ok "fresh updating marker: nothing wiped though the data dir is missing" || bad "wiped while updating"
rm -f "$B/updating"; mv "$APP.away" "$APP"

# --- boot stub -------------------------------------------------------------------------------------------------------------------------------
sh "$STUB"; sleep 2
[ "$(count)" = 1 ] && ok "stub with a running reaper starts no second one" || bad "stub started a second reaper: $(count)"
sh "$work/remove.sh" >/dev/null 2>&1
[ "$(count)" = 0 ] || bad "daemon survived remove"
sh "$work/install.sh" >/dev/null 2>&1
kill "$(cat "$D/watch.pid")" 2>/dev/null; sleep 1
[ "$(count)" = 0 ] && sh "$STUB"; sleep 2
[ "$(count)" = 1 ] && ok "stub starts the reaper at boot when none runs" || bad "stub did not start the reaper (count $(count))"
# reaper file gone (wipe finished or removed by hand): the stub removes itself and starts nothing
kill "$(cat "$D/watch.pid")" 2>/dev/null; sleep 1; rm -f "$S"
sh "$STUB"; sleep 1
[ ! -e "$STUB" ] && [ "$(count)" = 0 ] && ok "stub removes itself when the reaper file is missing" || bad "stub stayed or started something"
[ -f "$work/data/adb/service.d/other.sh" ] && ok "stub left other service.d scripts alone" || bad "other service.d script removed"

# --- switch OFF (remove) ---------------------------------------------------------------------------------------------------------------------
sh "$work/install.sh" >/dev/null 2>&1
echo mine > "$B/boot.sh"
out=$(sh "$work/remove.sh" 2>&1)
echo "$out" | grep -q '^REMOVED=1' && ok "remove reports done" || bad "remove output: $out"
[ "$(count)" = 0 ] && [ ! -e "$STUB" ] && [ ! -e "$D" ] && ok "switch OFF: daemon stopped, stub and reaper folder gone" || bad "OFF left something (count $(count))"
[ -f "$B/boot.sh" ] && [ -f "$work/data/adb/service.d/other.sh" ] && ok "switch OFF touches nothing else" || bad "remove deleted more than the reaper"
out=$(sh "$work/remove.sh" 2>&1); echo "$out" | grep -q '^REMOVED=1' && ok "remove twice is harmless" || bad "second remove failed"

# --- traps -----------------------------------------------------------------------------------------------------------------------------------
mkdir -p "$work/elsewhere"; ln -s "$work/elsewhere" "$D"
out=$(sh "$work/install.sh" 2>&1)
echo "$out" | grep -q '^ERROR=.*symlink' && [ -z "$(ls -A "$work/elsewhere")" ] && ok "symlinked reaper folder refused, nothing written through it" || bad "symlink trap: $out"
rm -f "$D"
mv "$B" "$B.real"; ln -s "$work/elsewhere" "$B"
out=$(sh "$work/install.sh" 2>&1)
echo "$out" | grep -q '^ERROR=.*symlink' && [ -z "$(ls -A "$work/elsewhere")" ] && ok "symlinked matchitool folder refused" || bad "symlink trap (base): $out"
rm -f "$B"; mv "$B.real" "$B"

# a short write is refused, and the old daemon keeps running
sh "$work/install.sh" >/dev/null 2>&1; old=$(cat "$D/watch.pid")
out=$(sh "$work/install_short.sh" 2>&1)
echo "$out" | grep -q '^ERROR=.*not written completely' && ok "incomplete write refused" || bad "short write not refused: $out"
[ "$(count)" = 1 ] && [ "$(cat "$D/watch.pid")" = "$old" ] && [ ! -e "$S.new" ] && ok "old daemon untouched after a refused install" || bad "refused install disturbed the old daemon"

# --- end to end: the app is removed ----------------------------------------------------------------------------------------------------------
echo x > "$B/boot.sh"; mkdir -p "$B/plugin_data"; echo x > "$B/plugin_data/f"; echo x > "$work/data/local/tmp/mt_isms.sh"
# decoys: [1] named like our program, [2] carries a boot tag = ours; [3] carries another plugin's tag, [4] plain = not ours
mkdir -p "$work/decoy"; cp "$(command -v sleep)" "$work/decoy/matchi-guard"
"$work/decoy/matchi-guard" 300 & d1=$!
MATCHI_PLUGIN=boot-x sleep 300 & d2=$!
MATCHI_PLUGIN=someone-else sleep 300 & d3=$!
sleep 300 & d4=$!
sleep 1
alive $d1 && alive $d2 && alive $d3 && alive $d4 && ok "decoys are running before the wipe" || bad "decoys did not start"
rm -rf "$APP"
i=0; while [ "$i" -lt 30 ]; do [ ! -e "$B" ] && [ "$(count)" = 0 ] && break; sleep 1; i=$((i + 1)); done
[ ! -e "$B" ] && ok "app removed: matchitool folder wiped (${i}s)" || bad "folder still there after ${i}s: $(ls -A "$B" 2>&1 | tr '\n' ' ')"
[ ! -e "$STUB" ] && ok "boot stub deleted" || bad "boot stub still there"
! alive $d1 && ok "program named matchi-guard stopped" || bad "matchi-guard decoy still running"
! alive $d2 && ok "process with a boot tag stopped" || bad "boot-tagged decoy still running"
alive $d3 && ok "process with another plugin's tag left alone" || bad "foreign-tagged process was killed"
alive $d4 && ok "plain process left alone" || bad "plain process was killed"
kill $d1 $d2 $d3 $d4 2>/dev/null
[ "$(count)" = 0 ] && ok "reaper exited by itself" || bad "reaper still running"
[ ! -e "$work/data/local/tmp/mt_isms.sh" ] && [ ! -e "$work/data/local/matchitool-uninstall.log" ] && ok "legacy temp file and retry log gone" || bad "temp file or log left"
[ -f "$work/data/local/keep.txt" ] && [ -f "$work/data/local/tmp/curl" ] && [ -f "$work/data/adb/service.d/other.sh" ] && ok "unrelated files kept" || bad "unrelated file removed"

# --- reinstall after uninstall: clean first start ---------------------------------------------------------------------------------------------
mkdir -p "$APP"
out=$(sh "$work/install.sh" 2>&1)
echo "$out" | grep -q '^RUNNING=1' && [ "$(count)" = 1 ] && [ -f "$STUB" ] && ok "reinstall after uninstall: fresh reaper and stub" || bad "reinstall: $out"

[ "$fail" = 0 ] && echo "reaper install test passed" || exit 1

#!/bin/sh
# Runs the real assets/bin/matchi_logd.sh against fake logcat/dmesg/df/log commands in a temp folder:
# capture starts, files and status appear, a crashed logcat is restarted with a gap marker, low free space pauses
# capture and recovery resumes it, and stopping the script leaves no stray process behind.
set -u
here=$(cd "$(dirname "$0")" && pwd)
src="$here/../app/src/main/assets/bin/matchi_logd.sh"
work=$(mktemp -d); trap 'kill $(cat "$work/mt/bootlogs/logd.pid" 2>/dev/null) 2>/dev/null; sleep 1; rm -rf "$work"' EXIT
fail=0
ok()  { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
mkdir -p "$work/bin" "$work/mt"
cp "$src" "$work/matchi_logd.sh"

# fake logcat: writes a line every 0.2 s to the -f file; "crash once" flag makes the first run exit after 1 s
cat > "$work/bin/logcat" <<'FAKE'
#!/bin/sh
f=""; while [ $# -gt 0 ]; do [ "$1" = -f ] && { f=$2; shift; }; shift; done
if [ ! -f "$FAKE_DIR/crashed" ] && [ -f "$FAKE_DIR/crash_once" ]; then touch "$FAKE_DIR/crashed"; echo first >> "$f"; sleep 1; exit 7; fi
while :; do echo "01-01 00:00:00.000  1  1 I Test: line $(date +%s)" >> "$f"; sleep 0.2; done
FAKE
cat > "$work/bin/dmesg" <<'FAKE'
#!/bin/sh
i=0; while :; do echo "[ $i.000] kernel test line $i"; i=$((i+1)); sleep 0.2; done
FAKE
cat > "$work/bin/df" <<'FAKE'
#!/bin/sh
echo "Filesystem 1K-blocks Used Available Use% Mounted on"
echo "/dev/x 1000000 1000 $(cat "$FAKE_DIR/free_kb" 2>/dev/null || echo 900000) 1% /data"
FAKE
printf '#!/bin/sh\nexit 0\n' > "$work/bin/log"
# fake ps: the real script reads command lines with "ps -A -o PID,ARGS" (toybox); the ps on a PC wants lower case names
cat > "$work/bin/ps" <<'FAKE'
#!/bin/sh
/bin/ps -A -o pid,args | sed '1s/.*/PID ARGS/'
FAKE
printf '#!/bin/sh\ncase "$1" in ro.build.fingerprint) echo fake/fp;; *) echo;; esac\n' > "$work/bin/getprop"
chmod +x "$work/bin/"*
export FAKE_DIR="$work" MATCHI_DIR="$work/mt" LOGD_TICK=${LOGD_TICK_TEST:-1} LOGD_SELF="$work/matchi_logd.sh" PATH="$work/bin:$PATH"
printf 'FILE_KB=64\nFILES=3\nMIN_FREE_MB=200\nRETAIN_DAYS=1\n' > "$work/mt/logd.conf"
touch "$work/crash_once"
L="$work/mt/bootlogs"

mkdir -p "$work/fm/modules/modA" "$work/mt/tmp"
echo "magisk line 1" > "$work/fm/magisk.log"; printf 'version=1.2\n' > "$work/fm/modules/modA/module.prop"; touch "$work/fm/modules/modA/disable"
echo "audit line" > "$work/fm/audit.log"; echo "updater line" > "$work/mt/tmp/matchi_update.log"; echo "app event line" > "$work/mt/events.log"
export MATCHI_MAGISK_LOGS="$work/fm/none.log $work/fm/magisk.log" MATCHI_MODULES_DIR="$work/fm/modules" MATCHI_APP_AUDIT="$work/fm/audit.log" EXTRAS_DELAY=1 EXTRAS_EVERY=2
mkdir -p "$L"; echo old > "$L/dmesg.log.2"; echo older > "$L/logcat.log.2"; touch -d "3 days ago" "$L/dmesg.log.2" "$L/logcat.log.2"
# A pid file left over from an earlier boot names a process that is alive but is NOT the capture script: it must not block the start.
sleep 300 & other=$!
echo "$other" > "$L/logd.pid"
sh "$work/matchi_logd.sh"       # parent must return at once and leave a detached child
sleep 5
[ -s "$L/logcat.log" ] && ok "logcat.log is being written" || bad "logcat.log missing"
[ "$(cat "$L/logd.pid" 2>/dev/null)" != "$other" ] && ok "stale pid file naming another live process did not block the start" || bad "stale pid file blocked the start"
kill -0 "$other" 2>/dev/null && ok "the unrelated process was left alone" || bad "the unrelated process was killed"
grep -q "logd.pid held $other" "$L/events.log" && ok "events.log says the stale pid was ignored" || bad "no note about the stale pid"
kill "$other" 2>/dev/null
[ -s "$L/dmesg.log" ] && ok "dmesg.log is being written" || bad "dmesg.log missing"
[ -f "$L/context.txt" ] && grep -q 'build=fake/fp' "$L/context.txt" && ok "context header written" || bad "context header missing"
grep -q '^state=running' "$L/status" 2>/dev/null && ok "status file says running" || bad "status missing/not running"
grep -q "^--- thermal zones" "$L/context.txt" && grep -q "^--- boot scripts" "$L/context.txt" && ok "context lists thermal zones and boot scripts" || bad "context thermal/boot-script sections missing"
grep -q "^thermal=" "$L/status" 2>/dev/null && ok "status carries thermal line" || bad "status thermal line missing"
grep -q 'logcat exited rc=7' "$L/events.log" && ok "crashed logcat restart noted in events.log" || bad "no restart note"
grep -q 'GAP' "$L/logcat.gaps" && ok "gap marker written" || bad "gap marker missing"
grep -q '^logcat_restarts=1' "$L/status" && ok "restart counter in status" || bad "restart counter wrong"
[ ! -e "$L/dmesg.log.2" ] && [ ! -e "$L/logcat.log.2" ] && grep -q 'retention: removed' "$L/events.log" && ok "retention removes rotated parts older than RETAIN_DAYS" || bad "retention did not remove old parts"
[ -f "$L/logcat.log" ] && [ -f "$L/dmesg.log" ] && ok "current files are never removed by retention" || bad "retention removed a current file"
grep -q 'magisk line 1' "$L/magisk.log" 2>/dev/null && ok "magisk.log copied (first existing path)" || bad "magisk.log not copied"
grep -q 'modA version=1.2 state=disabled' "$L/modules.txt" 2>/dev/null && ok "modules.txt lists module state" || bad "modules.txt wrong"
grep -q 'audit line' "$L/app_shell_audit.log" 2>/dev/null && grep -q 'updater line' "$L/updater.log" 2>/dev/null && grep -q 'app event line' "$L/app_events.log" 2>/dev/null && ok "app audit, updater and app events logs copied" || bad "app files not copied"
echo "magisk line 2" >> "$work/fm/magisk.log"; sleep 4
grep -q 'magisk line 2' "$L/magisk.log" 2>/dev/null && ok "magisk.log refreshed after it changed" || bad "magisk.log not refreshed"
pid=$(cat "$L/logd.pid"); sh "$work/matchi_logd.sh"; sleep 1
[ "$(cat "$L/logd.pid")" = "$pid" ] && ok "second start does not create a second instance" || bad "second instance replaced the first"

echo 100000 > "$work/free_kb"; sleep 4          # 97 MB free < 200 MB minimum
[ -f "$L/.paused" ] && grep -q 'capture paused' "$L/events.log" && ok "low free space pauses capture" || bad "low space did not pause"
sz=$(wc -c < "$L/logcat.log"); sleep 2; sz2=$(wc -c < "$L/logcat.log")
[ "$sz" = "$sz2" ] && ok "nothing written while paused" || bad "still writing while paused"
echo 900000 > "$work/free_kb"; sleep 5
[ ! -f "$L/.paused" ] && grep -q 'capture resumed' "$L/events.log" && ok "capture resumes when space returns" || bad "capture did not resume"

used=$(du -sk "$L" | awk '{print $1}')
[ "$used" -lt $((64*3*2+2048)) ] && ok "total size ${used} KB stays under the cap" || bad "size ${used} KB over cap"

kill "$pid"; i=0; while kill -0 "$pid" 2>/dev/null && [ $i -lt 8 ]; do sleep 0.5; i=$((i+1)); done
kill -0 "$pid" 2>/dev/null && bad "script still running after TERM" || ok "script stopped on TERM"
[ ! -f "$L/logd.pid" ] && ok "pid file removed" || bad "pid file left behind"
if ps 2>/dev/null | grep -q "[f]ake_marker_none"; then :; fi
i=0; n=1; while [ "$n" -gt 0 ] && [ $i -lt 10 ]; do sleep 0.5; n=$(pgrep -f "$work/bin" 2>/dev/null | wc -l); i=$((i+1)); done
[ "$n" -eq 0 ] && ok "no capture processes left" || bad "$n capture processes left"
# The app's own root commands must not kill a bare "$(cat logd.pid)" any more (see BootLogdModel.PID_FN).
if grep -n 'kill' "$here/../app/src/main/java/com/matchi/tool/BootLogd.kt" | grep -qF 'logd.pid'; then bad "BootLogd.kt kills a pid straight from logd.pid"; else ok "BootLogd.kt only kills what logd_pid confirms"; fi
[ $fail -eq 0 ] && echo "ALL OK" || { echo "FAILED"; exit 1; }

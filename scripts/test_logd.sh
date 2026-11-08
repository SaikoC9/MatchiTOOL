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
printf '#!/bin/sh\ncase "$1" in ro.build.fingerprint) echo fake/fp;; *) echo;; esac\n' > "$work/bin/getprop"
chmod +x "$work/bin/"*
export FAKE_DIR="$work" MATCHI_DIR="$work/mt" LOGD_TICK=${LOGD_TICK_TEST:-1} LOGD_SELF="$work/matchi_logd.sh" PATH="$work/bin:$PATH"
printf 'FILE_KB=64\nFILES=3\nMIN_FREE_MB=200\n' > "$work/mt/logd.conf"
touch "$work/crash_once"
L="$work/mt/bootlogs"

sh "$work/matchi_logd.sh"       # parent must return at once and leave a detached child
sleep 5
[ -s "$L/logcat.log" ] && ok "logcat.log is being written" || bad "logcat.log missing"
[ -s "$L/dmesg.log" ] && ok "dmesg.log is being written" || bad "dmesg.log missing"
[ -f "$L/context.txt" ] && grep -q 'build=fake/fp' "$L/context.txt" && ok "context header written" || bad "context header missing"
grep -q '^state=running' "$L/status" 2>/dev/null && ok "status file says running" || bad "status missing/not running"
grep -q 'logcat exited rc=7' "$L/events.log" && ok "crashed logcat restart noted in events.log" || bad "no restart note"
grep -q 'GAP' "$L/logcat.gaps" && ok "gap marker written" || bad "gap marker missing"
grep -q '^logcat_restarts=1' "$L/status" && ok "restart counter in status" || bad "restart counter wrong"
pid=$(cat "$L/logd.pid"); sh "$work/matchi_logd.sh"; sleep 1
[ "$(cat "$L/logd.pid")" = "$pid" ] && ok "second start does not create a second instance" || bad "second instance replaced the first"

echo 100000 > "$work/free_kb"; sleep 4          # 97 MB free < 200 MB minimum
[ -f "$L/.paused" ] && grep -q 'capture paused' "$L/events.log" && ok "low free space pauses capture" || bad "low space did not pause"
sz=$(wc -c < "$L/logcat.log"); sleep 2; sz2=$(wc -c < "$L/logcat.log")
[ "$sz" = "$sz2" ] && ok "nothing written while paused" || bad "still writing while paused"
echo 900000 > "$work/free_kb"; sleep 5
[ ! -f "$L/.paused" ] && grep -q 'capture resumed' "$L/events.log" && ok "capture resumes when space returns" || bad "capture did not resume"

used=$(du -sk "$L" | awk '{print $1}')
[ "$used" -lt $((64*3*2+1024)) ] && ok "total size ${used} KB stays under the cap" || bad "size ${used} KB over cap"

kill "$pid"; i=0; while kill -0 "$pid" 2>/dev/null && [ $i -lt 8 ]; do sleep 0.5; i=$((i+1)); done
kill -0 "$pid" 2>/dev/null && bad "script still running after TERM" || ok "script stopped on TERM"
[ ! -f "$L/logd.pid" ] && ok "pid file removed" || bad "pid file left behind"
if ps 2>/dev/null | grep -q "[f]ake_marker_none"; then :; fi
sleep 1; n=$(pgrep -f "$work/bin" 2>/dev/null | wc -l)
[ "$n" -eq 0 ] && ok "no capture processes left" || bad "$n capture processes left"
[ $fail -eq 0 ] && echo "ALL OK" || { echo "FAILED"; exit 1; }

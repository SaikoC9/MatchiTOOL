#!/system/bin/sh
# MATCHI_LOGD_VERSION=1
# MatchiTOOL boot log capture. Installed by the app to /data/adb/service.d/ (Magisk runs it as root at boot).
# Runs Android's own logcat (all buffers) and dmesg -w straight into size-capped rotating files, independent of the
# app: if the app is killed, updated or crashes, capture goes on. Never filters or drops lines at capture time.
# Settings come from $D/logd.conf (FILE_KB, FILES, MIN_FREE_MB); defaults below are used when it is missing.

D=${MATCHI_DIR:-/data/local/matchitool}
L=$D/bootlogs
TICK=${LOGD_TICK:-30}            # janitor / heartbeat interval in seconds (tests lower it)
FILE_KB=2048; FILES=10; MIN_FREE_MB=200
[ -f "$D/logd.conf" ] && . "$D/logd.conf"
case $FILE_KB in ''|*[!0-9]*) FILE_KB=2048;; esac
case $FILES in ''|*[!0-9]*) FILES=10;; esac
case $MIN_FREE_MB in ''|*[!0-9]*) MIN_FREE_MB=200;; esac
[ "$FILE_KB" -lt 64 ] && FILE_KB=64
[ "$FILE_KB" -gt 16384 ] && FILE_KB=16384
[ "$FILES" -lt 2 ] && FILES=2
[ "$FILES" -gt 40 ] && FILES=40
SELF=${LOGD_SELF:-/data/adb/service.d/matchi_logd.sh}

# Detach: Magisk must not wait for this script, and the app's root shell must not own it.
if [ "$1" != "--child" ]; then
  if command -v setsid >/dev/null 2>&1; then setsid sh "$SELF" --child </dev/null >/dev/null 2>&1 &
  else nohup sh "$SELF" --child </dev/null >/dev/null 2>&1 &
  fi
  exit 0
fi

mkdir -p "$L" 2>/dev/null || exit 1
chmod 700 "$D" "$L" 2>/dev/null

# One instance only.
if [ -f "$L/logd.pid" ] && kill -0 "$(cat "$L/logd.pid" 2>/dev/null)" 2>/dev/null; then exit 0; fi
echo $$ > "$L/logd.pid"

note() { echo "$(date '+%F %T') $*" >> "$L/events.log" 2>/dev/null; }
VER=$(sed -n 's/^# MATCHI_LOGD_VERSION=//p' "$SELF" 2>/dev/null | head -n 1)
STARTED=$(date '+%F %T')
LC_RESTARTS=0; DM_RESTARTS=0; LAST_RESTART=-
LOW_SPACE=0
note "capture started (script v${VER:-?}, pid $$, ${FILES} x ${FILE_KB} KB per source)"

# Context header: what the device looked like when capture began.
{
  echo "started=$STARTED"
  echo "script_version=${VER:-?}"
  echo "uptime=$(cut -d' ' -f1 /proc/uptime 2>/dev/null)s"
  echo "build=$(getprop ro.build.fingerprint 2>/dev/null)"
  echo "android=$(getprop ro.build.version.release 2>/dev/null) sdk=$(getprop ro.build.version.sdk 2>/dev/null)"
  echo "kernel=$(uname -a 2>/dev/null)"
  echo "magisk=$(magisk -v 2>/dev/null) ($(magisk -V 2>/dev/null))"
  echo "selinux=$(getenforce 2>/dev/null)"
  echo "app=$(dumpsys package com.matchi.tool 2>/dev/null | sed -n 's/^ *versionName=//p' | head -n 1)"
  head -n 3 /proc/meminfo 2>/dev/null
  echo "--- network ---"
  ip -o addr 2>/dev/null | head -n 20
} > "$L/context.txt" 2>/dev/null

kids=""
cleanup() { for p in $kids; do kill "$p" 2>/dev/null; done; for f in "$L"/.cap.*; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; done; rm -f "$L"/.cap.* "$L/logd.pid"; note "capture stopped"; exit 0; }
trap cleanup TERM INT HUP

free_mb() { df -k /data 2>/dev/null | tail -n 1 | awk '{ print int($4/1024) }' 2>/dev/null; }

# ---- logcat supervisor: tries flag sets from richest to simplest; restarts with backoff and writes a gap marker ----
logcat_loop() {
  back=2; try=0
  while :; do
    if [ -f "$L/.paused" ]; then sleep 10; continue; fi
    case $try in
      0) set -- -b all -v threadtime -v year;;
      1) set -- -b all -v threadtime;;
      *) set -- -v threadtime;;
    esac
    t0=$(date +%s)
    echo "$(date '+%F %T') --- capture (re)started: logcat $* ---" | log -p i -t MatchiLogd 2>/dev/null
    logcat "$@" -f "$L/logcat.log" -r "$FILE_KB" -n "$FILES" &
    echo $! > "$L/.cap.logcat"
    wait $!
    rc=$?
    rm -f "$L/.cap.logcat"
    up=$(( $(date +%s) - t0 ))
    [ -f "$L/.paused" ] && continue
    note "logcat exited rc=$rc after ${up}s (flags: $*); restarting in ${back}s"
    echo "$(date '+%F %T') GAP: logcat exited rc=$rc, restarting" >> "$L/logcat.gaps" 2>/dev/null
    if [ "$up" -lt 5 ]; then try=$((try+1)); [ $try -gt 2 ] && try=2; back=$((back*2)); [ $back -gt 60 ] && back=60; else back=2; fi
    echo "$(( $(cat "$L/.lcr" 2>/dev/null || echo 0) + 1 ))" > "$L/.lcr"
    date '+%F %T' > "$L/.lastrestart"
    sleep $back & wait $!
  done
}

# ---- dmesg supervisor: follow mode, rotated by this script (dmesg has no rotation of its own) ----
rotate_dm() {
  i=$((FILES-1))
  while [ $i -ge 1 ]; do
    [ -f "$L/dmesg.log.$i" ] && { if [ $i -ge $((FILES-1)) ]; then rm -f "$L/dmesg.log.$i"; else mv "$L/dmesg.log.$i" "$L/dmesg.log.$((i+1))"; fi; }
    i=$((i-1))
  done
  [ -f "$L/dmesg.log" ] && mv "$L/dmesg.log" "$L/dmesg.log.1"
}
dmesg_follow() {
  limit=$((FILE_KB*1024)); size=$(wc -c < "$L/dmesg.log" 2>/dev/null || echo 0); size=${size:-0}
  exec 3>>"$L/dmesg.log"
  while IFS= read -r line; do
    printf '%s\n' "$line" >&3
    size=$((size + ${#line} + 1))
    if [ $size -ge $limit ]; then exec 3>&-; rotate_dm; exec 3>>"$L/dmesg.log"; size=0; fi
  done
  exec 3>&-
}
# Kernel source variants, richest first: dmesg -w, then the kernel logcat buffer, then /proc/kmsg.
kernel_src() {
  case $1 in
    0) dmesg -w 2>&1;;
    1) logcat -b kernel -v threadtime 2>&1;;
    *) cat /proc/kmsg 2>&1;;
  esac
  echo "kernel source $1 exited rc=$?"
}
dmesg_loop() {
  back=2; try=0
  while :; do
    if [ -f "$L/.paused" ]; then sleep 10; continue; fi
    t0=$(date +%s)
    echo "$(date '+%F %T') --- capture (re)started: kernel source $try ---" >> "$L/dmesg.log"
    kernel_src $try | dmesg_follow &
    echo $! > "$L/.cap.dmesg"
    wait $!
    rm -f "$L/.cap.dmesg"
    up=$(( $(date +%s) - t0 ))
    [ -f "$L/.paused" ] && continue
    note "kernel source $try ended after ${up}s; restarting in ${back}s"
    if [ "$up" -lt 5 ]; then try=$((try+1)); [ $try -gt 2 ] && try=2; back=$((back*2)); [ $back -gt 60 ] && back=60; else back=2; fi
    echo "$(( $(cat "$L/.dmr" 2>/dev/null || echo 0) + 1 ))" > "$L/.dmr"
    date '+%F %T' > "$L/.lastrestart"
    sleep $back & wait $!
  done
}

logcat_loop & kids="$kids $!"
dmesg_loop & kids="$kids $!"

# ---- janitor: hard size cap, low-space pause, heartbeat status, events.log trim ----
while :; do
  used=$(du -sk "$L" 2>/dev/null | awk '{ print $1 }'); used=${used:-0}
  cap=$(( (FILE_KB*FILES*2) + 1024 ))      # two rotated sources + small files; anything beyond is a bug, so enforce it
  if [ "$used" -gt "$cap" ]; then
    # delete the oldest rotated parts first
    for f in $(ls -t "$L"/logcat.log.* "$L"/dmesg.log.* 2>/dev/null | tail -n 4); do rm -f "$f"; done
    note "size cap exceeded (${used} KB > ${cap} KB): removed oldest parts"
  fi
  fm=$(free_mb); fm=${fm:-0}
  if [ "$fm" -lt "$MIN_FREE_MB" ] && [ "$fm" -gt 0 ]; then
    if [ "$LOW_SPACE" = 0 ]; then
      LOW_SPACE=1; touch "$L/.paused"
      for f in "$L"/.cap.*; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; done
      note "capture paused: only ${fm} MB free on /data (minimum ${MIN_FREE_MB} MB)"
    fi
  elif [ "$LOW_SPACE" = 1 ] && [ "$fm" -ge $((MIN_FREE_MB+50)) ]; then
    LOW_SPACE=0; rm -f "$L/.paused"; note "capture resumed: ${fm} MB free"
  fi
  [ "$(wc -c < "$L/events.log" 2>/dev/null || echo 0)" -gt 262144 ] && { tail -n 500 "$L/events.log" > "$L/events.tmp" && mv "$L/events.tmp" "$L/events.log"; }
  {
    echo "version=${VER:-?}"; echo "pid=$$"; echo "started=$STARTED"; echo "heartbeat=$(date '+%F %T')"
    echo "state=$([ "$LOW_SPACE" = 1 ] && echo paused-low-space || echo running)"
    echo "logcat_restarts=$(cat "$L/.lcr" 2>/dev/null || echo 0)"; echo "dmesg_restarts=$(cat "$L/.dmr" 2>/dev/null || echo 0)"
    echo "last_restart=$(cat "$L/.lastrestart" 2>/dev/null || echo -)"
    echo "used_kb=$used"; echo "free_mb=$fm"; echo "file_kb=$FILE_KB"; echo "files=$FILES"
  } > "$L/status.tmp" 2>/dev/null && mv "$L/status.tmp" "$L/status"
  sleep "$TICK" & wait $!     # wait is interrupted by TERM at once; a plain sleep would delay the trap by up to $TICK
done

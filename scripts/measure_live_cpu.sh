#!/bin/sh
# CPU used by the Live panel's reader, and by the app, over a time window. Run it on the F50 as root (see
# docs/dev-notes/binaries-phase4.txt, step 3):
#
#   adb push scripts/measure_live_cpu.sh /data/local/tmp/ && adb shell su -c 'sh /data/local/tmp/measure_live_cpu.sh 300'
#
# It reads /proc/<pid>/stat twice. For the shell loop the numbers are the loop's own time plus the time of every child it started and
# waited for (sleep); for matchi-sampler they are its own time. Both are shown as "percent of one core". Keep the Live panel open in ONE
# browser tab and leave plugins and the AT console alone while it runs, so nothing else uses the same process names.
#   $1  seconds to measure (default 300)
W="${1:-300}"
case "$W" in ""|*[!0-9]*) echo "usage: $0 [seconds]"; exit 2;; esac
HZ="$(getconf CLK_TCK 2>/dev/null || echo 100)"

# ticks PID -> utime stime cutime cstime summed. stat has the command name in brackets, which can hold spaces: cut it off at the last ")".
ticks() {
  s="$(cat "/proc/$1/stat" 2>/dev/null)" || return 1
  set -- ${s##*) }
  echo $(( ${12} + ${13} + ${14} + ${15} ))
}

# pids PATTERN -> every pid whose command line contains PATTERN (this script and grep excluded)
pids() {
  for d in /proc/[0-9]*; do
    p="${d#/proc/}"; [ "$p" = "$$" ] && continue
    c="$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null)" || continue
    case "$c" in *"$1"*) echo "$p";; esac
  done
}

APP="$(pids com.matchi.tool | while read p; do c="$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null)"; case "$c" in "com.matchi.tool "*|"com.matchi.tool") echo "$p";; esac; done | head -1)"
LOOP="$(pids 'sh /dev/fd/3')"
BIN="$(pids matchi-sampler | while read p; do c="$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null)"; case "$c" in *"-rounds"*) echo "$p";; esac; done)"

if [ -n "$BIN" ] && [ -n "$LOOP" ]; then echo "note: both a matchi-sampler and an 'sh /dev/fd/3' process are running; the loop may be another root script, not the Live reader"; fi
[ -z "$BIN" ] && [ -z "$LOOP" ] && { echo "no Live reader is running: open the Live panel in a browser first"; exit 1; }

report() { # label pid start end
  awk -v l="$1" -v p="$2" -v a="$3" -v b="$4" -v w="$W" -v hz="$HZ" 'BEGIN{ t=(b-a)/hz; printf "%-34s pid %-6s %6.2f s CPU in %d s = %5.2f %% of one core\n", l, p, t, w, 100*t/w }'
}

S=""
for p in $BIN;  do S="$S bin:$p:$(ticks $p)"; done
for p in $LOOP; do S="$S loop:$p:$(ticks $p)"; done
[ -n "$APP" ] && S="$S app:$APP:$(ticks $APP)"
echo "measuring $W s (clock $HZ Hz) ..."
sleep "$W"
for x in $S; do
  kind="${x%%:*}"; rest="${x#*:}"; p="${rest%%:*}"; a="${rest#*:}"
  b="$(ticks $p)" || { echo "$kind pid $p ended during the measurement (a reader that restarted is not comparable; run again)"; continue; }
  case "$kind" in
    bin)  report "matchi-sampler" "$p" "$a" "$b";;
    loop) report "shell loop (sh /dev/fd/3)" "$p" "$a" "$b";;
    app)  report "app process (com.matchi.tool)" "$p" "$a" "$b";;
  esac
done

#!/bin/sh
# MatchiTOOL 1.2.28 - automatic on-device test.
#
#   adb push matchi_selftest.sh /data/local/tmp/
#   adb shell su -c "sh /data/local/tmp/matchi_selftest.sh"
#
# Open the MatchiTOOL app first (so the host runs) and, if you can, open Screen control once and sign in once
# on the console. Report: /sdcard/matchi_test_report.txt (send me this file).
#
# Other modes:
#   sh matchi_selftest.sh boot-setup     put two test scripts into boot.d (then reboot)
#   sh matchi_selftest.sh boot-check     after the reboot: verify the 25 s limit, then clean up
#   sh matchi_selftest.sh http <BASE>    HTTP tests only, from a PC on the hotspot, e.g.
#                                        sh matchi_selftest.sh http https://192.168.0.1:2334   (needs curl)

D=${D:-/data/local/matchitool}
APP=${APP:-/data/data/com.matchi.tool}
PORT=${PORT:-2334}
TMP=$D/tmp
REPORT=${REPORT:-/sdcard/matchi_test_report.txt}
PASS=0; FAIL=0; WARN=0; SKIP=0; N=0
MODE=${1:-all}

: > "$REPORT" 2>/dev/null
say()  { echo "$*"; echo "$*" >> "$REPORT" 2>/dev/null; }
pass() { PASS=$((PASS+1)); say "PASS  $1"; }
fail() { FAIL=$((FAIL+1)); say "FAIL  $1"; [ -n "$2" ] && say "      $2"; return 0; }   # return 0: "a && fail || pass" must not also print PASS
warn() { WARN=$((WARN+1)); say "WARN  $1"; [ -n "$2" ] && say "      $2"; return 0; }
skip() { SKIP=$((SKIP+1)); say "SKIP  $1"; }
have() { command -v "$1" >/dev/null 2>&1; }
head_() { echo "$1" | head -c 300 | tr '\n' ' '; }

# ---------------------------------------------------------------- boot-task helper modes
if [ "$MODE" = boot-setup ]; then
  [ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
  mkdir -p "$D/boot.d"; chown 0:0 "$D" "$D/boot.d" 2>/dev/null; chmod 755 "$D/boot.d"
  printf 'sleep 60\n' > "$D/boot.d/91_matchi_test_slow.sh"
  printf 'echo ok > %s/ok.txt\n' "$D" > "$D/boot.d/92_matchi_test_ok.sh"
  chown 0:0 "$D"/boot.d/9[12]_matchi_test_*.sh; chmod 755 "$D"/boot.d/9[12]_matchi_test_*.sh
  rm -f "$D/ok.txt"
  echo "Test scripts created. Reboot the F50 now, wait about 4 minutes, then run:"
  echo "  su -c \"sh /data/local/tmp/matchi_selftest.sh boot-check\""
  exit 0
fi
if [ "$MODE" = boot-check ]; then
  [ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
  if grep -q '91_matchi_test_slow.sh stopped' "$D/events.log" 2>/dev/null; then pass "BOOT slow script was stopped at the 25 s limit (events.log)"
  else fail "BOOT no 'stopped' line for the slow script in events.log" "$(tail -5 "$D/events.log" 2>/dev/null | tr '\n' '|')"; fi
  if [ -f "$D/ok.txt" ]; then pass "BOOT the script after the slow one still ran"; else fail "BOOT ok.txt missing: later script did not run"; fi
  rm -f "$D"/boot.d/91_matchi_test_slow.sh "$D"/boot.d/92_matchi_test_ok.sh "$D/ok.txt"; rmdir "$D/boot.d" 2>/dev/null
  say "Test scripts removed."; [ "$FAIL" = 0 ]; exit $?
fi

# ---------------------------------------------------------------- HTTP section (used on the device and from a PC)
http_tests() {
  BASE=$1; REMOTE=$2
  c() { curl -sk -m 8 "$@"; }
  code() { c -o /dev/null -w '%{http_code}' "$@"; }
  say "-- HTTP tests against $BASE"
  case "$BASE" in https://*) pass "HTTP console runs over https";; *) warn "HTTP console runs over plain http (HTTPS fell back): sign-in is not encrypted";; esac
  hdr=$(c -D - -o /dev/null "$BASE/")
  echo "$hdr" | grep -qi '^content-security-policy:' && pass "HTTP page has Content-Security-Policy" || fail "HTTP page has no Content-Security-Policy"
  echo "$hdr" | grep -qi '^x-frame-options: *deny' && pass "HTTP X-Frame-Options DENY" || fail "HTTP X-Frame-Options missing"
  echo "$hdr" | grep -qi '^x-content-type-options: *nosniff' && pass "HTTP nosniff header" || fail "HTTP nosniff header missing"
  [ "$(code -H 'Host: evil.example' "$BASE/")" = 403 ] && pass "HTTP host-name (DNS rebinding) request refused" || fail "HTTP Host: evil.example was not refused"
  [ "$(code -H 'Origin: https://evil.example' -X POST -d '{}' "$BASE/api/login")" = 403 ] && pass "HTTP cross-origin POST refused" || fail "HTTP cross-origin POST not refused"
  r=$(code -X POST -H 'Transfer-Encoding: chunked' -d '{}' "$BASE/api/login")
  [ "$r" = 400 ] && pass "HTTP chunked body answered 400" || fail "HTTP chunked body answered $r (expected 400)"
  [ "$(code "$BASE/api/ping")" = 401 ] && pass "HTTP /api/ping without token = 401" || fail "HTTP /api/ping without token is not 401"
  [ "$(code "$BASE/nothing")" = 404 ] && pass "HTTP unknown path = 404" || fail "HTTP unknown path is not 404"
  if [ -n "$REMOTE" ]; then
    # per-IP lock: 8 wrong passwords lock this address (it stays locked for 60 s afterwards)
    i=0; last=; while [ $i -lt 9 ]; do last=$(c -o /dev/null -D /tmp/.mt_h -w '%{http_code}' -X POST -d '{"password":"wrong-test-pw"}' "$BASE/api/login"); i=$((i+1)); done
    if [ "$last" = 429 ]; then pass "HTTP 9th wrong password from this address = 429 (locked)"; else fail "HTTP 9th wrong password gave $last (expected 429)"; fi
    grep -qi '^retry-after:' /tmp/.mt_h 2>/dev/null && pass "HTTP lock answer has Retry-After" || fail "HTTP lock answer has no Retry-After"
    body=$(c -X POST -d '{"password":"x"}' "$BASE/api/login"); echo "$body" | grep -qi 'wait' && pass "HTTP lock message shows the wait time" || fail "HTTP lock message has no wait time" "$(head_ "$body")"
    say "      (this address is locked for about a minute now)"
  else
    s=$(date +%s); a=; b=; k=0
    while [ $k -lt 3 ]; do r=$(code -X POST -d '{"password":"wrong-test-pw"}' "$BASE/api/login"); a="$a $r"; k=$((k+1)); done
    e=$(date +%s)
    [ "$a" = " 401 401 401" ] && pass "HTTP loopback wrong passwords answer 401 (never locked)" || fail "HTTP loopback wrong passwords answered:$a"
    [ $((e-s)) -ge 4 ] && pass "HTTP loopback wrong passwords are delayed ($((e-s)) s for 3)" || fail "HTTP loopback wrong passwords were not delayed ($((e-s)) s)"
    if [ -f "$APP/files/shell_audit.log" ]; then grep -q 'login-failed' "$APP/files/shell_audit.log" && pass "HTTP failed login written to the audit log" || fail "HTTP no login-failed line in the audit log"; fi
  fi
  if have openssl && [ "${BASE#https}" != "$BASE" ]; then
    hp=${BASE#https://}
    if echo | openssl s_client -connect "$hp" -tls1_1 >/dev/null 2>&1; then fail "TLS 1.1 handshake succeeded (must be refused)"; else pass "TLS 1.1 refused"; fi
    echo | openssl s_client -connect "$hp" -tls1_2 >/dev/null 2>&1 && pass "TLS 1.2 works" || warn "TLS 1.2 handshake failed with this openssl"
  else skip "TLS version test (needs openssl and https)"; fi
}

if [ "$MODE" = http ]; then
  have curl || { echo "curl is needed"; exit 1; }
  [ -n "$2" ] || { echo "usage: sh matchi_selftest.sh http https://<IP>:2334"; exit 1; }
  http_tests "$2" remote
  say; say "RESULT: $PASS pass, $FAIL fail, $WARN warn, $SKIP skip"; [ "$FAIL" = 0 ]; exit $?
fi

# ---------------------------------------------------------------- on-device tests
[ "$(id -u)" = 0 ] || { echo "Run as root: su -c \"sh /data/local/tmp/matchi_selftest.sh\""; exit 1; }
say "MatchiTOOL patched19 self-test  $(date '+%F %T')"
say "Android $(getprop ro.build.version.release 2>/dev/null)  model $(getprop ro.product.model 2>/dev/null)  sh -> $(readlink /system/bin/sh 2>/dev/null)"
for t in setsid timeout stat curl openssl ip; do if have $t; then say "tool $t: yes"; else say "tool $t: NO"; fi; done
pm path com.matchi.tool >/dev/null 2>&1 && say "app: installed $(dumpsys package com.matchi.tool 2>/dev/null | grep -m1 versionName)" || warn "app com.matchi.tool not found (pm)"
say

say "-- T1/T2 root launcher and temp folder (the exact launcher text from RootShell.kt)"
mkdir -p "$TMP" 2>/dev/null; chmod 700 "$TMP" 2>/dev/null
rm -f "$TMP"/.matchi_pid_* "$TMP"/.matchi_out_* "$TMP"/.case_* 2>/dev/null
run_case() { # name script timeout
  N=$((N+1)); id=$$_$N; pf=$TMP/.matchi_pid_$id; o=$TMP/.matchi_out_$id; dl=MATCHI_EOF_$id; cf=$TMP/.case_$id.sh
  {
    echo "if command -v setsid >/dev/null 2>&1; then MS=setsid; else MS=; fi"
    echo "MT_OK=; mkdir -p $TMP 2>/dev/null; chmod 700 $TMP 2>/dev/null; if [ ! -L $TMP ] && [ \"\$(stat -c %u $TMP 2>/dev/null)\" = 0 ]; then MT_OK=1; else echo 'unsafe root temp folder'; fi"
    echo "set -C"
    echo "[ -n \"\$MT_OK\" ] && \$MS sh -c 'set -C; echo \$\$ >$pf || exit 1; set +C; exec sh /dev/fd/3' >$o 2>&1 </dev/null 3<<'$dl'"
    echo "$2"
    echo "$dl"
    echo "rc=\$?; set +C; head -c 1100000 $o 2>/dev/null; rm -f $o $pf; printf '\\n@@END:%d\\n' \"\$rc\""
  } > "$cf"
  s=$(date +%s)
  if have timeout; then CASE_OUT=$(timeout "$3" sh "$cf" 2>&1); CASE_RC=$?; else CASE_OUT=$(sh "$cf" 2>&1); CASE_RC=$?; fi
  e=$(date +%s); CASE_SECS=$((e-s)); rm -f "$cf"
}
run_case sleep "sleep 2; echo done" 30
if echo "$CASE_OUT" | grep -q '^done' && echo "$CASE_OUT" | grep -q '@@END:0' && [ "$CASE_SECS" -ge 2 ]; then pass "T1 launcher waits for the script (sleep 2; echo done took ${CASE_SECS}s)"
else fail "T1 launcher: script output/exit code wrong or returned early (setsid detaches?)" "secs=$CASE_SECS out=$(head_ "$CASE_OUT")"; fi
run_case exit3 "echo before; exit 3" 30
if echo "$CASE_OUT" | grep -q '^before' && echo "$CASE_OUT" | grep -q '@@END:3'; then pass "T1 exit code 3 is reported and output kept"; else fail "T1 exit code not reported" "$(head_ "$CASE_OUT")"; fi
run_case cat "cat; echo after-cat" 30
echo "$CASE_OUT" | grep -q 'after-cat' && pass "T1 a script that reads stdin does not swallow the rest" || fail "T1 stdin swallowed the rest of the script" "$(head_ "$CASE_OUT")"
run_case unsafe "echo hi" 30
# Only the launcher's own files count (.matchi_pid_*, .matchi_out_*, .case_*). Folders such as 'jobs' belong to the app.
leftover=$(ls -A "$TMP" 2>/dev/null | grep -E '^\.(matchi_pid_|matchi_out_|case_)')
left=$(printf '%s' "$leftover" | grep -c .)
[ "$left" = 0 ] && pass "T2 no launcher temp files left after normal runs" || fail "T2 $left launcher temp file(s) left in $TMP" "$(echo "$leftover" | tr '\n' ' ')"
m=$(stat -c '%a %u' "$TMP" 2>/dev/null)
[ "$m" = "700 0" ] && pass "T2 temp folder is mode 700, owner root" || fail "T2 temp folder is '$m' (expected '700 0')"
# The app does not use `timeout`: on a timeout it runs killScriptTree (pid file -> freeze the child tree -> kill the group).
# This case starts a long script, waits 3 s, runs that same kill text and checks the script is really gone.
N=$((N+1)); id=$$_$N; pf=$TMP/.matchi_pid_$id; o=$TMP/.matchi_out_$id; dl=MATCHI_EOF_$id; cf=$TMP/.case_$id.sh; of=$TMP/.case_out_$id
{
  echo "if command -v setsid >/dev/null 2>&1; then MS=setsid; else MS=; fi"
  echo "set -C"
  echo "\$MS sh -c 'set -C; echo \$\$ >$pf || exit 1; set +C; exec sh /dev/fd/3' >$o 2>&1 </dev/null 3<<'$dl'"
  echo "sleep 8; echo never"
  echo "$dl"
  echo "set +C; cat $o 2>/dev/null; rm -f $o $pf"
} > "$cf"
t0=$(date +%s)
sh "$cf" >"$of" 2>&1 </dev/null &
bg=$!
w=0; while [ ! -s "$pf" ] && [ $w -lt 20 ]; do sleep 1; w=$((w+1)); done
sleep 3
KP=$(cat "$pf" 2>/dev/null)
sh -c '
P=$(cat '"$pf"' 2>/dev/null)
case "$P" in ""|*[!0-9]*) P= ;; esac
if [ -n "$P" ] && [ "$P" -gt 1 ]; then
  kids() { ps -A -o PID,PPID 2>/dev/null | while read a b; do [ "$b" = "$1" ] && echo "$a"; done; }
  tree() { echo "$1"; for c in $(kids "$1"); do tree "$c"; done; }
  L=$(tree "$P")
  kill -STOP $L 2>/dev/null
  kill -9 -- -$P 2>/dev/null
  kill -9 $L 2>/dev/null
fi
rm -f '"$pf $o"'
' >/dev/null 2>&1
wait $bg 2>/dev/null
t1=$(date +%s); secs=$((t1-t0))
alive=no; [ -n "$KP" ] && kill -0 "$KP" 2>/dev/null && alive=yes
if [ -n "$KP" ] && [ "$alive" = no ] && [ "$secs" -le 7 ] && ! grep -q never "$of" 2>/dev/null; then pass "T1 timeout kill stops a long script (pid $KP gone after ${secs}s)"
else fail "T1 timeout kill: pid='$KP' still-alive=$alive secs=$secs" "$(head_ "$(cat "$of" 2>/dev/null)")"; fi
rm -f "$cf" "$of" "$TMP"/.matchi_pid_* "$TMP"/.matchi_out_* 2>/dev/null

say; say "-- T3 network"
found=; all=
for p in /sys/class/net/*; do
  n=${p##*/}; all="$all $n"
  case "$n" in br*|ap*|swlan*|usb*|rndis*|ecm*)
    ipv4=; have ip && ipv4=$(ip -o -4 addr show dev "$n" 2>/dev/null | awk '{print $4}' | head -1)
    [ -n "$ipv4" ] && found="$found $n($ipv4)";;
  esac
done
say "      all interfaces:$all"
[ -n "$found" ] && pass "T3 hotspot-side interface(s) with an address:$found" || warn "T3 no hotspot-like interface has an IPv4 address (hotspot off, or it has another name). Send me the list above."
HEXPORT=$(printf '%04X' "$PORT")
# state 0A = LISTEN. The host is a dual-stack socket, so it appears in /proc/net/tcp6 (all-zero address), not /proc/net/tcp.
if grep -qiE "^ *[0-9]+: 0{8}:$HEXPORT 0{8}:0000 0A" /proc/net/tcp 2>/dev/null; then pass "T3 host listens on 0.0.0.0:$PORT"
elif grep -qiE "^ *[0-9]+: 0{32}:$HEXPORT 0{32}:0000 0A" /proc/net/tcp6 2>/dev/null; then pass "T3 host listens on all addresses, port $PORT (IPv6 dual-stack socket)"
else warn "T3 nothing listens on port $PORT (open the app / start the host)"; fi

say; say "-- T5/T6/T7 files and permissions"
PX=$APP/shared_prefs/matchi.xml
if [ -f "$PX" ]; then
  grep -q 'name="zte_pass"' "$PX" && fail "T12 router password stored in CLEAR TEXT (zte_pass present)" || pass "T12 no clear-text router password in preferences"
  grep -q 'name="token"' "$PX" && fail "old permanent token still in preferences" || pass "no old permanent token in preferences"
else skip "preferences file not found ($PX)"; fi
if [ -e "$D/sms_delete_debug.txt" ]; then fail "T12 old sms_delete_debug.txt still exists (patched19 removes it 200 s after the app starts, or: rm -f $D/sms_delete_debug.txt)"; else pass "T12 no SMS debug file"; fi
if [ -f "$APP/cache/screen.png" ]; then
  m=$(stat -c %a "$APP/cache/screen.png"); [ "$m" = 600 ] && pass "T8 screen.png is mode 600" || fail "T8 screen.png is mode $m (expected 600)"
else skip "T8 screen.png not present (open Screen control with PNG mode to create it)"; fi
old=$(ls -A /data/local/tmp 2>/dev/null | grep -E '^\.?matchi_|^mt_isms' | grep -v '^matchi_selftest\.sh$' | tr '\n' ' ')
[ -z "$old" ] && pass "no old MatchiTOOL temp files in /data/local/tmp" || warn "old temp files in /data/local/tmp: $old (the app removes them 200 s after start)"

say; say "-- T4/T14 HTTP from this device (loopback)"
if have curl; then
  BASE=
  for s in https http; do [ "$(curl -sk -m 5 -o /dev/null -w '%{http_code}' $s://127.0.0.1:$PORT/ 2>/dev/null)" = 200 ] && { BASE=$s://127.0.0.1:$PORT; break; }; done
  if [ -n "$BASE" ]; then http_tests "$BASE" ""; else warn "HTTP console did not answer on 127.0.0.1:$PORT"; fi
else skip "HTTP tests: no curl on this device. Run them from a PC on the hotspot: sh matchi_selftest.sh http https://<IP>:2334"; fi

say
say "MANUAL (cannot be automated, see the Test Guide): T3 steps 1-2 from a phone, T5 console password, T6 banner, T7 sessionStorage, T8 stream after screen-off, T9 USB, T10 capacity after boot, T12 SMS list, T13 plugin import, T15 updates."
say "BOOT test: sh matchi_selftest.sh boot-setup, reboot, then boot-check."
say
say "RESULT: $PASS pass, $FAIL fail, $WARN warn, $SKIP skip   (report: $REPORT)"
[ "$FAIL" = 0 ]

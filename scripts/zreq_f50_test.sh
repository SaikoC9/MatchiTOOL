#!/system/bin/sh
# zreq on the F50 (see docs/dev-notes/binaries-tests.txt). Run as root on the device, paste the whole output.
#   sh zreq_f50_test.sh                 -> part 1 only: version, router web port (no password is sent)
#   ZPW='the-admin-password' sh zreq_f50_test.sh   -> part 1 + part 2: ONE sign-in attempt (never retried)
# Part 2 stops after one try on purpose: a wrong password can lock the router login.
Z=${Z:-/data/data/com.matchi.tool/files/zreq}
IP=${IP:-192.168.0.1}
[ -x "$Z" ] || { echo "NOZREQ: $Z"; exit 0; }
echo "=== version: $($Z -version 2>&1)   (expect: zreq 1.1 (MatchiTOOL))"
echo "=== 1. router web port: GET cmd=LD, no password"
PORT=
for p in 80 8080 9090 9999; do
  r=$($Z -ip "$IP:$p" -t 4 -params 'cmd=LD' 2>&1); rc=$?
  echo "  port $p: exit=$rc  $(echo "$r" | cut -c1-120 | tr '\n\r' '  ')"
  case "$r" in *'"LD"'*) [ -z "$PORT" ] && PORT=$p;; esac
done
[ -n "$PORT" ] && echo "  -> goform answers on $IP:$PORT" || { echo "  -> no port answered LD; stop here"; exit 0; }
[ -n "$ZPW" ] || { echo "=== 2. skipped (set ZPW='...' to run ONE sign-in)"; exit 0; }
echo "=== 2. one sign-in (-enc auto = SHA256(SHA256(pw)+LD)), then a read that needs the session"
PWF=/data/local/matchitool/tmp/zreq.pw; mkdir -p /data/local/matchitool/tmp
printf '%s' "$ZPW" > "$PWF"; chmod 600 "$PWF"
$Z -v -ip "$IP:$PORT" -pwd-file "$PWF" -params 'cmd=modem_main_state&multi_data=1' 2>&1 | cut -c1-200; echo "(exit 0 = signed in, 3 = router refused: do NOT retry)"
rm -f "$PWF"
echo "=== 3. same read WITHOUT a password (shows whether the call needs a session)"
$Z -ip "$IP:$PORT" -params 'cmd=modem_main_state&multi_data=1' 2>&1 | cut -c1-200

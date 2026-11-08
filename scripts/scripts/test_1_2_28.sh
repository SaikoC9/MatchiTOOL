#!/bin/sh
# MatchiTOOL 1.2.28 - checks for the fixes of the patched20 bug report. Runs on your PC, talks to the F50 through adb.
#
#   PASSWORD='your console password' sh scripts/test_1_2_28.sh
#
# Needs: adb (device connected, USB debugging on), curl, root on the F50, MatchiTOOL open once (host running).
# Optional: ADB_SERIAL=<serial>, PORT=2334, SKIP_CLOCK=1 (do not move the phone clock; skips the "old session" tests).
# The clock test moves the phone clock forward 5 h in steps and puts it back afterwards. Nothing here changes modem
# or USB settings: every write-type call is sent so that the gate refuses it, or with an invalid argument.

PORT=${PORT:-2334}
LP=${LP:-23340}
PASS=0; FAIL=0; SKIP=0
ok()   { PASS=$((PASS+1)); echo "PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL  $1${2:+  -> $2}"; }
skp()  { SKIP=$((SKIP+1)); echo "SKIP  $1"; }
A="adb ${ADB_SERIAL:+-s $ADB_SERIAL}"

command -v adb  >/dev/null || { echo "adb not found"; exit 1; }
command -v curl >/dev/null || { echo "curl not found"; exit 1; }
[ -n "$PASSWORD" ] || { echo "Set PASSWORD='...' (the console password)"; exit 1; }
$A get-state >/dev/null 2>&1 || { echo "No adb device"; exit 1; }
$A shell su -c id 2>/dev/null | grep -q uid=0 || { echo "No root through adb (su)"; exit 1; }

$A forward tcp:$LP tcp:$PORT >/dev/null
trap 'restore_clock; $A forward --remove tcp:$LP >/dev/null 2>&1' EXIT

BASE=
for s in https http; do
  c=$(curl -sk -m 6 -o /dev/null -w '%{http_code}' "$s://127.0.0.1:$LP/api/ping")
  [ "$c" = 401 ] || [ "$c" = 200 ] && { BASE="$s://127.0.0.1:$LP"; break; }
done
[ -n "$BASE" ] || { echo "Console not reachable on port $PORT. Open the MatchiTOOL app first."; exit 1; }
echo "Console: $BASE"

# req METHOD PATH [BODY] -> sets CODE and BODY_OUT
req() {
  m=$1; p=$2; b=$3
  if [ -n "$b" ]; then out=$(curl -sk -m 25 -X "$m" -H "x-token: $TOKEN" -H 'x-insecure-ok: 1' -H 'content-type: application/json' -d "$b" -w '\n%{http_code}' "$BASE$p")
  else out=$(curl -sk -m 25 -X "$m" -H "x-token: $TOKEN" -H 'x-insecure-ok: 1' -w '\n%{http_code}' "$BASE$p"); fi
  CODE=$(echo "$out" | tail -n1); BODY_OUT=$(echo "$out" | sed '$d')
}
expect() { # expect "name" "code" ["needle"]
  if [ "$CODE" = "$2" ] && { [ -z "$3" ] || echo "$BODY_OUT" | grep -q "$3"; }; then ok "$1"; else bad "$1" "got $CODE $(echo "$BODY_OUT" | head -c 160)"; fi
}
not403() { if [ "$CODE" != 403 ] && [ "$CODE" != 401 ]; then ok "$1 (code $CODE)"; else bad "$1" "got $CODE $(echo "$BODY_OUT" | head -c 160)"; fi; }

echo; echo "== Version"
v=$($A shell dumpsys package com.matchi.tool 2>/dev/null | tr -d '\r')
echo "$v" | grep -q 'versionName=1.2.28' && ok "versionName 1.2.28" || bad "versionName is not 1.2.28" "$(echo "$v" | grep -m1 versionName)"
echo "$v" | grep -q 'versionCode=228' && ok "versionCode 228" || bad "versionCode is not 228" "$(echo "$v" | grep -m1 versionCode)"

echo; echo "== Login"
TOKEN=$(curl -sk -m 15 -X POST -d "{\"password\":\"$PASSWORD\"}" "$BASE/api/login" | sed -n 's/.*"token" *: *"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] && ok "login gave a token" || { bad "login failed (wrong PASSWORD?)"; echo "RESULT: $PASS pass, $FAIL fail, $SKIP skip"; exit 1; }

echo; echo "== Bug 6: page (update box)"
page=$(curl -sk -m 15 "$BASE/")
echo "$page" | grep -q 'id="updurl"' && ok "update URL field present" || bad "update URL field missing"
echo "$page" | grep -q 'SaikoC9/MatchiTOOL-releases' && bad "page still points at SaikoC9/MatchiTOOL-releases" || ok "no foreign release link in the page"
echo "$page" | grep -q "PAGE_VERSION='1.2.28'" && ok "page version 1.2.28" || bad "page version is not 1.2.28"

echo; echo "== Bug 1: fresh session passes the gate (invalid arguments, so nothing changes)"
req POST /api/usb/control '{"action":"selftest_invalid_action"}'; not403 "usb/control reaches its own validation"
req POST /api/plugins '{"name":"../selftest.js","code":"//x"}';  expect "plugin upload reaches its own validation" 400 "invalid plugin name"
req POST /api/at '{"command":"AT+CSQ","slot":0}';               not403 "read-only AT (AT+CSQ) allowed"
req POST /api/at/batch '{"commands":["AT+COPS?","AT+CSQ","AT+CEREG?"],"slot":0}'; not403 "read-only AT batch allowed"

echo; echo "== Bug 5: upload url"
printf 'matchi test' > /tmp/.mt_up.txt
out=$(curl -sk -m 20 -H "x-token: $TOKEN" -H 'x-insecure-ok: 1' -F "file=@/tmp/.mt_up.txt;filename=mt_selftest.txt" "$BASE/api/upload" 2>/dev/null)
if echo "$out" | grep -q '"url"'; then
  echo "$out" | grep -q '"url":"/api/uploads/' && ok "upload answer url starts with /api/uploads/" || bad "upload url is wrong" "$out"
  req POST /api/uploads/delete '{"name":"mt_selftest.txt"}'
else skp "upload test (this build's upload format differs): $(echo "$out" | head -c 100)"; fi
rm -f /tmp/.mt_up.txt

echo; echo "== Bug 1: old session (clock moved forward 5 h in steps; the idle limit is 2 h)"
NOW0=; T0=
# Real time = the phone time at the start + the seconds this script has really used (so the phone is not left behind).
restore_clock() { [ -n "$NOW0" ] && { r=$((NOW0 + $(date +%s) - T0)); $A shell su -c "date -s @$r || date @$r" >/dev/null 2>&1; NOW0=; echo "(clock restored)"; }; }
if [ -n "$SKIP_CLOCK" ]; then skp "old-session tests (SKIP_CLOCK=1)"; else
  START=$($A shell su -c 'date +%s' | tr -d '\r'); T0=$(date +%s)
  setclock() { $A shell su -c "date -s @$1 || date @$1" >/dev/null 2>&1; }
  setclock $((START+6000)); got=$($A shell su -c 'date +%s' | tr -d '\r')
  if [ "$got" -lt $((START+5000)) ] 2>/dev/null; then T0=; skp "old-session tests (this ROM does not allow changing the clock; set it by hand in Settings and re-test)"
  else
    NOW0=$START   # from here the trap and restore_clock put the time back
    req GET /api/ping; echo "      (step 1: +1h40, ping $CODE)"
    setclock $((START+12000)); req GET /api/ping; echo "      (step 2: +3h20, ping $CODE)"
    setclock $((START+18000)); req GET /api/ping; echo "      (step 3: +5h, ping $CODE)"
    if [ "$CODE" != 200 ]; then bad "session did not survive the clock steps (ping $CODE); cannot test old-session rules"
    else
      req POST /api/shell '{"cmd":"id"}';                             expect "old session: /api/shell refused (reauth)" 403 '"reauth"'
      req POST /api/at '{"command":"AT+CFUN=1","slot":0}';           expect "old session: AT write refused (reauth)" 403 '"reauth"'
      req POST /api/at/batch '{"commands":["AT+CSQ","AT+CFUN=1"],"slot":0}'; expect "old session: AT batch with a write refused" 403 '"reauth"'
      req POST /api/usb/control '{"action":"selftest_invalid_action"}'; expect "old session: usb/control refused" 403 '"reauth"'
      req POST /api/imei/apply '{"force":false}';                     expect "old session: imei/apply refused" 403 '"reauth"'
      req POST /api/screen/input '{"type":"tap","x":1,"y":1}';        expect "old session: screen/input refused" 403 '"reauth"'
      req POST /api/update/install '{"sha256":"00"}';                 expect "old session: update/install refused" 403 '"reauth"'
      req POST /api/plugins '{"name":"../selftest.js","code":"//x"}'; expect "old session: plugin upload refused" 403 '"reauth"'
      req POST /api/plugins/delete '{"name":"Nope.js","erase":true}'; expect "old session: plugin erase refused" 403 '"reauth"'
      req POST /api/plugins/delete '{"name":"Nope.js"}';              not403 "old session: plain plugin delete still allowed"
      req POST /api/at '{"command":"AT+CSQ","slot":0}';               not403 "old session: read-only AT still allowed (polling keeps working)"
      req POST /api/at/batch '{"commands":["AT+COPS?","AT+CSQ"],"slot":0}'; not403 "old session: read-only batch still allowed"
    fi
    restore_clock
  fi
fi

echo; echo "== Bug 2: LAN firewall watcher (needs your hands: see below)"
echo "      interfaces now : $($A shell 'ip -o link show up 2>/dev/null | cut -d: -f2' | tr -d '\r' | tr '\n' ' ')"
echo "      INPUT rule 2334: $($A shell su -c "iptables -S INPUT 2>/dev/null | grep -c $PORT" | tr -d '\r') rule(s)"
echo "      1) turn the hotspot OFF, reboot, wait 3 min  2) turn it ON  3) wait 60 s  4) run:"
echo "         adb shell su -c 'iptables -S INPUT | grep $PORT'   -> a rule for the new br/ap/swlan interface must be there"
echo "         adb logcat -d -s MatchiTOOL | grep -i 'LAN interface'   -> no 'failed' lines"
skp "bug 2 is a manual check"

echo; echo "== Bug 3: root denied (needs your hands)"
echo "      revoke root for MatchiTOOL in the root manager, open Screen control for 2 min, then:"
echo "         adb logcat -d | grep -i -E 'su:|denied|root request'   -> at most one request per ~45 s"
skp "bug 3 is a manual check"

echo; echo "== App log (crashes)"
cr=$($A logcat -d -b crash 2>/dev/null | grep -c 'com.matchi.tool')
[ "$cr" = 0 ] && ok "no crash entries for com.matchi.tool" || bad "$cr crash log lines mention com.matchi.tool" "adb logcat -d -b crash"

echo; echo "RESULT: $PASS pass, $FAIL fail, $SKIP skip"
[ "$FAIL" = 0 ]

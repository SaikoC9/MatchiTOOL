#!/usr/bin/env bash
# Upgrade test for the "old leftovers" cleanup (LEGACY registry in the page).
# Builds a fake OLD layout in a temp folder (old watchers, old nfqws, old scripts, an unrelated script, a decoy process),
# runs the generated legacy_scan / legacy_clean, and checks that every leftover is gone and nothing else was touched.
# Add a case here whenever a new entry is added to LEGACY.
set -u
HTML="$(dirname "$0")/../app/src/main/assets/web/index.html"
T=$(mktemp -d); R=$T/root; mkdir -p "$R/matchitool/ttl" "$R/matchitool/dpi"
cleanup() { pkill -f "$T" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
node -e '
const fs=require("fs"); const h=fs.readFileSync(process.argv[1],"utf8");
const code=h.slice(h.indexOf("// LEGACY-BEGIN"),h.indexOf("// LEGACY-END"))+"\nmodule.exports={LEGACY_SH};";
fs.writeFileSync(process.argv[2]+"/leg.js",code);
fs.writeFileSync(process.argv[2]+"/legacy.sh",require(process.argv[2]+"/leg.js").LEGACY_SH.split("/data/local").join(process.argv[3])+"\n");
' "$HTML" "$T" "$R" || { echo "FAIL: could not extract LEGACY_SH"; exit 1; }
sh -n "$T/legacy.sh" || { echo "FAIL: generated shell has a syntax error"; exit 1; }
printf '#!/bin/sh\n# TTL helper: legacy\nwhile :; do sleep 1; done\n' > "$R/matchitool/ttl/ttl.sh"
# the old dpi watcher respawns nfqws whenever it is gone (like the real old keep-alive), so the cleanup must freeze it before killing
printf '#!/bin/sh\n# anti-DPI helper: legacy\nwhile :; do pgrep -f "%s/matchitool/dpi/nfqws" >/dev/null 2>&1 || { setsid "%s/matchitool/dpi/nfqws" </dev/null >/dev/null 2>&1 & }; sleep 0.05; done\n' "$R" "$R" > "$R/matchitool/dpi/dpi.sh"
printf '#!/bin/sh\nsleep 300\n' > "$R/matchitool/dpi/nfqws"; chmod 755 "$R/matchitool/dpi/nfqws"
echo 4242 > "$R/matchitool/dpi/nfqws.pid"; echo keep > "$R/matchitool/dpi/user-notes.txt"
printf '#!/bin/sh\n# my own script\nexit 0\n' > "$R/matchitool/other.sh"
setsid sh "$R/matchitool/ttl/ttl.sh" watch </dev/null >/dev/null 2>&1 &
setsid sh "$R/matchitool/dpi/dpi.sh" watch </dev/null >/dev/null 2>&1 &
setsid "$R/matchitool/dpi/nfqws" --qnum=200 --daemon --pidfile="$R/matchitool/dpi/nfqws.pid" </dev/null >/dev/null 2>&1 &
setsid bash -c "exec -a 'vi $R/matchitool/dpi/dpi.sh watch' sleep 300" </dev/null >/dev/null 2>&1 &
sleep 1
fail=0
chk() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
before=$(timeout 60 sh -c ". $T/legacy.sh; legacy_scan" </dev/null)
chk "scan finds 3 old processes" '[ "$(echo "$before" | grep -c "^PROC ")" = 3 ]'
chk "scan finds 2 old scripts"   '[ "$(echo "$before" | grep -c "^SCRIPT ")" = 2 ]'
chk "scan finds the old pid file" '[ "$(echo "$before" | grep -c "^FILE ")" = 1 ]'
dry=$(LEGACY_DRY=1 timeout 90 sh -c ". $T/legacy.sh; legacy_clean" </dev/null)
chk "dry run lists what it would do" '[ "$(echo "$dry" | grep -c "^WOULD_KILL ")" = 3 ] && [ "$(echo "$dry" | grep -c "^WOULD_STUB ")" = 2 ] && [ "$(echo "$dry" | grep -c "^WOULD_REMOVE ")" = 1 ]'
chk "dry run changes nothing"    '[ "$(timeout 60 sh -c ". $T/legacy.sh; legacy_scan" </dev/null)" = "$before" ] && [ -e "$R/matchitool/dpi/nfqws.pid" ]'
out=$(timeout 90 sh -c ". $T/legacy.sh; legacy_clean" </dev/null 2>&1)
chk "clean prints no LEFT lines" '! echo "$out" | grep -q "^LEFT "'
after=$(timeout 60 sh -c ". $T/legacy.sh; legacy_scan" </dev/null)
chk "nothing left after clean"   '[ -z "$after" ]'
chk "old pid file removed"       '[ ! -e "$R/matchitool/dpi/nfqws.pid" ]'
chk "other files in old folder kept" 'grep -q keep "$R/matchitool/dpi/user-notes.txt"'
chk "old scripts are stubs"      'grep -q MATCHI_LEGACY_STUB "$R/matchitool/ttl/ttl.sh" && grep -q MATCHI_LEGACY_STUB "$R/matchitool/dpi/dpi.sh"'
chk "unrelated script untouched" 'grep -q "my own script" "$R/matchitool/other.sh"'
chk "decoy process survives"     'pgrep -f "vi $R/matchitool/dpi/dpi.sh watch" >/dev/null'
chk "events log written"         'grep -q "legacy: stopped" "$R/matchitool/events.log"'
again=$(timeout 90 sh -c ". $T/legacy.sh; legacy_clean" </dev/null)
chk "second clean is a no-op"    '[ -z "$again" ]'
[ "$fail" = 0 ] && echo "legacy cleanup test passed" || { echo "legacy cleanup test FAILED"; exit 1; }

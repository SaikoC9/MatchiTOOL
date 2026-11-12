#!/bin/sh
# Runs the real BOOT_SCRIPT from HostService.kt against a temp folder with a fake root-owned `stat`:
# a slow script and a failing script must be logged to events.log and must NOT stop the scripts after them.
set -u
here=$(cd "$(dirname "$0")" && pwd)
src="$here/../app/src/main/java/com/matchi/tool/HostService.kt"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail=0
ok()  { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }

python3 - "$src" "$work" <<'PY' || exit 1
import re, sys
src = open(sys.argv[1]).read()
m = re.search(r'BOOT_SCRIPT = """\n(.*?)\n"""', src, re.S)
s = m.group(1).replace('\u00a7', '$')
s = s.replace('/system/bin/sh', '/bin/sh').replace('D=/data/local/matchitool', 'D=' + sys.argv[2] + '/mt', 1).replace('T=25', 'T=1', 1)
open(sys.argv[2] + '/boot_script.sh', 'w').write(s)
PY

mkdir -p "$work/mt/boot.d" "$work/bin"
# the script only runs files owned by root; pretend everything is root-owned and not group/other-writable
printf '#!/bin/sh\necho "0 -rwxr-xr-x"\n' > "$work/bin/stat"; chmod +x "$work/bin/stat"
echo 'touch '"$work"'/ran_boot_sh' > "$work/mt/boot.sh"
echo 'touch '"$work"'/ran_10' > "$work/mt/boot.d/10-ok.sh"
echo 'sleep 10; touch '"$work"'/ran_20_late' > "$work/mt/boot.d/20-slow.sh"
echo 'exit 3' > "$work/mt/boot.d/30-fail.sh"
echo 'touch '"$work"'/ran_40' > "$work/mt/boot.d/40-after.sh"

start=$(date +%s)
PATH="$work/bin:$PATH" sh "$work/boot_script.sh" > "$work/out.txt" 2>&1
took=$(( $(date +%s) - start ))

[ -f "$work/ran_boot_sh" ] && ok "boot.sh ran" || bad "boot.sh did not run"
[ -f "$work/ran_10" ] && ok "first boot.d script ran" || bad "first boot.d script did not run"
[ ! -f "$work/ran_20_late" ] && ok "slow script was stopped" || bad "slow script was not stopped"
[ -f "$work/ran_40" ] && ok "script after the slow and the failing one still ran" || bad "later script was cancelled"
[ "$took" -lt 8 ] && ok "whole run took ${took}s, not the slow script's 10 s" || bad "run took ${took}s"
grep -q '20-slow.sh stopped' "$work/mt/events.log" && ok "timeout written to events.log" || bad "timeout missing in events.log"
grep -q '30-fail.sh exited with code 3' "$work/mt/events.log" && ok "non-zero exit written to events.log" || bad "exit code missing in events.log"
[ "$(grep -c '10-ok\|40-after\|boot\.sh' "$work/mt/events.log")" = 0 ] && ok "successful scripts are not logged" || bad "successful script logged"

# Legacy Bypass lines: removed once, copy kept, the other boot.sh lines still run.
[ -e "$work/mt/.bypass-cleanup-done" ] && ok "earlier runs already used up the one-time cleanup" || bad "marker not set by a normal run"
rm -f "$work/mt/events.log" "$work/ran_boot_sh" "$work/ran_keep" "$work/mt/.bypass-cleanup-done"
printf 'echo bypass_rule_1 > /dev/null\n# BYPASS block\ntouch %s/ran_keep\n' "$work" > "$work/mt/boot.sh"
PATH="$work/bin:$PATH" sh "$work/boot_script.sh" > "$work/out2.txt" 2>&1
! grep -qi bypass "$work/mt/boot.sh" && ok "legacy Bypass lines removed from boot.sh" || bad "Bypass lines still in boot.sh"
grep -qi bypass "$work/mt/boot.sh.pre-bypass-removal" && ok "copy of the old boot.sh kept" || bad "no copy of the old boot.sh"
[ -f "$work/ran_keep" ] && ok "other boot.sh lines still ran" || bad "other boot.sh lines did not run"
grep -q 'removed legacy Bypass lines' "$work/mt/events.log" && ok "removal written to events.log" || bad "removal missing in events.log"

[ -e "$work/mt/.bypass-cleanup-done" ] && ok "marker set after the cleanup" || bad "marker missing after the cleanup"

# One time only: a "bypass" line a plugin writes later is left alone, and nothing is logged.
rm -f "$work/mt/events.log"
printf 'touch %s/ran_plugin # bypass plugin line\n' "$work" > "$work/mt/boot.sh"
cp "$work/mt/boot.sh" "$work/boot_plugin.sh"
PATH="$work/bin:$PATH" sh "$work/boot_script.sh" > "$work/out_plugin.txt" 2>&1
cmp -s "$work/mt/boot.sh" "$work/boot_plugin.sh" && ok "later line naming bypass is not removed" || bad "later bypass line was removed"
[ -f "$work/ran_plugin" ] && ok "later line naming bypass still ran" || bad "later bypass line did not run"

# If removing the lines would leave broken shell, boot.sh stays as it was.
rm -f "$work/mt/events.log" "$work/mt/.bypass-cleanup-done"
printf 'if true; then # bypass\ntouch %s/ran_keep2\nfi\n' "$work" > "$work/mt/boot.sh"
cp "$work/mt/boot.sh" "$work/boot_before.sh"
PATH="$work/bin:$PATH" sh "$work/boot_script.sh" > "$work/out3.txt" 2>&1
cmp -s "$work/mt/boot.sh" "$work/boot_before.sh" && ok "unsafe removal refused, boot.sh unchanged" || bad "boot.sh was changed although the result is broken"
grep -q 'could not be removed safely' "$work/mt/events.log" && ok "manual-edit warning written to events.log" || bad "warning missing in events.log"
[ "$fail" = 0 ] && echo "boot tasks test passed" || { cat "$work/out.txt"; cat "$work/mt/events.log" 2>/dev/null; exit 1; }

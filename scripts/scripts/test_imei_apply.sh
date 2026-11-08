#!/bin/sh
# Runs the real imei_apply.sh against a fake `sendat` (modem simulator) in a temp folder.
#  1. firmware restores the factory IMEI before every boot -> the keeper must re-write it on every boot (no 3-boot limit)
#  2. modem rejects the write (ERROR) -> the keeper stops after 3 failed tries, FORCE=1 overrides
#  3. a sendat that reads stdin must not swallow the second slot of the target list
set -u
here=$(cd "$(dirname "$0")" && pwd)
src="$here/../app/src/main/assets/bin/imei_apply.sh"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail=0
ok()  { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }

mkdir -p "$work/d"
sed "s#__SENDAT__#$work/sendat#; s#^D=.*#D=$work/d#" "$src" > "$work/run.sh"
# fake modem: state file per slot; MODE=ok accepts AT+SPIMEI, MODE=err answers ERROR; reads all of stdin (greedy)
cat > "$work/sendat" <<FAKE
#!/bin/sh
cat >/dev/null
slot=\$2; cmd=\$4
f=$work/imei_\$slot
[ -f "\$f" ] || echo 358000000000009 > "\$f"
case "\$cmd" in
  AT+CGSN) cat "\$f" ;;
  AT+SPIMEI*) if [ "\$(cat $work/mode)" = ok ]; then echo "\$cmd" | grep -oE '[0-9]{15}' > "\$f"; echo OK; else echo ERROR; fi ;;
  *) echo OK ;;
esac
FAKE
chmod +x "$work/sendat"

printf '0 860000000000001\n1 860000000000002\n' > "$work/d/imei_target.txt"

# 1 + 3: five boots, factory IMEI restored each time, two slots
echo ok > "$work/mode"
for b in 1 2 3 4 5; do
  echo 358000000000009 > "$work/imei_0"; echo 358000000000009 > "$work/imei_1"
  out=$(sh "$work/run.sh" 2>&1)
  if echo "$out" | grep -q 'slot 0: 358000000000009 -> 860000000000001 : OK' && echo "$out" | grep -q 'slot 1: 358000000000009 -> 860000000000002 : OK'; then :; else bad "boot $b: not both slots re-written: $out"; fi
done
[ "$(cat "$work/imei_0")" = 860000000000001 ] && [ "$(cat "$work/imei_1")" = 860000000000002 ] && ok "5 boots: both slots re-written every time (no give-up, stdin not swallowed)" || bad "IMEI not applied"

# 2: modem rejects writes
rm -f "$work/d/imei_tries.txt"; echo err > "$work/mode"
echo 358000000000009 > "$work/imei_0"; echo 358000000000009 > "$work/imei_1"
for b in 1 2 3; do sh "$work/run.sh" >/dev/null 2>&1; done
out=$(sh "$work/run.sh" 2>&1)
echo "$out" | grep -q 'slot 0: gave up after 3 tries' && ok "failed writes stop after 3 tries" || bad "no give-up after 3 failed tries: $out"
out=$(FORCE=1 sh "$work/run.sh" 2>&1)
echo "$out" | grep -q 'gave up' && bad "FORCE=1 did not override the limit" || ok "FORCE=1 overrides the limit"

[ "$fail" = 0 ] && echo "imei_apply test passed" || { echo "imei_apply test FAILED"; exit 1; }

# MatchiTOOL IMEI keeper. Run as root. Re-writes the IMEI the user chose whenever the modem reports a different one
# (the firmware can put the factory IMEI back at boot). Target list: one "<slot> <imei>" per line.
# WAIT=<n> : wait up to n * 3 seconds for the modem to answer (boot); 0 = do not wait.
D=/data/local/matchitool
T=$D/imei_target.txt
C=$D/imei_tries.txt
S="__SENDAT__"
[ -s "$T" ] || { echo "no saved IMEI"; exit 0; }
[ -x "$S" ] || { echo "sendat missing"; exit 1; }
i=0
while [ "$i" -lt "${WAIT:-0}" ]; do
  o=$("$S" -n 0 -c 'AT+CGSN' 2>&1)
  echo "$o" | grep -qE '[0-9]{15}' && break
  i=$((i+1)); sleep 3
done
changed=0
while read -r slot imei rest; do
  case "$slot" in 0|1) ;; *) continue ;; esac
  echo "$imei" | grep -qE '^[0-9]{15}$' || continue
  cur=$("$S" -n "$slot" -c 'AT+CGSN' 2>&1 | grep -oE '[0-9]{15}' | head -n 1)
  if [ -z "$cur" ]; then echo "slot $slot: IMEI unreadable"; continue; fi
  if [ "$cur" = "$imei" ]; then
    echo "slot $slot: already $imei"
    [ -f "$C" ] && { grep -v "^$slot " "$C" > "$C.n" 2>/dev/null; mv -f "$C.n" "$C"; }
    continue
  fi
  n=$(grep -c "^$slot " "$C" 2>/dev/null)
  if [ "${n:-0}" -ge 3 ] && [ "${FORCE:-0}" != 1 ]; then echo "slot $slot: gave up after 3 tries"; continue; fi
  echo "$slot $(date +%s)" >> "$C"
  r=$("$S" -n "$slot" -c "AT+SPIMEI=$slot,\"$imei\"" 2>&1)
  echo "slot $slot: $cur -> $imei : $r"
  echo "$r" | grep -q 'OK' && changed=1
done < "$T"
if [ "$changed" = 1 ]; then
  echo "restarting modem"
  "$S" -n 0 -c 'AT+CFUN=1,1' 2>&1
fi
exit 0

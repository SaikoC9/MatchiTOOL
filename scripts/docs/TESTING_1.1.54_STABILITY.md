# MatchiTOOL 1.1.54 — Stability validation

This release applies conservative app-side resource controls. It does not change ZTE vendor thermal policy, CPU/GPU frequencies, charging controls, modem firmware, or SFP hardware acceleration.

## Resource / leak checks
1. Run 20 short root diagnostics in sequence; confirm no more than two concurrent root commands are accepted.
2. Start a deliberately slow root command and submit another request; confirm the UI receives a capacity message rather than creating unlimited `su` processes.
3. Run a noisy command; confirm app memory remains bounded and output is reported as truncated if the cap is reached.
4. Open and close Screen Control 10 times; inspect `ps -A | grep -E 'screencap|su -c sh'` and confirm capture processes disappear after viewers leave.
5. Leave the web console idle for 15 minutes; confirm the screen-stream worker and persistent shell sessions are released.

## ZTE F50 thermal checks
1. Record battery temperature, modem thermal-zone readings, system maximum, and ambient conditions at idle.
2. Repeat with normal browsing and tethering; compare equivalent conditions rather than a single sensor.
3. Confirm polling slows as thermal status rises and resumes after cooling.
4. Confirm vendor thermal services remain enabled; do not force CPU/GPU clocks, voltage, charging limits, or thermal-zone trip points.

## Network / Bypass regression
1. Record `ip route show table all`, `ip rule`, and hotspot interface state before testing.
2. Verify TTL BPF remains on `br0`, `usb0`, and `wlan0` only when those interfaces are not the current uplink.
3. Confirm existing SFP filters remain present and unchanged on `br0` / `sipa_eth0`.
4. Toggle TTL off and on; verify the plugin removes only its own `ttl_bpf` filter and does not flush qdiscs or unrelated filters.
5. Test NFQ with a known-working baseline connection. If baseline internet is unavailable, do not attribute failure to NFQ or enable it for diagnosis.
6. Verify internet and DNS after disabling NFQ; check IPv4 and IPv6 separately.

## Soak test
- 24-hour uptime with periodic dashboard use.
- Reboot 10 times and verify one host service, one screen worker at most, and no duplicate boot watchers.
- Disconnect/reconnect hotspot and USB tethering; confirm recovery without adding duplicate firewall or tc rules.
- Save logs without credentials, session tokens, IMEI values, or modem authentication data.

## Acceptance
A test is passed only when observed on the actual F50 firmware. Static source checks do not certify runtime behavior or guarantee a particular temperature.


## Patch 1 additional check — bounded root output
1. Run a root diagnostic that emits more than 1 MiB of output.
2. Confirm the command returns a truncation notice or a clear shell-termination/limit message, and that the temporary `.matchi_out_*` file does not continue growing without bound.
3. Confirm a normal small root command succeeds immediately afterward (a size-limit signal may retire the affected persistent shell, which should be recreated on demand).
4. Repeat on the actual F50 root shell because `ulimit -f` support and behavior vary between Android shell implementations.

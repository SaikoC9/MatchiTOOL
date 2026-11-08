# MatchiTOOL 1.2.0 — Stability-first integration test plan

## Smart F50 Monitor (read-only)
1. Open the monitor and confirm it reports CPU, memory, battery, thermal zones, load, uptime, and network interfaces when the kernel exposes them.
2. Allow two samples before evaluating CPU and network rates; the first sample intentionally establishes a baseline.
3. Close the monitor and confirm polling stops. Hide the browser tab and confirm polling pauses; restore it and confirm monitoring resumes.
4. Confirm the refresh interval is 30 seconds at ordinary reported temperatures, 90 seconds at elevated readings (55 °C or above), and 60 seconds at high readings (65 °C or above).
5. Compare battery temperature against the battery sysfs value and thermal-zone values against the device's own diagnostic output. Sensor units/names vary by firmware.
6. Confirm the monitor makes no writes to sysfs, modem settings, firewall rules, CPU/GPU frequencies, charging controls, or vendor thermal services.
7. Confirm unavailable sensors are shown as unavailable rather than fabricated.

## Advanced Network Diagnostics
1. Run the tool on a working hotspot and compare reported addresses/routes with `ip addr` and `ip route`.
2. Confirm gateway, public IPv4, public IPv6, and DNS results are displayed independently.
3. Repeat with ICMP filtered or IPv6 unavailable; failures must not be presented as definitive proof of no internet.
4. Confirm diagnostics do not change routes, DNS properties, firewall rules, or modem state.

## Network and existing-feature regression
1. Compare `ip route show table all`, `ip rule`, interface counters, and DNS before and after opening the monitor; the monitor must not change network state.
2. Run the existing Bypass regression in `TESTING_1.1.54_STABILITY.md`, including preservation of SFP filters.
3. Recheck root concurrency/output caps, plugin management, screen control cleanup, USB controls, and OTA update validation.

## Thermal and soak checks
1. Repeat monitor checks at idle and during ordinary tethering; do not create artificial heat or disable vendor protections.
2. Verify polling slows at high reported temperatures and pauses when closed/hidden.
3. Run a 24-hour normal-use soak and check battery impact, host-service stability, and root-shell cleanup.

## Acceptance limits
- Static validation checks source syntax, XML, embedded tool count, and safety markers only.
- This release does not claim confirmed hardware throttling: temperature bands are advisory, and a modem thermal sensor may not be exposed by the kernel.
- Device runtime tests must be completed on the actual ZTE F50 firmware before calling the build field-certified.

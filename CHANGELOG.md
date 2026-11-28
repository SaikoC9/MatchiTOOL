# MatchiTOOL 1.4.6

- Added: Network > Light tab. Turns the router indicator light On / Off like the stock page, with a confirm and a re-read. The call (`INDICATOR_LIGHT_SETTING`) was captured from the stock page. Sends nothing when the router does not report the value. See `docs/NETWORK_FORMATS.md`.
- Added: uninstall wipe. A root watcher removes MatchiTOOL's root-side files, firewall rules, speed limits and programs after you uninstall. Plugins are cleaned from a saved list.
- Added: home button **Wipe on uninstall** (ON by default) with status and list.
- Not touched on uninstall: Wi-Fi, LAN IP, IMEI, router settings, USB mode, adb.
- Fixed: uninstall left the OpenWrt VM running. Clients stayed on 192.168.88.x and the console was unreachable. The wipe now stops the VM, removes its network and `/data/local/matchi_owrt`.
- Fixed: after 5 failed tries the wipe left its folder and boot script behind. Now it removes them and keeps only a one-line log.
- Fixed: boot log capture could silently not start after a reboot or power cut when the old `logd.pid` named another running process. The script and the app now check the process name before trusting or killing a pid. Boot script version 7.

# MatchiTOOL 1.4.5

- Added: plugin guard kill mode (default). A plugin over its CPU budget for 30 s is killed. A non-plugin program holding 90 % of one core for 30 s is killed (summed per program name; system, radio and network programs protected). `POST /api/guard/state` takes `action` (throttle|freeze|kill) and `runaway`.
- Fixed: Mobile data off / on and Rename device did nothing until a router reboot. The router could drop the console's sign-in while reads still worked. The host now checks the sign-in before each change, signs in again, and resends when no change shows.
- Added: Limit speed in Network > Devices. Per-device Download and Upload caps in KB/s via `tc`, restored after reboot. IPv4 only. See `docs/LIMIT_SPEED.md`.
- Added: Network > Wi-Fi switch (off by default) to turn hotspot Wi-Fi off while USB tethering works.
- Added: bundled programs are hash-checked before they run as root. Full diagnose lists each file.
- Added: `matchi-doctor`, a read-only checker run by Full diagnose.
- Added: `matchi-guard` and a Plugin guard card on home (off by default): per-plugin CPU and memory, throttling, ending stuck helpers.
- Changed: Plugin guard card has a new look.
- Added: resource-rule lint in CI and `docs/PLUGIN_RULES.md`. Delete-dialog size probe moved to `PluginProbe.kt`.
- Fixed: plugin process scan no longer reads `/proc/PID/cmdline` via `grep` and `tr`; it uses `ps`.
- Added: optional "Fast sampler" for the Live panel (off by default). Shell loop stays as fallback.
- Changed: rebuilt `curl` 8.23.0, OpenSSL 3.5.9, `jq` 1.8.2, `sendat` and `zreq` on Go 1.26.10, one release pipeline (`release-tools.yml`).
- Fixed: false "folder can be written by other users" warning at every start.

# MatchiTOOL 1.4.4

- Added: protected web pages for plugins (`// @matchi-gate`, `matchi.gate.open`). AdGuard Home uses it.
- Added: live push stream, about one reading per second, only while a tab watches.
- Changed: UFI-TOOLS code removed. Plugins use the `matchi.*` API.
- Changed: Change IP and Memory Cleaner rewritten. `zreq` and `curl` were rebuilt.
- Fixed: network and radio changes the router ignored are now detected and retried.

# MatchiTOOL 1.4.2

- Added: Turn off and store-install dialogs list a plugin's stop commands.
- Changed: every "type the password again" check uses one helper with the login lockout.
- Changed: more routes need a fresh sign-in (plugin toggle, update, screen frame, router set calls).
- Fixed: SMS delete, long texts, multiple numbers. Full diagnose reads the `sendat` header correctly.
- Removed: one-time Bypass cleanup of `boot.sh`. Delete any Bypass lines by hand.

# MatchiTOOL 1.4.1

- Added: Radio settings and Cell lock cards, Live status polling guard, Log basket.
- Added: **Delete and stop** and **Turn off and stop** for plugins (process sweep, firewall and boot-script undo).
- Added: sandboxed plugins, integrity checks, HttpOnly session cookie.
- Changed: root over plain HTTP off by default. Console password: 310,000 PBKDF2 iterations.
- Changed: `WebServer.kt` split into `WebRoutes*.kt`. One version source: `version.properties`.

# MatchiTOOL 1.4.0

- Added: plugin manager, plugin store, bundled tools (`jq`, `sha256`, `zreq`), security pass.

# MatchiTOOL 1.3.9

- Added: bundled arm64 `curl` for plugins that download files.

# MatchiTOOL 1.3.8

- Changed: Log Catcher hides private data in single-file exports and copies. Keep-every-line switch.

# MatchiTOOL 1.3.7

- Added: boot capture (Magisk, KernelSU, APatch), log redaction, full bundle export, boot-log viewer.

# MatchiTOOL 1.3.6 - 1.3.3

- Added: Log Catcher recovery of interrupted sessions, device-wide capture, live stream, search, export.
- Fixed: whole-process logcat capture, paired `.log` and `.txt` files, session file created before "active".

# MatchiTOOL 1.3.2 - 1.3.0

- Changed: Log Catcher polling 1.5 s to 3 s. Session IDs no longer collide.

# MatchiTOOL 1.2.x

- Added: Advanced Network Diagnostics (1.2.0), self-signed HTTPS (1.2.1), sign-out and per-login sessions (1.2.2).
- Added: Change IP and CPU Governor built in (1.2.19-1.2.20).
- Changed: one `rootGate()` guards every root call (1.2.28). Login lockout, upload limits, audit log (1.2.27).
- Fixed: update error "The APK has no valid signature" (1.2.1-1.2.3).

# MatchiTOOL 1.1.x

- Added: admin password login and LAN access (1.1.0-1.1.13). Live device status and Full diagnose (1.1.14-1.1.30).
- Added: Screen control (1.1.31-1.1.46). Permanent signing key and OTA update from an https link (1.1.47).
- Changed: router password in Android Keystore (1.1.48-1.1.49). Bounded root output (1.1.52-1.1.54).

# MatchiTOOL 1.0.x (2026-11-05)

- 1.0.1: product name and archive names standardised as MatchiTOOL.
- 1.0.0: forked the Android host. UFI `socat` bridge replaced by an optional direct `su -c sh` backend.

Full per-version notes: [`docs/history/CHANGELOG_DETAIL.md`](docs/history/CHANGELOG_DETAIL.md).

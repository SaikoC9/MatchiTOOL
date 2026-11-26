# MatchiTOOL 1.4.6

- Added: uninstall wipe. A root watcher removes MatchiTOOL's root-side files, firewall rules, speed limits and programs after you uninstall the app. Plugins are cleaned from a saved list. Not tested on the F50 yet.
- Added: home row button **Wipe on uninstall**: switch (ON by default), status, list of what is removed.
- Not touched on uninstall: Wi-Fi, LAN IP, IMEI, router settings, USB mode, adb.

# MatchiTOOL 1.4.5

- Added: plugin guard kill mode (default): a plugin over its CPU budget for 30 s is killed, and a program that is not a plugin and keeps 90 % of one core for 30 s is killed (summed per program name, so a spinner that changes core or PID still counts; system, radio and network programs are protected). POST /api/guard/state accepts `action` (throttle|freeze|kill) and `runaway`.
- Fixed: Mobile data off / on and Rename device did nothing until the router was rebooted. The router can drop the console's sign-in while reads still work, and then ignores every change in silence. The host now checks the sign-in before each change and signs in again when it is gone, and these two actions resend (fresh sign-in, then the older token) when the router shows no change.
- Added: Limit speed in Network > Devices: per-device Download and Upload caps in KB/s, set on the phone with root (`tc`), put back after a reboot. IPv4 only; not yet verified on a real F50 (see `docs/LIMIT_SPEED.md`).
- Added: switch in Network > Wi-Fi (off by default) that turns the hotspot Wi-Fi off while USB tethering works.
- Added: bundled programs are hash-checked before they run as root. Full diagnose lists each file.
- Added: `matchi-doctor`, a read-only checker that Full diagnose now runs.
- Added: `matchi-guard` and a Plugin guard card on the home page (off by default): per-plugin CPU and memory, throttling of plugins over budget, and ending of stuck helpers (`tr`, `du`, `grep`).
- Changed: the Plugin guard card has a new look: bordered box, status dot, small info pills, round buttons and a roomier table that keeps numbers on one line on narrow screens.
- Added: resource-rule lint in CI (`du`/`find` without `-x`, `/proc/PID/cmdline` reads, busy loops, timers on expensive routes) and `docs/PLUGIN_RULES.md`. The Delete dialog size probe moved to `PluginProbe.kt` with tests.
- Fixed: the plugin process scan no longer reads `/proc/PID/cmdline` through `grep` and `tr`; it uses `ps`.
- Added: optional "Fast sampler" for the Live panel (off by default). The shell loop stays as the fallback.
- Changed: rebuilt `curl` 8.23.0, OpenSSL 3.5.9, `jq` 1.8.2 and `sendat` / `zreq` on Go 1.26.10, with one release pipeline (`release-tools.yml`).
- Fixed: a false "folder can be written by other users" warning at every start.
-Tested on the F50 (MU300, root, 19-20 Nov 2026) except a tether of 30 minutes or more (T11 in `docs/TESTING.md`). Still to do: run `scripts/pin-actions.sh` Fixed .

# MatchiTOOL 1.4.4

- Added: protected web pages for plugins (`// @matchi-gate`, `matchi.gate.open`). AdGuard Home uses it.
- Added: live panel push stream, about one reading per second, only while a tab is watching.
- Changed: UFI-TOOLS code removed. Plugins now use the `matchi.*` API.
- Changed: Change IP and Memory Cleaner rewritten. `zreq` and `curl` are MatchiTOOL's own builds.
- Fixed: Network and radio changes that the router ignored are now detected and retried.
- Tested on the F50: radio restart, `sendat`, `zreq`. Not run on the device: the gate, Change IP, Memory Cleaner, the new `curl` and the Live stream.

# MatchiTOOL 1.4.2

- Added: Turn off dialog and store install dialog list the plugin's stop commands.
- Changed: every "type the password again" check goes through one helper, with the same lockout as login.
- Changed: more routes need a fresh sign-in (plugin toggle, update, screen frame, router set calls).
- Fixed: SMS delete, long texts and multiple numbers. Full diagnose reads the `sendat` header correctly.
- Removed: the one-time Bypass cleanup of `boot.sh`. Delete any Bypass lines there by hand.
- Tested on the F50 (14-15 Nov 2026): stop dialogs, Delete and stop, sandbox stop hook.

# MatchiTOOL 1.4.1

- Added: Radio settings and Cell lock cards, Live status polling guard, Log basket.
- Added: **Delete and stop** and **Turn off and stop** for plugins, with process sweep and firewall and boot-script undo.
- Added: sandboxed plugins, plugin integrity checks, HttpOnly session cookie.
- Changed: root over plain HTTP is off by default. Console password uses 310,000 PBKDF2 iterations.
- Changed: `WebServer.kt` split into `WebRoutes*.kt`. One version source, `version.properties`.
- Tested on the F50 (11-15 Nov 2026). Checklist: `docs/F50_CHECKLIST.md`.

# MatchiTOOL 1.4.0

- Added: plugin manager, plugin store, bundled tools (`jq`, `sha256`, `zreq`), security pass.

# MatchiTOOL 1.3.9

- Added: bundled arm64 `curl`, so plugins that download files work.

# MatchiTOOL 1.3.8

- Changed: Log Catcher hides private data in single-file exports and copies too. Keep-every-line switch.

# MatchiTOOL 1.3.7

- Added: boot capture (Magisk, KernelSU, APatch), log redaction, full bundle export, boot-log viewer.

# MatchiTOOL 1.3.6 - 1.3.3

- Added: Log Catcher recovery of interrupted sessions, device-wide capture, live stream, search, export.
- Fixed: logcat capture for the whole process, paired `.log` and `.txt` files, session file created before "active".

# MatchiTOOL 1.3.2 - 1.3.0

- Changed: Log Catcher polling lowered from 1.5 s to 3 s. Session IDs no longer collide.

# MatchiTOOL 1.2.x (1.2.0 - 1.2.33)

- Added: Advanced Network Diagnostics (1.2.0), HTTPS with a self-signed certificate (1.2.1), sign-out and per-login sessions (1.2.2).
- Added: Change IP and CPU Governor built in (1.2.19-1.2.20).
- Changed: one `rootGate()` guards every root-capable call (1.2.28). Login lockout, upload limits and audit log (1.2.27).
- Fixed: update error "The APK has no valid signature" (1.2.3-1.2.1).

# MatchiTOOL 1.1.x (1.1.0 - 1.1.54)

- Added: admin password login and LAN access (1.1.0-1.1.13). Live device status and Full diagnose (1.1.14-1.1.30).
- Added: Screen control (1.1.31-1.1.46). One permanent signing key and OTA update from an https link (1.1.47).
- Changed: router password stored with the Android Keystore (1.1.48-1.1.49). Bounded root output (1.1.52-1.1.54).

# MatchiTOOL 1.0.1 - 1.0.0 (2026-11-05)

- 1.0.1: product name and archive names standardised as MatchiTOOL.
- 1.0.0: forked the Android host. The UFI `socat` bridge was replaced by an optional direct `su -c sh` backend.

Full notes for each version, with test names and hashes: [`docs/history/CHANGELOG_DETAIL.md`](docs/history/CHANGELOG_DETAIL.md).

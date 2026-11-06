# Changelog

## 1.1.30 - Native app redesign and launcher icon (app screens only)
- New home screen: Live signal card (bars, dBm, quality, network badge, operator and registration, RSRQ / SINR / battery; refreshes every 8 s while open), Open web console button, Router page link, and the Access & security group (Root access badge, LAN access switch, Web admin password row). Footer shows the installed version.
- New **Access & security** screen (opened from the Web admin password row): Router gateway, Web admin password (Save / Remove), LAN access switch with warning, Access token (masked, Copy / Reset).
- The app now has a launcher icon (adaptive, plus themed/monochrome icon on Android 13+) and a proper notification icon, so it no longer shows the default Android icon after install.
- Dark theme for all native screens. The web console, its logo and every tool are unchanged.

## 1.1.30 - Live device status on the Control Center
- The Control Center (Device overview) card now ends with a **Live device status** panel that is always visible and refreshes by itself every 5 seconds (paused while the tab is hidden). No button press needed. The **Live Status** button still opens the same data in a larger popup.
- New design: signal-bar icon (0-5 bars, coloured by quality) with the dBm value, operator and network badge (5G NSA / 5G SA / 4G LTE), battery icon with charging state, 5G NR and 4G LTE boxes with RSRP / RSRQ / SINR quality gauges, band, PCI and channel, and battery / system / modem temperature tiles. Works on phone widths.
- Data fixes: signal bars now come from RSRP (5G first, then LTE), then the router's bar count, Android's signal level and finally CSQ (shown as RSSI); the router's `rssi` is no longer shown as LTE RSRP; blank router values are no longer read as 0; the shell and modem reads run in parallel so a refresh is faster; the router API is retried every 3 minutes instead of every minute.

## 1.1.29 - SMS works when the router web API (port 80) is unreachable
- On the F50 the app cannot connect to the router web API at `192.168.0.1:80`, so SMS always showed `Failed to connect to /192.168.0.1:80` no matter what admin password was saved (the password is never reached when the connection itself fails).
- **No login needed:** with no router password saved, the SMS tool skips the router login entirely and works through the modem's AT commands (`sendat`, as root): read (`AT+CMGL`, ME then SM storage), send and delete (`AT+CMGD`). If a router password is saved, the router API is tried first and the modem is the fallback (retried once a minute).
- **Send in PDU mode (UCS2):** any character works and long messages are split into concatenated parts (up to 10, about 670 characters). The old 70/160 character limit is gone.
- **Inbox backup:** if the modem storage is empty, messages are read (read-only) from Android's own SMS store as root.
- Router connect timeout lowered to 2.5 s so the fallback is quick.
- Wrong-password and other router errors are still shown as-is (no silent fallback for those).
- The host now reports connection failures as `Router web API unreachable at <host>:80 (...)` instead of a raw socket error.

## 1.1.28 - Diagnostics, Full diagnose, USB and Firmware as popups
- Device diagnostics, Full diagnose, USB controls and the Firmware manifest inspector are no longer on the main page. Control Center buttons open each as a popup (Close button, click outside, or Esc). Full diagnose uses a wider popup for the report.
- Element ids are unchanged, so every control and the diagnose itself work as before.

## 1.1.27 - Root terminal and plugins as popups
- The Root terminal and Built-in tools / custom plugins cards are no longer on the main page. Control Center has two buttons, **Root terminal** and **Built-in tools & plugins**, that open each one as a popup (close with the Close button, a click outside, or Esc).
- The cards keep their element ids, so the tools, plugin upload and Full diagnose work as before.

## 1.1.26 - Bypass window footer always visible on desktop
- On desktop widths the Bypass window overflowed by about 50 px (the scroll area's height ignored the footer bar), so Run check / Copy report / Close sat under the window's own scrollbar. The scroll area now takes the remaining space and the footer stays pinned. Phone layout unchanged.

## 1.1.25 - Device diagnostics report clarity
- Tool list now prints `name: path` for every tool (found paths had no name before). `sendat` and `nfqws` are looked up in their real app locations instead of PATH, so they no longer show as unavailable when installed.
- Added policy routing rules, default routes in all tables and DNS properties (the main table has no default route on this firmware, which looked like a fault).
- Storage section explains the bind-mount mount point and shows the real /data device.

## 1.1.24 - Top menu removed
- Removed the duplicate top navigation bar (Overview, Diagnostics, Full diagnose, USB, Firmware, Terminal, Plugins); the Control Center buttons cover it. The Host connected status stays on the right.

## 1.1.23 - Bypass toggle switches on desktop
- The Block QUIC / Auto-apply switches were stretched into tall blocks on desktop browsers because the page's global `button`/`input` min-height and padding applied to them (only touch screens reset it). Switches now keep their 36x20 / 32x18 size on every screen.

## 1.1.22 - Diagnose: no-load detection
- Reverted the 1.1.20 rule that treated a little observed traffic as working data. If ping and DNS both fail while the SIM is registered with an active data session, the diagnose now FAILs and names the likely cause (no load/balance or data plan).
- Bypass self-test advice no longer blames nfqws when the SIM has no load.

## 1.1.21 - Diagnose: charger watchdog false alarm
- Kernel scan no longer flags the charger IC message `set watchdog timer 0s`; it only matches real watchdog bite/timeout/reset and lockups.
- Crash scan now shows the exception text and warns when 3 or more app crashes are logged since boot.

## 1.1.20 - Diagnose: false alarms removed (from a real F50 report)
- APN check accepts the unquoted `+CGDCONT` format the modem prints.
- `AT+CSQ` = 99 is no longer a "no signal" failure while registered (normal on 5G NR).
- Kernel scan no longer matches `debug:`; the crash scan names the crashed process and only warns if it is MatchiTOOL.
- Internet/uplink checks treat real traffic (rx bytes, live connections) as proof data works when ICMP ping is blocked; interface errors are judged by error ratio, not raw count.
- Blocked-process threshold raised (kernel threads in D state are normal on this device).
## 1.1.19 - Full diagnose: real malfunction detection (32 -> 55 checks)
- Every WARN/FAIL now carries a **Fix** line, and the report adds **Probable root causes** and **Since last run** (new / fixed problems).
- New device-health checks: root speed, SELinux, clock drift, temperatures (all thermal zones + battery), battery health, memory/CPU/blocked processes, read-only or full `/data` and inodes, kernel/crash log scan, core services (system_server, netd, rild, dnsmasq, hostapd).
- New hotspot/network checks: br0 + IP forwarding + NAT, uplink MTU/IPv4/errors, IP vs DNS failure, interface error counters.
- New modem checks: SIM present/locked, radio mode (CFUN), registration (LTE/5G/CS, denied/searching), packet attach, PDP/APN, signal (RSSI/RSRP), modem latency, router modem state.
- New host/page checks: parallel-request stability, port 2334 binding, 404 handling, boot.sh syntax and last boot result, `sendat` CPU architecture and execution, plugin/tool syntax compile (nothing executed), duplicate element ids, uncaught JS errors.
- Still strictly read-only.
## 1.1.18 - Full diagnose: fixes from a real F50 report
- AT checks: `sendat` returns `OK` glued to the data (`+CSQ: 99,99OK`); the diagnose expected a separate word and wrongly reported every AT query as failed. It now matches `OK` at the end and flags real `ERROR` replies. `AT+CGMM?` (a typo) is now `AT+CGMM`.
- Internet check: the F50's main routing table has no default route, so a plain ping from the root shell fails instantly. The check now also pings through the detected uplink interface and reports that case as reachable.
- New check "Router web server ports" lists the device's listening TCP ports, to show whether anything serves the router web API on port 80.

## 1.1.17 - Full diagnose
- New **Full diagnose** card on the web page (also in the top menu and on the home card). One button runs 32 read-only checks across every function: login/session, browser features, page controls, root shell, shell failure reporting, device info, storage, system commands, host diagnostics, USB status, USB/AT/plugin input validation, `sendat`, AT on both SIM slots, router web API and SMS storage, plugin manager, the six built-in tools (loaded, button present once, and the data path each one needs), the firmware inspector and internet reachability.
- Results are PASS / WARN / FAIL / SKIP with a "Needs attention" list at the top. Each check has its own timeout, so one hung command cannot freeze the run.
- **Copy report** puts the whole report on the clipboard (with a fallback for plain-HTTP LAN pages where the browser has no clipboard API, and an auto-select if the browser blocks copying). **Download .txt** saves it as a file.
- Nothing is changed on the device: no USB/ADB switching, reboot, SMS send/delete, Bypass apply or router writes. The report never contains the token or any password.
- The page now checks its own version against the app's, and warns if a cached old page is being shown.

## 1.1.16 - Tools built into the web page
- Bypass, Device Status, AT & Radio, SMS, Signal Info and Live Status are now embedded in the web page (`web/index.html`) and load automatically after login. No uploading, no `plugins/` folder, no APK-side tool files or `/api/builtin` endpoint.
- The page lists them under **Built-in tools**; **Custom plugins** is only for scripts you upload yourself.
- If copies of these tools were uploaded earlier (or left by old versions), the page removes them from the device so nothing loads twice.
- Updating the tools means editing `index.html`; they arrive with the app because the page ships in the APK.

## 1.1.15 - Tools are web-only again
- Bypass, Device Status, AT & Radio, SMS, Signal Info and Live Status are no longer built into the APK. They live in the `plugins/` folder of the repo and are installed from the web page (Plugins card -> choose file, several can be selected at once).
- Removed the `/api/builtin` endpoint, the `assets/builtin` folder and the "Built-in tools" section. The app no longer deletes plugin files on start.
- To update a tool, upload its new `.js` (same file name replaces the old one). App updates no longer change tools.
- The `sendat` binary stays in the APK because AT & Radio needs a native executable.

## 1.1.14 - Built-in tools (no longer plugins)
- Bypass, Device Status, AT & Radio, SMS, Signal Info and Live Status are now built into MatchiTOOL. They ship inside the APK (`assets/builtin`) and are served by a new `/api/builtin` endpoint, so an app update always updates them: no more copying to the device, no stale versions, and they can no longer be disabled or deleted by accident.
- The web page lists them under **Built-in tools**; **Custom plugins** is now only for scripts you upload yourself.
- Copies of the old bundled plugins left on the device by earlier versions are removed on start so nothing loads twice.
- Bypass wording that referred to UFI-TOOLS now refers to MatchiTOOL.

## 1.1.13 - USB mode switching for the F50
- On the F50, `svc usb setFunctions` is killed (exit 137). USB modes are now switched by setting `sys.usb.config` (trying `<fn>,mtp,adb` first, then `<fn>,adb`) so init applies the configfs change; `svc` is only a time-limited fallback.
- Success is now verified in configfs (the function must be linked into the active gadget config) before the interface is bridged into `br0`.
- The output always lists the active gadget functions and USB network interfaces so a failure can be diagnosed.

## 1.1.12 - USB Ethernet bridging and quieter Live Status
- RNDIS / CDC-ECM modes now also bring the new USB network interface up and bridge it into `br0` (the hotspot LAN), then report the resulting interfaces. Previously only the gadget function was switched, so the PC saw no working network. The action now fails with a clear message if the USB config does not actually change.
- Restore default USB mode removes the interface from the bridge first.
- Live Status no longer shows the unreachable router web API as an error; it is noted in the raw panel and the status line shows which source is used.

## 1.1.11 - Admin password login
- The web page now logs in with an admin password set in the app (new "Web admin password" card) instead of the random token. The password is stored only as a salted PBKDF2 hash.
- Until a password is set, the login still accepts the access token, so nobody is locked out after updating.
- New `/api/login` endpoint shares the existing per-IP lockout (8 bad attempts = 1 minute). Setting, changing or removing the password rotates the token and signs out existing web sessions.
- The long-press token dialog is unchanged and still works as a recovery path.

## 1.1.10 - Live Status works without the router web API
- On the F50 the router web API on port 80 was unreachable from the app, so every Live Status field showed a dash. Live Status now falls back to the modem's AT commands (operator, registration, signal) and Android telephony (`dumpsys telephony.registry`) for RSRP/RSRQ/SINR.
- The router web API is retried only once a minute after a failure, so it can't stall each refresh.
- Modem temperature now comes from the nr/modem thermal zone.
- Added a collapsible raw-output panel to help diagnose fields that stay blank on a given firmware.

## 1.1.9 - USB error visibility
- USB control failures returned HTTP 400, which made the web UI show only "Request failed (400)" and hide the real reason. They now return 200 with `success:false`, so the command output is displayed.
- On failure the output now includes the exit code, whether `svc` exists, and the device's USB properties.

## 1.1.8 - LAN access switch
- Added a LAN access card to the app screen (with a warning dialog). Turning it on makes the web UI reachable from devices on the F50 hotspot at `http://<F50 IP>:2334`; it restarts the web server automatically.
- When LAN is on and no Wi-Fi client IP exists (the F50 is the hotspot), the app now shows the router address instead of "Wi-Fi unavailable".
- LAN access stays off by default.

## 1.1.7 - Web Live Status plugin and fixes
- Added the read-only `Live_Status.js` dashboard plugin (modem signal/band, battery, thermal).
- Fixed overlapping refreshes: polling now skips a tick while the previous request is still running, so slow modem/shell reads no longer pile up on the host.
- Fixed polling continuing after the dialog closed; the timer now stops itself.
- Fixed modem/shell errors being overwritten by the "Last updated" line; errors now stay visible.
- Bumped versionCode to 117 / versionName to 1.1.7 (also `/api/ping` and `scripts/validate.sh`). Bundled plugins only refresh on installed devices when versionCode changes, so this bump is required for plugin fixes to reach the app.
- CI now runs `bash scripts/validate.sh`, so it no longer depends on the file's executable bit.
- Fixed Kotlin compile errors in `WebServer.kt`: shell variables `$x` and `$BASE` inside Kotlin strings were being read as Kotlin templates; they are now escaped.

## 1.1.6 - Version metadata alignment
- Corrected Android versionName to 1.1.6 and incremented versionCode to 116.
- Corrected the `/api/ping` version response to report 1.1.6.
- No device-control behavior or API routes changed in this metadata-only fix.

## 1.0.1 - 2026-11-05

- Standardized the product identity and release artifact naming as **MatchiTOOL** throughout the project.
- Kept the Android application label, web interface title, Gradle root project, package namespace, and internal data paths under the MatchiTOOL identity.
- No root, modem, plugin, or firmware behavior changed in this branding-only update.

## 1.0.0 - 2026-11-05

- Forked the Android management host into the MatchiTOOL project.
- Replaced the UFI `socat` Unix-socket bridge with an optional direct `su -c sh` backend for devices that are already rooted.
- Removed UFI-specific setup and boot-script dependencies from the Android host.
- Added MatchiTOOL-managed boot tasks executed through an already-authorized root manager.
- Moved Bypass TTL, Anti-DPI, lock, and boot-state files under `/data/local/matchitool/`.
- Retained the plugin bridge contract and modem/SMS/signal features where possible.
- Added private-source-IP checks and token throttling for privileged web API requests.
- Preserved third-party license notices and added the Bypass MIT license text.
- Added source validation and a CI debug-APK build workflow.
- Documented the separate, firmware-specific stock F50 rooting route; the app does not itself root or flash the hotspot.


## 1.1.0 - Advanced technician release

- Added a read-only device diagnostics report for Android build, root identity, kernel, network routes, storage, and available servicing/network tools.
- Added XML/scatter firmware manifest inspection with partition-name extraction, file size, and SHA-256 fingerprint. Inspection never flashes or writes partitions.
- Added diagnostics and firmware inspector panels to the browser UI while retaining existing plugin APIs and bundled plugins.
- Incremented Android versionCode to 110 and versionName to 1.1.0.
- Kept the existing UFI-derived plugin and shell bridge compatibility surface.

### Limitations

- Firmware inspection is metadata-only; it is not a flashing engine or a guarantee of device/build compatibility.
- Device diagnostics depend on commands available on the Android/root environment.
- Android Gradle/APK build and physical-device testing must still be performed in an Android SDK environment.


## 1.1.1 - Security and servicing foundation

- Changed the web server default bind address to loopback (`127.0.0.1`); LAN access is now opt-in from the Android host screen and requires an explicit warning confirmation.
- Updated the foreground notification and host screen to show whether the server is local-only or LAN-enabled.
- Preserved the token-authenticated API and added a request-size/NUL-byte guard to the root shell endpoint.
- Expanded firmware manifest preflight with XML well-formedness checking, model/project hints, critical-partition warnings, and explicit unverified-compatibility status.
- Preserved existing plugin endpoints, settings keys, bundled plugins, and root bridge names.
- Incremented Android versionCode to 111 and versionName to 1.1.1.

### Security notes

- LAN mode still uses HTTP. Enable it only on a trusted private network, keep the token secret, and never port-forward the service.
- The root shell and plugin bridge remain privileged compatibility interfaces. Only install trusted plugins and treat LAN access as granting powerful control over the rooted Android host.
- Local-only binding is the default; existing saved preferences and plugin settings are not reset by this release.


## 1.1.2 - Discovery feature removal

- Removed ADB and Fastboot discovery UI, JavaScript handlers, backend routes, and discovery implementation.
- Removed ADB/Fastboot from the diagnostics tool-availability list and updated source validation to assert that discovery remains absent.
- Kept firmware manifest inspection, general device diagnostics, existing settings, root bridge, and bundled plugins.
- No chipset-level Qualcomm, MediaTek, or Unisoc detection is included or advertised.
- Incremented Android versionCode to 112 and versionName to 1.1.2.


## 1.1.3

- Added root-backed USB debugging enable/disable controls.
- Added USB tethering enable/disable controls using Android USB RNDIS functions, preserving ADB when enabled.
- Added USB state reporting for ADB, USB function configuration, and RNDIS interfaces.
- Documented Android ROM/kernel limitations and cable reconnection guidance.


## 1.1.4 - ZTE F50 USB Ethernet modes

- Added separate USB Ethernet mode actions for RNDIS and CDC-ECM.
- Added live reporting of active USB functions, saved USB configuration, detected gadget-function support, and network interfaces.
- Preserved ADB in the selected USB function when USB debugging is enabled.
- Added restore-default behavior based on the firmware's saved USB configuration, removing RNDIS/ECM function tokens before restoring.
- Kept USB controls separate from ADB/Fastboot device discovery; no discovery endpoints were reintroduced.
- Incremented Android versionCode to 114 and versionName to 1.1.4.

### Device validation note

- Source-level validation does not prove the exact CDC-ECM function token or `svc usb setFunctions` behavior on every F50 firmware build. Confirm the reported live config and test each mode on the target F50 before relying on it.


## 1.1.5 - Centered IP status screen
- Replaced the phone-only warning screen with the centered MatchiTOOL status UI.
- Added a clickable ZTE F50 router address (default 192.168.0.1).
- Added a clickable local MatchiTOOL web address (127.0.0.1:2334).
- Added long-press token access and live root authorization status.
- Updated Android versionCode to 115 and versionName to 1.1.5.

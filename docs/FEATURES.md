# Features

For 1.4.6.

## Root model

MatchiTOOL is a root client. It does not root the device, install a boot image, or need `socat` or another app. It runs the device's existing `su` (`su -c sh`). A root manager (Magisk, KernelSU, APatch) must grant root and can revoke it at any time.

- Commands go to the shell over stdin, never into a `su -c` string.
- Output is bounded; every command has a timeout.
- Root status shows UID, `su` path and a manager guess. UID 0 is the real check.

Rooting the stock F50: [`F50_STOCK_ROOT.md`](F50_STOCK_ROOT.md). Security: [`SECURITY.md`](../SECURITY.md).

## Console and access

- Port **2334**. Self-signed HTTPS first. Plain HTTP only if TLS fails (the app shows "(NOT encrypted)").
- Sign in with the router admin password, or set a console password (10+ characters) with **Password**.
- Sessions end after 2 h idle or 12 h. Root commands need a sign-in under 4 h. **Sign out** ends yours. Changing the admin password ends all.
- Other devices on the hotspot or USB tether can connect. The API rejects other sources.
- **Never forward port 2334 to the internet.**

## Built-in tools

AT Radio, Network Diagnostics, Live Status, Memory Cleaner, Change IP, SMS, Screen Control. They live in `web/index.html`. Do not run tools that manage the same modem or firewall rules at once. Own plugins: [`PLUGINS.md`](PLUGINS.md).

- **Root terminal** and the `runShellWithRoot` plugin bridge.
- **AT commands** via bundled `sendat` (must match the CPU architecture).
- **Router API proxy** for SMS and live signal.
- **Screen control:** screenshot stream (not video) using root `screencap` and `input`, viewable from a second phone.
- **Boot receiver:** restarts the web host after boot and runs the root startup script if present.

## Diagnostics (read-only)

- **Full diagnose:** copy or download.
- **Device diagnostics:** Android build, root identity, kernel, interfaces, routes, storage, optional tools.
- **Advanced Network Diagnostics:** IPv4/IPv6 addresses and routes, gateway and public-IP ping, DNS lookup. Filtered ICMP is a limit, not an outage.
- **Firmware manifest preflight:** reads XML or scatter files, lists partitions, warns on critical ones, shows SHA-256. Never flashes.

## USB and Wi-Fi

- **USB controls:** debugging on/off, USB Ethernet modes (RNDIS, CDC-ECM), live gadget state, restore of the firmware's saved USB config. Support depends on ROM and kernel.
- **Indicator light** (Network > Light): On / Off, like the stock page.
- **Wi-Fi off while USB tethering** (Network > Wi-Fi, off by default): router Wi-Fi goes off during tethering and returns after. Needs the router password saved in the app.

## Live device status

Shows CPU, memory, load, uptime, temperatures. Read-only except the CPU Governor. It never disables thermal services or touches GPU or charging controls. Temperature bands are advice, not proof of throttling.

**Refresh:** Live (1 s), Balanced (speed 1 s, rest 15 s) or Eco. The panel pauses when closed, when another tool window is open, and when the tab is hidden. Router read every 3 s, root shell every 15 s. At 60 C: 6 s and 30 s. At 70 C: 15 s and 90 s, header shows `cooling`. Temperatures come from kernel thermal zones, not the battery sensor.

**Push stream:** in Live and Balanced on a cool phone, one root reader pushes readings every second while a visible tab watches. Eco, warm or hot phone, paused battery and plain HTTP use polling. Polling also takes over if the stream drops.

**CPU Governor** (tap the CPU tile): writes to `/sys/devices/system/cpu` only when you change something: cores on/off, mode per cluster, locked speed in Manual mode. A change lasts until restart unless you press **Save for boot** (writes `/data/local/matchitool/boot.d/10-cpu.sh`). **Remove from boot** deletes it. If a saved setting breaks the device, delete that file with adb or a root shell.

**Change IP** (home button): turns mobile data off and on for a new carrier address; shows local and public IP. Hotspot clients lose internet for a few seconds.

## Log Catcher

Web console only.

1. Open Log Catcher, press **Start logging**.
2. Press **Stop logging** to close the session.

A session runs without restarting the host and survives closing the popup. It records MatchiTOOL events and, where Android allows, tails the app process with `logcat --pid`.

- Each session: paired `.log` and `.txt` with timestamps, levels and start/stop markers.
- Files: `files/logs/sessions/`; snapshots: `files/logs/exports/`.
- A low-priority thread writes files, so the UI never blocks.
- Limits: 3,000 entries in memory, write queue 4,096, about 8 MiB per session, 30 sessions kept.

Logs can hold device and network data. Keep exports private.

## Boot capture

Log Catcher > **Boot capture** installs `matchi_logd.sh` in `/data/adb/service.d/`. At boot it starts `logcat -b all` and `dmesg -w`, writing rotating files to `/data/local/matchitool/bootlogs/`.

- Survives app kills, crashes, updates. Includes early-boot lines.
- Disk use capped (about 41 MB). Pauses when `/data` is low.
- Remove from the same panel, optionally deleting the files.
- Needs root and Magisk, KernelSU or APatch.

## Updates

**Update app** takes an APK file or an https link (checked, then downloaded).

- Must be this app, same signing key.
- Newer version: updates. Same version, different SHA-256: updates. Identical file: reinstalls. Older version: rolls back, data kept.
- You confirm the SHA-256 before install. Install runs via root (`pm install -r`, plus `-d` for rollback).

**Update link:** default `https://github.com/SaikoC9/MatchiTOOL-releases/releases/latest/download/MatchiTOOL.apk`. If you fork, change `D` in the page script near `matchi_ota_url`, or paste your link once (the browser remembers it).

- A release page link (`.../releases/tag/build-115`) becomes the download link.
- If the APK has another name, the only `.apk` in the release is used.
- Tags like `build-115` are not compared as versions.
- After download, SHA-256 and the APK's own version are checked.

Private source: publish only the signed APK to a public repo. See [`OTA_RELEASES.md`](OTA_RELEASES.md).

## Wipe on uninstall

A root watcher removes MatchiTOOL's root-side files, firewall rules, speed limits and programs after uninstall. Home button **Wipe on uninstall**, ON by default. See [`UNINSTALL_WIPE.md`](UNINSTALL_WIPE.md).

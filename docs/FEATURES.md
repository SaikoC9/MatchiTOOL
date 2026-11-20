# Features

What MatchiTOOL does, in more detail than the README. Current for 1.4.5.

## Root model

MatchiTOOL is a root client. It does not root the device and installs no boot
image. It needs no other app, no `socat` and no external boot script.

For a privileged action it runs the device's existing `su` (`su -c sh`). A root
manager (Magisk, KernelSU or APatch) must already be installed and must grant
MatchiTOOL root. The root manager decides who gets root and can take it away at
any time.

- Commands go to the shell over stdin, never into a `su -c` string.
- Output is bounded and every command has a timeout.
- Root status shows the effective UID, the `su` path and a Magisk / KernelSU /
  APatch guess. UID 0 is the real check.

To root the stock F50 itself, see [`F50_STOCK_ROOT.md`](F50_STOCK_ROOT.md). That
route is specific to firmware B09. MatchiTOOL does not flash partitions or
bundle firmware images. Do not assume the method works on another build.
More in [`SECURITY.md`](../SECURITY.md).

## Console and access

- Port **2334**. Self-signed HTTPS first; plain HTTP only if TLS cannot start,
  and then the app shows "(NOT encrypted)".
- Sign in with the router's admin password, or set a separate console
  password (10+ characters) with the **Password** button.
- Sessions end after 2 h idle or 12 h. Root commands need a sign-in younger
  than 4 h. **Sign out** ends yours. Changing the admin password ends all.
- Other devices on the hotspot or USB tether can connect. The API rejects any
  source that is not this device or the hotspot subnet.
- Never forward port 2334 to the internet.

## Tools

The seven built-in tools are AT Radio, Network Diagnostics, Live Status, Memory
Cleaner, Change IP, SMS and Screen Control. They are embedded in
`web/index.html`. Do not run several tools that manage the same modem or
firewall rules at the same time. Your own plugins are in
[`PLUGINS.md`](PLUGINS.md).

- **Root terminal** and the `runShellWithRoot` plugin bridge.
- **AT commands** through the bundled `sendat`, which must match the device's
  CPU architecture.
- **Router API proxy** for SMS and live signal data.
- **Screen control:** view and control the device screen from a second phone.
  It is a stream of screenshots, not video, using root `screencap` and `input`.
- **Boot receiver:** restarts the web host after boot and runs the root startup
  script, if there is one.

## Diagnostics

All read-only.

- **Full diagnose:** copy or download the result.
- **Device diagnostics:** Android build, root identity, kernel, interfaces,
  routes, storage, optional tools present.
- **Advanced Network Diagnostics (1.2.0):** IPv4 and IPv6 addresses and routes,
  gateway and public-IP ping, DNS lookup. Filtered ICMP is reported as a
  limit, not as an outage.
- **Firmware manifest preflight:** reads XML or scatter files, checks the XML,
  lists partitions, warns about critical ones and shows a SHA-256. It never
  flashes anything.

## USB and Wi-Fi

- **USB controls:** USB debugging on and off, USB Ethernet modes (RNDIS and
  CDC-ECM), live gadget state, and restore of the firmware's saved USB
  configuration. What works depends on the ROM and kernel.
- **Wi-Fi off while USB tethering** (Network > Wi-Fi, off by default): the
  router's Wi-Fi goes off while tethering works and returns when it stops.
  It needs the router password saved in the app. Test steps are in
  [`TESTING.md`](TESTING.md).

## Live device status

Shows CPU, memory, load, uptime and temperatures. It only reads, except the CPU
Governor. Sensors vary by device, and the temperature bands are advice, not
proof of throttling. It never disables thermal services or touches GPU and
charging controls.

**Refresh.** Live (1 s), Balanced (3 s) or Eco. The panel pauses when closed,
when another tool window is open and when the tab is hidden. The router is read
every 3 s and the root shell every 15 s. When warm (60 C) these slow to 6 s and
30 s. When hot (70 C) they slow to 15 s and 90 s, and the header shows
`cooling`. Temperatures come from kernel thermal zones, not the battery sensor.

**Push stream.** In Live and Balanced, while the phone is cool, one root reader
pushes CPU, per-core speed, temperatures, memory, load and uptime every second.
It runs only while a visible tab watches. Eco, a warm or hot phone, a paused
battery and plain HTTP use polling. Polling also takes over if the stream drops.

**CPU Governor.** Tap the CPU tile. It writes to `/sys/devices/system/cpu` only
when you change something: cores on or off, the mode per cluster and, in Manual
mode, a locked speed. A change lasts until restart unless you press **Save for
boot**, which writes `/data/local/matchitool/boot.d/10-cpu.sh`. **Remove from
boot** deletes it. If a saved setting makes the device unusable, delete that
file with adb or a root shell.

**Change IP** (home button) turns mobile data off and on to get a new carrier
address and shows the local and public IP. Hotspot clients lose internet for a
few seconds.

## Log Catcher

Web console only. The Android app has no Log Catcher screen.

1. Open Log Catcher in the console and press **Start logging**.
2. Press **Stop logging** to close the session.

A session starts without restarting the host and keeps running when you close
the popup. It records MatchiTOOL's diagnostic events. Where Android allows it,
it also tails the app's own process with `logcat --pid`. If access is denied,
the diagnostic events are still recorded.

- Each session is a paired `.log` and `.txt` file with timestamps, levels and
  start and stop markers. The `.log` file is the session history.
- Files are under `files/logs/sessions/`. Text snapshots are under
  `files/logs/exports/`.
- A low-priority writer thread does the file work, so the UI, shell and network
  threads never block.
- Limits: 3,000 entries in memory, a write queue of 4,096, about 8 MiB per
  session file, 30 session files kept.

Logs can contain device and network data. Keep exported files private.

## Boot capture (Magisk)

Log Catcher > **Boot capture** installs `matchi_logd.sh` into
`/data/adb/service.d/`. At boot it starts Android's `logcat -b all` and
`dmesg -w` and writes rotating files under
`/data/local/matchitool/bootlogs/`.

- Survives app kills, crashes and updates, and includes early-boot lines.
- Disk use is capped (about 41 MB by default). Capture pauses when `/data` is
  below the configured free space.
- Remove it from the same panel, with an option to delete the files.
- Needs root and Magisk, KernelSU or APatch.
- Not yet verified on a real F50. See [`TESTING.md`](TESTING.md).

## Updates

**Update app** in the console takes an APK file, or an https link that is
checked first and then downloaded.

- The APK must be this app, signed with the same key.
- A newer version updates. The same version with a different SHA-256 updates
  too. An identical file reinstalls. An older version rolls back, keeping data.
- You confirm the SHA-256 before install. Install runs through root
  (`pm install -r`, plus `-d` for a rollback).

**Update link.** The field starts with
`https://github.com/SaikoC9/MatchiTOOL-releases/releases/latest/download/MatchiTOOL.apk`.
If you fork the project, change `D` in the page script near `matchi_ota_url`,
or paste your own link once; the browser remembers it.

- A release page link (`.../releases/tag/build-115`) becomes the download link.
- If the APK has another name, the only `.apk` in the release is used.
- Tags like `build-115` are not compared as versions.
- After download, the SHA-256 and the APK's own version are checked.

To keep the source private, publish only the signed APK to a separate public
repo. See [`OTA_RELEASES.md`](OTA_RELEASES.md).

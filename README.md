# MatchiTOOL

An independent Android host application for ZTE modem/router tools. The project contains a local web UI,
JavaScript plugin loader, an optional root-command bridge, AT command integration, SMS and signal plugins, and a ZTE
router web-API client. The intended target is stock ZTE F50 firmware, but the app itself does not install root onto the F50.

## Independence and root model

MatchiTOOL is self-contained: it needs no other app, `socat`, shared socket or external boot script.
It invokes the Android device's existing `su` command (`su -c sh`) when a privileged operation is requested. A compatible
root manager (for example Magisk, KernelSU, or APatch) must already be installed and must grant MatchiTOOL root
permission. This is a root **client/backend**, not a rooting exploit or boot-image installer.

For rooting the **stock ZTE F50 itself**, see [`docs/F50_STOCK_ROOT.md`](docs/F50_STOCK_ROOT.md). The currently documented public route is firmware-specific (B09) and uses a patched boot image and TrustOS image via a separate host-side flashing toolkit. MatchiTOOL does not flash these partitions or bundle proprietary stock/modified firmware images. Do not assume the B09 method works on another build.

Root commands are sent to the shell over stdin, rather than interpolated into a `su -c` command string. Command
output is bounded and execution has a timeout. Root status reports the effective UID, resolved `su` path, and a
best-effort Magisk / KernelSU / APatch hint; UID 0 is the authoritative grant check. Root authorization and
revocation remain controlled by the root manager. Security details: [`SECURITY.md`](SECURITY.md).

## Features

- **Log Catcher (1.3.0):** live process diagnostics with timestamps and severity levels, function/keyword/session filters, bounded recent history, batched UI refresh, asynchronous session files, size-based rotation, and automatic session retention. Logging can be started/stopped without restarting the app.
- **Advanced Network Diagnostics (1.2.0)**: on-demand IPv4/IPv6 address and route inspection, gateway/public-IP ping checks, and DNS lookup. Read-only; ICMP filtering is reported as a limitation rather than proof of an outage.
- **Read-only device diagnostics**: Android build, root identity, kernel, network interfaces/routes, storage, and optional tool availability.
- **USB controls**: root-backed USB debugging enable/disable plus selectable USB Ethernet modes (RNDIS and CDC-ECM), live gadget-state/support checks, and restoration of the firmware-saved USB configuration. Availability and behavior depend on Android ROM/kernel support.
- **Firmware manifest preflight**: XML/scatter format detection, XML well-formedness, partition-name extraction, model/project hints, critical-partition warnings, and SHA-256 fingerprint. This is inspection only and never flashes partitions.

- Browser interface on port **2334** with admin-password login and per-login expiring sessions (2 h idle / 12 h maximum, Sign out button). The service binds to LAN interfaces so other devices on the ZTE hotspot / USB-tether network can connect; API access is restricted to the device itself and detected hotspot-side subnets. The host serves a self-signed HTTPS endpoint first and only falls back to plain HTTP if TLS cannot start; the app shows "(NOT encrypted)" in that case.
- Full diagnose with copy/download (read-only checks). Seven built-in tools embedded in the web page, plus custom plugin upload (multi-file), enable/disable and delete.
- Root terminal and the `runShellWithRoot` plugin bridge.
- **Update app** (web console): upload a MatchiTOOL APK (or check an https link first, then download). It is only accepted if it is this app and signed with the same key; newer versions update, the same version number with a different SHA-256 (a different build) updates too, an identical file reinstalls, older versions roll back (data kept). You confirm the SHA-256 before it is installed through root (`pm install -r`, `-d` for rollback).
- **Screen control**: view and control the device's own screen from the web page (root `screencap` frames + root `input` events), e.g. from a second phone. A screenshot stream, not video. Requires the companion device to be on the trusted ZTE hotspot / USB-tether network.
- AT command execution through the bundled `sendat` executable (device/architecture compatibility required).
- **OTA update with a private repo:** keep the source private and publish only the signed APK to a separate public repo (see `docs/OTA_RELEASES.md`). In the web console, Update app, paste `https://github.com/OWNER/REPO/releases/latest/download/MatchiTOOL.apk`.
- ZTE router API proxy for SMS and live signal information.
- Boot receiver restarts the web host and runs the app-managed root startup script (when present); root access is separately authorized by `su`.

The seven built-in tools (AT Radio, Network Diagnostics, Live Status, Memory Cleaner, Change IP, SMS, and Screen Control) are embedded in `web/index.html` and load automatically.
Do not run multiple tools that manage the same modem/firewall rules at the same time. Review plugin code before enabling it:
plugins execute with the privileges of the host bridge and should be treated as trusted code.

## Install and use

1. Install the APK on an Android device that already has a supported root manager.
2. Open MatchiTOOL and press **Request / check root access**. Approve the root prompt in the root manager.
3. Connect using the LAN URL shown in the app (the host listens on the LAN by default). LAN access is always on and cannot be switched off.
4. Open the web page and log in; the built-in tools load by themselves. Use the Plugins card only for your own scripts.
5. Configure the ZTE router gateway and admin password in the SMS plugin settings if the router API requires login.

The Bypass tool (firewall/TTL rules) is no longer part of MatchiTOOL, and since 1.4.2 the host no longer touches `boot.sh` for it. A device that still has Bypass lines in `/data/local/matchitool/boot.sh` from before 1.4.1 keeps them: open the file as root and delete them by hand, and check for other leftover firewall/TTL lines.

The web API rejects every source that is not this device or inside the ZTE hotspot subnet, as a defense-in-depth measure. The host always listens on the LAN (there is no local-only mode). It serves HTTPS with a self-signed certificate (plain HTTP only as a fallback) and exposes privileged root/plugin APIs to the trusted LAN; never forward port 2334 to the public internet, and keep your admin password private and press Sign out on shared computers. Sessions end by themselves after 2 h idle or 12 h. Root commands additionally need a sign-in younger than 4 h. If the console may have been exposed to an untrusted network, change the admin password (this ends every session).

**Update link.** The online-update field starts with `https://github.com/SaikoC9/MatchiTOOL-releases/releases/latest/download/MatchiTOOL.apk` (forks: change `D` in the page script near `matchi_ota_url`, or paste your own link once; it is remembered in the browser). A pasted release page link (`.../releases/tag/build-115`) is turned into the download link, and when the release's APK has another name the only `.apk` in the release is used. Tags like `build-115` are not compared as versions; the SHA-256 and the APK's own version are checked after download.

**Console password.** By default the console signs in with the router's admin password. Use the *Password* button to set a separate console password (10+ characters). Sessions, lockout, HTTPS / HTTP and the rest of the security model are in [`SECURITY.md`](SECURITY.md).

## Build

Current source version: **1.4.2** (versionCode **402**). The version is written in one place, `version.properties`: Gradle reads it, `node scripts/build-web.js` writes it into the page (`PAGE_VERSION`), and `scripts/validate.sh` fails if the README or the top CHANGELOG entry names another version. To bump: edit `version.properties`, run `node scripts/build-web.js`, update the README line and add the CHANGELOG entry.

Requirements: Android 8.0+ device (minSdk 26); Android Studio with Android SDK 34 and JDK 17, or Gradle 8.7 with the Android Gradle Plugin 8.5.2.

```sh
./scripts/validate.sh
gradle :app:testDebugUnitTest
gradle :app:assembleDebug     # app/build/outputs/apk/debug/app-debug.apk
gradle :app:assembleRelease   # app/build/outputs/apk/release/app-release.apk (what gets published)
```

Where the checks live: `scripts/validate.sh` runs the page build check, `check_repo.py` (version, README tool count, bundled binary hashes), `test_route_gates.py` (which routes need the root gate, read from the code), the Node and shell tests, and `check_sources.py` (older grep-style tripwires; do not add to it, replace a guard with a real test when you touch that area). Kotlin logic is tested in `app/src/test` (`gradle :app:testDebugUnitTest`); the root gate order is in `RootGateTest`.

Code layout of the web host: `WebServer.kt` holds the server core (request checks, login, sessions, headers, the page, the route dispatcher). The routes are in `WebRoutes*.kt` (Auth, Device, Logs, Plugins, Root, Router, Update), one extension function per group that returns null for a path that is not its own; `PluginPaths.kt` holds the plugin data-path rules. A new route goes into the matching `WebRoutes*.kt` **and** the table in `scripts/test_route_gates.py`.

Release builds shrink unused code and resources with R8 but do not rename or optimise (`app/proguard-rules.pro`); if a release build ever misbehaves, set `isMinifyEnabled` and `isShrinkResources` to false in `app/build.gradle.kts`.

First time on a new machine: `bash scripts/bootstrap-build.sh` creates the Gradle wrapper and does the first full build.

The GitHub Actions workflow validates JavaScript/XML and builds the debug APK on push, pull request, or manual dispatch. The CI workflow pins Gradle 8.7 and the Android Gradle Plugin 8.5.2. The repository does not yet include the Gradle wrapper; use an installed Gradle 8.7 distribution or Android Studio for local builds.

## Log Catcher

Log Catcher is available **only in the web console** (there is no Log Catcher screen in the Android app). Open the console in a browser, open Log Catcher and press **Start logging** to begin a session without restarting the host. The collector records MatchiTOOL diagnostic events and, where Android permits access to the app's own process log buffer, tails this process with `logcat --pid`. Press **Stop logging** to close the session. Each session is stored privately under `files/logs/sessions/`; text snapshots are saved under `files/logs/exports/`.

The collector uses a low-priority single-thread writer so filesystem work does not block the UI, shell, or network request threads. Recent memory history is capped at 3,000 entries, queued writes at 4,096, each session file at approximately 8 MiB before rollover, and retained session files at 30. If the device denies process-log access, explicit MatchiTOOL diagnostic events continue to be recorded. Logs may contain device or network diagnostic data; keep exported files private.

The web Log Catcher runs as a server-side session and is not stopped when its dashboard popup is closed. It also captures Android logcat output for the whole MatchiTOOL process while a session is active, in addition to explicit diagnostic events, and writes each session as a paired `.log` and `.txt` file with the same timestamped, leveled records and start/stop markers. The `.log` file is the canonical session-history entry.

## Live device status

The Live device status panel (which also shows CPU, memory, load and uptime) only reads: it reports sensors exposed by the running kernel/firmware; modem temperature availability and sensor units can vary. Its temperature bands are advisory and are not proof of CPU/modem throttling. The refresh slow-down for a warm (60 C) or hot (70 C) phone follows the kernel thermal zones, not the battery sensor, and a hot phone shows `cooling` in the header; the refresh chips are Live (1 s), Balanced (3 s) and Eco. The monitor pauses when its panel is closed, another tool window is open, or the browser tab is hidden. It reads the router every 3 s and the root shell (CPU, memory, temperatures) every 15 s, and slows both down when the device is warm (6 s / 30 s) or hot (15 s / 90 s). In Normal and Fast, while the phone is cool, CPU, per-core speed, temperatures, memory, load and uptime are pushed by the host once a second from one root reader that runs only while a visible browser tab is watching (Eco, a warm or hot phone, a paused battery and plain HTTP use the polling above; polling also takes over by itself if the stream drops). The battery tile and its options are unchanged. It never disables thermal services or changes GPU/charging controls.

The one exception is the **CPU Governor** window, opened by tapping the CPU tile. It writes to `/sys/devices/system/cpu` only when you change something: core on/off, the mode (governor) per cluster and, in Manual mode, a locked speed. Changes last until restart unless you press **Save for boot**, which writes `/data/local/matchitool/boot.d/10-cpu.sh` (run by the host after `boot.sh`); **Remove from boot** deletes it. If a saved setting ever makes the device unusable, delete that file with adb or a root shell.

**Change IP** (home button) turns mobile data off and on to get a new carrier address and shows the local and public IP. Hotspot clients lose internet for a few seconds.

## Boot capture (Magisk)

Log Catcher > "Boot capture" installs `matchi_logd.sh` into `/data/adb/service.d/`. At boot it starts Android's own `logcat -b all` and `dmesg -w` into rotating files under `/data/local/matchitool/bootlogs/`, so capture survives app kills, crashes and updates and includes early-boot lines. Total disk use is capped (default at most about 41 MB) and capture pauses when /data has less than the configured free space. Remove it from the same panel (optionally deleting the files). Needs root and Magisk (or KernelSU/APatch); not yet verified on a real F50, see `docs/TESTING.md`.

## Compatibility notes

**Plugin API:** plugins use `window.matchi` (see `web-src/plugin-host-api.js`); the boot file is `/data/local/matchitool/boot.sh`. Plugins written for other tools that rely on their own helper names, upload routes or file paths do not run unchanged.

**Plugin data is erased when you delete the plugin (1.2.26).** MatchiTOOL cannot see what arbitrary plugin code wrote, so a plugin tells it. The delete dialog lists what will be erased and asks first.
- Every plugin has its own folder, `/data/local/matchitool/plugin_data/<plugin name without .js>/`. Keep the plugin's files there and they are removed automatically.
- Other folders: add header lines to the plugin source, one per path: `// @matchi-data /data/local/myplugin`. Allowed: folders inside `/data/local/` (not `tmp`, `matchitool` or MatchiTOOL's own `matchi_ttl`, `matchi_dpi`, `matchi_boot` and `matchi_lock` folders), inside `/data/local/tmp/` (not MatchiTOOL's own `matchi*`, `mt_*`, `sqlite` names) and inside `/sdcard/` (not `Android`, and not a standard folder such as `Download` itself, but a folder inside it is fine). Letters, digits, `.`, `_`, `-` and `/` only, no `..`, at most 20 lines. Anything else is refused and listed in the dialog.
- Browser settings: `// @matchi-localstorage myplugin_` removes the saved keys that start with that prefix. The prefix has to start with the plugin's own name (letters and digits, any case) and can never match MatchiTOOL's own keys.
- Automatic (1.4.1, no header needed): folders named after the plugin (`/data/local/<name>`, `/data/local/tmp/<name>`; nothing under `/sdcard/` is guessed, declare it with `@matchi-data`; only if they exist and pass the same checks) and saved browser settings (local and session storage) whose key starts with the plugin's name (4+ letters/digits). Everything is listed in the Delete dialog before you confirm.
- Traced writes (1.4.1): while a plugin runs, the page tags every root command and upload it sends with the plugin's file name. The host reads the command text and remembers the paths it writes to (`>`/`>>`, `tee`, `mkdir`, `touch`, `cp`/`mv`/`install`/`ln` destination, `dd of=`, `curl -o`, `wget -O`, `unzip -d`, `tar -C`, `sqlite3`, also inside `sh -c`/`su -c`, with simple `NAME=/path` variables filled in). Delete erases those paths (same strict path rules, listed in the dialog first), removes the uploaded files the plugin sent, and removes parent folders that are left empty. Only commands run **after** this version are traced. Not traced: a path that only appears inside a script file the plugin wrote and then ran, a program that writes by itself, and a call the page cannot attribute (no plugin frame in the browser's stack).
- Not erased with the data: whatever the plugin left running or changed in the system. **Delete and stop** and **Turn off and stop** (next paragraph) deal with the part MatchiTOOL can know about; the rest stays and is listed below.

**Delete and stop, Turn off and stop (1.4.1).** When a plugin may have started something or left something behind, the Delete dialog lists it word for word first and offers **Delete and stop** (it needs the root gate and your sign-in password; **Delete without stopping** keeps the old behaviour). Everything runs as root, in this order:

- the plugin's own stop commands, from the header lines `// @matchi-uninstall`, `// @matchi-check` and `// @matchi-boot`;
- ending the processes MatchiTOOL found for the plugin (commands it saw the plugin send, `.pid` files those commands wrote, command lines that name the plugin's own files; at most 50; never PID 1, MatchiTOOL itself or anything another installed plugin also uses);
- undoing what the host saw the plugin's own commands create: its **firewall chains** (iptables/ip6tables, the plugin's own chain and the jump rules into it only) and its **`boot.d/NN-name.sh` scripts** (root-owned regular files only);
- a separate re-check. Only if everything is gone is the plugin deleted; otherwise it is **kept** and the dialog says what is left.

**Turn off and stop** is the same stop for the on/off switch, without deleting the plugin file: its saved data stays unless the plugin's own stop commands (listed in the dialog) remove it. The dialog offers **Turn off and stop** or **Turn off only**. It asks **no password**, like a plain switch (an owner decision, see `SECURITY.md`); the root gate still applies and the stop is refused if the plugin file differs from the approved one. Turning a plugin on is unchanged.

What is **not** undone: anything MatchiTOOL did not see in command text (made inside a script file the plugin wrote, through a shell variable, or by a program the plugin runs), a line in `/data/local/matchitool/boot.sh` (never edited by MatchiTOOL; remove it by hand), routes, system properties, mounts, eBPF pins (`/sys/fs/bpf/...`), scheduled jobs, package changes, services started through Android, and anything outside the allowed folders. A plugin that needs these should declare `@matchi-uninstall` commands. A reboot clears most of them. This protects against a **forgetful** plugin, not a **hostile** one: a plugin can lie about its name.

Checked so far: the header stop and the process sweep were run on the F50 (Phases 1 and 2, see `MatchiTOOL_Phase1_todo.txt` and `MatchiTOOL_Phase2_todo.txt`); the firewall and boot-script undo and Turn off and stop are compiled and unit-tested in CI and were also run on the F50 by the owner (Phase 3 tests A-E; the owner's report, per-test results are not written in the repo; the no-root / timeout test F was waived and not run). Details, limits and examples: [`docs/PLUGIN_STOP.md`](docs/PLUGIN_STOP.md). Every plugin header line in one table: [`docs/PLUGIN_HEADERS.md`](docs/PLUGIN_HEADERS.md).

**Plugin API (`window.matchi`):** `toast`, `modal`, `root` and `user` (shell as root / as the app user), `hasRoot`, `copy`, `menu`, `router.get/set` (`/api/zte`), `sh` (shell helpers: curl wrapper, background jobs, paths) and small helpers (`escapeHtml`, `formatBytes`, `wait`, `debounce`, `interval`, `base64`, `panel`, `switch`, `loading`, `form`). The host serves `/api/shell` (root) and `/api/user_shell` (the app's own user, not root); both return `{success, content}`.

**Bundled tools:** the app carries MatchiTOOL's own `jq`, `sha256` and `zreq` (arm64) next to curl and sendat, in this app's files folder (`/data/data/com.matchi.tool/files/NAME`). Router access for plugins goes through `matchi.router.get/set` (`/api/zte`), which only talks to the saved router address. None of this has been compiled or run on a device.

**Plugin header and compatibility report (1.4.0).** A plugin may start with optional header lines (first 40 lines): `// @matchi-name`, `// @matchi-version`, `// @matchi-author`, `// @matchi-description`, `// @matchi-requires root, curl, jq`. The list shows name, version and author; the description and requirements appear as a tooltip. Before a plugin is added, the confirm dialog shows a summary read from the file: the header fields, whether it runs commands as root or as the app user, and which bundled tools it names (`curl`, `jq`, `sendat`, `zreq`). It is a text search, so a plugin that builds a route or command at run time is not covered.

The web bridge retains the existing plugin-facing functions (`runShellWithRoot`, `createToast`, `createModal`, and
`showModal`) and the `.actions-buttons` insertion point. Plugin compatibility is best-effort: plugins may still rely on
specific modem firmware, device nodes, AT command tools, or shell utilities. The bundled `sendat` binary must match the
CPU architecture and runtime environment of the target device.

## Security and testing

- [`SECURITY.md`](SECURITY.md): threat model, network access, sign-in, root gate, plugins, updater, bundled binaries.
- [`docs/TESTING.md`](docs/TESTING.md): automated checks, F50 checks, boot capture checks; [`docs/F50_CHECKLIST_1.4.1.md`](docs/F50_CHECKLIST_1.4.1.md) for the 1.4.1 release.
- [`CHANGELOG.md`](CHANGELOG.md): one short entry per version; full history in `docs/CHANGELOG_DETAIL.md`.

## Licenses and attribution

- MatchiTOOL project code: MIT, see `LICENSE`.
- Third-party dependencies retain their respective upstream licenses; NanoHTTPD is distributed under its upstream license.

Do not remove upstream copyright or license notices from third-party components you redistribute.

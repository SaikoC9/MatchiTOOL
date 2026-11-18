# MatchiTOOL

MatchiTOOL is an independent Android app that runs a local web console for ZTE modem and router tools. It has a web UI, a JavaScript plugin loader, an optional root-command bridge, AT command access, SMS and signal tools, and a client for the router's web API. The intended target is stock ZTE F50 firmware. The app does not root the F50 itself.

## Independence and root model

MatchiTOOL stands on its own. It needs no other app, no `socat`, no shared socket and no external boot script. When a privileged operation is requested, it runs the device's existing `su` (`su -c sh`). A root manager such as Magisk, KernelSU or APatch has to be installed already, and it has to grant MatchiTOOL root. So this is a root client, not a rooting exploit or a boot-image installer.

To root the stock ZTE F50 itself, see [`docs/F50_STOCK_ROOT.md`](docs/F50_STOCK_ROOT.md). The route documented there is specific to firmware B09. It uses a patched boot image and a TrustOS image, flashed with a separate host-side toolkit. MatchiTOOL does not flash those partitions and does not bundle stock or modified firmware images. Don't assume the B09 method works on another build.

Root commands go to the shell over stdin and are never put into a `su -c` string. Output is bounded and every command has a timeout. Root status shows the effective UID, the `su` path it found and a best-guess Magisk / KernelSU / APatch hint. UID 0 is the real check. The root manager decides who gets root and can take it away at any time. More in [`SECURITY.md`](SECURITY.md).

## Features

- **Web console** on port **2334**. You sign in with the admin password, and each sign-in is a session that expires (2 h idle, 12 h at most, plus a Sign out button). The service listens on the LAN, so other devices on the ZTE hotspot or USB-tether network can connect. API access is limited to the device itself and to subnets it recognises as hotspot-side. The host serves a self-signed HTTPS endpoint first and falls back to plain HTTP only if TLS cannot start. In that case the app shows "(NOT encrypted)".
- **Built-in tools and plugins:** seven tools are embedded in the web page (listed below). You can also upload your own plugins (several files at once), switch them on and off, and delete them.
- **Root terminal** and the `runShellWithRoot` plugin bridge.
- **AT commands** through the bundled `sendat` executable. It has to match the device's CPU architecture.
- **ZTE router API proxy** for SMS and live signal information.
- **Full diagnose** with copy and download. Every check is read-only.
- **Log Catcher (1.3.0):** live process diagnostics with timestamps and severity levels, filters by function, keyword and session, a bounded recent history, batched UI refresh, session files written in the background, size-based rotation and automatic retention. Logging can be started and stopped without restarting the app.
- **Advanced Network Diagnostics (1.2.0):** on-demand IPv4 and IPv6 address and route inspection, gateway and public-IP ping checks, and DNS lookup. It only reads. If ICMP is filtered, it reports that as a limitation, not as proof of an outage.
- **Device diagnostics:** Android build, root identity, kernel, network interfaces and routes, storage, and which optional tools are present. Read-only.
- **USB controls:** root-backed USB debugging on and off, a choice of USB Ethernet modes (RNDIS and CDC-ECM), live checks of the gadget state and what is supported, and a way to restore the USB configuration the firmware saved. What works depends on the Android ROM and kernel.
- **Firmware manifest preflight:** detects XML or scatter files, checks the XML is well formed, extracts partition names, picks up model and project hints, warns about critical partitions and shows a SHA-256 fingerprint. It only inspects. It never flashes anything.
- **Update app** (in the web console): upload a MatchiTOOL APK, or check an https link first and then download it. The APK is accepted only if it is this app and signed with the same key. A newer version updates. The same version number with a different SHA-256 (a different build) updates too. An identical file reinstalls, and an older version rolls back with your data kept. You confirm the SHA-256 before the install, which runs through root (`pm install -r`, with `-d` for a rollback).
- **OTA updates from a private repo:** keep the source private and publish only the signed APK to a separate public repo (see [`docs/OTA_RELEASES.md`](docs/OTA_RELEASES.md)). In the web console under Update app, paste `https://github.com/OWNER/REPO/releases/latest/download/MatchiTOOL.apk`.
- **Screen control:** view and control the device's own screen from the web page, for example from a second phone. It uses root `screencap` frames and root `input` events. It is a stream of screenshots, not video, and the second device has to be on the trusted hotspot or USB-tether network.
- **Boot receiver:** restarts the web host after a boot and runs the app's root startup script if there is one. Root access is still granted separately by `su`.

The seven built-in tools (AT Radio, Network Diagnostics, Live Status, Memory Cleaner, Change IP, SMS, and Screen Control) are embedded in `web/index.html` and load by themselves.
Don't run several tools that manage the same modem or firewall rules at the same time. Plugins run with the privileges of the host bridge, so treat them as trusted code and read one before you switch it on.

## Install and use

1. Install the APK on an ZTE F50 portable hotspot that already has a supported root manager.
2. Open MatchiTOOL and press **Request / check root access**. Approve the prompt in your root manager.
3. Connect with the LAN URL the app shows. The host always listens on the LAN, and that can't be switched off.
4. Open the web page and sign in. The built-in tools load by themselves. Use the Plugins card only for your own scripts.
5. If the router API needs a login, enter the router gateway and admin password in the SMS plugin settings.

The Bypass tool (firewall and TTL rules) is no longer part of MatchiTOOL, and since 1.4.2 the host no longer touches `boot.sh` for it. If a device still has Bypass lines in `/data/local/matchitool/boot.sh` from before 1.4.1, they stay there. Open the file as root, delete them by hand, and look for other leftover firewall or TTL lines while you are at it.

As a second line of defence, the web API rejects every source that is not this device or inside the ZTE hotspot subnet. The console serves HTTPS with a self-signed certificate, and plain HTTP only as a fallback. It exposes root and plugin APIs to the trusted LAN, so never forward port 2334 to the public internet. Keep your admin password private and press Sign out on shared computers. Sessions end by themselves after 2 h idle or 12 h. Root commands also need a sign-in younger than 4 h. If the console may have been exposed to an untrusted network, change the admin password. That ends every session.

**Update link.** The online-update field starts with `https://github.com/SaikoC9/MatchiTOOL-releases/releases/latest/download/MatchiTOOL.apk`. If you fork the project, change `D` in the page script near `matchi_ota_url`, or paste your own link once; the browser remembers it. A pasted release page link (`.../releases/tag/build-115`) is turned into the download link. If the release's APK has a different name, the only `.apk` in the release is used. Tags like `build-115` are not compared as versions. After the download, the SHA-256 and the APK's own version are checked.

**Console password.** By default the console signs in with the router's admin password. The *Password* button sets a separate console password of 10 or more characters. Sessions, lockout, HTTPS and HTTP, and the rest of the security model are in [`SECURITY.md`](SECURITY.md).

## Build

Current source version: **1.4.4** (versionCode **404**). The version lives in one place, `version.properties`. Gradle reads it, `node scripts/build-web.js` writes it into the page (`PAGE_VERSION`), and `scripts/validate.sh` fails if the README or the top CHANGELOG entry names a different version. To bump it, edit `version.properties`, run `node scripts/build-web.js`, update the README line and add a CHANGELOG entry.

You need an Android 8.0+ device (minSdk 26), and either Android Studio with Android SDK 34 and JDK 17, or Gradle 8.7 with Android Gradle Plugin 8.5.2.

```sh
./scripts/validate.sh
gradle :app:testDebugUnitTest
gradle :app:assembleDebug     # app/build/outputs/apk/debug/app-debug.apk
gradle :app:assembleRelease   # app/build/outputs/apk/release/app-release.apk (what gets published)
```

`scripts/validate.sh` runs these checks:

- the page build check;
- `check_repo.py` (version, README tool count, bundled binary hashes);
- `test_route_gates.py` (which routes need the root gate, read from the code);
- the Node and shell tests;
- `check_sources.py` (older grep-style tripwires; don't add to it, and when you touch that area replace a guard with a real test).

Kotlin logic is tested in `app/src/test` (`gradle :app:testDebugUnitTest`). The order of the root gate checks is tested in `RootGateTest`.

**Code layout of the web host.** `WebServer.kt` is the core: request checks, login, sessions, headers, the page and the route dispatcher. The routes live in `WebRoutes*.kt` (Auth, Device, Logs, Plugins, Root, Router, Update). Each file has one extension function per group, and it returns null for a path that isn't its own. `PluginPaths.kt` holds the plugin data-path rules. A new route goes into the matching `WebRoutes*.kt` **and** into the table in `scripts/test_route_gates.py`.

Release builds shrink unused code and resources with R8 but don't rename or optimise (`app/proguard-rules.pro`). If a release build ever misbehaves, set `isMinifyEnabled` and `isShrinkResources` to false in `app/build.gradle.kts`.

On a new machine, run `bash scripts/bootstrap-build.sh` once. It creates the Gradle wrapper and does the first full build.

The GitHub Actions workflow validates the JavaScript and XML and builds the debug APK on every push, pull request or manual run. It pins Gradle 8.7 and Android Gradle Plugin 8.5.2. The repository doesn't include the Gradle wrapper yet, so locally use an installed Gradle 8.7 or Android Studio.

## Log Catcher

Log Catcher is **only in the web console**; the Android app has no Log Catcher screen. Open the console in a browser, open Log Catcher and press **Start logging**. A session begins without restarting the host. The collector records MatchiTOOL's diagnostic events. Where Android allows access to the app's own process log buffer, it also tails this process with `logcat --pid`. Press **Stop logging** to close the session. Each session is stored privately under `files/logs/sessions/`, and text snapshots go to `files/logs/exports/`.

A low-priority single-thread writer does the file work, so it never blocks the UI, the shell or the network threads. The recent history in memory holds at most 3,000 entries. The write queue holds 4,096, a session file rolls over at about 8 MiB, and 30 session files are kept. If the device denies process-log access, MatchiTOOL's own diagnostic events are still recorded. Logs can contain device and network data, so keep exported files private.

A web Log Catcher session runs on the server and keeps running when you close its popup. While it is active it captures Android logcat output for the whole MatchiTOOL process, as well as the diagnostic events. Each session is written as a paired `.log` and `.txt` file with the same timestamped, leveled records and start and stop markers. The `.log` file is the one that counts as the session history.

## Live device status

The Live device status panel also shows CPU, memory, load and uptime. It only reads. It reports the sensors the running kernel and firmware expose, and modem temperature and sensor units vary between devices. The temperature bands are advice, not proof that the CPU or modem is throttling. The panel never disables thermal services and never changes GPU or charging controls.

**Refresh.** The refresh chips are Live (1 s), Balanced (3 s) and Eco. The panel pauses when it is closed, when another tool window is open and when the browser tab is hidden. It reads the router every 3 s and the root shell (CPU, memory, temperatures) every 15 s. When the device is warm it slows to 6 s and 30 s, and when it is hot to 15 s and 90 s. Warm means 60 C and hot means 70 C, read from the kernel thermal zones and not from the battery sensor. A hot phone shows `cooling` in the header.

**Push stream.** In Live and Balanced, while the phone is cool, the host pushes CPU, per-core speed, temperatures, memory, load and uptime once a second. They come from one root reader that runs only while a visible browser tab is watching. Eco, a warm or hot phone, a paused battery and plain HTTP use the polling described above. Polling also takes over by itself if the stream drops. The battery tile and its options are unchanged.

**CPU Governor** is the one part that writes. Tap the CPU tile to open it. It writes to `/sys/devices/system/cpu` only when you change something: cores on or off, the mode (governor) for each cluster and, in Manual mode, a locked speed. A change lasts until the next restart unless you press **Save for boot**. That writes `/data/local/matchitool/boot.d/10-cpu.sh`, which the host runs after `boot.sh`. **Remove from boot** deletes the file. If a saved setting ever makes the device unusable, delete that file with adb or a root shell.

**Change IP** (home button) switches mobile data off and on to get a new carrier address, and shows the local and public IP. Hotspot clients lose internet for a few seconds.

## Boot capture (Magisk)

Log Catcher > "Boot capture" installs `matchi_logd.sh` into `/data/adb/service.d/`. At boot it starts Android's own `logcat -b all` and `dmesg -w`, writing rotating files under `/data/local/matchitool/bootlogs/`. Capture survives app kills, crashes and updates, and it includes early-boot lines. Disk use is capped (by default about 41 MB), and capture pauses when `/data` has less free space than configured. You can remove it from the same panel, with the option to delete the files too. It needs root and Magisk (or KernelSU or APatch). It has not been verified on a real F50 yet; see [`docs/TESTING.md`](docs/TESTING.md).

## Compatibility notes

**Plugin API.** Plugins use `window.matchi` (see `web-src/plugin-host-api.js`), and the boot file is `/data/local/matchitool/boot.sh`. Plugins written for other tools that rely on their own helper names, upload routes or file paths won't run unchanged.

**Plugin data is erased when you delete the plugin (1.2.26).** MatchiTOOL can't see what a plugin's code wrote, so the plugin has to say. The delete dialog lists what will be erased and asks first.

- Every plugin has its own folder, `/data/local/matchitool/plugin_data/<plugin name without .js>/`. Keep the plugin's files there and they are removed automatically.
- For other folders, add a header line to the plugin source, one per path: `// @matchi-data /data/local/myplugin`. Three places are allowed:
  - folders inside `/data/local/`, except `tmp`, `matchitool` and MatchiTOOL's own `matchi_ttl`, `matchi_dpi`, `matchi_boot` and `matchi_lock`;
  - folders inside `/data/local/tmp/`, except MatchiTOOL's own `matchi*`, `mt_*` and `sqlite` names;
  - folders inside `/sdcard/`, except `Android` and standard folders such as `Download` itself (a folder inside `Download` is fine).

  Use only letters, digits, `.`, `_`, `-` and `/`, with no `..`, and at most 20 lines. Anything else is refused and listed in the dialog.
- For browser settings, `// @matchi-localstorage myplugin_` removes the saved keys that start with that prefix. The prefix has to start with the plugin's own name (letters and digits, any case), and it can never match MatchiTOOL's own keys.
- Since 1.4.1 some things happen with no header at all. Folders named after the plugin (`/data/local/<name>` and `/data/local/tmp/<name>`) are included if they exist and pass the same checks. Nothing under `/sdcard/` is guessed, so declare it with `@matchi-data`. Saved browser settings (local and session storage) whose key starts with the plugin's name (4 or more letters or digits) are included too. Everything is listed in the Delete dialog before you confirm.
- Also since 1.4.1, writes are traced. While a plugin runs, the page tags every root command and upload it sends with the plugin's file name. The host reads the command text and remembers the paths it writes to: `>` and `>>`, `tee`, `mkdir`, `touch`, the destination of `cp`, `mv`, `install` and `ln`, `dd of=`, `curl -o`, `wget -O`, `unzip -d`, `tar -C` and `sqlite3`, also inside `sh -c` and `su -c`, with simple `NAME=/path` variables filled in. Delete erases those paths (same strict rules, listed in the dialog first), removes the uploaded files the plugin sent, and removes parent folders that are left empty. Only commands run after 1.4.1 are traced. Not traced: a path that only appears inside a script file the plugin wrote and then ran, a program that writes on its own, and a call the page can't attribute to a plugin (no plugin frame in the browser's stack).
- Not erased with the data: whatever the plugin left running or changed in the system. **Delete and stop** and **Turn off and stop** (next section) deal with the part MatchiTOOL can know about. The rest stays, and is listed below.

**Delete and stop, Turn off and stop (1.4.1).** If a plugin may have started something or left something behind, the Delete dialog lists it word for word and offers **Delete and stop**. That needs the root gate and your sign-in password. **Delete without stopping** keeps the old behaviour. Everything runs as root, in this order:

- the plugin's own stop commands, from the header lines `// @matchi-uninstall`, `// @matchi-check` and `// @matchi-boot`;
- ending the processes MatchiTOOL found for the plugin: commands it saw the plugin send, `.pid` files those commands wrote, and command lines that name the plugin's own files. At most 50, and never PID 1, MatchiTOOL itself or anything another installed plugin also uses;
- undoing what the host saw the plugin's own commands create: its **firewall chains** (iptables and ip6tables, only the plugin's own chain and the jump rules into it) and its **`boot.d/NN-name.sh` scripts** (root-owned regular files only);
- a separate re-check. The plugin is deleted only if everything is gone. Otherwise it is **kept**, and the dialog says what is left.

**Turn off and stop** is the same stop for the on/off switch, without deleting the plugin file. Its saved data stays unless the plugin's own stop commands (listed in the dialog) remove it. The dialog offers **Turn off and stop** or **Turn off only**. It asks **no password**, like a plain switch. That is deliberate; see [`SECURITY.md`](SECURITY.md). The root gate still applies, and the stop is refused if the plugin file differs from the approved one. Turning a plugin on works as before.

**What is not undone:**

- anything MatchiTOOL didn't see in command text (made inside a script file the plugin wrote, through a shell variable, or by a program the plugin runs);
- a line in `/data/local/matchitool/boot.sh` (MatchiTOOL never edits it, so remove the line by hand);
- routes, system properties, mounts, eBPF pins (`/sys/fs/bpf/...`), scheduled jobs, package changes and services started through Android;
- anything outside the allowed folders.

A plugin that needs these should declare `@matchi-uninstall` commands. A reboot clears most of them. All of this protects against a **forgetful** plugin, not a **hostile** one, because a plugin can lie about its name.

**What was tested.** The header stop and the process sweep were run on the F50. The firewall and boot-script undo and Turn off and stop are compiled and unit-tested in CI, and were also run on the F50; the per-test results were not written down. The no-root and timeout path was not run on the device. Details, limits and examples are in [`docs/PLUGIN_STOP.md`](docs/PLUGIN_STOP.md). Every plugin header line is in one table in [`docs/PLUGIN_HEADERS.md`](docs/PLUGIN_HEADERS.md).

**Plugin API (`window.matchi`).** It has `toast`, `modal`, `root` and `user` (shell as root, and as the app user), `hasRoot`, `copy`, `menu`, `router.get/set` (`/api/zte`) and `sh` (shell helpers: curl wrapper, background jobs, paths). There are small helpers too: `escapeHtml`, `formatBytes`, `wait`, `debounce`, `interval`, `base64`, `panel`, `switch`, `loading` and `form`. The host serves `/api/shell` (root) and `/api/user_shell` (the app's own user, not root). Both return `{success, content}`.

**Bundled tools.** Next to curl and sendat, the app carries MatchiTOOL's own `jq`, `sha256` and `zreq` (arm64) in its files folder, `/data/data/com.matchi.tool/files/NAME`. Plugins reach the router through `matchi.router.get/set` (`/api/zte`), which talks only to the saved router address. None of this has been compiled or run on a device.

**Plugin header and compatibility report (1.4.0).** A plugin may start with optional header lines (in the first 40 lines): `// @matchi-name`, `// @matchi-version`, `// @matchi-author`, `// @matchi-description` and `// @matchi-requires root, curl, jq`. The plugin list shows name, version and author, and the description and requirements appear as a tooltip. Before a plugin is added, the confirm dialog shows a summary read from the file: the header fields, whether it runs commands as root or as the app user, and which bundled tools it names (`curl`, `jq`, `sendat`, `zreq`). The summary is a text search, so it can't see a route or command that a plugin builds at run time.

The web bridge keeps the existing plugin-facing functions (`runShellWithRoot`, `createToast`, `createModal` and `showModal`) and the `.actions-buttons` insertion point. Compatibility is best effort. A plugin may still depend on specific modem firmware, device nodes, AT command tools or shell utilities. The bundled `sendat` has to match the target device's CPU architecture and runtime.

## Security and testing

- [`SECURITY.md`](SECURITY.md): threat model, network access, sign-in, root gate, plugins, updater, bundled binaries.
- [`docs/TESTING.md`](docs/TESTING.md): automated checks, F50 checks and boot capture checks. [`docs/F50_CHECKLIST_1.4.1.md`](docs/F50_CHECKLIST_1.4.1.md) is the list for the 1.4.1 release.
- [`CHANGELOG.md`](CHANGELOG.md): one short entry per version. The full history is in `docs/CHANGELOG_DETAIL.md`.

## Licenses and attribution

- MatchiTOOL's own code is MIT; see `LICENSE`.
- Third-party dependencies keep their upstream licenses. NanoHTTPD is distributed under its upstream license.

Don't remove upstream copyright or license notices from third-party components you redistribute.

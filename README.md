# MatchiTOOL

An independent Android host application for ZTE modem/router tools. The project contains a local web UI,
JavaScript plugin loader, an optional root-command bridge, AT command integration, SMS and signal plugins, and a ZTE
router web-API client. The intended target is stock ZTE F50 firmware, but the app itself does not install root onto the F50.

## Independence and root model

MatchiTOOL does **not** require UFI-TOOLS, its private app directory, `socat`, a UFI Unix socket, or a UFI boot script.
It invokes the Android device's existing `su` command (`su -c sh`) when a privileged operation is requested. A compatible
root manager (for example Magisk, KernelSU, or APatch) must already be installed and must grant MatchiTOOL root
permission. This is a root **client/backend**, not a rooting exploit or boot-image installer.

For rooting the **stock ZTE F50 itself**, see [`docs/F50_STOCK_ROOT.md`](docs/F50_STOCK_ROOT.md). The currently documented public route is firmware-specific (B09) and uses a patched boot image and TrustOS image via a separate host-side flashing toolkit. MatchiTOOL does not flash these partitions or bundle proprietary stock/modified firmware images. Do not assume the B09 method works on another build.

Root commands are sent to the shell over stdin, rather than interpolated into a `su -c` command string. Command
output is bounded and execution has a timeout. Root status reports the effective UID, resolved `su` path, and a
best-effort Magisk / KernelSU / APatch hint; UID 0 is the authoritative grant check. Root authorization and
revocation remain controlled by the root manager. See [`docs/ROOT_INTEGRATION_1.1.52.md`](docs/ROOT_INTEGRATION_1.1.52.md).

## Features

- **Advanced Network Diagnostics (1.2.0)**: on-demand IPv4/IPv6 address and route inspection, gateway/public-IP ping checks, and DNS lookup. Read-only; ICMP filtering is reported as a limitation rather than proof of an outage.
- **Read-only device diagnostics**: Android build, root identity, kernel, network interfaces/routes, storage, and optional tool availability.
- **USB controls**: root-backed USB debugging enable/disable plus selectable USB Ethernet modes (RNDIS and CDC-ECM), live gadget-state/support checks, and restoration of the firmware-saved USB configuration. Availability and behavior depend on Android ROM/kernel support.
- **Firmware manifest preflight**: XML/scatter format detection, XML well-formedness, partition-name extraction, model/project hints, critical-partition warnings, and SHA-256 fingerprint. This is inspection only and never flashes partitions.

- Browser interface on port **2334** with admin-password login and per-login expiring sessions (2 h idle / 12 h maximum, Sign out button). The service binds to LAN interfaces so other devices on the ZTE hotspot / USB-tether network can connect; API access is restricted to the device itself and detected hotspot-side subnets. The transport is plain HTTP, not encrypted.
- Full diagnose with copy/download (read-only checks). Nine built-in tools embedded in the web page, plus custom plugin upload (multi-file), enable/disable and delete.
- Root terminal and the `runShellWithRoot` plugin bridge.
- **Update app** (web console): upload a MatchiTOOL APK (or check an https link first, then download). It is only accepted if it is this app and signed with the same key; newer versions update, the same version reinstalls, older versions roll back (data kept). You confirm the SHA-256 before it is installed through root (`pm install -r`, `-d` for rollback).
- **Screen control**: view and control the device's own screen from the web page (root `screencap` frames + root `input` events), e.g. from a second phone. A screenshot stream, not video. Requires the companion device to be on the trusted ZTE hotspot / USB-tether network.
- AT command execution through the bundled `sendat` executable (device/architecture compatibility required).
- **OTA update with a private repo:** keep the source private and publish only the signed APK to a separate public repo (see `docs/OTA_RELEASES.md`). In the web console, Update app, paste `https://github.com/OWNER/REPO/releases/latest/download/MatchiTOOL.apk`.
- ZTE router API proxy for SMS and live signal information.
- Boot receiver restarts the web host and runs the app-managed root startup script (when present); root access is separately authorized by `su`.

The six built-in tools (AT Radio, Live Status, Memory Cleaner, SMS, Screen Control, and Advanced Network Diagnostics) are embedded in `web/index.html` and load automatically.
Do not run multiple tools that manage the same modem/firewall rules at the same time. Review plugin code before enabling it:
plugins execute with the privileges of the host bridge and should be treated as trusted code.

## Build

Requirements: Android 8.0+ device (minSdk 26); Android Studio with Android SDK 34 and JDK 17, or Gradle 8.7 with the Android Gradle Plugin 8.5.2.

```sh
./scripts/validate.sh
gradle :app:testDebugUnitTest
gradle :app:assembleDebug     # app/build/outputs/apk/debug/app-debug.apk
gradle :app:assembleRelease   # app/build/outputs/apk/release/app-release.apk (what gets published)
```

First time on a new machine: `bash scripts/bootstrap-build.sh` creates the Gradle wrapper and does the first full build.

The GitHub Actions workflow validates JavaScript/XML and builds the debug APK on push, pull request, or manual dispatch. The CI workflow pins Gradle 8.7 and the Android Gradle Plugin 8.5.2. The repository does not yet include the Gradle wrapper; use an installed Gradle 8.7 distribution or Android Studio for local builds.

## 1.1.49 security notes

Router credentials are stored using Android Keystore AES-GCM encryption where the platform keystore is available. Older installations migrate their saved router password when it is first read; existing preferences, plugin files, and boot task paths are retained. The web API adds defensive response headers and rejects cross-origin requests.

The web console still uses HTTP to preserve compatibility with the existing LAN browser workflow. HTTP does not encrypt passwords, session tokens, or root-command traffic. Keep port 2334 restricted to a trusted ZTE hotspot / USB-tether network; never port-forward it to the public internet. For remote access, use a trusted VPN or encrypted tunnel.

## Install and use

1. Install the APK on an Android device that already has a supported root manager.
2. Open MatchiTOOL and press **Request / check root access**. Approve the root prompt in the root manager.
3. Connect using the LAN URL shown in the app (the host listens on the LAN by default). LAN access is always on and cannot be switched off.
4. Open the web page and log in; the built-in tools load by themselves. Use the Plugins card only for your own scripts.
5. Configure the ZTE router gateway and admin password in the SMS plugin settings if the router API requires login.

The Bypass tool was removed in 1.2.12. If you used it earlier, its boot entries may still be in `/data/local/matchitool/boot.sh`; on boot, MatchiTOOL's receiver still asks the already-authorized `su` manager to run that file if it exists, so those firewall/TTL rules keep applying. Edit or delete that file by hand (`su -c`) if you no longer want them. Running the file requires the root manager to retain MatchiTOOL's grant across reboot.

The web API rejects every source that is not this device or inside the ZTE hotspot subnet, as a defense-in-depth measure. The host always listens on the LAN (there is no local-only mode). It uses unencrypted HTTP and exposes privileged root/plugin APIs to the trusted LAN; never forward port 2334 to the public internet, and keep your admin password private and press Sign out on shared computers. Sessions end by themselves after 2 h idle or 12 h.
may have been exposed.

## Compatibility notes

**UFI-TOOLS plugins (1.2.15):** the page also provides `uploadFileKano`, `downloadUrl`, `createFixedToast`, `requestInterval` and `UFI_DATA.lan_ipaddr`, and the host serves `/api/upload` and `/api/uploads/<name>`. Plugins that hard-code UFI paths (`/data/data/com.minikano.f50_sms/...`, `/sdcard/ufi_tools_boot.sh`) or need UFI's bundled `curl` still have to be converted; the boot file for MatchiTOOL is `/data/local/matchitool/boot.sh`.

The web bridge retains the existing plugin-facing functions (`runShellWithRoot`, `createToast`, `createModal`, and
`showModal`) and the `.actions-buttons` insertion point. Plugin compatibility is best-effort: plugins may still rely on
specific modem firmware, device nodes, AT command tools, or shell utilities. The bundled `sendat` binary must match the
CPU architecture and runtime environment of the target device.

## Licenses and attribution

- MatchiTOOL project code: MIT, see `LICENSE`.
- UFI-TOOLS-derived components and notices: see `LICENSE-UFI-TOOLS` and the retained source/plugin headers.
- The Bypass tool (a fork of a UFI-TOOLS plugin) was removed in 1.2.12; its MIT license text stays in `LICENSE-BYPASS` for reference.
- Third-party dependencies retain their respective upstream licenses; NanoHTTPD is distributed under its upstream license.

Do not remove upstream copyright or license notices when modifying or redistributing derived components.


## Current network exposure model (1.1.49)

The historical 1.1.1 note about opt-in LAN mode was superseded by later compatibility changes. In 1.1.49, `HostService` explicitly binds to `0.0.0.0` so another device on the ZTE hotspot / USB-tether network can open the console. `WebServer`'s constructor default of `127.0.0.1` is only a default for callers that do not supply a bind address; it is not the active service binding. `Prefs.lanAccess()` is retained as a compatibility method and returns true. API requests are additionally restricted by `HostControl.isHotspotClient`.

**Security limitation:** this is still HTTP. The subnet check is not a substitute for encryption, and any trusted-LAN client that obtains a valid session token can access privileged APIs. Never port-forward the port or use it on an untrusted network.
\n\n## Stability-first integration 1.2.0
The Live device status panel (which now also shows CPU, memory, load and uptime) is deliberately read-only. It reports sensors exposed by the running kernel/firmware; modem temperature availability and sensor units can vary. Its temperature bands are advisory and are not proof of CPU/modem throttling. The monitor pauses when its panel is closed or the browser tab is hidden, and reduces polling frequency at elevated readings. It never disables thermal services or changes CPU/GPU/charging controls.

## Stability update 1.1.54
See `docs/TESTING_1.1.54_STABILITY.md` for resource, thermal, Bypass regression, and 24-hour soak tests. For the 1.2.0 monitor and network-diagnostics checks, see `docs/TESTING_1.2.0.md`. This release applies app-side back-pressure and polling reductions; device runtime validation is still required.\n
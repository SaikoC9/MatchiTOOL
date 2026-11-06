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
output is bounded and execution has a timeout. Root authorization and revocation remain controlled by the root manager.

## Features

- **Read-only device diagnostics**: Android build, root identity, kernel, network interfaces/routes, storage, and optional tool availability.
- **USB controls**: root-backed USB debugging enable/disable plus selectable USB Ethernet modes (RNDIS and CDC-ECM), live gadget-state/support checks, and restoration of the firmware-saved USB configuration. Availability and behavior depend on Android ROM/kernel support.
- **Firmware manifest preflight**: XML/scatter format detection, XML well-formedness, partition-name extraction, model/project hints, critical-partition warnings, and SHA-256 fingerprint. This is inspection only and never flashes partitions.

- Browser interface on port **2334** with a generated access token. The server listens on the LAN by default and only accepts private/local source addresses (public IPs are refused); local-only mode can be switched on from the Android host screen.
- Full diagnose with a copy button (read-only, covers every function). Six built-in tools embedded in the web page, plus custom plugin upload (multi-file), enable/disable and delete.
- Root terminal and the `runShellWithRoot` plugin bridge.
- **Update app** (web console): upload a newer MatchiTOOL APK. It is only accepted if it is this app, newer, and signed with the same key; you confirm the SHA-256 before it is installed through root (`pm install -r`, no downgrade).
- **Screen control**: view and control the device's own screen from the web page (root `screencap` frames + root `input` events), e.g. from a second phone. A screenshot stream, not video. Needs LAN access enabled to use it from another device.
- AT command execution through the bundled `sendat` executable (device/architecture compatibility required).
- ZTE router API proxy for SMS and live signal information.
- Boot receiver restarts the web host and runs the app-managed root startup script (when present); root access is separately authorized by `su`.

The tools (AT Radio, Bypass, Device Status, Live Status, Memory Cleaner, Network Debug, SMS, Signal Info, Screen Control) are embedded in `web/index.html` and load automatically.
Do not run multiple tools that manage the same modem/firewall rules at the same time. Review plugin code before enabling it:
plugins execute with the privileges of the host bridge and should be treated as trusted code.

## Build

Requirements: Android 8.0+ device (minSdk 26); Android Studio with Android SDK 34 and JDK 17, or Gradle 8.7 with the Android Gradle Plugin 8.5.2.

```sh
./scripts/validate.sh
gradle :app:assembleDebug
```

APK output: `app/build/outputs/apk/debug/app-debug.apk`.

The GitHub Actions workflow validates JavaScript/XML and builds the debug APK on push, pull request, or manual dispatch. The CI workflow pins Gradle 8.7 and the Android Gradle Plugin 8.5.2. The repository does not yet include the Gradle wrapper; use an installed Gradle 8.7 distribution or Android Studio for local builds.

## Install and use

1. Install the APK on an Android device that already has a supported root manager.
2. Open MatchiTOOL and press **Request / check root access**. Approve the root prompt in the root manager.
3. Connect using the LAN URL shown in the app (the host listens on the LAN by default). To restrict it to this device only, switch LAN access off on the host screen.
4. Open the web page and log in; the built-in tools load by themselves. Use the Plugins card only for your own scripts.
5. Configure the ZTE router gateway and admin password in the SMS plugin settings if the router API requires login.

The Bypass plugin stores TTL/DPI helper state under `/data/local/matchitool/` and its boot entries in `/data/local/matchitool/boot.sh`. On boot, MatchiTOOL's receiver asks the already-authorized `su` manager to execute that file. This requires the root manager to retain MatchiTOOL's grant across reboot. If upgrading from an older UFI-based setup, first disable the old UFI boot entries and remove/stop the old helpers to avoid duplicate firewall management.

The web API rejects non-local source IP addresses as a defense-in-depth measure. LAN listening is the default (local-only is a switch away). LAN mode uses unencrypted HTTP and exposes privileged root/plugin APIs to the trusted LAN; enable it only when needed, never forward port 2334 to the public internet, and keep the access token private. Reset the token in the Android app if it
may have been exposed.

## Compatibility notes

The web bridge retains the existing plugin-facing functions (`runShellWithRoot`, `createToast`, `createModal`, and
`showModal`) and the `.actions-buttons` insertion point. Plugin compatibility is best-effort: plugins may still rely on
specific modem firmware, device nodes, AT command tools, or shell utilities. The bundled `sendat` binary must match the
CPU architecture and runtime environment of the target device.

## Licenses and attribution

- MatchiTOOL project code: MIT, see `LICENSE`.
- UFI-TOOLS-derived components and notices: see `LICENSE-UFI-TOOLS` and the retained source/plugin headers.
- `Bypass_v65_13.js` retains its original author/copyright header; its MIT license is reproduced in `LICENSE-BYPASS`.
- Third-party dependencies retain their respective upstream licenses; NanoHTTPD is distributed under its upstream license.

Do not remove upstream copyright or license notices when modifying or redistributing derived components.

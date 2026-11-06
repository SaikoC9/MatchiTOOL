# Changelog

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

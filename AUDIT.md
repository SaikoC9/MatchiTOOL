# MatchiTOOL source audit

Audit date: 2026-11-05

## Scope inspected

- Android manifest, Gradle configuration, application activity, foreground host service, boot receiver, preferences, root shell, web server, and ZTE client.
- Bundled HTML/JavaScript and plugins: AT Radio, Bypass v65.13, Device Status, SMS, and Signal Info.
- License/notice files and CI workflow.

## Findings

### Root mechanism

The Android app's `RootShell` invokes `su -c sh` and sends a script through stdin. This is independent of the UFI `socat` socket, but it only works when the Android OS running the app already has a compatible `su` provider and the user has authorized it. It does **not** root stock F50 firmware by itself.

### Stock F50 root path

The publicly documented `dikeckaan/zte-f50-toolkit` route is specifically for stock `F50_FLYMODEM_ZYV1.0.0B09`; it writes a Magisk-patched boot image and a patched TrustOS image using a host-side Unisoc/SPD flashing tool. That operation is distinct from this Android app's `su` backend. The fork deliberately does not redistribute patched TrustOS/boot images or a flashing binary, and does not automatically flash partitions.

### Privileged web API

The web server exposes an authenticated `/api/shell` endpoint that can run arbitrary root shell commands. It binds to a local web port and checks the source IP and access token, but HTTP is unencrypted and anyone who obtains the token on the LAN can execute privileged commands. Do not expose/forward this port to the internet. For a public release, prefer a loopback-only default, explicit LAN enablement, TLS or an authenticated tunnel, and per-plugin capability restrictions.

### Plugin trust

Plugins are JavaScript and the shell bridge is privileged. Any installed or uploaded plugin should be treated as trusted code. Keep the token private and only install plugins from sources you trust.

### Binary/dependency compatibility

`sendat` is bundled as a native executable; its architecture and runtime ABI must match the device where it executes. The Anti-DPI `nfqws` executable is not bundled and must not be assumed available. NanoHTTPD is a Gradle dependency. The repository CI workflow runs source validation and a debug build, but this local audit environment did not have Gradle/Android SDK installed, so an APK build could not be verified locally.

## Validation performed

- `scripts/validate.sh`: passed (XML parse, inline JavaScript syntax, bundled plugin JavaScript syntax, and fork-path assertions).
- ZIP integrity: checked when packaging the source archive.
- Android Gradle compile / device runtime test: not performed in this environment.

## Recommended next fixes

1. Add a Gradle wrapper and dependency verification/locking for reproducible builds.
2. Bind the privileged server to loopback by default and require an explicit setting to expose it to a trusted LAN.
3. Move shell execution behind an allowlisted command interface for built-in features; reserve arbitrary shell for an explicitly enabled developer mode.
4. Add unit tests for root timeout, output cap, command exit status, auth lockout, IPv4/IPv6 local-address checks, and plugin file path validation.
5. Add a stock-F50 firmware compatibility database and non-destructive preflight checks; do not add ADB/Fastboot discovery.


## 1.1.0 implementation notes

Implemented against the audited source tree:

- Added authenticated read-only `/api/diagnostics` endpoint and browser panel.
- Added authenticated `/api/firmware/inspect` endpoint for bounded XML/scatter text inspection and SHA-256 calculation.
- Added browser UI panels for both workflows.
- Preserved existing `/api/shell`, `/api/at`, `/api/zte`, `/api/plugins` routes and plugin bridge names.
- Updated Android version metadata to 1.1.0 / versionCode 110.

Remaining release gates: run Android Gradle build, test on stock F50 and a rooted Android host, validate firmware samples from each supported chipset, and perform LAN security review. The current HTTP LAN bridge remains sensitive because it exposes privileged APIs to authenticated local clients; never port-forward it.


## 1.1.1 hardening and servicing follow-up

Implemented against the 1.1.0 source:

- **Network exposure:** `WebServer` now binds to `127.0.0.1` by default. LAN binding (`0.0.0.0`) is opt-in through the native host screen, with a warning explaining that the API uses HTTP and exposes privileged functionality. Existing plugin API routes are retained.
- **Host status:** the foreground notification and native screen identify local-only versus LAN-enabled mode. Changing the setting restarts the host service.
- **Root request guard:** `/api/shell` rejects empty, oversized (>128 KB), and NUL-containing command bodies before invoking the existing root bridge.
- **Firmware preflight:** XML is checked for well-formedness; model/project labels and boot-critical partition names are surfaced as hints/warnings. This does not establish firmware compatibility and never flashes.
- **Compatibility:** existing settings keys, token storage, plugin routes, bundled plugin files, and plugin-facing shell bridge remain intact. LAN access is a new setting and defaults to false.

### Remaining verification

The source validation script checks the new security defaults, API routes, manifest preflight markers, and web/plugin JavaScript syntax. A full Android build and on-device validation still require Android SDK/Gradle and physical-device testing. In particular, validate loopback browser access, explicit LAN opt-in, firmware-inspection samples, and the behavior of the installed `su` manager on the target Android device.


## 1.1.2 scope correction

- Removed ADB and Fastboot discovery from the web UI, backend routes, diagnostics tool list, validation assertions, and current feature documentation.
- Firmware manifest inspection, device diagnostics unrelated to platform-tools discovery, root bridge, settings, and bundled plugins remain.
- No chipset-level Qualcomm, MediaTek, or Unisoc identification is claimed by this release.

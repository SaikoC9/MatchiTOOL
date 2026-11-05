# MatchiTOOL

A UFI-TOOLS-style host app for the ZTE F50. It serves a web UI (port 2334) and gives UFI-TOOLS plugins
(like Bypass_v65_13.js) the functions they expect: runShellWithRoot, createToast, createModal, showModal,
and a `.actions-buttons` container.

## How root works (same idea as UFI-TOOLS)
The app is never root. A root `socat` daemon listens on a unix socket in the app's own files dir, owned by the app's uid.
UFI-TOOLS already ships socat and gets root on the F50, so MatchiTOOL reuses that: UFI-TOOLS must stay installed
with Advanced Features on. One-time setup: in the app press "Copy root setup command" and paste it into a root shell
(UFI-TOOLS terminal or `adb shell`). It also adds a boot line to /sdcard/ufi_tools_boot.sh so the daemon restarts after reboot.

## Build
- No PC: push this folder to a GitHub repo, Actions -> "Build APK" -> download app-debug.apk.
- Android Studio: open folder, Build > Build APK.

## Use
1. Install the APK, open it, run the setup command once, press Re-check root (should say Root: OK).
2. Open the shown URL in a browser, enter the token.
3. Plugins live in the app's files/plugins dir (Bypass_v65_13.js is bundled).
   Do not enable the same plugin in UFI-TOOLS and MatchiTOOL at the same time; both would manage the same iptables rules.

## Plugins
The web UI has a "Manage plugins" card: upload a `.js` file, enable/disable or delete plugins (reload to apply).
Bundled plugins are refreshed on each app update. `Device_Status.js` shows battery, temperature, load, memory, uptime,
IPs and has a reboot button. The UI also has a root terminal box.

## Security
The token gives a root shell to anyone who has it. Keep the port off the internet; reset the token if leaked.

After 8 wrong tokens an IP is locked out for 60 seconds. Uploaded plugins run with full root-shell access, so only add ones you trust.

## License
MIT, see LICENSE. The bundled `Bypass_v65_13.js` plugin is by saiko (MIT) and keeps its own copyright header.

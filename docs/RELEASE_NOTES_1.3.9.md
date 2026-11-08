## MatchiTOOL 1.3.9 - bundled curl

**Fixes plugins that download files (for example ADGuard Home).** Android has no `curl`, so the Install button sat at "Downloading 0%" and never reported an error.

- The app now ships an arm64 `curl` (8.0.1-DEV, from the UFI-TOOLS V4.0.0 APK) and installs it to its own `files/curl` on start.
- Plugins find it automatically. A `curl.real` you place by hand in `/data/local/matchitool/bin/` still takes priority.
- The diagnostics report now lists the bundled curl.
- Requires an arm64 Android device (curl uses the phone's own libssl).
- Third-party notice and SHA-256 added to `NOTICE.md`; `validate.sh` fails if the binary changes.

Also updated: the ADGuard Home plugin (`ADGuardHome_plugin_2_4_EN_MatchiTOOL_fixed.js`) now stops with a clear error instead of waiting 10 minutes, can install from a zip already on the device, and no longer depends on `awk`/`timeout`. Re-upload it in Plugins.

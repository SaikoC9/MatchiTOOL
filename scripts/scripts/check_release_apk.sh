#!/usr/bin/env bash
# Smoke test for the R8-shrunk release APK (shrinking and renaming only happen in the release build, so the debug unit
# tests cannot catch what they break). Checks that the things the app finds BY NAME or as files are still inside:
#   - the three manifest components (MainActivity, HostService, BootReceiver),
#   - NanoHTTPD's classes (it loads its own classes by name, see proguard-rules.pro),
#   - the web page and the bundled binaries in assets.
# usage: scripts/check_release_apk.sh app/build/outputs/apk/release/app-release.apk     (AAPT2=/path/to/aapt2 overrides the lookup)
set -euo pipefail
APK="${1:?usage: check_release_apk.sh <apk>}"
[ -f "$APK" ] || { echo "::error::$APK not found"; exit 1; }
if [ -z "${AAPT2:-}" ]; then
  BT="$(ls -d "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/nonexistent}}"/build-tools/* 2>/dev/null | sort -V | tail -1 || true)"
  AAPT2="$BT/aapt2"
fi
[ -x "$AAPT2" ] || { echo "::error::aapt2 not found (set ANDROID_HOME or AAPT2)"; exit 1; }
fail=0
bad() { echo "::error::release APK check: $1"; fail=1; }

MANIFEST="$("$AAPT2" dump xmltree "$APK" --file AndroidManifest.xml)"
for c in MainActivity HostService BootReceiver; do
  grep -q "$c" <<<"$MANIFEST" || bad "manifest does not list $c"
done

# dex string tables hold class descriptors as plain text
DEX_HIT="$(unzip -p "$APK" 'classes*.dex' | grep -ac 'Lfi/iki/elonen/NanoHTTPD;' || true)"
[ "${DEX_HIT:-0}" -ge 1 ] || bad "NanoHTTPD classes are missing from the dex (shrunk away or renamed)"

LIST="$(unzip -Z1 "$APK")"
for f in assets/web/index.html assets/bin/curl assets/bin/jq assets/bin/sendat assets/bin/zreq assets/bin/matchi_logd.sh assets/bin/imei_apply.sh; do
  grep -qx "$f" <<<"$LIST" || bad "$f is not in the APK"
done

[ "$fail" = 0 ] && echo "release APK check passed: manifest components, NanoHTTPD classes and bundled assets are present"
exit "$fail"

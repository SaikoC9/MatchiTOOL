# MatchiTOOL 1.2.3 test checklist (P0 changes + update-signature fix)

Nothing in 1.2.3 has been compiled or run yet. Do these in order on a rooted Android host / the ZTE F50.

## 0. Build
- `bash scripts/bootstrap-build.sh` (creates the Gradle wrapper, runs `scripts/validate.sh`, unit tests, debug + release builds).
- All `SessionStoreTest` cases pass.

## 1. Release APK is safe to ship
- `aapt2 dump badging app/build/outputs/apk/release/app-release.apk | grep application-debuggable` prints nothing.
- `apksigner verify --print-certs` shows the permanent MatchiTOOL key (same SHA-256 as the installed 1.2.1).
- On a PC with adb: `adb shell run-as com.matchi.tool ls` is refused ("package not debuggable").

## 2. Update from 1.2.1
- Web console > Update: upload or fetch the 1.2.3 release APK; the page waits and reports "updated to 1.2.3".
- After the update the browser is asked to sign in again (the old permanent token no longer exists). Expected.

## 3. Sessions
- Sign in with the router admin password: works. Sign in with the OLD access token as the password: refused.
- Two browsers signed in at once: both work, each has its own token (localStorage `matchi_token` differs).
- "Sign out" (header): returns to the sign-in card; reusing the old token with `curl -k -H "x-token: <old>" https://<ip>:2334/api/ping` gives 401.
- Idle expiry: leave a tab hidden for more than 2 h; the next action returns to the sign-in card with "Session ended".
- Changing the router password (and signing in with the new one) ends every other session.
- Restart the host (force-stop the app, open it again): a still-valid session stays signed in.
- Update flow: the "Waiting for the new version" loop still finishes after the host restarts (sessions are saved across restarts).

## 4. Regression
HTTPS opens, root status, AT & Radio, SMS, Screen control, Bypass, USB controls, plugin manager.

## 5. Update-signature fix
- Build a release APK WITHOUT the keystore: `unzip -l app-release.apk | grep META-INF` or `apksigner verify` shows it is signed (debug key), not `app-release-unsigned.apk`.
- Uploading that APK to a build signed with the permanent key gives "Signature mismatch" (not "no valid signature").
- Uploading a really unsigned APK gives the "not signed at all" message.
- Uploading the properly signed release APK (permanent key, higher versionCode) shows version/SHA-256 and installs.

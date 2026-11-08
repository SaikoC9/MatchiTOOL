# Changelog

## Unreleased - review fixes (items from MatchiTOOL_v1_2_27_bug_report.txt)
- **Fix, patched20** (F50 log: `TLS self-test failed: SSLHandshakeException: connection closed` with TLS 1.3+1.2 and again with TLS 1.2 only, then plain HTTP): the Android key store key cannot complete a handshake on this device, so changing the protocol version never helped. The host now tries, in order: key store (TLS 1.3+1.2, TLS 1.2), then a **software RSA key** (self-signed certificate made in `Tls.selfSignedCert`, key and certificate saved as `tls_sw.key` / `tls_sw.crt` in the app's private folder, mode 600), and only then plain HTTP. Every step is checked by a real loopback handshake; the log now says which key and protocol worked (`TLS self-test ok (software, TLSv1.3, ...)`). Certificate DER builder checked against OpenSSL. **Device-tested on the ZTE F50:** key store failed with TLS 1.3+1.2 and TLS 1.2 (as before), the software key then passed with `TLSv1.3, TLS_AES_128_GCM_SHA256` and the host reported `listening on port 2334 (https, software key)`. `matchi_selftest.sh http https://192.168.0.1:2334` from a PC: 14 pass, 0 fail, 0 warn (HTTPS, security headers, host/origin checks, login lock, TLS 1.1 refused, TLS 1.2 works). The two `TLS self-test failed` lines before the software key succeeds are expected on this device.
- **Fix, patched19** (from the first on-device self-test report on an F50): the old `sms_delete_debug.txt` (a list of SMS texts left by earlier builds) is now deleted by the one-time old-file cleanup 200 s after the service starts. `scripts/matchi_selftest.sh` added with these corrections to the test itself: a failing check no longer also prints a PASS; the T2 leak check ignores the app's own `tmp/jobs` folder; the port check also reads `/proc/net/tcp6` (the host is a dual-stack socket); the timeout case now runs the app's real kill sequence instead of the device's `timeout` tool (which on the F50 returned only after the script ended); the script no longer reports itself as an old temp file. Not compiled.
- **Fix, patched18**: the clear keystore error added in patched15 broke the CI unit-test step (keystore file set, passwords not yet). The check now runs only when a signing task is part of the build, and an empty secret counts as missing.
- **Review fixes, patched17 (not compiled)**: A4 over plain HTTP, answering "no" to the root-command warning is remembered until the page is reloaded (before, every poller call opened the dialog again).
- **Review fixes, patched16 (not compiled)**: A3b the loopback daily cap no longer refuses logins (any app on the phone could lock the owner out for 24 h). After 300 wrong passwords a day a wrong answer waits 30 s instead; a correct password is never delayed and a good login clears the count.
- **Review fixes, patched15**: A8 the router password is never stored unencrypted any more (if the key store fails it is not saved and the console says so); B4 a character cut at the 1 MB output limit is dropped; B13 when a boot run does not finish, events.log names the script that was running; C3 release builds without a keystore print a clear Gradle warning; C4 new `RootShellLauncherTest`.
- **Review fixes, step 4 (patched14)**: A7 SMS debug scan removed and hidden-list keys hashed; A8 console shows a warning when the router password is stored unencrypted; A10 screenshot chmod 600; B4 dead output-drop counter removed; B10 plugin import checks the 50-plugin / 5 MB limits first and reports what was imported; B13 boot scripts get a shell watchdog when `timeout` is missing; C2 workflows use `permissions: contents: read`; C3 clear error for a partial keystore config; C5/C6 README, NOTICE, AUDIT and CHANGELOG corrections plus an IMEI note. Not done: Gradle wrapper (C1), action SHA pinning, string-grep tests (C4), A9 default OTA URL, A11. Patch level: this build is patched14 of 1.2.27.
- **Review fixes, step 3 completed (A4)**: when the console runs over plain HTTP, root commands (`/api/shell`) from another device need a one-time confirmation in the page (the host refuses without the `X-Insecure-OK` header; loopback is exempt).
- **Review fixes, step 1 completed (A3c, A3e)**: optional separate console password (10+ characters, salted PBKDF2 hash, set from the new Password button; needs the current password; other sessions end; when set, wrong guesses are never forwarded to the router). Router-forwarding budget is now 3 per address plus 9 for the whole app, so one client cannot lock the owner out.
- **Review fixes, round 3**: B9 page loads even when browser storage is blocked, session token moved to `sessionStorage` (A6) and a Content-Security-Policy added (plugins keep `unsafe-eval` and open `connect-src`); A4 HTTPS now requests only TLS 1.3/1.2 that the device supports (never 1.0/1.1); B11 429 shows the host's real wait time; B12 root slots 3 -> 4 and long jobs 2 -> 3.
- **Review fixes, round 2 (patched10, not compiled yet)**: A1 no more "router /24" fallback subnet (loopback only when no hotspot interface); A2 root pid/out files now live in the root-only `/data/local/matchitool/tmp` and are created with noclobber; A3 per-IP failure count decays over 1 h (not 60 s), loopback gets a 300/day cap, failed logins go to the audit log; A5 hotspot-client check now runs before the page and 404; B1 raw screen capture is retried 30 s after 3 failures instead of latching off; B2 USB script runs in a subshell so failure diagnostics print; B3 OTA redirects resolve against the previous hop; B5 screen-frame answers use harden(); B6 chunked POST gets a clear error; B7 LAN label follows the real TLS state.
- **IMEI keeper no longer gives up after 3 boots**: only failed writes count toward the 3-try limit; both `sendat` calls read `</dev/null`; the keeper runs in its own worker next to the boot scripts (worker pool 2 -> 4). New `scripts/test_imei_apply.sh`.
- **Change IP** retries `svc data enable` and always tries to turn mobile data back on. `Change_IP.js` is now a reserved plugin name on the server.
- **Root-only temp folder** `/data/local/matchitool/tmp` replaces `/data/local/tmp` for the updater log/rollback copy, Memory Cleaner and Bypass jobs (folder must be a real directory owned by root). The SMS sender no longer writes `mt_isms.sh`. Old files are deleted once, 200 s after the service starts.
- **/api/shell for a session older than 4 h** answers `403 {"code":"reauth"}`; the page keeps the token and shows a (rate-limited) sign-in hint instead of logging out.
- Error responses (status 400 and up) send `Connection: close`. Global login back-off capped at 30 s (was 5 min). `RootShell.status` uses `MUID`. Dead `readBoundedLine` removed.
- README/AUDIT corrections; `sendat` SHA-256 pinned in `NOTICE.md` and `validate.sh`.
- Not compiled and not tested on a real device.

## 1.2.27 - Fixes: two screen viewers
- **Screen view: two viewers no longer fight over scale/quality.** The first viewer (by address) owns the settings while it keeps asking; another viewer gets frames at the owner's settings until the owner has been silent for 10 s, then takes over. The scale actually used is returned in `X-Screen-Scale` (new `ViewerLock`, `ViewerLockTest`). The page needs no change.
- Item 24 (plain-HTTP warning): the page already shows a "Not encrypted" bar on every page including the login when opened over http; no code change was needed.
- Not compiled and not tested on a real device.

## 1.2.27 - Fixes: hotspot address list, su refusal detection, cleanup
- **Console address and client check use one interface list.** The shown address could be an `eth*` interface that the client check then refused ("ZTE hotspot network access only"). Both now use the same list (`br`, `ap`, `swlan`, `usb`, `rndis`, `ecm`, names with `-` such as `br-lan` included), and private subnets from /8 to /30 are accepted (was /16).
- **Root helper: a failing script no longer blocks root for 45 s.** The "su refused" check matched words like "permission" or "not found" anywhere in the output; it now matches only su's own message lines. A one-shot command whose output passes 1 MiB now says so.
- **404 pages carry the security headers.** The notification channel is created once. Unused code removed (`setAdminPassword`, `clearAdminPassword`, `lanAccess`, `RootShell.isRoot`).
- Docs: `AUDIT.md` marks the old loopback statement as superseded and lists the build notes (targetSdk 28 / foreground service type, debug-key fallback).
- Not done: shared screen settings per viewer, plain-HTTP banner on the login page.
- Not compiled and not tested on a real device.

## 1.2.27 - Fixes: plugin erase safety, upload limits, audit log, keystore, updater links
- **Plugin delete with "erase" no longer follows symlinks in parent folders.** Every folder between `/data/local`, `/sdcard` or `/storage/emulated/0` and the path is tested with `[ -L ]` first; if one is a link the path is skipped (`SKIPPED <path>` in the log, reported as not fully erased).
- **A plugin can only erase its own data folder.** Declaring another plugin's `plugin_data/<name>` or anything under `matchitool/plugins/` is now refused (`checkPluginDataPath(path, pluginName)`).
- **Uploads: one at a time, with a free-space check before the body is read.** `/api/upload` and `/api/update/stage` share one slot and refuse when free space minus the announced size is under 200 MB. Previously NanoHTTPD spooled the body first and parallel uploads could fill `/data`.
- **Audit log covers more root-capable calls**: `/api/usb/control`, `/api/update/install`, `/api/imei/apply`, plugin upload, upload, update stage (one line each: time, IP, SHA-256 prefix). Frequent calls (`/api/at`, `/api/at/batch`, `/api/screen/input`) log at most once per minute per client, so they cannot push the important lines out of the 64 KB log.
- **Router password storage: failures are no longer silent.** A saved password that can never be decrypted (Keystore key invalidated, damaged blob) is logged, the dead blob is removed; an invalidated Keystore key is replaced so the re-entered password is encrypted again; a transient Keystore error keeps the blob and `GET /api/zte/config` returns `passwordStorageReset: true` until a new password is saved. A Keystore encryption failure at save time logs a warning before the plain-text fallback. The web page does not show the flag yet.
- **Updater: GitHub links only.** Links and every redirect hop must be on github.com, api.github.com or GitHub's release CDN hosts (new `UpdateLinks`, `UpdateLinksTest`); other https links are refused (upload the APK instead). A GitHub rate limit now says so instead of "HTTP 403", `1.2.26-rc1` is older than `1.2.26` (the number is found anywhere in the tag, so `release-1.2.27` still works; `1.2.27-2` is not a pre-release), and the download connection is always closed.
- Not compiled and not tested on a real device.

## 1.2.27 - Fixes: boot scripts each get their own time limit, home-screen console link
- **Boot tasks: one slow script no longer cancels the rest.** `boot.sh` and every `boot.d/*.sh` ran in one root call with a single 60 s limit, so a script that hung silently killed everything after it and the only trace was a logcat line. Each script now runs with its own 25 s `timeout`; a timeout or a non-zero exit is written to `events.log` (`boot: <file> stopped: no answer within 25s` / `exited with code N`) and the next script still runs. The whole call may now take up to 170 s. A boot script that is meant to keep running must start its work in the background (`... &`) as before. New `scripts/test_boot_tasks.sh` runs the real boot script against a temp folder (slow, failing and following scripts) and is part of `validate.sh`.
- **Home screen: the console link no longer opens the wrong scheme.** Until the web host had finished starting, the address line and the "Open web console" button used `http` while the server could already be `https` (blank page). The line now says "Starting the web console..." and refreshes every second until the host is listening (`Tls.ready`); a tap before that shows "still starting" instead of opening a wrong link.
- Not compiled and not tested on a real device.

## 1.2.27 - Fixes: console start-up race, AT batch results
- **Console start-up: the page scheme is right from the first request.** `Tls.active` was set only after the HTTPS self-test, so the first page loads over https were compared against "http" and refused as "cross-origin request refused" (and the home screen link could open the wrong scheme). It is now set before each server starts listening and again whenever the server is replaced (TLS 1.2 retry, HTTP fallback).
- **Console start-up: a failing `start()` no longer restarts the whole sequence.** Every server start has its own retry (8 tries, 700 ms apart, for a port that is not released yet) instead of landing in an outer catch that looped with a half-stopped server object.
- **Console start-up: no host left behind after the service stops.** `onDestroy()` sets a flag first; a host that was still starting (during the retry sleeps or the self-test) checks it, stops its server and does not schedule another start, so the port is no longer held with no service.
- **AT batch (`/api/at/batch`): results can no longer be cut or forged.** Results were split at the next `##` in the combined output, so a modem reply containing `##` (USSD text, operator names, PDU data) was truncated, and a reply that printed `##AT3` could forge another command's result. Each request now uses its own random 128-bit marker, recognised only at the start of a line (new `AtBatch`, `AtBatchTest`). The web page needs no change.
- Not compiled and not tested on a real device.

## 1.2.27 - Fixes: screen change detection, IMEI keeper at boot, router address, session snapshots
- **Screen view: small changes are no longer missed.** Change detection hashed every 61st byte of the frame, so a blinking cursor, a clock digit or a small icon could change without being seen and the screen looked frozen. The whole frame is now hashed with CRC32 (a few ms for 1-3 MB).
- **Screen view: the PNG fallback skips identical frames and runs gentler.** Without the raw path every loop captured, decoded, scaled and JPEG-encoded a PNG up to 20 times a second even when nothing changed. The screenshot's CRC32 is now compared first (an identical one is not decoded or sent), the pace is at most about 3 captures a second (about 2 a second when idle), so the router stays cooler and status polls are not starved of root slots. The raw path keeps its speed.
- **IMEI keeper now really runs at boot.** The console says "Saved for every boot", but nothing started the keeper. `HostService.runBootTasks()` now runs `ImeiGuard.apply(20, false)` after the boot scripts: it waits up to 60 s for the modem, does nothing when no IMEI is saved, and tries at most 3 times per slot. The result is in logcat (`IMEI keeper: ...`). Changing an IMEI is restricted or illegal in many countries; check your local law.
- **The router address must be a local IPv4 address.** The router admin password is sent to the saved address, and any host name was accepted, so an authenticated user or plugin could point it at an outside server. Only private (10/8, 172.16/12, 192.168/16), link-local (169.254/16) and loopback IPv4 literals, or `localhost`, with an optional `:port`, are accepted now (new `RouterHost`, `RouterHostTest`). A saved host name from an older build falls back to 192.168.0.1: set the IP address again in Router settings if you used a name.
- **A signed-out session can no longer come back after a restart.** Session snapshots were built inside the lock but written outside it, so two threads could write out of order and an older snapshot (with a revoked session) could overwrite the newer one. Snapshots are now saved while holding the lock (`SessionStore.persistLocked`). Two new `SessionStoreTest` cases.
- Not compiled and not tested on a real device.

## 1.2.27 - Hardening: console login lockout
- **Global back-off.** Wrong passwords from all hotspot addresses are now counted together: after 12 in 10 minutes every login attempt, from any address, has to wait 2 s, 4 s, 8 s ... (max 5 min) since the last failure. Changing IP no longer gives fresh tries. A correct login resets it.
- **Per-IP lock grows.** 8 wrong passwords still lock an address for 60 s, but each repeat lock for the same address doubles (up to 15 min); forgotten after an hour. The 429 reply carries `Retry-After` and says how long to wait.
- **Loopback delay is bounded.** Apps on the phone still are not locked out, but at most 4 delayed answers can wait at once (more get 429 at once instead of piling up threads), and the 2 s delay grows to 10 s after 5 wrong passwords in a row.
- **The router is no longer a password oracle.** Console login guesses are forwarded to the router (to learn a changed router password) at most 3 times per address and 3 times per 10 minutes in total, so guessing cannot be tested against the router or trip its own lockout.
- **Root commands need a recent login.** `/api/shell` refuses sessions older than 4 h ("sign in again"); other calls keep the normal 12 h session.
- Not done (design change): a console password separate from the router admin password.
- New `LoginGuardTest`; `SessionStoreTest` covers the session age. Not compiled and not tested on a real device.

## 1.2.27 - Fix: no weak router password on a network hiccup
- **Fix: a timeout or reset while asking the router for its login challenge (`LD`) made the app post the password in the old base64 form over plain HTTP.** The error was swallowed, the challenge looked empty, and the code assumed "old firmware". On newer firmware that login was then rejected, which wrongly started the 60 s "login failed recently" wait and could count toward the router's own lockout. Now a network error (or an HTTP 5xx on the challenge) propagates as "router unreachable", the password is not sent, and nothing is counted as a wrong password. Only a router that answers without an `LD` value is treated as older firmware (base64 as before).
- Not compiled and not tested on a real device.

## 1.2.27 - Fix: the router password search retries after boot
- **Fix: the automatic router-password search gave up for the whole app run if the router web API (or root) was not ready 4 s after boot.** `ZteClient.autoDetect` set its "tried" flag before doing anything and returned on the first "unreachable" answer, so the password was never learned until the app was restarted and the console login depended on typing it. Now an unreachable router or an empty root answer is not final: `autoDetect` returns false and `HostService` calls it again at 4, 30, 90 and 180 s. Only guesses the router actually refused count (max 3 in total), so retries cannot trigger the router's own login lock. A found password, an already saved one, or a definite "nothing worked" ends the search.
- Not compiled and not tested on a real device.

## 1.2.27 - Fix: a new router password / address is used at once
- **Fix: after saving a new router password (or address) in the console, SMS / signal tools kept failing for up to a minute with "Router login failed recently, waiting before trying again".** The cached router session, the 60 s login cool-down and the detected port were never cleared (`ZteClient.reset()` had no callers). `POST /api/zte/config` now calls it when the password or the address actually changed, so the next router call logs in with the new values straight away. An unchanged save does not reset anything.
- Not compiled and not tested on a real device.

## 1.2.27 - Fix: "Tap to re-check" root now really re-checks
- **Fix: after root was refused, tapping "Root access" on the home screen kept showing "Not granted ... not asking again for Ns" for up to 45 s even if root had just been granted.** The cool-down that stops background polls from re-prompting the root manager was never cleared by an explicit retry (`RootShell.resetDenial()` had no callers). The home-screen tap now clears it before checking; the 60 s background refresh still keeps it. `GET /api/root/status?retry=1` does the same for API users; a plain `/api/root/status` keeps the cool-down.
- Not compiled and not tested on a real device (needs a refused-then-granted su on the F50 to confirm).

## 1.2.27 - Fix: the console could fail to start after an update
- **Fix: the web console never came up when the bundled `sendat` could not be overwritten.** On every app update `sendat` was rewritten in place; while an old `sendat` was still running (or storage was full) that failed with "Text file busy" / an IOException inside the `WebServer` constructor, which sat outside the start-retry loop, so the host task ended silently with no retry. `sendat` is now copied to `sendat.new` and renamed into place (works while the old binary runs), a failed copy keeps the old binary and is retried at the next start (the seeded version is only saved after a successful copy), and `HostService` now logs and retries (15 s) if the server cannot be created.
- Checked here: overwriting a running executable fails with "Text file busy", write-to-temp + rename succeeds. Not compiled and not tested on a real device.

## 1.2.27 - Fix: LAN firewall no longer opens the upstream interface
- **Fix: the port-2334 firewall rule was added on every br*/ap*/swlan*/usb*/rndis*/ecm* interface, including the upstream one.** The script that finds the interfaces carrying the default route had its `sed` group and `tr` newline escaped twice (`\\(`, `\\n`), so `sed` matched nothing and the "skip upstream" check never fired. The script is now a raw string (`HostControl.lanFirewallScript`) with single escapes. Checked here with a fake `ip`/`iptables`: with usb0 as the default-route interface, rules are added for br0 and rndis0 only.
- Added `HostControlTest` (regression test for the escaping and the interface list).
- Not tested on a real device.

## 1.2.27 - Bypass: faster and no more "still off" after a click
- **Fix: Bypass looked OFF after Standard / Strong / Off finished, and only showed ON after closing and reopening.** The check right after a click pinged the internet while the mobile link was still resetting, so the dialog showed "No connection / not protected" and kept it until the next check. The rules are now read and painted first; the connection is then tested in the background and retried (up to 4 times, 2.5 s apart), showing "Checking..." meanwhile. A status reply with no data (host busy, link resetting) is retried and never shown as "rules are off".
- **Faster:** the kernel capability probes (TTL target, NFQUEUE, MSS, connbytes: 16 firewall calls) run once and are cached instead of on every refresh; applying a TTL no longer stops and restarts the keep-alive (it only makes sure it runs); the keep-alive lookup uses one `ps` call instead of reading every `/proc/<pid>/cmdline` (falls back to the old scan if `ps` has other columns); no duplicate boot check, no fixed 600 ms sleep, no repeated TTL refresh right after an action.
- **Smoother:** the Boot / Block QUIC switches flip at once, and the status banner shows the current step (Preparing, Applying TTL, Applying Anti-DPI, Finishing).
- Not tested on a real device.

## 1.2.26 - Root and console hardening (from the root review)
- **Root: a spare lane for short commands.** Up to 3 root shells (was 2); jobs longer than 30 s may use at most 2 of them, so one long job plus another request no longer makes the status polls fail with "Root command capacity reached". The root call limit is now 180 s, so the IMEI keeper's 150 s request is honoured (the web console's own calls still stop at 120 s).
- **Root: a plugin command that reads stdin no longer eats the rest of the script.** The script is now handed to `sh` on a separate file descriptor and stdin is `/dev/null`, so `cat` or `read` in a plugin just gets end-of-file. Checked here with dash and bash.
- **Boot scripts only run from root-owned files.** `/data/local/matchitool`, `boot.sh`, `boot.d` and every `boot.d/*.sh` must be a real file/folder (no symlink) owned by root; if group/other can write to a root-owned entry, that permission is removed first. Anything else is skipped and written to `events.log` as `boot: skipped ...`. If a boot task stops running after this update, check its owner with `ls -l` and `chown root:root` it.
- **Loopback logins:** apps on the device all arrive as 127.0.0.1, so loopback is no longer hard-locked (one app could lock the owner out). Each wrong password from loopback is answered after 2 s instead. Hotspot clients keep the per-IP lockout. This slows guessing from the device; it cannot tell one app from another.
- **Console root commands are logged:** time, client address and a short SHA-256 of the command (never the text) go to `shell_audit.log` in the app's private folder (no root call, works while root is denied; trimmed at 64 KB).
- **Plugins:** the warning now says plugins run commands as root, and adding a new plugin file asks for confirmation (replace and backup import already did).
- **Rollback safety:** before the `pm uninstall -k` fallback the installed APK is copied aside; if the install of the older version fails, the previous version is installed again and the app is started, so the device is not left without the app.
- **BootReceiver** is no longer exported (it still receives the system boot broadcast).
- Not tested on a real device.
- **Console: DNS-rebinding guard.** Every request (page and API) is refused unless its `Host` header is an IP address or `localhost` (optional port). A host name re-pointed at the device is rejected before the Origin check can match it. Open the console by its IP address. New `HostHeaderTest`. Not tested on a real device.
- **Console: visible warning when HTTPS fell back to HTTP.** The page shows an amber "Not encrypted" bar when it was opened over plain HTTP (not on loopback), and the app's address line says "(NOT encrypted)". Login still works, so the console stays reachable. Not tested on a real device.
- **Root: a timeout now stops the work, not just `su`.** Each root script starts in its own process group (`setsid`, with the pid recorded), and on timeout the group is killed, plus a frozen-first walk of the child tree for devices without `setsid`. Covers the shared-shell path and the one-shot path. Not tested on a real device.
- **Root: a denied `su` no longer causes a prompt loop.** When the root shell cannot start and the one-shot `su` also fails like a refusal, the denial is remembered for 45 s and every root call (including the live status polls) answers at once with one clear message instead of asking the root manager again. A successful command or `RootShell.resetDenial()` ends it. Not tested on a real device.
- **Deleting a plugin can erase the data it left behind.** The Delete dialog now lists what will be erased (checked on the device, with sizes) and asks once. Erased: the plugin's own folder `/data/local/matchitool/plugin_data/<name>/`, folders it declares with `// @matchi-data /path` lines, and saved browser settings declared with `// @matchi-localstorage prefix`. Declared paths are checked strictly because the erase runs as root: only inside `/data/local`, `/data/local/tmp` and `/sdcard`, never MatchiTOOL's own folders or boot files, never `Android` or a standard folder like `Download` itself, no `..`, no odd characters; refused paths are shown in the dialog. The erase is written to `shell_audit.log`. New `PluginDataTest`. Details in the README. Not tested on a real device.
- **Fix (CI `validate.sh`): updater rollback restored.** `ApkUpdater` had lost the 1.2.14 rollback code and again refused older builds. An older, signed MatchiTOOL APK is accepted again and installed with `pm install -r -d`; if Android refuses the downgrade, the installed APK is copied aside, `pm uninstall -k` (keeps app data) runs, the older build is installed, and if that fails the copied build is installed again and started. An identical file (same SHA-256) is still reported as "already the latest". The update page offers **Roll back** instead of "refused". Not compiled or device-tested here (no Android SDK).
- **Fix (CPU / heat): Live status polling is slow again.** The automatic refresh had dropped to 3 s / 10 s / 30 s. It now polls every 60 s when cool, 120 s when warm and 180 s when hot or critical (3 s only for the first read). The "Stale" indicator waits for the poll interval plus 45 s, so it no longer flags every slow poll as stale.
- **Fix: HTTPS fell back to plain HTTP at boot** (behavior report: `TLS self-test failed: connection closed`). The host now retries with TLS 1.2 only before giving up on HTTPS, and the self-test log names the exception and its cause. Not compiled or device-tested here (no Android SDK).
- **Fix (security): login body size.** `/api/login` is reachable without a password and read up to 16 MB, and any larger or unknown-length body went to NanoHTTPD's `parseBody`, which writes it to a temp file. Login bodies are now limited to 4 KB, other JSON bodies to 16 MB, and an oversized or invalid `Content-Length` is refused before anything is read. A missing length means an empty body. Not compiled or device-tested here.
- Version 1.2.26 (versionCode 226).

## 1.2.25 - Fix: Bypass came back after Stop because of a keep-alive from the old folder layout
- **Update dialog: same version number no longer means "same file".** The check now compares the SHA-256 of the new APK with the SHA-256 of the APK that is installed. Same version + different SHA-256 is shown as **Different build of the same version** with an **Install update** button and an "Install" confirmation (no more "reinstalls the build you already have"). Only an identical file (same SHA-256) is still called a reinstall. The page now lists *SHA-256 installed*, *SHA-256 new* and *SHA-256 match*. The online check (GitHub release) does the same when GitHub publishes the file's SHA-256. Android installs it with a normal `pm install -r`, so app settings are kept. Not tested on a real device.
- **"Choose File" button looks like every other button.** The grey browser-default file button in the Update, Firmware and Plugins dialogs (and any other file field) now uses the same flat soft button style as the other buttons, with the same hover effect, and the file field matches the other input fields. Style only. Not tested on a real device.
- **Update dialog: the link box is gone.** The long https link field is no longer shown. Check for update / Download & verify use the MatchiTOOL releases link as before (the field is only hidden, nothing else changed). Not tested on a real device.
- **Design polish, same look.** One extra style layer (`ui-polish`, last in the page) refines the dark-navy / blue design without moving anything: the top bar is soft glass with a quieter divider, Sign out is calm grey instead of a bright outline, cards and popups get a faint top highlight and deeper shadow, popup titles get a divider and a clearer size, popup text is a little larger on PC (and the popup slightly wider), key actions (Connect, Install update) are blue while the rest stay flat, logs are easier to read, rows get a gentle hover, and the sign-in card is tidier. Respects reduced-motion. Style only. Not tested on a real device.
- **Root cause (seen in your catch.log):** the device still ran `ttl.sh watch`, `dpi.sh watch` and `nfqws` from the OLD folders `/data/local/matchitool/ttl` and `/data/local/matchitool/dpi`, and `boot.sh` still had the old-path start lines. The 1.2.24 off switch lives in `/data/local/ufi_ttl` and `/data/local/ufi_dpi`, so those old keep-alives never saw it and rebuilt `UFI_DPI` a few seconds after every Remove. `remove`/`stop` only looked for processes under the new paths (and nfqws is started as plain `nfqws`, so its path never matched).
- **Fix:** `remove`, `stop`, `apply` and `start` now also stop old-layout keep-alives, and `remove` kills an old-layout `nfqws` (matched by `/data/local/matchitool/dpi/nfqws` in its command line). The old `ttl.sh` / `dpi.sh` files are replaced with a harmless no-op stub (only when they carry our header), so an old boot line cannot revive them.
- **Boot file:** the old-path start lines are recognised as ours: Remove / Apply / boot toggle delete them together with the new ones, and they are no longer reported as foreign lines.
- **Generic "old leftovers" cleanup, so this cannot happen again for other features:** one registry (`LEGACY` in the page, one entry per feature: old folder, old process patterns, old script header) drives one shared shell routine (`legacy_scan` / `legacy_clean`). Both helper scripts use it on Stop, Apply and start, the Quick setup tab has a new **Clean old leftovers** button (it lists what it found and asks first, and removes only the OLD boot lines, keeping the current boot entry), and the Full report has an **OLD LEFTOVERS** section. When a future version moves a feature's files, add one `LEGACY` entry.
- It only touches what a registry entry names: shells and nfqws whose command line contains an old path, and old scripts that carry our header (replaced by a no-op stub). Anything else, including your own scripts, is left alone.
- Opening Bypass now does a read-only scan and shows a toast when leftovers exist. It never cleans by itself on open, because stopping an old keep-alive can end a boot entry someone still relies on; Stop, Apply, start and the button clean.
- Every cleanup is written to `/data/local/matchitool/events.log` (kept under 64 KB).
- New `scripts/test_legacy_cleanup.sh` (run by `validate.sh`): builds a fake old layout with dummy processes, checks scan, clean, stubs, an unrelated script, a decoy process and a second clean. Passes here.
- **Generic cleanup, improved:** registry entries can now also list old pid/state files (`files`); they are removed only once no old process is left, and the old folder is removed only if it ends up empty. Nothing else in an old folder is touched.
- `legacy_clean` no longer silently skips the caller's parent process, falls back to `chmod 000` (reported as `DISABLED`) when a stub cannot be written, and prints `LEFT <pid>` plus an events.log line for any process it could not stop.
- The registry is validated when the page loads: empty values, quotes, `|`, newlines, or an `oldDir` outside `/data/local/` are rejected instead of corrupting the shell registry.
- Clean old leftovers / Full report now list old pid files too. `test_legacy_cleanup.sh` covers the pid file and a neighbouring file that must survive.
- **Faster cleanup:** `legacy_scan` is one pass over `/proc` with no `ls`, no per-process pipelines, and extra processes only for shells/nfqws; `legacy_clean` scans once and reuses the result instead of scanning four more times. Measured here: about 336 ms -> 145 ms per scan with ~150 extra shells running. The page's Clean button now needs 3 root calls instead of 4 (scan, clean + re-scan in one call, boot-file check).
- **Safer kill order:** old keep-alives are frozen (SIGSTOP) first, then TERM + CONT, then KILL for stragglers, so a watcher cannot restart its sibling while the others are being stopped. (The test passes with the old routine too, so this is a safety margin, not a proven fix.)
- **Dry run:** `LEGACY_DRY=1 legacy_clean` prints `WOULD_KILL` / `WOULD_STUB` / `WOULD_REMOVE` lines and changes nothing.
- Not tested on a real device.
- **Fix: Bypass (F50) dialog was cut off on the right (phone and PC).** A `width:94vw` rule was applied to the full-screen dimmed layer instead of the dialog, so the layer stopped short of the right edge and the toggles and the Close button were clipped. The dimmed layer is full width again, the dialog is `min(100%, 640px)` wide, and the inner cards and the button row can no longer push it wider (the button row wraps). Not tested on a real device.
- **Bottom buttons tidied:** Run check, Copy report, Clean old leftovers and Close now sit in an even grid (2 x 2 on a phone, one row of 4 on a wide screen) instead of one cramped row.
- **One look everywhere:** the Bypass style is now shared by every dialog (AT & Radio, Diagnostics, SMS, Screen control, CPU Governor), popup and card: soft rounded cards, flat rounded buttons, round switches instead of checkboxes, matching inputs, and an even full-width Close button. Colours, borders and radii only; layouts and sizes are unchanged and the Bypass dialog keeps its own rules. Not tested on a real device.
- **Bypass switches and bottom buttons:** the Block QUIC / Auto-apply switches are real pills with a round knob again (a shared button rule had squared them), and Run check, Copy report, Clean old leftovers and Close are small and compact in one wrapping row, on phone and PC. Not tested on a real device.
- **Home screen polish:** the Live device status is smaller and compact (smaller signal and battery icons, tighter radio box, temperature and system tiles in one line each with icon beside text, 2 x 2 system tiles on phones). The Clean memory button now matches the other buttons. The popups at the top (toasts) are a flat dark panel with a thin even border in the message colour (green, blue, amber, red): no tint, no thick side bar, no shadow, everywhere. Not tested on a real device.
- **Popups at the top now stay 4 seconds** (one setting, `TOAST_MS`, next to `createToast`), including the ones that used to stay 8 to 12 seconds.
- **A little more room at the left and right** of every dialog (20 px outside and inside, the footer follows) and a slightly narrower popup card on phones, so nothing sits against the screen edge.
- **Live status data:** the CPU line is read even when the shell output has trailing spaces or a carriage return, and 5G RSRQ / SINR (and RSRP) also fall back to the `csi*` values from Android telephony when the router API and `ss*` values are empty. Not tested on a real device.
- **Live device status:** the "Live · updated N s ago" indicator is removed (the data still refreshes by itself).
- **Auto refresh switch** in the Live device status header (on by default, remembered in this browser). Off: the status is read once and stays as it is; turning it on reads it again right away. Not tested on a real device.
- **Live refresh switch label:** the switch in the Live device status header now reads "Live refresh: On / Off" so the state is visible at a glance. Not tested on a real device.
- **Fix: Bypass showed "Failed", "No internet", TTL "Not active" right after tapping Standard, but was fine after reopening.** Applying TTL can reset the mobile link for a moment, so the next step (turning Anti-DPI off) and the status check failed with "Cannot reach MatchiTOOL host" although Standard had been applied. Standard / Strong / Off (and the QUIC and boot switches) now wait and retry (up to 8 x 1.5 s) when the host is briefly unreachable. Every other call fails fast, so the buttons stay quick. Not tested on a real device.
- **Bypass is faster (fewer root calls, no behaviour change):** helper scripts that were just verified are no longer rewritten to the device on every Standard / Strong / Off / Apply (saves 2 large calls per tap); checking a helper and its keep-alive is one call instead of two; the full internet check pings the internet and DNS at the same time (about half the time when offline); the background check stops after the TTL read when you tap a button. Not tested on a real device.
- **CPU Governor is smoother (no behaviour change):** the 3 s read uses the shell's built-in `read` instead of about 50 `cat` processes; a mode / speed / core change and the read-back of the new state are one root call instead of two; a read that was already running when you changed something can no longer overwrite the new state; core buttons and lists are updated in place instead of rebuilt every 3 s, so a tap is not lost; Save for boot reuses the state read in the last 4 s. Tested here against a fake CPU folder only, not on a real device.
- **Network Diagnostics is faster:** the gateway, IPv4, IPv6 pings and the DNS lookup now run at the same time instead of one after another (tested here with a fake ping: 2 s instead of 6 s). Same results and wording. Not tested on a real device.
- Version 1.2.25 (versionCode 225).

## 1.2.24 - Fix: Bypass turned itself on again after being turned off
- **Root cause 1 (most likely what you saw):** the **Remove** buttons (TTL and Anti-DPI) only deleted the firewall rules. The "Auto-apply at boot" entry stayed, so the next restart of the device or of MatchiTOOL started the keep-alive again and it rebuilt everything (the old toast even said so). **Remove now turns the whole helper off**: rules, keep-alive, nfqws and the boot entry.
- **Root cause 2:** if the boot file had been changed by something else, MatchiTOOL refused to edit it, so Stop could not remove the boot entry and the rules came back at the next start. Both helpers now have an **off switch** (`/data/local/ufi_ttl/disabled`, `/data/local/ufi_dpi/disabled`) written first by `remove`. While it exists, `start`, the boot line and the keep-alive do nothing. Pressing **Apply / Strong / Standard** (or turning boot auto-apply on) lifts it.
- **Root cause 3:** a keep-alive whose pid file was lost (for example after a helper update) could not be stopped, and kept re-applying the rules. `stop` and `remove` now also stop every keep-alive of ours found in `/proc`.
- **Root cause 4 (seen in your report: saved settings say QUIC/NFQ off, but the queue rule and nfqws were still running, with no pid file):** `stop_nfq` only knew the nfqws from the pid file, so an orphan nfqws survived, kept queue 200 busy (new nfqws exits at once) and kept working. nfqws processes of ours are now found and stopped by name and path (only a process called `nfqws` that runs `/data/local/ufi_dpi/nfqws`). Switching nfqws off now **checks** that the NFQUEUE rule and the process are really gone and rebuilds from scratch if a failed swap kept the old chain.
- **Remove is verified:** both `remove` commands retry up to 3 times and fail loudly (with a message) if rules, eBPF filters or nfqws are still present, instead of reporting success.
- Full report now shows `off switch: ON / not set`.
- Tested here: both helper scripts (extracted from the page) with dummy processes: orphan nfqws and a keep-alive with a lost pid file are killed by `remove`; `start` does nothing while off; `enable` + `start` works; setting the switch stops a running keep-alive within one cycle; `apply` lifts the switch. `scripts/validate.sh` passes. **Not tested on a real device** (no iptables/tc here).
- Version 1.2.24 (versionCode 224).

## 1.2.23 - Fix: phone view off-centre, Reboot button cut on the right
- **Root cause (found by reproducing it with phone emulation):** the top bar (logo, host status, Sign out, Reboot) was forced onto one line and was about 8 px wider than a 390 px screen. The Reboot button was cut ("...ot"), and the browser widened the whole page to fit, which pushed windows and the dimmed layer off-centre.
- **Fix:** the host status pill can now shrink (its text gets an ellipsis), the bar is capped at the screen width with slightly tighter spacing on phones, and on screens narrower than 340 px the bar wraps instead of overflowing.
- Version 1.2.23 (versionCode 223). Checked at 320, 360, 390 and 412 px wide; `scripts/validate.sh` passes; nothing device-tested.

## 1.2.22 - Fix: tool windows off-centre, dimmed layer cut short on the right
- Reported on a desktop browser with page zoom active: the dark layer behind a tool window (seen with Bypass) covered only about 94% of the width, so the window sat left of centre and the right edge looked cut. The cause could not be reproduced here (full width at 80-125% zoom), so the layer is now sized to the whole window explicitly (`left:0; top:0; width:100vw; height:100dvh`) instead of relying on `inset:0` alone, and the page width is capped at 100%. The same applies to every window (CPU Governor, SMS, Bypass, confirm boxes).
- Version 1.2.22 (versionCode 222). `scripts/validate.sh` passes; nothing device-tested.

## 1.2.21 - Review fixes (Change IP, CPU Governor)
- **Change IP: wrong "public IP".** Any output with dots (an HTML error page, a proxy message) was accepted as the answer, so the curl-plain and wget fallbacks never ran. Only a clean `a.b.c.d` answer counts now.
- **Change IP: long wait before the switch.** The "old IP" lookup used the full retry chain and could hold the button for over a minute on an offline device. It is now one short attempt (about 10 s at most).
- **Change IP: timeout too short for the worst case.** The public IP lookup could outlast its 45 s limit, which kills the shared root shell session. The limit is now 90 s for the full lookup and 25 s for the quick one.
- **CPU Governor: Manual mode showed a speed that was not applied.** After switching a cluster to Manual, the list showed the lowest speed selected though nothing was locked. It now shows "Choose a speed" until you pick one.
- **CPU Governor:** the CPU tile keeps its normal height (the hint lives in the footer); core toasts use the L1..B4 names shown in the window.
- **Host:** the `boot.d` loop ends with `true`, so a skipped file cannot make the boot task log "not completed".
- README: Live status is no longer described as fully read-only; CPU Governor and Change IP are documented, with how to remove a bad boot file; the tool count is corrected to eight.
- Checked in a browser against a mock host (no console errors): CPU window open, Manual mode and speed, core off, Save/Remove for boot, Change IP with toasts.
- Version 1.2.21 (versionCode 221). `scripts/validate.sh` passes; nothing device-tested.

## 1.2.20 - Change IP built in
- **New home button "Change IP"** (embedded as `Change_IP.js`, now a reserved plugin name; the page embeds 8 tools). It turns mobile data off and on to get a new carrier address, then shows the local WAN IP and the public IP, with the old one for comparison. Hotspot clients lose internet for a few seconds.
- Differences from the Change_IP v1.2 plugin: the local address is the one Android routes the internet through (the old `10.x` guess is the fallback); the public IP check tries curl (DNS-over-HTTPS, then plain) and falls back to wget, because curl is not bundled; it waits for the old link to drop before re-enabling; double taps are ignored; a "same IP" result is flagged. Root check uses `id -u`.
- If you uploaded the old Change IP plugin, delete it in Plugins (two buttons would appear).
- Version 1.2.20 (versionCode 220). Page script and `scripts/validate.sh` checked; nothing device-tested.

## 1.2.19 - CPU Governor in Live status
- **Tap the CPU tile in Live device status to open the CPU Governor window**: turn each of the 8 cores on or off, set the mode (governor) per cluster (Little 0-3, Big 4-7) and, in Manual (userspace) mode, a locked speed. Changes apply at once and are checked by reading the value back.
- **Save for boot / Remove from boot** write or delete a separate file, `/data/local/matchitool/boot.d/10-cpu.sh`. `boot.sh` and Bypass's boot check are not touched.
- **Host:** after `boot.sh`, the boot task now also runs every regular `*.sh` file in `/data/local/matchitool/boot.d/` in name order (symlinks skipped).
- Live status is no longer purely read-only: only this window writes, and only when you change something. Polling pauses while it is open; the window refreshes itself every 3 s.
- Version 1.2.19 (versionCode 219). Kotlin change not compiled here (no Android SDK); page scripts and `scripts/validate.sh` checked; nothing device-tested. The default frequency lists are placeholders for devices that do not report `scaling_available_frequencies`.

## 1.2.18 - Stability: health pings
- **Host health ping now has an 8 s deadline and never overlaps.** Before, a ping to a host that was busy or hung waited forever, and a new one was sent every 15 s on top of it. Browsers allow only a few connections per host, so stuck pings could block real requests (buttons that seem to do nothing, "Host disconnected" that never recovers). One ping runs at a time and a stuck one is cancelled.
- Bypass's button re-attach check no longer runs while the tab is hidden.
- Reviewed and left unchanged: root shell (bounded output, 2 sessions, idle close), router client (timeouts and locking), service start/retry, Bypass boot and keep-alive logic. All already bounded.
- Version 1.2.18 (versionCode 218). Page change only; `scripts/validate.sh` passes; nothing device-tested.

## 1.2.17 - Bypass (F50) built in
- **Bypass (F50) v65.14 is embedded in the page again** (as `Bypass.js`, like the other built-in tools), so it no longer has to be uploaded and cannot be damaged by an upload. Its button appears on the home card; the rules, helper scripts and `/data/local/matchitool/boot.sh` entry are the ones the plugin already used. All non-ASCII characters in the code are written as `\u` escapes.
- `Bypass.js` is now a reserved plugin name, and Full diagnose has a Bypass check (root shell, `tc`, `iptables`; read-only, it changes no rules). The page embeds 7 tools.
- **If you uploaded Bypass before:** that copy is not loaded any more (it would give a second button and second timers). A toast reminds you; delete it in Plugins.
- Includes the 1.2.16 UTF-8 fix for plugin uploads.
- Version 1.2.17 (versionCode 217). Kotlin change not compiled here (no Android SDK); page scripts and `scripts/validate.sh` checked; nothing device-tested.

## 1.2.16 - Fix: plugin text garbled after upload (Bypass showed "?" boxes)
- **Root cause:** the page posted JSON with `content-type: application/json` (no charset) and NanoHTTPD 2.3.1 decodes such a body as US-ASCII. Every non-ASCII character in an uploaded plugin (`●`, `·`, `…`, `—`, `✓`) was saved to the plugin file as U+FFFD, so Bypass (F50) showed boxes in its status line, pills and self-test. Built-in tools were not affected because they are embedded in the page.
- **Fix (host):** `body()` now reads the raw request bytes and decodes them as UTF-8; the page sends `charset=utf-8`; JSON responses declare `charset=utf-8`. This protects every plugin and any other JSON field, not only Bypass.
- **After updating:** a plugin that was uploaded with the old build is already damaged on disk. Delete it in Plugins and upload it again.
- Version 1.2.16 (versionCode 216). Kotlin change not compiled here (no Android SDK); page script and `scripts/validate.sh` checked.

## 1.2.15 — Plugin host compatibility (UFI-TOOLS plugins)
- **Fix: root commands could not write files larger than 1 MiB.** The root shell applied `ulimit -f 2048` to everything a command started, so plugin downloads, installs, backups and archive extraction died at 1 MiB. The cap is now 2 GiB (runaway-writer protection only) and the returned output is still bounded (`head -c`, 1 MiB capture limit unchanged).
- **File upload/download for plugins:** `POST /api/upload` (multipart field `file`, also reachable as `/api/upload_img`) stores a file in the app's `uploads` folder (max 512 MB per file, 1 GiB total); `GET /api/uploads/<name>` streams it back and `POST /api/uploads/delete` removes it. Names are sanitised to `[A-Za-z0-9._-]`.
- **Page helpers expected by UFI-TOOLS plugins:** `showModal`/`closeModal` accept `#id`; new `createFixedToast`, `requestInterval`, `uploadFileKano`, `downloadUrl`, `KANO_baseURL`, `common_headers` and `window.UFI_DATA.lan_ipaddr` (filled from the router API, falling back to `br0`, only when an enabled plugin exists). Existing functions and the built-in tools are unchanged.
- Not changed: the boot file stays `/data/local/matchitool/boot.sh` (the UFI boot file under `/sdcard` is deliberately NOT executed: any app can write there), and no `curl` is bundled.
- Version 1.2.15 (versionCode 215). Web page tested in a browser against a mock host; Kotlin changes not compiled here (no Android SDK) and nothing device-tested.

## 1.2.14 — OTA: check first, reinstall and rollback allowed
- **Check, then Download.** The over-the-air box now starts with **Check for update**. It only asks what is online (for a GitHub release link: the release tag, file size and SHA-256 when published; for other https links: file size) and downloads nothing. When a build is found the same button turns into **Download & verify**; changing the link puts it back to Check. Download still runs every safety check on the real file.
- **Same version and rollback are allowed.** The updater no longer refuses the same build or an older one. The page says which it is (update, reinstall, or rollback) and the install button and confirmation match. Package name and signing-key checks, the SHA-256 confirmation and the 10-minute window are unchanged.
- **Rollback install:** older builds use `pm install -r -d`; if Android still refuses the downgrade (non-debuggable app), the APK is copied aside, `pm uninstall -k` (keeps app data) runs, and the older build is installed in its place.
- **Fix:** after installing, the page decided success by comparing version text, so a same-version reinstall was reported as done instantly. It now also watches the package's last-update time and version code.
- New `POST /api/update/check`; `/api/update/status` returns `lastUpdate`; stage/fetch results include `relation` (newer / same / older).
- Version 1.2.14 (versionCode 214). Not compiled or device-tested (no Android SDK here); `scripts/validate.sh` passes.

## 1.2.13 — Tools merged into Live device status
- Removed four tools: **Smart F50 Monitor**, **Device status**, **Network debug** and **Signal info** (home buttons, embedded scripts, Full diagnose checks and reserved plugin file names). The page now embeds 6 tools.
- **Live device status** gained the useful parts of the two monitors: CPU usage, memory used, load average and uptime. They come from the same single root-shell call it already makes (no extra processes per thermal zone), at the same thermal-aware refresh rate. CPU % needs two samples, so it shows "—" until the second refresh.
- Not carried over: per-interface network rates and the full per-thermal-zone list. Battery, system-max and modem temperatures stay as before.
- Full diagnose: the Live Status check now also verifies that /proc (CPU, load, memory) is readable.
- Version 1.2.13 (versionCode 213). Not device-tested.

## 1.2.12 — Bypass removed
- The Bypass (F50) tool is removed: its home button, its embedded script (the page is about 200 KB smaller), its Full diagnose check and its reserved plugin file name. The page now embeds 10 tools.
- **Not touched on the device:** TTL/DPI rules and any `/data/local/matchitool/boot.sh` created by Bypass stay as they were, and the boot receiver still runs that file if it exists. Delete or edit it by hand with `su -c` if you want those rules gone. Full diagnose still has a "Boot script health" check for it.
- Version 1.2.12 (versionCode 212).

## 1.2.11 — Same compact buttons on phones
- Phone view (760 px and narrower) now uses the same compact buttons as the PC console: 28 px tall, centered text, and text size that scales with the screen width (9.5-12 px). A long label such as "Network Diagnostics" or "Smart F50 Monitor" wraps onto two lines inside its box instead of being cut off. Still 3 columns.
- Version 1.2.11 (versionCode 211). CSS only; not device-tested.

## 1.2.10 — Compact 3-column buttons on PC
- In the two-column PC console the button panel is now 3 columns (was 2) with smaller, tighter buttons. The button text scales with the window width and wraps inside its box when a label is long, so nothing is cut off. The panel width adjusts to the window (380-460 px). Phone view is unchanged.
- Version 1.2.10 (versionCode 210). CSS only; not device-tested.

## 1.2.9 — Two-column PC console
- On screens 1000 px and wider the console is now two columns: the compact buttons in a left panel and the live device status filling the right, instead of one very wide stretched strip. The version line stays fixed at the bottom of the window on wide screens. Screens 900-999 px keep one column with compact buttons; phone view (760 px and narrower) is unchanged.
- Version 1.2.9 (versionCode 209). CSS only; not device-tested.

## 1.2.8 — Version footer
- The web console now shows the installed app version and the web page version at the bottom of the page. If the two differ (an old page cached after an update), the footer turns amber and tells you to reload with Ctrl+F5.
- Version 1.2.8 (versionCode 208). Web page only; not device-tested.

## 1.2.7 — Full-width compact console on PC
- On wide screens (900 px and up) the web console now uses the full window width. The buttons are small and compact and wrap into as many columns as fit; the live status card stretches across the page with moderate text sizes. Phone view (760 px and narrower) is unchanged.
- Version 1.2.7 (versionCode 207). CSS only; not device-tested.

## 1.2.6 — Wider console on PC
- On wide screens (900 px and up) the web console is now 1040 px wide instead of a narrow 640 px strip: 5 button columns, larger buttons and larger live-status text. Phone view (760 px and narrower) is unchanged.
- Version 1.2.6 (versionCode 206). CSS only; not device-tested.

## 1.2.5 — Compact console on phones
- Phone view (up to 760 px wide) now matches the compact desktop look: 3 small button columns instead of 2, tighter box padding, and the Live device status keeps its single-row signal / operator / battery layout instead of stacking. Popups unchanged.
- Version 1.2.5 (versionCode 205). CSS only; not device-tested.

## 1.2.4 — Compact console
- The web console box is narrower (max 640 px) and compact: the home buttons are small and in 3 columns (2 on narrow phones), and the Live device status card has tighter padding and smaller numbers. Popups are unchanged.
- Version 1.2.4 (versionCode 204). CSS only; not device-tested.

## 1.2.3 — Update fix: "The APK has no valid signature"
- **Cause:** a release build made without the keystore (local build, or CI without the `MATCHI_KEYSTORE_B64` secret) came out as `app-release-unsigned.apk`, an APK with no signature at all, so the update check refused it. 1.2.2 made release the published build type, which exposed this.
- **Build:** release builds now fall back to the debug key when the keystore is missing, so they are never unsigned (such an APK still cannot update an install signed with the permanent key; that case gets the "Signature mismatch" message instead). The release workflow still refuses to publish without the permanent key.
- **Updater:** if Android returns no signer for the new APK or the installed app with the modern lookup, it now retries with the older `GET_SIGNATURES` lookup. The error text now says what is wrong: an unsigned APK (with how to get a signed one), an unreadable signature, or a different key, and how to install by hand with `su -c 'pm install -r <file>'`.
- Version 1.2.3 (versionCode 203). Not yet compiled or device-tested.
- **To get past the error on the device you have now:** the *installed* app does the check, so the new updater code only helps the update after this one. Install a properly signed APK (built with the keystore), or install by hand: `su -c 'pm install -r /sdcard/Download/MatchiTOOL.apk'`.

## 1.2.2 — P0 security and release fixes
- **Per-login sessions.** The web console no longer hands out one permanent access token. Every sign-in gets its own random 256-bit token that ends after 2 h idle, after 12 h in any case, on the new **Sign out** button (`POST /api/logout`), or when the router/admin password changes (other sessions only; the changing session stays). Only SHA-256 hashes of tokens are kept, in private preferences, so a host restart or OTA update does not sign you out. At most 16 live sessions (oldest dropped).
- The old permanent token is deleted on first start and is **no longer accepted as a password**; sign in with the router admin password. Browsers that still hold the old token are sent back to the sign-in card.
- **Release builds.** The release workflow now builds and publishes `assembleRelease` (not debuggable, signed with the permanent key) and refuses to publish an APK that is debuggable or fails `apksigner verify`. `isDebuggable = false` is explicit; lint no longer rejects the deliberate `targetSdk 28`.
- **Build/test groundwork.** Added JVM unit tests for the session logic (`SessionStoreTest`), a unit-test step in both workflows, a debug + release build in the CI workflow, `scripts/bootstrap-build.sh` (creates the Gradle wrapper; run once with internet) and the 1.2.2 testing notes (file not kept in the repository). CI uses `./gradlew` when it exists.
- Version 1.2.2 (versionCode 202). Not yet compiled or device-tested.

## 1.2.1 — HTTPS, compact UI
- The web console is now served over **HTTPS** on port 2334 with a self-signed certificate created on the device by Android's key store (the private key never leaves it). Open `https://<device ip>:2334`; the browser shows a one-time "not trusted" warning because no public authority can certify a private IP address. If TLS cannot work on a device, the host checks itself at start-up and falls back to plain HTTP.
- Compact Plugins popup (built-in tools list removed), compact style for all popups and the sign-in screen, the stray "\n" on the sign-in screen removed.
- Update box is prefilled with the public releases link; SMS delete failures now show the reason.

## 1.2.0 — Stability-first integration
- Added bounded, on-demand Advanced Network Diagnostics for IPv4/IPv6 addresses and routes, gateway reachability, public IP reachability, and DNS resolution. Checks are read-only and do not rewrite network state.
- Added Smart F50 Monitor: on-demand read-only CPU, memory, battery, thermal-zone, load, uptime, and per-interface network-rate telemetry.
- Monitor polls only while open and visible, slows polling at elevated temperatures, and never changes CPU/GPU clocks, charging controls, or vendor thermal services.
- Added explicit telemetry caveats: modem sensor availability is firmware-dependent; temperature thresholds are advisory and do not claim confirmed hardware throttling.
- Preserved existing root concurrency/output limits, network access restrictions, Bypass implementation, SFP filters, plugin bridge, and existing tools.
- Bumped Android versionCode to 200 and web page version to 1.2.0.
- Added static validation for the new monitor and version metadata.

# MatchiTOOL Changelog

## 1.1.54 stability patch 1 — bounded root output
- Added a best-effort 1 MiB file-size ceiling to persistent root-command output capture, complementing the existing in-memory output and queue bounds.
- Root command results now explicitly report when output is truncated by the capture limit.
- Kept command execution, root-manager authorization, network/bypass rules, thermal policy, and app version metadata unchanged.
- Runtime validation on the ZTE F50 is still required; Android shell implementations may differ in `ulimit -f` support.


## 1.1.53 - ZTE F50 thermal-aware efficiency
- Live Status now caches modem AT reads for 60 s when the router API is unavailable, reducing repeated modem wakeups.
- Device telemetry polling now backs off from 45 s to 90 s and 120 s as reported battery, modem, or system temperatures rise.
- Added a compact advisory banner for warm/hot/critical readings with conservative cooling guidance.
- Kept thermal thresholds advisory only: no CPU governor, clock, voltage, charging-limit, fan, or thermal-daemon changes are made. Firmware thermal throttling and shutdown protections remain untouched.
- Version updated to 1.1.53 (versionCode 163).

## 1.1.52 - Root integration reliability
- Added a read-only root status model with effective UID, resolved `su` path, and best-effort Magisk/KernelSU/APatch detection.
- Native home screen now reports the detected root manager and a concise grant failure detail.
- Added authenticated `GET /api/root/status` for the web console and trusted plugins.
- Root shell sessions now close their streams and are retired cleanly when HostService shuts down.
- Web ping now reads the installed app version instead of returning a stale hard-coded value.
- Kept root authorization under the installed `su` manager; no exploit, boot-image patching, or automatic flashing was added.

## 1.1.49 - Built-in app review and safety clarity
- Updated the built-in Bypass asset revision to v65.14 (carried forward from the compatibility update).
- Added a plain-language unencrypted-HTTP warning to the native LAN access status and web-console login screen.
- Corrected the source validation script to locate the current embedded Bypass filename instead of assuming v65.13.
- Aligned README network exposure, tool count, and install instructions with the actual 1.1.48/1.1.49 service behavior.
- Clarified that the service explicitly binds to `0.0.0.0` for ZTE hotspot/USB-tether companion access, while API routes apply source-subnet checks.
- Updated Android versionName to 1.1.49 and versionCode to 159.


## 1.1.48 - Security and lifecycle hardening
- Router admin credentials are now encrypted at rest with an Android Keystore AES-GCM key. Existing installations migrate the legacy preference transparently on first read; if Keystore encryption is unavailable, the legacy storage fallback preserves compatibility.
- Web API and HTML responses now include defensive browser headers; API responses are explicitly non-cacheable. Cross-origin API requests carrying an Origin header are rejected while same-origin page and plugin calls remain supported.
- Root command execution rejects NUL bytes and scripts over 128 KB at the backend boundary, in addition to the web API request validation. Root session pool release/removal is synchronized to avoid a session being handed out while it is being retired.
- HostService startup work is deduplicated; router auto-detection and firewall checks use a bounded scheduled executor, boot tasks cannot overlap, and service shutdown stops workers and the web server.
- LAN firewall opening now discovers matching bridge/AP/USB/RNDIS/ECM interface names rather than assuming only br0/usb0/rndis0/ecm0. Existing LAN web access and ZTE F50 support are retained.
- Version metadata updated to 1.1.48 (versionCode 158).
- HTTP remains unencrypted for existing LAN compatibility. Do not expose port 2334 beyond a trusted hotspot/USB-tether network; use a trusted VPN/tunnel when remote access is required.

# Changelog

## 1.1.47 - Permanent signing key + OTA update
- **Fixes "Update rejected: Signature mismatch".** All builds (debug and release) are now signed with one permanent keystore (`keystore.properties` locally, GitHub Secrets `MATCHI_KEYSTORE_B64` and `MATCHI_KEYSTORE_PASSWORD` in CI). Before, every CI build used a random debug key, so no build could update another.
- **OTA update:** in the web console, Update app, paste an https link to the APK (e.g. a GitHub release asset); the device downloads it (max 120 MB, https only, redirects stay on https) and applies the same checks as an uploaded file: same package, newer versionCode, same signing key, SHA-256 confirm. New route `POST /api/update/fetch`.
- One-time step: the installed 1.1.46 has a different key, so reinstall once with a 1.1.47 APK signed by the new key; later updates then work in place.

## 1.1.46 - Cooler running: lighter Live Status
- **Root cause of the heat:** the Live device status panel on the web console home page ran every 10 s. Each run started about 80 root processes (one `cat` per thermal zone and per zone type, plus `dumpsys battery`) and sent four modem AT commands even when the router API already supplied the same data.
- Thermal zones and battery are now read with shell built-ins only (`read`, no forks), and battery level, temperature and status come straight from `/sys/class/power_supply/battery` instead of `dumpsys battery`.
- Modem AT commands and the heavy `dumpsys telephony.registry` are used only when the router API gives no data (fallback); the telephony dump is refreshed at most every 2 minutes.
- Refresh interval is now 30 s (60 s when any system temperature is 60 C or more) instead of 10 s; the page still pauses while hidden or while another tool window is open.

## 1.2.27 - Lighter app home screen
- Removed the LIVE SIGNAL card (bars, dBm, operator, RSRQ, SINR, battery) from the app home screen. The home screen now refreshes only host state and root access, so the router API is no longer polled every 15 s. The web console's Live Status and Signal Info tools are unchanged.
- Removed the now-unused signal reader and signal-bars view, plus three unused icons.
- The web console page is read once and cached in memory (ETag; NanoHTTPD does the gzip); heavy blur effects removed.

## 1.1.45 - Safe update import in the web console
- **New "Update app" button** in the web console (Device overview). Choose a newer MatchiTOOL APK; the host checks it before anything is installed.
- **Safety checks (on the device):** real ZIP/APK, max 120 MB, same package name, strictly newer versionCode (no downgrade or same-build reinstall), signed by the same key as the installed app (key-rotation lineage accepted). You see the version, size and SHA-256 and confirm in the page.
- **Tamper guard:** the upload is staged in the app's private cache; the install request must quote the exact SHA-256 that was shown, must come within 10 minutes, and the staged file is re-hashed and re-verified right before install. Only one file is staged at a time.
- Installed with `pm install -r` through the root manager (never `-d`), so Android checks the signature again. The page waits for the new version to answer; the installer output is in `/data/local/tmp/matchi_update.log` and shown if the update stalls.
- **Light on the router:** the upload is moved into place instead of copied again, read once for the hash and parsed once for the signature, runs at background priority, and the root installer runs at low priority (`nice`). While waiting, the page asks only for the version every 4 s (no root command); the installer log is fetched only after 45 s.
- **Cleans up after itself:** the staged APK is deleted as soon as the install ends; after a successful update the installer log and old root temp files are removed too (on failure the log stays so you can see why). Stale upload files are also cleared whenever the host starts. Settings, token, plugins and saved IMEI data are never touched.
- **LAN by default:** the web console now listens on the LAN from the first start (no switch needed). Only private/local source addresses (192.168.x, 10.x, 172.16-31.x, link-local, loopback) are accepted; public addresses are refused. **Local-only mode is removed:** the LAN switch and the local-only setting are gone (the home screen shows LAN access as always on); an old saved choice is ignored. The unused Access & Security screen was deleted.
- **Reachable from devices on the ZTE:** in LAN mode the host adds (once, best effort, needs root) an INPUT firewall accept rule for port 2334 on the hotspot/USB interfaces only (br0, usb0, rndis0, ecm0; never mobile data) at start and again 30 s and 90 s later, in case the firmware rebuilds its firewall. Open `http://192.168.0.1:2334` (the router address shown in the app) from a phone or PC on the ZTE Wi-Fi.
- **Works with only your phone connected:** the home screen's Open web console button now opens `127.0.0.1:2334` (always valid on the device running MatchiTOOL), and the address shown for other devices is read from the network interfaces (hotspot/Wi-Fi/USB-tether private IPv4) instead of the Wi-Fi client info, which is empty when the device is the hotspot.
- **Hotspot only:** the web console answers only this device (127.0.0.1) and clients inside the ZTE's own hotspot / USB-tether subnet (taken from the br*, ap*, swlan*, usb*, rndis*, ecm* interfaces; fallback: the /24 of the router address). A device on another Wi-Fi, mobile data or the internet gets 403 'ZTE hotspot network access only', even if it can reach the port.
- New routes (all need the session token, like every other API): `POST /api/update/stage`, `POST /api/update/install`, `GET /api/update/status`.

## 1.1.44 - Screen control fills the phone screen
- **No more scrolling to reach the buttons.** The Screen control window now takes the whole visible height (phone or PC), the picture takes all the space between the title and the buttons, and the buttons and quality row stay in view at the bottom with Close.
- **Bigger and centred.** The picture is scaled to the biggest size that fits with the screen's own proportions, centred in the window. It refits by itself when the phone is turned, the browser bars appear or hide, or the keyboard opens. Taps and swipes still land on the right spot.
- The seven buttons (Back, Home, Recents, Wake, Power, Vol -, Vol +) are in one row.

## 1.1.43 - AT & Radio: Apply button
- **New Apply button** next to the AT command box. It sends what is in the box, exactly like pressing Enter.
- If the box still holds the placeholder `AT+SPIMEI=<slot>,"NEW"`, nothing is sent: the window asks you to type the 15-digit IMEI over NEW first.

## 1.1.42 - AT & Radio: IMEI box removed, Change IMEI button
- **Removed the IMEI box** (the IMEI read-out, the new-IMEI field, Change IMEI, Restore first-seen and Apply saved IMEI now).
- **New "Change IMEI" button** next to NR bands. Pressing it puts `AT+SPIMEI=0,"NEW"` in the AT command box (the slot number follows the SIM slot you picked) with NEW selected. Nothing is sent until you type the IMEI over NEW and press Enter.
- The line that was at the top of the window is gone (the button replaces it).
- Note: an IMEI written this way is no longer backed up first, so read it with the **IMEI** button (`AT+CGSN`) and write it down before you change it.

## 1.1.41 - Type into the device from Screen control (like scrcpy)
- **Keyboard forwarding.** Click the picture on a PC (or press **Keyboard** on a phone) and type: the text is sent to the device exactly as typed, including quotes and symbols, for example `AT+SPIMEI=0,"NEW"`. Enter, Backspace, Tab, Delete, the arrow keys, Home and End are sent as keys; Esc = Back. Pasting also works. There is no visible text box (it stays removed); the window shows a one-line note instead.
- Letters typed quickly travel together in one command, so typing does not lag. Remote typing now accepts every printable ASCII character except `%` and `\`.
- Note: this types into whatever app is open on the F50's own screen. AT commands for the modem itself are still sent from the **AT & Radio** window.

## 1.1.40 - Smoother screen control on phones, AT line on top
- **Screen control feels instant on a phone.** A ring now follows your finger / pointer at once (and pulses on a tap), so you see your touch before the device reacts. Frame text is updated twice a second instead of on every frame, and the picture is drawn on an opaque low-latency canvas.
- **Auto quality (new default).** The picture size and JPEG quality step up and down by themselves, depending on how fast frames download and draw on that device: a phone on weak Wi-Fi settles lower, a PC on a cable settles higher. Low / Medium / High are still in the list.
- **Reaction after a tap shows at once.** After every tap, swipe or key the host captures at full speed for about 2 s and wakes its capture thread immediately, instead of looking only 4 times a second while the screen seems idle.
- **Lighter host.** The shrunk frame reuses one bitmap and one JPEG buffer (no new allocations and no garbage collection for every frame), which also keeps the router cooler.
- **AT & Radio:** the line `AT+SPIMEI=0,"NEW"` is now at the top of the window. Tapping it puts the line in the command box (it is not sent) with NEW selected, so you type the IMEI over it.

## 1.1.39 - Screen control: text box removed
- Removed the "Type text to send" row (text box, Send, Enter, Backspace) and its hint line from the Screen control window. Taps, swipes, the navigation buttons and quality selector are unchanged.

## 1.1.38 - Smoother screen control
- **Faster capture.** The host now keeps one root shell open and reads the screen as raw pixels (`screencap` without PNG) straight from its pipe, then shrinks and JPEG-encodes it. The slow PNG screenshot is only used for the first frame (it measures the raw header size) and as an automatic fallback if the raw path fails three times. The window shows `(raw)` or `(png)` next to the frame rate so you can see which one is active.
- **Capture runs ahead of the browser.** While a browser is watching, a background thread keeps the newest frame ready, so a request is answered at once instead of starting a capture. The page also asks for the next frame while it is still drawing the current one. The thread stops about 6 s after the last viewer leaves or the tab is hidden.
- **Unchanged screen costs almost nothing.** If the picture did not change, nothing is encoded or sent (the host just looks again 4 times a second), which also keeps the router cooler.
- `GET /api/screen/frame` takes `since=<sequence>` and waits up to 3.5 s for a newer frame (204 = nothing new); responses carry `X-Frame-Seq` and `X-Capture-Mode`. Changing quality takes effect on the next frame.
- With several browsers open at once they share one capture and the last quality setting chosen wins.

## 1.1.37 - Screen control (scrcpy-style remote screen)
- **New built-in tool "Screen control"** (button on the home card). It shows the F50's own Android screen in the browser and sends your touches back, so a second phone (or a PC) that opens the MatchiTOOL page can control the device. Tap = click, drag = swipe, hold half a second = long press, mouse wheel = scroll. Buttons for Back, Home, Recents, Wake, Power and volume, plus a text box (letters, digits, spaces and `. _ - @ : / + , = ! ? #`) with Enter and Backspace.
- **How it works:** the host takes a screenshot as root (`screencap -p`), shrinks it and re-encodes it as JPEG, and the page asks for the next frame as soon as one arrives (about 100 ms pause between frames). Input is injected with root `input tap / swipe / keyevent / text`. Nothing is installed and no binary is bundled. Quality: Low (30 %, fastest) / Medium (50 %) / High (80 %). This is a screenshot stream, not video: expect a few frames per second, not scrcpy's 60.
- New endpoints `GET /api/screen/frame?scale=&q=` (JPEG, real screen size in `X-Screen-W` / `X-Screen-H`) and `POST /api/screen/input`. Both need the normal login token and the same private-network check as every other API; the stream is plain HTTP like the rest of LAN mode, so enable LAN access only on a network you trust.
- The page stops capturing when the window is closed or the browser tab is hidden. If the app cannot read the screenshot file (SELinux), it is read through root as base64 instead.
- Full diagnose checks that `screencap` and `input` exist (it does not start a stream). `scripts/validate.sh` now expects 9 embedded tools and the new routes.

## 1.1.36 - Smaller popups on phones
- **Every popup is now compact in phone view** (screen up to 760 px wide). This covers the card popups (Diagnostics, Full diagnose, USB controls, Firmware, Terminal, Plugin manager), all tool windows (SMS, Signal info, Network debug, Device status, AT & Radio, Bypass) and the confirm box: smaller text, tighter padding, shorter buttons and inputs, smaller code boxes, and a narrower window (at most about 400 px). The PC layout is unchanged. Also applies to a phone held sideways (short touch screens), where popups were still full size and the AT & Radio window overflowed sideways.

## 1.1.35 - IMEI read-out after restart, SMS delete of sent messages, faster delete
- **IMEI showed "unknown" while "Kept after reboot ... (active)".** Right after Apply saved IMEI / Change IMEI the modem restarts and does not answer for about 30 s, and the window then showed "unknown" and wrongly claimed "(active)". The IMEI is now read with `AT+CGSN`, `AT+CGSN=1`, `AT+GSN` and, last, Android's phone service; while the modem is silent the window shows "reading..." and asks again every 4 s (up to about 50 s). "(active)" is only shown when the modem really reports the saved IMEI; otherwise it says the modem reports a different IMEI or could not be read.
- **Delete of your own (sent) messages.** The message is now found in Android's SMS store / modem storage by number + text, then by text + time (sent messages can be stored without a usable number), then as the only outgoing message with that text. Senders without digits (DITO, GCASH) are no longer treated as the same number. If no store has the message at all, it is hidden from the list (kept in this browser, "Show N hidden messages" brings them back) and the toast says it was only hidden; the files that contain its text are listed in `/data/local/matchitool/sms_delete_debug.txt` on the router to find the real store.
- **Delete is much faster.** The row disappears at once and returns with the reason if the delete fails. The router's "ignores set calls" state is remembered for an hour (it was forgotten at every page load). Android's SMS store is read in the background when the list loads, so Delete needs one root call; the method that worked last (root / phone / system) is tried first and "Deleted 1 rows" is trusted without a second read. Android store and modem storage are looked up in parallel. The router list is re-checked in the background after the delete.
- **Bypass window cut off on the right (phone).** The window's id sits on the full-screen overlay and the plugin gave it `width:94vw`, so on a phone the overlay stopped 6% short: the right strip was not covered and the box sat off-centre. The overlay is now full width and only the box is limited (600 px), centred on both phone and PC.
- **Compact UI (PC and phone).** Smaller base text (13 px), shorter header, tighter cards and popups (padding 14 px / 12 px on phone), shorter buttons and inputs (32 px / 34 px instead of 40 px / 43 px), smaller toasts, popups sized to the screen with dynamic viewport height so phone toolbars no longer hide the Close button.
- **Live Status button removed** (the Live device status panel on the Device overview card stays and is the only view; its popup was a duplicate). Full diagnose now checks the panel instead of the button.
- **AT & Radio window compact.** VoLTE / VoNR are small switches in one row (the default check boxes sat misaligned with their labels), and the slot box, buttons, inputs and output box are smaller. No functions added or changed.

## 1.1.34 - IMEI survives reboot, SMS send/delete fixes, Close buttons bottom-right
- **IMEI kept after reboot.** The firmware can put the factory IMEI back at boot, so `AT+SPIMEI` alone did not last. Change IMEI / Restore first-seen now also save the chosen IMEI on the router (`/data/local/matchitool/imei_target.txt`). At every boot the app waits for the modem and, if it reports a different IMEI, writes the saved one again (max 3 tries per slot, then restarts the modem). New **Apply saved IMEI now** button runs the same keeper on demand and the AT & Radio window shows what is kept.
- **Close buttons** are now at the bottom right of every window (Device diagnostics, Full diagnose, USB controls, Firmware inspector, Root terminal, Built-in tools and all tool popups) and stay visible while the content scrolls.
- **SMS send via Android, Android 13 order:** the F50 reports sdk 33 and accepted the call with transaction 5 but the sent box stays empty for a non-default SMS app, so that is no proof of failure. Transactions are now tried in the order 6, 7, 5, 8 on Android 13, a success reply counts as sent (telephony log lines are shown), and the working form is no longer hidden behind a sent-box check.
- **SMS send via Android.** The router ignores every "set" here and sendat cannot pass Ctrl-Z, so Send now goes router (skipped once it is known dead) -> Android telephony (`service call isms` as the phone / shell user, checked in the sent box so it is never sent twice) -> modem AT.
- **Delete is fast again (10-15 s -> a few seconds).** One router try; when it answers with an empty body the router is skipped for 10 minutes and the Android SMS store is used first.
- **Modem info** used `ATI`, which this modem rejects (`+CME ERROR: 4`). It now runs `AT+CGMI`, `AT+CGMM` and `AT+CGMR`.
- **Network debug** read only 4 files because the router page is a RequireJS app (`data-main`, modules without `.js`). Detection now follows the main module and the modules it lists.
- **Network debug detection** found nothing (`goformIds: (none)`, `lteSet:false`) because the router's index page and its scripts do not contain the band-lock commands. Detect now follows html / json / template files too (up to 80), accepts more goformId spellings, and when the page has no band-lock text it searches the router's own web files on the device as root and reads the ones that mention band lock or neighbor cells. The report lists every file read and every goformId on the page.
- **SMS send (router):** requests now look like the router's own page (browser User-Agent / Accept headers, field order isTest first and AD last, `GSM7_default` for plain GSM text, `UNICODE` otherwise).
- **SMS send (modem):** more Ctrl-Z forms are tried and the error lists the reply of every form, so the exact sendat answer can be seen.
- **SMS delete (Android store):** when plain root is refused, delete is retried as the phone (1001) and system (1000) users and directly in the telephony database (if sqlite3 exists), each verified.

## 1.1.33 - SMS delete / send failures (empty router reply, modem "Unsupported escape sequence")
- **Delete:** when the router answers a delete with an empty body, the host now retries with a fresh router login, then with the upper-case form of the AD token, and checks the message list after each try. If the router still refuses, the message is looked up in every modem storage (loose text match, so long or re-wrapped texts are found) and then in Android's SMS store, and deleted there. Success is only reported when the message is really gone from the router's list.
- **Send via modem:** sendat rejected the command built with real CR / Ctrl-Z bytes (`500 Unsupported escape sequence`). The terminator is now also passed as `\x1a` / `\u001a` escapes that sendat decodes itself; the next form is only tried when sendat rejected the command text, so a message is never sent twice.
- **AT & Radio: Change IMEI.** Shows the current IMEI, accepts a new 14 or 15 digit IMEI (check digit validated / added), asks for confirmation, writes it with `AT+SPIMEI=<slot>,"<imei>"` and restarts the modem (`AT+CFUN=1,1`). The current IMEI is backed up on the router (`/data/local/matchitool/imei_backup.txt`) and in the browser before anything is written; no write happens if the current IMEI cannot be read or the backup fails; the modem restart is a separate confirmation. **Restore first-seen** writes the earliest recorded IMEI back.
- **Reboot** moved from Device status to the right of CONTROL CENTER on the home card.
- **Network debug rewritten as a native tool** (4G / 5G band lock, neighbor cells, cell lock, locked cells, in MatchiTOOL's own style). It reads the command names from the router's own web page (`Detect commands`, new read-only `/api/zte/page`) and only sends a command that page uses; 4G band lock is wired, the rest stays disabled until its command is identified (Copy report). Selecting no band is refused.
- New optional `retry` field on `/api/zte` (0 = normal, 1 = fresh login, 2 = fresh login + upper-case AD).

## 1.1.32 - SMS delete and message text fixes
- **Network debug** (new button on the home card): the router's own Network Debug page (4G / 5G band lock, neighbor cells, cell lock, locked cells) opens inside MatchiTOOL, with an Open in new tab button if the router refuses to be framed. MatchiTOOL sends no radio command itself: the router applies the changes with its own firmware commands, so nothing is guessed.
- **Live device status is compact:** the 5G NR / 4G LTE box shows RSRP, RSRQ and SINR side by side in one slim row with band, PCI and channel in its header, the three temperatures are one small row of chips, and the signal card is smaller, so the whole panel takes about half the height.
- **Send no longer dead-ends on "Send failed: unknown":** if the router refuses (or does not answer) the send, the message is sent through the modem (AT commands as root) instead; only if both fail you get an error with both reasons.
- Router errors now carry a short diagnostic in brackets (AD token ok/missing, session yes/no, HTTP code, start of the reply), so a refusal can be traced.
- **Same dialog style in the Android app:** the Enable LAN access confirmation (home screen and Access & security) now uses the app's dark dialog (Cancel / red Enable) instead of the plain system dialog, and its text says "router admin password" instead of "access token".
- **Confirm dialogs match the app:** the browser's plain "192.168.0.1:2334 says" box is replaced by an in-page dialog in the app's dark style (Cancel / red action button, Esc or a click outside cancels) for Delete message, Delete plugin, Reboot, Remove nfqws and the USB mode changes.
- **Root cause of "Delete does nothing" (and Send via the router):** the F50 firmware ignores every router "set" request that has no AD token and answers with an empty body (the error said `router said: empty reply`). The host now adds the token the router's own web page uses, `AD = md5(md5(wa_inner_version + cr_version) + RD)` with a fresh RD per request, to every set call.
- The SMS popup no longer has the Router settings box (gateway / password): the router password is learned automatically and the gateway is 192.168.0.1.
- **Blue flash on tap/click (phone and PC):** tapping a button, toggle or tool flashed a blue box for a moment. The page now turns off the browser's tap highlight and the focus ring / text selection that a mouse click leaves, for every button, switch, link and summary (keyboard focus still shows a ring). The Bypass window already did this for itself; it now applies everywhere, including SMS, Live Status and the other tool popups.
- **No password to enter in the app.** The web console now signs in with the router's own admin password (the exact one for 192.168.0.1): the host checks what you type against the router itself, and when the router accepts it the password is remembered for the SMS / signal tools. It also follows a changed router password (a typed password the router accepts replaces the stored one). On start the app additionally tries to read the router's password as root (`nv get admin_Password`) and keeps it only if the router accepts it. The Router gateway, Router password and Access token cards are removed from the app (Access & security keeps only LAN access; the home screen no longer has a Router password row; the gateway stays 192.168.0.1). After 3 bad logins from one address the router is no longer asked, to avoid its own lockout.
- **SMS Delete now works and tells you the truth.** The router often answered "success" (or an empty reply) without deleting anything, and the tool then just refreshed the list, so the message came back. Delete now checks the router's answer, retries with the other message-id format, confirms the message is really gone from the list, and falls back to deleting it from the modem storage by AT command. If everything fails you get an error with the router's reply instead of nothing.
- Messages shown from Android's own SMS store can now be deleted too (as root, by `_id`); before, Delete always said it was not supported.
- Modem delete retries with `AT+CMGD=<idx>,0` for modems that need the flag.
- **SMS text shown as random letters** (`SGkhIFlvdXIg...`): some firmware returns the message body as base64 (UTF-8). It is now decoded automatically, only when the result is clean printable text, so normal messages are never altered.
- Delete button shows "Deleting..." while working and a "Deleted" confirmation.
- **Router session expiry:** the router drops idle web sessions but still answers a "set" made with the dead cookie with HTTP 200 `{"result":"failure"}`, so Delete / Send SMS silently did nothing after a few idle minutes (only a restart helped). The app now signs in again when the session has been idle for 2 minutes, before the call is made, so a "set" is never repeated.
- **Web host start crash:** switching LAN access restarts the host, and if the old instance still held port 2334 the new one threw inside the service and crashed it. Start now retries for several seconds off the main thread.
- **Root shell:** a shell killed after a timeout could still be handed to the next command for a moment (process destroy is asynchronous), causing a spurious failure; killed shells are now marked dead at once. The temp output file of a timed-out command is removed instead of left in `/data/local/tmp`.

## 1.1.31 - Router API port auto-detect (fixes SMS / signal on the F50)
- The F50 has nothing listening on port 80, so every router web API call failed with `Failed to connect to /192.168.0.1:80`. The app now probes 80, 8080, 9090 and 9999 for the ZTE goform API and uses the first that answers (cached, re-detected after a failure).
- The Router gateway setting also accepts `host:port` (e.g. `192.168.0.1:8080`) to force a port.
- New built-in tool **Clean memory** (button on the home card, needs root): stops background third-party apps (never the foreground app, launcher, keyboard or MatchiTOOL), trims the system and reclaims memory, then reports how much was freed. Full diagnose lists it under Built-in tools without running it.
- **Bypass speed:** closing the Bypass window now really stops its background checks (they kept running every 30 s and made the next open queue behind them). Internet / DNS tests run in parallel and give up after about 2 s instead of 3-8 s each. Opening skips the duplicate re-read and checks the helper scripts at most every 10 minutes. Standard / Strong / Off repaint right after applying and run the internet test in the background. The automatic check also skips a round while the root shell is busy.
- **Persistent root shells (all tools):** the host now keeps up to 3 root shells open and feeds scripts to them, instead of starting `su` for every command (150-400 ms each on a hot device, and Bypass / Live Status / SMS / diagnose issue dozens). Each script still runs in its own child shell, so `exit` or a failing command cannot end the session; output goes through a temp file so a background daemon cannot pollute a later result; a timeout closes that shell and the next command opens a fresh one; if all shells are busy or one cannot start, the old one-shot `su` path is used.
- **USB crash fix:** the 6 `FATAL EXCEPTION ... IllegalArgumentException` entries in the crash log were the USB controls running `svc usb setFunctions` with combinations Android rejects (`mtp,adb`, `ecm`; svc accepts exactly one plain function). **Tether off** now restores the default mode through `sys.usb.config` (same path as enabling), and `svc` is only a fallback with a single valid function (`rndis` / `mtp` / `ptp` / `midi` / `ncm`). Full diagnose now names this crash instead of "none identified".
- **Bypass reopens instantly:** closing the window now only hides it, and opening it again shows the same window (about 50 ms, one background ping) instead of rebuilding it and re-running about 7 root commands. The root check runs once, the iptables support probes (TTL, MSS, NFQUEUE, connbytes - each creates and deletes a chain) run once instead of on every refresh, and the 30 s auto check is a ping only, with a full re-read every 2 minutes.
- **Bypass no longer waits for the internet test:** with no working internet every ping runs into its timeout, and the DNS lookup of `google.com` can hang 10 s or more, and the test sat in the same queue as the buttons, so a click right after opening waited behind it. The test now runs on its own root shell, pings the IP first (2 s at most) and the name only if that works (4 s at most), and a reopen within 60 s does not run it again. Simulated with 4 s pings: Standard right after reopening finishes in 0.7 s.
- **Less heat:** Live Status polls every 10 s instead of 5 s, reads the four modem AT values in one call (new `/api/at/batch`) instead of four, and refreshes the heavy `dumpsys telephony.registry` only every 30 s. The app's own Live signal card refreshes every 15 s instead of 8 s.
- **Live Status** pauses its 5 s polling while another tool window is open, so tools no longer compete with it for the root shell.
- Full diagnose no longer warns about port 80 when another usual router port is listening.

## 1.1.30 - Native app redesign and launcher icon (app screens only)
- New home screen: Live signal card (bars, dBm, quality, network badge, operator and registration, RSRQ / SINR / battery; refreshes every 8 s while open), Open web console button, Router page link, and the Access & security group (Root access badge, LAN access switch, Web admin password row). Footer shows the installed version.
- New **Access & security** screen (opened from the Web admin password row): Router gateway, Web admin password (Save / Remove), LAN access switch with warning, Access token (masked, Copy / Reset).
- The app now has a launcher icon (adaptive, plus themed/monochrome icon on Android 13+) and a proper notification icon, so it no longer shows the default Android icon after install.
- **One password:** the separate web admin password is gone. The app now stores the router's own admin password (192.168.0.1) and uses it to sign in to the web console and for the SMS / signal tools. Any length is accepted (ZTE defaults can be short). The access token still works until a router password is saved.
- **Login lockout fix:** only bad logins count toward the "Too many attempts" lockout. A browser tab with an old session token no longer locks out the real login after the password or token changes.
- Scrollbars are hidden everywhere in the web console (page, popups, Full diagnose report, terminal). Scrolling still works.
- Dark theme for all native screens. The web console, its logo and every tool are unchanged.

## 1.1.30 - Live device status on the Control Center
- The Control Center (Device overview) card now ends with a **Live device status** panel that is always visible and refreshes by itself every 5 seconds (paused while the tab is hidden). No button press needed. The **Live Status** button still opens the same data in a larger popup.
- New design: signal-bar icon (0-5 bars, coloured by quality) with the dBm value, operator and network badge (5G NSA / 5G SA / 4G LTE), battery icon with charging state, 5G NR and 4G LTE boxes with RSRP / RSRQ / SINR quality gauges, band, PCI and channel, and battery / system / modem temperature tiles. Works on phone widths.
- Data fixes: signal bars now come from RSRP (5G first, then LTE), then the router's bar count, Android's signal level and finally CSQ (shown as RSSI); the router's `rssi` is no longer shown as LTE RSRP; blank router values are no longer read as 0; the shell and modem reads run in parallel so a refresh is faster; the router API is retried every 3 minutes instead of every minute.

## 1.1.29 - SMS works when the router web API (port 80) is unreachable
- On the F50 the app cannot connect to the router web API at `192.168.0.1:80`, so SMS always showed `Failed to connect to /192.168.0.1:80` no matter what admin password was saved (the password is never reached when the connection itself fails).
- **No login needed:** with no router password saved, the SMS tool skips the router login entirely and works through the modem's AT commands (`sendat`, as root): read (`AT+CMGL`, ME then SM storage), send and delete (`AT+CMGD`). If a router password is saved, the router API is tried first and the modem is the fallback (retried once a minute).
- **Send in PDU mode (UCS2):** any character works and long messages are split into concatenated parts (up to 10, about 670 characters). The old 70/160 character limit is gone.
- **Inbox backup:** if the modem storage is empty, messages are read (read-only) from Android's own SMS store as root.
- Router connect timeout lowered to 2.5 s so the fallback is quick.
- Wrong-password and other router errors are still shown as-is (no silent fallback for those).
- The host now reports connection failures as `Router web API unreachable at <host>:80 (...)` instead of a raw socket error.

## 1.1.28 - Diagnostics, Full diagnose, USB and Firmware as popups
- Device diagnostics, Full diagnose, USB controls and the Firmware manifest inspector are no longer on the main page. Control Center buttons open each as a popup (Close button, click outside, or Esc). Full diagnose uses a wider popup for the report.
- Element ids are unchanged, so every control and the diagnose itself work as before.

## 1.1.27 - Root terminal and plugins as popups
- The Root terminal and Built-in tools / custom plugins cards are no longer on the main page. Control Center has two buttons, **Root terminal** and **Built-in tools & plugins**, that open each one as a popup (close with the Close button, a click outside, or Esc).
- The cards keep their element ids, so the tools, plugin upload and Full diagnose work as before.

## 1.1.26 - Bypass window footer always visible on desktop
- On desktop widths the Bypass window overflowed by about 50 px (the scroll area's height ignored the footer bar), so Run check / Copy report / Close sat under the window's own scrollbar. The scroll area now takes the remaining space and the footer stays pinned. Phone layout unchanged.

## 1.1.25 - Device diagnostics report clarity
- Tool list now prints `name: path` for every tool (found paths had no name before). `sendat` and `nfqws` are looked up in their real app locations instead of PATH, so they no longer show as unavailable when installed.
- Added policy routing rules, default routes in all tables and DNS properties (the main table has no default route on this firmware, which looked like a fault).
- Storage section explains the bind-mount mount point and shows the real /data device.

## 1.1.24 - Top menu removed
- Removed the duplicate top navigation bar (Overview, Diagnostics, Full diagnose, USB, Firmware, Terminal, Plugins); the Control Center buttons cover it. The Host connected status stays on the right.

## 1.1.23 - Bypass toggle switches on desktop
- The Block QUIC / Auto-apply switches were stretched into tall blocks on desktop browsers because the page's global `button`/`input` min-height and padding applied to them (only touch screens reset it). Switches now keep their 36x20 / 32x18 size on every screen.

## 1.1.22 - Diagnose: no-load detection
- Reverted the 1.1.20 rule that treated a little observed traffic as working data. If ping and DNS both fail while the SIM is registered with an active data session, the diagnose now FAILs and names the likely cause (no load/balance or data plan).
- Bypass self-test advice no longer blames nfqws when the SIM has no load.

## 1.1.21 - Diagnose: charger watchdog false alarm
- Kernel scan no longer flags the charger IC message `set watchdog timer 0s`; it only matches real watchdog bite/timeout/reset and lockups.
- Crash scan now shows the exception text and warns when 3 or more app crashes are logged since boot.

## 1.1.20 - Diagnose: false alarms removed (from a real F50 report)
- APN check accepts the unquoted `+CGDCONT` format the modem prints.
- `AT+CSQ` = 99 is no longer a "no signal" failure while registered (normal on 5G NR).
- Kernel scan no longer matches `debug:`; the crash scan names the crashed process and only warns if it is MatchiTOOL.
- Internet/uplink checks treat real traffic (rx bytes, live connections) as proof data works when ICMP ping is blocked; interface errors are judged by error ratio, not raw count.
- Blocked-process threshold raised (kernel threads in D state are normal on this device).
## 1.1.19 - Full diagnose: real malfunction detection (32 -> 55 checks)
- Every WARN/FAIL now carries a **Fix** line, and the report adds **Probable root causes** and **Since last run** (new / fixed problems).
- New device-health checks: root speed, SELinux, clock drift, temperatures (all thermal zones + battery), battery health, memory/CPU/blocked processes, read-only or full `/data` and inodes, kernel/crash log scan, core services (system_server, netd, rild, dnsmasq, hostapd).
- New hotspot/network checks: br0 + IP forwarding + NAT, uplink MTU/IPv4/errors, IP vs DNS failure, interface error counters.
- New modem checks: SIM present/locked, radio mode (CFUN), registration (LTE/5G/CS, denied/searching), packet attach, PDP/APN, signal (RSSI/RSRP), modem latency, router modem state.
- New host/page checks: parallel-request stability, port 2334 binding, 404 handling, boot.sh syntax and last boot result, `sendat` CPU architecture and execution, plugin/tool syntax compile (nothing executed), duplicate element ids, uncaught JS errors.
- Still strictly read-only.
## 1.1.18 - Full diagnose: fixes from a real F50 report
- AT checks: `sendat` returns `OK` glued to the data (`+CSQ: 99,99OK`); the diagnose expected a separate word and wrongly reported every AT query as failed. It now matches `OK` at the end and flags real `ERROR` replies. `AT+CGMM?` (a typo) is now `AT+CGMM`.
- Internet check: the F50's main routing table has no default route, so a plain ping from the root shell fails instantly. The check now also pings through the detected uplink interface and reports that case as reachable.
- New check "Router web server ports" lists the device's listening TCP ports, to show whether anything serves the router web API on port 80.

## 1.1.17 - Full diagnose
- New **Full diagnose** card on the web page (also in the top menu and on the home card). One button runs 32 read-only checks across every function: login/session, browser features, page controls, root shell, shell failure reporting, device info, storage, system commands, host diagnostics, USB status, USB/AT/plugin input validation, `sendat`, AT on both SIM slots, router web API and SMS storage, plugin manager, the six built-in tools (loaded, button present once, and the data path each one needs), the firmware inspector and internet reachability.
- Results are PASS / WARN / FAIL / SKIP with a "Needs attention" list at the top. Each check has its own timeout, so one hung command cannot freeze the run.
- **Copy report** puts the whole report on the clipboard (with a fallback for plain-HTTP LAN pages where the browser has no clipboard API, and an auto-select if the browser blocks copying). **Download .txt** saves it as a file.
- Nothing is changed on the device: no USB/ADB switching, reboot, SMS send/delete, Bypass apply or router writes. The report never contains the token or any password.
- The page now checks its own version against the app's, and warns if a cached old page is being shown.

## 1.1.16 - Tools built into the web page
- Bypass, Device Status, AT & Radio, SMS, Signal Info and Live Status are now embedded in the web page (`web/index.html`) and load automatically after login. No uploading, no `plugins/` folder, no APK-side tool files or `/api/builtin` endpoint.
- The page lists them under **Built-in tools**; **Custom plugins** is only for scripts you upload yourself.
- If copies of these tools were uploaded earlier (or left by old versions), the page removes them from the device so nothing loads twice.
- Updating the tools means editing `index.html`; they arrive with the app because the page ships in the APK.

## 1.1.15 - Tools are web-only again
- Bypass, Device Status, AT & Radio, SMS, Signal Info and Live Status are no longer built into the APK. They live in the `plugins/` folder of the repo and are installed from the web page (Plugins card -> choose file, several can be selected at once).
- Removed the `/api/builtin` endpoint, the `assets/builtin` folder and the "Built-in tools" section. The app no longer deletes plugin files on start.
- To update a tool, upload its new `.js` (same file name replaces the old one). App updates no longer change tools.
- The `sendat` binary stays in the APK because AT & Radio needs a native executable.

## 1.1.14 - Built-in tools (no longer plugins)
- Bypass, Device Status, AT & Radio, SMS, Signal Info and Live Status are now built into MatchiTOOL. They ship inside the APK (`assets/builtin`) and are served by a new `/api/builtin` endpoint, so an app update always updates them: no more copying to the device, no stale versions, and they can no longer be disabled or deleted by accident.
- The web page lists them under **Built-in tools**; **Custom plugins** is now only for scripts you upload yourself.
- Copies of the old bundled plugins left on the device by earlier versions are removed on start so nothing loads twice.
- Bypass wording that referred to UFI-TOOLS now refers to MatchiTOOL.

## 1.1.13 - USB mode switching for the F50
- On the F50, `svc usb setFunctions` is killed (exit 137). USB modes are now switched by setting `sys.usb.config` (trying `<fn>,mtp,adb` first, then `<fn>,adb`) so init applies the configfs change; `svc` is only a time-limited fallback.
- Success is now verified in configfs (the function must be linked into the active gadget config) before the interface is bridged into `br0`.
- The output always lists the active gadget functions and USB network interfaces so a failure can be diagnosed.

## 1.1.12 - USB Ethernet bridging and quieter Live Status
- RNDIS / CDC-ECM modes now also bring the new USB network interface up and bridge it into `br0` (the hotspot LAN), then report the resulting interfaces. Previously only the gadget function was switched, so the PC saw no working network. The action now fails with a clear message if the USB config does not actually change.
- Restore default USB mode removes the interface from the bridge first.
- Live Status no longer shows the unreachable router web API as an error; it is noted in the raw panel and the status line shows which source is used.

## 1.1.11 - Admin password login
- The web page now logs in with an admin password set in the app (new "Web admin password" card) instead of the random token. The password is stored only as a salted PBKDF2 hash.
- Until a password is set, the login still accepts the access token, so nobody is locked out after updating.
- New `/api/login` endpoint shares the existing per-IP lockout (8 bad attempts = 1 minute). Setting, changing or removing the password rotates the token and signs out existing web sessions.
- The long-press token dialog is unchanged and still works as a recovery path.

## 1.1.10 - Live Status works without the router web API
- On the F50 the router web API on port 80 was unreachable from the app, so every Live Status field showed a dash. Live Status now falls back to the modem's AT commands (operator, registration, signal) and Android telephony (`dumpsys telephony.registry`) for RSRP/RSRQ/SINR.
- The router web API is retried only once a minute after a failure, so it can't stall each refresh.
- Modem temperature now comes from the nr/modem thermal zone.
- Added a collapsible raw-output panel to help diagnose fields that stay blank on a given firmware.

## 1.1.9 - USB error visibility
- USB control failures returned HTTP 400, which made the web UI show only "Request failed (400)" and hide the real reason. They now return 200 with `success:false`, so the command output is displayed.
- On failure the output now includes the exit code, whether `svc` exists, and the device's USB properties.

## 1.1.8 - LAN access switch
- Added a LAN access card to the app screen (with a warning dialog). Turning it on makes the web UI reachable from devices on the F50 hotspot at `http://<F50 IP>:2334`; it restarts the web server automatically.
- When LAN is on and no Wi-Fi client IP exists (the F50 is the hotspot), the app now shows the router address instead of "Wi-Fi unavailable".
- LAN access stays off by default.

## 1.1.7 - Web Live Status plugin and fixes
- Added the read-only `Live_Status.js` dashboard plugin (modem signal/band, battery, thermal).
- Fixed overlapping refreshes: polling now skips a tick while the previous request is still running, so slow modem/shell reads no longer pile up on the host.
- Fixed polling continuing after the dialog closed; the timer now stops itself.
- Fixed modem/shell errors being overwritten by the "Last updated" line; errors now stay visible.
- Bumped versionCode to 117 / versionName to 1.1.7 (also `/api/ping` and `scripts/validate.sh`). Bundled plugins only refresh on installed devices when versionCode changes, so this bump is required for plugin fixes to reach the app.
- CI now runs `bash scripts/validate.sh`, so it no longer depends on the file's executable bit.
- Fixed Kotlin compile errors in `WebServer.kt`: shell variables `$x` and `$BASE` inside Kotlin strings were being read as Kotlin templates; they are now escaped.

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


## 1.1.54 — F50 stability hardening
- Bounded root-shell output buffering and limited concurrent root commands to two.
- Added clear back-pressure response when root command capacity is exhausted.
- Improved screen-stream process teardown by waiting briefly, force-killing if needed, and closing both process streams.
- Reduced Live Status background heartbeat frequency and lengthened thermal-aware polling intervals to reduce modem/root wakeups.
- Kept vendor thermal controls, CPU/GPU clocks, charging policy, TTL BPF, and existing SFP filters unchanged.
- LAN firewall setup now skips interfaces identified as default-route uplinks (including policy-table routes).
- Added regression checks for root queue bounds, screen process cleanup, and uplink exclusion.

## 1.2.0 follow-up — Bypass Manager 2.0 and Plugin Manager 2.0

- Added a consolidated Bypass Manager view for TTL, Anti-DPI, boot auto-apply and keep-alive state, plus refresh, existing quick actions, self-test and report shortcuts.
- Kept the existing Bypass implementation and isolated rule chains; the manager does not flush global firewall tables or alter SFP filters.
- Upgraded Plugin Manager with search, enabled/disabled filters, refresh, per-plugin source export, full JSON backup export/import, JavaScript syntax preflight and explicit replacement confirmation.
- Added server-side custom-plugin limits: 50 plugins, 1 MB per plugin, 5 MB total, and reserved built-in filenames.
- Custom plugins remain executable JavaScript with the signed-in console's permissions. Import only trusted plugin source.

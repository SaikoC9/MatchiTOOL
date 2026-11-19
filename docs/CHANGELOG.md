# MatchiTOOL 1.4.5

## bundled binaries are checked before they run

Kotlin written without a compiler at hand; the CI build and the unit tests are what confirm it. Compiled and unit-tested in CI (Validate and build APK); run on the F50 on 2026-11-19, see the last bullet.

- **Hash check:** the app now knows the SHA-256 of `sendat`, `curl`, `jq`, `sha256` and `zreq` as they were when it was built (`BinaryHashes.kt`, written by `scripts/gen_binary_hashes.py`; `validate.sh` and `BinaryHashesFileTest` fail when it does not match `assets/bin`). The copies in the app's files folder are compared with it at every start, not with the file inside the APK as before.
- **A file that does not match is not run:** at start the copy is made again; a copy that still does not match is deleted and logged as an error. Before every `sendat` call (AT console, AT batch, plugin AT, Live signal, IMEI keeper) the file is checked again, cheaply: it is hashed again only when its size or modified time changed. A changed `sendat` is deleted and the call answers with a plain message instead of running it. `curl`, `jq` and `zreq` are called by path from scripts, so for them the start-up check and the delete are the protection.
- **Permissions:** a bundled file that other users can write is changed to owner-write only, and a files folder that other users can write is logged. The files stay world-executable, as before.
- **Full diagnose** has a new section, `bundled binaries`, with one line per file (ok, not installed, different from the build, or refused and why).
- **Release pipeline:** `update_binary_hashes.py` writes `BinaryHashes.kt` again, and the pull request that `release-tools.yml` opens carries it.
- **Run on the F50 (2026-11-19, MU300, root):** the five hashes on the device match the build; a `sendat` with one byte added is refused and removed, and comes back at the next host start; a `curl` with one byte added and a `jq` cut to 100 KB are replaced at the next host start; the bundled files have no group or other write; Full diagnose lists all five as `ok (matches the hash from the build)`. Steps and results: `docs/MatchiTOOL_Binaries_Phase3_todo.txt`.

## newer toolchains and one release pipeline for the bundled tools

Build recipes and CI only. The binaries in `app/src/main/assets/bin/` are the rebuilt ones (pull request #2): curl 8.23.0, OpenSSL 3.5.9, jq 1.8.2 and `sendat` / `zreq` built with Go 1.26.10. They passed the F50 checks listed below.

- **curl:** the build workflow now defaults to curl 8.23.0 (was 8.11.0).
- **OpenSSL:** it now defaults to 3.5.9 (was 3.0.15). OpenSSL 3.0 stopped getting security fixes on 7 Sep 2026, and 3.5 is the LTS line.
- **jq:** it now defaults to 1.8.2 (was 1.7.1), which has the 2026 security fixes.
- **Go:** the `sendat` and `zreq` workflows now use Go 1.26.10 (was 1.22.8).
- **One pipeline:** `release-tools.yml` (a `tools-v*` tag, or run by hand) builds all four binaries, builds `sendat` and `zreq` twice and fails if they differ, and opens a pull request with the binaries and their new SHA-256 values in `NOTICE.md` and `docs/BINARIES.md`. `scripts/update_binary_hashes.py` does the hash rewrite and has its own test, which `validate.sh` runs. `scripts/pin-actions.sh` pins the actions to full commits. How to use it: `docs/BUILD_BINARIES.md`.
- **Run on the F50 (2026-11-19, MU300, root):** the four hashes match the pull request, `curl -V` shows 8.23.0 with OpenSSL 3.5.9, an https request with `--cacert` returns 200, `jq --version` shows 1.8.2, `sendat -n 0 -c AT` answers OK, and a `zreq` sign-in on 192.168.0.1 returns the login challenge. A raw `curl` without `--cacert` fails with error 60: the app passes the CA bundle to root scripts, so plugins that call `curl` directly need `--cacert`.
- **Still to do:** run `scripts/pin-actions.sh` and commit the result.

# MatchiTOOL 1.4.4

The short version. The full notes for this release, with test names and hashes, are in the 1.4.4 section at the top of [`docs/CHANGELOG_DETAIL.md`](docs/CHANGELOG_DETAIL.md). The Kotlin in this release was written without a compiler at hand, so the CI build is what confirms it. Unless it says "run on the F50", it has not been tried on the device.

- **Plugin web pages:** a plugin can declare one protected local web page with a `// @matchi-gate name=... port=...` header line and open it with `matchi.gate.open(name)`. The page is served through a gate that asks for the login every time, and the gate login ends on sign-out, a password change and a host start. AdGuard Home uses it. A plugin with a broken `@matchi-gate` line is refused at upload, and sandboxed plugins cannot use it. See `docs/PLUGIN_GATE.md`.
- **AdGuard Home door:** port 3000 is closed to the hotspot by the `AGH_UI` firewall chain and opened only for the signed-in device. It closes again on sign-out, session expiry, a password change, after 30 minutes and when the host starts.
- **UFI-TOOLS code removed.** MatchiTOOL now has its own plugin API, `window.matchi`. The UFI plugin format, the plugin store, the UFI alias routes, `UfiPathMap` and the free-path router proxy (`/api/goform/*`, `/api/proxy/*`, `/api/get_cookie`, `/api/set_cookie`, `/api/upload*`) are gone. A plugin written for the UFI helper names (`createToast`, `runShellWithRoot`, `getData` and so on) has to be ported to `matchi.*`; an installed HTML-block plugin is listed but not loaded. The Bypass folders are renamed to `matchi_ttl`, `matchi_dpi`, `matchi_boot` and `matchi_lock`.
- **Change IP and Memory Cleaner** are rewritten as MatchiTOOL's own tools. Change IP shows the local and public address, switches mobile data off and on in one root script, and shows old and new. Memory Cleaner scans first, lists the user apps that are running with their memory, and stops only the ones you tick.
- **Network and radio changes that did nothing:** the F50 answers a change it refused with the same empty reply it gives for one it accepted, so the page could not tell them apart. The Network window and the Radio and Cell lock cards now check the router's read-back. If nothing changed they send the same call again with a fresh sign-in, then with the older token form, and say so plainly when the router still ignores it. An MSS-only change no longer prints "MTU was not changed" when nothing was applied.
- **Radio restart:** slot 1 is skipped on the one-SIM F50, and the restart ends with a check that the internet works. If it does not, mobile data is toggled once. It never turns data on for someone who switched it off.
- **Bundled tools:** `zreq` is now MatchiTOOL's own Go build. It has no built-in password, and on the F50 it signs in with the challenge form and tries port 8080 before 80. `sendat` uses `/dev/stty_nr6` as its slot 0 default, never writes to the RIL's port for slot 1, and `-probe` skips ports other processes hold. `curl` is a reproducible build. `sha256` now hashes the file, not its path, and the `curl` wrapper no longer has a syntax error. Root scripts get a CA bundle, so raw `curl` https works. All hashes are in `NOTICE.md`.
- **Live panel:** one root reader now pushes CPU, per-core speed, temperatures, memory, load and uptime about once a second (`/api/live/stream`, `/api/live/view`). It runs only while a visible tab is watching, and the page falls back to polling in Eco, on plain HTTP and whenever the stream drops. The heat level comes from the kernel thermal zones, not the battery sensor, and the refresh chips are now Live, Balanced and Eco. A new install starts in Eco. The timing logs and the unused `WAKE_LOCK` permission are removed.
- **Release build:** it is now obfuscated and optimised with R8. CI uploads `mapping.txt` as a private artifact named with the version code. It is not attached to the public releases.
- **Run on the F50:** a radio restart that ends with `DATA:ok`, `sendat -n 0 -c AT` with `sendat.conf` moved aside, and `zreq` 1.1 (see `tools/zreq/README.md`). The wrapper bug and the raw `curl` error were both found there. Not run on the device: the gate and door, Change IP, Memory Cleaner, the network and radio retry, the `sendat` probe and `stty_nr6`, the new `curl` build, and the Live push stream.

# MatchiTOOL 1.4.2 - Plugin stop follow-ups, Bypass cleanup removed

This closes the three gaps left over from the 1.4.1 plugin stop work. The full notes are in the 1.4.2 section of [`docs/CHANGELOG_DETAIL.md`](docs/CHANGELOG_DETAIL.md). The Kotlin is compiled and unit-tested in CI. What was run on the F50 is in the last bullet.

- **Plugin stop:** the Turn off dialog says "The plugin file stays. Its saved data stays unless the stop commands listed below remove it." when stop commands are listed. `/api/plugins/data` stays open, but its two root calls (the existence probe and the process scan) run only when the root gate would let the request through. The store install dialog lists a plugin's `@matchi-uninstall` commands, its `@matchi-check` command and its `@matchi-boot` paths before you install it.
- **Sign-in and passwords:** every "type the password again" check now goes through one helper (`passwordGate`), with at most two checks at a time and the same lockout as login. A wrong password from the phone itself is answered after the same delay, so an app on the phone cannot guess at full speed. `/api/zte/config` needs a fresh sign-in and the current password when the router address or password changes. When there are 16 sessions, a new sign-in drops the one used least recently. An open tab that only polls no longer keeps a session alive past 2 h idle. A sign-in that falls back to the router no longer holds a password slot while it waits.
- **Routes that now need the fresh sign-in:** `/api/plugins/toggle`, `/api/update/stage`, `/check` and `/fetch`, and `/api/screen/frame`. A router set call now needs it unless its goformId is in `NetGoform.OPEN_SET`, and the same rule covers a set call that has no goformId.
- **Audit log:** an AT write gets its own `at-write` line. Before, the once-a-minute line was used up by polling and a write usually left nothing. The SMS list read is logged once a minute so it does not push out failed logins.
- **Other hardening:** uploads must be `multipart/form-data`. Plugin data paths are no longer guessed inside `/sdcard/`, and DCIM, Pictures, Movies, Music, Podcasts, Audiobooks and Recordings are refused at any depth. A stale router-IP note no longer changes the saved router address. `Tls.selfTest` trusts only the certificate the server started with.
- **SMS:** Delete now finds the exact message, not the newest one that starts the same way. Android send stops after at most two sends and says "handed to Android, not confirmed" when it cannot tell. Long texts are split, and numbers such as `+63917...;+63918...` work. The first message in an empty inbox counts as new, and a deleted text no longer stays counted as seen. The background check reads Android's SMS store and does not touch the modem's text mode.
- **Live panel and CPU Governor:** CPU and per-core speed update about once a second, up from every 15 s. The Governor window no longer shows each Mode drop-down twice, and its layout is about 25 percent shorter.
- **Found on the F50 (15 Nov):** Full diagnose reads the ELF header of `sendat` correctly. Restart modem refuses to switch the radio off when no slot answers `AT`. Ticking a band chip no longer redraws the whole Radio settings card. A new tick box, **Keep RNDIS / CDC-ECM after a reboot**, also writes `persist.sys.usb.config`.
- **Removed:** the one-time boot cleanup that took lines naming "bypass" out of `boot.sh`. A device that went from before 1.4.1 straight to 1.4.2 and still has Bypass lines there must delete them by hand (see `README.md` and `docs/PLUGIN_STOP.md`). Also removed: the stale `app/src/main/assets/plugins/` folder and `ALL-CHANGES.patch`. The launcher icon is now the MatchiTOOL "M".
- **Run on the F50 (14 Nov 2026, 1.4.2 build):** the Turn off dialog wording; the store install dialog; a reboot after the Bypass cleanup was removed (the `boot.d` script ran again and the hotspot stayed usable); Delete and stop of a plugin with header lines (its process was found by its pid file and ended, its boot script removed, the plugin deleted); and the sandbox stop hook for the first time (a working hook ended its job and the plugin was deleted, a hook that never finished kept the plugin after 15 s). One oddity: on the first Delete and stop of the working-hook plugin the dialog opened a second time before the delete went through. The cause is not known and nothing went wrong. Not run on the device: `/api/plugins/data` with a sign-in older than 4 h (unit tests and the route-gate table only).

# MatchiTOOL 1.4.1 - Radio dashboard, security hardening, code structure, web UI, docs

What changed, one entry per version. The full change-by-change history (with test notes) is in [`docs/CHANGELOG_DETAIL.md`](docs/CHANGELOG_DETAIL.md). Items marked "not checked on the F50" or "not run on a device" were not run on a real device. "Compiled and unit-tested in CI" means the GitHub Actions run (Validate, Unit tests, Build debug and release) passed; it says nothing about a device.

- **Radio:** Radio settings and Cell lock cards on the dashboard (band chips, lock by hand, auto-unlock after 60 s). "Lock this cell" falls back to the Android telephony cell when the router returns none. Radio on/off is shown as UNKNOWN instead of guessed. A red warning shows when a band lock is active and there is no service. 4G / 5G boxes say whether PCI came from the router or Android. Performance mode is a button next to Change IP. AT & Radio keeps only the AT tools.
- **Live Status:** router and root reads run as two loops, heat-aware polling, polling guard with back-off, CPU % by the UFI-TOOLS method, 5G / 4G detail filled from Android telephony.
- **Security:** root over plain HTTP is refused until switched on (**Plugins > Root over HTTP...**); console password hash is 310,000 PBKDF2 iterations (old hashes upgrade at the next sign-in); the hotspot firewall rule is removed when the host stops; the bundled `sha256` is a script around `sha256sum`; `docs/BINARIES.md` lists where each bundled binary came from.
- **Plugins:** UFI-TOOLS plugin API (shell, `/api/AT`, router proxy), plugin store, compatibility report and header lines, complete erase on delete, traced writes.
- **Plugin stop and undo:** "Delete plugin" and "Turn off" can now stop what a plugin started and undo what it left in the system, all as root, inside one 60 second total. (1) A plugin can say how with header lines `// @matchi-uninstall`, `// @matchi-check` and `// @matchi-boot`; if the stop fails the plugin is **kept**. (2) For a plugin with no headers, a process sweep finds what it started (by a tag MatchiTOOL adds to its shell commands, by a pid file, or by its command line), lists it in the Delete dialog and ends it only after you choose **Delete and stop**. (3) The firewall chains and `boot.d` scripts the host **saw the plugin create** are removed and then checked again by a separate read-only script. (4) **Turn off and stop** does the same without deleting the plugin or its data. It asks **no password** (a decision: the root gate and the approved-file rule still apply). What you saw in the dialog is what runs (plan, sweep and undo hashes; `409 plan-changed` otherwise). A sandboxed plugin can add its own stop code with `matchi.onUninstall` (Delete and stop only). **Not undone:** lines in `boot.sh`, eBPF pins, routes, properties, mounts, helper-script output and services started through Android; this protects against a forgetful plugin, not a hostile one. **Device status:** header stop and process sweep were run on the F50. The undo and Turn off and stop are compiled and unit-tested in CI and were also run on the F50 (the per-test results were not written down); the no-root / timeout path was not run on the device. See `docs/PLUGIN_STOP.md` and `SECURITY.md`.
- **Plugin integrity (compiled and unit-tested in CI, no device run recorded):** the host remembers each plugin's SHA-256 and abilities (root commands, network use, hosts, token) as approved. The list flags a plugin whose file differs ("changed since approved") or was installed before tracking ("not tracked"), with an **Approve** button. Replacing, deleting or approving a plugin asks for the sign-in password again; an update that adds an ability asks again. The store confirm names the token and network use. This is tamper evidence, not protection from a running plugin. See `SECURITY.md`.
- **Session cookie (compiled and unit-tested in CI, no device run recorded here):** the sign-in token is an HttpOnly, SameSite=Strict cookie and is no longer in the login reply, so page script and plugins cannot copy it. Requests need the cookie plus the page's `x-token` marker header (CSRF rule). **Changes you will notice:** everyone signs in once after the update, a new browser tab asks for the password, sign-out signs out every tab, and scripts that read `token` from `/api/login` stop working. A plugin can still call routes through the open session. See `SECURITY.md`. Also: plugin records are now written under a lock. **Installing any plugin now asks for the sign-in password**, new names included (before, only replacing did), so a running plugin cannot install a copy of itself or send its own "force" to skip the risky-code prompt; importing several plugins asks once per plugin.
- **Sandboxed plugins (Kotlin compiled and unit-tested in CI, not run on a device):** a `.js` plugin can be switched to **Sandbox** (shield button on its row; password asked). It then runs in an isolated frame with no page, session or `/api` access and reaches the console only through a bridge that grants what its `// @matchi-needs` header lines declared and you approved (read-only AT, named router fields, exact root commands, hosts). A changed file loses those permissions until Approve. Trusted stays the default; UFI-TOOLS plugins that need the page will not work sandboxed; restored backups come back trusted. The host re-checks the stored approval on every sandboxed call (`POST /api/plugins/call`), so a file changed after the page loaded is refused at once. See `docs/PLUGIN_SANDBOX.md`. Tested in Chromium against a mock host.
- **Network filter defaults:** the browser allow-list no longer includes `dns.google`, `checkip.amazonaws.com`, `api.ipify.org` or `www.cloudflare.com` (a DNS-over-HTTPS resolver is a data-leak route; the public-IP check runs as a root shell script and never used the list). GitHub stays for the plugin store. A plugin of your own that needs one of the removed hosts must be added under Plugins > Network rules. `SECURITY.md` now says the filter limits the browser only, not the root shell.
- **Bypass removed (this one-time cleanup was removed again in 1.4.2):** at boot, lines naming "bypass" are taken out of `boot.sh` one time only, tracked by `.bypass-cleanup-done` (copy kept as `boot.sh.pre-bypass-removal`). Other firewall / TTL lines are not touched.
- **Boot skip reasons (compiled in CI, not run on a device):** `events.log` now says why a boot file was skipped (`symlink`, `owner uid N (must be root)` or `stat failed`) instead of the generic message.
- **Log basket / Log Catcher:** one list of every log, search, filter chips, live view, snapshot ready for an update, plugin-aware logging.
- **Code and build:** `WebServer.kt` split into `WebRoutes*.kt`; one version source (`version.properties`); route-gate table test; release builds shrink with R8 (shrink only); `validate.sh` slimmed (old grep checks live in `check_sources.py`).
- **Web UI:** more of the page in `web-src/`; accessibility pass (dialogs, focus, keyboard); safe-HTML helper and innerHTML check; English / Filipino language switch for fixed labels.
- **Found on the F50 (11 Nov 2026) and fixed:** reloading after Sign out answered "BAD REQUEST ... HTTP verb {}GET unhandled" (the unread `{}` body of `/api/logout` was read as the next request; the log start / stop routes now drop their body too); the sign-in card shrank after Sign out; the dashboard (Live device status, Radio settings, Cell lock, tool buttons) now follows the Filipino switch, dynamic messages and tool windows still stay English; `Quad` made `internal` (compile error from the WebServer split).
- **Docs:** README trimmed; stale notes merged into `SECURITY.md` and `docs/TESTING.md`; this changelog shortened.
- Run on the F50 on 15 Nov 2026, all passed: the AT & Radio window rewrite, the Performance mode button, the Radio dashboard changes, dialogs and the language switch (list in `docs/F50_CHECKLIST_1.4.1.md`). The Kotlin of the WebServer split compiles in CI.

# MatchiTOOL 1.4.0 - UFI-TOOLS plugin support

- Phases 1-4: plugin format and manager, UFI runtime API and paths, modem data and router API, bundled tools (`jq`, `sha256`, `zreq`), plugin store, security pass.

# MatchiTOOL 1.3.9

- Bundled arm64 `curl`, so plugins that download files work.

# MatchiTOOL 1.3.8

- Log Catcher: private data is hidden in single-file exports and copies too; keep-every-line switch.

# MatchiTOOL 1.3.7

- Boot capture (Magisk / KernelSU / APatch): logcat and dmesg written at boot with a disk cap. Log redaction (`Redactor.kt`), full bundle export, boot-log viewer. Log Catcher fixes.

# MatchiTOOL 1.3.6 - 1.3.3

- Log Catcher: recovery of interrupted sessions, device-wide capture, live stream, search, export, no replay / flooding (1.3.6); logcat capture for the whole process and paired `.log` / `.txt` files (1.3.5); session file created before "active" is reported (1.3.4); direct `.log` export and start-acknowledgement check (1.3.3).

# MatchiTOOL 1.3.2 - 1.3.0

- Lower Log Catcher polling (1.5 s to 3 s); collision-resistant session IDs, logcat started only after the session file exists (1.3.0).

# MatchiTOOL 1.2.x (1.2.0 - 1.2.33)

- **1.2.33 - 1.2.28:** review fixes. One `rootGate()` guards every root-capable call (1.2.28); batched, bounded Log Catcher UI updates.
- **1.2.27:** console login lockout, boot scripts each get their own time limit, IMEI keeper at boot, plugin erase safety, upload limits, audit log, LAN firewall no longer opens the upstream interface, several fixes for the router password and root re-check.
- **1.2.26:** root and console hardening: spare lane for short root commands, boot scripts run only from root-owned files, loopback logins delayed rather than locked.
- **1.2.25 - 1.2.24:** fixes for Bypass coming back after Stop (Bypass is removed since 1.4.1).
- **1.2.20 - 1.2.19:** Change IP and CPU Governor built in.
- **1.2.15 - 1.2.13:** UFI-TOOLS plugin host compatibility; OTA check first, reinstall and rollback allowed; tools merged into Live device status.
- **1.2.11 - 1.2.4:** compact console layouts for phones and PC.
- **1.2.3 - 1.2.1:** update fix for "The APK has no valid signature"; per-login sessions with a Sign out button and release builds (1.2.2); HTTPS with a self-signed certificate (1.2.1).
- **1.2.0:** Advanced Network Diagnostics and a read-only device monitor; stability-first integration.

# MatchiTOOL 1.1.x (1.1.0 - 1.1.54)

- **1.1.54 - 1.1.52:** bounded root output, at most two concurrent root commands, thermal-aware polling, root status endpoint.
- **1.1.49 - 1.1.48:** router password encrypted with the Android Keystore, defensive response headers, same-origin check, plain-HTTP warning.
- **1.1.47:** one permanent signing key and OTA update from an https link.
- **1.1.46 - 1.1.31:** lighter Live Status, Screen control, IMEI handling, SMS send / delete fixes, router API port auto-detect.
- **1.1.30 - 1.1.14:** native app redesign, Live device status, diagnostics and Full diagnose, tools built into the web page, USB mode switching.
- **1.1.13 - 1.1.0:** admin password login, LAN access, USB Ethernet modes, security and servicing foundation.

# MatchiTOOL 1.0.1 - 1.0.0 (2026-11-05)

- 1.0.1: product identity and artifact naming standardised as MatchiTOOL.
- 1.0.0: forked the Android host; UFI `socat` bridge replaced by an optional direct `su -c sh` backend.

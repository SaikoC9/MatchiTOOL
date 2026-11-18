# MatchiTOOL 1.4.4 - full notes (moved here from CHANGELOG.md)

- **Added, plugin API for protected web pages:** `matchi.gate.open(name)` opens the plugin's gated page in a new tab (tab opened inside the click, one-time ticket from `/api/gate/open`, resolves to `''` or an error text, never throws). A plugin whose `@matchi-gate` line is broken (bad port, unknown field, second line, or in an `.html` plugin) is refused at upload with the reason (`gateUploadProblem`). New author page `docs/PLUGIN_GATE.md` and a row in `docs/PLUGIN_HEADERS.md`. Not available to sandboxed plugins. Tests: `scripts/test_plugin_api.js`, `GateDeclTest`.
- **Changed, generic web gate for plugin web pages (Android side):** any plugin can now declare one protected local web page with a header line `// @matchi-gate name=adguard port=3000 logout=/control/logout idle=3600 tabclose=off` (only `name` and `port` are required; an unknown field, a bad value or a second line makes the declaration invalid and nothing opens). New route `POST /api/gate/open` `{"name":"adguard"}` (root gate) reads the declaration from the INSTALLED, enabled plugin file whose approved file is not marked changed (never from the request), starts that gate on first Open on a port MatchiTOOL picks from 3100-3199 and remembers per name, and returns a one-time ticket and the port. The target port must be 1024-65535, not the console port and not in 3100-3199. At most 4 gates listen at once (a gate nobody is logged in to is stopped to make room). `WebGate` replaces `AghGate`; sign-out, password change and host start end every gate login; deleting or switching off a plugin stops its gate. Each gate now has its own browser cookie name (`matchi_gate_PORT`), because browsers share cookies between ports and two gates would otherwise log each other out. `/api/agh/gate` stays for one release with the built-in AdGuard Home declaration (its port is now the one in the reply, not 3001). New `GateDecl.kt` (parser and port table, plain JVM) with `GateDeclTest`; two more `WebGateProxyTest` cases. The Android parts were not compiled or run on a device.
- **Changed, AdGuard Home web page now asks for its login every time:** the page's own login cookie (fixed expiry) no longer reaches the browser. New generic `WebGateProxy` (own config: target port, logout path, idle, optional tab-close logout) and the AdGuard wrapper `AghGate` listen on port 3001 (started on first Open, nothing listens before) and forward to 127.0.0.1:3000; the AdGuard Home cookie is kept on the router and the browser only gets a session cookie that works while the console session lives. AdGuard Home is logged out (`/control/logout`) on console sign-out, session expiry, password change, host start, after the idle time (1 h for AdGuard Home) and, when a gate turns `tabClose` on, when the last page of the tab closes (pagehide beacon, 6 s grace) or no page pinged for 150 s. AdGuard Home runs with `tabClose` off (LuCI-style: session cookie, idle timeout, logout). New route `/api/agh/gate` (root gate) returns a one-time ticket (60 s, bound to the caller address). Plugin 0.9.7 opens the page through it. `WebGateProxyTest` (28 tests, fake page, fake clock) passes on a plain JVM; the Android parts were not compiled or run on a device.
- **Fixed, AdGuard Home web page stayed reachable after a console sign-out:** the page on port 3000 has its own login cookie (30 days by default). Port 3000 is now closed to the hotspot by the iptables chain `AGH_UI`; `/api/agh/door` (new, root gate) opens it for the signed-in device only, and `AghDoor` closes it on sign-out, session expiry, password change, after 30 minutes and at host start. Plugin 0.9.4 builds the chain, restores it (watchdog, boot), sets the yaml `session_ttl` to 1h and asks for the door when you press Open. Not run on a device yet.
- **Changed, Change IP rewritten as MatchiTOOL's own tool (the UFI plugin version is gone):** the button now opens a window that shows the local (mobile-data) and public address first, then "Change IP" runs the switch and shows old → new. Mobile data off, wait for the link to drop and on again (3 tries) is ONE root script, so data is switched back on even if the page stops waiting; if the script does not report back, the page turns data on itself and says so. Address checks are strict (each part 0-255, so an error page is never taken for an IP). The public lookup tries two services and curl or wget. The logic is in `web-src/changeip-core.js` with `scripts/test_changeip.js` (runs the scripts in a real sh with fake svc / ip / curl; in validate.sh). The button id, file name and self-test are unchanged. Not yet tried on the F50.
- **Changed, Memory Cleaner rewritten as MatchiTOOL's own tool (the UFI plugin version is gone):** the button now opens a window that scans first and lists the user-installed apps running now with the memory each holds (biggest first). You tick what to stop; unticked apps are remembered in the browser. The app on screen, the launcher, the keyboard, MatchiTOOL and tunnel / proxy / root apps are never listed, and the foreground check runs again right before stopping. "Also release cached memory" (drop caches + compact) is optional. It shows available memory before and after in the window. Removed from the old flow: the packages file in a root temp folder, `am kill-all`, and the lasting changes to `vm.swappiness` and zram (`idle`, `writeback`). The logic is in `web-src/memclean-core.js` with `scripts/test_memclean.js` (in validate.sh). The button id, file name and self-test are unchanged. Not yet tried on the F50.
- **Fixed, the bundled `sha256` helper hashed the file PATH, not the file:** `sha256 FILE` ran `printf '%s' "$1" | sha256sum`, so every plugin that checked a download got a wrong hash (the AdGuard Home install refused a good 11.4 MB package: `sha256sum` gave the official hash, the helper gave another). It now hashes the content of a readable file, the text of any other argument, or standard input. New test `scripts/test_sha256_tool.sh` (run by `validate.sh`); hash in `NOTICE.md` updated.
- **Fixed, the bundled curl wrapper had a syntax error (every `matchi.sh` curl call failed):** the `for c in ...` line in the wrapper text that `plugin-host-api.js` writes to `/data/local/matchitool/bin/curl` had no `;` before `do`, so the shell stopped with `curl[3]: syntax error: unexpected 'if'`. Found by the AdGuard Home preflight on the F50 ("GitHub reachable: No answer"). The wrapper is rewritten on the next plugin call after the page reloads, so no reinstall of the wrapper is needed. `scripts/test_plugin_api.js` now runs the wrapper text through `sh -n`, and the test fails on the old text.
- **Fixed, Network changes that "sometimes do nothing" (MTU / MSS, DHCP pool / lease and router IP, Wi-Fi band, Wi-Fi settings):** the router answers a change it did not accept (lost sign-in or token) with an EMPTY reply, the same reply it gives when it did accept it. The window took the empty reply as "sent", waited about 3 minutes for a restart that never came, and then said \"The router is back but reports MTU 1500 and MSS 1460, not the wanted 1500 / 1449\". Now all four send through one function (`sendTaken` in `net-tools.js`): after an empty reply the router gets up to 30 s to show that it took the change (the console stops answering, or a read already shows the wanted values); if not, the same command is sent again with a fresh sign-in, then with the older token form (3 sends at most, a reply of \"success\" is never repeated). When the router still ignores it the window says so at once (\"The router ignored the change ... nothing changed\" plus the saved-password hint) instead of waiting. A router that really restarted with the old values still gets \"is back but reports ...\"; one that never restarted says \"never restarted ... not applied\". The DHCP / router IP pending note is removed when the change was ignored. `scripts/test_net_tools.js` now expects one restart-send function; `scripts/test_net_tools_ui.js` covers ignored, taken on the second send, restarted with old values, and a lost sign-in. Not run on the F50.
- **Fixed, wrong result line after an MSS-only change that did not apply:** \"MTU was not changed, only MSS.\" was printed even when MSS had not changed either. It is now printed only when the router really reports the new values.
- **Changed, Bypass folders renamed (no more UFI name):** `PluginPaths.kt` now protects `matchi_ttl`, `matchi_dpi`, `matchi_boot` and `matchi_lock` instead of `ufi_ttl`, `ufi_dpi`, `ufi_boot` and `ufi_lock`; `PluginDataTest.kt` and the README follow. The Bypass plugin v65.25 uses the new folders and moves an existing install over once (settings and boot entry kept). Firewall chain names are unchanged. Kotlin not compiled here (CI must); the move script was tested in a fake folder tree, not on the F50.
- **Fixed, Radio settings and Cell lock did nothing ("Router refused the change ()", "Unlock sent, but a lock is still listed"):** the router answers a change it did not accept (lost sign-in, no valid AD token, password not saved) with the same EMPTY reply the F50 gives for a change it did accept, so the page could not tell them apart. `radio-core.js` now judges an empty reply by the read-back and, when nothing changed, sends the same (idempotent) call again with a fresh router sign-in (`retry` 1), then with the older AD token form (`retry` 2). A reply of "success" is never repeated; text such as "failure" is still refused at once. **Network mode** and **band lock** now take an empty reply the same way (they used to throw "refused ()"). When all three tries change nothing the card says so and why: "no router admin password saved, sign in to the web console once" or "ignored even after a fresh sign-in, reboot". New `setConfirmed`, `setNetMode`, `emptyHint`; tests added in `scripts/test_at_radio.js`. Page only, no Kotlin change. Not run on a device.
- **Changed, UFI removal stage 4 (Kotlin not compiled here, CI must build it):** removed the UFI alias routes `/api/root_shell`, `/api/one_click_shell` and `GET /api/AT`, `WebServer.ufiShellReply`, `AtBatch.checkCommand` / `checkSlot` / `ufiText` and their tests. `/api/user_shell` now answers `{success, content}` like `/api/shell`; `matchi.user` / `runShellWithUser` read that shape. The page's HTTP confirm now covers `POST /api/at` writes (it covered `GET /api/AT`). `formatBytes` rewritten. Comments and docs no longer name UFI-TOOLS; the ZteClient AD token comment now describes the router's own scheme. Memory Cleaner no longer protects `com.minikano.f50_sms` / `kano_at_daemon`. **Deleted:** `LICENSE-UFI-TOOLS`, `docs/AT_RADIO_UFI_PLAN.txt`, `docs/PLUGIN_STORE.md`, `scripts/test_phase0.js` and the UFI scan / store / globals scripts in `scripts/phase0/`. A line-by-line comparison against the UFI-TOOLS `main` and `http-server-version` branches found no shared code except `formatBytes` (rewritten).

- **Changed, UFI removal stage 3 (Kotlin; not compiled here, CI must build it):** removed `UfiPathMap.kt` (no more rewriting of `/sdcard/ufi_tools_boot.sh` or `/data/data/com.minikano.f50_sms` in shell commands), `GatewayProxy.kt`, and their tests. **Routes removed:** `/api/goform/*`, `/api/proxy/*`, `/api/get_cookie`, `/api/set_cookie`, `/api/upload`, `/api/upload_img`, `/api/uploads/*` (nothing on the page called them since stage 2). `ZteClient` lost `proxy`, `sessionCookie` and `setSessionCookie`. Kept on purpose: `ZteClient` and `NetGoform` (`/api/zte` uses them), `SessionCookie.kt` (it is MatchiTOOL's own sign-in cookie), the upload slot and free-space check (the app-update upload uses them). `PluginLog` no longer tags the removed routes; `matchi_logd.sh` no longer lists UFI-TOOLS files or processes in its boot context. `scripts/test_route_gates.py` and `scripts/check_sources.py` now fail if the removed routes or files come back. **Known consequence:** a plugin that hard-codes a UFI path now gets that path as written.

- **Changed, UFI removal stage 2 (web page only):** MatchiTOOL now has its own plugin API, `window.matchi` (`toast`, `modal`, `root`, `user`, `hasRoot`, `copy`, `menu`, `router.get/set`, `sh`, and small helpers; `web-src/plugin-host-api.js`). **Removed from the page:** the UFI plugin file format (`KANO_PLUGIN` blocks, Export / Import UFI .txt, HTML-block plugins), the `UFI_DATA` poller, the plugin store (`plugin-store-ui.js`, `plugin-store-pure.js`), `uploadFileKano`, `downloadUrl`, `getData` / `postData` / `login`, `window.t`, `__matchiCompat` (now `matchi.sh`) and the AdGuard link fix `pluginLanFix`. The plugin menu anchors are now `#matchi_menu_btn` and `.matchi-menu-box`. A plugin is one `.js` file; adding one now shows a text-search summary (root or user shell, tools, risky patterns, stop lines) before the confirm. **Behaviour change:** a plugin written for the UFI helper names (`createToast`, `runShellWithRoot`, `getData`, `UFI_DATA`, `__matchiCompat` ...) must be ported to `matchi.*`; an installed HTML-block plugin is listed but not loaded. Tests: the four `test_ufi_*.js` are replaced by `test_plugin_api.js` and `test_plugin_meta.js`; `check_sources.py` now fails if UFI code returns to the page. Kotlin is untouched (stage 3). `validate.sh` passes.
- **Changed, bundled `curl` is now a reproducible build:** `build-binaries.yml` fixes the build date (`SOURCE_DATE_EPOCH`) and strips build paths and the build id, so two runs with the same tags give the same file. New sha256 `4c063298...d2b3` (replaces `8dda0f11...3bc`, which was not reproducible). Same source (curl-8_11_0, OpenSSL 3.0.15). Check on the F50 before release: https to example.com = 200, Bypass public IP check.
- **Fixed, `zreq` with no port in `-ip` failed on the F50:** it used port 80, which the F50 refuses (its web server is on 8080; found with `zreq_f50_test.sh`). Without a port it now tries 8080, then 80 (first one that answers HTTP); an explicit `-ip host:port` is used as given. New test `TestNoPortPicksTheAnsweringPort`. **Built by CI (go vet + go test passed): sha256 `8dc2144a...3da2`, installed in `assets/bin/zreq`, pinned in `NOTICE.md` and `docs/BINARIES.md`.**
- **Fixed, Radio restart printed errors for slot 1:** the F50 has one SIM slot, so slot 1 showed "Shell error: no modem AT device found". The on-device script now skips a slot that sendat has no device for (log: "slot 1: not present on this device, skipped") and never sends it `AT+SFUN`. The first log line no longer says "as UFI-TOOLS does". `scripts/test_at_radio.js` has a new one-slot case. Confirmed on the F50 before this change: slot 0 off/on OK, `DATA:ok`.

- **Fixed, `sendat -n 1` no longer writes to the RIL's port:** the F50 has one SIM slot, and slot 1's last guess, `/dev/stty_nr1`, is held by `urild`. Every "Radio restart" sent `AT` and `AT+SFUN=5` / `4` to it (log: `OFF1: timeout waiting for modem reply`, and `ON1` "OK" taken from the RIL's own `+COPS` / `+CNEM` lines). It is removed from the slot 1 defaults, so `-n 1` now says `no modem AT device found for slot 1`; a `1=` line in `sendat.conf` still works. The restart script needs no change: a slot that does not switch off gets one `AT+SFUN=4` try and is not counted. New test `TestSlot1NeverDefaultsToRILPort` (`go vet` and `go test` pass here). **Built by CI (go vet + go test passed): sha256 `1ec33c20...c103`, installed in `assets/bin/sendat`, pinned in `NOTICE.md` and `docs/BINARIES.md`.** Confirmed on the F50 first: with `sendat.conf` moved aside `sendat -n 0 -c AT` = OK, and a radio restart ends `DATA:ok` (about 26 s, 0% loss, no toggle).
- **Fixed, `zreq` sign-in used the wrong password form for the F50:** it only sent base64 or the raw password, but the F50 firmware wants `SHA256(SHA256(password) + LD)` (what `ZteClient` already does). New default `-enc auto`: ask `cmd=LD` first and use the challenge form when the router gives an `LD`, base64 only when it answers without one (older firmware); `-enc ld` demands the challenge. A network error or HTTP 5xx on the challenge stops with exit 2 and posts no login (a busy router never gets the weak form, and nothing counts toward a lock). Still one sign-in attempt, never retried. `-enc` is checked before any request. Version is now `zreq 1.1 (MatchiTOOL)`. 5 new tests plus the existing ones pass. **Built by CI (go vet + go test passed): sha256 `8dc2144a...3da2`, installed in `assets/bin/zreq`, pinned in `NOTICE.md` and `docs/BINARIES.md`.** Device test: `scripts/zreq_f50_test.sh` (finds the web port by `cmd=LD` with no password; one sign-in only when `ZPW` is set).

- **Changed, bundled `zreq`:** the UFI-TOOLS binary is replaced by MatchiTOOL's own Go build (`zreq 1.0 (MatchiTOOL)`, static arm64, sha256 `89948a9f...e2458`, pinned in `NOTICE.md` and `docs/BINARIES.md`). **Behaviour change:** it has no built-in router password (the old one signed in with UFI-TOOLS' default when none was given); sign-in only with `-pwd`, `-pwd-file` or `ZREQ_PWD`; `-ip` must be a private or loopback IPv4. Source is in `tools/zreq/`, built by `.github/workflows/build-zreq.yml`. Checked here: ELF is arm64 static, flags and strings read from the file, `scripts/check_repo.py` passes. Not run on a device.
- **Changed, release build is now obfuscated and optimised:** `proguard-rules.pro` no longer sets `-dontobfuscate`/`-dontoptimize`. R8 renames MatchiTOOL's own classes and members and removes dead code in release builds (unchanged: NanoHTTPD is still fully kept, `isDebuggable` stays false, `isMinifyEnabled`/`isShrinkResources` were already on). Checked before this change: no `Class.forName`/reflection, no Gson/Room/Dagger or other annotation-driven lookup; the only app classes ever read by `javaClass.simpleName` in a log line are JDK/Android exception types, never a type MatchiTOOL defines, so no app-specific `-keep` was needed for that. The three manifest components (`MainActivity`, `HostService`, `BootReceiver`) are kept by AGP's own default rules. `SourceFile`/`LineNumberTable` are kept and the source file name is replaced with a fixed string (`-renamesourcefileattribute`), so a Log Catcher trace still shows a file and line number, but reading it back to the real class/method needs that exact build's `mapping.txt`. CI (`build.yml`, `release.yml`) now uploads `mapping.txt` as a private build artifact named with the build's `versionCode`; neither release workflow attaches it to the public releases repo. Not run on the F50 (no Android SDK here to build the APK); CI must confirm the app still starts and the web console still works end to end.
- **Fixed, `curl` https failed with `(60)` when a plugin called the raw binary:** the bundled curl (OpenSSL 3) cannot read Android's hashed cacerts folder, and only the wrapper at `/data/local/matchitool/bin/curl` worked around it. Plugins that use the UFI path (`/data/data/com.minikano.f50_sms/files/curl`, for example Bypass's public IP check against `api.ipify.org`) are rewritten by `UfiPathMap` to `files/curl`, the raw binary, and still failed (checked on the F50: raw `(60)`, wrapper `200`). `RootShell.run` now puts `CurlCa.prelude()` in front of every root script: it builds `/data/local/matchitool/bin/cacert.pem` from `/apex/com.android.conscrypt/cacerts` (else `/system/etc/security/cacerts`) when it is missing or older than the store, and exports `CURL_CA_BUNDLE`. A caller's own `CURL_CA_BUNDLE` or `SSL_CERT_FILE` is kept, and `--cacert` / `-k` still win. It covers the raw binary, the UFI path, the wrapper, and `boot.sh` / `boot.d`. New `CurlCa.kt` and `CurlCaTest.kt` (9 tests run the real prelude in the host `sh`, pass here). `RootShell.kt` is not compiled here (CI must). Not yet run on the F50 with the new APK.
- **Changed, `sendat` slot 0 default port (bug 3):** the built-in guess list for slot 0 now starts with `/dev/stty_nr6`, a port nobody else holds on the F50 (`stty_nr0..5` belong to `urild`), so `sendat -n 0 -c AT` needs no `sendat.conf` and no longer lands on the RIL's `stty_nr0` by default. `stty_nr0` stays last as a fallback. **Slot 1 is unchanged** (`stty_nr1` is still the guess, and it is held by `urild`): its free port is not known yet, so run `sendat -probe` and `-n 1 -c AT` on the F50 and send the output; until then pin it in `sendat.conf`. That `stty_nr6` answers `AT` is NOT yet proven, only that it is free: check with `sendat -d /dev/stty_nr6 -c AT`. New test `TestDefaultSlot0StartsWithFreePort`. **Built by CI (`go vet` and `go test` passed):** new binary sha256 `341bfb4d...e9342e` (static arm64, `/dev/stty_nr6` and the probe skip checked in its strings) is in `app/src/main/assets/bin/sendat`; `NOTICE.md` and `docs/BINARIES.md` carry the hash. Not run on the F50 yet.
- **Fixed, `sendat -probe` no longer writes to ports other processes hold (bug 2):** on the F50 `urild` (the RIL) holds `stty_nr0..5`, `cplog_svc` holds `stty_nr28` and `engpc` holds `stty_nr31`; the probe wrote `AT` to every `stty_*` port, which may be what dropped mobile data after a radio restart (not proven; bug 1 fixes the symptom either way). `-probe` now asks `/proc/<pid>/fd` (root) who has each port open and skips a port held by another process (another `sendat` does not count), and it also skips that fixed list as a fallback when `/proc` shows nothing. Each skipped port is listed with the reason (`skipped, held by urild (pid 123)`). New flag `-probe -all` tries them anyway. Normal calls (`-n 0 -c AT`) are unchanged. New tests in `main_test.go` (`TestKnownHeld`, `TestFindHolders`, `TestProbeListSkipsHeldPorts`); `tools/sendat/README.md` updated. **Built by CI (`build-sendat.yml`, Go 1.22.8): `go vet` and `go test` passed.** The new binary (sha256 `f33b7aa2...b5cadf`, replaced by the bug 3 build `341bfb4d...e9342e`, static arm64, strings checked: the skip message, `-all` help and `urild` / `cplog_svc` / `engpc` are in it) is in `app/src/main/assets/bin/sendat`; `NOTICE.md` and `docs/BINARIES.md` carry the new hash. Not run on the F50 yet. Next on the F50: install, run `sendat -probe` (held ports should be listed as skipped), then repeat a radio restart and check whether data still drops without the probe.
- **Fixed, no internet after AT & Radio "Radio restart" (bug 1):** on the F50 the modem data call stayed up after `AT+SFUN=5` / `4` (`AT+CGACT?` 1,1) but Android never brought `sipa_eth0` back up (no IPv4 address) until `svc data disable; sleep 3; svc data enable` was run by hand. The on-device restart script (`CYCLE_SH` in `radio-core.js`, used by AT & Radio, band lock and cell lock) now ends with a data check: when at least one slot confirmed "on", it waits up to about 36 s for the internet to work (a root `ping -c 1 -W 2` to 1.1.1.1 or 8.8.8.8); if it does not, it does the toggle, then waits up to about 24 s more. It prints `DATA:ok` / `toggled` / `none` / `off` / `skip` (and a `NET:` line with the number of IPv4 addresses on `sipa_eth0`) and the log line says which. **First version was wrong and is fixed here:** it tested `ip -4 route show default`, which is EMPTY on the F50 even while the internet works (checked on the device, 17 Nov 2026: curl 200 with no default route listed), so it always toggled and reported `none`; a test now fails if the script ever asks for a default route again. **Safe:** it never switches mobile data ON for an owner who turned it off (`settings get global mobile_data` = 0 gives `DATA:off`), does nothing when the radio did not come back, and does nothing when the ping works. The script timeout is 110 s (was 60 s; `/api/shell` caps at 120 s). The restart's true/false result does not depend on the data check. `test_at_radio.js` runs the real script in the host `sh` with fake `sendat` / `ip` / `ping` / `settings` / `svc` (6 cases) and checks the log lines. Device run of the first version: radio back on slot 0, internet working after it (ping 0 % loss, new address on `sipa_eth0`), but it is not known whether the toggle was needed. Run the new version and read `DATA:`.
- **Changed, Live Status polling:** a new install starts in Eco (a saved choice is kept). In Normal the live CPU loop reads every 3 s instead of back to back; Fast still reads continuously. The root command text is unchanged.
- **Changed, fewer repaints:** the Live Status card and window rewrite their markup only when it actually changed.
- **Changed, idle timers:** the 1 s Live Status tick does nothing while the page is hidden; the host ping runs every 30 s and never while hidden (it still runs when the page comes back).
- **Removed:** the temporary `[live-phase0]` timing logs, and the unused `WAKE_LOCK` permission (no code takes a wake lock).
- **Added, Live panel real-time plan, Phase 1 (not used yet):** `LiveSampler.kt` is one long-lived root reader that prints one line a second (CPU counters per core, per-core speed, kernel thermal zones, and every 5th round memory, load and uptime) instead of a new `su` for every read. CPU % comes from the difference between two lines, so the 0.5 s sleep is gone. It restarts a shell that ended (1, 2, 4, 8, 16, 30 s back-off), does not ask again while root is in its refusal cool-down, and ends its loop when the app goes away (and after 3600 rounds). Nothing starts it and the page is unchanged: Phase 2 (push route) and Phase 3 (run only while watched) come next. New `LiveSamplerTest.kt` (parser, percentages, restart, back-off, stop; it also runs the real script in the host `sh`). Battery is untouched. Not run on the F50.
- **Added, Live panel real-time plan, Phase 2 (not used by the page yet):** `GET /api/live/stream` pushes the sampler's readings as server-sent events (same kind of route as `/api/logs/stream`, read with `fetch` and the `x-token` header). The first frame is a full picture; later frames carry only what changed (CPU %, per-core %, per-core speed, thermal zones, and memory / load / uptime when they are re-read), a full frame is repeated every 30 frames and after a dropped one, and every frame has the sample time. A stuck reader is reported once as `event: stale`, a closing stream says why (`event: end`, reason `session` or `lifetime`). **Security:** the route starts a root process, so it has the same gate as `/api/shell` (`rootGate`: HTTPS or the confirm header, sign-in younger than 4 h); the session is checked again every 5 s while it streams, so signing out, a password change or a 4 h sign-in ending stops the root reader at once; at most 4 streams at once (429 beyond that), each ends after 20 min; refused with 403 `root-denied` while su is in its refusal cool-down; one audit line per client per minute. The sampler starts with the first viewer and stops when the last one closes (Phase 3 adds the grace time and the hidden-tab rule). New files `LiveStream.kt` (frame encoder, stream, viewer counting) and `LiveStreamTest.kt`; `scripts/test_route_gates.py` and the page's route list know the new route. The page is unchanged and battery is untouched. Kotlin not compiled here (CI compiles it); not run on the F50.
- **Added, Live panel real-time plan, Phase 3 (run only while watched; the page does not use it yet):** the root reader now runs only while somebody is looking. (1) The last viewer leaving, or hiding its tab, does not stop the reader at once but after a 10 s grace time, so a reload or a quick tab switch does not start `su` again; a viewer who comes back in time cancels the stop. (2) New `POST /api/live/view` `{"id":..., "visible":true|false}` (same gate as the stream; the stream's id comes in the `X-Live-Id` response header; only the session that opened the stream may change it, anything else is a 404): a hidden tab does not count, and a hidden stream is not reported as `stale`. (3) A new or visible-again viewer gets the last reading as its first frame at once (full frame, real sample time), when it is younger than 60 s; an older one is not sent as if it were new. (4) `HostService.onDestroy` ends every stream and the reader. (5) If building the response fails the stream is closed, so a slot and the root reader cannot leak. Phases 1 and 2 were re-checked first (`validate.sh`, the reader script run in a real `sh`) and needed no change. New tests in `LiveStreamTest.kt` (grace time, come back during it, hidden tab, other session, ids, cached frame, old cache, no stale for hidden, shutdown). Battery untouched. Kotlin not compiled here (CI compiles it); not run on the F50.
- **Changed, Live panel real-time plan, Phase 4 (the page uses the push stream):** in **Normal and Fast**, while the phone is cool, the Live panel subscribes to `/api/live/stream` and shows CPU %, per-core %, per-core speed, thermal zones, memory, load and uptime as they are pushed (about once a second). The separate CPU loop (`tickCpu`, a new root shell per read) is skipped while the stream is fresh, so the heat from that loop is gone. The router read (signal, speed) and the slow root read (battery, charging, telephony fallback) are **unchanged**, as are the battery tile, `batLow()` and the "pause when battery is low" option; the slow read's CPU / temperature / memory numbers are replaced by the newer pushed ones. **Fallback:** Eco, a warm or hot phone (it must stay cool for 60 s before the stream is used again), a paused battery, a radio restart, plain HTTP and "Live refresh: Off" use the old polling; a stream that drops, goes quiet for 6 s or sends `event: stale` hands back to polling at once (retries after 5 s, then 10, 20, 30 s; 30 s after a sign-in end), so the panel never goes blank. **Hidden tab:** the page tells the host (`POST /api/live/view`) when the tab is hidden or shown, so the root reader can stop. The header shows `· device 0.4 s ago` while the stream is fresh. New `scripts/test_live_stream.js` (in `validate.sh`) runs the page's stream block against a fake clock and fake stream; the old live tests are unchanged and still pass. `CPU_LIVE_CMD` stays (used by the polling fallback and matched with `RootGate.kt`). No Kotlin change in this phase. Not run on the F50.
- **Changed, Live panel real-time plan, Phase 5 (heat guard on the real thermal zones):** (1) The heat level that slows the Live panel now comes from the kernel thermal zones only (SoC max, and the modem zone read 10 C higher), no longer from the battery sensor, which some F50 builds report as a fixed 25.0 C. 60 C is warm, 70 C is hot; it goes back down only under 57 C / 67 C (hysteresis, so a phone on the limit does not flap). With no zone reading the last level is kept. The banner ("Device is warming up" etc.) is unchanged and still uses the battery temperature. (2) The push stream is no longer closed when the phone is warm or hot, and the 60 s hold is gone: the temperatures come through it, so the card keeps seeing the phone cool down. What the guard changes is the repaint rate: warm repaints at least every 2 s, hot at least every 5 s, and a hot phone shows a small `· cooling` note in the header. Frames are always applied, so the newest values are on screen at the next paint. (3) The refresh chips are labelled **Live** (was Fast, 1 s), **Balanced** (was Normal, repaint every 3 s) and **Eco** (same); the saved choice and the polling fallback speeds are unchanged. `liv_thermal_test` still forces a level. **Limits, stated plainly:** the root reader on the phone still prints one line a second at every level (changing that needs a Kotlin change, not made here), so the guard saves page work and, in Balanced, repaints, not the reader's own cost; and the 60 / 70 C limits are the plan's proposal, not tuned on the F50. Tests: `test_live_poll.js` (levels, hysteresis, modem offset, battery ignored) and `test_live_stream.js` (stream stays open when hot, repaint rate per mode and heat). No Kotlin logic change; one default changed (below). Not run on the F50.
- **Fixed, `LiveStreamTest` did not compile (CI log of the Phase 5 build):** `LiveHub.open(allowed, owner = "")` has the lambda first, so `h.open { true }` in the tests bound the trailing lambda to `owner: String` ("No value passed for parameter 'allowed'", about 60 errors). Added the one-argument overload `open(allowed)`; the two-argument form has no default any more. No change for the route (it passes the token) or for the tests that pass "tok". Not compiled here (no Kotlin compiler); CI must confirm.
- **Fixed, Live stream cached first frame (found in review):** a new or visible-again viewer was sent the host's last reading when it was up to 60 s old, and the page labels whatever arrives as live (`device 0.4 s ago`, `cpuAt` = now). The reader stops 10 s after the last viewer leaves, so a reading older than a few seconds could only be stale. `LiveTiming.cacheMaxMs` default is now 5 s (was 60 s); the tests that name their own limit are unchanged. Kotlin not compiled here (CI must); not run on the F50.

# MatchiTOOL 1.4.2 - full notes (moved here from CHANGELOG.md)

This release closes the three gaps listed for 1.4.2 in the 1.4.1 plugin stop work (Turn off wording, `/api/plugins/data` and the root gate, stop commands in the store dialog). Kotlin changes are compiled and unit-tested in CI. What was run on the F50 is in the "Device status" bullet at the end of this entry.

- **Changed, Turn off dialog:** when the plugin's own stop commands are listed, the dialog no longer says "Its file and its data stay". It says "The plugin file stays. Its saved data stays unless the stop commands listed below remove it." Without listed commands the old sentence stays, because nothing then deletes data.
- **Changed, `/api/plugins/data` and the root gate:** the route stays open, but its two root calls (the existence probe and the process scan that lists PIDs and command lines) run only when the root gate would let the request through. Otherwise the answer says "cannot be checked" (no `exists`, no process list) and still carries the stop plan, the undo list, the uploads and the effects, so the Delete dialog does not silently fall back to a plain delete. The route table in `scripts/test_route_gates.py` now says PARTIAL and checks that both root calls stay behind the gate.
- **Changed, store install dialog:** for a single `.js` plugin the confirm now lists the `@matchi-uninstall` commands that would run as root (each cut at 120 characters, at most 10), the `@matchi-check` command and the `@matchi-boot` paths, before the install. The page reads them with the same rules as the host (tests run the same cases on both sides). A plugin without these lines shows nothing extra; a UFI-TOOLS bundle is unchanged.

- **Fixed, in a later review:** (1) `passwordGate` now answers a wrong loopback password after the same bounded delay as `/api/login`, so a plugin on the phone cannot guess the password at full speed through the re-check routes. (2) `/api/upload`, `/api/upload_img` and `/api/update/stage` refuse a body that is not `multipart/form-data` before NanoHTTPD reads it (it keeps other body types in memory). (3) Delete + erase no longer guesses `/sdcard/<name>` or `/sdcard/<name>.ext` from the plugin name, and `checkPluginDataPath` refuses anything inside DCIM, Pictures, Movies, Music, Podcasts, Audiobooks and Recordings. (4) `gatewayParams` rejects an unparsable `Content-Length`. Kotlin not compiled; new test `mediaFoldersAreProtectedAtAnyDepth`.
- **Fixed, the parallel-guess limit now covers every "type the password again" check:** `/api/console/password`, `/api/security/net`, `/api/security/http`, `/api/zte/config` and the plugin install / replace / delete / approve / mode checks now go through one helper (`WebServer.passwordGate`): at most two checks at the same moment, the same per-address and global lockout, a bad password is counted, the same wait message. Before, only `/api/login` had the slot, so a burst of parallel guesses there could all pass the lock check before one was counted, and each guess costs a PBKDF2 run. Not compiled, not run on a device.
- **Fixed, the owner's sign-in could be refused while a router check waited:** a console login that falls back to asking the router (`ZteClient.verify`) kept one of the two password slots while it waited for the router lock (up to about 15 s if another router call was running). The slot is now handed back before the router is asked; the router budget (`LoginGuard.mayAskRouter`, 3 per address and 9 in total per 10 minutes) still limits those checks. Not compiled, not run on a device.
- **Fixed, a stale router-IP note no longer changes the saved router address:** `LanRevert.runCheck` pointed the console at the new address as soon as it answered, even when the note was older than 30 minutes, and then logged "nothing changed". A stale note is now dropped before anything is probed. Not compiled, not run on a device.
- **Changed, `/api/plugins/toggle` needs the fresh sign-in:** a plugin holding a session could switch other plugins on or off after the 4 h limit. The route is now `rootGate` like the other plugin-changing routes (no password, so "Turn off" stays quick). `scripts/test_route_gates.py` updated. `/api/uploads/delete` stays open on purpose (only files in the app upload folder, plugins use it for their own temporary files); the table now says so.
- **Checked, no change:** the new-message key `sig()` uses the first 80 characters on purpose (the modem splits long texts, so a longer or hashed key would make a message look new when the tool switches from the router to the modem). Two different texts that share those 80 characters are already counted separately, and a delete lowers the count, so no badge is lost.

- **Fixed, SMS conversation view looked odd:** the sticky bar (Back / number / Delete conversation) used a colour variable that does not exist, so it was drawn in the page's black instead of the window colour and sat on the first message with no edge. It now uses the window colour with a thin line and a soft shadow under it, so messages scroll under it cleanly. Not run on a device.
- **Fixed, SMS Delete could remove the wrong message:** the lookup of a message in the Android store or the modem took the first text that only started the same (first 30 characters) and the list is newest first, so deleting an old recurring text ("Your balance is ...") could delete the newest one. It now takes the exact text first (the closest in time when there are several), accepts a text that only starts the same only when it is also within 3 minutes, and the loose "only outgoing message with that text" rule needs the exact text. Test: `scripts/test_sms_findin.js`. Not run on a device.
- **Fixed, SMS could be sent more than once (Android send):** after Android accepted a send form the script waited 4 s for the sent box to grow and, if it did not, tried the next form, which sends again when the first one had really gone out (slow or unwritten sent box). The wait is now 10 s and after two accepted-but-unconfirmed forms it stops and answers "handed to Android, not confirmed" (the orange toast), so at most two sends can happen. Not run on a device.
- **Fixed, router set call through `GET /api/proxy/`:** a GET to `/goform/goform_set_cmd_process` through the proxy skipped the `NetGoform.OPEN_SET` list of `/api/zte` and `/api/goform/`. It now follows the same rule (a goformId not in `OPEN_SET`, or none, needs the fresh sign-in). Other GET paths stay open for read-only plugins. `scripts/test_route_gates.py` note updated. Kotlin not compiled, not run on a device.

- **Fixed:** `/api/zte/config` (POST) now needs the fresh sign-in and the current password (`"current"`) when the router address or password really changes; the lockout is shared with `/api/login`. Not compiled or run on a device.
- **Fixed:** at most two password checks from other devices run at the same moment (`LoginGuard.tryBeginAttempt`), so a burst of parallel guesses can no longer all pass the lock check before one is counted. Not compiled or run on a device.
- **Fixed:** the background SMS check is silenced per call (`quiet` option of `api()`), not with a global flag, so the person's own calls keep their dialogs and toasts while it runs.
- **Fixed:** a message that was sent to some numbers is no longer sent to them again by the fallback path, and numbers such as `+63917...;+63918...` are accepted.
- **Fixed:** the first message that arrives in an empty inbox now counts as new (after two empty checks in a row).
- **Fixed:** a text that was deleted no longer stays counted as "seen", so a new identical text from the same sender (recurring promo / balance messages) shows the badge again. The count goes down only after two checks in a row show fewer of that text (four when the whole answer is empty), so one short read does not make old messages look new. Test: `scripts/test_sms_seen.js`.
- **Fixed:** the SMS list through the modem (`atFetch`) reads the modem's character set first and puts it back at the end (it was left on UCS2, so other AT output could come back as hex). The background check in modem mode now reads Android's SMS store (read-only) and asks the modem only when that read fails, so it no longer changes the modem's text mode or the "unread" state of messages. When a root call is refused (sign-in older than 4 h, plain HTTP not confirmed) the SMS button shows the tooltip "New-message check paused: sign in again to resume". The window's own listing still uses the modem commands. Not run on a device.
- **Fixed:** the SMS tool's fixed read-only listing of Android's SMS store through `/api/shell` is logged with the once-per-minute audit line (`sms-list`) instead of one line per call (`RootGate.isSmsListRead`, exact match only), so the 64 KB audit log keeps failed logins, password and update changes. Every other shell command is still audited one by one.
- **Changed:** the router gate is now a positive list. A set call through `/api/zte` or `POST /api/goform/` needs the fresh sign-in unless its goformId is in `NetGoform.OPEN_SET` (band lock, cell lock, network mode, performance mode, SMS); a set call with no goformId is gated too. Before, only the listed Network-tool names were gated, so an unlisted dangerous name (factory reset, router password change) went through. A UFI-TOOLS plugin that sends another set call now needs a sign-in younger than 4 h.
- **Fixed:** `/api/update/stage`, `/check` and `/fetch` need the fresh sign-in like `/install` (they made the device contact any https address and store up to `ApkUpdater.MAX_BYTES`). The APK upload asks the plain-HTTP confirmation itself.
- **Fixed:** at the 16-session limit a new sign-in drops the session used least recently (the one with the oldest real request), not the first one created, so a session in constant use is no longer the one removed.

- **Fixed, AT writes were almost never audited:** `/api/at` and `/api/at/batch` logged every call with `auditBusy` (one line per client per minute), and the Live Status / AT Radio polls use that minute up, so an AT write (modem restart, IMEI, NV) usually left no line. A non-read AT command now gets its own `at-write` line (`at-batch-write` for a batch with any write); all-read calls keep the once-a-minute line. The line holds only a short hash and the length. Tripwire in `scripts/test_route_gates.py`. Not compiled, not run on a device.
- **Fixed, `/api/screen/frame` was not behind the root gate:** screen input was, but the screenshot stream (root `screencap`) worked over plain HTTP and with a sign-in older than 4 h. It now starts with `rootGate`. The Screen tool answers the "not encrypted" confirmation itself and shows the "sign in again" message through its normal error line. `scripts/test_route_gates.py` row changed OPEN -> GATE. Not compiled, not run on a device.
- **Fixed, router set call through `GET /api/proxy/` with a trailing slash:** the proxy decided "this is the set endpoint" with `endsWith("/goform_set_cmd_process")`, which `/goform/goform_set_cmd_process/` gets around (`safePath` allows a trailing slash). It now uses `GatewayProxy.isSetPath` (the name anywhere in the path, any case). New test in `GatewayProxyTest.kt`. Not compiled, not run on a device.

- **Removed:** the stale `app/src/main/assets/plugins/` folder (Device_Status, Live_Status, SMS, Signal_Info; the app never read it, the real tools are inside `index.html`) and the stray `ALL-CHANGES.patch` in the repo root.
- **Fixed:** a tab left open no longer keeps a session alive until the 12 h limit. The host restarts a session's idle timer only for requests carrying `x-active: 1`, and the page adds that header only within 60 s of a real click, key press, touch or wheel (`plugin-host-api.js`). Polls (Live Status, host ping, SMS check) do not count. A session that is only polled now ends after the 2 h idle time. New unit tests in `SessionStoreTest`. Not compiled or run on a device.
- **Fixed:** Android SMS send (`androidSendPart` / `androidSendOne`): (1) a text longer than 160 characters (70 with non-GSM characters) is cut at word borders and sent as separate messages instead of failing; if a later part fails, the whole text is not sent again through the modem; (2) the SIM is the default SMS SIM (`multi_sim_sms`, then `dumpsys isub`, then the first `mSubId`, then 1); (3) a transaction form only counts as sent when the sent box grew, otherwise the next form is tried; when the sent box cannot be read the toast says the message was handed to Android but not confirmed (orange), not "sent". Not run on a device.
- **Fixed:** the Android SMS store parser accepts a row start only when it is numbered in order, is followed by `_id=<n>, address=` and comes right after the previous row's `type=<n>`; the last row is dropped when `head -c 400000` may have cut it.
- **Fixed:** `Tls.selfTest` no longer trusts any certificate: it accepts only the exact certificate the server was started with. Not compiled or run on a device.

- **Fixed, CPU Governor window:** each cluster showed the Mode drop-down twice (a small one above the real one). The page-wide drop-down skin (`pick-ui.js`) was also wrapping the window's hidden list; the window's selects now carry `data-pick="native"` so the skin leaves them alone, and a CSS rule hides any stray copy. Not run on a device.
- **Changed, CPU Governor window:** compact layout: smaller window padding and title, core tiles show the name and the busy % on one line (then MHz and the bar), shorter Mode rows, drop-down list rows and buttons, smaller note. About 25 percent less height. No change to what the buttons do.

- **Changed, app icon:** the launcher icon is now the MatchiTOOL "M" logo (white bold M on the blue gradient, the same as the web page icon) instead of the Wi-Fi symbol. Adaptive icon: gradient background `#168CFF` to `#0751B5`, white M foreground inside the safe zone, black M for the themed (monochrome) icon. The notification icon is unchanged. Not built or run on a device.

- **Changed, Live panel CPU and CPU frequency are now real time:** a third loop reads only the per-core usage (`/proc/stat`, two reads 0.5 s apart, busy = 1 - idle / total, as UFI-TOOLS) and the per-core speed (`scaling_cur_freq`), and starts the next read as soon as the last one ends, about one update a second (was every 15 s). It does not read battery, temperatures, memory or the radio. It pauses on a hidden tab, below the battery-pause level, during a radio restart and while the slow loop is reading; a warm or hot phone uses the normal heat table (6 s / 15 s), the Eco chip uses 9 s, and failures back off 2 to 30 s. The command is fixed text: `RootGate.CPU_LIVE_CMD` / `RootGate.isCpuLiveRead` let `/api/shell` log it as one audit line a minute (`cpu-live`) instead of one per read, so the size-capped audit log is not filled. `scripts/check_sources.py` checks that the page text and the Kotlin text are identical; new unit test in `RootGateTest`. Kotlin not compiled, not run on a device.

- **Removed:** the one-time boot cleanup that took lines naming "bypass" out of `boot.sh` (added in 1.4.1 for devices that still had the old built-in Bypass tool's boot lines). No app code names a plugin any more. A device that went from before 1.4.1 straight to 1.4.2 and still has Bypass lines in `boot.sh` must delete them by hand (see `README.md` and `docs/PLUGIN_STOP.md`). `scripts/check_repo.py` no longer guards the removed code.

- **Fixed, found on the F50 (15 Nov 2026, after the Network tools):** Full diagnose no longer reports a wrong CPU build for a good arm64 `sendat` (it now reads the ELF header with `head -c`, and prints header bytes, size, hash and an `AT` test with exit code); **Restart modem** refuses to switch the radio off when no slot answers a plain `AT`; the VoLTE / VoNR toast says whether the modem refused or stayed silent; **Advanced Network Diagnostics** lists all addresses, reads default routes from every routing table, tests DNS with ping and no longer shows ping usage text for IPv6. **Cause found (15 Nov 2026):** the installed `sendat` was a zero-filled file of the right size (a copy lost at a reboot; /data is mounted `fsync_mode=nobarrier`), so it "ran" with exit 0 and printed nothing. The earlier "ELF machine 0x00" report was real, not a false reading. The host now compares `sendat`, `curl`, `jq`, `sha256` and `zreq` with the bundled copies at every start and copies a damaged one again, and forces each copy to disk (`fd.sync()`) before the rename. Full diagnose reports an all-zero `sendat` as damaged. Kotlin changed (`WebServer.kt`), not compiled here. Docs added: `docs/NETWORK_FORMATS.md`, `docs/F50_CHECKLIST_NETWORK.md`.

- **Fixed, found on the F50 (15 Nov 2026):** ticking a band chip no longer re-draws the whole Radio settings card (the Network mode drop-down flashed on every click; the chips and the two buttons now update in place). **USB:** RNDIS / CDC-ECM only changed the running `sys.usb.config`, so a reboot went back to the saved mode (ECM). New tick box **Keep RNDIS / CDC-ECM after a reboot** also writes `persist.sys.usb.config` (the old value is kept in `/data/local/matchitool/usb_persist_orig`; **Restore default USB mode** puts it back). Kotlin changed (`WebRoutesDevice.kt`), not compiled here, not run on a device.

- **Device status (F50, 14 Nov 2026, 1.4.2 build):** the Turn off dialog wording; the store install dialog (a plugin with header lines lists its stop commands, the check and the boot files before the install, one without them shows nothing extra); a reboot after the Bypass cleanup was removed (the `boot.d` script ran again, `events.log` has no cleanup line, the hotspot stayed usable); Delete and stop of a plugin with header lines (its process was found by its pid file and ended, its boot script removed, the plugin deleted); and, for the first time, the sandbox stop hook (a working hook ended its job and the plugin was deleted; a hook that never finished kept the plugin after 15 s). One oddity: after the first Delete and stop on the working-hook plugin the dialog opened a second time before the delete went through; the cause is not known and nothing went wrong. **Not run on a device:** the data route with a sign-in older than 4 h (the stale-session case); it is covered by unit tests and the route-gate table only.

# MatchiTOOL 1.4.2 (unreleased) - Live panel real-time plan, Phase 5: heat guard on real thermal zones

- **Where.** `heatLevel()` and its guard (`GUARD_UP` 60 / 70, `GUARD_DOWN` 57 / 67, `guardTemp`) sit in the DELAY block of the Live device status script in `index.html`; the repaint throttle (`MODE_PUSH`, `GUARD_PUSH`, `pushEvery`) sits in the LIVE-STREAM block.
- **Signal.** `max(sysMax, modemTemp - 10)`, both from kernel zones. Battery temperature is shown and drives the banner, but never the guard. Unknown readings keep the last level (a phone that was hot is not declared cool because a read failed).
- **Why the stream stays open when hot.** A new `su` per read costs more than one persistent reader, and the plan says never to stop the temperature read when hot. Closing the stream for heat (Phase 4) would have replaced it with the heavier polling at the moment the phone is warmest.
- **Repaint rate.** `max(mode, heat)`: Live 0 s, Balanced 3 s; warm 2 s, hot 5 s (250 ms slack so a frame that arrives a little early is not skipped). The router read and the slow root read keep the old DELAY table (6 s / 15 s router and 30 s / 90 s root when warm / hot).
- **Chips.** Live = `fast`, Balanced = `normal`, Eco = `eco`; keys in localStorage are unchanged.
- **Not done.** The host sampler's 1 s cadence is not changed by heat (Kotlin, not compiled here). The levels are not tuned: Phase 0 numbers from the F50 are still needed.

# MatchiTOOL 1.4.2 (unreleased) - Live panel real-time plan, Phase 4: the page uses the push stream

- **Where.** The block between `/* LIVE-STREAM-BEGIN */` and `/* LIVE-STREAM-END */` in the Live device status script of `index.html` (that script is not in `web-src/`). Plus four small edits: `tickCpu` returns `'skip'` while `liveFresh()`; `collectSlow` lays `liveSys()` over its result when the stream is fresh (just before `last = build()`; the battery lines are not touched); `when()` appends `· device N s ago`; the 1 s timer, the `visibilitychange` event and the start call `syncLive()`.
- **When the stream is used.** `streamWanted()`: Live refresh on, mode Normal or Fast, no battery pause, no radio restart, not plain HTTP, `heatLevel() === 0` and at least 60 s since the last close for heat, and a token. It opens only when the tab and the card are visible. Eco keeps the old polling on purpose (it is the explicit low-power choice; the default for new installs is still Eco, so a new install sees the push stream after choosing Normal).
- **Frames.** `applyFrame` keeps `{cpu, pc, fq, tz, sys}`; a full frame resets it, a delta merges. Values are checked (version 1 only, percentages clamped to 0..100, speed needs 3 numbers, zones 0..150 C, sys needs 3 loads and positive memory). `liveSys()` turns them into the same shape `parseSys()` returns (cores, freqs, zones, mem, load, upSec, cpuAt) and keeps everything else from the slow read.
- **Fresh / stale.** `liveFresh()` = connected, no `event: stale`, and a frame in the last 6 s (or within 4 s of a connect / "visible again"). Timing uses the page clock only (the host's `t` is never compared with it).
- **Hidden tab.** `sendView()` posts `{id, visible}` once per change (the id is the `X-Live-Id` header of the stream answer); a 404 closes the stream and the next tick opens a new one.
- **Failures.** Retry no sooner than 5 s, doubling to 30 s; reset after a stream that delivered; 30 s after `event: end` reason `session`. A frame buffer over 64 KB ends the stream.
- **Checked here:** `validate.sh` passes including the new `test_live_stream.js` (10 groups); the old live tests pass unchanged. **Not checked:** nothing in a real browser against a real host, and nothing on the F50. The Kotlin of Phases 1-3 is still not compiled by me (CI must).

# MatchiTOOL 1.4.2 (unreleased) - Live panel real-time plan, Phase 3: run only while watched

- **Lifecycle.** `LiveHub` keeps the open streams in a map (id -> stream). `refresh()` runs after every open, close and visibility change: any visible stream means `sampler.start()` (idempotent, also starts a reader whose thread had ended); none means a stop is scheduled after `LiveTiming.graceMs` (10 s; 0 stops at once, which the old tests use). A new visible stream cancels the pending stop; a timer that fires late sees a newer `stopGen` and does nothing. The real timer is one lazy daemon `ScheduledExecutorService` (`liveHubSchedule`); tests pass a manual one.
- **Hidden tab.** `POST /api/live/view` (`WebRoutesDevice.kt`, `rootGate(s) ?: liveView(s)`), body `{"id":"<X-Live-Id>","visible":bool}`. The id is 12 random bytes (hex) in the `X-Live-Id` header of the stream answer, so the page reads it with the same `fetch` it uses for the stream. The stream keeps the session token in memory and compares it in constant time; unknown id and other session both answer 404. A hidden stream stays open (the reader just may stop); it is not sent `event: stale`, and when it becomes visible again its stall clock restarts and it gets the cached reading.
- **Cached first frame.** `LiveStream.replay` encodes `sampler.latest()` as the first (full) frame before the stream listens; `lastPushedAt` stops an older reading going out after a newer one (encoding is under one lock because the sampler thread and the web thread can both encode). Only readings younger than `cacheMaxMs` (60 s) are sent.
- **Service stop.** `stopLiveHub()` (called from `HostService.onDestroy`) closes every stream, cancels the timer and stops the reader; it does not create the hub just to stop it.
- **Checked here:** `validate.sh` passes (route table has the new route in both directions); the reader script was run in `sh`. **Not checked:** the Kotlin was not compiled (no Gradle in the sandbox) and nothing ran on the F50.

<!-- Full, unedited per-change history kept for reference. The short per-version summary is ../CHANGELOG.md. Headings are not in version order and some versions appear several times. -->

# MatchiTOOL 1.4.2 (unreleased) - Live panel real-time plan, Phase 2: push route

- **Route.** `GET /api/live/stream` (`WebRoutesDevice.kt`, `rootGate(s) ?: liveStream(s)`), chunked `text/event-stream`, same response shape and headers as `/api/logs/stream`. The page must use `fetch` with the `x-token` marker header (EventSource cannot send it) and, over plain HTTP, `x-insecure-ok: 1`.
- **Why a gate:** the stream starts the Phase 1 root reader. The script is fixed and read-only, but it is still root running for as long as someone watches, so it follows the rule for everything that runs as root.
- **Session re-check while streaming:** `LiveStream` asks `Sessions.validate(touch = false)` and `RootGate.freshEnough` every 5 s. A refused check ends the stream with `event: end` / reason `session`, and the last close stops the sampler. A stream does not keep an idle session alive (`touch = false`, like the page's background polls).
- **Threads:** the web server starts one thread per connection with no pool limit (no `setAsyncRunner` in the app), so a stream does not take a worker from other requests. It is still capped at 4 (`LiveHub.MAX_VIEWERS`), each ends after 20 min, and a write to a gone browser fails within one frame (about 1 s) and closes the stream.
- **Frames:** per viewer, so a newcomer always starts with a full frame. Encoding happens on the sampler's thread, once per viewer per second (a few hundred bytes); a viewer whose queue (8 frames) is full loses a frame and gets a full one next.
- **Start / stop:** `LiveHub` starts the sampler for the first viewer and stops it when the last closes, under one lock. No grace time yet: a page that reconnects right away restarts `su` once (Phase 3).
- **Tests:** `LiveStreamTest.kt` (frames, full-frame rules, escaping, viewer counting, start / stop, limit, session end, lifetime end, stale report, interrupted wait). The test expectations for the frame format were also checked against an independent port of the encoder.

# MatchiTOOL 1.4.1 - Phase 3 / review fixes (after Step 7): ledger cap, firewall lock, toast wording

- **Ledger cap.** The ledger kept the last 500 lines of any kind, so a plugin that wrote many paths could push its first lines out, and the first lines are usually the chain (`C`) and boot script (`B`) ones. `capLedger` now drops the oldest `P` / `E` lines first and keeps `C`, `B`, `U` until nothing else is left. `PluginTrace.kt`; 2 new tests in `PluginTraceTest.kt` (not compiled here).
- **Firewall lock.** The undo script and the re-check called `iptables` without `-w`, so another program holding the xtables lock made a delete fail (the undo script even said "absent"). Both now try `iptables -w 5 -t T -S` once per chain; where it works every call uses `-w 5`, where it does not (iptables older than 1.6.2) the calls run as before. The word is fixed in the script, never plugin text. A lock that still cannot be waited out shows in the re-check as "error" (not checked), so the plugin is kept. `PluginUndo.kt`; `scripts/test_plugin_undo.py` has 7 new checks (a fake `iptables` that knows `-w` and can hold a lock; 28 checks in all, mutation-checked); 1 new Kotlin test.
- **Toast wording.** "N items removed from the system" counted chains that were already gone. It now says "N items no longer in the system". `web-src/plugin-undo-ui.js` and its two node tests.
- **Checked, no change needed:** a refused command is never written to the ledger (all root routes call the filter first, and `pluginCall` calls `shellDanger` first). `scripts/test_plugin_undo.py` now guards that order in the source text.
- **NOT fixed here (open, found in the same review):** a plugin that runs `iptables -N NAME` on a chain that already exists (it fails) still gets `NAME` recorded as its own chain, so a system chain such as `tetherctrl_FORWARD` could be flushed and deleted on Delete.
- Not compiled: the Kotlin changes (`capLedger`, the template edits, the 3 new Kotlin tests). The shell scripts and the page tests were run.

# MatchiTOOL 1.4.1 - Phase 3 / Step 7: docs for undoing chains and boot scripts, and for Turn off and stop

- `docs/PLUGIN_STOP.md` now describes Phase 3: the two new ledger lines (`C`, `B`) and what is never recorded; what the Delete dialog lists and the `undoHash`; the order (declared commands, sweep, undo, re-check, check, delete) and the limits of each step (5 s to start, 20 s for the undo script, 15 s for the re-check); how a chain and a boot script are removed and when they are refused; the shared-copy guard; **Turn off and stop** (no password, the hook is not run, the ledger is not pruned); and a "What Phase 3 does NOT catch" list (command text only, kernel state, folders the ledger did not see, not a security boundary).
- The sweep section's "Boot lines, firewall rules, files" bullet and the "nothing running" section no longer say the undo is "planned". The status block at the top now says the Phase 3 Kotlin was **not compiled** and nothing of Phase 3 ran on the F50.
- Not touched on purpose (Phase 4): `README.md`, `SECURITY.md`, `docs/PLUGIN_SANDBOX.md`, `docs/PLUGIN_STORE.md`. `CHANGELOG.md` got only the Step 6 line.
- Files: `docs/PLUGIN_STOP.md`, `docs/CHANGELOG_DETAIL.md`. Docs only: no code, test or script changed.

# MatchiTOOL 1.4.1 - Phase 3 / Step 6: the legacy Bypass boot cleanup is marked for removal in 1.4.2

- The one-time cleanup of "bypass" lines in `boot.sh` (added in 1.4.1) stays for 1.4.1 only. Nothing about how it works changed. A comment in `HostService.kt` marks it, `scripts/check_repo.py` fails from version 1.4.2 until it is removed, and `docs/PLUGIN_STOP.md`, `README.md` and `CHANGELOG.md` say so.
- A device that updates from before 1.4.1 straight to 1.4.2 never runs it; the docs tell the person to delete such lines by hand.
- Files: `HostService.kt` (comment only), `scripts/check_repo.py`, `docs/PLUGIN_STOP.md`, `README.md`, `CHANGELOG.md`.

# MatchiTOOL 1.4.1 - Phase 3 / Step 5: Turn off and stop (a plugin can be switched off without deleting it, and stop what it started)

- Switching a plugin OFF now offers to stop what it started and undo what it left in the system (declared stop commands, the process sweep, firewall chains and boot scripts the host saw it create), keeping the plugin file and its data. A plugin with nothing to stop is switched off at once, as before.
- Same host stop as Delete: `POST /api/plugins/delete` with `stop:true, keep:true` (no erase). Same hashes (plan, sweep, undo), same re-check, same root gate; no password (a deliberate choice: like a plain toggle). A stop that does not finish keeps the plugin ON. "Turn off only" and every "without stopping" button use the old toggle request, so turning a plugin off never depends on root.
- Not done on Turn off: the sandbox stop hook (the plugin is not being uninstalled). The ledger is not pruned after an undo.
- Files: `WebRoutesPlugins.kt`, `web-src/plugin-disable-ui.js` (new), `index.html`. Tests: `scripts/test_plugin_disable_ui.js` (new). The Kotlin of Steps 1-3 and 5 is not compiled yet.

# MatchiTOOL 1.4.1 - Phase 3 / Step 4: the Delete dialog shows what will be undone in the system

- The dialog lists the firewall chains and boot scripts the host saw the plugin create, says "if it is still there", and sends the `undoHash` it showed with every request that stops. "Delete without stopping" sends none. A plugin with no headers and nothing running, but with undo items, now gets "Delete and stop".
- Items that will NOT be undone (stop blocked, too many processes, kept because another plugin uses them) are listed as such. The retry dialog lists what "Try again" would remove, and the Restart button is not offered while a boot script is left.
- Files: `web-src/plugin-undo-ui.js` (new), `plugin-sweep-ui.js`, `index.html`. Tests: `scripts/test_plugin_undo_ui.js` (new), `scripts/test_plugin_hook.js`, `scripts/test_plugin_sweep_ui.js`. Page only; the Kotlin of Steps 1-3 is still not compiled.

# MatchiTOOL 1.4.1 - Deleting a plugin also undoes the firewall chains and boot scripts it left (Phase 3, steps 0-3)

- **Ledger (Step 0).** The plugin's ledger learned two line kinds: `C TABLE CHAIN TOOL` from `iptables` / `ip6tables [-t TABLE] -N CHAIN` (also inside `sh -c`, `su -c`, `timeout`, `nohup`, `VAR=x`) and `B /path` from a write directly into `/data/local/matchitool/boot.d` with a name like `20-name.sh`. Built-in chains, odd names, tables outside filter / nat / mangle / raw / security and anything else are not recorded. **No jump lines:** the undo finds the jumps by reading `iptables -S` at delete time. Old ledgers still read. `PluginTrace.kt`; `WebServer.kt` and `WebRoutesPlugins.kt` call `traceStore.recordCommand(plugin, command)`.
- **Plan (Step 1).** New `PluginUndo.kt`: `undoPlan` lists what would be undone (at most 20 chains and 10 boot scripts), keeps what another installed plugin also records or declares (ledger, `@matchi-boot`, or a chain named as a whole word in its uninstall / check commands), and gives an `undoHash`. `/api/plugins/data` returns it as `undo`; no root probe, so it appears without root.
- **Run (Step 2).** After the declared commands and the sweep, one root script built from re-validated names: jump rules removed **by number**, the parent chain never flushed, a chain not flushed while a jump is left, then `-F`, `-X`; a boot script removed only if it is a root-owned regular file in a non-symlink `boot.d`. One bad item and nothing runs. 60 s total, not started under 5 s, 20 s limit, one `plugin-undo` audit line per item. The request must carry `undoHash` (409 `plan-changed` if the ledger changed). `stopMode` got `undoCount`, so a headerless plugin with nothing running still gets a stop when there is something to undo.
- **Re-check (Step 3).** A separate read-only script looks again; a chain is gone only if the whole table list was read and has no `-N CHAIN` line; a missing tool or unreadable list is "not checked", never "gone". "Undone" needs the undo clean **and** the re-check run for every item. A clean re-check counts as the check for a plugin with no `@matchi-check`. Failure keeps the plugin.
- **Decisions (2026-11-13):** eBPF pins and other kernel state are listed, not undone; folders the ledger did not see stay.
- Tests: `PluginTraceTest.kt` (9 new), `PluginUndoTest.kt` (11 new), `PluginUndoRunTest.kt`, `scripts/test_plugin_undo.py` (the real scripts in a real `sh` with a fake `iptables`, 21 checks, in `validate.sh`).
- **Checked:** Steps 0-1 were compiled and run (386, then 397 pure Kotlin tests). **Not checked:** the Kotlin of Steps 2-3 (and Step 5) was not compiled and `PluginUndoRunTest.kt` has not run; the two route call sites are not compiled either. Nothing of Phase 3 had run on the F50 when this was written.

# MatchiTOOL 1.4.1 - Deleting a plugin also stops what it started, even with no headers (Phase 2, steps 0-8)

- **Process sweep.** The Delete dialog now looks for processes a plugin started, also when it declared nothing, and lists each one (PID, command line, how it was found) before anything is ended. **Delete and stop** ends exactly the listed ones and what they started, then scans again; the plugin is deleted only when that second scan ran, was complete and found nothing. Otherwise the plugin is **kept** and the report says what is left.
- **Three ways to find a process:** a tag (`MATCHI_PLUGIN=NAME`, added by the host in front of every shell command it sees from a plugin, read from `/proc/PID/environ`), a pid file the plugin's recorded commands wrote (accepted only if the process still names one of the plugin's files, so a reused PID is ignored), and a command line that names a file the plugin wrote (weakest; shown, and ended only because it was shown). Never touched: PID 1, kernel threads, the app (`com.matchi.tool`), its root sessions, the sweep's own shell and parents.
- **Kill order:** freeze the tree (`SIGSTOP`), `SIGTERM`, `SIGCONT`, wait 2 s, read the tree again (a respawned child is found), freeze again, `SIGKILL`. A changed start time (reused PID) is skipped. Only digits go into the script. Inside the 60 s total; the scan (up to 15 s) is outside it; the kill step needs 6 s left to start and is limited to 20 s.
- **What you saw is what runs.** The page sends a `sweepHash` of the listed processes; the host scans again first and answers 409 `plan-changed` if it differs. A request without the key (the Phase 1 page) gets no sweep. More than 50 processes: no automatic stop, only **Delete without stopping**.
- **Same-job guard:** a process whose command line contains a path another installed plugin also uses is never ended and is listed under "Left running on purpose".
- **Sandboxed stop hook:** `matchi.onUninstall(fn)`. The page runs it before the declared commands and the sweep (15 s at most). It can use only approved calls. Its success is never believed: a scan afterwards decides, and a hook that throws, times out or whose frame is dead keeps the plugin. Trusted plugins have no hook. The outcome goes to `shell_audit.log` (`plugin-hook`) and is never used to decide success.
- **Decisions kept:** tag + pidfile (command line only if shown); sweep also for headerless plugins; kill only what was shown; the order above; hook for sandboxed plugins only; a clean re-scan counts as the check for processes; sweep yes / hook no for disabled plugins; the never-kill list is fixed in code.
- **Change to know:** a plugin that declares uninstall commands but no `@matchi-check` and no `@matchi-boot` could not report success in Phase 1; with a clean re-scan it now can. The report still lists "no check command declared" / "no boot file declared" under Not checked.
- **Limits (see `docs/PLUGIN_STOP.md`):** best effort, not a security boundary (a plugin can name another plugin); no tag for a job started before this build, started by code that lost its name, or started with a cleared environment; Android services are not seen; boot lines and firewall rules are not undone (Phase 3).
- Files: `PluginSweep.kt` (pure logic), `PluginUninstall.kt`, `WebRoutesPlugins.kt`, `WebRoutesRoot.kt`, `WebServer.kt` (`tagged`), `plugin-sandbox.js`, `plugin-sweep-ui.js`, `index.html` (dialog and delete handler). Tests: `PluginSweepTest.kt`, `PluginSweepRunTest.kt`, `PluginHookTest.kt`, `scripts/test_plugin_sweep_ui.js`, `scripts/test_plugin_hook.js`. Docs: `docs/PLUGIN_STOP.md`, `docs/PLUGIN_SANDBOX.md`, `docs/examples/No_Headers_Example.js`, `docs/examples/Sandbox_Hook_Example.js`.
- **Found on the F50 (first device run):** the first probe took 19 s on 496 processes and ran into its 15 s limit, so the dialog said it could not check. The probe now reads every command line, environment and owner with three bulk commands and walks them with shell built-ins (no program per process). Kernel threads (no command line) are no longer listed; a command line is cut at 200 characters by the parser. The tag in `/proc/PID/environ` was seen on the device.
- **Found on the F50 (second device run):** the list held the short-lived children of a loop job (`sleep 30` every 30 s), so the scan at click time never matched the list on screen and the stop was refused again and again. A process whose parent is also listed is now left out of the list and of the hash; the stop still ends the whole tree below a listed process. When the process check cannot run, the reason now ends with the last 160 characters it printed.
- **Found on the F50 (a device test, fixed):** when an old copy and a new copy of a plugin shared a job, the loop left running on purpose kept starting new tagged children (`sleep 30`). The listed child was ended, the loop started another, the scan after the stop found it, and "Delete and stop" failed every time (the plugin was kept, nothing was wrongly ended). A process whose parent is a left-running (shared) process is now covered by the parent: not listed, not ended, not counted by the scan after the stop. `PluginSweep.kt` `classifySweep`, 11 new tests in `PluginSweepTest.kt`.
- **Dialog wording (found on the F50, on a retest):** when the only processes found were left running on purpose (shared with another plugin), the dialog said "No running process was found for it." right above the "Left running on purpose" list. It now says "Nothing will be ended, because the processes found are used by another plugin too." in that case; with nothing found at all the old sentence stays. `web-src/plugin-sweep-ui.js` (and the page built from it), 1 new test in `scripts/test_plugin_sweep_ui.js`. Text only.
- **Checked (state when this entry was written, before the device runs listed above it; the Kotlin was compiled in CI later):** the pure Kotlin tests were compiled and run for Steps 0-4 (309 tests); the generated probe and kill scripts were run in real `sh` on Linux; the page and hook logic is covered by node tests; `validate.sh` passes. **Not checked:** the Kotlin of Steps 5-7 was not compiled (GitHub Actions must), and nothing of Phase 2 had run on the F50 when this was written. Open on the device: `/proc/PID/environ` readable by root, the probe and kill script in the F50's shell, probe time, and a real sandboxed hook.
- **Not done in this phase:** undo of boot lines, boot.d files and firewall chains, "Disable and stop" (Phase 3); README, SECURITY.md, CHANGELOG.md, PLUGIN_STORE.md wording (Phase 4).

# MatchiTOOL 1.4.1 - Deleting a plugin can stop what it started (Phase 1, steps 0-7)

- **New header lines** `// @matchi-uninstall COMMAND`, `// @matchi-check COMMAND` and `// @matchi-boot /path` (first 400 lines). The Delete dialog lists the commands word for word; with `stop` the host runs them as root inside one 60 s total, then runs the check and tests the boot files. A stop that does not fully succeed **keeps the plugin** and opens the dialog again (try again, delete without stopping, restart the device for running leftovers). Nothing is retried automatically.
- **Approval:** the commands are part of what the person approves (`unin:` entries in the capability list, shown in the install / update dialog). A file that differs from the approved one cannot stop anything; an installed-before-records ("untracked") one can. A sandboxed plugin may only run an uninstall command it also granted with `@matchi-needs shell:`. Every command and the plan pass the existing shell filter, and every command is written to `shell_audit.log` as `plugin-uninstall`.
- **Plan hash:** the page sends the hash of the plan it showed; the host rebuilds the plan from the file and refuses (409 `plan-changed`) if it differs.
- **Same-folder guard:** if another installed plugin declares the same command or boot file, the stop is skipped by default and the dialog says why.
- **Shared data folders are kept:** deleting a plugin no longer erases a folder (declared with `@matchi-data` or recorded in the ledger) that another installed plugin also uses; the dialog lists it under "Not erased" with the reason. Found on the F50 (a device test): deleting the old copy with "skip the stop" had erased `/data/local/stop_example`, which the new copy needs.
- **Bundled plugins need no headers:** Device_Status, SMS, Live_Status and Signal_Info start nothing (no background processes, boot lines or firewall rules), so they declare nothing. Headers are for plugins from the store or written by users. Plugins without headers are deleted as before.
- Files: `PluginUninstall.kt` (pure logic), `PluginPaths.kt`, `PluginIntegrity.kt`, `PluginSandbox.kt`, `WebRoutesPlugins.kt`, `index.html` (dialog). New tests `PluginUninstallTest.kt` (parser, rules, plan, run, verify). Docs: `docs/PLUGIN_STOP.md`, `docs/examples/Stop_Example.js`.
- **Not done in this phase:** a process sweep for plugins without headers, undo of ledger entries, "Disable and stop" (Phases 2-3), README / SECURITY / CHANGELOG.md / PLUGIN_STORE updates (Phase 4).
- **Not compiled, not run on a device or in a browser.** Run `scripts/kotlin_pure_tests.sh` or `gradle :app:testDebugUnitTest`, then try it on the F50 with `docs/examples/Stop_Example.js`.

# MatchiTOOL 1.4.1 - Radio dashboard: telephony serving cell, no-service warning, PCI source, radio state

- **Cell lock: "Lock this cell" is back on the F50**. The router leaves its serving-cell keys empty, so the card now falls back to the registered cell Android telephony reports, taken from the last Live Status reading (no extra root call). It is marked "(Android telephony)", is used only when that reading is under 2 minutes old and its PCI / channel pass the normal check, and the confirm says it may differ from the router's cell. The existing 60 s auto-unlock still removes a wrong lock. `AT+QENG` was not used: it is a Quectel command and the F50 modem is Unisoc.
- **Radio state is "unknown", not guessed**: the Radio report starts with "Radio on/off: UNKNOWN" and says why (`AT+SFUN?` unsupported, `AT+CFUN?` does not follow the 5 / 4 switch). Full diagnose no longer says "radio full functionality" when CFUN=1; a CFUN other than 1 still fails as before.
- **Band lock + no service warning**: Radio settings shows a red line with the way out (Unlock all) when a band lock is active (fewer bands than the modem supports) and the last fresh Live reading has no service (not registered / searching / denied, or no bars and no signal). It reads Live Status through `window.MatchiLive.snapshot()` and the `matchi:live` event; it does not read the router.
- **PCI source label**: each radio box in Live device status ends with `router` or `Android`, with a tooltip. The router's own value wins; Android telephony fills the gap.
- **The on-device checks** cannot be done from a PC: `docs/F50_CHECKLIST_1.4.1.md` lists every on-device check (AT & Radio window, Performance mode button, the Radio dashboard changes, dialogs and language).
- **Fix found by the new browser test:** focus went back to the wrong element when a popup moved focus itself (the Terminal). The opener is now the last element focused before the popup opened.
- Tests: `scripts/phase0/test_round5_browser.py` (Chromium through Playwright, fake router, 29 checks: dialog focus / Tab / Escape, language switch and reload, telephony cell, source label, confirm text, stale reading, warning on / off). Not part of `validate.sh` (needs Playwright). `validate.sh` passes. The older Node browser tests were not re-run (Playwright for Node is not installed here). **Not checked on the F50.**

# MatchiTOOL 1.4.1 - Web UI: editable sources, accessibility, safe HTML, language switch

- **More of the page moved into `web-src/`**: the version footer, Log Catcher, Log basket and the accessibility pass are now `version-footer.js`, `log-catcher.js`, `log-basket.js` and `a11y.js`, inlined by `build-web.js` like the rest (13 -> 15 files with the two below). The page is still one file. Not moved: the CSS blocks, the markup, and the built-in tools' windows (`type="text/plain"` plugin scripts); `build-web.js` only inlines `.js`.
- **Accessibility pass 2** (in `a11y.js`): popups get `role="dialog"`, a name, focus on open, a Tab loop, Escape to close and focus back on the opener; plugin modals get the same Tab loop and Escape (it presses their own Close button). Elements that only have an `onclick` get `role="button"`, `tabindex` and Enter/Space. Filter tabs get tab roles, status text under sign-in and the password form is a live region, `#collapseBtn_menu` keeps `aria-expanded`. Pass 1 (names for unlabelled controls) is unchanged.
- **Safe HTML helper and lint**: `MT_html` (`html` template tag, `raw`, `esc`, `setHtml`) in `safe-html.js`. `scripts/check_innerhtml.js` sorts every `innerHTML`/`outerHTML`/`insertAdjacentHTML` site into static, escaped or reviewed, and fails on a new one that is none of these; the 16 reviewed sites and the reason for each are in `scripts/innerhtml-reviewed.json`. No existing site was rewritten.
- **Language switch** (`i18n.js`): a selector in the header, English and Filipino, saved in `localStorage` (`matchi_lang`), the browser language decides at first. It covers the fixed labels listed in `TARGETS` (header, sign-in, home buttons, popup titles and buttons, password form placeholders). Not translated: messages made at run time, the built-in tools' windows and plugins. `scripts/test_i18n.js` checks that every dictionary key is real text in the page.
- Checked with `validate.sh`, the new `test_i18n.js` and `test_safe_html.js`. NOT run in a browser: the dialog focus, keyboard and language switch code were not tried on a page or on the F50.

# MatchiTOOL 1.4.1 - Code structure, one version source, route tests, shrunk release builds

- **`WebServer.kt` split (1,574 -> about 410 lines).** The server core stays; the routes moved, unchanged, into `WebRoutesAuth / Device / Logs / Plugins / Root / Router / Update.kt` (one extension function per group, `null` = not my path) and the plugin data-path rules into `PluginPaths.kt`. Helpers moved with the routes that use them; members they reach went from `private` to `internal`. No route, status code or message changed. **Not compiled here (no Gradle offline): build once and run `gradle :app:testDebugUnitTest` before relying on it.**
- **Root gate in one function, with tests.** `RootGate.decide(...)` runs the checks in order (plain HTTP refused, HTTP confirm, sign-in age) and `WebServer.rootGate` only turns its answer into the 403. Six new cases in `RootGateTest`. Same codes as before: `insecure-off`, `insecure`, `reauth`.
- **Route table test.** `scripts/test_route_gates.py` reads every route from the code and checks it against a table (72 routes: gated, partly gated, own password, open). It fails for a new route that is not in the table, a removed route still in the table, a gate that was dropped, and a route that runs root, user shell, APK install or router-cookie code without a gate or a stated reason.
- **`validate.sh` slimmed.** Version, README tool count and bundled-binary hash checks moved to `scripts/check_repo.py`. About 45 assertions that only repeated what the route table, `RootGateTest` or the version check now cover were deleted; the rest moved to `scripts/check_sources.py`, labelled as tripwires, and now read all host files together so moving code between them does not break them.
- **One version source: `version.properties`.** Gradle, `PAGE_VERSION` (via `build-web.js`), the release workflow and the browser test mocks read it. `check_repo.py` also checks the README line and the top CHANGELOG entry.
- **Release builds shrink (R8, shrink-only).** `isMinifyEnabled` and `isShrinkResources` on for release, with `app/proguard-rules.pro`: no renaming, no optimising, the app's own classes and NanoHTTPD kept whole. Debug builds and unit tests are unchanged. `targetSdk = 28` stays on purpose (router firmware). **Not built here: check the release APK installs and the console starts.**
- **README tool count fixed** ("Eight" -> seven built-in tools); `check_repo.py` now compares it with the page.

# MatchiTOOL 1.4.1 - Security hardening (HTTP root off by default, stronger console hash, firewall closed on stop)

- **Root over plain HTTP is refused by default.** When HTTPS could not start and a request comes from another device, every root-capable call now answers 403 `insecure-off` until the owner switches **Plugins > Root over HTTP...** on (sign-in must be younger than 4 h and the password is asked again; same lockout as login). The switch works over HTTP too, so nobody is locked out when TLS fails. Loopback (apps on the phone) and HTTPS are unchanged. With the switch on, the page's "not encrypted" confirm still applies. New route `/api/security/http`; `RootGate.insecureRefused` (+ test).
- **Console password hash: PBKDF2 120,000 -> 310,000 iterations.** Existing hashes are upgraded silently at the next good sign-in. Not timed on the F50: if sign-in feels slow, lower `CONSOLE_PW_ITER` in `Prefs.kt`.
- **The hotspot-side firewall rule (`--dport 2334 ACCEPT`) is removed when the host service stops** (`HostControl.closeLanFirewall`, bounded to 3 s, off the main thread). If the process is killed without `onDestroy` the rule stays until the next start reuses it.
- **Bundled `sha256` is now a shell script** around the system `sha256sum` (the old packed binary had no source). New `docs/BINARIES.md` lists where every bundled executable came from, its SHA-256 and what is still unknown. **Check a plugin that calls `sha256` on the F50.**
- Already in place and left as is: the root terminal and the "blocked" answer both say the command filter is not a security boundary.
- **Not changed: plugins still run inside the page** (same origin, can reach the session token). Sandboxing them needs a different plugin model; see the note in the answer to this change.

# MatchiTOOL 1.4.1 - Old Bypass lines removed from boot.sh; dead AT_Radio.js asset removed

- **Boot script (`HostService.BOOT_SCRIPT`):** before `boot.sh` runs, lines that name "bypass" are taken out once. A copy stays as `boot.sh.pre-bypass-removal`; the new file is checked with `sh -n` and is used only if it is still valid shell, otherwise `boot.sh` stays as it was and `events.log` says to edit it by hand. Firewall/TTL lines that do not name Bypass are left alone.
- `scripts/test_boot_tasks.sh` has two new cases (lines removed + other lines still run; broken result refused).
- `assets/plugins/AT_Radio.js` deleted: nothing read it (the AT & Radio tool is built from `web-src/` into `index.html`). The name `AT_Radio.js` stays reserved for the built-in tool.
- No Gradle wrapper yet: it needs internet. Run `bash scripts/bootstrap-build.sh` once and commit `gradlew`, `gradlew.bat` and `gradle/wrapper/`.

# MatchiTOOL 1.4.1 - Performance mode is a button in the top row; AT & Radio keeps only AT tools

- **Performance mode is now a button in the top button row, next to Change IP** (`web-src/perf-mode.js`, `mountPerfMode()`). It opens a small window that shows the router's setting (ON / OFF) and has one Turn on / Turn off button with a confirm. The router saves it at once and applies it only after a reboot; no radio restart. If the router does not report `performance_mode` the window says so and offers nothing. It is not part of the Network mode list and not in the Radio settings card.
- **AT & Radio window: network mode, band lock and cell lock removed** (they live on the dashboard: Radio settings and Cell lock cards, same `MatchiRadio` code). The window keeps the SIM slot picker, VoLTE / VoNR, the quick AT buttons (including NR bands, Restart modem, Radio report, Change IMEI), the AT box and the output.
- `scripts/phase0/test_at_radio_browser.js` rewritten for this (PC only, not run here). `validate.sh` passes. **Not yet checked on the F50.**

# MatchiTOOL 1.4.1 - Radio settings and Cell lock on the dashboard (summary of the entries below)

- **Radio code in one place** (`radio-core.js` + `at-radio-ui.js`), "n6" band chip fixed, radio restart order fixed (5 = off, 4 = on) and run on the device in one root call.
- **Dashboard cards:** Radio settings (network mode, LTE / 5G band chips, router state vs pending ticks) and Cell lock (neighbour list, lock by hand, auto-unlock after 60 s). Live Status pauses during a radio change.
- **Live Status polling guard:** 4 s deadline, keep-stale, back-off 3 / 6 / 12 / 24 / 30 s.
- **Cell lock fix:** the F50 answers CELL_LOCK / UNLOCK_ALL_CELL with an empty reply; the read-back of `locked_cell_info` decides success.
- **Checked on the F50 (11 Nov 2026):** band lock and radio restart, polling guard (offline, SFUN 5 / 4), cell lock of PCI 100 (registered after 60 s, lock stays), fake PCI 999 (auto-unlock fired at 60 s), unlock all cells.
- **Known limits on the F50:** the router reports its serving cell keys (`nr5g_pci`, `lte_pci`, channels) EMPTY, so "Lock this cell" is not offered; use a neighbour row. The dashboard PCI comes from Android telephony and can differ. `AT+SFUN?` is not supported and `AT+CFUN?` does not follow SFUN. A leftover band lock (for example LTE B1 only) shows as "no service" and looks like a cell lock problem: use Unlock all.
- Docs fixed: `AT_RADIO_FORMATS.md` and `AT_RADIO_UFI_PLAN.txt` now give the real SFUN order. Version 1.4.1 / versionCode 401 (app, web page, validation, README).

# MatchiTOOL (1.4.1) - Cell lock: the F50 answers CELL_LOCK with an empty reply (fix, found on the F50)

- **Problem:** the dashboard said "Cell lock failed: Router refused the change ()" although the router had accepted the command. Raw reply on the F50: `success:true, data:"", "reply empty"` (HTTP 200). The code only accepted the word "success".
- **Fix:** `setRouterCell` in `radio-core.js` (used by `cellLock` and `cellUnlock`, so the dashboard card and the AT & Radio window both get it): an empty reply is accepted, any other text (failure, error) is still refused. The read-back of `locked_cell_info` decides whether the lock or unlock really happened; an empty reply with nothing listed is reported as "does not list the lock", not as success. Band locks are unchanged (they do answer "success").
- Tests added in `scripts/test_at_radio.js` (empty reply accepted, confirmed by read-back, not a hit when nothing is listed, "failure" refused). `validate.sh` passes.

# MatchiTOOL (1.4.1) - Live Status polling guard (plan phase 5)

- **4 s deadline per router read.** A request that never answers is aborted instead of hanging (the radio restart and re-registration can stall the router web API). Reads never overlap (each loop already skips a tick while its read is running).
- **A failed read keeps the last values** on screen instead of blanking the card. After 12 s without a good read the header says "Stale · N s ago". Only after 60 s are the old numbers dropped, so the modem / Android telephony fallback takes over and old values cannot pass for current ones. "Connecting…" is never shown once a value has been shown.
- **Back-off 3 / 6 / 12 / 24 / 30 s** for the router loop (was 6 s up to 60 s), reset by the first success. Never faster than the heat / mode delay. The root loop is unchanged (15 / 30 / 60 s).
- **Light read while recovering:** after a failure the router is asked only for network_type, signalbar and the RSRP keys (a small answer from a busy router), merged onto the last values; the full key list returns with the first success.
- Paused during a radio change as before (phase 3: `MatchiRadio.beginBusy`).
- Tests: new `scripts/test_live_guard.js` runs the real `collectFast` against a fake router (deadline, keep-stale, drop after 60 s, light keys, recovery); `scripts/test_live_poll.js` back-off values updated. `validate.sh` passes. **Checked on the F50: pass (offline test, AT+SFUN=5 / 4).**

# MatchiTOOL (1.4.1) - Dashboard: "Cell lock" card (plan phase 4)

- **New card under Radio settings** (`web-src/dash-cell.js`, UI only, calls `MatchiRadio`), **closed by default**. It reads `neighbor_cell_info` / `locked_cell_info` only when opened or on Refresh, never on the Live Status timer. Shows what is locked now, the cell the phone is on, the neighbours (RSRP / RSRQ / SINR) and a "lock by hand" row (PCI, EARFCN, 4G / 5G).
- **"Lock this cell"** is built from the router's own serving-cell values (`nr5g_pci` + `nr5g_action_channel`, `lte_pci` + `wan_active_channel`), the safest lock because the phone is already on it. The cell is offered only when the network type says that radio is in use and the PCI / channel are valid; 5G NSA offers both. New in the core: `servingCells()`.
- **Type is never guessed.** A neighbour called `n78` is 5G, `B3` is 4G; a bare number (`3`) shows a 4G / 5G picker and does not lock until one is chosen.
- **Confirm names the cell** and warns about no signal. After lock or unlock there is **no radio restart**; if the router does not list the change yet it is read again after 3 s.
- **Auto-unlock ON by default.** 60 s after a lock, if neither `AT+CEREG?` nor `AT+C5GREG?` reports 1 or 5, `UNLOCK_ALL_CELL` is sent once. The check now lives in the core (`watchCell`, `cellAutoOn`, `setCellAuto`) and is shared with the AT & Radio window; every lock, unlock or newer watch cancels an older one, so two windows cannot fight. The pending check **survives a page reload** (start time in localStorage; it resumes only if the router still lists a locked cell, and is dropped after 10 min).
- **Lock buttons are off while bands are ticked but not saved or a band change is running**; "Unlock all cells" is always on screen and works during a radio restart.
- Tests: `scripts/test_at_radio.js` (servingCells for 5G / 4G / NSA / bad values, cellListed, lock + unlock with no SFUN, watchCell registered / unregistered / cancelled / replaced / switched off). New `scripts/phase0/test_dash_cell_browser.js` (needs Playwright). `validate.sh` passes. **Checked on the F50 (see the 1.4.1 summary).**

# MatchiTOOL (1.4.1) - Dashboard: "Radio settings" card, Live Status pauses during a radio restart (plan phase 3)

- **New card under Live device status** (`web-src/dash-radio.js`, UI only, calls `MatchiRadio`): network mode and LTE / 5G band chips. It reads the router once when the page opens, after a change and on Refresh. It never reads on the Live Status timer.
- **Chips show the router state, ticks stay pending:** green = locked on the router, yellow = ticked but not saved, struck through = locked now and will be removed. The "locked now" text uses only the router list ("none (all bands allowed)" when every band is listed). "Lock ticked bands" is enabled only when the ticks differ from the router.
- **Lock sends both lists** like UFI-TOOLS (the type you did not touch is sent again unchanged; nothing is ever sent empty; both must answer success), reads them back, restarts the radio (SFUN order unchanged), then asks AT+CEREG? / AT+C5GREG? every 3 s for up to 90 s until the modem is registered.
- **Live Status freezes during a radio change** (`MatchiRadio.beginBusy` / `onBusy`): both loops skip their reads, the last values stay on screen, the card says "Radio restarting, ~30 s · showing the last reading", and ONE read runs when the restart is over, then the normal interval. The host pill says "Radio restarting" instead of "Host disconnected". This also covers a restart started from the AT & Radio window.
- **Network mode** sends SET_BEARER_PREFERENCE only (no radio restart), freezes polling for the 2 s re-read, then shows what the router reports.
- Tests: `scripts/test_at_radio.js` (busy state, waitRegistered), new `scripts/phase0/test_dash_radio_browser.js` (22 checks against a fake router: chips, pending vs router, both lists sent, no live reads during the restart, one read after, host pill). `validate.sh` passes. **Not yet checked on the F50.**

# MatchiTOOL (1.4.1) - Radio code in one place (plan phase 2), "n6" band chip fixed

- **One source:** everything that talks to the modem or router for radio settings (AT, router get/set, band lock, cell lock, radio restart, parsing) is now `web-src/radio-core.js` (`window.MatchiRadio`, no DOM). The AT & Radio window is `web-src/at-radio-ui.js`. Both are included into `index.html` by `scripts/build-web.js`. `assets/plugins/AT_Radio.js` (a hand-kept second copy that nothing read at run time) is removed. `AT+SFUN` now exists only in `radio-core.js` (the report uses `AT+CFUN?`; `AT+SFUN?` answers `+CME ERROR: 3` on the F50).
- **Fix (found on the F50):** `AT+SP5GCMDS="get nr support_band"` answers `...,6,41,78,1,8,28,5`. The first number is a count, not band n6; the window showed a bogus "n6" chip. The count is dropped when it equals the number of values after it.
- New in the core, for the dashboard cards: `setBands`, `cellLock`, `cellUnlock`, `parseNrSupported`, `radioCycle({log, toast})`.
- Confirmed on the F50: `lte_band_lock` / `nr_band_lock` are plain comma lists and "no lock" is the full list. A stray first character in AT output ("(+CEREG", "6+C5GREG") does not move the parsed fields (test added).
- Tests: `scripts/test_at_radio.js` now runs the real `radio-core.js` with a fake `api()` (adds setBands, restart order, n6, stray characters). New `scripts/phase0/test_at_radio_browser.js` opens the window against a fake router. `validate.sh` passes. **Not yet checked on the F50.**

# MatchiTOOL (1.4.1) - Dashboard: core cards smaller, no overlap on phones

- Core usage and CPU frequency now sit in a two-column grid (each card can shrink), so they no longer overlap on a phone.
- CPU frequency shows only the numbers, in small chips like UFI-TOOLS (offline cores dim, 0). Core usage bars are smaller and have no number under them (the CPU tile still lists them; hover a bar for the value).

# MatchiTOOL (1.4.1) - AT & Radio: radio restart runs on the device (found on the F50)

- **Problem (from the F50 log):** `slot 0 off: OK`, `slot 1 off: OK`, then `slot 0 on: Cannot reach MatchiTOOL host`. While the radio is off the page loses the host for a few seconds, so the "on" step sent from the page never arrived and slot 0 was left off. This is also why the dashboard could not be reached after a band lock.
- **Fix:** the whole sequence (`AT+SFUN=5` slot 0, slot 1, then `AT+SFUN=4` slot 0, slot 1) is ONE root script that runs on the device (`sendat`), so it no longer depends on the page. A slot that switched off is sent "on" for up to about 16 s; a slot that did not is sent it once, as UFI does.
- If the page loses the host, it says so, waits up to 90 s for an AT read to answer, then sends `AT+SFUN=4` to both slots once more (harmless if the radio is already on) and reports the result.
- Tested the script with a fake `sendat` (slot 1 refusing, slot 0 failing twice before OK). **Not yet checked on the F50.**

# MatchiTOOL (1.4.1) - AT & Radio: "Radio report" button

- Read-only. One tap runs `AT+SFUN?` (slots 0 and 1), `AT+CEREG?`, `AT+C5GREG?`, `AT+COPS?`, the NR support list, and one router read (`lte_band_lock`, `nr_band_lock`, `net_select`, `performance_mode`, serving band / channel / PCI, `locked_cell_info`). The text is shown in the window and copied to the clipboard. Used for the plan's Phase 1 (B1 vs B8, whether the n78 lock survives the radio restart).

# MatchiTOOL (1.4.1) - Dashboard: Core usage + CPU frequency cards (UFI-TOOLS style)

- **Core usage:** one bar per core (0-100 %) with the number under it, from the same two `/proc/stat` reads as the CPU tile. An offline core is dimmed and shows a dash; cores that are switched off (the F50 outside performance mode keeps cores 4-7 off) are still drawn, so there are always as many bars as cores.
- **CPU frequency (MHz):** one cell per core with the current speed and a fill bar against its maximum. An offline core shows 0, as in UFI-TOOLS. The core list comes from `/sys/devices/system/cpu/possible`, so cores 4-7 still show (as 0) when the F50 is not in performance mode, even if the kernel removes their folders. Read in the same root call as the other slow values (`scaling_cur_freq`, `cpuinfo_max_freq`, `online`), no extra call. Tapping the card opens the CPU Governor.
- Test added in `scripts/test_live_cpu.js` (`F:` lines). **Not yet checked on the F50.**

# MatchiTOOL (1.4.1) - AT & Radio: radio restart had on/off reversed (fix)

- **Problem:** after a network-mode change or band lock, the dashboard could not be reached and showed 4G only, which UFI-TOOLS never does. Cause: the radio restart sent `AT+SFUN=4` first and `AT+SFUN=5` second, believing 4 = off and 5 = on. UFI-TOOLS' real order (decoded from its code, the helper is not a no-op as the old notes said) is `AT+SFUN=5` (radio off), then `AT+SFUN=4` (radio on). So the old "restart" left the radio off.
- **Fix:** `radioCycle` now copies UFI: `AT+SFUN=5` on SIM slots 0 and 1, then `AT+SFUN=4` on slots 0 and 1, 100 ms apart. A missing slot is skipped; the ON step always runs and is retried. "Restart modem" uses the same code.
- **Recovery if a radio is stuck off:** run `AT+SFUN=4` in the AT terminal (or reboot the device).
- **Not yet checked on the F50.**

# MatchiTOOL (1.4.1) - AT & Radio: band lock now restarts the radio (found on the F50)

- **Problem:** after "Lock ticked bands" the router reported the new lock (NR n41) but the dashboard still showed n78 (and the same on 4G). Read from the UFI-TOOLS 4.1.5 APK: after `LTE_BAND_LOCK` / `NR_BAND_LOCK` it cycles the modem radio with `AT+SFUN=4` / `AT+SFUN=5` through its AT helper; saving the lock alone does not move the modem. "Re-apply network mode" was not enough.
- **Fix:** after a verified lock / unlock / restore, MatchiTOOL now restarts the radio itself (`AT+SFUN=4`, then `AT+SFUN=5` with retry, same code as "Restart modem"). The confirm dialog says so (signal drops about 30 s). The radio is restarted on the SIM slot picked at the top of the window only; UFI cycles slots 0 and 1.
- **False warning fixed:** "Unlock all" sent `1,5,6,8,28,41,78` and the router reported `n1 n5 n8 n28 n41 n78` (n6 not supported); that was shown as a mismatch. A read-back that is a non-empty subset of what was sent now counts as applied, and the log says which band the router dropped. A different or empty list is still reported as a mismatch.
- Test added in `scripts/test_at_radio.js`. **Not yet checked on the F50.**

# MatchiTOOL (1.4.1) - AT & Radio: cell lock (plan Phase 3)

- **"Cell lock" button** in AT & Radio opens a panel. It reads `neighbor_cell_info` and `locked_cell_info` only when opened or refreshed (never polled) and shows the locked cell and the neighbour list (band, EARFCN, PCI, RSRP, RSRQ, SINR). A firmware with neither key shows "not available"; Unlock still works.
- **Lock:** a "Lock" button per neighbour, or by hand (PCI, EARFCN, 4G/5G). It sends `CELL_LOCK` with `pci`, `earfcn`, `rat` (12 = 4G, 16 = 5G) after a confirm that names the cell and warns that a wrong cell can give no or unstable signal. The neighbour list has no `rat` field: it is taken from a band written `n78` (5G) or `B3` (4G); a bare number makes you pick 4G or 5G yourself. PCI 0-1007, EARFCN up to 3279165 are checked before sending. After sending, the lock is read back.
- **Unlock all cells** (`UNLOCK_ALL_CELL`) is always at the top of the panel, with a confirm.
- **Auto-unlock (on by default, tick box):** 60 s after a lock the modem is asked `AT+CEREG?` / `AT+C5GREG?`; if neither says registered (1 or 5), or nothing answers, `UNLOCK_ALL_CELL` is sent once. A manual unlock or a newer lock cancels it. It runs once and never loops.
- **Tests:** `scripts/test_at_radio.js` (in `validate.sh`) runs the real parsing helpers (band lists, cell lists, rat guess, cell validation). **Not yet checked on the F50.**

# MatchiTOOL (1.4.1) - AT & Radio: band lock (plan Phase 2)

- **Band lock in AT & Radio:** LTE and 5G NR bands as tap chips, pre-ticked with what the router reports now (`lte_band_lock`, `nr_band_lock`, read on open and after a change only). "Lock ticked bands" sends `LTE_BAND_LOCK` / `NR_BAND_LOCK` (bare integers joined by `,`) after a confirm dialog that lists the bands. The section is hidden when the firmware reports neither key.
- **Stricter than UFI-TOOLS:** every command sent must answer `success` (UFI accepts one), nothing is sent with zero bands ticked, a type with no tick is left unchanged (not sent as an empty string), and the bands are read back and compared.
- **Way back:** "Unlock all" sends the full listed bands (LTE: built-in list plus anything already locked; NR: the modem's `AT+SP5GCMDS support_band` answer). "Restore original" sends back exactly the text the router reported the first time this browser read it (kept in `localStorage`, `matchi_band_orig`). "Re-apply network mode" re-sends the current network mode, because UFI says the lock is picked up after switching network mode.
- **Not confirmed (Phase 0 table is still empty):** what the router calls "no lock", what its "Unlock bands" sends, and whether the LTE values are bare integers on the wire. That is why "Restore original" exists next to "Unlock all". **Not yet checked on the F50.**
- Both copies changed (`plugins/AT_Radio.js` and the embedded copy in `index.html`). `validate.sh` passes.

# MatchiTOOL (1.4.1) - CPU %: UFI-TOOLS method (Live Status and CPU Governor)

Read from the UFI-TOOLS 4.1.5 APK (`DeviceInfo.kt`: `readProcStat`, `calculateCpuUsage`, `getCpuUsageSnapshot`, `getCpuFreqJson`):
UFI keeps `/proc/stat` per core (`cpu`, `cpu0` ...), takes two reads a short delay apart, computes busy = 1 - idle / total with idle = idle + iowait,
formats it with one decimal (`%.1f`) and the page shows it with two. It never shows speed / max speed as a percentage.

- **Live Status CPU %:** the two `/proc/stat` reads now happen inside one root call, 0.8 s apart, instead of comparing against the read of the previous poll 15 s earlier. That old window also counted this app's own polling (root shell, dumpsys, router calls), which put a floor of 1 % or more under a quiet phone. The value is shown with one decimal (`0.4 %`), the tile shows the per-core values under it, and the old way (previous poll) is only a fallback when the pair is missing. The root read takes about 0.8 s longer (idle sleep, no CPU use), so the Phase 0 `collectSlow` time baseline is that much higher.
- **CPU Governor window:** each core tile now shows its real usage (`1.4 %`) and the bar is the usage. Before, the bar was current speed / max speed, which is always full in Performance mode, so it looked like 100 % load. The MHz text is unchanged. The first read after opening shows no usage yet (it needs two reads).
- **Tests:** `scripts/test_live_cpu.js` (in `validate.sh`) runs the real `parseSys()` on known `/proc/stat` numbers: 3 busy of 800 ticks gives 0.4, idle + iowait counted as idle, guest columns ignored, 100 / 0 limits, no movement gives no value, old output form still works. **Not yet checked on the F50**; the browser test could not be run here (Playwright not installed).

# MatchiTOOL (1.4.1) - Live status: tests (plan Phase 6, first part)

- **New `scripts/test_live_poll.js`** (runs in `validate.sh`): cuts the real interval code out of `index.html` and checks cool / warm / hot / critical delays, Fast / Normal / Eco, Fast never pushing a warm or hot phone harder, the router and root back-off (6 s ... 60 s, never faster than the heat delay), the battery pause (below the level and not charging only), saved choices and the `liv_thermal_test` override. A deliberately broken table makes it fail, so it does test the page code.
- Not done yet: removing the `PHASE0-TIMING` console lines (kept so the phone baseline can still be measured), the version bump, and the 30-minute check on the F50.

# MatchiTOOL (1.4.1) - AT & Radio: Signal quality on 5G

- **Signal quality button:** `AT+CSQ` only measures 2G/3G/4G, so on 5G (for example NR n78) the modem answers `+CSQ: 99,99` ("unknown"). The button now runs `AT+CSQ` and `AT+CESQ`, says in words what a 99 means, and then reads the router's 5G and LTE values (RSRP, RSRQ, SINR, PCI, band, channel). Plain `AT+CSQ` typed by hand still works and still answers 99,99 on 5G; that is the modem, not a bug.
- **Glued `OK`:** `sendat` prints the closing `OK` / `ERROR` with no line break (`+CSQ: 99,99OK`). Every console reply now puts it on its own line and drops blank lines.
- Both copies changed (`index.html` built-in and `plugins/AT_Radio.js`). **Not yet checked on the F50.**

# MatchiTOOL (1.4.1) - Live status: optional extras (plan Phase 5)

- **Refresh speed: Fast / Normal / Eco** (chips under the card, saved in `localStorage` as `liv_mode`). Router loop / root loop: Fast 2 s / 10 s, Normal 3 s / 15 s (default, unchanged), Eco 9 s / 45 s. Fast only applies while the phone is cool: when warm or hot the heat table still sets the pace, so Fast cannot push a hot phone harder. Eco is kept when warm or hot. Failure back-off still wins over all of them.
- **Speed graph:** download and upload lines for the last 60 fast reads (memory only, gone on reload), with the peak shown. It appears after 2 readings and only when the router returns the speed keys.
- **Pause below battery level:** Off (default) / 10 / 15 / 20 / 30 % (`liv_batpause`). Below the level and not charging, the router loop stops and the root loop checks once a minute, so plugging in the charger resumes everything. The header says "Paused - battery N% (below X%)".
- Browser test extended (cadence of each mode, Fast on a hot phone, pause and resume, pause off by default, graph, no graph without speed keys). **Not yet checked on the F50**, and the new row was not looked at on the real card.

# MatchiTOOL (1.4.1) - Live status: CPU % and 5G RSRQ fixes

- **CPU %:** the total from `/proc/stat` also counted the `guest` and `guest_nice` columns, which the kernel already includes in `user` / `nice`. That inflated the total and pulled the percentage down (6 % shown with a load of 8.3). Only the first 8 counters are used now.
- **5G RSRQ / SINR:** the router is now also asked for `nr_rsrq` and `Nr_snr` (the names UFI-TOOLS shows) and they are used when `Z5g_rsrq` / `Z5g_SINR` are empty, before the Android telephony fallback.
- **5G RSRQ - real cause found (F50 B09 screenshot):** `dumpsys telephony.registry` lists several `CellSignalStrengthNr` entries. The first one has `ssRsrq = 2147483647` (unavailable), a later one has `ssRsrq = -11`. The parser only looked at the first match, so RSRQ stayed "-". It now reads every entry and takes the first usable RSRQ, preferring the entry whose RSRP equals the one on the card. The telephony grep also keeps every `CellSignalStrengthNr` line (head 40).
- **Not confirmed:** the router keys `nr_rsrq` / `Nr_snr` added above are still a guess; the F50 answer for them was not seen. Checked only with the pasted dumpsys sample (node), not on the phone.

# MatchiTOOL (1.4.1) - Live status: 5G / 4G detail filled from Android telephony (fix)

- **Bug:** on the F50 the 5G box showed RSRP but RSRQ, SINR, PCI and Ch were all "-". The router keys for those (`Z5g_rsrq`, `Z5g_SINR`, `nr5g_pci`, `nr5g_action_channel`, and the 4G twins) come back empty on this firmware, and the Android telephony read (which has them) only ran when the router API failed.
- **UFI-TOOLS does it by merging a second source over the router answer** (`{...router, ...its own /baseDeviceInfo}`; the fields it shows are `Nr_snr`, `nr_rsrq`, `Nr_pci`, `Nr_fcn`, `Nr_bands`, `Lte_*`; none of them is in its router key list). MatchiTOOL now does the same with Android telephony: the slow loop reads `dumpsys telephony.registry` whenever the router leaves a detail field empty for the radio in use. When the router gives every field, no dumpsys is run.
- Cost control: the telephony read is at most every 30 s when cool, 60 s warm, 180 s hot (router-failure fallback keeps its 2 minutes).
- The registered 5G cell (`CellInfoNr`) and 4G cell (`CellInfoLte`) are read separately, so on a 4G + 5G (NSA) link each box gets its own PCI, channel and band (n78 / B3 style). 5G values from telephony are only used when the router says 5G is active (or the router is down), so a stale NR entry cannot turn a 4G card into 5G.
- Browser test extended (the screenshot case, 4G and 5G cells not mixed, no dumpsys when the router is complete, throttling cool and hot). The test uses AOSP-format sample lines; **not yet checked against the real F50 output**. If a field is still "-", open Live status raw output: the `telephony.registry:` part shows what the phone really prints.

# MatchiTOOL (1.4.1) - Live status: instant open (plan Phase 4)

- The last router **radio values** are kept in `sessionStorage` (this tab only, gone when the tab closes) and painted the moment the card starts, so a reload shows signal and bars straight away. While only cached values are on screen the header says **"Last reading · N s ago"** and the pulse is grey; the first live read replaces them and the header turns **Live**.
- The cache holds signal numbers only: network type, bars, RSSI, LTE / 5G RSRP, RSRQ, SINR, band, channel. No operator name, PCI, speeds, device count, data used, IP or IDs. An entry older than 10 minutes, or without a network type or bars, is ignored.
- **"Connecting..."** is shown only when there is nothing cached. If the first router read fails, the cached values are dropped (the card never keeps old numbers while the router is down) and the AT / telephony fallback runs as before.
- When the card becomes visible again (sign-in after a lost session, another tool window closed) both loops read at once instead of waiting out a full interval. The first router and root reads already ran at start (no 3 s wait), so the "0.5 s first read" in the plan needed no timer change.
- Browser test extended (cached values before the router answers, Connecting without a cache, 10-minute expiry, junk cache, failing router, card shown again). Not tested on a real device yet.

# MatchiTOOL (1.4.1) - Live status: heat-aware polling (plan Phase 3)

- One delay table, by heat level: **cool** router 3 s / root 15 s, **warm** 6 s / 30 s, **hot or critical** 15 s / 90 s. The thresholds that decide warm, hot and critical are unchanged. Before, warm only slowed the root read (120 s) and hot slowed it to 3 minutes.
- The root loop is slowed when hot, not stopped: the temperatures come from that read, so without it the card could not see the device cool down. A failing loop still backs off (router up to 1 min, root 15 / 30 / 60 s) but never polls faster than its heat delay.
- To try the slow-down on a cool phone, run `localStorage.setItem('liv_thermal_test','2')` in the browser console (0-3; `removeItem` to undo). It changes the polling speed only, not the temperatures shown.
- `validate.sh` now checks the delay table instead of the old literal numbers. Browser test extended (warm, hot, critical, cooling down, forced level, hot plus failing router). Not tested on a real device.

# MatchiTOOL (1.4.1) - Live status: speed, devices and monthly data (plan Phase 2)

- The Live device status card has a new row: **Download** and **Upload** speed, **Devices** on Wi-Fi, and **This month** (down + up, with the split). They come from the router keys `realtime_rx_thrpt`, `realtime_tx_thrpt`, `wifi_access_sta_num`, `monthly_rx_bytes`, `monthly_tx_bytes` (UFI-TOOLS fields), read by the same 3 s router loop, no extra root calls. Speeds are read as bytes per second and shown with 1024-based units (KB/s, MB/s); this unit is taken from UFI-TOOLS and still to be confirmed with a real download on the F50.
- A tile is hidden when the router does not return its key (empty, missing, negative or not a number); a real 0 still shows as 0 B/s. "This month" needs both monthly keys.
- `ppp_status` is requested too: anything other than connected shows a small "Data off" / "Data ..." badge next to the network type.
- Browser test `scripts/phase0/test_live_loops_browser.js` now also covers the formatting and the hide rules. Not tested on a real device.

# MatchiTOOL (1.4.1) - Live status: router and root reads run as two loops (plan Phase 1)

- The Live device status card reads the router every 3 s (no root) and the root shell (battery, temperatures, CPU, memory, uptime) every 15 s, each on its own timer with its own back-off. Slower when the phone is warm or hot; the router loop backs off to 1 min when the router fails and the card falls back to the modem AT / telephony path.
- A hidden browser tab no longer polls (before, both loops kept running in a background tab). The first root read is no longer repeated 3 s after the start.
- New browser test `scripts/phase0/test_live_loops_browser.js` (needs Playwright, not part of validate.sh): cadence, merge, Live refresh off, another window open, hidden tab, router failure and recovery.
- Temporary `PHASE0-TIMING` console lines (read times and temperatures) are still in the page for the on-device baseline; they are removed in Phase 6. Not tested on a real device.

# SMS delete / send: router "set" token is SHA-256 (as in UFI-TOOLS 4.1.5)

- Read from the UFI-TOOLS 4.1.5 APK (`requests.js`, `processAD`): AD = SHA256(SHA256(wa_inner_version + cr_version) + RD), upper-case hex. MatchiTOOL built it with MD5, so the router answered every "set" (SMS delete, SMS send, settings) with an empty body and did nothing.
- `ZteClient.adToken` now uses SHA-256 first; the old MD5 form is only the last retry (retry 2). The router "set" error text shows `AD ok/sha256` or `AD ok/md5`.
- SMS delete tries the router up to three times (normal, fresh login, fresh login + MD5) and checks the router's list after each try, and no longer skips the router for an hour after one empty reply.
- Dialogs made with `createModal` keep their footer below a scrolling content area; footers with two or more buttons are one row (fixes the floating Refresh Status / Close in the AdGuard Home dialog).

# MatchiTOOL (1.4.1) - Bypass (F50) removed

- **The bundled Bypass (F50) plugin is gone** (`assets/plugins/Bypass_v65_13.js`), with its `LICENSE-BYPASS` and the page rules that treated its dialog as a special case. The dialog and switch fixes stay for every plugin. Boot lines and firewall rules an earlier install wrote stay on the router until removed by hand (README, "Bypass tool" note).

# MatchiTOOL (1.4.1) - plugin dialogs: no strip on the right, round switches

- **The dim layer behind a plugin dialog now always covers the whole window.** The Bypass dialog sets `#kano_bypass_modal{width:94vw!important}`; in MatchiTOOL that id is on the full-screen layer, so it ended 6% short and the right side (Live status, Reboot) stayed bright. A rule in the page (`style#dialog-fixes`) keeps any `.modal-bg` at full window size.
- **Switches inside dialogs (Bypass: Block QUIC, Auto-apply at boot) are full pills again.** The general dialog-button rules gave them a minimum height and a 7 px corner, which made them boxy. Only the page changed; the Bypass plugin file is untouched. Not tested on a real device.

# MatchiTOOL (1.4.1) - plugins are erased completely on delete

- **Deleting a plugin now cleans up after it without header lines.** Folders named after the plugin in `/data/local`, `/data/local/tmp` and `/sdcard`, and saved browser settings (local and session storage) starting with the plugin's name, are erased with it and listed in the Delete dialog first. Same strict path checks as before. New test in `PluginDataTest`. Not tested on a real device.

- **Plugins are traced while they run, so Delete can erase what they wrote.** The page tags root commands and uploads with the plugin that sent them (`x-matchi-plugin`, from the plugin's own stack frame); the host keeps a ledger per plugin (`filesDir/plugin_trace/`): paths its commands write to, uploaded files, and side effects that cannot be undone (firewall, properties, background processes, boot lines). Delete erases the ledger's paths (strict `checkPluginDataPath`, listed in the dialog), its uploads, empty parent folders, and also its IndexedDB / Cache Storage entries named after it. New `PluginTrace.kt`, `PluginTraceTest`, `scripts/test_plugin_trace.js`. Not tested on a real device; the Kotlin was not compiled here.


## Earlier: plugin code split into web-src

- Plugin host API, store logic and store window now live in `app/src/main/web-src/*.js` and are inlined into the single shipped `index.html` by `scripts/build-web.js`. Page behaviour is unchanged (page without the 6 marker lines is byte-identical to before). `validate.sh` runs `build-web.js --check`, so CI fails if the two drift. See `docs/WEB_SOURCE.md`.

# MatchiTOOL (1.4.1) - plugin compatibility report and plugin header

- Confirm dialogs for store installs and `.txt`/`.html` imports now include a static compatibility check (routes MatchiTOOL does not serve, undefined `getCookie`/`setCookie`, UFI tools and files that are not shipped). Known gap it reports: `/api/get_custom_head` and `/api/set_custom_head` (UFI) are not implemented here.
- Optional plugin header `@matchi-name / -version / -author / -description / -requires`, shown in the Plugins list.
- `MATCHI_ROUTES` in the page is verified against `WebServer.kt` in both directions (`scripts/test_ufi_store.js`); new browser smoke test `scripts/phase0/test_store_browser.js`.

# MatchiTOOL (1.4.1) - plugin store reads UFI-TOOLS stores; capture shows real temperatures

- Plugin store: reads the UFI-TOOLS index format (`download_url` + `res.data.content[]` with `hash_info.sha256`), checks the SHA-256 over the raw downloaded bytes (a BOM or odd bytes no longer change it), and has a **UFI-TOOLS plugins (community mirror)** source button. Archives and folders (which need the UFI-TOOLS app) are hidden and counted; file size is shown. Tests: `scripts/test_ufi_store.js`.
- Boot capture `matchi_logd.sh` v6: `context.txt` lists every kernel thermal zone (the F50 battery sensor reads a fixed 750 / 25.0), names of boot scripts and of files or processes naming `minikano` / `ufi_tools` (an old UFI-TOOLS launcher was starting the missing app every 30 s as root); `status` carries a `thermal=` line.
- CI: longer Gradle HTTP timeouts and retries, and a 3-try retry around the Gradle steps in both workflows (dl.google.com "Read timed out").

# MatchiTOOL (1.4.1) - heat: gentler UFI_DATA poller

Reported: the ZTE F50 runs hot after the 1.4.0 update. Found by reading the code and the 1.3.9 log bundle (no on-device CPU or temperature figures yet):

- UFI_DATA poller, while an enabled plugin reads UFI_DATA and the page is open: when the router did not return `lan_ipaddr` it started a root shell (`ip addr | awk`) after EVERY poll, forever. The browser test `scripts/phase0/test_ufi_poll_browser.js` counts 21 such shells in 2 minutes on the old page. Now at most 3 tries per start.
- Poll interval 5 s -> 10 s (each round asks the router up to 3 times); while the page is hidden the loop only wakes every 60 s.
- Not changed (needs a device test): the boot-capture script `matchi_logd.sh` copies kernel lines with a shell `while read` loop. Your kernel wrote 37 lines/s on average (up to 120/s), 76% of them sprd-wlan tracing, and the load grows with hotspot traffic.

# MatchiTOOL (1.4.1) - stability review (static; Kotlin still not compiled)

- `/api/root_shell` default timeout is 30 s (cap stays 100 s, as UFI). Above 30 s a call counts as a long job and shares only 3 slots with the boot script and the IMEI keeper, so a plugin that omits the timeout could have crowded them out.
- `WebServer.serve`: an unexpected exception inside a route (not a deliberate IllegalArgument/IllegalState/IO/Update/JSON refusal) is now also written to the app log through `Quiet.note("WebServer.route", e)`. The reply is still 400 as before.
- New browser test `scripts/phase0/test_plugin_upload_browser.js` (needs Playwright, not part of validate.sh) covers the non-ASCII and HTML-as-.js uploads.
- Checked and left alone: bracket balance of every Kotlin file, root shell slots / timeouts / 1 MB output cap, request guards (Host header, hotspot-only, same-origin, login lockout), all 13 inline page scripts parse.

# MatchiTOOL (1.4.1) - Add plugin (.js) fixes seen on the F50

- `ADGuardHome插件2.4.js: invalid plugin name`: the host stores only ASCII file names, but the single-file upload sent the file name as it was. A name with Chinese characters, spaces or brackets now becomes a safe stable name (stem + hash + .js); the original name stays as the title in the list.
- `WiFi_v1.5.js: Unexpected token '<'`: that file is HTML saved as .js. A .js file that starts with `<` is now imported the way a .txt/.html UFI plugin is (script re-creation, head injection) instead of being syntax-checked as JavaScript.

# MatchiTOOL (1.4.1) - UFI-TOOLS plugin support, Phase 5.6: reply shapes taken from UFI's real server source

UFI-TOOLS' http-server source (modules/*.kt and frontEnd/public/script/main.js) replaced guesses from compiled strings. What changed:

- `GET /api/AT`: reply is now `{"result":"<text>"}` (no `success`/`error` fields) with HTTP 500 `{"error":"..."}` on failure, and the text is normalised exactly as UFI does (`AtBatch.ufiText`: newlines removed, closing OK becomes " OK", leading comma dropped). A slot other than 0 or 1 is still refused (UFI passes any number on).
- `/api/one_click_shell`: was wrongly a second root shell. UFI's is a GET with no body that drives the screen over adb to switch on its own root shell. Now GET only; the reply says whether root is available. The POST form is gone.
- `/api/root_shell`: errors are HTTP 500 `{"error":"..."}`; default and maximum timeout are 100 s, as in UFI.
- `/api/user_shell`: result is `{"done":true,"content":"<stdout>"}`.
- `/api/set_cookie`: replies `{"result":true}`.
- UFI plugin bundles: export now uses UFI's own block layout (newline after the START line, trimmed text, four newlines after END, whole text trimmed). This settles the "how blocks are joined" question without needing a real export-all file.
- Tests: `AtBatchTest.ufiTextMatchesUfiServer` (Kotlin, not run here), `scripts/test_ufi_bundle.js` (UFI layout round trip). `validate.sh` passes. Kotlin still not compiled.
- Known gaps left as they are: `/api/goform/*` only forwards the two get/set endpoints (UFI forwards any path as a raw proxy with Kano-Cookie headers); UFI's plugin store is an alist listing at its own server (`{download_url, res}`), not MatchiTOOL's index format; UFI treats a plugin as disabled when its text holds `[kano_disabled]` (written as a comment wrapper), MatchiTOOL does not read that flag.

# MatchiTOOL (1.4.1) - Log basket: review of steps 1 to 6

- **Redaction fails closed in the basket page:** if the page's redaction function is missing while "Hide private data" is ticked, View and Copy now stop with a message instead of showing the original text. Unticking the box still gives the original on purpose.
- **Snapshot guard:** only one snapshot is made at a time (a second request gets a "busy" answer), since it can read up to 64 MB of session files.
- `scripts/test_log_basket.js` extended for both. Not compiled or run here: the Kotlin and the screen on a device.

# MatchiTOOL (1.4.1) - Log basket: review fixes for chips and snapshot

- **Root shell chip on Audit rows:** every audit line is a root command, so the chip now keeps all of them. Errors and Plugins on an audit row show a one-line reason instead of an empty list.
- **Chips on Boot rows:** Errors uses the level the server already parsed for each boot line (raw logcat has no `[ERROR]` text). Plugins and Root shell say that plugin tags exist only in session logs.
- **Snapshot counts the whole session:** the plugin problem and route counts now read every kept part of the newest session (`_part` files too, up to 64 MB, oldest part dropped first), not just the last 3000 lines in memory. A before and an after snapshot taken at different times now compare like with like. The recent buffer is used only when no session file exists yet.
- `LogSnapshot.Counter` added (counts line by line); `LogSnapshotTest` and `scripts/test_log_basket.js` extended. Not compiled or run here.

# MatchiTOOL (1.4.1) - Log basket, steps 5 and 6: live view inside the basket, ready-for-update snapshot

- **Live view button (step 5):** the main screen now has only Log Basket. The old live panel opens from a Live view button inside the basket and has a Back to basket button. The stream check runs on a timer only while the panel is open, an alert is set or a stream is open.
- **Snapshot (step 6):** Snapshot: before update / after update saves one redacted text file as an Export row: app version, plugin script problems per plugin, plugin route counts and the last 200 lines. Route `POST /api/logs/snapshot`. Same layout every time so two files can be compared with a text diff.
- New `LogSnapshot.kt` and `LogSnapshotTest.kt`; `scripts/test_log_basket.js` extended. Not compiled or run here: the Kotlin and the screen on a device.

# MatchiTOOL (1.4.1) - Log basket, step 4: filter chips

- **Filter chips** above the View output: All, Errors (`[ERROR]` lines), Plugins (`[plugin/...]` tags) and Root shell (`[plugin/shell]`). The chosen chip applies when View opens, can be changed while viewing, and works together with the search box. The match line shows "n of m lines match".
- Chips filter the lines that were loaded (last 500, or the full-file option). Page only: no Kotlin change.
- `scripts/test_log_basket.js` extended: each chip, chip plus search, and View opening already filtered. Not opened in a browser or on the F50.

# MatchiTOOL (1.4.1) - Log basket, step 3: search, boot delete, tests

- **Search in View:** a box under the viewed log keeps only the lines that contain the text (case-insensitive) and shows "n of m lines match". It searches what is on screen (the last 500 lines, or the full-file option), after private data is hidden.
- **Boot files can be deleted** from the basket, but only rotated capture files (`logcat.log.1`, `dmesg.log.2` ...). The live `logcat.log` and `dmesg.log`, and the script's own info files, stay (they are still being written, or explain the capture). Needs the root gate; each delete is written to the shell audit log (`logs-boot-delete`). New `BootLogd.deleteFile` and the pure rule `LogBasket.bootDeletable`.
- **Page test:** `scripts/test_log_basket.js` (run by `validate.sh`) runs the basket's page script on a fake page with the page's real redaction function: copy hides a password and keeps it when the box is unticked, several rows get headers, delete sends only deletable rows (never the active session or the live boot file), the confirm explains audit and boot rows, and the search box filters.
- `LogBasketTest` updated and extended for the boot rule. Not compiled or run here: the Kotlin (`WebServer.kt`, `BootLogd.kt`, the tests) and the screen on a device.

# MatchiTOOL (1.4.1) - Log basket: the audit log can be deleted

- The audit log (`shell_audit.log`) row now has Delete. It is the only basket delete that needs the root gate (a root sign-in under 4 h; the "not encrypted" question over plain HTTP): without it the row stays and the page says "root sign-in needed". The confirm text explains what the file records.
- Deleting it is itself recorded: the server writes a fresh `audit-cleared` line (time, client address, hash of a fixed text) straight after, so the file is never silently empty. The list shows the audit row again with that one line.
- The active session and boot files are still not deletable from the basket. `POST /api/logs/basket/delete` results now carry a `reason` field (empty unless the root gate refused).
- `LogBasketTest` updated (audit is deletable). Not compiled or run here: the `WebServer.kt` change and the test still need `gradle :app:testDebugUnitTest`.

# MatchiTOOL (1.4.1) - Log basket, step 2: the basket screen

- New **Log Basket** button next to Log Catcher (Diagnostics row): a list with one row per log (type, name, size, date, a "logging now" / "root" mark) and a checkbox each. **Select all**, **View**, **Copy**, **Delete**, **Refresh**. No polling: the list loads when the window opens and when you press Refresh.
- View shows one row (the last 500 lines, scrolled to the end). Copy joins several rows with a `===== name =====` header. Both hide private data by default (same redaction as Log Catcher); untick "Hide private data in copies" to turn that off. "Full file" asks for up to 5000 lines from the last 2 MB of the file; boot files stay at 500 lines here (use Log Catcher for more).
- Delete asks once, deletes finished sessions and exports, and keeps the rest (the active session, the audit log, boot files); it says how many were kept.
- New routes: `GET /api/logs/basket/read?id=type:name[&tail=N|&full=1]` (session, export or audit; boot files keep `/api/logs/boot/read`) and `POST /api/logs/basket/delete` body `{ids:[...]}` (max 100; per-row `{id, ok}` result). Ids go through `LogBasket.parseId`, so only plain file names in the known folders are reachable.
- `LogBasket.tailLines` and `clampTail` (pure Kotlin) with tests. The page's redaction function is now also available as `window.__lcRedact`.
- The live panel and all existing log routes are untouched.
- Not compiled or run here: the `WebServer.kt` routes, `LogBasketTest`, and the page (not tried in a browser or on the F50).

# MatchiTOOL (1.4.1) - Log basket, step 1: one list of every log

- New `GET /api/logs/basket`: one row per log file of every kind, newest first inside each type: Session (`files/logs/sessions/*.log`), Export (`files/logs/exports/*.txt`), Audit (`files/shell_audit.log`) and Boot (`/data/local/matchitool/bootlogs/*`). A row has `id` (`type:name`), `type`, `name`, `size`, `modified` (epoch ms, 0 for boot files) with `modifiedText`, `active`, `rootOnly` and the flags `canView`, `canCopy`, `canDelete`.
- Boot rows are listed only when boot capture is installed and the root gate passes; otherwise `bootNote` says why. Without root the route still lists the other three types.
- Delete is allowed for finished sessions and exports only. The active session, the audit log and boot files are not deletable from the basket yet (audit stays view and copy only until you decide; boot files need their own root route in step 3).
- New `LogBasket.kt` (pure Kotlin: ids, name safety, order, delete rules) and `LogBasketTest`. A row id only accepts a plain file name, so later steps cannot be pointed outside their folder.
- No page change yet (step 2 adds the basket screen). Existing log routes and the live panel are untouched.
- Not compiled here: the `WebServer.kt` route and `LogBasketTest` still need `gradle :app:testDebugUnitTest`.

# MatchiTOOL (1.4.1) - Log Catcher: plugin-aware logging

- Plugin errors now name the plugin. Plugin scripts carry a `//# sourceURL=matchi-plugin/NAME` line, so the page's error reports (and rejected promises, from their stack) reach the log as `[plugin/js] [NAME.js] JS error: ...` instead of an anonymous `WebPage` line pointing into index.html.
- Plugin-facing routes are logged with a `plugin/...` function tag (`plugin/shell`, `plugin/at`, `plugin/goform`, `plugin/proxy`, `plugin/head`, `plugin/cookie`, `plugin/upload`): method, path without the query, HTTP status and time. Successful calls are DEBUG (polling stays quiet), refusals (401/403/404/429) and calls over 5 s are WARNING, 5xx is ERROR. Never logged: command text, query values, cookies, request or reply bodies. Filter by `plugin` in Log Catcher.
- New `PluginLog.kt` (pure Kotlin) and `PluginLogTest`. Not compiled here: no Gradle or Android SDK in this sandbox, so `WebServer.kt` changes and the new test still need `gradle :app:testDebugUnitTest`.

# MatchiTOOL (1.4.1) - Phase 5.5 (partial): first Kotlin compile

- First time any of the Kotlin was compiled. The Android build still cannot run in the build sandbox (no Android SDK, no network), but the Kotlin compiler inside Gradle can compile the files that use no Android classes. New `scripts/kotlin_pure_tests.sh` does that and runs the unit tests that only need them with JUnit: **106 tests pass** (AtBatch incl. the new `/api/AT` rules, GatewayProxy incl. refusal of other hosts, UfiPathMap, RootGate, LoginGuard, Redactor and others).
- Bug found and fixed: `GatewayProxy.kt` had `/api/goform/*` and `/api/proxy/*` inside doc comments. Kotlin comments nest, so `/*` opened a comment that was never closed and the Gradle build would have failed ("Unclosed comment"). Reworded; no other Kotlin file has this.
- Still not compiled: `WebServer.kt` (incl. the `/api/AT` route), `RootShell.kt`, `PluginOrder.kt` and every other file that imports `android.*`, `org.json` or NanoHTTPD, and the 8 tests for them (ExitReasonModel, HostControl, HostHeader, NoiseGate, PluginData, PluginOrder, RootShellLauncher, SourceCounters). Run `gradle :app:testDebugUnitTest` on a machine with the Android SDK (`scripts/bootstrap-build.sh`). No device run yet.

# MatchiTOOL (1.4.1) - UFI-TOOLS plugin support, Phase 5.3: UFI's `/api/AT` route

- New route `GET /api/AT?command=AT+CSQ&slot=0`, the one UFI-TOOLS' own `ufi_req` help text shows and the E5 baseband plugin calls. It runs the command through the bundled `sendat`, like `/api/at` (POST), with the same gate: pure reads (`AT+COPS?`, `AT+CSQ`, `AT+CGMR=?` ...) need only a session; anything else (NV writes, `AT+CFUN`, `AT^...`, chained commands) also needs the root gate (sign-in under 4 h; the page's "not encrypted" question over plain HTTP). Writes are written to the shell audit log (hash and length of the command only).
- Reply: `{"success":true,"result":"<modem text>","error":null}`, or `{"success":false,"result":null,"error":"<text>"}`. Checked against the E5 plugin's own reader (v1.0.4: it takes `result` or `content` as text and fails on a truthy `error` or `success === false`; it only sends `AT+CFUN?`, `AT+CFUN=0` and `AT+CFUN=1`, and needs `OK` in the reply for the two writes), so this shape works for E5. For other plugins it is still **a guess**: UFI's server code is compiled and no plugin or script in the APK reads the reply. `result` and `error` match UFI's shell routes; `success` matches MatchiTOOL's `/api/at`. Compare with a real reply from an F50 before relying on it.
- Stricter than `/api/at` on purpose: `slot` must be missing, `0` or `1` (anything else is a 400 instead of being clamped to the other SIM slot), and the command may not contain NUL, CR or LF. A command must start with `AT` and be at most 300 characters.
- The page's fetch shim now treats `/api/AT` like the shell routes: over plain HTTP it asks the "not encrypted" question once before an AT *write* (reads never ask). The rule is a copy of `RootGate.isReadOnlyAt`.
- `scripts/phase0/scan_plugins.js` now lists routes written as `${KANO_baseURL}/AT?...` and no longer reports them as dynamic. Tests: `AtBatchTest` (command and slot rules; Kotlin), `test_ufi_host.js` (shim asks for writes and chained commands, not for reads), `test_phase0.js`. `validate.sh` checks the route and the shim rule exist.
- The E5 plugin edits baseband NV and can brick a device. Back up first (for example read the values with AT first and keep them); MatchiTOOL does not add a safety net for it.
- Not shown yet: Kotlin compiling (`gradle` here has no Android SDK, so `testDebugUnitTest` could not run); the E5 plugin working on an F50; the real UFI reply shape; `sendat` timing for slow NV commands (the route allows 15 s, same as `/api/at`).

# MatchiTOOL (1.4.1) - UFI-TOOLS plugin support, Phase 5.1: globals and menu that real plugins need

Found by running 8 real UFI plugins in Chromium (4 of them failed on names MatchiTOOL did not define).
- New page globals: `checkAdvancedFunc()` (true when the root shell answers `root`), `encodeBase64()` (UTF-8 safe), `getData(URLSearchParams)` (router read through `/api/goform/goform_get_cmd_process`, adds `multi_data=1` for a comma list), `postData(login, {goformId,...})` (router write through `/api/goform/goform_set_cmd_process`, form body, returns a fetch `Response`), and `login()` (a function again: the page element `#login` used to shadow it; it only returns a marker because the host signs in to the router itself).
- `postData` asks once per page load before an `ENABLE_PIN` command (a wrong PIN value counts as a failed attempt and can lock a SIM); cancelling sends nothing.
- New plugin menu anchors: `#collapseBtn_menu` with a next sibling holding `.collapse_box` (the button shows only once a plugin adds something and folds the box), and `.functions-container`.
- `UFI_DATA` default field list now includes `monthly_tx_bytes` and `monthly_rx_bytes`.
- `scripts/phase0/scan_plugins.js`: counts `window.UFI_DATA`, lists `checkAdvancedFunc`, `getData`, `postData`, `encodeBase64`, `login` and the page elements a plugin uses. Added `scripts/phase0/run_plugins.js` (Playwright: runs each plugin alone against a stubbed `/api`, reports errors, shell commands and new elements) and `scripts/phase0/test_ufi_globals_browser.js` (14 checks of the items above). Both need Playwright and Chromium, so `validate.sh` does not run them.
- Result with the 8 plugins: no page errors; the USB, ADB-off and Ethernet-reboot plugins now run; the 飞猫 network switch posts `ENABLE_PIN` as a form.
- Not shown yet: Kotlin compiling; any of this on an F50; the router's real reply to `/api/goform` writes; E5's `/api/AT` route (still missing).

# MatchiTOOL 1.4.0 - UFI-TOOLS plugin support, Phase 4: tools, plugin store, security pass

- New bundled arm64 tools, taken unchanged from the UFI-TOOLS 4.1.5 APK: `jq`, `sha256` and `zreq`. They are copied to the app's files folder at start-up like curl, so a plugin that calls `/data/data/com.minikano.f50_sms/files/jq` (and `sha256`, `zreq`) finds them through the Phase 2 path map. SHA-256 pinned in `NOTICE.md` and `scripts/validate.sh`. `ufi_req`, `socat`, `ttyd`, `adb`, `iperf3` and `imei_reader` are not bundled: the Phase 0 corpus is still empty, so which tools plugins need is a guess (jq, sha256 and zreq were the roadmap's likely three). Scheduled tasks were not added (no plugin is known to need them).
- New **Plugin store** (Plugins card): load an index JSON from an https address, search, page through it, install with a confirm. Fetching runs in the browser page, so the app still makes no network request of its own. Before the confirm it shows the file's SHA-256 (refuses a file that differs from the hash in the index), the commands and bundled tools the source names, risky patterns and which plugins would be replaced. The scan is a text search and is not a safety check. Format and limits: `docs/PLUGIN_STORE.md`. No default store address is built in.
- Store URL rules: https only, a domain name (no IP address, localhost, `.local` and similar), no credentials in the URL, redirects re-checked, 1 MB index / ~4 MB plugin / 20 s limits, no cookies or referrer sent.
- Security pass: `POST /api/proxy/*` now needs the root gate (a POST can change router settings through any router path); `GET` stays open. This changes the Phase 3 decision that proxy is not root-gated.
- Tests: `scripts/test_ufi_store.js` (SHA-256 against Node's for the padding edge lengths, URL rules, index parsing, paging, scan; run by `validate.sh`). `validate.sh` also pins the three new binaries and checks the store pieces exist.
- Phase 0 tools added in `scripts/phase0/`: `scan_plugins.js` (static per-plugin table of helpers, `/api` routes, UFI_DATA fields, UFI paths, bundled tools and shell use, from UFI `.txt` exports or loose files; text, `--json` or `--csv`) and `deob_requests_js.js` (decodes an obfuscator.io style string table; run on UFI 4.1.5 `requests.js` it replaced 1556 string calls with 0 failures and showed `/root_shell`, `/user_shell`, `/get_custom_head`, `/set_custom_head`, `/get_cookie`, `/set_cookie`, `/adb_alive`, `/version_info`, `/update_admin_pwd`). Test: `scripts/test_phase0.js`. The scanner is static (run-time URLs show as "dynamic") and has only run on synthetic plugins; the Playwright harness is still not written.
- Version 1.4.0 / versionCode 400 (app, web page, validation, README).
- Not shown yet: Kotlin compiling (still no Kotlin, Gradle or Android SDK in the build sandbox); the store dialog and installs in a browser; the new binaries running on an F50 (`sha256` has no section headers and was only checked as an ELF file, never run); a real UFI plugin corpus passing.

# MatchiTOOL (unreleased) - UFI-TOOLS plugin support, Phase 3: modem data and router API

- `window.UFI_DATA` is now filled by a poller that runs only while an enabled plugin mentions `UFI_DATA`. It asks the router for the fields the plugins read (`UFI_DATA.name` or `UFI_DATA['name']`; the router's own field names are the keys) through `/api/zte`, 20 fields per request, one request at a time. It polls every 5 s, waits longer (doubling to 60 s) while the router does not answer, pauses while the page is hidden, and stops when no enabled plugin uses it. A plugin that reads it in a way the page cannot see (a computed key, `Object.keys`) gets a default list of usual ZTE names. UFI-TOOLS' own full field list could not be read (its `main.js` is obfuscated), so that default list is a best guess. `cpuUsageInfo` is computed by UFI-TOOLS itself and stays empty. `lan_ipaddr` still falls back to the bridge interface.
- New routes: `GET /api/goform/goform_get_cmd_process` and `POST /api/goform/goform_set_cmd_process` (query, form or JSON parameters; the AD token is added for a set, like `/api/zte`; the router's raw reply is returned), `GET|POST /api/proxy/<path>` (a plain path on the saved gateway, with the router session), `GET /api/get_cookie` and `POST /api/set_cookie` (body `{cookie}`; both root-gated, because the cookie signs in to the router). UFI's request and reply shapes for these were not seen; `get_cookie` replies `{cookie}` and `set_cookie` replies `{result, error}` by analogy with `set_custom_head`.
- The target is always the saved gateway. A request can only choose a path: `GatewayProxy.safePath` refuses another host (`//host`, `http://...`, `host@...`), `..`, encoded separators and anything outside `[A-Za-z0-9._/-]`. `ZteClient.proxy` also checks the saved address with `RouterHost` before every call. Only the two goform endpoints are forwarded by `/api/goform/*`.
- Tests: `GatewayProxyTest` (Kotlin; includes the cases for a request to any host other than the saved gateway) and `scripts/test_ufi_data.js` (run by `validate.sh`). Not compiled, not run in a browser, not run on a device.
- Not changed: `/api/zte` and its stored encrypted credentials; version became 1.4.0 in Phase 4.

# MatchiTOOL (unreleased) - UFI-TOOLS plugin support, Phase 2: runtime API and paths

- The UFI-TOOLS helpers now live in the page, not in each converted plugin. `createModal` follows UFI's signature: `onConfirm`, `confirmBtnText`, `closeBtnText`, `isMask`, `noBlur`, the `NAME_confirm` and `NAME_close` button ids, the id returned as `#NAME`, and the dialog closes only when `onClose` / `onConfirm` return a true value (a dialog with no `onClose` stays open, as in UFI). `showModal` and `closeModal` take a selector, a bare id (the old form), `time`, and a callback in either place; `closeModal(sel, 300, cb)` no longer throws. `createToast` runs its callback and treats a non-built-in colour as the text colour. `copyText` takes a string or a click event.
- New globals: `runShellWithUser`, `createSwitch`, `createFormToast`, `setBtnLoading`, `formatBytes`, `escapeHtml`, `wait`, `debounce`, `t()` (English strings for the helpers only). Ported from UFI-TOOLS 4.1.5 (MIT, see `LICENSE-UFI-TOOLS`).
- Same-origin `/api/` calls made with `fetch` by a plugin get the session token added; root-capable routes over plain HTTP ask the usual "not encrypted" question first. UFI's `kano-t`, `kano-sign` and `authorization` headers are accepted and ignored.
- New routes, all behind the same root gate as `/api/shell`: `POST /api/root_shell` and `POST /api/one_click_shell` (body `{command, timeout}`, run as root) and `POST /api/user_shell` (body `{command}`, runs as the app's own user, no `su`, 20 s limit, 256 KB output cap). Replies are `{result, error}`. `user_shell` returns `result` as `{content: text}`, which is how UFI's own upload code reads it. The `one_click_shell` request and reply shapes in UFI are not confirmed; it is treated as `root_shell`.
- New `UfiPathMap.kt`: before any root command from `/api/shell` or the aliases runs, `/sdcard/ufi_tools_boot.sh` (and `/storage/emulated/0/...`) becomes `/data/local/matchitool/boot.sh`, and `/data/data/com.minikano.f50_sms/...` becomes this app's files folder (UFI's `files/uploads`, `files/curl` and `files/sendat` therefore point at this app's uploads folder, curl and sendat). Whole prefixes only. The audit log still records the command as sent.
- `POST /api/upload_img` now replies `url: "/uploads/NAME"` as UFI does, so a plugin that cuts `/uploads/` off gets the right file name. `/api/upload` still replies `/api/uploads/NAME`.
- The Bypass tool's ~200-line embedded compatibility block is gone; it uses the page's `window.__matchiCompat` (same names as before) and the page's modal helpers. Converted plugins that carry their own copy (`window.__matchiCompat || ...`) adopt the page's.
- Tests: `UfiPathMapTest` (Kotlin) and `scripts/test_ufi_host.js` (fake DOM; run by `validate.sh`). Not compiled, not run in a browser and not run on a device.
- On purpose different from UFI: toast text is plain text, not HTML, and every toast still stays 4 s whatever delay is passed (existing rule); a dialog's `el` is the box unless `isMask` is set.
- Not changed: version became 1.4.0 in Phase 4.

# MatchiTOOL (unreleased) - UFI-TOOLS plugin support, Phase 1: plugin format and manager

- UFI-TOOLS plugin files (one `.txt` of `<!-- [KANO_PLUGIN_START] name -->` ... `<!-- [KANO_PLUGIN_END] name -->` blocks) can be added in Plugins. Each block is stored as its own `.html` plugin beside the `.js` ones, with UFI's own marker pattern. Inside text is kept as it was; script tags are re-created so they run, and style/meta tags go to the page head in saved order.
- New **Export UFI .txt** / **Import UFI .txt** buttons. Export writes `.js` plugins as `<script>` blocks. Limits: 1 MB per block, 50 plugins, 4 MB per UFI file (UFI's own), 5 MB stored in total.
- Load order: Move up / Move down buttons and drag-and-drop in the plugin list. The order is saved (`POST /api/plugins/order`, root-gated like uploads) and applies the next time the page loads. Plugins never ordered still load alphabetically.
- `GET /api/plugins` now also returns `kind` (`js` or `html`) and `title`. `POST /api/plugins` accepts an optional `title` (the block's original name, which may hold spaces or non-Latin letters) and `.html` names. Deleting a plugin also forgets its order and title.
- Tests: `PluginOrderTest` (Kotlin) and `scripts/test_ufi_bundle.js` (run by `validate.sh`). Not compiled or run on a device yet, and the DOM injection needs a browser test.
- Not changed: version became 1.4.0 in Phase 4.

# MatchiTOOL 1.3.9 - bundled curl

- Android has no `curl`, so plugins that download files (ADGuard Home and other converted UFI-TOOLS plugins) stopped at "Downloading 0%" with no error. The app now ships an arm64 `curl` (`assets/bin/curl`, curl 8.0.1-DEV from the UFI-TOOLS V4.0.0 APK) and copies it to `files/curl` at start, using the same copy-then-rename as `sendat`.
- The plugin helper's `curl` wrapper now also looks in `/data/data/com.matchi.tool/files/curl` (after a hand-placed `/data/local/matchitool/bin/curl.real`, which still wins). Its "no curl" message now says to update the app.
- Diagnostics report lists the bundled curl. `validate.sh` pins the curl SHA-256; `NOTICE.md` records it.
- Not changed: no new permissions, no network code in the app itself.
- Version 1.3.9 / versionCode 309 (app, web page, validation, README).

# MatchiTOOL 1.3.8 - Log Catcher leftovers (privacy of single-file exports, keep-every-line switch)

- Redaction now also covers the single-file buttons: **Export .txt**, **Export .log** and every **Copy** button (visible log, whole boot file, boot page). The same box as for the zips (now "Hide private data in exports and copies", on by default) controls it; the toast says how many lines were changed. The rules are a JavaScript copy of `Redactor.kt`; `scripts/test_page_redact.js` runs the `RedactorTest` cases against the page so the two cannot drift apart. Files on the device are never changed.
- New switch "Keep every line (no noise filter)" in the device capture section (`NoiseGate.keepEverything`, saved as `keep_all`, API field `keepAll`). When on, the in-app capture (app, device logcat, kernel) drops and collapses nothing at capture time; the priority level above it is still applied, so set it to Debug to keep everything. Off by default (a busy device can then fill the 4096-line write queue; refused lines are counted in `queueDropped`). `NoiseGateTest` covers it.
- Boot capture script unchanged (still v5). The boot script never filters.
- Not done, on purpose: gzip of finished boot files (logcat renames its own rotated parts, so a `.gz` next to them would break its rotation and the size cap; zip exports are compressed) and the log buffer per line (Android `threadtime` has no buffer field; it would need one logcat per buffer).
- Docs: the "app events.log as its own source" item was already done in script v4 (`app_events.log`); `validate.sh` silent-catch baseline is 0 (the 1.3.7 note below still says 48).
- Version 1.3.8 / versionCode 308 (app, web page, validation, README).

# MatchiTOOL 1.3.7 - Boot capture (Log Catcher improvement path, phases 1, 2 and 5)

- Phase 4: `Redactor.kt` (SMS text, phone numbers, IMEI/ICCID, passwords, tokens; unit tested) hides private data in zip exports (checkbox "Hide private data in zips", on by default; REDACTION.txt lists what was hidden); new "Full bundle (.zip, root)" export = logs + device info + dmesg + all boot capture files (context, Magisk log, modules, app files) + sessions; boot script v5 adds retention by age (`RETAIN_DAYS`, page field "Keep days", 0 = off, only rotated parts are removed). Gzip of finished files at rest was not done (logcat rotates its own files and the viewer reads them as text); the zip export is compressed.
- Small leftovers: `CaptureLines.kt` (Android-free, unit tested in `CaptureLinesTest`) now holds the line parsing of the in-app and device logcat loops; boot script v4 also copies the app boot-task log (`/data/local/matchitool/events.log`) as `app_events.log`.
- Medium patch: boot script v3 also copies the Magisk log (first of /data/adb/magisk.log, /cache/magisk.log, /data/cache/magisk.log), a Magisk module list (modules.txt), the app shell audit log and the updater log (last 256 KB each, refreshed every ~5 min, small size-cap allowance +1 MB). They appear under "Info and events". Web page: app sessions grouped newest first; info files listed in the main viewer; the top Copy button copies the whole boot file (not only the visible page).
- New boot-time capture script `assets/bin/matchi_logd.sh` (versioned). Installed from the Log Catcher page ("Boot capture") into `/data/adb/service.d/`, it runs Android's own `logcat -b all -v threadtime` and `dmesg -w` into size-capped rotating files in `/data/local/matchitool/bootlogs/`, from boot and independent of the app. Nothing is filtered or dropped at capture time.
- Supervisor loops restart logcat/dmesg with back-off and fall back to simpler flags (`-v year`, `-b all`, `logcat -b kernel`, `/proc/kmsg`); each restart writes a gap marker (`logcat.gaps`) and a line in `events.log`.
- Hard cap: FILE_KB x FILES per source (defaults 2048 KB x 10, limits 64-16384 KB and 2-40 files); capture pauses below MIN_FREE_MB free on /data and resumes by itself.
- `context.txt` written at every start (build, kernel, Magisk, SELinux, app version, memory, network); `status` heartbeat file every 30 s.
- App: install/remove with one root call, settings, self-test (a test line must appear in logcat.log), re-install when the shipped script version is newer or the script is not running (checked at boot).
- Web page: Boot capture panel with state, install/remove, file list, paged reading (300 lines per page, no 3,000-line limit) and jump-to-time. API: `/api/logs/boot/{status,files,read,install,uninstall}`, all behind the root gate; file names are whitelisted.
- Guards: `scripts/test_logd.sh` (runs the real script against fake logcat/dmesg/df), `BootLogdModelTest`, validate.sh checks (script header, root gate on routes, silent-catch baseline of 48).
- Patch: RootShell no longer warns "read interrupted" when a root shell is closed on purpose; ExitReasons logs why the previous app process ended (Android 11+, ApplicationExitInfo, once each); JavaScript errors from the web page are sent to the app log (`POST /api/logs/clienterror`, max 20 per page load).
- Update link now defaults to `https://github.com/OWNER/MatchiTOOL-releases/releases/latest/download/MatchiTOOL.apk` and always follows the newest release. A pasted release-page link (`.../releases/tag/build-N`) is turned into the latest-release link, so no tag has to be edited per build.
- Check for update now defaults to `https://github.com/OWNER/MatchiTOOL-releases/releases/latest/download/MatchiTOOL.apk`; a pasted `/releases/tag/build-115` page link is converted; a different APK file name in the release is resolved (single .apk); `build-N` tags are no longer compared as versions.
- Fixed the remaining "A resource failed to call end." warnings: NanoHTTPD decides gzip per response after serve() and overrode setGzipEncoding(false); WebServer now overrides useGzipWhenAccepted() to return false.
- Noise filter, second round (from a second F50 log): all sprd-wlan / sc2355_* bookkeeping except lines that report a problem (disconn, fail, error, timeout), sipa_eth flow-control lines, sprd_wdt_fiq, cpufreq, wlan0 get_station; ZTE polling modules (PinModule, PinApi, EmptyModule, PollingCommandProcessor, DispatchModule, MobilePhoneStateCache, ThermalManager, ...) are dropped at INFO/DEBUG (WARNING/ERROR kept); TrustyKeymaster "succeeded"/"Getting response size" and "Bluetooth service is null" are shown as INFO instead of ERROR. On that log: 500 lines -> 24 (the remaining 12 or so are the old build's own "repeated N more times" summaries). Boot capture stays unfiltered.
- Phase 2 finished (except the log buffer per line and capture-time filtering, see below):
  - Viewer shows the original Android time, PID/thread, level and tag of boot-capture lines (new `LogLineParser`, unit tested). Android's threadtime format does not say which buffer (main/system/radio/events/crash) a line came from, so no per-line buffer column exists; only the `--------- beginning of <buffer>` markers are shown.
  - Boot capture files (logcat.log*, dmesg.log*) are now in the same dropdown as the app sessions, with Prev/Next/Latest and go-to-time, and the existing level/source/tag/search filters (display only).
  - Per-source counters (seen / shown / collapsed / dropped / gaps) for the app, device logcat and kernel sources in `/api/logs/status` and under the session selector; `/api/logs/boot/counters` counts the boot files (never filtered). `SourceCounters`, unit tested.
  - Still open: the in-app session still applies the noise gate when it records; moving that to display time needs a storage change.
- Phase 5: all 48 silent `catch (_: ...) { }` blocks now report through `Quiet.note` (first 5 failures per call site, then every 100th) as `quiet_<Class>_<function>` WARNING entries; `Quiet` is Android-free and tested (`QuietTest`). validate.sh baseline is now 0.
- Not done yet: phases 3 and 4 (more sources, compression, redaction, export bundle).
- NOT compiled or run on a device: this change was written without a Kotlin compiler. Run `./gradlew testDebugUnitTest` and install on the device before relying on it.

# MatchiTOOL 1.3.7 — Log Catcher fixes

- HTTPS: once the Android key store is seen to break the TLS handshake (as on the ZTE F50), that is remembered for the installed version and the next starts use the software key directly (no failed handshakes, no warnings, about 1 s faster). It is tried again after an update.
- Changing the console password now counts wrong "current password" guesses toward the same lockout as /api/login.
- Version metadata bumped to 1.3.7 / versionCode 307 (app, web page, validation) so the updater accepts the build; session pruning now never removes the session being written.

- Fixed the repeating "A resource failed to call end." warnings: NanoHTTPD 2.3.1 gzips responses but never closes its GZIPOutputStream, leaking a native Deflater per request. Its gzip is now disabled for every response; the web page is gzipped once at first use (stream closed) and served with Content-Encoding when the browser accepts it.
- Web Log Catcher: the "Delete session" button is now always visible (greyed out until a saved session is picked in the dropdown) instead of staying hidden.
- Silent-tag filter also applies to device-wide capture (`device/` prefix); added NoiseGateTest.
- Fixed the web live view freezing after the host restarted: the stream now sends a `reset` event when the page's last id is ahead of the server's, and the page clears its rows and reloads.
- Fixed Delete session sometimes leaving the session in the list: the delete call now waits (max 3 s) for the writer to remove the files before answering.
- Removed the native Log Catcher screen and its Home button: Log Catcher is now web-only. The collector, session files and web page are unchanged and still run from the service.
- Kernel/dmesg capture now goes through the noise gate and drops Unisoc driver chatter (sprd-wlan per-packet tracing, SPRD_PDBG sleep dumps, sipa_rm/sipa_dele, WCN loopcheck, cpufreq, fuel-gauge, healthd) that made up ~90% of an F50 log; real faults (sta disconn, TX Err, charge_set_basp failed, sipa_eth errors other than -115) are kept.
- Known-benign platform ERROR/WARNING lines (sprd_wdt_fiq timeout=40 heartbeat, UnisocWatchdog, ThermalHal "can't find this type sensor", hostapd "No SAE PMK found", sipa_eth ret -115, zte.analytics service-not-found) are now recorded as INFO.
- Log Catcher no longer records TrafficStats / mali_gralloc platform chatter or permissive-SELinux audit lines about this app.

# MatchiTOOL 1.3.6 — Log Catcher Complete Edition

- Persist active log-session state and recover interrupted sessions after process/device restart.
- HostService initializes Log Catcher on startup so recovery works even when the UI is never opened.
- Retain independent Start/Stop, bounded background logcat capture, and paired .log/.txt session records.

# Changelog

## 1.3.3 - Web Log Catcher reliability
- Added direct `.log` export alongside `.txt` export.
- Start action now checks the API acknowledgement and reports a failed session start instead of silently appearing successful.
- Starting a new session clears history selection, refreshes the session list, and returns the viewer to the live session.
- Export links are attached to the document before activation and object URLs are retained briefly for mobile browser compatibility.

# MatchiTOOL v1.3.2 — Web Performance Optimization

- Reduced Log Catcher polling from 1.5s to 3s.
- Poll only while the Log Catcher popup is open and the browser tab is visible.
- Prevent overlapping refresh requests to avoid request pileups on slow router connections.
- Repaint only when filtered log content changes (existing keyed render retained).
- Delay export Blob URL revocation to allow mobile browsers to begin the download.
- Corrected app and web version metadata to 1.3.2 / versionCode 302.

# MatchiTOOL v1.3.0 — Ultimate Performance, Stability & Diagnostics

- Hardened Log Catcher session creation with collision-resistant session IDs.
- Start logcat capture only after the session file has been created successfully.
- Reserve writer-queue capacity for session initialization/finalization and user-requested exports.
- Move `.txt` export off the UI thread; report export success/failure asynchronously.
- Prevent Log Catcher screen callbacks from continuing after the Activity stops or is destroyed.
- Refresh recent logs when returning to the screen and de-duplicate queued events by monotonic ID.
- Version metadata aligned to 1.3.0 / versionCode 300.
- Existing root command limits, service retry handling, bounded screen/log queues, TLS fallback, updater validation, and diagnostics retained.
- Validation: `bash scripts/validate.sh` passed. Full Gradle/APK and physical-device stress tests still required.

---

# Changelog

## 1.2.33 — Review fixes
- Corrected Android package and embedded web-page version metadata to 1.2.33 (versionCode 233).
- Batched Log Catcher UI updates at 200 ms intervals to avoid rebuilding the log list for every event.
- Bounded pending UI events and recent UI history.
- Cached session-history lines while filtering and enabled function filtering for stored sessions.
- Reported log-session startup failure when the bounded writer queue cannot accept its header.
- Pruned rotated session files as well as previous session files.

- Log Catcher disk writes now run on a dedicated low-priority serial worker; UI, shell and network threads no longer perform per-event file I/O.
- Bounded the in-memory event history (3,000 entries), queued disk writes (4,096), per-session log size (8 MiB with rollover), and retained session count (30).
- Added safe handling for invalid log characters, listener failures, writer failures, and session-directory creation failures.
- Log session files are pruned oldest-first; the active session is retained.
- Aligned the embedded web page version and source validation with app version 1.2.30 (versionCode 230).
- Validation remains source-level; a full Android build and device soak test are still required.

## 1.2.29 (Log Catcher)
- Added an in-app Log Catcher screen with live entries, timestamps, severity levels, function/keyword filters, and session history.
- Added Start/Stop controls without restarting MatchiTOOL.
- Each logging session is automatically written to the app's private `files/logs/sessions/` directory as a separate `.log` file; manual `.txt` snapshots are saved under `files/logs/exports/`.
- Routed existing MatchiTOOL diagnostic log sites and uncaught exceptions into the collector.

# Changelog

## 1.2.28 - review fixes (items from MatchiTOOL_v1_2_27_bug_report.txt and the patched20 bug report)
- **Fix, 1.2.28 (was patched21)** (from `MatchiTOOL_v1_2_27_patched20_bug_report.txt`, not compiled, not tested on a device):
  - Bug 1: one `rootGate()` in `WebServer` (rules in the pure `RootGate` object) now guards every root-capable call: `/api/shell`, `/api/imei/apply`, `/api/usb/control`, `/api/screen/input`, `/api/update/install`, `POST /api/plugins`, plugin delete with erase, and `/api/at` + `/api/at/batch` for anything that is not a read-only query. Needs a sign-in younger than 4 h (`403 reauth`) and, over plain HTTP, the page's confirmation (`403 insecure`). Read-only AT queries (Live Status / AT Radio polling) are not gated. The page's `api()` now answers `insecure` for every path with the same once-per-load dialog and one retry.
  - Bug 2: `HostService` checks the hotspot/tether interface names every 45 s without root and re-runs the LAN firewall script when a new one appears, and about every 5 minutes as a safety net; each run writes a "LAN firewall opened" line to logcat.
  - Bug 3: the raw screen capture no longer starts `su` while root is in its refused cool-down (`RootShell.isDenied()`); a failed start sets the shared cool-down (`RootShell.noteDenied()`).
  - Bug 4: `LoginGuard.mayAskRouter` cleans up before looking up the address, so a new address keeps its entry beyond 256 tracked addresses.
  - Bug 5: `/api/upload` answers `url: /api/uploads/<name>`.
  - Bug 6: the online-update field is visible and empty (placeholder only); no third-party release link is pre-filled.
  - Housekeeping: versionCode 228; new tests `RootGateTest` and a 300-address case in `LoginGuardTest`.
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


## 1.3.4 — Web Log Catcher review fixes

- Initialize the session file before reporting logging as active, preventing a successful-looking Start response when storage initialization fails.
- Start process logcat capture only after the session file is ready.
- Synchronize Android package and embedded web page version metadata to 1.3.4.


## 1.3.5 — Log Catcher coverage and dual-format persistence

- Capture Android logcat output from the MatchiTOOL process during active sessions, complementing explicit LogCatcher events across app functions.
- Automatically mirror each session into `.log` and `.txt` files, including start/stop markers.
- Keep `.log` as the canonical history index to avoid duplicate session entries; rotate and prune paired text files with their log sessions.

## 1.3.6 - Log Catcher bug fixes
- Fixed recovery marker being written with a literal "\n" instead of a newline.
- Stop followed by a quick Start no longer reopens the stopped session.
- Uncaught crashes are flushed to disk (bounded wait) before the process dies.
- Rotated session files no longer contain spaces in their names.
- Logcat capture is generation-guarded (no leaked process, no stale lines); tags are trimmed.
- Session history picker maps to the correct file; history level filter uses the stored level.

## 1.3.6 - Log Catcher improvements
- Web: incremental polling (`/api/logs/entries?since=`) instead of resending the whole buffer every 3 s; server tells the client to reset if the app restarted.
- Web: Pause/Resume, Copy, and Delete session (finished sessions only); filters debounced; auto-scroll only when already at the bottom; dropped-write count shown.
- API: `POST /api/logs/delete` removes a finished session (.log and .txt); the active session is refused.

## 1.3.6 - Log Catcher: device-wide capture, live stream, search, export
- Device-wide capture (root, opt-in): system logcat for every process and the kernel log (dmesg), filtered by priority, only while a session logs. Lines are tagged `device/<tag>` and `kernel`; new Source filter. Changing it is root-gated and audited.
- Live stream: `GET /api/logs/stream` (server-sent events, max 3 at once, 20 min each) pushes entries as they happen; the page falls back to polling if the stream cannot start.
- Search across every saved session (`GET /api/logs/search`): keyword or regex (time-boxed), level, and from/to time range.
- Regex and time-range filters in the live/history view; Group repeats (counts, last time); Prev/Next error; bookmarks (tap a line, kept in the browser); alerts on ERROR or a keyword (toast + tab title count).
- Export: all sessions as one .zip, and a Problem report .zip (device info, recent buffer, sessions, kernel log when root allows). Current-view export now respects the active filters.
- Native Log Catcher screen: Pause/Resume, Share (text), Delete session.

## 1.3.6 - Log Catcher: stop replaying and flooding
- Process logcat capture no longer replays the app's earlier history when a session starts (those old lines were all stamped with the start time).
- Flood control: an identical line (digits ignored) is logged 3 times per 2 s, then hidden with a single "repeated N more times" summary. Applies to app and device capture.
- Tags that contain a colon (for example `binder:7584_2`) are parsed correctly and shortened to `binder`, so the function list stays short and the message is complete.

# MatchiTOOL 1.4.2 - Plugin stop follow-ups, Bypass cleanup removed

This release closes the three gaps listed for 1.4.2 in the 1.4.1 plugin stop work (Turn off wording, `/api/plugins/data` and the root gate, stop commands in the store dialog). Kotlin changes are compiled and unit-tested in CI. What was run on the F50 is in the "Device status" bullet at the end of this entry.

- **Changed, Turn off dialog:** when the plugin's own stop commands are listed, the dialog no longer says "Its file and its data stay". It says "The plugin file stays. Its saved data stays unless the stop commands listed below remove it." Without listed commands the old sentence stays, because nothing then deletes data.
- **Changed, `/api/plugins/data` and the root gate:** the route stays open, but its two root calls (the existence probe and the process scan that lists PIDs and command lines) run only when the root gate would let the request through. Otherwise the answer says "cannot be checked" (no `exists`, no process list) and still carries the stop plan, the undo list, the uploads and the effects, so the Delete dialog does not silently fall back to a plain delete. The route table in `scripts/test_route_gates.py` now says PARTIAL and checks that both root calls stay behind the gate.
- **Changed, store install dialog:** for a single `.js` plugin the confirm now lists the `@matchi-uninstall` commands that would run as root (each cut at 120 characters, at most 10), the `@matchi-check` command and the `@matchi-boot` paths, before the install. The page reads them with the same rules as the host (tests run the same cases on both sides). A plugin without these lines shows nothing extra; a UFI-TOOLS bundle is unchanged.

- **Removed:** the one-time boot cleanup that took lines naming "bypass" out of `boot.sh` (added in 1.4.1 for devices that still had the old built-in Bypass tool's boot lines). No app code names a plugin any more. A device that went from before 1.4.1 straight to 1.4.2 and still has Bypass lines in `boot.sh` must delete them by hand (see `README.md` and `docs/PLUGIN_STOP.md`). `scripts/check_repo.py` no longer guards the removed code.

- **Fixed, found on the F50 (15 Nov 2026, after the Network tools):** Full diagnose no longer reports a wrong CPU build for a good arm64 `sendat` (it now reads the ELF header with `head -c`, and prints header bytes, size, hash and an `AT` test with exit code); **Restart modem** refuses to switch the radio off when no slot answers a plain `AT`; the VoLTE / VoNR toast says whether the modem refused or stayed silent; **Advanced Network Diagnostics** lists all addresses, reads default routes from every routing table, tests DNS with ping and no longer shows ping usage text for IPv6. **Cause found (15 Nov 2026):** the installed `sendat` was a zero-filled file of the right size (a copy lost at a reboot; /data is mounted `fsync_mode=nobarrier`), so it "ran" with exit 0 and printed nothing. The earlier "ELF machine 0x00" report was real, not a false reading. The host now compares `sendat`, `curl`, `jq`, `sha256` and `zreq` with the bundled copies at every start and copies a damaged one again, and forces each copy to disk (`fd.sync()`) before the rename. Full diagnose reports an all-zero `sendat` as damaged. Kotlin changed (`WebServer.kt`), not compiled here. Docs added: `docs/NETWORK_FORMATS.md`, `docs/F50_CHECKLIST_NETWORK.md`.

- **Fixed, found on the F50 (15 Nov 2026):** ticking a band chip no longer re-draws the whole Radio settings card (the Network mode drop-down flashed on every click; the chips and the two buttons now update in place). **USB:** RNDIS / CDC-ECM only changed the running `sys.usb.config`, so a reboot went back to the saved mode (ECM). New tick box **Keep RNDIS / CDC-ECM after a reboot** also writes `persist.sys.usb.config` (the old value is kept in `/data/local/matchitool/usb_persist_orig`; **Restore default USB mode** puts it back). Kotlin changed (`WebRoutesDevice.kt`), not compiled here, not run on a device.

- **Device status (F50, 14 Nov 2026, 1.4.2 build, run by the owner):** the Turn off dialog wording; the store install dialog (a plugin with header lines lists its stop commands, the check and the boot files before the install, one without them shows nothing extra); a reboot after the Bypass cleanup was removed (the `boot.d` script ran again, `events.log` has no cleanup line, the hotspot stayed usable); Delete and stop of a plugin with header lines (its process was found by its pid file and ended, its boot script removed, the plugin deleted); and, for the first time, the sandbox stop hook (a working hook ended its job and the plugin was deleted; a hook that never finished kept the plugin after 15 s). One oddity: after the first Delete and stop on the working-hook plugin the dialog opened a second time before the delete went through; the cause is not known and nothing went wrong. **Not run on a device:** the data route with a sign-in older than 4 h (the stale-session case); it is covered by unit tests and the route-gate table only.

# MatchiTOOL 1.4.1 - Radio dashboard, security hardening, code structure, web UI, docs

What changed, one entry per version. The full change-by-change history (with test notes) is in [`docs/CHANGELOG_DETAIL.md`](docs/CHANGELOG_DETAIL.md). Items marked "not checked on the F50" or "not run on a device" were not run on a real device. "Compiled and unit-tested in CI" means the GitHub Actions run (Validate, Unit tests, Build debug and release) passed; it says nothing about a device.

- **Radio:** Radio settings and Cell lock cards on the dashboard (band chips, lock by hand, auto-unlock after 60 s). "Lock this cell" falls back to the Android telephony cell when the router returns none. Radio on/off is shown as UNKNOWN instead of guessed. A red warning shows when a band lock is active and there is no service. 4G / 5G boxes say whether PCI came from the router or Android. Performance mode is a button next to Change IP. AT & Radio keeps only the AT tools.
- **Live Status:** router and root reads run as two loops, heat-aware polling, polling guard with back-off, CPU % by the UFI-TOOLS method, 5G / 4G detail filled from Android telephony.
- **Security:** root over plain HTTP is refused until switched on (**Plugins > Root over HTTP...**); console password hash is 310,000 PBKDF2 iterations (old hashes upgrade at the next sign-in); the hotspot firewall rule is removed when the host stops; the bundled `sha256` is a script around `sha256sum`; `docs/BINARIES.md` lists where each bundled binary came from.
- **Plugins:** UFI-TOOLS plugin API (shell, `/api/AT`, router proxy), plugin store, compatibility report and header lines, complete erase on delete, traced writes.
- **Plugin stop and undo (Phases 1-3):** "Delete plugin" and "Turn off" can now stop what a plugin started and undo what it left in the system, all as root, inside one 60 second total. (1) A plugin can say how with header lines `// @matchi-uninstall`, `// @matchi-check` and `// @matchi-boot`; if the stop fails the plugin is **kept**. (2) For a plugin with no headers, a process sweep finds what it started (by a tag MatchiTOOL adds to its shell commands, by a pid file, or by its command line), lists it in the Delete dialog and ends it only after you choose **Delete and stop**. (3) The firewall chains and `boot.d` scripts the host **saw the plugin create** are removed and then checked again by a separate read-only script. (4) **Turn off and stop** does the same without deleting the plugin or its data. It asks **no password** (a decision: the root gate and the approved-file rule still apply). What you saw in the dialog is what runs (plan, sweep and undo hashes; `409 plan-changed` otherwise). A sandboxed plugin can add its own stop code with `matchi.onUninstall` (Delete and stop only). **Not undone:** lines in `boot.sh`, eBPF pins, routes, properties, mounts, helper-script output and services started through Android; this protects against a forgetful plugin, not a hostile one. **Device status:** header stop and process sweep were run on the F50 (Phases 1 and 2). The undo and Turn off and stop are compiled and unit-tested in CI and were also run on the F50 by the owner (Phase 3 tests A-E; the owner's report, per-test results are not written in the repo); the no-root / timeout path (test F) was waived and not run. See `docs/PLUGIN_STOP.md` and `SECURITY.md`.
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
- Not checked on the F50: AT & Radio window rewrite, Performance mode button, review items 22-25, dialogs and language switch (see `docs/F50_CHECKLIST_1.4.1.md`). The Kotlin of the WebServer split compiles in CI.

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

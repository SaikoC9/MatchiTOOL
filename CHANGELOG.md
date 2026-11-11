# MatchiTOOL 1.4.1 - Radio dashboard, security hardening, code structure, web UI, docs

What changed, one entry per version. The full change-by-change history (with test notes) is in [`docs/CHANGELOG_DETAIL.md`](docs/CHANGELOG_DETAIL.md). Items marked "not checked on the F50" were not run on a real device.

- **Radio:** Radio settings and Cell lock cards on the dashboard (band chips, lock by hand, auto-unlock after 60 s). "Lock this cell" falls back to the Android telephony cell when the router returns none. Radio on/off is shown as UNKNOWN instead of guessed. A red warning shows when a band lock is active and there is no service. 4G / 5G boxes say whether PCI came from the router or Android. Performance mode is a button next to Change IP. AT & Radio keeps only the AT tools.
- **Live Status:** router and root reads run as two loops, heat-aware polling, polling guard with back-off, CPU % by the UFI-TOOLS method, 5G / 4G detail filled from Android telephony.
- **Security:** root over plain HTTP is refused until switched on (**Plugins > Root over HTTP...**); console password hash is 310,000 PBKDF2 iterations (old hashes upgrade at the next sign-in); the hotspot firewall rule is removed when the host stops; the bundled `sha256` is a script around `sha256sum`; `docs/BINARIES.md` lists where each bundled binary came from.
- **Plugins:** UFI-TOOLS plugin API (shell, `/api/AT`, router proxy), plugin store, compatibility report and header lines, complete erase on delete, traced writes.
- **Plugin integrity (unreleased, not compiled or run on a device):** the host remembers each plugin's SHA-256 and abilities (root commands, network use, hosts, token) as approved. The list flags a plugin whose file differs ("changed since approved") or was installed before tracking ("not tracked"), with an **Approve** button. Replacing, deleting or approving a plugin asks for the sign-in password again; an update that adds an ability asks again. The store confirm names the token and network use. This is tamper evidence, not protection from a running plugin. See `SECURITY.md`.
- **Network filter defaults (unreleased):** the browser allow-list no longer includes `dns.google`, `checkip.amazonaws.com`, `api.ipify.org` or `www.cloudflare.com` (a DNS-over-HTTPS resolver is a data-leak route; the public-IP check runs as a root shell script and never used the list). GitHub stays for the plugin store. A plugin of your own that needs one of the removed hosts must be added under Plugins > Network rules. `SECURITY.md` now says the filter limits the browser only, not the root shell.
- **Bypass removed:** at boot, lines naming "bypass" are taken out of `boot.sh` once (copy kept as `boot.sh.pre-bypass-removal`). Other firewall / TTL lines are not touched.
- **Log basket / Log Catcher:** one list of every log, search, filter chips, live view, snapshot ready for an update, plugin-aware logging.
- **Code and build:** `WebServer.kt` split into `WebRoutes*.kt`; one version source (`version.properties`); route-gate table test; release builds shrink with R8 (shrink only); `validate.sh` slimmed (old grep checks live in `check_sources.py`).
- **Web UI:** more of the page in `web-src/`; accessibility pass (dialogs, focus, keyboard); safe-HTML helper and innerHTML check; English / Filipino language switch for fixed labels.
- **Found on the F50 (11 Nov 2026) and fixed:** reloading after Sign out answered "BAD REQUEST ... HTTP verb {}GET unhandled" (the unread `{}` body of `/api/logout` was read as the next request; the log start / stop routes now drop their body too); the sign-in card shrank after Sign out; the dashboard (Live device status, Radio settings, Cell lock, tool buttons) now follows the Filipino switch, dynamic messages and tool windows still stay English; `Quad` made `internal` (compile error from the WebServer split).
- **Docs:** README trimmed; stale notes merged into `SECURITY.md` and `docs/TESTING.md`; this changelog shortened.
- Not checked on the F50: AT & Radio window rewrite, Performance mode button, review items 22-25, dialogs and language switch (see `docs/F50_CHECKLIST_1.4.1.md`). Kotlin not compiled for the WebServer split.

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

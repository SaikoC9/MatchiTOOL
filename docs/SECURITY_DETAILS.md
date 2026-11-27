# Security details

Full notes. Short version: [`SECURITY.md`](../SECURITY.md). For 1.4.6. History: [`CHANGELOG.md`](../CHANGELOG.md).

## What MatchiTOOL is

A root **client**, not an exploit. It calls the installed `su` (`su -c sh`) and needs Magisk, KernelSU, APatch or similar to grant access. It does not unlock the bootloader, patch boot images, flash partitions or install a root manager, and never tries to get around a denied request. UID 0 is the real check.

## Threat model

The console (port **2334**) is for a trusted ZTE hotspot / USB-tether network and apps on the phone.

- Anyone signed in can run root commands (`/api/shell`) and install plugins. Treat the console password, session token and every plugin as privileged.
- The Live push stream (`/api/live/stream`) keeps one fixed read-only root script running while a browser watches (CPU counters, speed, thermal zones, memory, load, uptime). Same gate as `/api/shell`; constant script text; one bounded line per second; ends when the app goes away, after 3600 rounds, or when the last viewer leaves; sign-out or expiry stops it within 5 s.
- Anyone on the hotspot can reach the **login page**. Only a signed-in session reaches the rest.
- **Never port-forward 2334.** For remote access use a trusted VPN or tunnel.
- If the console may have been exposed, change the console password (ends every session).

## Network access

- The host listens on all LAN interfaces; no local-only mode.
- Every API request must come from this device or a detected hotspot subnet (`HostControl.isHotspotClient`; unknown networks refused), pass a Host check and a same-origin check (cross-origin `Origin` rejected).
- Defensive browser headers; API responses not cacheable.
- Port 2334 is opened on hotspot interfaces with an `iptables` ACCEPT rule, removed on clean stop (waits max 3 s). If killed, the rule stays until the next start reuses it. Uplink interfaces are never opened.

## Transport

- HTTPS first, self-signed (one browser warning). Key in Android Keystore; software key as fallback for the F50's handshake bug.
- If TLS fails: **plain HTTP**, nothing encrypted. Red banner on the page, "(NOT encrypted)" in the app.
- Then root calls from other devices are refused (403, `insecure-off`) until **Plugins > Root over HTTP...** is switched on (sign-in under 4 h plus console password, same lockout; works over HTTP so a TLS failure cannot lock you out). The page still confirms root actions. Loopback and HTTPS are unaffected.

## Sign-in, sessions, passwords

- **Console password:** default is the router admin password. **Password** sets a separate one (10+ chars); wrong guesses then never reach the router. PBKDF2-HMAC-SHA256, salt, 310,000 iterations, constant-time compare. Older hashes upgrade at next good sign-in. If sign-in is slow on the F50, lower `CONSOLE_PW_ITER` in `Prefs.kt`.
- **Lockout:** per-IP doubling delays, global back-off, budget on forwarding guesses to the router. Loopback is never locked (any app arrives as 127.0.0.1); each wrong loopback password is answered after 2 s.
- **Sessions:** random 256-bit token, only its SHA-256 stored. Ends after 2 h idle (only real clicks, keys, touches count, not polls), 12 h total, **Sign out**, or password change (all sessions).
- **Cookie:** the page never gets the token. Sign-in sets an HttpOnly, `SameSite=Strict` cookie (`Path=/api`, `Secure` over HTTPS); the reply carries no token (`SessionCookie.kt`). A request needs the cookie **and** the `x-token` marker header (value ignored; the page sends `cookie`). A header token alone is rejected. Another origin cannot add that header without a CORS preflight, which the host never answers. This matters because `SameSite` is per site, not per port.
  - A plugin's `fetch()` carries the cookie, so a plugin can still call every route the page can. The cookie stops token copying, not use of the open session.
  - Cookies are not scoped by port: another web server on the device's IP receives the `/api` cookie.
  - Sessions are shared by all tabs; signing out in one signs out all.
- **Root gate:** every root route needs a sign-in under 4 h plus the HTTP rules. Logic: `RootGate.decide()`. `scripts/test_route_gates.py` checks every route. `/api/plugins/delete` is gated only when it erases data or runs a stop; `/api/plugins/toggle` (plain Turn off) is open; `/api/plugins/data` is open except its two root calls.
- **Router password:** encrypted with an Android Keystore AES-GCM key where available; old plain values migrate on first read.

## AdGuard Home web page door

AdGuard Home (port 3000) has its own login and a long-lived cookie that a console sign-out cannot end. While "Web UI on LAN" is on, port 3000 is dropped for every non-loopback client by chain `AGH_UI` (jumped from INPUT, IPv4 and IPv6). `POST /api/agh/door` (root gate) adds an ACCEPT for the caller's address; `AghDoor.kt` closes it on session end (sign-out, idle, 12 h, password change), after 30 min, and at host start. The plugin's watchdog and boot script restore the chain after a netd restart or reboot.

Limits: per IP address, so a device that spoofs it gets in until the door closes; the AdGuard login is still required. Not run on a device yet.

## Plugin web pages (web gate)

A plugin with its own local page declares it with `// @matchi-gate`; MatchiTOOL puts a gate in front so the page's cookie never reaches the browser. Author guide: [`PLUGIN_GATE.md`](PLUGIN_GATE.md).

- **Opening:** `POST /api/gate/open` is root-gated. The host reads the declaration from the installed, enabled plugin file, never the request, and refuses if the file differs from the approved one or two enabled plugins share a name. It returns a one-time ticket (60 s, for the asking device's address) and the gate port.
- **Ports:** nothing listens until first Open. Gate ports come from 3100-3199. The plugin port must be 1024-65535, not 2334 or a gate port. Max 4 gates; a gate nobody is logged in to is stopped to make room.
- **Cookies:** only a session-only `matchi_gate_PORT` cookie (one name per gate; browsers share cookies across ports). The page's own cookie stays on the device.
- **Page login ends:** console sign-out, session expiry, password change, host start, idle time (`idle`, default 1 h), and, if `tabclose` is on, closing the tab's last page. Deleting or switching off the plugin stops its gate.
- **Limits:** plain HTTP even if the console is HTTPS. The page's brute-force limit becomes global (all requests from `127.0.0.1`). WebSockets and `Upgrade`: `501`. Bodies over 2 MB: `413`. Responses capped at 24 MB. Sandboxed plugins cannot use it. `/api/agh/gate` stays one more release with the built-in AdGuard declaration. Android side not run on a device yet.

## Root shell

- Commands go to `sh` over a separate file descriptor, not a `su -c` string; stdin is `/dev/null`.
- Each command has a timeout, bounded output (memory and 1 MiB file cap with truncation notice) and bounded concurrency (3 shells; jobs over 30 s use at most 2). Over capacity: "capacity reached".
- Temp files live in root-only `/data/local/matchitool/tmp`.
- **`shellDanger` is not a security boundary.** It catches accidents and can be bypassed (encoding, quoting, variables). Real protection: sign-in and root gate.
- Boot scripts run only from root-owned, non-symlink `/data/local/matchitool`, `boot.sh`, `boot.d`, `boot.d/*.sh`; group/other write on a root-owned entry is removed first. The host never edits `boot.sh`. Check it by hand if you used the old Bypass tool.

## Plugins

- **Plugins are trusted code.** They run JS in the console page with your session. A malicious one can run root commands and call any route the page can (not read the HttpOnly token). Review before enabling; import only trusted sources.
- **Integrity (tamper evidence).** On install or approve, the host stores the SHA-256 and abilities (root commands, network use, named hosts, token mentions; `PluginIntegrity.kt`, `Prefs.pluginRecords`). The list shows "changed since approved" or "not tracked" (installed before this existed). **Approve** records the file as is. Install (even under a new name), replace, delete and approve need your password with the login lockout, so a running plugin cannot install another or skip risky-code prompts. Exception: installing bytes already approved. Importing several asks once per plugin; an update adding an ability asks again.
  - Limits: root can edit the stored record; a plugin wrapping `window.fetch` can read the password while you type it; the ability list is a text search that run-time strings bypass. It catches unapproved edits, not an already-running plugin.
- **Sandbox (opt-in per plugin).** See [`PLUGIN_SANDBOX.md`](PLUGIN_SANDBOX.md). Isolated frame, own CSP, bridge granting only `@matchi-needs` permissions you approved; host re-checks on every `POST /api/plugins/call`.
  - Limits: host cannot tell which page code relays a call, so a trusted plugin could use a sandboxed one's list. Trusted plugins are not permission-limited. Approved root commands run as root; approved hosts can receive data. Plugins needing the page do not work sandboxed. Restores come back trusted. Chromium only.
- **Network filter (strict, default on).** The page's Content-Security-Policy: browser may contact only this console and the allow-list (GitHub for the store by default; add hosts under **Plugins > Network rules**, password needed). It does **not** limit the root shell (bundled `curl` can upload anywhere) or page navigation. Every listed host is a place data can go. The public-IP check runs on the device via root shell, so it needs no entry.
- **Server limits:** 50 plugins, 1 MB each, 5 MB total, built-in file names reserved.
- **Delete.** Needs the password. Erasing data also needs the root gate and touches only strictly checked paths ([`PLUGINS.md`](PLUGINS.md)); uploads and the ledger go with it. A plain delete (no erase, no stop) needs no root.
- **Delete and stop, Turn off and stop.** Run **as root**. Order: declared `@matchi-uninstall`, process sweep, undo of chains and `boot.d` scripts, read-only re-check, plugin `@matchi-check`, then delete (or switch). Each step is shown first. The page sends hashes (`planHash`, `sweepHash`, `undoHash`); the host rebuilds the plan and answers `409 plan-changed` on mismatch. No hash key (older page, **Delete without stopping**) = no sweep or undo. Any failure keeps the plugin and returns a report; nothing counts as gone unless the re-check found it gone.
  - Declared commands pass the same `shellDanger` filter; a sandboxed plugin needs each granted via `@matchi-needs shell:`; a changed file stops nothing.
  - The undo script is built from validated names only; no plugin, rule or process text is run. It removes only what the host **saw the plugin create** (a chain made with `-N`, a `NN-name.sh` in `boot.d`). Android chains refused, system chains never flushed, `boot.d` files removed only if root-owned regular, no symlink in the path, no other plugin naming it. Items another plugin uses are kept. Audit lines in `shell_audit.log`: `plugin-uninstall`, `plugin-sweep`, `plugin-undo`, `plugin-hook`, `plugin-disable`.
  - **Turn off and stop asks no password** (decided 2026-11-13), like a plain Turn off. Risk: a page holding the open session can run a plugin's approved stop commands as root without the password. Refused if the file differs from the approved one; root gate still applies. The host never erases the file, data or ledger on Turn off, and does not run a sandbox hook. Plain Turn off (`/api/plugins/toggle`) is an open route.
  - **Limits:** not a security boundary. A hostile plugin can lie about its name and run root anyway. The host sees only command text, so helper-script, variable or program-made items are not undone (`boot.sh` lines, eBPF pins, routes, properties, mounts, Android services). Declare them with `@matchi-uninstall`. Full list: [`PLUGIN_STOP.md`](PLUGIN_STOP.md).
- **`/api/plugins/data` is open, but its two root calls are root-gated (1.4.2).** After the name check it runs two fixed read-only root scripts: an existence probe of paths passing `checkPluginDataPath`, and the sweep's process scan (PIDs and command lines). Both run only when the root gate allows. Otherwise they are skipped and the answer says "cannot be checked": no `exists` flags, `sweep.rootOk` false, no process list.
  - The route is not refused whole on purpose: the page treats an error as "nothing to show" and would fall back to a plain delete without the stop plan.
  - The stop plan, undo list, uploads and effects come from the file and ledger, not root; any signed-in session can read them.
- `/api/zte` talks only to the saved router address (local IPv4); a set call needs a fresh sign-in unless its goformId is in `NetGoform.OPEN_SET`. The old `/api/goform/*`, `/api/proxy/*`, `/api/get_cookie`, `/api/set_cookie` routes are removed.

## Updates

The updater (upload or https link, max 120 MB, redirects stay https) accepts an APK only if it is this package, signed with the same key, checks the signature (with fallback lookup), and shows the SHA-256 before the root `pm install` (`-d` for downgrade). The permanent key is in CI secrets; a build without it uses the debug key and cannot update an install signed with the permanent key.

## Bundled binaries

`sendat`, `curl`, `jq`, `zreq` (arm64) run as root; `sha256` is a script around `sha256sum`. Hashes are pinned in `NOTICE.md` and checked by `scripts/check_repo.py`. At run time the app compares each file with the hash it was built with (`BinaryHashes.kt`); a differing file is not run and is deleted, then re-copied from the APK at next start. This catches damaged or replaced files, not someone who already has root. Origins and unknowns: [`BINARIES.md`](BINARIES.md).

## Uninstall wipe

- A root watcher and boot script run outside the app while the switch is ON. OFF removes both.
- It deletes only fixed paths, our chains and our tc setup. Plugin paths come from a root-owned mode-600 snapshot and pass a strict path check; a snapshot that is not root-owned, is group/other writable or is a symlink is skipped.
- Plugin stop commands run only if their sha256 is in the root-owned manifest written when the app approved them.
- No network use; never talks to the router.
- Details: [`UNINSTALL_WIPE.md`](UNINSTALL_WIPE.md).

## Other notes

- **IMEI rewrite:** `AT+SPIMEI`, re-applied at boot. Restricted or illegal in some countries. Use only on your own device, where allowed.
- **Logs** may contain device and network data. Exports can hide private data (SMS text, numbers, IMEI / ICCID, passwords, tokens). Keep exports private.
- **Not done:** allowlist or "pause console" switch for hotspot clients; host-enforced permissions for trusted plugins; visibility into what a plugin did outside command text.

## Report a problem

Open an issue with no secrets (no passwords, tokens, IMEI, full logs). For a sensitive report, contact the maintainer privately first.

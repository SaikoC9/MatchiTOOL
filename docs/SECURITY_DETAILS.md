# Security details

The full security notes. The short version is [`SECURITY.md`](../SECURITY.md).

Current for MatchiTOOL 1.4.6. This file replaces the older per-version security notes that were in the README and in `docs/ROOT_INTEGRATION_1.1.52.md`. History of changes: [`CHANGELOG.md`](../CHANGELOG.md).

## What MatchiTOOL is, and is not

MatchiTOOL is a root **client**, not a rooting exploit. It calls the device's installed `su` (`su -c sh`) and needs a root manager (Magisk, KernelSU, APatch or another) to grant it access. It does not unlock the bootloader, patch boot images, flash partitions, or install a root manager. It never tries to get around a denied root request. Root status shows the effective UID, the resolved `su` path and a best-effort manager hint; UID 0 is the real check.

## Threat model

The console (port **2334**) is meant for a trusted ZTE hotspot / USB-tether network and for apps on the phone itself.

- Anyone who is signed in can run root commands (`/api/shell`) and install plugins. Treat the console password, the session token and every installed plugin as privileged.
- The Live panel's push stream (`/api/live/stream`) keeps one fixed, read-only root script running while at least one browser is watching (CPU counters, CPU speed, thermal zones, memory, load, uptime). It has the same gate as `/api/shell`, the script text is constant (no input from the page), its output is one bounded line a second, it ends when the app goes away, after 3600 rounds, or when the last viewer leaves, and a sign-out or an expired sign-in stops it within 5 s.
- Anyone on the hotspot can reach the **login page**. Only a signed-in session reaches the rest.
- Never port-forward 2334 to the internet. For remote access use a trusted VPN or encrypted tunnel.
- If the console may have been exposed to an untrusted network, change the console password. That ends every session.

## Network access

- The host listens on all LAN interfaces; there is no local-only mode.
- Every API request must come from this device or from a detected hotspot-side subnet (`HostControl.isHotspotClient`; unknown networks are refused), pass a Host-header check, and pass a same-origin check (cross-origin requests with an `Origin` header are rejected).
- Responses carry defensive browser headers; API responses are not cacheable.
- The app opens port 2334 on the hotspot interfaces with an `iptables` ACCEPT rule and removes it when the host service stops cleanly (waits at most 3 s). If the process is killed, the rule stays until the next start reuses it. Uplink (default-route) interfaces are never opened.

## Transport (HTTPS and the HTTP fallback)

- The console serves HTTPS first, with a self-signed certificate (the browser warns once). The key is in the Android Keystore; a software key is the fallback for the F50's handshake bug.
- If TLS cannot start, the console runs over **plain HTTP**: passwords, tokens and root traffic are not encrypted. The page shows a red banner and the app shows "(NOT encrypted)".
- In that state, root-capable calls from another device are refused (403, code `insecure-off`) until the owner switches on **Plugins > Root over HTTP...**. The switch needs a sign-in younger than 4 h and the console password again (same lockout as login), and it works over HTTP so a TLS failure cannot lock you out of it. With it on, the page still asks for a confirm before root actions. Loopback (apps on the phone) and HTTPS are unaffected.

## Sign-in, sessions and passwords

- **Console password:** by default the console signs in with the router's admin password. Use the *Password* button to set a separate console password (10+ characters); wrong guesses are then never forwarded to the router. It is stored as PBKDF2-HMAC-SHA256 with a salt, 310,000 iterations, compared in constant time. Hashes with fewer iterations are upgraded silently at the next good sign-in. If sign-in feels slow on the F50, lower `CONSOLE_PW_ITER` in `Prefs.kt`.
- **Lockout:** per-IP lockout with doubling delays, a global back-off, and a budget on forwarding guesses to the router. Loopback is never locked (any app on the device arrives as 127.0.0.1); each wrong loopback password is answered after 2 s instead.
- **Sessions:** each sign-in gets a random 256-bit token; only its SHA-256 is stored. A session ends after 2 h idle (only real clicks, key presses and touches in the page restart that timer, not background polls), after 12 h in any case, on **Sign out**, or when the password changes (all sessions end).
- **Session cookie:** the page never gets the token. Sign-in sets it in an HttpOnly, `SameSite=Strict` cookie (`Path=/api`, `Secure` over HTTPS) and the reply carries no token, so page script and plugins can't read or copy it (`SessionCookie.kt`). A request is accepted only with the cookie **and** the page's marker header `x-token`. Its value is ignored; the page sends the word `cookie`. A token in the header alone is not accepted. A page from another origin can't add that header without a CORS preflight, and the host never answers one. This matters because `SameSite` is per site, not per port: a page served from another port on the same IP is same-site and does get the cookie.
  - Limits: a plugin's `fetch()` carries the cookie like the page's own, so a plugin can still call every route the page can. The cookie stops the token being copied. It doesn't stop a plugin from using the open session.
  - Cookies aren't scoped by port either, so another web server on the device's IP receives the cookie for `/api` paths.
  - Sessions are shared by all tabs of the browser, and signing out in one signs out all.
- **Root gate:** every root-capable route needs a sign-in younger than 4 h, plus the HTTP rules above. The gate logic is `RootGate.decide()`, and `scripts/test_route_gates.py` checks every route against a table of which ones are gated. `/api/plugins/delete` is gated only when it erases data or runs a stop (see "Plugins"); `/api/plugins/toggle` (a plain Turn off) is open, and `/api/plugins/data` is open except for its two root calls (see "Plugins").
- **Router password:** stored encrypted with an Android Keystore AES-GCM key where available; older plain values are migrated when first read.

## AdGuard Home web page door

The AdGuard Home page (port 3000) has its own login and a long-lived cookie, which a console sign-out cannot end. While the plugin's "Web UI on LAN" is on, port 3000 is dropped for every non-loopback client by the iptables chain `AGH_UI` (jumped to from INPUT, IPv4 and IPv6). `POST /api/agh/door` (root gate) adds an ACCEPT for the caller's own address; `AghDoor.kt` closes it when that session ends (sign-out, idle, 12 h, password change), after 30 minutes, and when the host starts. The plugin's watchdog and boot script put the chain back after a netd restart or a reboot. Limits: the door is per IP address, so another device that takes the same address (spoofing) gets in until it closes, and the AdGuard login is still needed behind it. Not run on a device yet.

## Plugin web pages (the web gate)

A plugin that runs its own local web page (AdGuard Home is the example) can declare it with one `// @matchi-gate` header line. MatchiTOOL then puts a gate in front of the page, so the page's own long-lived login cookie never reaches the browser. The author guide is [`docs/PLUGIN_GATE.md`](PLUGIN_GATE.md).

- **Opening a gate.** `POST /api/gate/open` is behind the root gate. The host reads the declaration from the installed, enabled plugin file, never from the request, and refuses when that file differs from the approved one or when two enabled plugins declare the same name. It answers with a one-time ticket (valid for 60 seconds, for the address of the device that asked) and the gate port.
- **Ports.** Nothing listens until the first Open. The gate then listens on a port MatchiTOOL picks from 3100-3199. The plugin's own port must be 1024-65535, and it can't be the console port or one of the gate ports. At most 4 gates are open at once, and a gate nobody is logged in to is stopped to make room.
- **Cookies.** The browser gets only a session-only cookie, named `matchi_gate_PORT` (each gate has its own name, because browsers share cookies between ports). The page's own cookie stays on the device.
- **When the page's login ends.** On console sign-out, session expiry, a password change and a host start. Also after the idle time (`idle`, 1 h by default) and, if the plugin turns `tabclose` on, when the last page of the tab closes. Deleting a plugin or switching it off stops its gate.
- **Limits.** The gate speaks plain HTTP even when the console uses HTTPS, so the page's password travels unencrypted on the hotspot. Every request reaches the page from `127.0.0.1`, so the page's own brute-force limit becomes global: one burst of wrong passwords locks everyone out of it. WebSockets and other `Upgrade` requests get `501`, request bodies over 2 MB get `413`, and responses are capped at 24 MB. Sandboxed plugins can't use it. `/api/agh/gate` stays for one release with the built-in AdGuard Home declaration. The Android side of the gate has not been run on a device yet.

## Root shell

- Commands go to `sh` over a separate file descriptor, not into a `su -c` string; stdin is `/dev/null`, so a script that reads stdin cannot eat the rest of the command.
- Each command has a timeout, bounded output (in memory and a 1 MiB file cap, with a truncation notice) and bounded concurrency (up to 3 shells; jobs over 30 s use at most 2, so short status reads still get through). Over capacity, the caller gets a "capacity reached" reply.
- The temp files live in the root-only `/data/local/matchitool/tmp`.
- **The command filter (`shellDanger`) is not a security boundary.** It catches accidents. It can be bypassed (encoding, quoting, variables). The real protection is the sign-in and the root gate. The root terminal and the "Blocked" reply say so.
- Boot scripts run only from root-owned files: `/data/local/matchitool`, `boot.sh`, `boot.d` and `boot.d/*.sh` must be real files or folders (no symlinks) owned by root; group/other write permission on a root-owned entry is removed first. The host never edits `boot.sh` (1.4.1 had a one-time cleanup of lines naming "bypass"; it was removed in 1.4.2, see [`CHANGELOG.md`](../CHANGELOG.md)). Check `boot.sh` by hand if you used the old Bypass tool.

## Plugins

- **Plugins are trusted code.** They run JavaScript inside the console page, with the same origin and the signed-in session. A malicious plugin can run root commands and call any route the signed-in page can (it cannot read the session token, which is an HttpOnly cookie). Review a plugin before enabling it; import only sources you trust. Sandboxed plugins (below) are the opt-in way to run a plugin with less power.
- **Plugin integrity (tamper evidence).** When you install or approve a plugin, the host stores its SHA-256 and a list of its abilities: root commands, network use, hosts it names and token mentions (`PluginIntegrity.kt`, `Prefs.pluginRecords`). The plugin list shows "changed since approved" when the file differs, and "not tracked" for plugins installed before this existed. **Approve** records the file as it is. Installing (even under a new name), replacing, deleting or approving a plugin needs your sign-in password again, with the same lockout as login. So a running plugin can't install another plugin, or skip the risky-code and new-abilities prompts, without it. The one exception is installing the same bytes that are already approved. Importing several plugins asks once per plugin, and an update that adds an ability asks again.
  - What this doesn't do: root can edit the stored record, a plugin that wraps `window.fetch` can read the password while you type it, and the ability list is a text search that strings built at run time get past. It catches edits you didn't approve. It is not protection from a plugin that is already running.
- **Sandboxed plugins (opt-in per plugin; trusted stays the default).** A `.js` plugin switched to Sandbox (shield button, password asked) runs in an `<iframe sandbox="allow-scripts">` with an opaque origin. It has no page, no session, no `/api` and no storage of its own. It has its own Content-Security-Policy: no eval, frames, forms or workers, and connections only to approved https hosts. It reaches the console through a message bridge that grants only what the file declared with `@matchi-needs` lines (read-only AT, named router fields, exact root commands, hosts) and you approved. A file that differs from the approved one gets nothing. The page relays device calls to `POST /api/plugins/call`, where the host checks the stored approval on every call, so a changed file or a bug in the page's check can't grant more. Details: [`PLUGIN_SANDBOX.md`](PLUGIN_SANDBOX.md).
  - Limits: the host can't tell which page code relays a call, so a trusted plugin could name a sandboxed one and use its narrow list. Permissions aren't enforced for trusted plugins. An approved root command runs as root, and an approved host can receive data. Plugins that need the page don't work sandboxed. Restored backups come back trusted. Behaviour was seen in Chromium only.
- **Network filter (strict mode, on by default).** It is the page's Content-Security-Policy, so it limits what the browser page can contact: only this console and the allow-list (GitHub for the plugin store by default; you add hosts under **Plugins > Network rules**, which asks for the password). It does **not** limit what a plugin runs through the root shell (the bundled `curl` can upload anywhere), and a CSP does not cover page navigation. Every host on the list is a place a plugin can send data. The page's own public-IP check runs on the device through the root shell, not in the browser, so it needs no entry.
- Server-side limits: 50 plugins, 1 MB each, 5 MB total, built-in file names reserved.
- **Delete.** Every delete needs the sign-in password. Erasing data needs the root gate too and only touches strictly checked paths (see [`PLUGINS.md`](PLUGINS.md)); with erase, the plugin's uploaded files and its ledger (`plugin_trace/NAME.trace`) go with it. A plain delete of the file, with no erase and no stop, needs no root.
- **Delete and stop, Turn off and stop (1.4.1).** These run **as root**. Order: the plugin's declared `@matchi-uninstall` commands, the process sweep, the undo of firewall chains and `boot.d` scripts, a read-only re-check, the plugin's own `@matchi-check`, then the delete (or, for Turn off, the switch). Each step is shown in the dialog first. The page sends hashes of what you saw (`planHash`, `sweepHash`, `undoHash`); the host rebuilds the plan before anything runs and answers `409 plan-changed` if it differs, so a process or item you did not see is never ended or removed. A request without a hash key (an older page, **Delete without stopping**) gets no sweep or undo. Any failure keeps the plugin and returns a report; nothing is counted as gone unless the re-check ran and found it gone.
  - **Declared commands** pass the same `shellDanger` filter as any plugin command (an accident filter, not a boundary); a sandboxed plugin must also have been granted each one with `@matchi-needs shell:`; a file that differs from the approved one stops nothing.
  - **The undo script is built by the host from validated names only.** No text from a plugin, a rule or a process is run or evaluated, and one bad name means nothing runs. It removes only what the host **saw the plugin's own commands create** (a firewall chain made with `-N`, a `NN-name.sh` file written into `boot.d`). Android's own chains are refused, a system chain is never flushed, and a `boot.d` file is removed only when it is a root-owned regular file with no symlink in the path and no other plugin names it. An item another installed plugin also uses is kept. Every action writes `shell_audit.log` lines (`plugin-uninstall`, `plugin-sweep`, `plugin-undo`, `plugin-hook`, `plugin-disable`).
  - **Turn off and stop asks no password.** This is deliberate (decided 2026-11-13), as it is for a plain Turn off. The risk: a page holding the open session can run a plugin's own, already approved stop commands as root without the password. It is refused when the plugin file differs from the approved one, and the root gate (sign-in under 4 h, HTTP rules) still applies. The host never erases the file, its data or its ledger on Turn off (the plugin's own stop commands are plugin code and may remove runtime folders, which the dialog says), and it does not run a sandboxed plugin's stop hook. A plain Turn off (`/api/plugins/toggle`) is an open route, as before.
  - **Limits.** This is not a security boundary: a plugin knows its own name only as the page or the host reports it, so a hostile plugin can lie, and it can run root commands anyway. The stop protects you from a **forgetful** plugin. The host sees only command text, so anything made inside a helper script, through a shell variable, or by a program the plugin runs is not undone: lines in `boot.sh`, eBPF pins, routes, properties, mounts, and services started through Android. Declare those with `@matchi-uninstall`. Full list: [`PLUGIN_STOP.md`](PLUGIN_STOP.md).
- **`/api/plugins/data` is open, but its two root calls are behind the root gate (1.4.2).** After it checks the name, the route runs two fixed, read-only root scripts: an existence probe of the paths that passed `checkPluginDataPath`, and the process scan for the sweep (matched process IDs and command lines). Both run only when the root gate would let the request through (sign-in under 4 h, HTTP rules). On any other request they are skipped and the answer says "cannot be checked": no `exists` flags, `sweep.rootOk` is false and there is no process list.
  - The route isn't refused as a whole on purpose. The page treats an error as "nothing to show" and would quietly fall back to a plain delete without the stop plan.
  - The stop plan (the commands the plugin declares), the undo list (firewall chains and boot scripts the ledger holds for it), the uploads and the effects come from the plugin file and the ledger, not from root. Any signed-in session can still read them.
- `/api/zte` only talks to the saved router address (a local IPv4 address), never another host; a set call needs a fresh sign-in unless its goformId is in `NetGoform.OPEN_SET`. The older `/api/goform/*`, `/api/proxy/*`, `/api/get_cookie` and `/api/set_cookie` routes are removed, so no route hands out the router session or forwards a free path.

## Updates

The updater (upload or an https link, max 120 MB, redirects stay on https) accepts an APK only if it is this package and signed with the same key, checks the signature (with a fallback lookup), and shows you the SHA-256 before the root `pm install` (`-d` for a downgrade). The permanent signing key is in CI secrets; a build made without it falls back to the debug key and cannot update an install signed with the permanent key.

## Bundled binaries

`sendat`, `curl`, `jq`, `zreq` (arm64) run as root; `sha256` is a script around the system `sha256sum`. Their hashes are pinned in `NOTICE.md` and checked by `scripts/check_repo.py`. At run time the app compares its copy of each file with the hash the build was made with (`BinaryHashes.kt`) and does not run, and deletes, a file that differs; the copy is made again from the APK at the next start. This catches a file that was damaged or replaced by another user or app. It does not protect against someone who already has root, who could also change the app. `docs/BINARIES.md` lists where each came from and what is unknown (`sendat` and `curl` have no recorded build recipe).

## Uninstall wipe

- A root watcher and a boot script run outside the app while the switch is ON. OFF removes both.
- It deletes only fixed paths, our chains and our tc setup. Plugin paths come from a root-owned snapshot (mode 600) and pass a strict path check. Not root-owned, group/other writable or a symlink: the snapshot is skipped.
- Plugin stop commands run only if their sha256 is in the root-owned manifest, written when the app approved them.
- It uses no network and never talks to the router.
- Details: [`UNINSTALL_WIPE.md`](UNINSTALL_WIPE.md).

## Other notes

- **IMEI rewrite:** writes the IMEI with `AT+SPIMEI` and re-applies it at boot. Changing an IMEI is restricted or illegal in some countries; use it only where allowed and only on your own device.
- **Logs** may contain device and network data. Exports and copies can hide private data (SMS text, phone numbers, IMEI / ICCID, passwords, tokens); keep exported files private.
- **Not done (open items):** an allowlist or "pause console" switch for hotspot clients; host-enforced permissions for trusted plugins (only opt-in sandboxed plugins are limited, see above); seeing what a plugin did outside the command text the host reads (helper scripts, services started through Android, kernel state); end-to-end tests of WebServer routes and the updater flow.

## Reporting a problem

Open an issue without secrets in it (no passwords, tokens, IMEI, or full logs). For a sensitive report, contact the maintainer privately first.

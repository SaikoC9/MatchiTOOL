# Security notes

Current for MatchiTOOL 1.4.1. This file replaces the older per-version security notes that were in the README and in `docs/ROOT_INTEGRATION_1.1.52.md`. History of changes: [`CHANGELOG.md`](CHANGELOG.md).

## What MatchiTOOL is, and is not

MatchiTOOL is a root **client**, not a rooting exploit. It calls the device's installed `su` (`su -c sh`) and needs a root manager (Magisk, KernelSU, APatch or another) to grant it access. It does not unlock the bootloader, patch boot images, flash partitions, or install a root manager. It never tries to get around a denied root request. Root status shows the effective UID, the resolved `su` path and a best-effort manager hint; UID 0 is the real check.

## Threat model

The console (port **2334**) is meant for a trusted ZTE hotspot / USB-tether network and for apps on the phone itself.

- Anyone who is signed in can run root commands (`/api/shell`) and install plugins. Treat the console password, the session token and every installed plugin as privileged.
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
- **Sessions:** each sign-in gets a random 256-bit token; only its SHA-256 is stored. A session ends after 2 h idle, after 12 h in any case, on **Sign out**, or when the password changes (all sessions end).
- **Root gate:** every root-capable route needs a sign-in younger than 4 h, plus the HTTP rules above. The gate logic is `RootGate.decide()`, and `scripts/test_route_gates.py` checks every route against a table of which ones are gated.
- **Router password:** stored encrypted with an Android Keystore AES-GCM key where available; older plain values are migrated when first read.

## Root shell

- Commands go to `sh` over a separate file descriptor, not into a `su -c` string; stdin is `/dev/null`, so a script that reads stdin cannot eat the rest of the command.
- Each command has a timeout, bounded output (in memory and a 1 MiB file cap, with a truncation notice) and bounded concurrency (up to 3 shells; jobs over 30 s use at most 2, so short status reads still get through). Over capacity, the caller gets a "capacity reached" reply.
- The temp files live in the root-only `/data/local/matchitool/tmp`.
- **The command filter (`shellDanger`) is not a security boundary.** It catches accidents. It can be bypassed (encoding, quoting, variables). The real protection is the sign-in and the root gate. The root terminal and the "Blocked" reply say so.
- Boot scripts run only from root-owned files: `/data/local/matchitool`, `boot.sh`, `boot.d` and `boot.d/*.sh` must be real files or folders (no symlinks) owned by root; group/other write permission on a root-owned entry is removed first. Before `boot.sh` runs, lines naming "bypass" are removed once (see CHANGELOG 1.4.1); other firewall or TTL lines are not touched. Check `boot.sh` by hand if you used the old Bypass tool.

## Plugins

- **Plugins are trusted code.** They run JavaScript inside the console page, with the same origin and the signed-in session. A malicious plugin can read the session token and run root commands. Review a plugin before enabling it; import only sources you trust. The plan for isolating plugins is in `MatchiTOOL_plugin_security_plan.txt` (phased; the sandboxed iframe is not done because it would break most UFI-TOOLS plugins).
- Server-side limits: 50 plugins, 1 MB each, 5 MB total, built-in file names reserved.
- The plugin store loads an https index in the browser (the app makes no request), shows each file's SHA-256 and a scan of the commands it names before you confirm. See `docs/PLUGIN_STORE.md`.
- Delete erases the plugin's data only inside strictly checked paths (see "Compatibility notes" in the README). `/api/plugins/data` runs a read-only root probe without the root gate after checking the path; it is marked OPEN in the route table.
- `/api/goform/*`, `/api/proxy/*` and the cookie routes only talk to the saved router address (a local IPv4 address), never another host. `POST /api/proxy/*` needs a fresh sign-in.

## Updates

The updater (upload or an https link, max 120 MB, redirects stay on https) accepts an APK only if it is this package and signed with the same key, checks the signature (with a fallback lookup), and shows you the SHA-256 before the root `pm install` (`-d` for a downgrade). The permanent signing key is in CI secrets; a build made without it falls back to the debug key and cannot update an install signed with the permanent key.

## Bundled binaries

`sendat`, `curl`, `jq`, `zreq` (arm64) run as root; `sha256` is a script around the system `sha256sum`. Their hashes are pinned in `NOTICE.md` and checked by `scripts/check_repo.py`. `docs/BINARIES.md` lists where each came from and what is unknown (`sendat` and `curl` have no recorded build recipe).

## Other notes

- **IMEI rewrite:** writes the IMEI with `AT+SPIMEI` and re-applies it at boot. Changing an IMEI is restricted or illegal in some countries; use it only where allowed and only on your own device.
- **Logs** may contain device and network data. Exports and copies can hide private data (SMS text, phone numbers, IMEI / ICCID, passwords, tokens); keep exported files private.
- **Not done (open items):** an allowlist or "pause console" switch for hotspot clients; plugin sandboxing; end-to-end tests of WebServer routes and the updater flow.

## Reporting a problem

Open an issue without secrets in it (no passwords, tokens, IMEI, or full logs). For a sensitive report, contact the maintainer privately first.

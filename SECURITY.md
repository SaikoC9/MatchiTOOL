# Security

For 1.4.6. Full notes: [`docs/SECURITY_DETAILS.md`](docs/SECURITY_DETAILS.md).

MatchiTOOL is a root client, not a rooting tool. It calls the device's `su`. Magisk, KernelSU or APatch must grant root. UID 0 is the real check.

The console (port 2334) is for a trusted hotspot or USB-tether network and apps on the phone. **Never forward it to the internet.** For remote access use a trusted VPN or tunnel.

| Area | Protection | Known limit |
|---|---|---|
| Console | Password, 2 h idle / 12 h sessions, per-IP lockout | Anyone signed in can run root commands |
| Network | Only this device and hotspot subnets; Host and Origin checks | Listens on all LAN interfaces |
| Transport | HTTPS first; root refused over plain HTTP | Plain HTTP if TLS cannot start |
| Root | Sign-in under 4 h; stdin commands; timeouts | Command filter is not a boundary |
| Plugins | SHA-256 tracking; password to install or delete; opt-in sandbox | Trusted plugins are trusted code |
| Updates | Same package and signing key; SHA-256 shown first | A debug-key build cannot update a release install |
| Binaries | Hash checked at every start; changed file deleted | Does not stop someone who already has root |

## Sign-in and sessions

- Default password: the router admin password. A separate console password (10+ characters) is stored as PBKDF2-HMAC-SHA256, 310,000 iterations. Wrong guesses then never reach the router.
- Lockout is per IP with doubling delays. Loopback is never locked; a wrong password from the phone itself is answered after 2 s.
- A session ends after 2 h idle, 12 h total, on **Sign out**, or on password change. Only real clicks and key presses count as activity.
- The token is an HttpOnly, SameSite=Strict cookie. Page script and plugins cannot read it. Requests also need the `x-token` marker header.
- Limits: a plugin's `fetch()` still uses your open session. Cookies are not scoped by port, so another web server on this IP sees the `/api` cookie.
- Every root route needs a sign-in under 4 h. `scripts/test_route_gates.py` checks each route.

## Network and transport

- Every API request must come from this device or a hotspot subnet and pass Host and same-origin checks.
- The app opens port 2334 on hotspot interfaces with an `iptables` rule and removes it on a clean stop. Uplink interfaces are never opened.
- If TLS fails, the console runs over plain HTTP with a red banner. Root calls from other devices are refused until you switch on **Plugins > Root over HTTP...** (password needed).

## Root shell

- Commands go to `sh` over a separate file descriptor, not a `su -c` string. Each has a timeout and bounded output.
- At most 3 shells at once; jobs over 30 s use at most 2.
- `shellDanger` catches accidents. It can be bypassed. The real protection is sign-in and the root gate.
- Boot scripts run only from root-owned files and folders, no symlinks. The host never edits `boot.sh`.

## Plugins

- Plugins are trusted code. They run in the console page with your session and can run root commands. Read a plugin before enabling it.
- The host stores each plugin's SHA-256 and abilities and flags changes. Install, replace, delete and approve need your password.
- **Sandbox** mode: isolated frame, only the permissions the file declared and you approved, re-checked on every call.
- The page filter (Content-Security-Policy) limits the browser, not the root shell.
- **Delete and stop** and **Turn off and stop** run as root and show the plan first. If anything is left, the plugin is kept.
- **Turn off and stop** asks no password, on purpose. The root gate and approved-file rule still apply.
- The stop protects against a forgetful plugin, not a hostile one. A plugin can lie about its name.

## Updates and binaries

- The updater accepts only this package, same signing key, and shows the SHA-256 before the root install.
- `sendat`, `curl`, `jq`, `zreq`, `matchi-sampler`, `matchi-doctor` run as root. Hashes are pinned in `NOTICE.md`. Sources: `docs/BINARIES.md`.

## Other

- **IMEI rewrite** (`AT+SPIMEI`, re-applied at boot) is restricted or illegal in some countries. Use only on your own device, where allowed.
- **Logs** can hold device and network data. Keep exports private.
- **Not done:** client allowlist or "pause console" switch; enforced permissions for trusted plugins.

## Report a problem

Open an issue with no secrets (no passwords, tokens, IMEI, full logs). For a sensitive report, contact the maintainer privately first.

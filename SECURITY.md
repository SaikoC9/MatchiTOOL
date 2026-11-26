# Security

Current for 1.4.6. Full notes: [`docs/SECURITY_DETAILS.md`](docs/SECURITY_DETAILS.md).

MatchiTOOL is a root client, not a rooting tool. It calls the device's `su` and
needs Magisk, KernelSU or APatch to grant it root. UID 0 is the real check.

The console (port 2334) is for a trusted hotspot or USB-tether network and for
apps on the phone. Never forward it to the internet. For remote access use a
trusted VPN or tunnel.

| Area | What protects it | Known limit |
|---|---|---|
| Console | Password sign-in, 2 h idle and 12 h sessions, per-IP lockout | Anyone signed in can run root commands |
| Network | Only this device and hotspot subnets; Host and Origin checks | Listens on all LAN interfaces |
| Transport | HTTPS first; root calls refused over plain HTTP | Plain HTTP if TLS cannot start |
| Root | Sign-in under 4 h; commands over stdin; timeouts | The command filter is not a boundary |
| Plugins | SHA-256 tracking; password to install or delete; opt-in sandbox | Trusted plugins are trusted code |
| Updates | Same package and signing key; SHA-256 shown first | A debug-key build cannot update a release install |
| Binaries | Hash checked at every start; a changed file is deleted | Does not stop someone who already has root |

## Sign-in and sessions

- By default the console password is the router's admin password. A separate
  console password (10+ characters) is stored as PBKDF2-HMAC-SHA256, 310,000
  iterations. Wrong guesses are then never sent to the router.
- Lockout is per IP with doubling delays. Loopback is never locked; a wrong
  password from the phone itself is answered after 2 s.
- A session ends after 2 h idle, 12 h at most, on **Sign out**, or when the
  password changes. Only real clicks and key presses count as activity.
- The token is an HttpOnly, SameSite=Strict cookie. Page script and plugins
  cannot read it. Requests also need the `x-token` marker header.
- Limit: a plugin's `fetch()` still uses your open session. Cookies are not
  scoped by port, so another web server on this IP sees the `/api` cookie.
- Every root-capable route needs a sign-in younger than 4 h.
  `scripts/test_route_gates.py` checks each route against a table.

## Network and transport

- Every API request must come from this device or a detected hotspot subnet,
  pass a Host check and pass a same-origin check.
- The app opens port 2334 on hotspot interfaces with an `iptables` rule and
  removes it when the service stops cleanly. Uplink interfaces are never opened.
- If TLS cannot start, the console runs over plain HTTP. The page shows a red
  banner. Root calls from other devices are refused until you switch on
  **Plugins > Root over HTTP...**, which needs the password again.

## Root shell

- Commands go to `sh` over a separate file descriptor, never into a `su -c`
  string. Each has a timeout and bounded output.
- At most 3 shells run at once. Jobs over 30 s use at most 2.
- `shellDanger` catches accidents. It can be bypassed. The real protection is
  the sign-in and the root gate.
- Boot scripts run only from root-owned files and folders, with no symlinks.
  The host never edits `boot.sh`.

## Plugins

- Plugins are trusted code. They run in the console page with your session and
  can run root commands. Read a plugin before you switch it on.
- The host stores each plugin's SHA-256 and abilities. The list flags a changed
  file. Installing, replacing, deleting or approving needs your password.
- A plugin can be switched to Sandbox: an isolated frame with only the
  permissions its file declared and you approved. The host re-checks them on
  every call.
- The page filter (Content-Security-Policy) limits what the browser can contact.
  It does not limit the root shell.
- **Delete and stop** and **Turn off and stop** run as root and show the plan
  first. If anything is left over, the plugin is kept.
- **Turn off and stop** asks no password, on purpose. The root gate and the
  approved-file rule still apply.
- The stop protects you from a forgetful plugin, not a hostile one. A plugin can
  lie about its name.

## Updates and binaries

- The updater accepts an APK only if it is this package, signed with the same
  key, and shows the SHA-256 before the root install.
- `sendat`, `curl`, `jq`, `zreq`, `matchi-sampler` and `matchi-doctor` run as
  root. Their hashes are pinned in `NOTICE.md`. Sources: `docs/BINARIES.md`.

## Tested

- Run on the F50: plugin header stop, process sweep, firewall and boot-script
  undo, Turn off and stop, the sandbox stop hook.
- Not run on a device: the no-root and timeout path of the undo, and
  `/api/plugins/data` with a sign-in older than 4 h (unit tests only).
- The AdGuard Home door and the Android side of the web gate had no device run
  recorded in these notes.

## Other notes

- **IMEI rewrite** uses `AT+SPIMEI` and re-applies at boot. It is restricted or
  illegal in some countries. Use it only on your own device, where allowed.
- **Logs** can hold device and network data. Keep exported files private.
- **Not done:** a client allowlist or "pause console" switch, enforced
  permissions for trusted plugins, and end-to-end tests of the routes and the
  updater.

## Report a problem

Open an issue with no secrets in it (no passwords, tokens, IMEI or full logs).
For a sensitive report, contact the maintainer privately first.

# Root integration — MatchiTOOL 1.1.52

## Scope

MatchiTOOL is a root client, not a rooting exploit. It uses the device's installed `su`
provider and requires the user to grant MatchiTOOL access in Magisk, KernelSU, APatch,
or another compatible manager. It does not unlock the bootloader, patch boot images,
flash TrustOS, or silently install a root manager.

## Improvements in 1.1.52

- Root status now reports the effective UID, resolved `su` path, and a best-effort
  manager hint (Magisk, KernelSU, APatch, or generic `su`).
- The native home screen shows the detected manager and UID after a successful grant,
  or a concise failure reason when root is unavailable.
- An authenticated `GET /api/root/status` endpoint exposes the same read-only status
  to the web console and trusted plugins.
- Persistent root shell sessions are closed cleanly when the foreground host service
  is destroyed, rather than being left to expire only by idle timeout.
- Shell teardown now closes streams and waits briefly before force-killing the process.
- The web ping version is read from installed package metadata instead of a stale
  hard-coded version string.

## Security model

- All privileged commands still pass through `RootShell`; script length and NUL-byte
  limits remain enforced.
- The `/api/shell` endpoint remains a powerful authenticated root terminal. Treat the
  web-console token and all installed plugins as privileged secrets. Keep port 2334
  restricted to a trusted hotspot/USB-tether LAN; HTTP is not encrypted.
- Root authorization and revocation remain controlled by the installed `su` manager.
  MatchiTOOL never tries to bypass a denied root request.

## Device validation still required

Run the root status check on the target device and verify that it reports UID 0 only
after approving the MatchiTOOL request in the root manager. Test command success,
non-zero exit status, timeout recovery, service restart, and boot tasks. Manager hints
are best-effort filesystem markers; UID 0 is the authoritative grant check.

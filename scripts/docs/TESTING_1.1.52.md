# MatchiTOOL 1.1.52 verification checklist

## Automated source checks

From the project root:

```sh
bash scripts/validate.sh
```

This parses Android XML, checks all inline and embedded plugin JavaScript with Node.js, and verifies critical source invariants including version metadata, the root command guard, LAN access rules, credential migration, response headers, and service lifecycle guards.

## Build check

The source archive does not include a Gradle wrapper. With Android SDK installed and Gradle 8.7 available:

```sh
gradle :app:assembleDebug
```

A successful source-validation run is not a substitute for this Android build.

## Device checks

1. Upgrade an existing 1.1.47 installation in place and confirm the app package, plugin files, saved settings, and `/data/local/matchitool/boot.sh` remain intact.
2. Open MatchiTOOL and approve the root request. Confirm root status reports UID 0.
3. Open the web console from a client on the ZTE hotspot / USB-tether network. Confirm login, plugin loading, and normal same-origin API calls work.
4. Confirm a browser on an unrelated network cannot use the API. Do not expose TCP port 2334 to the public internet.
5. Confirm the existing saved router password still works after upgrade; the first read should migrate it to Android Keystore AES-GCM storage when the device keystore supports it.
6. Run read-only diagnostics and a root-terminal `id` command. Test a command timeout and a command larger than 128 KB; the latter must be rejected before execution.
7. Open multiple read-only diagnostics requests concurrently, then restart the host service. Confirm no stale root session or duplicate host prevents startup.
8. Reboot the ZTE F50 and verify the host starts once, boot tasks run once, and firewall rules are present on the active bridge/AP/USB/RNDIS/ECM interfaces.
9. Test the web console over the available IPv4 and IPv6 hotspot paths. IPv6 access is permitted only when the client address belongs to a detected hotspot-side interface prefix.
10. Test USB ADB, RNDIS, and CDC-ECM controls, firmware inspection, screen control, plugin manager, and OTA staging without installing an unverified APK.

## Known limitation

The LAN console remains plain HTTP for compatibility with the existing browser workflow. Passwords, session tokens, and root API traffic are not encrypted in transit. Use it only on a trusted hotspot / USB-tether network or behind a trusted VPN/encrypted tunnel. A proper HTTPS deployment needs a deliberate certificate trust and onboarding flow.


## 1.1.52 review additions

- Confirm the native LAN access row explicitly warns that HTTP is unencrypted.
- Confirm the web-console login screen displays the same warning before credentials are entered.
- Verify a companion device on the ZTE hotspot/USB-tether subnet can log in, while a client from an unrelated network is refused.
- Verify the warning does not change the existing plugin bridge, root command flow, saved settings, or Bypass boot state.
- Confirm the version shown by the Android package, `/api/ping`, and web page is 1.1.52.


## Root integration checks

- Open the native app and approve the MatchiTOOL request in the installed su manager.
- Confirm the home screen reports `Granted`, the manager hint, and `UID 0`.
- Call authenticated `GET /api/root/status`; confirm `granted: true` and `uid: "0"`.
- Deny the request on a test install and confirm the app reports root unavailable without claiming UID 0.
- Run a harmless command (`id -u`), a command that exits non-zero (`false`), and a short timeout test.
- Stop/restart the foreground service and confirm no stale root-shell session is reused.
- Confirm boot tasks still run only after the root manager grants MatchiTOOL.

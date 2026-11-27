# MatchiTOOL

Android app that runs a web console for the ZTE F50 hotspot: AT commands, SMS, live signal and device status, root terminal, plugins.

Version **1.4.6** (versionCode **406**).

MatchiTOOL does not root the device. Install Magisk, KernelSU or APatch first, then grant MatchiTOOL root. To root the stock F50, see [`docs/F50_STOCK_ROOT.md`](docs/F50_STOCK_ROOT.md).

## Features

- Web console on port 2334: HTTPS first, password sign-in, expiring sessions
- Root terminal and plugins
- AT commands, SMS, router API
- Live status: CPU, memory, temperature, signal
- Log Catcher, with optional boot capture
- USB controls; optional Wi-Fi off during USB tethering
- Screen view and control from a second phone
- In-console APK update with signature and SHA-256 check
- Wipe on uninstall

Seven built-in tools load by themselves: AT Radio, Network Diagnostics, Live Status, Memory Cleaner, Change IP, SMS, Screen Control. See [`docs/FEATURES.md`](docs/FEATURES.md).

## Install

1. Install the APK on an F50 that already has root.
2. Open the app, press **Request / check root access**.
3. Open the LAN URL the app shows, from a device on the hotspot or USB tether.
4. Sign in. Default password: the router admin password.
5. If the router asks for a login, enter it in the SMS plugin settings.

**Never forward port 2334 to the internet.** The console gives root access.

## Build

Needs Android 8.0+ (minSdk 26), JDK 17, Android SDK 34.

```sh
./scripts/validate.sh
gradle :app:assembleRelease
```

Details: [`docs/BUILD.md`](docs/BUILD.md).

## Docs

[Features](docs/FEATURES.md) | [Plugins](docs/PLUGINS.md) | [Uninstall wipe](docs/UNINSTALL_WIPE.md) | [Security](SECURITY.md) | [Changelog](CHANGELOG.md)

## License

MIT. See [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md).

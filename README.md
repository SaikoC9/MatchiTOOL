# MatchiTOOL

Android app that runs a web console for the ZTE F50 hotspot. It gives you AT
commands, SMS, live signal and device status, a root terminal and plugins,
all from a browser.

Current source version: **1.4.6** (versionCode **406**).

MatchiTOOL does not root the device. Install Magisk, KernelSU or APatch
first, then grant MatchiTOOL root. To root the stock F50 itself, see
[`docs/F50_STOCK_ROOT.md`](docs/F50_STOCK_ROOT.md).

## Features

- Web console on port 2334: HTTPS first, password sign-in, expiring sessions
- Root terminal and a plugin system
- AT commands, SMS and router API access
- Live device status: CPU, memory, temperature, signal
- Log Catcher, with optional boot-time capture
- USB controls, and optional Wi-Fi off while USB tethering
- Screen view and control from a second phone
- APK update from the console, with signature and SHA-256 check
- Wipe on uninstall: removes root-side files, rules and programs

The seven built-in tools (AT Radio, Network Diagnostics, Live Status, Memory
Cleaner, Change IP, SMS, and Screen Control) load by themselves.
Details are in [`docs/FEATURES.md`](docs/FEATURES.md).

## Install

1. Install the APK on an F50 that already has root.
2. Open MatchiTOOL and press **Request / check root access**.
3. Open the LAN URL the app shows, from a device on the hotspot or USB tether.
4. Sign in. By default the password is the router's admin password.
5. If the router asks for a login, enter it in the SMS plugin settings.

Never forward port 2334 to the internet. The console exposes root and plugin
APIs to the local network only.

## Build

Needs Android 8.0+ (minSdk 26), JDK 17 and Android SDK 34.

```sh
./scripts/validate.sh
gradle :app:testDebugUnitTest
gradle :app:assembleRelease
```

More in [`docs/BUILD.md`](docs/BUILD.md).

## Docs

- [Features](docs/FEATURES.md)
- [Plugins](docs/PLUGINS.md)
- [Uninstall wipe](docs/UNINSTALL_WIPE.md)
- [Security](SECURITY.md)
- [Testing](docs/TESTING.md)
- [Changelog](CHANGELOG.md)

## License

MIT. See [`LICENSE`](LICENSE). Third-party notices are in
[`NOTICE.md`](NOTICE.md).

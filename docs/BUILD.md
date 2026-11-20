# Build

## Requirements

- Android 8.0+ device (minSdk 26)
- JDK 17 and Android SDK 34, with Android Studio or Gradle 8.7 and Android
  Gradle Plugin 8.5.2

The repo has no Gradle wrapper yet. On a new machine run
`bash scripts/bootstrap-build.sh` once. It creates the wrapper and does the
first full build.

## Commands

```sh
./scripts/validate.sh
gradle :app:testDebugUnitTest
gradle :app:assembleDebug     # app/build/outputs/apk/debug/app-debug.apk
gradle :app:assembleRelease   # app/build/outputs/apk/release/app-release.apk
```

The release APK is the one that gets published. Release builds shrink code and
resources with R8 but do not rename or optimise (`app/proguard-rules.pro`). If a
release build misbehaves, set `isMinifyEnabled` and `isShrinkResources` to
false in `app/build.gradle.kts`.

## Version

The version lives only in `version.properties`. Gradle reads it, and
`node scripts/build-web.js` writes it into the page (`PAGE_VERSION`).
`validate.sh` fails if the README or the top CHANGELOG entry names another
version.

To bump it:

1. Edit `version.properties`.
2. Run `node scripts/build-web.js`.
3. Update the version line in `README.md`.
4. Add a `CHANGELOG.md` entry.

## Checks

`scripts/validate.sh` runs:

- the page build check
- `check_repo.py`: version, README tool count, bundled binary hashes
- `test_route_gates.py`: which routes need the root gate, read from the code
- the Node and shell tests
- `check_sources.py`: older grep-style tripwires. Do not add to it. When you
  touch that area, replace a guard with a real test.

Kotlin logic is tested in `app/src/test`. The order of the root gate checks is
tested in `RootGateTest`.

## Code layout

- `WebServer.kt`: request checks, login, sessions, headers, the page and the
  route dispatcher.
- `WebRoutes*.kt` (Auth, Device, Logs, Plugins, Root, Router, Update): one
  extension function per group, returning null for a path that is not its own.
- `PluginPaths.kt`: plugin data-path rules.

A new route goes into the matching `WebRoutes*.kt` and into the table in
`scripts/test_route_gates.py`.

## CI

GitHub Actions validates the JavaScript and XML and builds the debug APK on
every push, pull request or manual run. It pins Gradle 8.7 and Android Gradle
Plugin 8.5.2.

## Bundled binaries

How `jq`, `curl`, `sendat` and `zreq` are built and checked:
[`BUILD_BINARIES.md`](BUILD_BINARIES.md) and [`BINARIES.md`](BINARIES.md).

# Build

## Requirements

- Android 8.0+ device (minSdk 26)
- JDK 17, Android SDK 34, Gradle 8.7, Android Gradle Plugin 8.5.2

No Gradle wrapper in the repo yet. On a new machine run `bash scripts/bootstrap-build.sh` once.

## Commands

```sh
./scripts/validate.sh
gradle :app:assembleDebug     # app/build/outputs/apk/debug/app-debug.apk
gradle :app:assembleRelease   # app/build/outputs/apk/release/app-release.apk
```

Publish the release APK. It is shrunk with R8, not renamed or optimised (`app/proguard-rules.pro`). If it misbehaves, set `isMinifyEnabled` and `isShrinkResources` to false in `app/build.gradle.kts`.

## Version

Set it only in `version.properties`. To bump:

1. Edit `version.properties`.
2. Run `node scripts/build-web.js` (writes `PAGE_VERSION`).
3. Update the version line in `README.md`.
4. Add a `CHANGELOG.md` entry.

`validate.sh` fails if README or the top CHANGELOG entry names another version.

## Checks (`scripts/validate.sh`)

- page build check
- `check_repo.py`: version, README tool count, binary hashes
- `test_route_gates.py`: which routes need the root gate
- `check_sources.py`: old grep tripwires. Do not add to it

## Code layout

- `WebServer.kt`: request checks, login, sessions, headers, page, route dispatch
- `WebRoutes*.kt` (Auth, Device, Logs, Plugins, Root, Router, Update): one function per group, returns null for foreign paths
- `PluginPaths.kt`: plugin data-path rules

A new route goes into the matching `WebRoutes*.kt` and into the table in `scripts/test_route_gates.py`.

## CI

GitHub Actions validates JS and XML and builds the debug APK on every push, pull request or manual run.

## Bundled binaries

See [`BUILD_BINARIES.md`](BUILD_BINARIES.md) and [`BINARIES.md`](BINARIES.md).

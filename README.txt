MatchiTOOL

Android app that runs a web console for the ZTE F50 hotspot. It gives you AT
commands, SMS, live signal and device status, a root terminal and plugins,
all from a browser.

MatchiTOOL does not root the device. Install Magisk, KernelSU or APatch
first, then grant MatchiTOOL root.

INSTALL

  1. Install the APK on an F50 that already has root.
  2. Open MatchiTOOL and press "Request / check root access".
  3. Open the LAN URL the app shows, from a device on the hotspot or USB
     tether. The console runs on port 2334.
  4. Sign in. By default the password is the router's admin password.

Never forward port 2334 to the internet.

BUILD

  ./scripts/validate.sh
  gradle :app:testDebugUnitTest
  gradle :app:assembleRelease

The version is in version.properties.

DOCS

  README.md           overview
  docs/FEATURES.md    what each feature does
  docs/PLUGINS.md     writing and removing plugins
  docs/BUILD.md       build, CI, checks
  docs/TESTING.md     test steps for the F50
  docs/dev-notes/     working notes and device test logs
  SECURITY.md         security model
  CHANGELOG.md        version history

LICENSE

MIT. See LICENSE. Third-party notices are in NOTICE.md.

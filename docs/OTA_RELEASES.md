# OTA updates with a private source repo

The device downloads the APK without logging in, so the APK needs a public link. The source stays private.

## One-time setup

1. Create a **public** repo for releases only, e.g. `YOURNAME/MatchiTOOL-releases`. Add a README. No source in it.
2. Create a fine-grained token: GitHub > Settings > Developer settings > Fine-grained tokens. Repository: only `MatchiTOOL-releases`. Permission: **Contents: Read and write**.
3. In the private source repo, Settings > Secrets and variables > Actions:
   - Secrets: `MATCHI_KEYSTORE_B64`, `MATCHI_KEYSTORE_PASSWORD` (see KEYSTORE_README.txt), `RELEASES_TOKEN` (the token)
   - Variable: `RELEASES_REPO` = `YOURNAME/MatchiTOOL-releases`

## Each release

1. In `version.properties` raise `VERSION_CODE` and `VERSION_NAME` (must be higher than installed). Run `node scripts/build-web.js`. Update the README version line and the CHANGELOG. Push.
2. Actions > **Publish APK to public releases repo** > Run workflow.
3. In the device console: Update, paste
   `https://github.com/YOURNAME/MatchiTOOL-releases/releases/latest/download/MatchiTOOL.apk`
   > Check for update > Download & verify > compare the SHA-256 with the release notes > Install update.

## Security

The release repo holds only the APK. A fake update cannot install: the device accepts only a file signed with your key, and Android checks again. Keep the keystore and `RELEASES_TOKEN` out of the public repo.

## Reinstall and rollback

- Same versionCode, different SHA-256: installs as an update.
- Identical file: reinstalls.
- Lower versionCode: rolls back, app data kept.

To roll back, point the link at an older release, e.g. `.../releases/download/v1.2.12/MatchiTOOL.apk`, then Check > Download & verify > Roll back. The signing key must match.

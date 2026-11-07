# OTA updates with a private source repo

The device downloads the APK without logging in, so the APK must be on a public link. The source stays private.

## One-time setup
1. Create a **public** repo for releases only, e.g. `YOURNAME/MatchiTOOL-releases` (add a README so it is not empty). No source goes in it.
2. Create a **fine-grained personal access token**: GitHub > Settings > Developer settings > Fine-grained tokens.
   Repository access: only `MatchiTOOL-releases`. Permission: **Contents: Read and write**. Copy the token.
3. In the **private** source repo: Settings > Secrets and variables > Actions:
   - Secrets: `MATCHI_KEYSTORE_B64`, `MATCHI_KEYSTORE_PASSWORD` (from KEYSTORE_README.txt), `RELEASES_TOKEN` (the token from step 2)
   - Variables tab: `RELEASES_REPO` = `YOURNAME/MatchiTOOL-releases`

## Each release
1. Raise `versionCode` and `versionName` in `app/build.gradle.kts` (the new versionCode must be higher than the installed one), push.
2. Actions > **Publish APK to public releases repo** > Run workflow.
3. On the device's web console: Update, paste
   `https://github.com/YOURNAME/MatchiTOOL-releases/releases/latest/download/MatchiTOOL.apk`
   > Check for update > Download & verify > compare the SHA-256 with the one in the release notes > Install update.

## Security
The release repo only holds the APK. Nobody can push a fake update: the device installs only a file signed with your key
(and Android checks it again). Keep the keystore and `RELEASES_TOKEN` out of the public repo.

## Reinstall and rollback
The same versionCode with a different SHA-256 installs as a normal update (a different build of that version); the identical file (same SHA-256) only reinstalls, and a lower versionCode rolls back (app data is kept). To roll back, point the link at an older release, e.g.
`https://github.com/YOURNAME/MatchiTOOL-releases/releases/download/v1.2.12/MatchiTOOL.apk`, then Check > Download & verify > Roll back. The signing key must be the same.

# Building jq and curl 

`.github/workflows/build-binaries.yml` builds `jq` and `curl` for arm64 Android from pinned upstream tags
with the Android NDK (API 26, the app's minSdk). `curl` links OpenSSL statically, so it no longer depends on
the device's own libssl/libcrypto/libz. `sendat` is **not** built here: its replacement has its own workflow, `.github/workflows/build-sendat.yml`
(source in `tools/sendat/`, steps in its README).

1. GitHub, Actions, "Build jq and curl (arm64 Android)", Run workflow. Defaults: jq-1.8.2, curl-8_23_0, openssl-3.5.9 (OpenSSL 3.0 reached end of support on 2026-09-07; 3.5 is the LTS line).
2. Download the artifact `matchitool-binaries-arm64` and note the SHA-256 values in the job summary.
3. Test on the F50 before replacing anything: push `jq` and `curl` to `/data/local/tmp`, `chmod 755`, then
   `./jq --version`, `./curl -sS -m 10 https://example.com -o /dev/null -w '%{http_code}\n'` (checks TLS and the
   Android CA path `/system/etc/security/cacerts`), and `./curl -V`.
4. Copy the files over `app/src/main/assets/bin/jq` and `.../curl`.
5. Replace the old hashes in `NOTICE.md` and `docs/BINARIES.md` (source tag, OpenSSL tag, NDK version).
   `bash scripts/validate.sh` fails until the new SHA-256 values are in `NOTICE.md`.

Reproducibility note: tags can in principle be moved. For a stricter pin, replace the tag in the workflow inputs
with the full commit SHA once you have checked it. The outputs are not guaranteed to be bit-identical between runs.

## One run for everything (release-tools.yml)

Instead of the three manual workflows, push a tag that starts with `tools-v` (for example `tools-v2026.11.1`), or run
"Release tools (build, compare, hashes, PR)" from Actions. One run:

1. builds `curl`, `jq`, `sendat` and `zreq` (it calls the three workflows above, with the same versions);
2. builds `sendat` and `zreq` a second time and fails if the two builds are not byte-for-byte equal. `curl` and `jq` are only
   built twice when you start the run by hand and tick "check_native" (it takes about as long again);
3. uploads `matchitool-tools-arm64` and tries to record build provenance (this needs a public repo or GitHub Enterprise Cloud;
   on a private repo that step fails and the run goes on);
4. runs `scripts/update_binary_hashes.py`, which copies the binaries into `assets/bin` and replaces the old SHA-256 values in
   `NOTICE.md` and `docs/BINARIES.md` with the new ones and writes `BinaryHashes.kt` again (the list the app checks its copies
   against), then `scripts/check_repo.py`;
5. opens a pull request called "Rebuilt bundled binaries (not tested on the F50 yet)".

Test on the F50 (step 3 above) before you merge that pull request. The script only rewrites hashes; change the version words
(Go, curl, OpenSSL, jq) in the two files yourself. In the repo settings, Actions > General, "Allow GitHub Actions to create and
approve pull requests" must be on, or step 5 fails. A pull request made this way does not start other workflows, so run
"Validate and build APK" on its branch by hand.

## Pinning the actions

`scripts/pin-actions.sh` rewrites every `uses: owner/repo@tag` in the workflows to the full commit the tag points at, with the
tag left as a comment. Run it with network access, read the diff, commit. `scripts/pin-actions.sh --check` lists what is still
not pinned. Pinning is not done yet in this repo: run the script once, and again after you change a tag.

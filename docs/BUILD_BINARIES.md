# Building jq and curl

`.github/workflows/build-binaries.yml` builds `jq` and `curl` for arm64 Android from pinned upstream tags with the NDK (API 26 = minSdk). `curl` links OpenSSL statically. `sendat` has its own workflow (`build-sendat.yml`, `tools/sendat/`).

## Manual build

1. GitHub > Actions > "Build jq and curl (arm64 Android)" > Run workflow. Defaults: jq-1.8.2, curl-8_23_0, openssl-3.5.9 (3.0 reached end of support 2026-09-07; 3.5 is LTS).
2. Download artifact `matchitool-binaries-arm64`; note the SHA-256 values in the job summary.
3. Copy over `app/src/main/assets/bin/jq` and `.../curl`.
4. Replace the old hashes, source tag, OpenSSL tag and NDK version in `NOTICE.md` and `docs/BINARIES.md`. `bash scripts/validate.sh` fails until the hashes are there.

Tags can be moved. For a stricter pin, put the full commit SHA in the workflow inputs. Output is not guaranteed bit-identical between runs.

## One run for everything (`release-tools.yml`)

Push a tag starting with `tools-v` (e.g. `tools-v2026.11.1`) or run "Release tools (build, compare, hashes, PR)". It:

1. Builds `curl`, `jq`, `sendat`, `zreq` (calls the workflows above, same versions).
2. Builds `sendat` and `zreq` twice and fails if not byte-identical. `curl` and `jq` are built twice only on a manual run with "check_native" ticked (about twice as long).
3. Uploads `matchitool-tools-arm64` and tries to record build provenance (needs a public repo or GitHub Enterprise Cloud; on a private repo this step fails and the run continues).
4. Runs `scripts/update_binary_hashes.py`: copies binaries into `assets/bin`, replaces old SHA-256 values in `NOTICE.md` and `docs/BINARIES.md`, rewrites `BinaryHashes.kt`, then runs `scripts/check_repo.py`.
5. Opens a pull request "Rebuilt bundled binaries".

The script rewrites hashes only; update version words (Go, curl, OpenSSL, jq) yourself. Repo settings > Actions > General: "Allow GitHub Actions to create and approve pull requests" must be on, or step 5 fails. Such a PR does not start other workflows; run "Validate and build APK" on its branch by hand.

## Pin the actions

`scripts/pin-actions.sh` rewrites every `uses: owner/repo@tag` to the full commit SHA (tag kept as a comment). Run it with network access, read the diff, commit. `--check` lists what is unpinned. Not done yet in this repo; run it once, and again after changing a tag.

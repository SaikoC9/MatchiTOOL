# Building jq and curl yourself

`.github/workflows/build-binaries.yml` builds `jq` and `curl` for arm64 Android from pinned upstream tags
with the Android NDK (API 26, the app's minSdk). `curl` links OpenSSL statically, so it no longer depends on
the device's own libssl/libcrypto/libz. `sendat` is **not** built here: its replacement has its own workflow, `.github/workflows/build-sendat.yml`
(source in `tools/sendat/`, steps in its README).

1. GitHub, Actions, "Build jq and curl (arm64 Android)", Run workflow. Defaults: jq-1.7.1, curl-8_11_0, openssl-3.0.15.
2. Download the artifact `matchitool-binaries-arm64` and note the SHA-256 values in the job summary.
3. Test on the F50 before replacing anything: push `jq` and `curl` to `/data/local/tmp`, `chmod 755`, then
   `./jq --version`, `./curl -sS -m 10 https://example.com -o /dev/null -w '%{http_code}\n'` (checks TLS and the
   Android CA path `/system/etc/security/cacerts`), and `./curl -V`.
4. Copy the files over `app/src/main/assets/bin/jq` and `.../curl`.
5. Replace the old hashes in `NOTICE.md` and `docs/BINARIES.md` (source tag, OpenSSL tag, NDK version).
   `bash scripts/validate.sh` fails until the new SHA-256 values are in `NOTICE.md`.

Reproducibility note: tags can in principle be moved. For a stricter pin, replace the tag in the workflow inputs
with the full commit SHA once you have checked it. The outputs are not guaranteed to be bit-identical between runs.

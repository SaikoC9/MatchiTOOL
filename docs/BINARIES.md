# Bundled executables

These files in `app/src/main/assets/bin/` are copied to the app's private folder at start-up and run **as root** when a tool or plugin calls them. Treat them as part of the trusted code base.

| File | What it is | Where it came from | Source / rebuild | SHA-256 |
|---|---|---|---|---|
| `sendat` | AT-command client for the modem (arm64, static Go 1.26.10, not packed) | Built from this repo (`tools/sendat/`) | `.github/workflows/build-sendat.yml` (Go 1.26.10, `CGO_ENABLED=0`, `-trimpath -ldflags "-s -w"`). Test on the device first: `sendat -probe`. | `c7f61e688b269d924f0f5274abc599251c11341606cf99c435c64c4aa0eddbb7` |
| `curl` | curl 8.23.0 built from upstream source, arm64 Android, OpenSSL 3.5.9 linked statically (libc/libdl/libz from the system) | Built by `.github/workflows/build-binaries.yml` | `.github/workflows/build-binaries.yml` (NDK clang, API 26). curl itself is MIT-style licensed (https://curl.se/docs/copyright.html). | `bb49333d364737bef97b77114790be5684fd3c22d6d4274fbe56c3a83869428a` |
| `jq` | jq 1.8.2, statically linked arm64 ELF | Built by `.github/workflows/build-binaries.yml` | `.github/workflows/build-binaries.yml` (static). jq is MIT (https://github.com/jqlang/jq). | `a8dc0221d8a6e7d67feb16882768585e6f339dcf0fce1e828761c2c4f1ca3050` |
| `zreq` | small HTTP client for the router's goform API (Go, static arm64) | MatchiTOOL's own build (zreq 1.1, LD sign-in). No built-in password; `-pwd`, `-pwd-file` or `ZREQ_PWD`; `-ip` must be a private or loopback IPv4. | `tools/zreq/` (Go 1.26.10, `CGO_ENABLED=0`, `-trimpath -ldflags "-s -w"`) built by `.github/workflows/build-zreq.yml`. | `96d4ba28f0f1a2b3dbbe0c805d99ce33b0053fd65552352a3dd4698117cc9b50` |
| `matchi-guard` | watches plugin processes (CPU per plugin tag, stuck helpers, memory) and writes a JSON report; `run` starts a plugin command with wall/CPU/memory limits; `size` is a bounded `du -skx` (arm64, static Go, not packed) | Built from this repo (`tools/guard/`). Used only when the guard is switched on. | `.github/workflows/build-guard.yml` (`CGO_ENABLED=0`, `-trimpath -ldflags "-s -w"`). Test on the device first: `tools/guard/README.md`. | `4e6803ec89fffa7c9be03a7920fcff351eb29300031ed37cb873ff5c6eba6eb7` |
| `matchi-sampler` | reads `/proc` and `/sys` once a second and prints the Live panel line (CPU, core speeds, temperatures, load, memory); same line as the shell loop in `LiveSampler.kt` (arm64, static Go, not packed) | Built from this repo (`tools/sampler/`). Used only when "Fast sampler" is on; the app falls back to the shell loop when it is off, missing or refused. | `.github/workflows/build-sampler.yml` (`CGO_ENABLED=0`, `-trimpath -ldflags "-s -w"`). Test on the device first: `tools/sampler/README.md`. | `82bc92bc78e0afb55fc914a49d4885f2abddd02e9e2ad93b51f3ac40f1594cc6` |
| `matchi-doctor` | one read-only command that checks root, SELinux, memory, /data, the CA store, TLS, the router, the modem (`AT`) and the bundled files' hashes, and prints JSON (arm64, static Go, not packed) | Built from this repo (`tools/doctor/`). Copied to the files folder like the others; nothing calls it yet (Phase 5 step 2). | `.github/workflows/build-doctor.yml` (`CGO_ENABLED=0`, `-trimpath -ldflags "-s -w"`). Test on the device first: `tools/doctor/README.md`. | `5badac638d193d5cd96197b7d2f7ae813e2864fc6b1b27b45dd8a836c2030471` |
| `sha256` | shell script: prints the SHA-256 of a file (its content) or of a text argument | Written for MatchiTOOL (1.4.1). Replaces an earlier packed binary that had no source. | The file itself. | see `NOTICE.md` |

## What the app checks

`BinaryHashes.kt` holds the SHA-256 of each of these files as it is in the APK. The app compares its copy in the files folder with that list at every start, before each `sendat` call and before each start of the Live reader that runs `matchi-sampler`, and does not run a file that differs (`BinaryGuard.kt`, `BinaryCheck.kt`). Do not edit `BinaryHashes.kt` by hand: after a new binary, run `python3 scripts/gen_binary_hashes.py` (`update_binary_hashes.py` does it for you) and commit the result. `scripts/validate.sh` fails when the two disagree.

## Verify a file

```sh
sha256sum app/src/main/assets/bin/*
```

`scripts/validate.sh` (through `scripts/check_repo.py`) fails when the SHA-256 of a file in `assets/bin` is not written in `NOTICE.md`, so a changed binary cannot slip in unnoticed. After a deliberate replacement, update `NOTICE.md` and the table above.

## Still open

- `zreq` behaviour change: the earlier binary signed in with a built-in default password when none was given; the new one never does. Test the plugins that call `zreq` without `-pwd` on the F50.

- `curl` and `jq` are reproducible: the workflow fixes the build date (`SOURCE_DATE_EPOCH` = the tag's commit time) and strips build paths and the build id, so the same tags and NDK give the same SHA-256 (checked with two runs, 2026-11-17, NDK 30.0.16248370). A different NDK or runner image may change the hash. `sendat` and `zreq` are built from `tools/sendat/` and `tools/zreq/` by their workflows.
- `sha256` is a script now: plugins that call it get the lowercase hex hash followed by a newline. A file path gives the hash of the file content (1.4.3 and earlier hashed the path text by mistake). If a plugin expects different output, check it on the F50.

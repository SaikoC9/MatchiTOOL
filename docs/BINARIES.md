# Bundled executables

Files in `app/src/main/assets/bin/` are copied to the app's private folder at start-up and run **as root** when a tool or plugin calls them. Treat them as trusted code. Hashes are also in `NOTICE.md`.

| File | What | Source | SHA-256 |
|---|---|---|---|
| `sendat` | AT client for the modem (arm64, static Go 1.26.10, unpacked). | `tools/sendat/`, `build-sendat.yml` | `8fdd76ae1077601fdd25164992e314388c40627a57e5dfb421030d9c779ad54b` |
| `curl` | curl 8.23.0, OpenSSL 3.5.9 static, arm64 Android (system libc/libdl/libz). MIT-style license | `build-binaries.yml` (NDK clang, API 26) | `bb49333d364737bef97b77114790be5684fd3c22d6d4274fbe56c3a83869428a` |
| `jq` | jq 1.8.2, static arm64. MIT | `build-binaries.yml` | `a8dc0221d8a6e7d67feb16882768585e6f339dcf0fce1e828761c2c4f1ca3050` |
| `iperf3` | iperf3 3.19.1, static, no OpenSSL. BSD-3-Clause. Client only (speed test) | `build-binaries.yml` | `4083aaf33932ad3fe353f74bbe575fb7e803feefe87428cb68f8ec3e91d08b4b` |
| `zreq` | HTTP client for the router goform API (zreq 1.1, LD sign-in). No built-in password; `-pwd`, `-pwd-file` or `ZREQ_PWD`; `-ip` must be private or loopback IPv4 | `tools/zreq/`, `build-zreq.yml` | `2f7f80bf2a28346ced05d075d179c2697f023752ee18bacc35b131d2a7a7a3b8` |
| `matchi-guard` | Watches plugin processes (CPU per tag, stuck helpers, memory), writes JSON; `run` starts a command with limits; `size` is a bounded `du -skx`. Used only when the guard is on | `tools/guard/`, `build-guard.yml` | `d1da6209ec9206d2cb81cc3e8a17c240ff98d5d4c0f967214bc55e2d08f69d06` |
| `matchi-sampler` | Reads `/proc` and `/sys` each second and prints the Live panel line (same as the shell loop in `LiveSampler.kt`). Used only when "Fast sampler" is on; app falls back to the shell loop if off, missing or refused | `tools/sampler/`, `build-sampler.yml` | `82bc92bc78e0afb55fc914a49d4885f2abddd02e9e2ad93b51f3ac40f1594cc6` |
| `matchi-doctor` | One read-only command: root, SELinux, memory, /data, CA store, TLS, router, modem (`AT`), file hashes; prints JSON. Nothing calls it yet (Phase 5 step 2) | `tools/doctor/`, `build-doctor.yml` | `5badac638d193d5cd96197b7d2f7ae813e2864fc6b1b27b45dd8a836c2030471` |
| `sha256` | Shell script: SHA-256 of a file's content or a text argument. Replaced an earlier packed binary with no source (1.4.1) | the file itself | see `NOTICE.md` |

Go tools: `CGO_ENABLED=0`, `-trimpath -ldflags "-s -w"`.

## What the app checks

`BinaryHashes.kt` holds each file's SHA-256 as in the APK. The app compares its copy in the files folder with that list at every start, before each `sendat` call, and before each Live reader start (`matchi-sampler`). A differing file is not run and is deleted (`BinaryGuard.kt`, `BinaryCheck.kt`); it is re-copied from the APK at next start.

Do not edit `BinaryHashes.kt` by hand. After a new binary run `python3 scripts/gen_binary_hashes.py` (or `update_binary_hashes.py`) and commit. `validate.sh` fails if they disagree.

This stops damaged or swapped files. It does not stop someone who already has root.

## Verify

```sh
sha256sum app/src/main/assets/bin/*
```

`validate.sh` (via `scripts/check_repo.py`) fails if a file's SHA-256 is not in `NOTICE.md`. After a deliberate replacement, update `NOTICE.md` and the table above.

## Still open

- `curl` and `jq` are reproducible: the workflow fixes the build date (`SOURCE_DATE_EPOCH` = tag commit time) and strips build paths and ID. Same tags and NDK give the same SHA-256 (two runs, 2026-11-17, NDK 30.0.16248370). A different NDK or runner image may change the hash.
- `sha256` is a script now. It prints lowercase hex plus newline. A file path hashes the content (1.4.3 and earlier hashed the path text by mistake). Check plugins that expect other output on the F50.

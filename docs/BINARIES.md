# Bundled executables

These files in `app/src/main/assets/bin/` are copied to the app's private folder at start-up and run **as root** when a tool or plugin calls them. Treat them as part of the trusted code base.

| File | What it is | Where it came from | Source / rebuild | SHA-256 |
|---|---|---|---|---|
| `sendat` | AT-command client for the modem (arm64, static Go 1.22.8, not packed) | Built from this repo (`tools/sendat/`) | `.github/workflows/build-sendat.yml` (Go 1.22.8, `CGO_ENABLED=0`, `-trimpath -ldflags "-s -w"`). Test on the device first: `sendat -probe`. | `1ec33c2096c630e1f8bca34dcb239d48878f6816cbb8b5b31795568125dbc103` |
| `curl` | curl built from upstream source, arm64 Android, OpenSSL linked statically (libc/libdl/libz from the system) | Built by `.github/workflows/build-binaries.yml` | `.github/workflows/build-binaries.yml` (NDK clang, API 26). curl itself is MIT-style licensed (https://curl.se/docs/copyright.html). | `4c063298cc2d2b710d729c8f54f2ad503b504bfb80ff1f9f1e8dea7d8017d2b3` |
| `jq` | jq, statically linked arm64 ELF | Built by `.github/workflows/build-binaries.yml` | `.github/workflows/build-binaries.yml` (static). jq is MIT (https://github.com/jqlang/jq). | `738ee0567401f51c8c95c1df118b924d9e97954b00034bb91e37d995faa180e0` |
| `zreq` | small HTTP client for the router's goform API (Go, static arm64) | MatchiTOOL's own build (zreq 1.1, LD sign-in). No built-in password; `-pwd`, `-pwd-file` or `ZREQ_PWD`; `-ip` must be a private or loopback IPv4. | `tools/zreq/` (Go 1.22.8, `CGO_ENABLED=0`, `-trimpath -ldflags "-s -w"`) built by `.github/workflows/build-zreq.yml`. | `8dc2144a3cc5d6afccb594a25a96d3019b6be05e2f23c2e345aeddd9837b3da2` |
| `sha256` | shell script: prints the SHA-256 of its argument | Written for MatchiTOOL (1.4.1). Replaces an earlier packed binary that had no source. | The file itself. | see `NOTICE.md` |

## Verify a file

```sh
sha256sum app/src/main/assets/bin/*
```

`scripts/validate.sh` (through `scripts/check_repo.py`) fails when the SHA-256 of a file in `assets/bin` is not written in `NOTICE.md`, so a changed binary cannot slip in unnoticed. After a deliberate replacement, update `NOTICE.md` and the table above.

## Still open

- `zreq` behaviour change: the earlier binary signed in with a built-in default password when none was given; the new one never does. Test the plugins that call `zreq` without `-pwd` on the F50.

- `curl` and `jq` are reproducible: the workflow fixes the build date (`SOURCE_DATE_EPOCH` = the tag's commit time) and strips build paths and the build id, so the same tags and NDK give the same SHA-256 (checked with two runs, 2026-11-17, NDK 30.0.16248370). A different NDK or runner image may change the hash. `sendat` and `zreq` are built from `tools/sendat/` and `tools/zreq/` by their workflows.
- `sha256` is a script now: plugins that call it get the lowercase hex hash followed by a newline. If a plugin expects different output, check it on the F50.

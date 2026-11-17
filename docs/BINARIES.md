# Bundled executables

These files in `app/src/main/assets/bin/` are copied to the app's private folder at start-up and run **as root** when a tool or plugin calls them. Treat them as part of the trusted code base.

| File | What it is | Where it came from | Source / rebuild | SHA-256 |
|---|---|---|---|---|
| `sendat` | AT-command client for the modem (arm64, static Go 1.22.8, not packed) | Built from this repo (`tools/sendat/`), replaces the UFI-TOOLS binary | `.github/workflows/build-sendat.yml` (Go 1.22.8, `CGO_ENABLED=0`, `-trimpath -ldflags "-s -w"`). Test on the device first: `sendat -probe`. | `341bfb4d2890e66f753cba42436155f672997190a71097eee8064a5ef4e9342e` |
| `curl` | curl built from upstream source, arm64 Android, OpenSSL linked statically (libc/libdl/libz from the system) | Built by `.github/workflows/build-binaries.yml`; replaces the UFI-TOOLS V4.0.0 binary | `.github/workflows/build-binaries.yml` (NDK clang, API 26). curl itself is MIT-style licensed (https://curl.se/docs/copyright.html). | `8dda0f1104f17f2e1cd93455f283175df25266792312e32d7a3edc07ad1b43bc` |
| `jq` | jq, statically linked arm64 ELF | Built by `.github/workflows/build-binaries.yml`; replaces the UFI-TOOLS 4.1.5 binary | `.github/workflows/build-binaries.yml` (static). jq is MIT (https://github.com/jqlang/jq). | `738ee0567401f51c8c95c1df118b924d9e97954b00034bb91e37d995faa180e0` |
| `zreq` | small HTTP client for the router's goform API (Go, static arm64) | MatchiTOOL's own build (1.4.3), replaces the UFI-TOOLS 4.1.5 binary. No built-in password; `-pwd`, `-pwd-file` or `ZREQ_PWD`; `-ip` must be a private or loopback IPv4. | `tools/zreq/` (Go 1.22.8, `CGO_ENABLED=0`, `-trimpath -ldflags "-s -w"`) built by `.github/workflows/build-zreq.yml`. | `89948a9f47326e88d9e54e7b794acadd77bc6ab15723069d35aae58c388e2458` |
| `sha256` | shell script: prints the SHA-256 of its argument | Written for MatchiTOOL (1.4.1). Replaces UFI-TOOLS' packed binary, which had no source. | The file itself. | see `NOTICE.md` |

## Verify a file

```sh
sha256sum app/src/main/assets/bin/*
```

`scripts/validate.sh` (through `scripts/check_repo.py`) fails when the SHA-256 of a file in `assets/bin` is not written in `NOTICE.md`, so a changed binary cannot slip in unnoticed. After a deliberate replacement, update `NOTICE.md` and the table above.

To compare with the original: unzip the UFI-TOOLS APK (`unzip -p UFI-TOOLS.apk assets/shell/curl | sha256sum`) and compare with the table.

## Still open

- `zreq` behaviour change: the UFI-TOOLS binary signed in with its own default password when none was given; the new one never does. Test the plugins that call `zreq` without `-pwd` on the F50.

- `curl` is built by `.github/workflows/build-binaries.yml` but the build is not reproducible byte for byte; pinning it to an upstream tag with the steps written here would close this. `sendat` and `zreq` are built from `tools/sendat/` and `tools/zreq/` by their workflows.
- `sha256` is a script now: plugins that call it get the lowercase hex hash followed by a newline. If a plugin expects different output, check it on the F50.

# Bundled executables

These files in `app/src/main/assets/bin/` are copied to the app's private folder at start-up and run **as root** when a tool or plugin calls them. Treat them as part of the trusted code base.

| File | What it is | Where it came from | Source / rebuild | SHA-256 |
|---|---|---|---|---|
| `sendat` | AT-command client for the modem (arm64, static Go 1.22.8, not packed) | Built from this repo (`tools/sendat/`), replaces the UFI-TOOLS binary | `.github/workflows/build-sendat.yml` (Go 1.22.8, `CGO_ENABLED=0`, `-trimpath -ldflags "-s -w"`). Test on the device first: `sendat -probe`. | `dd694216a7199ca07aa5c0a785c802be8957bdb806f001c6785219c81bb2aa10` |
| `curl` | curl 8.0.1-DEV, arm64 Android, links the device's own libssl/libcrypto/libz | `assets/shell/curl` of the UFI-TOOLS V4.0.0 APK, unchanged | **Not recorded.** curl itself is MIT-style licensed (https://curl.se/docs/copyright.html). | `5627a31714a8c621d7ca56539af5b95f439bdbbc125b6aab301897fed3c4632a` |
| `jq` | jq, statically linked arm64 ELF | `assets/shell/jq` of the UFI-TOOLS 4.1.5 APK, unchanged | jq is MIT (https://github.com/jqlang/jq). It is not confirmed that this build equals an upstream release build. | `91bb0b08fd8053c04be41846f83be24bfa06d5c1eac2c0c925298638c642ea52` |
| `zreq` | small HTTP client written in Go | `assets/shell/zreq` of the UFI-TOOLS 4.1.5 APK, unchanged | UFI-TOOLS ships `zreq.go` (MIT). Its built-in default router password is UFI-TOOLS' own; MatchiTOOL never passes it. | `b7b0b01e55dcd3cf758648cba63d67f83fa72cbadeb4687eda514741fb76600d` |
| `sha256` | shell script: prints the SHA-256 of its argument | Written for MatchiTOOL (1.4.1). Replaces UFI-TOOLS' packed binary, which had no source. | The file itself. | see `NOTICE.md` |

## Verify a file

```sh
sha256sum app/src/main/assets/bin/*
```

`scripts/validate.sh` (through `scripts/check_repo.py`) fails when the SHA-256 of a file in `assets/bin` is not written in `NOTICE.md`, so a changed binary cannot slip in unnoticed. After a deliberate replacement, update `NOTICE.md` and the table above.

To compare with the original: unzip the UFI-TOOLS APK (`unzip -p UFI-TOOLS.apk assets/shell/curl | sha256sum`) and compare with the table.

## Still open

- `sendat` (the shipped file) and `curl` have no recorded source or build recipe. `tools/sendat/` is the replacement for `sendat`; see its README for the swap steps. A reproducible build (or a switch to a binary built from a pinned upstream tag, with the build steps written here) would close this.
- `sha256` is a script now: plugins that call it get the lowercase hex hash followed by a newline. If a plugin expects different output, check it on the F50.

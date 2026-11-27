# Third-party notices

- MatchiTOOL's own changes: see `LICENSE`.
- NanoHTTPD 2.3.1: external Gradle dependency. See its upstream license.
- No `nfqws` executable is bundled.
- `socat`, `ttyd`, `adb`, `iperf3`, `imei_reader` are not bundled. No collected plugin needs them yet.

All executables are in `app/src/main/assets/bin/`, run as root, and are arm64. `scripts/validate.sh` fails if a file changes. Replace the hash here and in `docs/BINARIES.md` with every new build. Origins and verification: `docs/BINARIES.md`.

Build flags for the Go tools: `CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags "-s -w"`.

| File | What | Built from | SHA-256 |
|---|---|---|---|
| `sendat` | AT client (Go 1.26.10). ENODATA fix, `stty_nr0/1` ports, `-probe` skips held ports (`-probe -all` overrides), `/dev/stty_nr6` first for slot 0. Test with `sendat -probe`; pin the port in `/data/local/matchitool/sendat.conf` if needed | `tools/sendat/`, `build-sendat.yml` | `c7f61e688b269d924f0f5274abc599251c11341606cf99c435c64c4aa0eddbb7` |
| `matchi-sampler` | Live panel reader. Only reads `/proc` and `/sys`. Used only when "Fast sampler" is on (default off) | `tools/sampler/`, `build-sampler.yml` | `82bc92bc78e0afb55fc914a49d4885f2abddd02e9e2ad93b51f3ac40f1594cc6` |
| `matchi-guard` | Watches and limits plugin processes. Reads `/proc`, writes one JSON report, signals only tagged plugin processes | `tools/guard/`, `build-guard.yml` | `d1da6209ec9206d2cb81cc3e8a17c240ff98d5d4c0f967214bc55e2d08f69d06` |
| `matchi-doctor` | Read-only diagnostics (root, SELinux, memory, /data, CA store, TLS, router, modem, file hashes). Prints JSON. The app does not call it yet | `tools/doctor/`, `build-doctor.yml` | `5badac638d193d5cd96197b7d2f7ae813e2864fc6b1b27b45dd8a836c2030471` |
| `curl` | curl 8.23.0, OpenSSL 3.5.9 static, NDK clang API 26. Needs only system libc/libdl/libz. License: MIT-style (https://curl.se/docs/copyright.html) | `build-binaries.yml` | `bb49333d364737bef97b77114790be5684fd3c22d6d4274fbe56c3a83869428a` |
| `jq` | jq 1.8.2, static. MIT (https://github.com/jqlang/jq) | `build-binaries.yml` | `a8dc0221d8a6e7d67feb16882768585e6f339dcf0fce1e828761c2c4f1ca3050` |
| `sha256` | 6-line shell script. Calls the system `sha256sum`; hashes a file's content, a text argument, or stdin | written for MatchiTOOL | `c937b0f3728d3ade2212d2de2e3ec258b396e5efc26821c4816528f484a868eb` |
| `zreq` | `zreq 1.1 (MatchiTOOL)`, Go, static, module `matchitool/zreq`. No built-in password: sign-in only with `-pwd`, `-pwd-file` or `ZREQ_PWD`. Router address must be private or loopback IPv4 | `tools/zreq/`, `build-zreq.yml` | `96d4ba28f0f1a2b3dbbe0c805d99ce33b0053fd65552352a3dd4698117cc9b50` |

`curl`, `jq`, `sha256` and `zreq` are copied to the app files folder at start-up.

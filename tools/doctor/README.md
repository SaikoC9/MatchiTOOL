# matchi-doctor (own build)

One read-only command that collects what "Full diagnose" needs from the device and prints it as JSON. It starts no shell and changes
nothing: no file is written, no setting is touched, and the only thing that ever reaches the modem is a plain `AT` sent by `sendat`.

    matchi-doctor                                   # root, SELinux, memory, /data, CA store, router, modem
    matchi-doctor -pretty                           # same, indented
    matchi-doctor -tls example.com:443              # also a TLS handshake against the device's CA store
    matchi-doctor -files /data/data/com.matchi.tool/files -hash sendat=<sha256> -hash curl=<sha256>
    matchi-doctor -router 192.168.1.1 -skip at,router

Flags: `-files` and `-hash name=sha256` (repeat for each file; both are needed for the binaries check), `-router` (default
`192.168.0.1`), `-router-ports` (default `8080,80,9090,9999`), `-tls host:port` (off when empty), `-conf` (default
`/data/local/matchitool/sendat.conf`), `-sendat` (default `<files>/sendat`), `-at-timeout` (4 s), `-net-timeout` (2 s), `-skip`
(comma list of `root,selinux,memory,storage,ca,tls,router,at,binaries`), `-pretty`, `-root` (prefix for `/proc`, `/sys`, `/data`,
`/apex`, `/system` and `/dev`, tests only), `-version`.

Exit code: `0` when the report was written (a failed check is in the report, not in the exit code), `2` for a usage error, `1` when
the report could not be written (the reader went away).

## The report

    {"tool":"matchi-doctor 1.0 (MatchiTOOL)","arch":"arm64","generated":1763560000,
     "summary":{"fail":0,"ok":8,"skip":0,"warn":0},
     "checks":[{"id":"root","title":"Root","status":"ok","detail":"running as uid 0","data":{"uid":0}}, ...]}

Every check has `id`, `title`, `status` (`ok`, `warn`, `fail`, `skip`, the words the page already uses), `detail` (the sentence to
show), an optional `hint`, and `data` with the same facts as values.

| id | what it looks at | fail | warn |
|----|------------------|------|------|
| `root` | the user id | not uid 0 | |
| `selinux` | `/sys/fs/selinux/enforce` (Permissive and Enforcing are both ok; Enforcing adds a hint) | | unreadable or odd value |
| `memory` | `MemAvailable` / `MemTotal` | under 5 % free | under 10 % free |
| `storage` | `/data` space and inodes (rounded up like `df`), mount options | mounted read-only | 95 % used or more |
| `ca` | the certificates in `/apex/com.android.conscrypt/cacerts`, else `/system/etc/security/cacerts`; the curl bundle | none readable, no folder | fewer than 20 |
| `tls` | only with `-tls`: a handshake that trusts the certificates above and nothing else | the certificate is rejected (unknown authority, expired, wrong name) | no connection |
| `router` | HTTP `GET /` on the router, ports in order; any HTTP answer counts, also 401 or 404 | | nothing answers, or a port is open without HTTP |
| `at` | `sendat -d <pinned port> -c AT` (or `-n 0` when nothing is pinned) | no `sendat`, no OK, timeout, pinned port missing | pinned port is held by another process: not touched |
| `binaries` | SHA-256 of each `-hash` file in `-files`; all-zero files are named | missing, zero-filled or a different hash | |

Things that look odd and are on purpose:
- **Slot 1 is not tested.** The F50 has one SIM slot, and `sendat -n 1` used to write to `/dev/stty_nr1`, which the RIL (`urild`) reads.
  The page's own "AT command, SIM slot 1" check is therefore the one line the doctor does not repeat.
- **A held port is reported, not probed.** The rules are the ones in `tools/sendat` (`/proc/<pid>/fd` says who holds a port; a
  `sendat` does not count; `stty_nr0..5` are urild's, `nr28` and `nr31` are other root services). They are copied here because the two
  programs are separate until Phase 8 merges them.
- **The TLS check uses the device store only.** Go is given the certificates it read from the folder and nothing else, so the result
  is the same as curl with `CURL_CA_BUNDLE` set to that store. The unknown-CA failure curl showed before the CA fix would show here
  as `fail`; a missing network shows as `warn`, not as a CA problem.
- **It reports `skip` for what it cannot do**, for example `tls` when the CA store could not be read, and `binaries` without `-hash`.

## Tests
`go test ./...` builds a fake `/proc`, `/sys`, `/data` and `/dev` in a temporary folder with values read on a ZTE F50 (MU300,
Android 13, 19 Nov 2026), runs the checks against it and against loopback servers (a plain HTTP server for the router, a TLS server
for the handshake), and uses a fake `sendat` for the modem. It covers every status of every check, a port held by `urild` and by
another `sendat`, the pinned and the unpinned call, damaged files (missing, zero-filled, a different hash), the command line, and
the one-line output.

## Put it in the repo
    tools/doctor/{go.mod,main.go,checks.go,main_test.go,README.md}
    .github/workflows/build-doctor.yml
Run the workflow, download `matchitool-doctor-arm64`, test it on the F50 (below) **before** copying it to
`app/src/main/assets/bin/matchi-doctor` and writing its SHA-256 into `NOTICE.md`, `docs/BINARIES.md` and `BinaryHashes.kt`
(`scripts/gen_binary_hashes.py`). The app does not call it until that second step.

## Test on the F50
    adb push matchi-doctor /data/local/tmp/ && adb shell chmod 755 /data/local/tmp/matchi-doctor
    su -c '/data/local/tmp/matchi-doctor -version'                     # matchi-doctor 1.0 (MatchiTOOL)
    su -c '/data/local/tmp/matchi-doctor -pretty -files /data/data/com.matchi.tool/files -tls example.com:443'
    su -c '/data/local/tmp/matchi-doctor -pretty | head -c 300'        # must exit quietly when the reader closes

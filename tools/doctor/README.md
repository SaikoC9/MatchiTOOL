# matchi-doctor (own build)

One read-only command that collects what "Full diagnose" needs and prints JSON. It starts no shell and changes nothing: no file written, no setting touched. The only thing sent to the modem is a plain `AT` via `sendat`.

    matchi-doctor                                   # root, SELinux, memory, /data, CA store, router, modem
    matchi-doctor -pretty                           # indented
    matchi-doctor -tls example.com:443              # also a TLS handshake against the device's CA store
    matchi-doctor -files /data/data/com.matchi.tool/files -hash sendat=<sha256> -hash curl=<sha256>
    matchi-doctor -router 192.168.1.1 -skip at,router

Flags: `-files` and `-hash name=sha256` (repeat per file; both needed for the binaries check), `-router` (192.168.0.1), `-router-ports` (8080,80,9090,9999), `-tls host:port` (off if empty), `-conf` (`/data/local/matchitool/sendat.conf`), `-sendat` (`<files>/sendat`), `-at-timeout` (4 s), `-net-timeout` (2 s), `-skip` (comma list of `root,selinux,memory,storage,ca,tls,router,at,binaries`), `-pretty`, `-root` (prefix for `/proc`, `/sys`, `/data`, `/apex`, `/system`, `/dev`; tests only), `-version`.

Exit: `0` report written (a failed check is in the report, not the exit code), `2` usage error, `1` report could not be written (reader went away).

## The report

    {"tool":"matchi-doctor 1.0 (MatchiTOOL)","arch":"arm64","generated":1763560000,
     "summary":{"fail":0,"ok":8,"skip":0,"warn":0},
     "checks":[{"id":"root","title":"Root","status":"ok","detail":"running as uid 0","data":{"uid":0}}, ...]}

Each check has `id`, `title`, `status` (`ok`, `warn`, `fail`, `skip`), `detail` (sentence to show), optional `hint`, and `data` (same facts as values).

| id | Looks at | fail | warn |
|----|----------|------|------|
| `root` | user id | not uid 0 | |
| `selinux` | `/sys/fs/selinux/enforce` (Permissive and Enforcing both ok; Enforcing adds a hint) | | unreadable or odd value |
| `memory` | `MemAvailable` / `MemTotal` | under 5 % free | under 10 % free |
| `storage` | `/data` space and inodes (rounded up like `df`), mount options | mounted read-only | 95 % used or more |
| `ca` | certificates in `/apex/com.android.conscrypt/cacerts`, else `/system/etc/security/cacerts`; the curl bundle | none readable, no folder | fewer than 20 |
| `tls` | only with `-tls`: handshake trusting only the certificates above | certificate rejected (unknown authority, expired, wrong name) | no connection |
| `router` | HTTP `GET /` on the router, ports in order; any HTTP answer counts (also 401, 404) | | nothing answers, or a port open without HTTP |
| `at` | `sendat -d <pinned port> -c AT` (or `-n 0` if none pinned) | no `sendat`, no OK, timeout, pinned port missing | pinned port held by another process: not touched |
| `binaries` | SHA-256 of each `-hash` file in `-files`; all-zero files are named | missing, zero-filled or different hash | |

Odd but on purpose:

- **Slot 1 is not checked.** The F50 has one SIM slot, and `sendat -n 1` used to write to `/dev/stty_nr1`, which the RIL (`urild`) reads. The page's "AT command, SIM slot 1" check is the one line the doctor does not repeat.
- **A held port is reported, not probed.** Rules match `tools/sendat` (`/proc/<pid>/fd` shows the holder; a `sendat` does not count; `stty_nr0..5` are urild's; `nr28` and `nr31` are other root services). Copied here because the two programs stay separate until Phase 8.
- **The TLS check uses the device store only.** Go gets the certificates read from the folder and nothing else, matching curl with `CURL_CA_BUNDLE` set to that store. The old unknown-CA failure shows as `fail`; no network shows as `warn`, not a CA problem.
- **`skip`** is reported for what it cannot do, e.g. `tls` when the CA store was unreadable, `binaries` without `-hash`.

## Put it in the repo

    tools/doctor/{go.mod,main.go,checks.go,main_test.go,README.md}
    .github/workflows/build-doctor.yml

Run the workflow, download `matchitool-doctor-arm64`, copy to `app/src/main/assets/bin/matchi-doctor` and writing the SHA-256 into `NOTICE.md`, `docs/BINARIES.md` and `BinaryHashes.kt` (`scripts/gen_binary_hashes.py`). The app does not call it until that second step.

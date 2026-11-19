# matchi-sampler (own build)

Prints one line per second for the Live panel: CPU rows, core speeds, temperatures, load, uptime and memory. It replaces the
shell loop in `LiveSampler.kt` (`LiveScript.body`) with one small program that starts no child process per round.
It prints **the same line**, so the Kotlin parser does not change.

    matchi-sampler                       # 3600 lines, one per second, then it exits (the app starts a new reader)
    matchi-sampler -rounds 1             # one line, for a quick look
    matchi-sampler -sleep 2 -sys-every 10

Flags: `-rounds` (default 3600), `-sleep` seconds (default 1), `-sys-every` (default 5; `0` = never read load/uptime/memory),
`-root` (prefix for `/proc` and `/sys`, tests only), `-version`.

Line format (sections `|`, entries `;`, a leading `;` is normal, `s:` is empty on rounds that skip it):

    @L1|c:;cpu 1 2 ..;cpu0 ..|f:;0 1 614400 2002000;..|z:;soc-thmzone=59963;..|s:8.28 8.21 8.22 6088.68 1503044 616768

## Same rules as the shell loop (on purpose)
- At most 16 thermal zones, in the order of a shell glob (`thermal_zone0, thermal_zone1, thermal_zone10, ...`).
- A zone whose `temp` cannot be read is skipped and does not count (the F50 has two: `osctsen`, `outtsen`).
- A zone type that is empty or has a character outside `[A-Za-z0-9_.-]` is named `zone<N>`.
- The highest core comes from `cpu/possible` (text after the last `-` or `,`), 7 when unreadable, at most 15.
- When the app goes away the next write fails and the program exits. Nothing keeps running as root.

## Tests
`go test ./...` uses values read on a ZTE F50 (MU300, Android 13, 2026-11-19): `TestF50Golden` rebuilds that `/proc` and `/sys`
and compares the whole line. The other tests cover the zone cap and names, `possible`, offline and missing cores, and missing files.
It was also checked against the real shell loop: the loop text taken from `LiveSampler.kt`, run on the same files, printed the same
six lines byte for byte.

## Put it in the repo
    tools/sampler/{go.mod,main.go,main_test.go,README.md}
    .github/workflows/build-sampler.yml
Run the workflow, download `matchitool-sampler-arm64`, test it on the F50 (below) **before** copying it to
`app/src/main/assets/bin/matchi-sampler` and writing the SHA-256 into `NOTICE.md`, `docs/BINARIES.md` and `BinaryHashes.kt`
(`scripts/gen_binary_hashes.py`). The app does not use it until the setting is switched on (next step of Phase 4).

## Test on the F50
    adb push matchi-sampler /data/local/tmp/ && adb shell chmod 755 /data/local/tmp/matchi-sampler
    su -c '/data/local/tmp/matchi-sampler -version'                 # matchi-sampler 1.0 (MatchiTOOL)
    su -c '/data/local/tmp/matchi-sampler -rounds 3 -sleep 1'        # three @L1 lines, the first with s: filled
    su -c '/data/local/tmp/matchi-sampler -rounds 1 | head -c 200'   # the program must exit quietly when the reader closes

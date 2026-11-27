# matchi-sampler (own build)

Prints one line per second for the Live panel: CPU rows, core speeds, temperatures, load, uptime, memory. Replaces the shell loop in `LiveSampler.kt` (`LiveScript.body`) with one small program that starts no child process per round. It prints **the same line**, so the Kotlin parser is unchanged.

    matchi-sampler                  # 3600 lines, one per second, then exits (the app starts a new reader)
    matchi-sampler -rounds 1        # one line, quick look
    matchi-sampler -sleep 2 -sys-every 10

Flags: `-rounds` (3600), `-sleep` s (1), `-sys-every` (5; `0` = never read load/uptime/memory), `-root` (prefix for `/proc` and `/sys`, tests only), `-version`.

Line format (sections `|`, entries `;`, a leading `;` is normal, `s:` empty on rounds that skip it):

    @L1|c:;cpu 1 2 ..;cpu0 ..|f:;0 1 614400 2002000;..|z:;soc-thmzone=59963;..|s:8.28 8.21 8.22 6088.68 1503044 616768

## Same rules as the shell loop (on purpose)

- Max 16 thermal zones, in shell-glob order (`thermal_zone0, thermal_zone1, thermal_zone10, ...`).
- A zone whose `temp` cannot be read is skipped and not counted (the F50 has two: `osctsen`, `outtsen`).
- An empty zone type, or one with a character outside `[A-Za-z0-9_.-]`, is named `zone<N>`.
- Highest core comes from `cpu/possible` (text after the last `-` or `,`); 7 if unreadable; max 15.
- When the app goes away the next write fails and the program exits. Nothing keeps running as root.

## Put it in the repo

    tools/sampler/{go.mod,main.go,main_test.go,README.md}
    .github/workflows/build-sampler.yml

Run the workflow, download `matchitool-sampler-arm64`, copy to `app/src/main/assets/bin/matchi-sampler` and writing the SHA-256 into `NOTICE.md`, `docs/BINARIES.md` and `BinaryHashes.kt` (`scripts/gen_binary_hashes.py`). The app uses it only when "Fast sampler" is on under Live device status (`LiveEngine.kt`, `LiveEngineSetting.kt`). If it gives no readings twice in a row, the app falls back to the shell loop.

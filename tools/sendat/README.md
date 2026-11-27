# sendat

Replaces the UFI-TOOLS `sendat` (UPX-packed Go, no recorded source). Same call:

    sendat -n <0|1> -c '<AT command>'

Extras: `-d /dev/xxx` force a port, `-t 8` reply timeout (s), `-probe` find the AT port, `-probe -all` also try ports other processes hold.

Output: echoed command and blank lines removed, `\n` endings, final `OK`/`ERROR` kept. Exit: 0 OK, 1 ERROR or bad usage, 3 timeout.

## Put it in the repo

    tools/sendat/{go.mod,main.go,main_test.go}
    .github/workflows/build-sendat.yml

Run the workflow, download `matchitool-sendat-arm64`, copy `sendat` to `app/src/main/assets/bin/sendat`, update the SHA-256 in `NOTICE.md` and `docs/BINARIES.md`.

## What `-probe` leaves alone

On the F50, `stty_nr0..5` belong to `urild` (the RIL), `stty_nr28` to `cplog_svc`, `stty_nr31` to `engpc`. Writing `AT` to a port the RIL reads can confuse it; after a probe plus radio restart the F50 once lost mobile data.

`-probe` skips a port when `/proc/<pid>/fd` shows another process holding it (another `sendat` does not count) or when it is one of the ports above. Skipped ports are listed with the reason. `-probe -all` tries them anyway; expect to toggle mobile data afterwards. Run `-probe` as root, or `/proc` hides other users' descriptors and only the fixed list protects the RIL.

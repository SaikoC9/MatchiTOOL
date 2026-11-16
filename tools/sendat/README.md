# sendat (own build)

Replaces the UFI-TOOLS `sendat` binary (UPX-packed Go, no recorded source). Same call:

    sendat -n <0|1> -c '<AT command>'

Extras: `-d /dev/xxx` (force a port), `-t 8` (reply timeout, seconds), `-probe` (find the AT port).

Output: echoed command and blank lines removed, `\n` line endings, final `OK`/`ERROR` line kept.
Exit code: 0 OK, 1 ERROR / bad usage, 3 timeout.

## Put it in the repo
    tools/sendat/{go.mod,main.go,main_test.go}
    .github/workflows/build-sendat.yml
Run the workflow, download `matchitool-sendat-arm64`, copy `sendat` to `app/src/main/assets/bin/sendat`,
update the SHA-256 in `NOTICE.md` and `docs/BINARIES.md`.

## First test on the device (as root)
    adb push sendat /data/local/tmp/ && adb shell chmod 755 /data/local/tmp/sendat
    su -c '/data/local/tmp/sendat -probe'
    su -c '/data/local/tmp/sendat -n 0 -c AT+CGSN'
Pin the port the probe finds in `/data/local/matchitool/sendat.conf` (`0=/dev/...`, `1=/dev/...`).
The built-in device list is a guess, not taken from the old binary.

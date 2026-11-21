# matchi-guard

Keeps plugin processes from taking over the CPU. Go, standard library only, one static arm64 binary (about 2 MB).
Not started by the app yet: it is off until phase 4 wires it in. Design and limits: [DESIGN.md](DESIGN.md).

```
matchi-guard run   --plugin NAME [--wall S] [--cpu S] [--mem MB] [--procs N] [--nice N] [--shares N] [--report FILE] -- command [args...]
matchi-guard watch [--interval 30] [--rounds N] [--report FILE] [--budget NAME=PCT,...] [--default-budget 80]
                   [--helper-max 20] [--action throttle|freeze|kill] [--no-cgroup]
matchi-guard size  [--timeout 8] [--max-entries N] PATH
matchi-guard version
```

Exit codes of `run`: the command's own code; `124` when a limit stopped it; `127` cannot start; `2` bad arguments.

## Test on the phone (as root)

```
cp matchi-guard /data/local/tmp/ && chmod 755 /data/local/tmp/matchi-guard
G=/data/local/tmp/matchi-guard
$G version
$G size /data/local/tmp                                   # KB, like du -skx
$G run --plugin T --wall 3 -- sh -c 'while :; do :; done'  # stops after 3 s, exit 124
$G watch --rounds 3 --interval 5 --report /data/local/tmp/g.json; cat /data/local/tmp/g.json
```
`scan_ms` in the report is the measured cost of one /proc sweep on the device.

## Build

`.github/workflows/build-guard.yml` runs `go vet`, `go test` and builds with
`CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags "-s -w"`.

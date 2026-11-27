# matchi-guard

Keeps plugin processes from taking over the CPU. Go, standard library, one static arm64 binary (about 2 MB). The app starts it from the Plugin guard card on the home page (off by default) in `watch` mode only; the host does not use `run` yet. Design and limits: [DESIGN.md](DESIGN.md).

```
matchi-guard run   --plugin NAME [--wall S] [--cpu S] [--mem MB] [--procs N] [--nice N] [--shares N] [--report FILE] -- command [args...]
matchi-guard watch [--interval 30] [--rounds N] [--report FILE] [--budget NAME=PCT,...] [--default-budget 80]
                   [--helper-max 20] [--action throttle|freeze|kill] [--no-cgroup]
matchi-guard size  [--timeout 8] [--max-entries N] PATH
matchi-guard version
```

`run` exit codes: the command's own; `124` a limit stopped it; `127` cannot start; `2` bad arguments.

## Build

`.github/workflows/build-guard.yml` builds with `CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags "-s -w"`.

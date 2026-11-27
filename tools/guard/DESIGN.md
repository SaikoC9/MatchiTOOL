# matchi-guard design

## Facts it rests on (MU300, measured)

- cgroup v1 `cpu` (`/dev/cpuctl`), `memory` (`/dev/memcg`), `freezer` (`/dev/cpufreezer`). Root can create groups and write `cpu.shares`.
- No `cpu.cfs_quota_us`: **no hard CPU percentage cap.** `cpu.uclamp.max` limits frequency, not CPU time; unused.
- Reading `/proc/PID/cmdline` can fail to reach EOF on this kernel. The guard never reads cmdline and never reads to EOF.
- SELinux permissive, full root capabilities, no seccomp: namespaces possible later (phase 6).

## Commands

| Command | Job |
|---|---|
| `run` | Starts one plugin command in its own process group with `MATCHI_PLUGIN=NAME`. Enforces wall time, group CPU time, group RSS, process count, nice, optional cgroup shares / memory limit |
| `watch` | Each interval: one /proc sweep, CPU per plugin tag, stuck-helper reaping, throttling of plugins over budget, JSON report |
| `size` | `du -skx` equivalent with deadline and entry cap |

## Limits and actions

- `run`: on a breach the group gets TERM, 2 s grace, then KILL. One JSON line to stderr (and `--report`). Exit 124. Leftovers are NOT killed when the command ends normally (plugins start daemons that must live on). Processes that leave the group (`setsid`) escape `run`'s limits; `watch` still sees them by tag.
- `watch` budget = percent of ONE core (800 = all 8), default 80.
  - 2 rounds over: throttle = nice 19 + cgroup `cpu.shares` 2 for the plugin's tagged processes. New processes of a throttled plugin are added each round.
  - 2 calm rounds: release (nice 0, shares 1024).
  - 6 rounds over: only with `--action freeze` (freezer group, thawed after 2 rounds) or `--action kill` (the plugin's tagged processes). Default is throttle only: it never kills a plugin daemon unless told to.
- Stuck helpers: `tr du grep cat awk cut find`, owned by a plugin (tagged, or tagged ancestor within 6 steps), older than `--helper-max`, with CPU time >= 25% of age, get SIGKILL. `sleep` is not reaped (uses no CPU).
- The first round sets the baseline only; nothing is judged on it.

## Safe-kill rules (`kill.go`)

1. A process is PID + start time. The start time is re-read right before the signal; a mismatch means PID reuse and nothing is sent.
2. Never PID 1, PID 2, kernel threads (parent 2) or the guard itself.
3. Signals go to single measured processes, never to `-1` or an unmeasured group.
4. Only listed helpers and processes with a valid `MATCHI_PLUGIN` tag (or owned by one). System processes carry no tag.

## Bounded reads (`proc.go`)

`/proc/PID/stat`: one read, 1 KB cap. `environ`: 16 KB cap, 300 ms deadline. `uptime`: 64 bytes. No read loops to EOF. A sweep makes a few hundred small allocations; a process's tag is cached by PID + start time, so `environ` is read once per process.

## JSON report (v1), replaced atomically each round

```
{"v":1,"ts":unix,"interval_s":30,"round":N,"scan_ms":M,"procs_seen":N,
 "plugins":[{"name","cpu_pct","budget_pct","rss_kb","procs","state":"ok|throttled|frozen|killed","strikes"}],
 "actions":[{"ts","what":"throttle|release|freeze|thaw|kill|kill-helper","plugin","pid","comm","why"}]}   (last 20)
```

## Not covered

Processes started outside the launcher with their tag cleared; harmful low-CPU behaviour; confinement of what a root plugin may do (phase 6); short-lived processes that exit between two sweeps (only `run`'s group limits see those).

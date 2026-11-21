# matchi-guard design

## Facts it is built on (MU300, measured)
- cgroup v1 `cpu` (`/dev/cpuctl`), `memory` (`/dev/memcg`), `freezer` (`/dev/cpufreezer`); root can create groups and write `cpu.shares`.
- No `cpu.cfs_quota_us`: **no hard CPU percentage cap exists.** `cpu.uclamp.max` is accepted but limits frequency, not CPU time; unused.
- Reading `/proc/PID/cmdline` can fail to reach end-of-file on this kernel. The guard never reads cmdline and never reads to EOF.
- SELinux permissive, full root capabilities, no seccomp: namespaces are possible later (phase 6).

## Commands
| Command | Job |
|---|---|
| `run` | Starts one plugin command in its own process group with `MATCHI_PLUGIN=NAME`, and enforces wall time, group CPU time, group memory (RSS), process count, nice, and optional cgroup shares / memory limit. |
| `watch` | Every interval: one /proc sweep, CPU per plugin tag, stuck-helper reaping, throttle of plugins over budget, JSON report. |
| `size` | `du -skx` equivalent with a deadline and entry cap. |

## Limits and what happens
- `run`: on a breach the group gets TERM, 2 s grace, then KILL. One JSON line goes to stderr (and `--report`). Exit code 124.
  Leftover processes are NOT killed when the command ends normally (plugins start daemons that must live on).
- Processes that leave the group (setsid) are outside `run`'s limits; `watch` still sees them through the tag.
- `watch` budget = percent of ONE core (800 = all 8). Default 80.
  - 2 rounds over budget: throttle = nice 19 + cgroup `cpu.shares` 2 for that plugin's tagged processes. New processes of a throttled plugin are added each round.
  - 2 calm rounds: release (nice 0, shares 1024).
  - 6 rounds over budget: only if `--action freeze` (freezer group, thawed after 2 rounds) or `--action kill` (tagged processes of that plugin). Default is throttle only: the guard never kills a plugin daemon unless told to.
- Stuck helpers: `tr du grep cat awk cut find`, owned by a plugin (tagged, or a tagged ancestor within 6 steps), older than `--helper-max` and with CPU time >= 25% of their age, get SIGKILL. `sleep` is not reaped: it uses no CPU.
- The first round only sets the baseline; nothing is judged on it.

## Safe-kill rules (kill.go)
1. A process is PID + start time. The start time is read again right before the signal; a mismatch means PID reuse and nothing is sent.
2. Never PID 1, PID 2, kernel threads (parent 2) or the guard itself.
3. Signals go to single measured processes, never to `-1` or an unmeasured group.
4. Only listed helpers and processes carrying a valid `MATCHI_PLUGIN` tag (or owned by one) can be touched. System processes carry no tag.

## Bounded reads (proc.go)
`/proc/PID/stat`: one read, 1 KB cap. `environ`: 16 KB cap and a 300 ms deadline. `uptime`: 64 bytes. No read loops to EOF.
Memory: a few hundred small allocations per sweep; the tag of a process is cached by PID + start time, so `environ` is read once per process.

## JSON report (v1), replaced atomically every round
```
{"v":1,"ts":unix,"interval_s":30,"round":N,"scan_ms":M,"procs_seen":N,
 "plugins":[{"name","cpu_pct","budget_pct","rss_kb","procs","state":"ok|throttled|frozen|killed","strikes"}],
 "actions":[{"ts","what":"throttle|release|freeze|thaw|kill|kill-helper","plugin","pid","comm","why"}]}   (last 20)
```

## Not covered
Processes started outside the launcher with their tag cleared; wrong behaviour that uses little CPU; confinement of what a root plugin may do (phase 6); exited short-lived processes between two sweeps (only the group limits of `run` see those).

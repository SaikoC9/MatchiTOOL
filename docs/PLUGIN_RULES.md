# Plugin rules

For 1.4.6. Rules for plugin code that runs as root on the MU300 (8 cores, 1.5 GB RAM). Each rule comes from a measured fault.

Lint your plugin before install:

```sh
python3 scripts/lint_resource_rules.py --plugin MyPlugin.js plugins_folder/
```

Exit code 1 on any ERROR. Silence a finding with `lint-ok: <reason>` on the same line (reason required). The lint checks rules 1, 2, 4, 5, 6 and warns on 3.

## Rules

1. **Size checks: `du -x` under `timeout`.** Without `-x`, `du` walked `/proc` and `/sys` in an OpenWrt rootfs and held a core at 100% for about 4 s. Use `timeout 8 du -skx -- "$path"`. Use `find ... -xdev` or `-maxdepth` the same way.
2. **Never read `/proc/PID/cmdline` with `grep`, `cat` or `tr`.** On this kernel the read never hits EOF and `tr` spins at 100%. Use `ps -A -o PID,ARGS`.
3. **Declare mounts in your data folder.** If a plugin mounts `proc`, `sys`, `dev` or `tmp` there, say so in its description and unmount on stop.
4. **Every loop sleeps or blocks.** `while true` needs `sleep`, a blocking `read` or a `break`. Watchers: 5 s minimum between rounds.
5. **Timers: 1 s minimum; 30 s or more if the timer runs a command.** Skip work when the tab is hidden.
6. **No timer calls an expensive route.** Routes marked `@expensive-route` (`/api/plugins/data`, `/api/plugins/state`) run `du` or a process scan as root. Call them from a user action. The one allowed timer runs every 2 min and skips hidden tabs.
7. **Start long commands through the guard:** `matchi-guard run --plugin NAME --wall SECONDS -- cmd`. It tags the process, limits time and ends the process group. Untagged processes are invisible to it.
8. **Do not clear the environment** (`env -i`, `unset MATCHI_PLUGIN`). The guard counts CPU per tag.

## What the guard does

Every 30 s it reads `/proc`, sums CPU per plugin tag, lowers priority of plugins over budget and ends stuck helpers (`tr`, `du`, `grep`, `cat`, `sleep`, `awk`, `cut`).

It cannot set a hard CPU cap (no CFS bandwidth control on this kernel). It cannot see harmful low-CPU behaviour, such as a wrong firewall rule.

## Enforcement

| Rule | Check |
|---|---|
| 1, 2, 4, 5, 6 | `scripts/lint_resource_rules.py` (in `validate.sh` and CI) |
| 3 | lint warning only |

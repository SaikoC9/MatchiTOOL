# Plugin rules

Current for 1.4.5. Rules for plugin code that runs as root on the MU300 (8 cores, 1.5 GB RAM). Each rule comes from a measured fault. `scripts/lint_resource_rules.py` checks rules 1, 2, 4, 5 and 6, and warns on rule 3.

Check your own plugins before you install them:

```sh
python3 scripts/lint_resource_rules.py --plugin MyPlugin.js plugins_folder/
```

The exit code is 1 on any ERROR. A finding is silenced only by `lint-ok: <reason>` on the same line. The reason is required.

## Rules

1. **Size checks use `du -x` under `timeout`.** `du` without `-x` follows mounts. Inside an OpenWrt rootfs it walked `/proc` and `/sys` and held one core at 100% for about 4 s. Use `timeout 8 du -skx -- "$path"`. Use `find ... -xdev` or `-maxdepth` the same way.
2. **Never read `/proc/PID/cmdline` with `grep`, `cat` or `tr`.** On this kernel the read does not reach end of file and `tr` stays at 100% CPU. Read the command lines from `ps -A -o PID,ARGS`.
3. **Declare mounts in your data folder.** A plugin that mounts `proc`, `sys`, `dev` or `tmp` inside its data folder must say so in its description, and must unmount on stop. The host sizes the folder with `du -x`, so it does not walk the mounts, but other tools do.
4. **Every loop sleeps or blocks.** `while true` needs `sleep`, a blocking `read`, or a `break`. Use at least 5 s between rounds for a watcher.
5. **Timers: 1 s minimum, 30 s or more for anything that runs a command.** Skip the work when the tab is hidden.
6. **No timer calls an expensive route.** Routes tagged `@expensive-route` in the host source (`/api/plugins/data`, `/api/plugins/state`) run `du` or a process scan as root. Call them from a user action. The one timer that uses `/api/plugins/state` runs every 2 min and skips hidden tabs.
7. **Start long-running commands through the guard.** `matchi-guard run --plugin NAME --wall SECONDS -- cmd` tags the process, limits its time and ends the whole process group. A process without the `MATCHI_PLUGIN` tag is invisible to the guard.
8. **Do not clear the environment** of your processes (`env -i`, `unset MATCHI_PLUGIN`). The guard counts CPU per tag.

## What the guard does and does not do

It reads `/proc` every 30 s, sums CPU per plugin tag, lowers the priority of a plugin over its budget, and ends stuck helpers (`tr`, `du`, `grep`, `cat`, `sleep`, `awk`, `cut`). It cannot set a hard CPU percentage: this kernel has no CFS bandwidth control. It does not see wrong behaviour that uses little CPU, such as a wrong firewall rule.

## Where it is enforced

| Rule | Check |
|---|---|
| 1, 2, 4, 5, 6 | `scripts/lint_resource_rules.py` (runs in `scripts/validate.sh` and CI); cases in `scripts/test_lint_resource_rules.py` |
| 3 | lint warning (not a failure) |
| Host size probe | `PluginProbeTest.kt`: `du -skx`, `timeout 8`, 10 s cache, `clear()` forces a run |
| Host process scan | `PluginSweepTest.kt`: the `cmdline` + `tr` read is forbidden |

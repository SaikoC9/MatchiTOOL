# Stopping what a plugin started (author guide)

Current for MatchiTOOL 1.4.4.

What has been checked. "CI" is the GitHub Actions run (Validate, Unit tests, Build debug and release).

- **Header lines** (`@matchi-uninstall`, `@matchi-check`, `@matchi-boot`, the plan, the shared-folder guard and "a failed stop keeps the plugin") were run on the F50, including a real delete of Bypass v65_17.
- **The process sweep** (see "Plugins without headers: the process sweep") is compiled and unit-tested in CI. On 13 Nov 2026 it was also run on the F50 with test plugins:
  - a process found by its tag, and one that ignores SIGTERM;
  - a watchdog that respawns, and the sweep not killing itself or the root session;
  - root off (plugin kept) and the 60 second limit (plugin kept);
  - a sandboxed plugin's tagged command, and a Bypass copy with and without headers.
- **The sandbox stop hook** was first run on the F50 on 14 Nov 2026 (1.4.2 build). A working hook ended its job and the plugin was deleted. A hook that never finished kept the plugin after 15 s.
- **Undoing firewall chains and boot scripts, and "Turn off and stop"** (the two sections below about undoing and Turn off and stop) are compiled and unit-tested in CI. The pure logic and the generated shell scripts were also tested on a PC, and the page by node tests. They were run on the F50 too: Bypass without headers, a reboot, two copies sharing one chain, boot files of other plugins and system chains. The per-test results were not written down. The no-root and timeout path was **not run** on the device, so how the undo behaves without root or when time runs out is covered by unit tests only.

Deleting a plugin removes its file and its data. On its own it does **not** stop a background process, remove a firewall rule or take out a boot-script line the plugin created, because MatchiTOOL cannot know about them. A plugin can say how to stop them with header lines. For a plugin that says nothing, MatchiTOOL looks for processes (the sweep, below) and undoes the firewall chains and boot scripts it saw the plugin create (see "Undoing what a plugin left in the system"). When the person deletes the plugin, the Delete dialog lists these commands word for word and, after the root gate and the sign-in password, runs them as root. Deleting a plugin or switching it off also closes its web gate, if it declared one (see `docs/PLUGIN_GATE.md`).

## The header lines

Each on a line of its own, starting with `//`, inside the **first 400 lines** of the file. A line that only mentions a header inside code is not a header.

| line | meaning |
| --- | --- |
| `// @matchi-uninstall COMMAND` | A root shell command run on delete, in file order. At most 10, at most 300 characters each, no control characters, duplicates dropped. |
| `// @matchi-check COMMAND` | One command that must **exit 0 only when everything is gone**. Without a check or a boot file the stop can never report success. |
| `// @matchi-boot /path` | A boot file the plugin creates (plain absolute path, letters, digits `. _ - /`). After the commands it is tested that the file is gone. At most 5. |

## What happens

1. The Delete dialog shows the plan. The plan is the commands exactly as they will run (exactly the text that runs; nothing is rewritten), then the check command.
2. The commands run in order inside **one 60 second total**. A failed command does not stop the rest. Nothing is retried.
3. Then the check command and the boot file test run, with what is left of the 60 seconds.
4. Only if every command exited 0, the check passed and no boot file is left, the plugin and its data are deleted. Otherwise the plugin is **kept**, the report is shown, and the person can try again, delete without stopping, or restart the device when only running leftovers remain.

## Rules for good commands

- **Harmless if run twice.** A command may run again after a failed attempt, and the plugin may never have started anything. Guard with `[ ! -f FILE ] || sh FILE stop`.
- **Boot entry first, then stop the running part.** Otherwise a reboot between the two brings it back.
- **Shared folders: `rmdir`, never `rm -rf`.** Remove a folder that only your plugin uses with `rm -rf`; a folder other plugins may use with `rmdir FOLDER 2>/dev/null || true`.
- **One thing per command**, so the dialog stays readable and a failure names what failed.
- Commands pass the same filter as plugin shell commands (no wiping of `/`, `/data`, `/sdcard`, no `dd` to devices, and so on). A refused command makes the whole stop fail and is listed with its reason.
- **Sandboxed plugin:** every command (and the check) must also be granted with `// @matchi-needs shell: COMMAND` with exactly the same text, inside the first **80** lines, and approved. Otherwise it is refused.
- **Changing the headers changes the file.** An update that adds a command asks the person again, and a file that differs from the approved one cannot stop anything until it is approved again.
- The check should test **what you started**: a process (`ps -A -o ARGS | grep -v grep | grep -q NAME`), a firewall chain, a pid file, a folder. Do not make it test things other plugins may have created.

## Two plugins, one folder

If another installed plugin declares the same command or boot file, the dialog warns and skips the stop by default (so "install a new copy under a new name, then delete the old one" does not break the new copy). The person can still choose "Delete and stop anyway".

## Replacing a plugin

Installing a file under the **same name** never runs the stop; only Delete does.

## Example

`docs/examples/Stop_Example.js` starts a small background job and a boot entry and declares how to stop both. To try it, install it, then delete it with **Delete and stop** and check that the job and the boot entry are gone.

## Plugins without headers: the process sweep

A plugin that declares nothing can still have started something. So when the person deletes it, MatchiTOOL looks for processes the plugin started and offers to end them. This needs root (the same root gate and sign-in password as the header stop), and it only ever ends what the dialog showed. The list of running processes is read only when the root gate lets the request through (sign-in under 4 h, HTTP rules). On a session older than that the dialog still shows the plan and the undo list, and says that the process part "could not be checked"; nothing is guessed (1.4.2).

### How a process is found

Three ways, strongest first. The dialog says which one found each process.

| found by | meaning |
| --- | --- |
| **tag** | MatchiTOOL adds `export MATCHI_PLUGIN='NAME'; ` in front of every shell command it sees from a plugin (the shell, root shell and user shell routes, and a sandboxed plugin's `matchi.shell`). A process started by such a command, and everything it starts after that, carries `MATCHI_PLUGIN=NAME` in its environment. The scan reads `/proc/PID/environ`. |
| **pidfile** | A `.pid` file that the plugin's recorded commands wrote (for example `echo $! > /x/beat.pid`) holds a PID, and that process's command line still names one of the plugin's own files (or it carries the tag). This stops a reused PID from being picked. The file is read only if it is a plain file (no symlink, no pipe) holding digits. |
| **command line** | The process's command line contains a **file** path the plugin wrote (at least 3 path segments, not under `/system`, `/vendor`, `/apex`, `/proc`, `/dev`, not a path another installed plugin also uses). This is the weakest match. It is shown first and ended only because it was shown. |

### What the dialog does

- The Delete dialog lists every process that would be ended: PID, command line (cut at 200 characters) and how it was found. Nothing is ended before the person chooses **Delete and stop**.
- It says the stop also ends "everything they started" (the children of a listed process).
- If nothing is found, a plugin without headers is deleted as before and the dialog says that no running process was found for it.
- If root is not available or the scan cannot run, the dialog says the plugin **cannot be checked** and shows no list. Nothing is guessed.
- More than **50** processes found: the stop is not offered, only **Delete without stopping**.
- **Left running on purpose** lists processes that matched but were not ended (see "Two plugins" below, or a protected process).
- **Delete without stopping** never scans for the stop and never ends anything.

### What "Delete and stop" does

1. The host scans again and compares with what the person saw (a hash of PID + start time + command line). If something differs it answers `409 plan-changed`, ends nothing, and the dialog opens again. A process that was not listed before is never ended.
2. The plugin's declared commands (if any) run first, then the sweep.
3. The sweep is one root script, built by the host. Only PID and start time go into it, never text from another process. For each listed process, and the tree below it: freeze the tree (`SIGSTOP`), send `SIGTERM`, let it continue (`SIGCONT`), wait 2 seconds, read the tree again (a respawned child is found), freeze again and send `SIGKILL`. A PID whose start time changed is skipped (the PID was reused).
4. The host scans **again**. Success needs this second scan to have run, to be complete, and to find nothing. A scan that did not run or was cut short is never counted as success. The report then says what could not be checked.
5. If anything is left, the plugin is **kept**, the report lists the leftovers, and the dialog opens again (try again, delete without stopping, or restart the device).

All of it runs inside the same 60 second total as the header stop. The scan itself may take up to 15 seconds and is not part of the 60. The kill step is not started with less than 6 seconds left, so a timeout cannot cut it while processes are frozen. Every kill action is written to `shell_audit.log` as `plugin-sweep`.

### Never touched

PID 1, kernel threads, the MatchiTOOL app process (`com.matchi.tool`), MatchiTOOL's own root sessions, the sweep's own shell and every parent of it. These are fixed in the code and are not configurable.

### Two plugins, one job

The old copy of a plugin may have started a job that the new copy now uses. A process whose command line contains a path another installed plugin also uses is **never ended** and is listed under "Left running on purpose", with the name of the other plugin. This is the same idea as the same-folder guard above. What a left-running process has started is covered too: its children are not listed, not ended and not counted by the scan after the stop, so a process that keeps starting new children (a loop with `sleep 30`) cannot make "Delete and stop" fail. In that case the dialog shows only the one line for the process left running, and no process of the plugin is listed to end.

### What the sweep does NOT catch

Say these plainly to anyone who asks whether deleting a plugin "always" stops it:

- **Not a security boundary.** MatchiTOOL knows a plugin's name only from the page (a trusted plugin's script, best effort) or, for a sandboxed plugin, from the host. A trusted plugin can name any plugin. The sweep protects a person from a **forgetful** plugin, not from a **hostile** one.
- **A process with no tag.** The tag exists only on commands MatchiTOOL saw with a plugin name. A job started before this update, started by a `Request` or eval'd code that lost its name, or started some other way has no tag. It is found only by pidfile or command line.
- **A process that clears its environment** (`env -i`, a double fork that execs with a clean environment) loses the tag. It is found only by pidfile or command line.
- **Services started through Android** (`am startservice`, `start SERVICE`, `setprop` triggers, `cmd`) run under Android's own process, not under the plugin's command. The sweep does not see them. Declare a stop command for these.
- **Pidfile written inside a script the plugin created.** The recorded commands only show paths written in the command text. A pidfile written by a helper script is not known.
- **A renamed binary without a file extension** is missed by the command-line match on purpose (too many false hits otherwise). The command-line match can also match too much; that is why it is shown first.
- **Boot lines, firewall rules, files.** The sweep ends processes only. Firewall chains and `boot.d` scripts the host saw the plugin create are undone by a separate step that runs after the sweep (see "Undoing what a plugin left in the system" below). Everything else (a line in `boot.sh`, a rule added to a system chain without a chain of its own, an eBPF pin, a property) stays: declare it with `@matchi-uninstall` and `@matchi-boot`.
- **A process in uninterruptible sleep** may not end at once; the second scan then lists it and the plugin is kept.

### Example: a plugin with no headers

`docs/examples/No_Headers_Example.js` starts a small background job and declares nothing. On Delete the dialog should list the job "found by tag" and offer **Delete and stop**. (The sweep itself was run on the F50 with other test plugins, see the status list at the top; this example file is not recorded as run.)

## The stop hook (sandboxed plugins only)

A **sandboxed** plugin can run its own stop code when the person chooses "Delete and stop":

```js
matchi.onUninstall(async () => {
  await matchi.shell('pkill -f \'hook_exampl[e]/beat.txt\'; true');   // a command it was granted with @matchi-needs shell:
});
```

- The hook can do only what the plugin was **approved** to do. Every call it makes goes through the same permission check as any other call, so it gains no new power. This is why trusted plugins have no hook: their code is unlisted and runs with the whole page.
- It runs in the plugin's frame **before** the declared commands and the sweep, for at most **15 seconds**.
- The hook's success is **never believed**. After it, the page asks the host to scan again, and only a clean scan allows the delete. A hook that throws, does not finish in 15 seconds, or whose frame is gone **keeps the plugin** (no stop request is sent; the dialog opens again with the reason).
- A process that appears in the scan after the hook and was not listed before is never ended: the dialog opens again.
- A plugin that registered a hook and has nothing else (no commands, nothing found) gets **Delete and stop**, because a plugin whose job the sweep cannot see is exactly the one that needs its own code.
- **Delete without stopping** never runs the hook. A **disabled** plugin never ran in this session, so it has no hook; the sweep still applies to it.
- The host writes the hook's outcome to `shell_audit.log` (`plugin-hook`) for the record. It is never used to decide success.
- A hook that hangs keeps running in its frame until the page is reloaded; the plugin is kept.

Example: `docs/examples/Sandbox_Hook_Example.js`. (The hook itself was run on the F50 with a test plugin, see the status list at the top; this example file is not recorded as run.)

## Undoing what a plugin left in the system

The sweep ends what a plugin **started**. This section is about what it **left behind**: a firewall chain and a boot script. The rule that governs all of it: **MatchiTOOL undoes only what it saw the plugin's own commands create.** It never guesses from a name, never undoes anything another plugin or MatchiTOOL owns, and never touches kernel state.

This needs root (the same root gate as the header stop and the sweep). A plugin that declares `@matchi-uninstall` commands for the same things is not affected: the declared commands run first, and the undo then finds the chain or the file already gone.

### What the host learns, and where it is kept

Every shell command MatchiTOOL sees from a plugin with its name (the shell routes and a sandboxed plugin's `matchi.shell`) is read once for two things, and the result goes into the plugin's **ledger**, a small text file at `plugin_trace/NAME.trace` in the app's files folder (at most 500 lines; when it is full the oldest `P` and `E` lines drop out first, and `C`, `B` and `U` lines only when nothing else is left). The ledger already held written paths (`P`), side-effect words (`E`) and uploads (`U`). Two more line kinds are used for the undo. An old ledger file still reads.

| line | written when the command text contains | example |
| --- | --- | --- |
| `C TABLE CHAIN TOOL` | `iptables` or `ip6tables`, optionally `-t TABLE`, then `-N CHAIN`. Also inside `sh -c`, `su -c`, `timeout`, `nohup` and after `VAR=x`. | `C mangle MY_CHAIN iptables` |
| `B /path` | a write (`>`, `tee`, `cp`, `mv`, ...) to a file **directly** inside `/data/local/matchitool/boot.d`, named like `20-name.sh`. | `B /data/local/matchitool/boot.d/20-bypass-ttl.sh` |

What is never recorded (so it can never be undone):

- A chain with a built-in name (`INPUT`, `OUTPUT`, `FORWARD`, `PREROUTING`, `POSTROUTING`), a chain name with anything but letters, digits, `_` and `-` (at most 28 characters), or a table other than `filter`, `nat`, `mangle`, `raw`, `security`.
- A boot script with a name that does not match `NN-name.sh` (two digits, then letters, digits, `.`, `_`, `-`), in a subfolder, or outside `boot.d`.
- A chain created through a shell variable for the tool (`IPT -N X`), or inside a script file the plugin wrote. The same limit as for written paths: the host only reads command text.

A jump rule (`-A POSTROUTING ... -j CHAIN`) is **not** recorded. The undo finds the jumps itself, at delete time, by reading the live rules. That needs no extra ledger data and cannot go out of date.

### What the dialog shows

The Delete dialog (and the Turn off dialog, below) lists every undo item before anything happens, for example *"the firewall chain MY_CHAIN (iptables, mangle)"* and *"the boot script 20-bypass-ttl.sh"*. It says **"if it is still there"**, because the plan comes from the ledger and does not look at the system; the check afterwards does.

- **Not undone** lists what is kept on purpose, with the reason (see "Two plugins" below), what is not listed because there are too many (more than **20** chains or **10** boot scripts), and, in one line, how many ledger lines were ignored because they were not a valid entry.
- If the stop is blocked, has a refused command, or has too many processes, the dialog says **"The stop does not run, so these stay in the system"** and lists the items.
- If root is missing, the dialog says so; nothing is undone and the plugin is kept.
- The plan comes from the ledger alone. It appears even when the root check cannot run.

The page sends a hash of the items it showed (`undoHash`, a SHA-256 of the sorted item lines; empty when there is nothing). The host rebuilds the plan from the ledger **before** anything runs and answers `409 plan-changed` if the hash differs, so what you saw is what runs. A request without the key (an older page, **Delete without stopping**, the default button for a shared copy) gets no undo at all.

### What "Delete and stop" does with it

The order is: declared commands, process sweep, **undo**, **re-check**, the plugin's own check, then the delete. The undo comes after the sweep so that no watcher is left to add the rules again.

1. **The undo script.** One root script, built by the host. Only names that pass the same safe-name check again go in; **one bad item and nothing runs**. No text from a plugin or from a rule is ever run or evaluated.
   - **Chain.** If the chain is not there: `absent`, nothing touched. Otherwise every rule that **jumps to it** is deleted **by number** (`-D PARENT N`; at most 40 per chain). A rule counts as a jump only when `iptables -S` prints it ending in `-j CHAIN` or `-g CHAIN`, so a comment that contains "-j CHAIN" is never taken. The parent chain (`POSTROUTING`, a system chain) is only read: it loses at most the one rule that jumps to the plugin's chain, and is never flushed or deleted. **If a jump is still there, the chain is not flushed** (a failure). Then the chain is flushed (`-F`), deleted (`-X`) and looked at again. `iptables` and `ip6tables` are separate items, and a chain of the same name in another table is never touched. A missing tool is reported as `notool`. Where `iptables` knows `-w` (a test call with `-w 5` works), every call waits up to 5 seconds for the xtables lock instead of failing at once; where it does not, the calls run as before. If another program holds the lock for the whole 20 seconds, the item is reported as not done and the plugin is kept.
   - **Boot script.** Refused when `boot.d` or its parent is a symlink, when the file is a symlink, is not a regular file, or is not owned by root (uid 0). Otherwise `rm -f`, then look again. Anything in `boot.d` that is not in this plugin's ledger is never named.
2. **Limits.** The undo shares the 60 second total. It is not started with less than **5 seconds** left and runs for at most **20 seconds**. Each item gets one audit line in `shell_audit.log` (`plugin-undo`) **before** the script starts. Nothing is retried. Any answer other than "removed" or "absent" is a leftover, and so is an item the script gave no answer for.
3. **The re-check.** A **separate, read-only** script looks again at every item; it does not believe the undo script. A chain is "absent" only when the **whole** table list (`iptables -t TABLE -S`) was read and has no line creating that chain. A missing tool or an unreadable list counts as **not checked**, never as gone. A boot script counts as still there if the path exists **or** is a dangling symlink. It uses the same `-w 5` rule. A busy lock that `-w` cannot wait out shows as **error** (not checked), never as gone. It is not started with less than 1 second left, runs for at most 15 seconds, and writes one `plugin-undo` audit line.
4. **The report.** The stop reports success only when the undo script answered clean **and** the re-check ran for every item and found nothing. A clean re-check counts as the **check** for those items, so a plugin with no `@matchi-check` can still succeed. With the declared checks, **all** must pass as well. Otherwise the plugin is **kept**, the report lists what is still there, and the dialog opens again (**Try again** lists what it would remove; **Restart device** is not offered while a boot script is left, because that script runs again at the next boot).

On success the toast says how many items are no longer in the system (removed now, or already gone).

### Two plugins, one chain

The same-folder idea again. An item is **kept** (listed under Not undone as "also used by NAME, so it is kept") when another installed plugin:

- has the same ledger entry (a chain with the same table, name and tool; a boot script with the same path), or
- names the chain as a whole word in its `@matchi-uninstall` or `@matchi-check` commands (a stricter rule than the ledger alone: a chain name that is also a plain word in another plugin's commands keeps the chain), or
- lists the boot script with `@matchi-boot` or contains its path in its commands.

So "install a new copy under a new name, then delete the old one" leaves the chain and the boot script for the new copy. When the **last** plugin using them is deleted, they go. Nothing is checked against the plugin's **own** `@matchi-uninstall`.

### Never touched

A chain the plugin did not create is never flushed or deleted: Android's own chains (names starting `tetherctrl`, `bw_`, `fw_`, `oem`, `natctrl`, `st_`, `idletimer`, `clat`, `routectrl`, `wakeup`) are refused by the ledger even when the plugin ran `-N` on one that already existed, and a built-in or system chain it only adds a jump into is never flushed or deleted; the jump rule it added is removed only when it points at a chain this plugin created. A boot script written by another plugin or by MatchiTOOL is never removed. Files outside `boot.d`, folders the ledger did not see (a plugin that creates `/data/local/NAME` through a helper script), eBPF pins under `/sys/fs/bpf`, properties, routes and mounts are left as they are.

## Turn off and stop

Switching a plugin **off** can also stop what it started and undo what it left, **without deleting** the plugin file (its saved data stays unless the plugin's own stop commands remove it). The switch shows **Turn off** and, when there is something to stop, a dialog.

- The page first reads what a stop would do (the same data as Delete). If there is nothing to stop, the plugin is switched off at once, as before, with no dialog.
- Otherwise the dialog lists the commands, the processes and the undo items, with the same wording as Delete, and offers **Turn off and stop** or **Turn off only**. If a command is refused or too many processes were found, only **Turn off without stopping** is offered. For a plugin that is shared with another copy, the default skips the stop and **Turn off and stop anyway** runs it.
- **Turn off and stop** sends the same request as Delete with `keep: true`: the same hashes (plan, sweep, undo), the same order, the same re-check and the same root gate. The host never erases the file, its data folders, its uploads or its ledger on Turn off; the plugin's own stop commands are plugin code and may remove runtime folders, so the dialog says "Its saved data stays unless the stop commands listed below remove it" when it lists commands (1.4.2).
- A stop that does not fully succeed returns the same report, and the plugin **stays on**. Only after a clean stop is the plugin switched off (audit kind `plugin-disable`).
- **No password is asked**, like for a plain switch. Anyone who holds the open session could therefore run a plugin's own, already approved stop commands as root without typing the password. The stop is refused if the plugin file differs from the approved one, and the root gate still applies. This is deliberate, not an oversight.
- **Turn off only** and every "without stopping" button use the old switch request, so a missing root or a failing stop can never make it impossible to turn a plugin off. Turning a plugin **on** is unchanged.
- The **sandbox stop hook is not run** on Turn off (the plugin is not being uninstalled). Delete and stop still runs it, and the sweep and the undo still apply to a plugin that has a hook.
- The ledger is **not pruned** after an undo. A plugin that once made a chain lists it again at the next Turn off, and the host then reports it as already gone.

## What the undo does NOT catch

- **Only what the host saw in command text.** A chain or boot script made inside a helper script, through a variable (`IPT -N X`), or by code that never passed through a route with the plugin's name, is not in the ledger and is not undone. This is the same limit as for written paths and for the process tag.
- **Kernel state is never undone, and only sometimes listed.** An eBPF pin (`/sys/fs/bpf/...`), a `/sys` or `/proc` setting, a property, a route or a mount made by a plugin stays until a reboot or until the plugin's own `@matchi-uninstall` removes it. The host will not write to `/sys` from a guess. The dialog shows the general line \"kernel or /sys settings\" only when a command's own text writes into `/proc` or `/sys` (`>` or `tee`). A pin created by a program the plugin runs (the Bypass `ttl_bpf` pin) is **not named and not listed**, because no command text shows it. Declare it with `@matchi-uninstall` (for example `rm -f /sys/fs/bpf/ttl_bpf`).
- **Folders the ledger did not see** stay, as before. Only ledger paths are erased.
- **Services started through Android** are still not seen (see the sweep).
- **Not a security boundary.** A plugin can lie about its name. The undo protects a person from a **forgetful** plugin, not from a **hostile** one. A boot script runs as root at every boot, which is why deleting one is held to exact names, a root-owned regular file and the shared-copy guard.
- **The re-check proves the chain and the file, not the whole plugin.** It says nothing about processes (the second scan does) or about anything outside the items listed.

## The legacy Bypass boot cleanup (removed in 1.4.2)

MatchiTOOL 1.4.1 held one piece of code that named a specific plugin: a one-time cleanup that took lines naming "bypass" out of `/data/local/matchitool/boot.sh` (marker `.bypass-cleanup-done`, copy `boot.sh.pre-bypass-removal`). **1.4.2 removed it.** No app code names a plugin any more. The marker and the copy may still sit on a device; nothing reads them.

What this means: a device that goes from a version before 1.4.1 straight to 1.4.2 never ran the cleanup. If it still has Bypass lines in `boot.sh`, open the file as root and delete the lines that name Bypass by hand. A plugin's own boot file in `boot.d` is undone by "Delete and stop", and anything else is the plugin's `@matchi-uninstall`.

## Plugins that declare nothing and have nothing running

They are deleted as before, and the dialog says that no running process was found for them. Unless the host saw them create a firewall chain or a `boot.d` script: then the dialog lists it and offers **Delete and stop**, even though nothing is running (see the next section). The ledger does not record a line of `boot.sh` or a rule in a system chain, so those are never listed.

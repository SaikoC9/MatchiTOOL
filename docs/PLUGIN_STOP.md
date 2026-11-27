# Stopping what a plugin started

For 1.4.6. Deleting a plugin removes its file and data. It does **not** stop a process, remove a firewall rule or take out a boot-script line the plugin created, because MatchiTOOL cannot know about them.

Three mechanisms handle that:

1. Header lines the plugin declares.
2. The process sweep (finds processes without headers).
3. The undo of firewall chains and `boot.d` scripts the host saw the plugin create.

The Delete dialog lists everything first. After the root gate and password it runs as root. Deleting or switching off a plugin also closes its web gate ([`PLUGIN_GATE.md`](PLUGIN_GATE.md)).

## Header lines

Own line, starting with `//`, in the **first 400 lines**.

| Line | Meaning |
| --- | --- |
| `// @matchi-uninstall COMMAND` | Root command run on delete, in file order. Max 10, 300 chars, no control chars, duplicates dropped |
| `// @matchi-check COMMAND` | One command that must **exit 0 only when everything is gone**. Without a check or boot file the stop can never report success |
| `// @matchi-boot /path` | Boot file the plugin creates (absolute path, letters/digits/`. _ - /`). Tested gone after the commands. Max 5 |

## What happens

1. The dialog shows the plan: commands exactly as they will run, then the check.
2. Commands run in order within **one 60 s total**. A failure does not stop the rest. No retries.
3. Then the check and boot-file test run with the remaining time.
4. Only if every command exited 0, the check passed and no boot file remains, the plugin and data are deleted. Otherwise the plugin is **kept**, the report is shown, and you can try again, delete without stopping, or restart the device (when only running leftovers remain).

## Rules for good commands

- **Safe to run twice.** Guard: `[ ! -f FILE ] || sh FILE stop`.
- **Boot entry first, then stop the running part.** Otherwise a reboot between them brings it back.
- **Shared folders: `rmdir`, never `rm -rf`.** `rm -rf` only for folders only your plugin uses; else `rmdir FOLDER 2>/dev/null || true`.
- **One thing per command.**
- Commands pass the same filter as plugin shell commands (no wiping `/`, `/data`, `/sdcard`, no `dd` to devices). A refused command fails the whole stop and is listed with its reason.
- **Sandboxed plugin:** every command and the check must also be granted with `// @matchi-needs shell: COMMAND`, same text, in the first **80** lines, and approved.
- **Changing headers changes the file.** An update that adds a command asks again. A file that differs from the approved one cannot stop anything.
- The check should test **what you started** (process, chain, pid file, folder), not things other plugins may have made. Example: `ps -A -o ARGS | grep -v grep | grep -q NAME`.

## Two plugins, one folder

If another installed plugin declares the same command or boot file, the dialog warns and skips the stop by default, so "install a new copy under a new name, then delete the old one" does not break the new copy. You can still choose "Delete and stop anyway".

## Replacing a plugin

Installing a file under the **same name** never runs the stop. Only Delete does.

## Example

`docs/examples/Stop_Example.js` starts a background job and a boot entry and declares how to stop both.

## Process sweep (plugins without headers)

On delete, MatchiTOOL looks for processes the plugin started and offers to end them. It needs the root gate and password and ends only what the dialog showed. The process list is read only when the root gate allows (sign-in under 4 h, HTTP rules). On an older session the dialog still shows the plan and undo list and says the process part "could not be checked"; nothing is guessed.

### How a process is found (strongest first; the dialog says which)

| By | Meaning |
| --- | --- |
| **tag** | MatchiTOOL prefixes every plugin shell command with `export MATCHI_PLUGIN='NAME'; ` (shell, root shell, user shell routes, sandboxed `matchi.shell`). Processes started by it, and their children, carry `MATCHI_PLUGIN=NAME`. The scan reads `/proc/PID/environ` |
| **pidfile** | A `.pid` file written by the plugin's recorded commands (e.g. `echo $! > /x/beat.pid`) holds a PID whose command line still names one of the plugin's files (or carries the tag). Read only if a plain file with digits. Stops PID reuse mistakes |
| **command line** | Command line contains a **file** path the plugin wrote (3+ segments, not under `/system`, `/vendor`, `/apex`, `/proc`, `/dev`, not used by another plugin). Weakest; shown first |

### Dialog

- Lists every process to end: PID, command line (cut at 200 chars), how found. Nothing ends before **Delete and stop**.
- The stop also ends children of listed processes.
- Nothing found: deleted as before, dialog says so.
- Root missing or scan cannot run: "cannot be checked", no list.
- More than **50** processes: stop not offered, only **Delete without stopping**.
- **Left running on purpose** lists matched processes not ended (shared with another plugin, or protected).
- **Delete without stopping** never scans and never ends anything.

### What "Delete and stop" does

1. The host scans again and compares with what you saw (hash of PID + start time + command line). If different: `409 plan-changed`, nothing ends, dialog reopens. An unlisted process is never ended.
2. Declared commands run first, then the sweep.
3. The sweep is one host-built root script. Only PID and start time go in, never text from a process. For each listed process and its tree: `SIGSTOP`, `SIGTERM`, `SIGCONT`, wait 2 s, re-read the tree (catches respawned children), freeze again, `SIGKILL`. A PID whose start time changed is skipped.
4. The host scans **again**. Success needs this scan to have run, be complete, and find nothing. A scan that did not run or was cut short is never success.
5. If anything is left, the plugin is **kept**, leftovers are listed, dialog reopens.

All inside the same 60 s total. The scan may take up to 15 s and is not part of the 60. The kill step does not start with under 6 s left. Every kill is logged in `shell_audit.log` as `plugin-sweep`.

### Never touched

PID 1, kernel threads, the app process (`com.matchi.tool`), MatchiTOOL's root sessions, the sweep's own shell and its parents. Fixed in code.

### Two plugins, one job

A process whose command line contains a path another installed plugin also uses is **never ended**; it is listed under "Left running on purpose" with the other plugin's name. Its children are not listed, ended or counted, so a looping process (`sleep 30`) cannot make "Delete and stop" fail.

### What the sweep does NOT catch

- **Not a security boundary.** A trusted plugin can name any plugin. It protects against a **forgetful** plugin, not a **hostile** one.
- **Untagged processes:** jobs started before this update, by `Request` or eval'd code that lost its name, or another way. Found only by pidfile or command line.
- **Cleared environment** (`env -i`, double fork with clean env) loses the tag.
- **Services started through Android** (`am startservice`, `start SERVICE`, `setprop`, `cmd`) run under Android. Declare a stop command.
- **Pidfile written inside a script the plugin created** is not known.
- **Renamed binary without extension** is missed by the command-line match on purpose. That match can also over-match, which is why it is shown first.
- **Boot lines, firewall rules, files:** the sweep ends processes only. Chains and `boot.d` scripts are handled by the undo (below). Anything else (a `boot.sh` line, a rule in a system chain, an eBPF pin, a property) needs `@matchi-uninstall` and `@matchi-boot`.
- **Uninterruptible sleep** may not end at once; the second scan lists it and the plugin is kept.

Example: `docs/examples/No_Headers_Example.js`.

## Stop hook (sandboxed plugins only)

```js
matchi.onUninstall(async () => {
  await matchi.shell('pkill -f \'hook_exampl[e]/beat.txt\'; true');   // granted via @matchi-needs shell:
});
```

- The hook can do only what the plugin was approved for. Trusted plugins have no hook: their code is unlisted and has the whole page.
- It runs in the plugin's frame **before** declared commands and the sweep, max **15 s**.
- Its success is **never believed**. The host scans again; only a clean scan allows the delete. A hook that throws, times out or whose frame is gone **keeps the plugin**.
- A new process in the scan that was not listed before is never ended: the dialog reopens.
- A plugin with a hook and nothing else gets **Delete and stop**, because a job the sweep cannot see is what needs its own code.
- **Delete without stopping** never runs the hook. A **disabled** plugin has no hook; the sweep still applies.
- The outcome is logged (`plugin-hook`) but never used to decide success.
- A hanging hook keeps running in its frame until page reload; the plugin is kept.

Example: `docs/examples/Sandbox_Hook_Example.js`.

## Undo of firewall chains and boot scripts

The sweep ends what a plugin **started**. The undo removes what it **left**: a firewall chain and a boot script. Rule: **MatchiTOOL undoes only what it saw the plugin's own commands create.** It never guesses from a name, never touches what another plugin or MatchiTOOL owns, and never touches kernel state. Needs the root gate. Declared `@matchi-uninstall` commands run first, so the undo may find things already gone.

### The ledger

Every plugin shell command MatchiTOOL sees (with the plugin name) is read once. Results go to the plugin's ledger `plugin_trace/NAME.trace` in the app files folder (max 500 lines; when full, oldest `P` and `E` lines drop first, `C`, `B`, `U` last). Old ledgers still read.

| Line | Written when the command contains | Example |
| --- | --- | --- |
| `P` | written path | |
| `E` | side-effect word | |
| `U` | upload | |
| `C TABLE CHAIN TOOL` | `iptables` or `ip6tables`, optionally `-t TABLE`, then `-N CHAIN` (also inside `sh -c`, `su -c`, `timeout`, `nohup`, after `VAR=x`) | `C mangle MY_CHAIN iptables` |
| `B /path` | a write (`>`, `tee`, `cp`, `mv`...) to a file **directly** in `/data/local/matchitool/boot.d`, named like `20-name.sh` | `B /data/local/matchitool/boot.d/20-bypass-ttl.sh` |

Never recorded (so never undone):

- Built-in chain names (`INPUT`, `OUTPUT`, `FORWARD`, `PREROUTING`, `POSTROUTING`), chain names with anything but letters/digits/`_`/`-` (max 28 chars), tables other than `filter`, `nat`, `mangle`, `raw`, `security`.
- Boot scripts not named `NN-name.sh` (two digits, then letters/digits/`. _ -`), in a subfolder, or outside `boot.d`.
- Chains made through a variable (`IPT -N X`) or inside a script file the plugin wrote (the host reads command text only).

Jump rules (`-A POSTROUTING ... -j CHAIN`) are **not** recorded. The undo finds them at delete time by reading live rules.

### Dialog

Lists every undo item before anything runs, e.g. "the firewall chain MY_CHAIN (iptables, mangle)", "the boot script 20-bypass-ttl.sh", with "if it is still there" (the plan comes from the ledger, not the system).

- **Not undone** lists items kept on purpose (with reason), items not listed because there are too many (over **20** chains or **10** boot scripts), and how many invalid ledger lines were ignored.
- If the stop is blocked, has a refused command, or has too many processes: "The stop does not run, so these stay in the system".
- Root missing: nothing is undone, the plugin is kept.
- The plan appears even when the root check cannot run.

The page sends a hash of the shown items (`undoHash`, SHA-256 of sorted lines; empty if none). The host rebuilds the plan first and answers `409 plan-changed` on mismatch. A request without the key (older page, **Delete without stopping**, shared-copy default) gets no undo.

### What "Delete and stop" does

Order: declared commands, sweep, **undo**, **re-check**, the plugin's check, delete. Undo comes after the sweep so no watcher re-adds rules.

1. **Undo script.** One host-built root script from names that pass the safe-name check again; **one bad item and nothing runs**. No text from a plugin or rule is ever run.
   - **Chain.** Not there: `absent`. Otherwise every rule that **jumps to it** is deleted by number (`-D PARENT N`, max 40 per chain). A jump counts only when `iptables -S` prints it ending in `-j CHAIN` or `-g CHAIN` (comments never count). The parent chain is only read, loses at most the jump rule, and is never flushed or deleted. **If a jump remains, the chain is not flushed** (failure). Then flush (`-F`), delete (`-X`), look again. `iptables` and `ip6tables` are separate items; same-name chains in other tables are never touched. Missing tool: `notool`. Where `iptables` knows `-w`, every call waits up to 5 s for the xtables lock; if held for the whole 20 s, the item is not done and the plugin is kept.
   - **Boot script.** Refused if `boot.d` or its parent is a symlink, the file is a symlink or not a regular file, or not owned by root. Otherwise `rm -f`, then look again. Anything in `boot.d` not in this plugin's ledger is never named.
2. **Limits.** Shares the 60 s total. Not started with under **5 s** left; runs at most **20 s**. Each item gets an audit line (`plugin-undo`) **before** the script starts. No retries. Any answer other than "removed" or "absent" is a leftover.
3. **Re-check.** A **separate read-only** script looks at every item; it does not believe the undo. A chain is "absent" only when the **whole** table list (`iptables -t TABLE -S`) was read and has no line creating it. Missing tool or unreadable list = **not checked**, never gone. A boot script counts as present if the path exists **or** is a dangling symlink. Same `-w 5` rule; a lock `-w` cannot outwait shows as **error**. Not started with under 1 s left; max 15 s; one `plugin-undo` audit line.
4. **Report.** Success only if the undo script answered clean **and** the re-check ran for every item and found nothing. A clean re-check counts as the **check** for those items, so a plugin without `@matchi-check` can succeed. With declared checks, **all** must pass. Otherwise the plugin is **kept**, leftovers listed, dialog reopens (**Try again** lists what it would remove; **Restart device** is not offered while a boot script remains, because it runs at next boot).

On success the toast says how many items are gone (removed now or already gone).

### Two plugins, one chain

An item is **kept** ("also used by NAME, so it is kept") when another installed plugin:

- has the same ledger entry (same table, name, tool; or same boot path), or
- names the chain as a whole word in its `@matchi-uninstall` or `@matchi-check` commands (stricter than the ledger: a chain name that is also a plain word there keeps the chain), or
- lists the boot script with `@matchi-boot` or contains its path in its commands.

The last plugin using them takes them with it. The plugin's **own** `@matchi-uninstall` is never checked.

### Never touched

- A chain the plugin did not create is never flushed or deleted. Android's own chains (names starting `tetherctrl`, `bw_`, `fw_`, `oem`, `natctrl`, `st_`, `idletimer`, `clat`, `routectrl`, `wakeup`) are refused even if the plugin ran `-N` on an existing one.
- A built-in or system chain the plugin only jumps into is never flushed or deleted; the jump is removed only if it points at a chain this plugin created.
- A boot script written by another plugin or MatchiTOOL is never removed.
- Files outside `boot.d`, folders the ledger did not see, eBPF pins under `/sys/fs/bpf`, properties, routes, mounts stay.

## Turn off and stop

Switching a plugin **off** can also stop what it started and undo what it left, **without deleting** the file. Saved data stays unless the plugin's own stop commands remove it (the dialog says so when it lists commands).

- The page first reads what a stop would do. Nothing to stop: switched off at once, no dialog.
- Otherwise the dialog lists commands, processes and undo items (same wording as Delete) and offers **Turn off and stop** or **Turn off only**. If a command is refused or too many processes: only **Turn off without stopping**. For a shared copy, default skips the stop; **Turn off and stop anyway** runs it.
- **Turn off and stop** sends the same request as Delete with `keep: true`: same hashes, order, re-check and root gate. The host never erases the file, data folders, uploads or ledger.
- A stop that does not fully succeed returns the report and the plugin **stays on**. After a clean stop it is switched off (audit `plugin-disable`).
- **No password is asked**, like a plain switch. Anyone holding the open session could run an already approved stop command as root without the password. Refused if the file differs from the approved one; the root gate still applies. This is deliberate.
- **Turn off only** and every "without stopping" button use the old switch request, so a missing root or failing stop never blocks turning a plugin off. Turning **on** is unchanged.
- The **sandbox hook is not run** on Turn off.
- The ledger is **not pruned** after an undo. A chain once made is listed again at next Turn off and reported as already gone.

## What the undo does NOT catch

- **Only command text.** A chain or boot script made inside a helper script, via a variable, or by code that never passed a named route is not in the ledger.
- **Kernel state.** eBPF pins, `/sys` or `/proc` settings, properties, routes, mounts stay until reboot or the plugin's own `@matchi-uninstall`. The dialog shows "kernel or /sys settings" only when a command writes into `/proc` or `/sys` (`>` or `tee`). A pin created by a program the plugin runs (the Bypass `ttl_bpf` pin) is **not listed**. Declare it, e.g. `rm -f /sys/fs/bpf/ttl_bpf`.
- **Folders the ledger did not see** stay.
- **Android services** are not seen.
- **Not a security boundary.** A plugin can lie about its name. A boot script runs as root at every boot, hence exact names, a root-owned regular file and the shared-copy guard.
- **The re-check proves the chain and file, not the whole plugin.**

## Legacy Bypass boot cleanup (removed in 1.4.2)

1.4.1 had a one-time cleanup removing lines naming "bypass" from `/data/local/matchitool/boot.sh` (marker `.bypass-cleanup-done`, copy `boot.sh.pre-bypass-removal`). 1.4.2 removed it. No app code names a plugin now. The marker and copy may remain on a device; nothing reads them.

A device going from before 1.4.1 straight to 1.4.2 never ran it. If `boot.sh` still has Bypass lines, delete them by hand as root.

## Plugins that declare nothing and run nothing

Deleted as before; the dialog says no running process was found. Exception: if the host saw them create a firewall chain or a `boot.d` script, the dialog lists it and offers **Delete and stop**. A `boot.sh` line or a rule in a system chain is never listed.

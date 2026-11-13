# Stopping what a plugin started (author guide)

Current for MatchiTOOL 1.4.1 (unreleased code).

How much has been checked:

- **Header lines** (`@matchi-uninstall`, `@matchi-check`, `@matchi-boot`, the plan, the shared-folder guard, "a failed stop keeps the plugin"): tried on the F50 in Phase 1 (tests A-H and a real Bypass v65_17 delete). See `MatchiTOOL_Phase1_todo.txt`.
- **The process sweep and the sandbox stop hook** (sections "Plugins without headers: the process sweep" and "The stop hook" below): written and unit-tested on a PC (Kotlin pure tests and node tests). The Android parts of the host were **not compiled in the session that wrote them**, and **none of it has been run on the F50 yet** (tests A-M in `MatchiTOOL_Phase2_todo.txt`). Read those two sections as "designed to", not "proven to".

Deleting a plugin removes its file and its data. It does **not** stop a background process, a firewall rule or a boot-script line the plugin created, because MatchiTOOL cannot know about them. A plugin can say how to stop them with header lines. When the person deletes the plugin, the Delete dialog lists these commands word for word and, after the root gate and the sign-in password, runs them as root.

## The header lines

Each on a line of its own, starting with `//`, inside the **first 400 lines** of the file. A line that only mentions a header inside code is not a header.

| line | meaning |
| --- | --- |
| `// @matchi-uninstall COMMAND` | A root shell command run on delete, in file order. At most 10, at most 300 characters each, no control characters, duplicates dropped. |
| `// @matchi-check COMMAND` | One command that must **exit 0 only when everything is gone**. Without a check or a boot file the stop can never report success. |
| `// @matchi-boot /path` | A boot file the plugin creates (plain absolute path, letters, digits `. _ - /`). After the commands it is tested that the file is gone. At most 5. |

## What happens

1. The Delete dialog shows the plan. The plan is the commands exactly as they will run (UFI paths such as `/sdcard/ufi_tools_boot.sh` are mapped to MatchiTOOL's), then the check command.
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

`docs/examples/Stop_Example.js` starts a small background job and a boot entry and declares how to stop both. Use it for the on-device test list in `MatchiTOOL_Phase1_todo.txt` (tests A, C, F).

## Plugins without headers: the process sweep

A plugin that declares nothing can still have started something. So when the person deletes it, MatchiTOOL looks for processes the plugin started and offers to end them. This needs root (the same root gate and sign-in password as the header stop), and it only ever ends what the dialog showed.

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

The old copy of a plugin may have started a job that the new copy now uses. A process whose command line contains a path another installed plugin also uses is **never ended** and is listed under "Left running on purpose", with the name of the other plugin. This is the same idea as the same-folder guard above.

### What the sweep does NOT catch

Say these plainly to anyone who asks whether deleting a plugin "always" stops it:

- **Not a security boundary.** MatchiTOOL knows a plugin's name only from the page (a trusted plugin's script, best effort) or, for a sandboxed plugin, from the host. A trusted plugin can name any plugin. The sweep protects a person from a **forgetful** plugin, not from a **hostile** one.
- **A process with no tag.** The tag exists only on commands MatchiTOOL saw with a plugin name. A job started before this update, started by a `Request` or eval'd code that lost its name, or started some other way has no tag. It is found only by pidfile or command line.
- **A process that clears its environment** (`env -i`, a double fork that execs with a clean environment) loses the tag. It is found only by pidfile or command line.
- **Services started through Android** (`am startservice`, `start SERVICE`, `setprop` triggers, `cmd`) run under Android's own process, not under the plugin's command. The sweep does not see them. Declare a stop command for these.
- **Pidfile written inside a script the plugin created.** The recorded commands only show paths written in the command text. A pidfile written by a helper script is not known.
- **A renamed binary without a file extension** is missed by the command-line match on purpose (too many false hits otherwise). The command-line match can also match too much; that is why it is shown first.
- **Boot lines, firewall rules, files.** The sweep ends processes only. Undoing boot entries and firewall chains is not done in this version (planned: Phase 3). Declare them with `@matchi-uninstall` and `@matchi-boot` as before.
- **A process in uninterruptible sleep** may not end at once; the second scan then lists it and the plugin is kept.

### Example: a plugin with no headers

`docs/examples/No_Headers_Example.js` starts a small background job and declares nothing. On Delete the dialog should list the job "found by tag" and offer **Delete and stop**. (Not yet tried on a device.)

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

Example: `docs/examples/Sandbox_Hook_Example.js`. (Not yet tried on a device.)

## Plugins that declare nothing and have nothing running

They are deleted as before, and the dialog says that no running process was found for them. The old note about reboots and boot-script lines stays: the sweep ends processes, it does not undo boot lines.

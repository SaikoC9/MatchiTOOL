# Stopping what a plugin started (author guide)

Current for MatchiTOOL 1.4.1 (unreleased code: Kotlin not compiled, nothing run on a device).

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

## Plugins without headers

They are deleted as before. The dialog says "This plugin declares no stop commands. Anything it started may keep running." and the old note about reboots and boot-script lines stays.

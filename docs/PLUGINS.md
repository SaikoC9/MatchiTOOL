# Plugins

How to write, install and remove MatchiTOOL plugins. Current for 1.4.6.

A plugin is one `.js` file. By default it runs inside the console page with
your signed-in session and can do anything the page can, including root
commands. Read a plugin before you switch it on.

## Write one

Optional header lines go at the top of the file:

```js
// @matchi-name Hello
// @matchi-version 1.0
// @matchi-author you
// @matchi-description Shows a toast
// @matchi-requires root, curl

matchi.toast('Hello from my plugin');
```

The console shows name, version and author in the plugin list. Before you add
a plugin, the confirm dialog shows what it asks for: root or user shell,
bundled tools such as `curl`, `jq`, `sendat` and `zreq`. That summary is a text
search, so it cannot see commands a plugin builds at run time.

Every header line, with its limits, is in
[`PLUGIN_HEADERS.md`](PLUGIN_HEADERS.md).

## API

`window.matchi` offers:

- `toast`, `modal`, `menu`, `copy`, `panel`, `switch`, `loading`, `form`
- `root(cmd)` and `user(cmd)`: shell as root, or as the app user
- `hasRoot`
- `router.get` and `router.set`: the router API at `/api/zte`
- `sh`: shell helpers (curl wrapper, background jobs, paths)
- small helpers: `escapeHtml`, `formatBytes`, `wait`, `debounce`, `interval`,
  `base64`

The host routes `/api/shell` (root) and `/api/user_shell` (app user). Both
return `{success, content}`. The source is `web-src/plugin-host-api.js`.

Older plugin names still work: `runShellWithRoot`, `createToast`,
`createModal`, `showModal` and the `.actions-buttons` insertion point. Plugins
written for other tools may not run unchanged if they use their own helper
names, upload routes or file paths. The bundled `sendat` has to match the
device's CPU architecture.

## Delete a plugin

Deleting removes the plugin file and its data. The dialog lists what will be
erased and asks first.

**What counts as the plugin's data**

- Its own folder: `/data/local/matchitool/plugin_data/<name>/`.
- Folders named by `// @matchi-data /path` (max 20). Allowed: inside
  `/data/local/`, `/data/local/tmp/` and `/sdcard/`, with the exceptions listed
  in [`PLUGIN_HEADERS.md`](PLUGIN_HEADERS.md). Letters, digits, `. _ - /` only.
- Saved browser keys that start with `// @matchi-localstorage PREFIX`.
- Folders named after the plugin, and paths its root commands wrote
  (`>`, `tee`, `cp`, `mkdir` and similar). The host reads command text only,
  and only for commands run since 1.4.1.

**What is not erased**

- Anything made inside a script the plugin wrote, through a shell variable, or
  by a program it ran.
- A line in `/data/local/matchitool/boot.sh`. MatchiTOOL never edits it.
- Routes, properties, mounts, eBPF pins, scheduled jobs, package changes and
  Android services.

A plugin that needs these cleaned up should declare `@matchi-uninstall`
commands. A reboot clears most of them.

## When MatchiTOOL is uninstalled

The wipe cleans only what it can find. Declare what your plugin makes:

- `// @matchi-data /path`: folders to delete.
- `// @matchi-uninstall COMMAND`: stop commands. Checked when saved, run only if unchanged.
- `// @matchi-boot /path`: boot files outside `boot.d`.

Firewall chains and rules in built-in chains are found by the ledger. Anything else stays. Only installed plugins are cleaned. See [`UNINSTALL_WIPE.md`](UNINSTALL_WIPE.md).

## Stop what a plugin started

If a plugin may have left something running, the Delete dialog offers
**Delete and stop**. It needs the root gate and your password. In order, as
root:

1. The plugin's `@matchi-uninstall` commands.
2. End the processes MatchiTOOL found for it (max 50). It never touches PID 1,
   MatchiTOOL itself or anything another plugin uses.
3. Undo the firewall chains and `boot.d/NN-name.sh` scripts the host saw the
   plugin create.
4. Re-check. The plugin is deleted only if everything is gone. Otherwise it is
   kept and the dialog says what is left.

All of this runs inside one 60 second limit. **Delete without stopping** keeps
the old behaviour.

**Turn off and stop** does the same for the on/off switch, without deleting
the file. It asks no password, on purpose; see [`SECURITY.md`](../SECURITY.md).

Stop-command rules, how processes are found, the undo and its limits:
[`PLUGIN_STOP.md`](PLUGIN_STOP.md).

## Sandbox

A `.js` plugin can be switched to Sandbox (shield button, password asked). It
then runs in an isolated frame with no page access and no cookies. It can only
use what its `@matchi-needs` lines ask for and you approved: read-only AT,
named router fields, exact root commands, and named https hosts. If the file
changes, it loses its permissions until you approve it again. Trusted stays the
default. Details: [`PLUGIN_SANDBOX.md`](PLUGIN_SANDBOX.md).

## Protect a plugin's web page

A plugin that runs its own local page (AdGuard Home is the example) can add one
line:

```js
// @matchi-gate name=adguard port=3000 logout=/control/logout idle=3600
```

MatchiTOOL then puts a login gate in front of it, so the page's own cookie
never reaches the browser. Details: [`PLUGIN_GATE.md`](PLUGIN_GATE.md).

## Limits

- Stop and undo protect you from a forgetful plugin, not a hostile one. A
  plugin can lie about its name.
- Plugins can use root. Do not run two plugins that manage the same modem or
  firewall rules at the same time.


## Reference

- [`PLUGIN_HEADERS.md`](PLUGIN_HEADERS.md): every header line
- [`PLUGIN_STOP.md`](PLUGIN_STOP.md): stop, sweep, undo
- [`PLUGIN_SANDBOX.md`](PLUGIN_SANDBOX.md): sandbox
- [`PLUGIN_RULES.md`](PLUGIN_RULES.md): CPU and resource rules, plugin lint
- [`PLUGIN_GATE.md`](PLUGIN_GATE.md): web page gate
- [`examples/`](examples/): working example plugins

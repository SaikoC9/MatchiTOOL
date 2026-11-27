# Plugins

How to write, install and remove plugins. For 1.4.6.

A plugin is one `.js` file. By default it runs in the console page with your session and can do anything the page can, including root commands. **Read a plugin before you switch it on.**

## Write one

Optional header lines at the top:

```js
// @matchi-name Hello
// @matchi-version 1.0
// @matchi-author you
// @matchi-description Shows a toast
// @matchi-requires root, curl

matchi.toast('Hello from my plugin');
```

The list shows name, version and author. The install dialog shows what the plugin asks for (root or user shell, bundled tools such as `curl`, `jq`, `sendat`, `zreq`). This is a text search; it cannot see commands built at run time.

All header lines and limits: [`PLUGIN_HEADERS.md`](PLUGIN_HEADERS.md).

## API (`window.matchi`)

- UI: `toast`, `modal`, `menu`, `copy`, `panel`, `switch`, `loading`, `form`
- Shell: `root(cmd)` (root), `user(cmd)` (app user), `hasRoot`, `sh` (curl wrapper, background jobs, paths)
- `router.get`, `router.set`: router API at `/api/zte`
- Helpers: `escapeHtml`, `formatBytes`, `wait`, `debounce`, `interval`, `base64`

Routes `/api/shell` (root) and `/api/user_shell` (app user) return `{success, content}`. Source: `web-src/plugin-host-api.js`.

Old names still work: `runShellWithRoot`, `createToast`, `createModal`, `showModal`, `.actions-buttons`. Plugins for other tools may need changes if they use their own helpers, upload routes or paths. The bundled `sendat` must match the CPU architecture.

## Delete a plugin

Deleting removes the file and its data. The dialog lists what goes and asks first.

**Counted as plugin data**

- `/data/local/matchitool/plugin_data/<name>/`
- Paths from `// @matchi-data /path` (max 20; inside `/data/local/`, `/data/local/tmp/`, `/sdcard/`; letters, digits, `. _ - /`; exceptions in [`PLUGIN_HEADERS.md`](PLUGIN_HEADERS.md))
- Browser keys starting with `// @matchi-localstorage PREFIX`
- Folders named after the plugin and paths its root commands wrote (`>`, `tee`, `cp`, `mkdir`...). The host reads command text only, since 1.4.1.

**Not erased**

- Anything made inside a script the plugin wrote, via a shell variable, or by a program it ran
- A line in `/data/local/matchitool/boot.sh` (never edited by MatchiTOOL)
- Routes, properties, mounts, eBPF pins, scheduled jobs, package changes, Android services

Declare `@matchi-uninstall` commands for these. A reboot clears most.

## When MatchiTOOL is uninstalled

The wipe cleans only what it can find. Declare what your plugin makes:

- `// @matchi-data /path`: folders to delete
- `// @matchi-uninstall COMMAND`: stop commands (checked at save, run only if unchanged)
- `// @matchi-boot /path`: boot files outside `boot.d`

Firewall chains and rules in built-in chains are found via the ledger. Anything else stays. Only installed plugins are cleaned. See [`UNINSTALL_WIPE.md`](UNINSTALL_WIPE.md).

## Stop what a plugin started

The Delete dialog offers **Delete and stop** (root gate and password). In order, as root:

1. Run the plugin's `@matchi-uninstall` commands.
2. End the processes found for it (max 50). Never PID 1, MatchiTOOL, or anything another plugin uses.
3. Undo firewall chains and `boot.d/NN-name.sh` scripts the host saw it create.
4. Re-check. Delete only if everything is gone; otherwise keep the plugin and say what is left.

All within one 60 s limit. **Delete without stopping** keeps the old behaviour.

**Turn off and stop** does the same for the switch without deleting the file. It asks no password, on purpose ([`SECURITY.md`](../SECURITY.md)).

Details: [`PLUGIN_STOP.md`](PLUGIN_STOP.md).

## Sandbox

A `.js` plugin can be switched to Sandbox (shield button, password asked). It then runs in an isolated frame with no page access and no cookies, using only what its `@matchi-needs` lines request and you approved: read-only AT, named router fields, exact root commands, named https hosts. If the file changes, it loses permissions until you approve again. Trusted is the default. Details: [`PLUGIN_SANDBOX.md`](PLUGIN_SANDBOX.md).

## Protect a plugin's web page

A plugin with its own local web page (example: AdGuard Home) adds one line:

```js
// @matchi-gate name=adguard port=3000 logout=/control/logout idle=3600
```

MatchiTOOL then puts a login gate in front, so the page's own cookie never reaches the browser. Details: [`PLUGIN_GATE.md`](PLUGIN_GATE.md).

## Limits

- Stop and undo protect against a forgetful plugin, not a hostile one. A plugin can lie about its name.
- Plugins can use root. Do not run two plugins that manage the same modem or firewall rules.

## Reference

[`PLUGIN_HEADERS.md`](PLUGIN_HEADERS.md) | [`PLUGIN_STOP.md`](PLUGIN_STOP.md) | [`PLUGIN_SANDBOX.md`](PLUGIN_SANDBOX.md) | [`PLUGIN_RULES.md`](PLUGIN_RULES.md) | [`PLUGIN_GATE.md`](PLUGIN_GATE.md) | [`examples/`](examples/)

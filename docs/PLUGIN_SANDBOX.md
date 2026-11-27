# Sandboxed plugins

For 1.4.6 (sandbox unchanged since 1.4.1, except sandboxed plugins cannot use the web gate).

A plugin normally runs in the console page with your session. A plugin switched to **Sandbox** (Plugins, shield button) runs in an isolated frame. **Trusted stays the default.** Only `.js` plugins can be sandboxed.

## What the sandbox is

- `<iframe sandbox="allow-scripts">` without `allow-same-origin`: opaque origin. No page, variables, DOM, cookie, `localStorage` or `/api` access (the host also refuses `Origin: null`).
- Own Content-Security-Policy on top of the page's: no `eval`, frames, forms or workers; connections only to approved `net:` hosts over https.
- Only exit: the message bridge `window.matchi`. The page checks each call against what you approved, then relays device calls to `POST /api/plugins/call`, where the host checks the stored approval **again on every call**.
- Runs in the background from page load. Its window opens from the **Plugin actions** menu; **Close** only hides it.

## What a plugin can call

Always: `matchi.toast(text, color?)` (shown as `[Plugin name] text`), `matchi.info()`, `matchi.close()`, `matchi.storage.get/set/remove/keys` (private, 256 KB, 100 keys).

`matchi.onUninstall(fn)` registers the plugin's own stop code. No header or extra approval: every call `fn` makes is checked like any other. On "Delete and stop" the page runs `fn` in the frame for at most 15 s, then MatchiTOOL scans again; only a clean scan lets the delete go through. A hook that throws or does not finish keeps the plugin. Details: [`PLUGIN_STOP.md`](PLUGIN_STOP.md) ("The stop hook"). Example: `docs/examples/Sandbox_Hook_Example.js`.

**Turn off and stop does not run the hook.** It runs the declared `@matchi-uninstall` commands (each also granted via `@matchi-needs shell:`), the process sweep and the undo, but not `fn`. On "Delete and stop" the sweep and undo still apply, and the hook's own result is never believed: the scan decides.

Only when declared in the first 80 lines **and** approved:

| Header | Gives |
| --- | --- |
| `// @matchi-needs at.read` | `matchi.at('AT+CSQ')`: pure AT reads only |
| `// @matchi-needs router: signalbar,lan_ipaddr` | `matchi.router.get([...])`: those fields, read-only (max 20) |
| `// @matchi-needs shell: cat /proc/uptime` | `matchi.shell('cat /proc/uptime')`: **that exact text** (max 10, 300 chars, must pass `shellDanger`) |
| `// @matchi-needs net: api.example.com` | frame may contact `https://api.example.com`; host must also be in **Plugins > Network rules** |

A wrong or refused line grants nothing and is listed in the confirm dialog. Example: `docs/examples/Sandbox_Uptime.js`.

## Approval

Switching mode (either way) needs a fresh sign-in and the **password again**, and approves the file as it is: SHA-256 and permission list are stored on the host (`PluginSandbox.kt`, `plugin_records`). If the file later differs, the plugin still runs but with **no** permissions until you press **Approve**. Replacing a sandboxed plugin keeps its mode; an update asking for more permissions shows the "adds new abilities" confirm. Switching to Trusted gives the whole page again.

## Who decides

The page checks first for quick errors. Calls that pass go to `POST /api/plugins/call`. The host requires the plugin runs sandboxed, its file is **still** the approved one, and the call is inside the approved list (`sandboxCallError`), then runs the AT read, router read or exact shell command itself. A file edited on the device after page load is refused on its next call. `shell` also needs the root gate. Refusals go to the app log.

## What it does not do

- **The host cannot tell which page code relays a call.** A trusted plugin (already root) could send `/api/plugins/call` with a sandboxed plugin's name and use its narrow list. The sandbox guards against page-check bugs and changed files; it does not change what a trusted plugin can do.
- Permissions for **trusted** plugins are not enforced (it would break most plugins).
- An approved root command runs as root. An approved `net:` host is a place data can go.
- Plugins using page helpers (`createModal`, `runShellWithRoot`, `document`...) do not work sandboxed.
- **Import / restore** installs plugins as trusted; switch them again.
- Seen in Chromium only.

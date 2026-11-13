# Sandboxed plugins (Phases 4 and 5)

Current for MatchiTOOL 1.4.1 (unreleased code: Kotlin not compiled, nothing run on a device; the browser behaviour was tested in Chromium, see below).

A plugin normally runs **in the console page**, with the signed-in session, and can do anything the page can. A plugin you switch to **Sandbox** (Plugins, the shield button on its row) runs in an isolated frame instead. **Trusted stays the default**; nothing changes for a plugin you do not switch. Only `.js` plugins can be sandboxed; UFI-TOOLS `.html` blocks need the page.

## What the sandbox is

- An `<iframe sandbox="allow-scripts">` without `allow-same-origin`: the plugin has an opaque origin. It cannot read the page, its variables or DOM, has no cookie, no `localStorage` and no `/api` access (its requests are refused by the frame's own policy, and the host refuses `Origin: null` anyway).
- The frame has its own Content-Security-Policy on top of the page's: no `eval`, no frames, no forms, no workers, and connections only to the `net:` hosts you approved over https.
- Its only way out is a message bridge, `window.matchi`. The page checks every call against what you approved, then relays device calls to the host (`POST /api/plugins/call`), which checks the stored approval **again on every call** (Phase 5).
- It runs in the background from page load; its window opens from the **Plugin actions** menu and **Close** only hides it.

## What a plugin can call

Always: `matchi.toast(text, color?)` (shown as `[Plugin name] text`), `matchi.info()`, `matchi.close()`, `matchi.storage.get/set/remove/keys` (its own private area, 256 KB, 100 keys).

`matchi.onUninstall(fn)` registers the plugin's own **stop code**. It needs no header and no approval of its own (it gives no new power: every call `fn` makes is checked like any other call and can use only what was approved). When the person chooses "Delete and stop", the page runs `fn` in the frame for at most 15 seconds, then MatchiTOOL scans again and only a clean scan lets the delete go through; a hook that throws or does not finish keeps the plugin. Details and limits: `docs/PLUGIN_STOP.md` ("The stop hook"). Example: `docs/examples/Sandbox_Hook_Example.js`. Written and unit-tested; not yet run on the F50.

Only when declared in the first 80 lines **and** approved:

| header line | gives |
| --- | --- |
| `// @matchi-needs at.read` | `matchi.at('AT+CSQ')`: pure AT reads only (the same rule as the host's own) |
| `// @matchi-needs router: signalbar,lan_ipaddr` | `matchi.router.get(['signalbar'])`: those router fields, read-only (at most 20) |
| `// @matchi-needs shell: cat /proc/uptime` | `matchi.shell('cat /proc/uptime')`: **that exact text**, nothing added (at most 10, 300 characters, must pass `shellDanger`) |
| `// @matchi-needs net: api.example.com` | the frame may contact `https://api.example.com`; the host must also be on **Plugins > Network rules** |

A line that is wrong or refused grants nothing and is listed in the confirm dialog. Example: `docs/examples/Sandbox_Uptime.js`.

## How approval works

Switching the mode (either direction) needs a fresh sign-in and the **password again**, and approves the file as it is now: its SHA-256 and the permission list are stored on the host (`PluginSandbox.kt`, `plugin_records`). If the file later differs (edited outside the console), the plugin still runs but with **no** permissions until you press **Approve**. Replacing a sandboxed plugin keeps its mode, and an update that asks for another permission shows the usual "adds new abilities" confirm.

Switching to Trusted gives the plugin the whole page again, like any ordinary plugin.

## Who decides (Phase 5)

The page checks first, so a bad call gets a quick, clear error. Anything that gets past it goes to `POST /api/plugins/call` with the plugin's name, the operation and its arguments. The host then requires that the plugin runs sandboxed, that its file is **still** the approved one, and that the call is inside the approved list (`sandboxCallError`, `PluginSandbox.kt`); it runs the AT read, router read or exact shell command itself. A file edited on the device after the page loaded is therefore refused on its next call, even though the page still holds the old list. `shell` also needs the usual root gate (sign-in younger than 4 h, HTTP rules). Refusals are written to the app log.

## What it does not do

- **The host cannot tell which page code relays a call.** A trusted plugin (which already has root through the page) could send `/api/plugins/call` with a sandboxed plugin's name and use that plugin's narrow approved list. So this protects against a bug or bypass in the page's check and against a changed file; it does not make a trusted plugin weaker or stronger.
- Permissions for **trusted** plugins are not enforced (declare / approve per ability): that would break most UFI-TOOLS plugins. Not done.
- A root command you approved runs as root. An approved `net:` host is a place data can go.
- A plugin written for UFI-TOOLS almost always needs the page (`createModal`, `runShellWithRoot`, `document`...) and will not work sandboxed. This is for plugins written for the bridge.
- **Import / restore** installs plugins as trusted; switch them again.
- Seen in Chromium only. Firefox and Safari may treat the policies differently, and nothing was run on the F50's browser.

## Tests

- `node scripts/test_plugin_sandbox.js` (in `validate.sh`): grants, policy, document escaping, per-call checks, storage limits, agreement with `PluginSandbox.kt`.
- `PluginSandboxTest.kt` (includes the host's `sandboxCallError` rules), `PluginModesTest.kt` (gradle; **not compiled here**).
- `NODE_PATH=... node scripts/phase0/test_plugin_sandbox_browser.js app/src/main/assets/web/index.html` (Chromium + Playwright, not in `validate.sh`): a probe plugin inside the sandbox tries to read the page and session, fetch, XHR, beacon, load images, submit forms, open windows and frames, navigate the console, use `eval` and workers, and to call the bridge for things it was not given. The host log shows none of those attempts arrived. A second plugin is "edited" after the page loads and its next call is refused by the host (the mock host there applies a port of `sandboxCallError`; the Kotlin itself is only covered by the unit tests).

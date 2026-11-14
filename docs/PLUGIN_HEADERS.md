# Plugin header lines (author guide, one page)

Current for MatchiTOOL 1.4.2. This page only lists the lines and their limits; the rules and the reasons are in the page named in the last column. The limits below were read from the code (`PluginPaths.kt`, `PluginSandbox.kt`, `web-src/plugin-store-pure.js`, `assets/web/index.html`), not copied from older docs.

## The rules that apply to all of them

- A header is a comment line that **starts** with the marker. Text inside code (`var s = '// @matchi-uninstall x'`) is not a header.
- Stop lines (`@matchi-uninstall`, `@matchi-check`, `@matchi-boot`) and `@matchi-data` / `@matchi-localstorage` must start with `//`. `@matchi-needs` also accepts `/*`, `*` and `#`. The info lines (`@matchi-name` and the rest) also accept `*` and `/*`.
- A line that breaks a rule is dropped, does not count towards the limit, and grants nothing. The dialogs show what was refused where they can.
- Changing a header changes the file. A file that differs from the approved one runs no stop and no sandbox permission until the person presses **Approve**. An update that adds an `@matchi-uninstall` command asks again.

## The table

| line | what it does | where it is read | limits | detail |
| --- | --- | --- | --- | --- |
| `// @matchi-name TEXT` | Name shown in the plugin list | first **40** lines | 60 characters, control characters become spaces, the first one wins | README |
| `// @matchi-version TEXT` | Version shown in the list | first **40** lines | 60 characters, the first one wins | README |
| `// @matchi-author TEXT` | Author shown in the list | first **40** lines | 60 characters, the first one wins | README |
| `// @matchi-description TEXT` | One line shown as the tooltip | first **40** lines | 200 characters, the first one wins | README |
| `// @matchi-requires a, b, c` | What the plugin needs (`root`, `curl`, `jq` ...), shown as "Needs:" | first **40** lines | at most 8 words of letters, digits, `. _ -`, up to 24 characters each; separated by space, comma or semicolon | README |
| `// @matchi-data /path` | A folder or file to **erase** when the plugin is deleted | first **400** lines | at most 20, plain absolute path of letters, digits `. _ - /` up to 200 characters; only inside `/data/local`, `/data/local/tmp`, `/sdcard` or the plugin's own data folder; protected folders and `..` are refused | README ("Plugin data is erased when you delete the plugin") |
| `// @matchi-localstorage PREFIX` | Saved browser settings to remove on delete | first **400** lines | the prefix must start with the plugin's own name and be at least 4 characters; `matchi_` and `liv_` keys are never matched | README |
| `// @matchi-uninstall COMMAND` | A root command run on Delete and stop and on Turn off and stop, in file order | first **400** lines | at most 10, 1 to 300 characters, no control characters, duplicates dropped; must pass the shell filter | [`PLUGIN_STOP.md`](PLUGIN_STOP.md) |
| `// @matchi-check COMMAND` | Must exit 0 **only when everything is gone** | first **400** lines | one (the first valid), same size rule as a command | [`PLUGIN_STOP.md`](PLUGIN_STOP.md) |
| `// @matchi-boot /path` | A boot file the plugin creates; tested to be gone after the commands | first **400** lines | at most 5, plain absolute path up to 200 characters, duplicates dropped | [`PLUGIN_STOP.md`](PLUGIN_STOP.md) |
| `// @matchi-needs at.read` | Sandbox only: read-only AT (`matchi.at`) | first **80** lines | takes no value | [`PLUGIN_SANDBOX.md`](PLUGIN_SANDBOX.md) |
| `// @matchi-needs router: a,b` | Sandbox only: read these router fields | first **80** lines | at most 20 fields of letters, digits, `_`, up to 60 characters | [`PLUGIN_SANDBOX.md`](PLUGIN_SANDBOX.md) |
| `// @matchi-needs shell: COMMAND` | Sandbox only: this exact root command, nothing added | first **80** lines | at most 10, 300 characters, must pass `shellDanger`; a stop command of a sandboxed plugin needs the same text here | [`PLUGIN_SANDBOX.md`](PLUGIN_SANDBOX.md), [`PLUGIN_STOP.md`](PLUGIN_STOP.md) |
| `// @matchi-needs net: host` | Sandbox only: the frame may contact `https://host` | first **80** lines | at most 10 hosts; the host must also be on Plugins > Network rules | [`PLUGIN_SANDBOX.md`](PLUGIN_SANDBOX.md) |

## Not a header

`matchi.onUninstall(fn)` is code, not a line: a **sandboxed** plugin registers its own stop code, which runs on Delete and stop only (not on Turn off and stop). It needs no header. See [`PLUGIN_SANDBOX.md`](PLUGIN_SANDBOX.md) and [`PLUGIN_STOP.md`](PLUGIN_STOP.md) ("The stop hook").

## Examples

[`examples/Stop_Example.js`](examples/Stop_Example.js) (stop lines), [`examples/No_Headers_Example.js`](examples/No_Headers_Example.js) (no lines, found by the sweep), [`examples/Sandbox_Uptime.js`](examples/Sandbox_Uptime.js) (`@matchi-needs`), [`examples/Sandbox_Hook_Example.js`](examples/Sandbox_Hook_Example.js) (the hook).

# Plugin header lines

For 1.4.6. Limits were read from the code (`PluginPaths.kt`, `PluginSandbox.kt`, `web-src/plugin-store-pure.js`, `assets/web/index.html`).

## Rules for all headers

- A header is a comment line that **starts** with the marker. Text inside code is not a header.
- `@matchi-uninstall`, `@matchi-check`, `@matchi-boot`, `@matchi-data`, `@matchi-localstorage` must start with `//`. `@matchi-needs` also accepts `/*`, `*`, `#`. Info lines also accept `*` and `/*`.
- A line that breaks a rule is dropped, does not count toward limits, and grants nothing.
- Changing a header changes the file. A file that differs from the approved one runs no stop and no sandbox permission until you press **Approve**. Adding an `@matchi-uninstall` command asks again.

## Info lines (first 40 lines; first one wins)

| line | meaning | limit |
| --- | --- | --- |
| `// @matchi-name TEXT` | name in the list | 60 chars |
| `// @matchi-version TEXT` | version | 60 chars |
| `// @matchi-author TEXT` | author | 60 chars |
| `// @matchi-description TEXT` | tooltip | 200 chars |
| `// @matchi-requires a, b, c` | shown as "Needs:" | max 8 words, letters/digits/`. _ -`, 24 chars each; separators space, comma, semicolon |

## Cleanup and gate lines (first 400 lines)

| line | meaning | limit | detail |
| --- | --- | --- | --- |
| `// @matchi-data /path` | folder or file erased on delete | max 20; absolute path, letters/digits/`. _ - /`, 200 chars; only inside `/data/local`, `/data/local/tmp`, `/sdcard` or the plugin's data folder; protected folders and `..` refused | [`PLUGINS.md`](PLUGINS.md) |
| `// @matchi-localstorage PREFIX` | browser keys removed on delete | prefix starts with the plugin's name, min 4 chars; `matchi_` and `liv_` keys never match | [`PLUGINS.md`](PLUGINS.md) |
| `// @matchi-uninstall COMMAND` | root command run on Delete and stop / Turn off and stop, in file order | max 10, 1-300 chars, no control chars, duplicates dropped, must pass the shell filter | [`PLUGIN_STOP.md`](PLUGIN_STOP.md) |
| `// @matchi-check COMMAND` | must exit 0 **only when everything is gone** | one (first valid), same size rule | [`PLUGIN_STOP.md`](PLUGIN_STOP.md) |
| `// @matchi-boot /path` | boot file the plugin creates; tested gone after the commands | max 5, absolute path, 200 chars | [`PLUGIN_STOP.md`](PLUGIN_STOP.md) |
| `// @matchi-gate name=ID port=N [logout=/path] [idle=S] [tabclose=on\|off]` | local web page protected by MatchiTOOL's login gate | one line; `name` and `port` required; a broken line refuses the upload | [`PLUGIN_GATE.md`](PLUGIN_GATE.md) |

## Sandbox permissions (first 80 lines)

| line | gives | limit |
| --- | --- | --- |
| `// @matchi-needs at.read` | `matchi.at(...)`: read-only AT | no value |
| `// @matchi-needs router: a,b` | read these router fields | max 20, letters/digits/`_`, 60 chars |
| `// @matchi-needs shell: COMMAND` | this exact root command only | max 10, 300 chars, must pass `shellDanger`. A sandboxed plugin's stop command needs the same text here |
| `// @matchi-needs net: host` | frame may contact `https://host` | max 10; host must also be in Plugins > Network rules |

Details: [`PLUGIN_SANDBOX.md`](PLUGIN_SANDBOX.md).

## Not a header

`matchi.onUninstall(fn)` is code. A **sandboxed** plugin registers its own stop code, run on Delete and stop only (not Turn off and stop). No header needed. See [`PLUGIN_STOP.md`](PLUGIN_STOP.md) ("The stop hook").

## Examples

[`examples/Stop_Example.js`](examples/Stop_Example.js) (stop lines), [`examples/No_Headers_Example.js`](examples/No_Headers_Example.js) (found by the sweep), [`examples/Sandbox_Uptime.js`](examples/Sandbox_Uptime.js) (`@matchi-needs`), [`examples/Sandbox_Hook_Example.js`](examples/Sandbox_Hook_Example.js) (hook).

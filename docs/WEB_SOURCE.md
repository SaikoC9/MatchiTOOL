# Where the plugin code lives (web-src)

The console is one self-contained page, `app/src/main/assets/web/index.html` (the APK and every test read that file). The plugin code inside it is edited as separate files in `app/src/main/web-src/`:

| file | what it holds |
| --- | --- |
| `plugin-host-api.js` | UFI-TOOLS helper globals plugins call (`createModal`, `runShellWithRoot`, `createToast`, ...) |
| `plugin-store-pure.js` | store and plugin logic with no DOM: URL rules, UFI/JSON index parsing, SHA-256, `plugScan`, `plugCompat`, `plugMeta`, route list (tested by `scripts/test_ufi_store.js`) |
| `plugin-store-ui.js` | the Plugin store window: fetch, install, source picker |
| `plugin-trace.js` | tags root commands and uploads with the plugin that sent them (header `x-matchi-plugin`), so Delete can erase what that plugin wrote (tested by `scripts/test_plugin_trace.js`) |
| `radio-core.js` | `window.MatchiRadio`: AT and router calls, band lock, cell lock, radio restart, parsing. No DOM (tested by `scripts/test_at_radio.js`) |
| `at-radio-ui.js` | the AT & Radio window (a built-in tool block in `index.html`): AT terminal, VoLTE / VoNR, quick buttons, modem restart; calls `MatchiRadio`. No network mode, band lock or cell lock (they are on the dashboard) |
| `perf-mode.js` | `mountPerfMode()`: the "Performance mode" button in the top button row (next to Change IP) and its small window |
| `net-core.js` | `window.MatchiNetCore`: the pure part of the Network window: which router keys each tab reads, parsers for Data / Wi-Fi / Devices / APN / LAN-DHCP / MTU-MSS, the read-only root command and its parser, and the password masking. No DOM, no router call (tested by `scripts/test_net_tools.js`) |
| `net-tools.js` | `mountNetTools()`: the "Network" button in the top button row and its window with six tabs. Phase 1 is read only; the window is run against a fake DOM by `scripts/test_net_tools_ui.js` |
| `dash-radio.js` | `mountDashRadio()`: the Radio settings card under Live device status (network mode, band chips, Lock / Unlock all) |
| `pick-ui.js` | popup pickers: replaces the phone's full-screen dropdown list and date/time wheel with a popup in the page's style for selects and date fields in dialogs and the header (the real controls stay, hidden, so handlers keep working) |

In `index.html` each file sits between `/* @include web-src/NAME.js */` and `/* @end-include web-src/NAME.js */`.

**Workflow:** edit the file in `web-src/`, then run `node scripts/build-web.js` to write it into `index.html`, and commit both. `scripts/validate.sh` (and so CI) runs `node scripts/build-web.js --check` and fails when the two differ, so an edit made directly inside an included block is caught instead of being overwritten later. Text outside the markers is still edited in `index.html` as before.

**Adding a file:** create `web-src/NAME.js`, put a marker pair where it belongs in `index.html`, run the build. A file that no marker includes also fails the check. The files must not contain `</script`.

`build-web.js` also writes the app version (from `version.properties`) into `const PAGE_VERSION=...` in `index.html`; `--check` fails when it differs.

The split changes only where you edit: with the marker lines removed, the page is byte-identical to the one before the split.

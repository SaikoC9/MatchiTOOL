# Where the plugin code lives (web-src)

The console is one self-contained page, `app/src/main/assets/web/index.html` (the APK and every test read that file). The plugin code inside it is edited as separate files in `app/src/main/web-src/`:

| file | what it holds |
| --- | --- |
| `plugin-host-api.js` | UFI-TOOLS helper globals plugins call (`createModal`, `runShellWithRoot`, `createToast`, ...) |
| `plugin-store-pure.js` | store and plugin logic with no DOM: URL rules, UFI/JSON index parsing, SHA-256, `plugScan`, `plugCompat`, `plugMeta`, route list (tested by `scripts/test_ufi_store.js`) |
| `plugin-store-ui.js` | the Plugin store window: fetch, install, source picker |
| `plugin-trace.js` | tags root commands and uploads with the plugin that sent them (header `x-matchi-plugin`), so Delete can erase what that plugin wrote (tested by `scripts/test_plugin_trace.js`) |
| `radio-core.js` | `window.MatchiRadio`: AT and router calls, band lock, cell lock, radio restart, parsing. No DOM (tested by `scripts/test_at_radio.js`) |
| `at-radio-ui.js` | the AT & Radio window (a built-in tool block in `index.html`); calls `MatchiRadio` |
| `dash-radio.js` | `mountDashRadio()`: the Radio settings card under Live device status (network mode, band chips, Lock / Unlock all) |

In `index.html` each file sits between `/* @include web-src/NAME.js */` and `/* @end-include web-src/NAME.js */`.

**Workflow:** edit the file in `web-src/`, then run `node scripts/build-web.js` to write it into `index.html`, and commit both. `scripts/validate.sh` (and so CI) runs `node scripts/build-web.js --check` and fails when the two differ, so an edit made directly inside an included block is caught instead of being overwritten later. Text outside the markers is still edited in `index.html` as before.

**Adding a file:** create `web-src/NAME.js`, put a marker pair where it belongs in `index.html`, run the build. A file that no marker includes also fails the check. The files must not contain `</script`.

The split changes only where you edit: with the marker lines removed, the page is byte-identical to the one before the split.

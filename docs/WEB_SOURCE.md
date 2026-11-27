# Where the plugin code lives (web-src)

The console is one self-contained page: `app/src/main/assets/web/index.html` (the APK reads it). Its plugin code is edited as separate files in `app/src/main/web-src/`:

| File | Holds |
| --- | --- |
| `plugin-host-api.js` | `window.matchi` plugin API and the page helpers it wraps (`createModal`, `runShellWithRoot`, `createToast`...) |
| `plugin-trace.js` | tags shell commands with the plugin name (`x-matchi-plugin`) so Delete can erase what it wrote |
| `radio-core.js` | `window.MatchiRadio`: AT and router calls, band lock, cell lock, radio restart, parsing. No DOM |
| `at-radio-ui.js` | AT & Radio window: AT terminal, VoLTE / VoNR, quick buttons, modem restart. No network mode, band lock or cell lock (those are on the dashboard) |
| `perf-mode.js` | `mountPerfMode()`: "Performance mode" button (next to Change IP) and its window |
| `net-core.js` | `window.MatchiNetCore`: router keys per tab, parsers (Data / Wi-Fi / Devices / APN / LAN-DHCP / MTU-MSS), read-only root command and parser, password masking. No DOM, no router call |
| `net-tools.js` | `mountNetTools()`: "Network" button and window with six tabs. Every tab reads; writing tabs ask first and read again after |
| `info-tip.js` | `window.MatchiTip`: long text as a small icon button (blue "?" info, amber warning, red "!" high risk, purple restart arrow) |
| `dash-radio.js` | `mountDashRadio()`: Radio settings card under Live device status (network mode, band chips, Lock / Unlock all) |
| `pick-ui.js` | popup pickers replacing the phone's full-screen dropdown and date/time wheel; real controls stay hidden so handlers work |

In `index.html` each file sits between `/* @include web-src/NAME.js */` and `/* @end-include web-src/NAME.js */`.

## Workflow

1. Edit the file in `web-src/`.
2. Run `node scripts/build-web.js` (writes it into `index.html`).
3. Commit both.

`scripts/validate.sh` (and CI) runs `node scripts/build-web.js --check` and fails if they differ, so a direct edit inside an included block is caught. Text outside the markers is still edited in `index.html`.

## Add a file

Create `web-src/NAME.js`, add a marker pair in `index.html`, run the build. A file no marker includes fails the check. Files must not contain `</script`.

`build-web.js` also writes the app version (from `version.properties`) into `const PAGE_VERSION=...`; `--check` fails if it differs.

The split changes only where you edit: without the markers the page is byte-identical to the one before the split.

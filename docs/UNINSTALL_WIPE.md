# Uninstall wipe

Current for MatchiTOOL 1.4.6.

Android deletes only the app's own folder when you uninstall. Everything MatchiTOOL did as root stays. A small root watcher (the reaper) outside the app removes it.

## How it works

- The reaper runs as root from `/data/local/matchitool/reaper/`. A boot script in `/data/adb/service.d/` starts it at boot.
- It decides the app is gone only when app data, the APK, `pm path` and the boot state all agree 3 times, 20 s apart. Anything unclear: it does nothing.
- Updates and downgrades keep app data and write an `updating` marker, so they are never wiped.
- Order: boot scripts, firewall, speed limits, programs, plugin stop commands, files. Last: the reaper, its boot script, the log.
- A step that fails keeps the boot script and a one-line log. It retries at boot, 5 times at most.
- It never talks to the router.

## Switch

Home row button **Wipe on uninstall**. ON by default.

- OFF removes the reaper and its boot script. Uninstalling then leaves everything below behind.
- No Magisk or KernelSU boot folder: it works until the next reboot.

## Removed

| Item | |
| --- | --- |
| `/data/local/matchitool/` (all of it) | removed |
| `/data/adb/service.d/matchi_logd.sh`, `matchi_reaper.sh` | removed |
| `/data/local/tmp/`: `matchi_jobs`, `matchi_memory_clean`, `mt_isms.sh`, `matchi_update.log`, `.matchi_out_prev.apk` | removed |
| Console port 2334 rules on `br*` `ap*` `swlan*` `usb*` `rndis*` `ecm*` (IPv4, IPv6) | removed |
| Chain `AGH_UI` and its jump | removed |
| Plugin chains and plugin rules in built-in chains (ledger `C`, `R`) | removed |
| Speed limits: `br0` root qdisc only if it reads `htb 1:`, ingress filters on `wlan0`, `usb0` (prio 1000-1255, 1300-1555) | removed |
| `matchi-guard`, `matchi-sampler`, `matchi-doctor`, `sendat`, `zreq`, `AdGuardHome` | stopped |
| Boot log capture loop and its children | stopped |
| Plugin processes (`MATCHI_PLUGIN` tag) | stopped |
| Plugin paths recorded in the ledger under `/data/local` | removed |
| `/data/local/adguardhome/` (AdGuard Home plugin data), always, even if the snapshot is empty | removed |

## Stays

- Wi-Fi turned off by the auto switch
- A pending LAN IP change
- IMEI, router settings, USB mode, adb
- `/sdcard`
- `/data/local/tmp/curl`, `/data/local/tmp/sqlite3` (not ours)
- The empty `ffff:` ingress qdisc on `wlan0`, `usb0` (it exists only after a speed limit was used since the last reboot; the reaper never deletes it)
- Data of a plugin deleted without erase

Why: the router password is gone with the app, so nothing can be restored. Turn Wi-Fi on in the router's web page.

## Plugin snapshot

The app is gone when the reaper runs, so the app keeps `reaper/plugins.snap` and `reaper/plugins.manifest` up to date. Root-owned, mode 600. Rewritten about 5 s after a plugin change.

| Line | Reaper does |
| --- | --- |
| `T tag` | ends processes with that tag |
| `P path` | deletes it (never `/sdcard`, our folder, `curl`, `sqlite*`, `matchi*`) |
| `B path` | deletes the boot file |
| `C table chain tool` | removes jumps, flushes, deletes the chain |
| `R tool table chain rule` | deletes that exact rule |
| `X command` | runs it only if its sha256 is in the manifest (60 s total) |

The reaper skips the whole snapshot if it is not root-owned, is group/other writable or is a symlink.

## Limits

1. Root removed before the app: nothing runs.
2. Switch OFF: nothing watches.
3. Wipe starts about 1 minute after uninstall, later if the phone was off.
4. Leftovers outside declared plugin paths stay, except the fixed AdGuard Home folder above. "Clear data" empties the app's plugin records, so the next snapshot is empty; that is why the AdGuard Home folder and process are fixed names in the reaper (version 6).

## Tests

- PC: `scripts/test_reaper.sh`, `test_reaper_install.sh`, `test_reaper_snapshot.sh`, `ReaperScriptTest`, `ReaperModelTest`, `ReaperSettingsTest`, `PluginSnapshotTest`. All run in `scripts/validate.sh`.
- F50: list in [`TESTING.md`](TESTING.md).

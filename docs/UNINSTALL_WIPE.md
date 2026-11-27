# Uninstall wipe

For 1.4.6. Android deletes only the app's own folder on uninstall. A small root watcher (the reaper) removes everything MatchiTOOL did as root.

## How it works

- The reaper runs as root from `/data/local/matchitool/reaper/`. A boot script in `/data/adb/service.d/` starts it.
- It decides the app is gone only when app data, APK, `pm path` and boot state agree 3 times, 20 s apart. If unclear, it does nothing.
- Updates and downgrades keep app data and write an `updating` marker, so they never wipe.
- Order: boot scripts, firewall, speed limits, programs, plugin stop commands, files. Last: reaper, its boot script, its log.
- A failed step keeps the boot script and a one-line log, and retries at boot (max 5).
- It never talks to the router.

## Switch

Home button **Wipe on uninstall**, ON by default.

- OFF removes the reaper and its boot script. Uninstalling then leaves everything below behind.
- Without a Magisk or KernelSU boot folder it works only until the next reboot.

## Removed

| Item | Result |
| --- | --- |
| `/data/local/matchitool/` (all) | removed |
| `/data/adb/service.d/matchi_logd.sh`, `matchi_reaper.sh` | removed |
| `/data/local/tmp/`: `matchi_jobs`, `matchi_memory_clean`, `mt_isms.sh`, `matchi_update.log`, `.matchi_out_prev.apk` | removed |
| Port 2334 rules on `br*` `ap*` `swlan*` `usb*` `rndis*` `ecm*` (IPv4, IPv6) | removed |
| Chain `AGH_UI` and its jump | removed |
| Plugin chains and plugin rules in built-in chains (ledger `C`, `R`) | removed |
| Speed limits: `br0` root qdisc only if it reads `htb 1:`; ingress filters on `wlan0`, `usb0` (prio 1000-1255, 1300-1555) | removed |
| `matchi-guard`, `matchi-sampler`, `matchi-doctor`, `sendat`, `zreq`, `AdGuardHome` | stopped |
| Boot log capture loop and children | stopped |
| Plugin processes (`MATCHI_PLUGIN` tag) | stopped |
| Plugin paths in the ledger under `/data/local` | removed |
| `/data/local/adguardhome/`, always | removed |

## Stays

- Wi-Fi turned off by the auto switch (the router password is gone with the app, so it cannot be restored; turn Wi-Fi on in the router's web page)
- A pending LAN IP change
- IMEI, router settings, USB mode, adb
- `/sdcard`
- `/data/local/tmp/curl`, `/data/local/tmp/sqlite3` (not ours)
- The empty `ffff:` ingress qdisc on `wlan0`, `usb0` (exists only after a speed limit since last reboot)
- Data of a plugin deleted without erase

## Plugin snapshot

The app keeps `reaper/plugins.snap` and `reaper/plugins.manifest` current (root-owned, mode 600, rewritten about 5 s after a plugin change).

| Line | Reaper does |
| --- | --- |
| `T tag` | ends processes with that tag |
| `P path` | deletes it (never `/sdcard`, our folder, `curl`, `sqlite*`, `matchi*`) |
| `B path` | deletes the boot file |
| `C table chain tool` | removes jumps, flushes, deletes the chain |
| `R tool table chain rule` | deletes that exact rule |
| `X command` | runs it only if its sha256 is in the manifest (60 s total) |

The whole snapshot is skipped if not root-owned, group/other writable, or a symlink.

## Limits

1. Root removed before the app: nothing runs.
2. Switch OFF: nothing watches.
3. Wipe starts about 1 minute after uninstall, later if the phone was off.
4. Leftovers outside declared plugin paths stay, except the fixed AdGuard Home folder and process. "Clear data" empties the plugin records, so the next snapshot is empty.
5. Scripts running from a Bypass folder (`sh /data/local/matchi_ttl/ttl.sh watch`) are ended first. Otherwise the loop recreated `/data/local/matchi_lock` and its rules after the wipe.

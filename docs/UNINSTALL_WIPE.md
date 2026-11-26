# Uninstall wipe: footprint

MatchiTOOL 1.4.5. Single source of truth for what the reaper removes.
REMOVE = reaper deletes. LEAVE = stays on purpose (D2, D6). APP = Android removes it.

## Files

| Item | Class |
| --- | --- |
| `/data/local/matchitool/` (whole folder: boot.sh, boot.d, bin, bootlogs, tmp, uploads, plugin_data, dpi, logd.conf, wifi_auto_off, wifi_auto.log, lan/wifi/mtu backups, lan_pending.json, usb_persist_orig, imei_*.txt, events.log, reaper/) | REMOVE |
| `/data/adb/service.d/matchi_logd.sh`, `matchi_reaper.sh` | REMOVE |
| `/data/local/tmp/`: `matchi_jobs`, `matchi_memory_clean`, `mt_isms.sh`, `matchi_update.log`, `.matchi_out_prev.apk` (fixed names, no glob) | REMOVE |
| Plugin paths from the ledger (`P` entries) under `/data/local`, `/data/local/tmp` | REMOVE |
| `/data/local/tmp/curl`, `/data/local/tmp/sqlite3` (not ours) | LEAVE |
| `/sdcard` | LEAVE |
| App sandbox | APP |

## Firewall and traffic control

| Item | Class |
| --- | --- |
| INPUT ACCEPT, tcp port 2334, on `br*` `ap*` `swlan*` `usb*` `rndis*` `ecm*` (iptables + ip6tables). Delete by reading `-S INPUT`, not by listing interfaces. | REMOVE |
| Chain `AGH_UI` + its jump | REMOVE |
| Plugin chains (ledger `C`) | REMOVE |
| Plugin rules in built-in chains (ledger `R`, new) | REMOVE |
| `br0` root qdisc, only if it reads `htb 1:` (takes classes `1:101..1:1ff` and filters with it) | REMOVE |
| Ingress filters on `wlan0`, `usb0` (`parent ffff:`), prio 1000-1255 and 1300-1555 only | REMOVE |
| Empty `ffff:` ingress qdisc on `wlan0`, `usb0` (D8) | LEAVE |
| `br0` address and USB bridging (gone at reboot) | LEAVE |

## Processes

| Process | Class |
| --- | --- |
| `matchi-guard`, `matchi-sampler`, `matchi-doctor`, `sendat`, `zreq` (exact name) | REMOVE |
| logd loop (`logd.pid`) and its `logcat`/`dmesg` children (`.cap.*`), check `/proc/<pid>/cmdline` first | REMOVE |
| Plugin processes (`MATCHI_PLUGIN` tag, incl. `boot-*`) | REMOVE |
| Web gate proxies, console server, IMEI keeper (in-app or one-shot) | APP |

## System state

| Item | Class |
| --- | --- |
| appops POST_NOTIFICATION | APP |
| Wi-Fi turned off by the auto switch, pending LAN IP change | LEAVE (D6) |
| Router settings, IMEI, USB mode, adb | LEAVE (D2) |

## Plan corrections found

- Gate proxies are not root processes.
- `/data/local/tmp` cleanup uses fixed names, not `.matchi_out_*`.
- Firewall rules for unplugged interfaces survive the app's own close script.
- logd capture children were missing from the plan.
- Backup files hold secrets: `wifi_backup.json` has the old hotspot password. They go with the folder, never read.
- Wiping the folder deletes the only copies of the original IMEI and USB mode (D7).

## Reaper lifecycle (Phase 4)

| When | What happens |
| --- | --- |
| Host service starts (20 s and 150 s after start, until it worked), switch ON (default) | `Reaper.ensureCurrent`: one status call; if the reaper is missing, older than the shipped one, not running, or the boot stub is missing or old, ONE root call installs it |
| Install (one root call) | Writes `reaper/matchi_reaper.sh` (mode 700, size checked before it replaces the old file), writes the boot stub `/data/adb/service.d/matchi_reaper.sh`, stops an older daemon, starts the new one detached (`setsid nohup`, uid 0, so Android's uninstall does not stop it). Refuses a symlinked folder or one not owned by root |
| App update or downgrade | `ApkUpdater` writes `/data/local/matchitool/updating` (unix seconds) before `pm install` / `pm uninstall -k`; the reaper does nothing while it is younger than 10 minutes. The marker is removed after a successful install. The data folder stays during `-k`, so the reaper's other checks hold as well. After the update the host service refreshes the reaper if the new build ships a newer one |
| Phone boots | The stub starts the reaper (it waits for `boot_completed`, unlocked user storage and a settle delay before it may decide "gone"). If the reaper file is missing, the stub deletes itself and starts nothing |
| Switch OFF | `Reaper.setEnabled(false)`: daemon stopped, stub and `reaper/` folder removed. Saved only when the root call worked. Nothing watches any more, so an uninstall leaves the root-side files behind |
| Switch ON again | Same as install |

Only one reaper runs: the daemon writes `reaper/watch.pid` and a second one exits at once. Processes are recognised by their command line from one
`ps -A -o PID,ARGS` and by `MATCHI_PLUGIN` from one `grep` over the environ files, never by reading `/proc/PID/cmdline` (on the F50 kernel that read
does not reach end of file, see `docs/PLUGIN_RULES.md`).

Tests: `scripts/test_reaper_install.sh` (install, install again, update marker, stub, switch OFF, symlink and short-write traps, end-to-end wipe with
decoy processes, all in a fake root folder), `ReaperModelTest`. Device checks T1-T3 are in the plan (Phase 7B).

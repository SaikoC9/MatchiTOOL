# Live status baseline (before the real-time work)

From the code in `app/src/main/assets/web/index.html` (Live device status, 1.4.0).

## 1. Baseline

1.4.0 had the OLD poll: one `collect()` (router GET plus root shell), one `tick()`, `arm(3000)`, then `nextDelay()` of 60 s cool, 120 s warm, 180 s hot. So: first read at 3 s, one update per minute when cool.

Later source split the poll (`collectFast()` / `collectSlow()`, two loops, 3 s / 15 s) with a `validate.sh` check. Sections 2 and 3 describe the split code. The split was then verified and fixed (hidden tab, early second root read); see CHANGELOG.

| Item | 1.4.0 | After split |
|---|---|---|
| Fast (router) and slow (root) loops | no | yes |
| Fast 3 s, slow 15 s | no (one poll, 60 s) | yes |
| Back-off 3, 6 ... 60 s on router failure | no | yes |
| No polling while tab hidden | no | yes (fixed after split) |
| Heat-aware delays | 60/120/180 s | partly: fast 3 s / 15 s hot; slow 15 s / 120 s warm / 180 s hot |
| Instant open, cache | no | no |
| Speed / devices / monthly rows | no | no |

## 2. What the card shows

- Hero: signal bars and dBm (5G RSRP, else LTE RSRP, else RSSI/CSQ), operator, network type, registration, battery % and charge state.
- Radio boxes: 5G NR and/or 4G LTE with band, PCI, channel, RSRP, RSRQ, SINR.
- Tiles: battery, system max and modem temperature; CPU %, memory % (MB), load (1/5/15), uptime.
- Heat banner at thermal level 1, 2, 3. Footer: source and errors.
- Header: "Live refresh: On/Off" (localStorage `liv_auto`) and "Live · updated N s ago" / "Stale".

Not shown yet: download/upload speed, connected devices, monthly data.

Router keys requested (`KEYS`, 18): network_type, network_provider, signalbar, rssi, lte_rsrp, lte_rsrq, lte_snr, lte_pci, wan_active_band, wan_active_channel, Z5g_rsrp, Z5g_rsrq, Z5g_SINR, nr5g_pci, nr5g_action_band, nr5g_action_channel, pm_sensor_mdm, pm_modem_5g.

## 3. Timing as coded

| Loop | Does | Cool | Warm (L1) | Hot (L2-3) | On failure |
|---|---|---|---|---|---|
| Fast | `POST /api/zte` op=get, multi_data, no root | 3 s | 3 s | 15 s | 6, 12, 24, 48, 60 s |
| Slow | `POST /api/shell` (battery, thermal zones, `/proc/stat` with 0.4 s sleep on first read, loadavg, uptime, meminfo) | 15 s | 120 s | 180 s | 15, 30, 60 s |

Thermal level (degrees C, sys max / battery / modem): 3 if sysMax >= 80, battery >= 50 or modem >= 90; 2 if >= 70 / 45 / 80; 1 if >= 60 / 40 / 70.

Extra work only when the router returns nothing: `dumpsys telephony.registry` (cached 2 min), AT batch (cached 60 s). The first CPU % read costs 0.4 s extra (two samples).

The router client serialises calls behind one lock (ZteClient), so a 3 s poll can queue an SMS send or delete. Both loops pause while another `.modal-bg` window is open.

## 4. Router key notes

- MatchiTOOL asks for `signalbar`; some firmware answers `network_signalbar`. Check which one your F50 answers.
- There is no `/baseDeviceInfo` route in `WebServer.kt` or `ZteClient.kt`, so the root shell stays the source for CPU and memory.


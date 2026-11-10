# Live status - Phase 0 baseline (before any behaviour change)

Written from the code in `app/src/main/assets/web/index.html` (Live device status block, version 1.4.0) and from the UFI-TOOLS 4.1.5 APK.
The "Measure on the phone" section is empty on purpose: it needs the real F50.

## 1. Which code is the baseline

The zip you attached (1.4.0) is the OLD poll, exactly as `LIVE_STATUS_UFI_PLAN.txt` describes it:
one `collect()` (router GET plus root shell together), one `tick()`, `arm(3000)`, then `nextDelay()` of 60 s cool, 120 s warm, 180 s hot.
That is the Phase 0 reference for "before": first read at 3 s, one update per minute when cool.

The working folder this session started from was already ahead of that zip: it had the Phase 1 split (`collectFast()` / `collectSlow()`, two loops, 3 s / 15 s) and a matching `validate.sh` check. Sections 2 and 3 below describe that split code, because it is what the next phases build on.
Phase 1 was then verified and fixed (hidden tab, early second root read); see CHANGELOG.

| Plan item | Old zip | Working folder after Phase 1 |
|---|---|---|
| Split into fast (router) and slow (root) loops | no | yes |
| Fast 3 s, slow 15 s | no (one poll, 60 s) | yes |
| Back-off 3, 6 ... 60 s on router failure | no | yes |
| Never poll while the tab is hidden | no | yes (fixed in Phase 1) |
| Heat-aware delays (Phase 3) | 60/120/180 s | partly: fast 3 s / 15 s hot, slow 15 s / 120 s warm / 180 s hot |
| Instant open, cache (Phase 4) | no | no |
| Speed / devices / monthly rows (Phase 2) | no | no |

## 2. What the card shows now

Hero: signal bars + dBm (5G RSRP, else LTE RSRP, else RSSI/CSQ), operator, network type, registration, battery % and charge state.
Radio boxes: 5G NR and/or 4G LTE with band, PCI, channel, RSRP, RSRQ, SINR.
Tiles: battery temp, system max temp, modem temp; CPU %, memory % (used/total MB), load (1/5/15), uptime.
Heat banner at thermal level 1, 2, 3. Footer shows the source and any errors.
Header shows "Live refresh: On/Off" (localStorage `liv_auto`, master switch) and a "Live · updated N s ago" / "Stale" indicator.

Not shown yet: download/upload speed, connected devices, monthly data.

Router keys requested now (`KEYS`, 18): network_type, network_provider, signalbar, rssi, lte_rsrp, lte_rsrq, lte_snr, lte_pci, wan_active_band, wan_active_channel, Z5g_rsrp, Z5g_rsrq, Z5g_SINR, nr5g_pci, nr5g_action_band, nr5g_action_channel, pm_sensor_mdm, pm_modem_5g.

## 3. Timing as coded (cool / warm / hot)

| Loop | What it does | Cool | Warm (level 1) | Hot (level 2-3) | On failure |
|---|---|---|---|---|---|
| Fast | `POST /api/zte` op=get, multi_data, no root | 3 s | 3 s | 15 s | 6, 12, 24, 48, 60 s |
| Slow | `POST /api/shell` (battery, thermal zones, /proc/stat with 0.4 s sleep on first read, loadavg, uptime, meminfo) | 15 s | 120 s | 180 s | 15, 30, 60 s |

Thermal level: 3 if sysMax >= 80, battery >= 50 or modem >= 90; 2 if >= 70 / 45 / 80; 1 if >= 60 / 40 / 70 (degrees C).
Extra work only when the router gives nothing: `dumpsys telephony.registry` (cached 2 min) and AT batch (cached 60 s).
The first CPU % read costs an extra 0.4 s in the shell (two samples); later reads reuse the previous sample.
The router client serialises calls behind one lock (ZteClient), so a 3 s fast poll can queue an SMS send or delete. Both loops pause while any other `.modal-bg` window is open.

## 4. What UFI-TOOLS 4.1.5 really does (read from `requests.js`, decoded with `scripts/phase0/deob_requests_js.js`)

- Request: `GET /goform/goform_get_cmd_process?multi_data=1&isTest=false&cmd=<keys>&_=<Date.now()>` with a cookie header. No AD token (only "set" needs it).
- Key list (39), exactly: usb_port_switch, battery_charging, sms_received_flag, sms_unread_num, sms_sim_unread_num, sim_msisdn, dual_sim_support, sim_slot, data_volume_limit_switch, battery_value, battery_vol_percent, network_signalbar, network_rssi, cr_version, iccid, imei, imsi, ipv6_wan_ipaddr, lan_ipaddr, mac_address, msisdn, network_information, Lte_ca_status, rssi, Z5g_rsrp, lte_rsrp, wifi_access_sta_num, loginfo, data_volume_alert_percent, data_volume_limit_size, realtime_rx_thrpt, realtime_tx_thrpt, realtime_time, monthly_tx_bytes, monthly_rx_bytes, monthly_time, network_type, network_provider, ppp_status.
- It then also calls `GET /baseDeviceInfo` (its own app endpoint) and merges the two results. CPU, memory and device info come from there, not from the router.
- Differences worth knowing for Phase 2:
  - UFI asks for `network_signalbar`; MatchiTOOL asks for `signalbar`. Which one your F50 answers is a Phase 0 measurement (see section 5).
  - The plan lists `battery_charging` and `lan_ipaddr`, which are in the UFI list; the plan's Phase 2 key list does not need them.
  - MatchiTOOL has no `/baseDeviceInfo` route in `WebServer.kt` or `ZteClient.kt` (not found by grep), so the slow loop's root shell stays the source for CPU and memory.
- Not confirmed: the plan says UFI polls "about every second". `main.js` is obfuscated differently from `requests.js` and the decoder does not handle it. It contains two `setInterval` calls (one has a 0x3e8 = 1000 ms divisor, which looks like a timer display), and the actual refresh interval was not recovered. Treat "1 s" as unverified.

## 5. Measure on the phone (still to do)

A temporary timing log is in the page (marked `PHASE0-TIMING`, 2 lines, remove in Phase 6). Open the page, open the browser console, filter on `live-phase0`. Each line is:

    [live-phase0] fast 140 ms ok=true failF=0 delay=3000 ms
    [live-phase0] slow 620 ms ok=true failS=0 delay=15000 ms thermal=0 bat=34.0 sys=52.3 modem=48.1

Fill in after 10 minutes idle on the page:

| Item | Value |
|---|---|
| fast read time (typical / worst) | |
| slow read time (typical / worst) | |
| battery temp (start / after 10 min) | |
| modem temp (start / after 10 min) | |
| system max temp (start / after 10 min) | |
| thermal level reached | |
| first values on screen after opening the page | |

Raw router output: open Live Status, pick the raw output view, save it. Check which keys are non-empty on your firmware, especially `signalbar` vs `network_signalbar`, `Z5g_rsrp`, `pm_sensor_mdm`, `pm_modem_5g`, and (for Phase 2) `realtime_rx_thrpt`, `realtime_tx_thrpt`, `wifi_access_sta_num`, `monthly_rx_bytes`, `monthly_tx_bytes`, `ppp_status`.

Phase 0 is done when sections 5's table is filled in.

# Network tools: router calls and files

What the Network window (Data, Wi-Fi, Devices, APN, LAN / DHCP, MTU / MSS, Light) sends to the F50 router and stores on the device. Captured from the stock page or its script. Code: `app/src/main/web-src/net-core.js`. If this file and the code disagree, the code is right.

## Reads (`goform_get_cmd_process`)

| Tab | Read |
|---|---|
| Data | `ppp_status, dial_mode, roam_setting_option, dial_roam_setting_option` |
| Wi-Fi | `queryWiFiModuleSwitch, queryAccessPointInfo, wifi_access_sta_num` |
| Devices | `station_list, lan_station_list, wifi_access_sta_num`; singles `queryDeviceAccessControlList`, `hostNameList` |
| LAN / DHCP | `lan_ipaddr, lan_netmask, dhcpEnabled, dhcpStart, dhcpEnd, dhcpLease_hour, mac_address` |
| MTU / MSS | `mtu, tcp_mss` |
| Light | `indicator_light_switch` (assumed, see below) |
| APN | profile list (`APN_READ` in net-core.js) |

Opening a tab only reads. The Wi-Fi password is never copied to the page.

## Writes (`goform_set_cmd_process`, POST)

All need a fresh sign-in (`NetGoform.kt`: every set call except names in `OPEN_SET`; `GATED` lists names these tools send). The host adds `isTest=false` first and the `AD` token last.

| Action | goformId and fields |
|---|---|
| Mobile data off / on | `DISCONNECT_NETWORK` / `CONNECT_NETWORK`, `notCallback=true` |
| Rename device | `EDIT_HOSTNAME`, `mac`, `hostname` |
| Block / unblock | `setDeviceAccessControlList`, `AclMode=2`, `WhiteMacList=`, `BlackMacList=mac;mac;`, `WhiteNameList=`, `BlackNameList=name;name;` (lists end with `;`) |
| Wi-Fi band | `switchWiFiChip`, `ChipEnum=chip1` (2.4 GHz) or `chip2` (5 GHz), `GuestEnable=0` |
| Wi-Fi settings | `setAccessPointInfo`, `ChipIndex=0`, `AccessPointIndex=0`, `SSID`, `ApIsolate=0`, `AuthMode`, `ApBroadcastDisabled`, `ApMaxStationNumber`, `EncrypType` (`CCMP`, or `NONE` if open) and, unless open, `Password` as base64 |
| APN auto | `APN_PROC_EX`, `apn_mode=auto` |
| APN save | `APN_PROC_EX`, `apn_action=save`, `apn_mode=manual`, profile name, APN, auth, user, password, `pdp_type`, `index`. IPv4 part for IP, IPv6 part for IPv6, both for IPv4v6 |
| LAN pool / lease | `DHCP_SETTING`, `lanIp`, `lanNetmask`, `lanDhcpType=SERVER`, `dhcpStart`, `dhcpEnd`, `dhcpLease` (hours), `dhcp_reboot_flag=1`, `mac_ip_reset=0` |
| Router IP change | same `DHCP_SETTING` with new `lanIp`, pool moved into the new subnet, `mac_ip_reset=1` |
| MTU / MSS | `SET_DEVICE_MTU`, `mtu`, `tcp_mss` (both always sent) |
| Indicator light On / Off | `INDICATOR_LIGHT_SETTING`, `indicator_light_switch=1` (On) or `0` (Off) |

The router restarts after every LAN / DHCP and MTU / MSS apply. Console and Wi-Fi are gone for about 1-2 minutes.

## Indicator light

Set call captured from the stock page (2026-11-28). The read key is assumed to match the set field.

If the tab shows "Not reported", capture the read (F12 > Network, filter `goform_get_cmd_process`, open the Indicator Light page) and set `LIGHT_KEY` and `READ.light` in `net-core.js`.

## This tool's limits (stricter than the router)

- DHCP lease 1-168 h. Pool inside the subnet, not containing the router IP.
- Router IP: private IPv4, not network or broadcast, pool keeps its host numbers, new IP outside the pool. Mask never changed.
- MTU 1280-1500. MSS at least 536 and at most MTU - 40 (stock 1500 / 1460).
- MSS applies to the router's own traffic (INPUT / OUTPUT). It does not clamp connected devices.

## Files (`/data/local/matchitool/`, root, mode 600)

| File | Written | Used by |
|---|---|---|
| `wifi_backup.json`, `lan_backup.json`, `mtu_backup.json` | before each risky write, read back before anything is sent | "Restore saved values". "Forget backup" deletes it |
| `lan_pending.json` | before a router IP change: old and new IP, mask, pool, lease, time | host check after restart (`LanRevert`); deleted when done |

APN has no backup file; its way back is **Auto**. If a backup cannot be written and read back, nothing is sent. Passwords stay in these files and never reach the page log (redactors hide `Password`, `*_passwd`, `passphrase`).

## Router IP change: after the restart

1. The page tells the host the new address (`POST /api/net/lan-applied`, root-gated). Only the address in the pending note is accepted.
2. The host waits up to 2 minutes, then:
   - new address answers with the wanted values: keep, delete the note
   - answers with other values: send the OLD values back via the address that answers
   - only the old address answers: change never took effect, point the console back
   - answers but unreadable: keep (never revert blind)
   - nothing answers: write nothing; the note stays until 30 minutes old
3. Needs the router password saved in MatchiTOOL (the revert signs in).

# Network tools: router calls and file formats

What the Network window (Data, Wi-Fi, Devices, APN, LAN / DHCP, MTU / MSS) sends to the F50 router and what it keeps on the device. Everything here was captured from the stock page on the F50 or read from its script; the exact code is `app/src/main/web-src/net-core.js`. If this file and the code disagree, the code is right.

## Reads (goform_get_cmd_process)

| Tab | What is read |
|---|---|
| Data | `ppp_status, dial_mode, roam_setting_option, dial_roam_setting_option` |
| Wi-Fi | `queryWiFiModuleSwitch, queryAccessPointInfo, wifi_access_sta_num` |
| Devices | `station_list, lan_station_list, wifi_access_sta_num`; single commands `queryDeviceAccessControlList` and `hostNameList` |
| LAN / DHCP | `lan_ipaddr, lan_netmask, dhcpEnabled, dhcpStart, dhcpEnd, dhcpLease_hour, mac_address` |
| MTU / MSS | `mtu, tcp_mss` |
| APN | the profile list (see `APN_READ` in net-core.js) |

Opening a tab only reads. The Wi-Fi password is never copied to the page.

## Writes (goform_set_cmd_process, POST)

All of these need the fresh sign-in (`NetGoform.kt`: every router set call needs it except the names in `OPEN_SET`; `GATED` lists the names these tools send). The host adds `isTest=false` first and the `AD` token last.

| Action | goformId and fields |
|---|---|
| Mobile data off / on | `DISCONNECT_NETWORK` / `CONNECT_NETWORK`, `notCallback=true` |
| Rename a device | `EDIT_HOSTNAME`, `mac`, `hostname` |
| Block / unblock devices | `setDeviceAccessControlList`, `AclMode=2`, `WhiteMacList=`, `BlackMacList=mac;mac;`, `WhiteNameList=`, `BlackNameList=name;name;` (lists end with `;`) |
| Wi-Fi band | `switchWiFiChip`, `ChipEnum=chip1` (2.4 GHz only) or `chip2` (5 GHz only), `GuestEnable=0` |
| Wi-Fi settings | `setAccessPointInfo`, `ChipIndex=0`, `AccessPointIndex=0`, `SSID`, `ApIsolate=0`, `AuthMode`, `ApBroadcastDisabled`, `ApMaxStationNumber`, `EncrypType` (`CCMP`, or `NONE` for an open network) and, unless the network is open, `Password` as base64 text (the stock page encodes it) |
| APN auto | `APN_PROC_EX`, `apn_mode=auto` |
| APN save | `APN_PROC_EX`, `apn_action=save`, `apn_mode=manual`, profile name, APN, auth, user, password, `pdp_type`, `index` (slot). The IPv4 part is sent for IP, the IPv6 part for IPv6 and both for IPv4v6 |
| LAN pool / lease | `DHCP_SETTING`, `lanIp`, `lanNetmask`, `lanDhcpType=SERVER`, `dhcpStart`, `dhcpEnd`, `dhcpLease` (hours), `dhcp_reboot_flag=1`, `mac_ip_reset=0` |
| Router IP change | the same `DHCP_SETTING` call with the new `lanIp`, the pool moved into the new subnet and `mac_ip_reset=1` |
| MTU / MSS | `SET_DEVICE_MTU`, `mtu`, `tcp_mss` (both are always sent) |

The router restarts after every LAN / DHCP and MTU / MSS apply. The console and Wi-Fi are away for about 1 to 2 minutes.

## This tool's own limits (stricter than the router)

- DHCP lease: 1 to 168 hours. The pool must sit inside the subnet and must not contain the router IP.
- Router IP: private IPv4, not the network or broadcast address, the pool keeps its host numbers, and the new IP must not fall inside the pool. The mask is never changed here.
- MTU 1280 to 1500. MSS at least 536 and at most MTU minus 40 (stock: 1500 / 1460).
- The MSS value applies to the router's own traffic (INPUT / OUTPUT rules). It does not clamp connected devices.

## Files on the device (`/data/local/matchitool/`, written by root, mode 600)

| File | Written | Used by |
|---|---|---|
| `wifi_backup.json`, `lan_backup.json`, `mtu_backup.json` | before each risky write, read back before anything is sent | "Restore saved values". "Forget backup" deletes the file |
| `lan_pending.json` | just before a router IP change: old and new IP, mask, pool, lease and the time | the host check after the restart (`LanRevert`); deleted when the check ends |

The APN tab has no backup file: its way back is the Auto button. If a backup cannot be written and read back, nothing is sent. Passwords stay in these files only and never reach the page log (the log redactors hide `Password`, `*_passwd` and `passphrase` keys).

## Router IP change: what the host does after the restart

1. The page tells the host the new address (`POST /api/net/lan-applied`, root-gated). Only the address named in the pending note is accepted.
2. The host waits up to 2 minutes and then decides:
   - the new address answers and reports the wanted values: keep, delete the note;
   - it answers with other values: send the OLD values back through the address that answers;
   - only the old address answers: the change never took effect, point the console back at it;
   - it answers but cannot be read: keep (never revert blind);
   - nothing answers: write nothing, the note stays until it is 30 minutes old.
3. Needs the router password saved in MatchiTOOL, because the revert signs in.

# F50 check: Network tools

Run on the F50 with a PC on the cable, adb ready, and the router password saved in MatchiTOOL. Write the result next to each line. Finish on the stock values: IP 192.168.0.1, pool .0.2 to .0.253, lease 24 h, MTU 1500, MSS 1460, mobile data on.

## Before
- [ ] GitHub Actions green on the pushed code (Validate, unit tests, debug and release builds).
- [ ] `node scripts/build-web.js --check` and `bash scripts/validate.sh` exit 0.
- [ ] Phone temperature and the existing tools noted before the test (SMS, Live Status, AT & Radio).

## Every control, with its way back
| Tab | Control | Pass when | Way back |
|---|---|---|---|
| Data | Off, then On | page stops, then loads again; status matches | On button |
| Wi-Fi | Band 2.4 / 5 GHz | band changes, reconnect works | switch back |
| Wi-Fi | SSID, max devices, hidden | values read back | Restore saved values |
| Devices | Rename | new name shows on the stock page | rename again |
| Devices | Block, Unblock | blocked device loses access, then regains it | Unblock |
| APN | Auto | data connects | (it is the way back) |
| APN | Save a profile in a free slot | profile read back, data works | Auto |
| LAN / DHCP | Pool and lease | router restarts, values read back | Restore saved values |
| LAN / DHCP | Router IP change | console opens at the new address | Restore saved values |
| LAN / DHCP | Forced revert (pending note, reboot) | old values sent back, note gone | change IP back with the tool |
| LAN / DHCP | DHCP Off, then Restore DHCP | PC gets an address again | Restore DHCP |
| MTU / MSS | Apply 1500 / 1459, then 1460 | router restarts, values read back, ping works | Restore saved values |

## Declined or refused
- [ ] A declined confirm sends nothing and writes no backup (`ls -l /data/local/matchitool`).
- [ ] Bad values are refused in each form (IP `x`, `8.8.8.8`, the current IP, an IP inside the pool; MTU 1200; MSS above MTU minus 40).
- [ ] "Forget backup" removes the file.

## After
- [ ] SMS tool, Live Status and AT & Radio still work.
- [ ] The phone is not hotter than before.
- [ ] The progress banner shows during the MTU / MSS and APN waits.
- [ ] Final state is the stock values listed at the top.

## AT channel (added 15 Nov 2026, after AT & Radio showed "no output" on the F50)
- [ ] Full diagnose, step "sendat architecture & execution": PASS. On a WARN or FAIL, copy the raw "sendat check" text (header bytes, size, hash, AT test exit code and output) with the log.
- [ ] AT & Radio, quick button **Signal quality**: prints a reply. If it prints nothing, Restart modem must refuse ("did not answer a plain AT ... nothing was changed") and no "Radio restarting" badge stays on the header.
- [ ] VoLTE / VoNR toggle: on failure the toast says what the modem replied, or that it did not answer AT.
- [ ] Advanced Network Diagnostics: every global IPv4 / IPv6 address is listed, default routes show (read from all routing tables), DNS lookup answers, IPv6 ping says "not supported" or answers.

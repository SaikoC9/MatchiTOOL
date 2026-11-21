# F50 check: Network tools

Run on the F50 with a PC on the cable, adb ready, and the router password saved in MatchiTOOL. Write the result next to each line. Finish on the stock values: IP 192.168.0.1, pool .0.2 to .0.253, lease 24 h, MTU 1500, MSS 1460, mobile data on.

## Before
- [x] GitHub Actions green on the pushed code (Validate, unit tests, debug and release builds).
- [x] `node scripts/build-web.js --check` and `bash scripts/validate.sh` exit 0.
- [x] Phone temperature and the existing tools noted before the test (SMS, Live Status, AT & Radio).

## Every control, with its way back
| Tab | Control | Pass when | Way back |
|---|---|---|---|
| Data | Off, then On | page stops, then loads again; status matches | On button |
| Wi-Fi | Band 2.4 / 5 GHz | band changes, reconnect works | switch back |
| Wi-Fi | SSID, max devices, hidden | values read back | Restore saved values |
| Devices | Rename | new name shows on the stock page | rename again |
| Devices | Block, Unblock | blocked device loses access, then regains it | Unblock |
| Devices | Limit speed | a speed test on that device shows the cap; the Limit column shows it as active | Apply with both fields empty (Unlimited) |
| APN | Auto | data connects | (it is the way back) |
| APN | Save a profile in a free slot | profile read back, data works | Auto |
| LAN / DHCP | Pool and lease | router restarts, values read back | Restore saved values |
| LAN / DHCP | Router IP change | console opens at the new address | Restore saved values |
| LAN / DHCP | Forced revert (pending note, reboot) | old values sent back, note gone | change IP back with the tool |
| LAN / DHCP | DHCP Off, then Restore DHCP | PC gets an address again | Restore DHCP |
| MTU / MSS | Apply 1500 / 1459, then 1460 | router restarts, values read back, ping works | Restore saved values |

## Limit speed (not yet run on a real F50; see [`LIMIT_SPEED.md`](LIMIT_SPEED.md))
Use a client on Wi-Fi and, if you have one, a second client on USB tether. Limit 1000 KB/s Download and Upload on one client only.
- [ ] A speed test from the limited client shows the cap in both directions; the other client is unaffected.
- [ ] The Limit column shows `Down 1000 KB/s, Up 1000 KB/s` and no "not on the phone" note.
- [ ] Unlimited (both fields empty) restores full speed and the Limit column shows `-`.
- [ ] A limit survives a phone reboot: after boot the speed test is capped again without opening the console.
- [ ] A hotspot restart: after the next Devices refresh the upload cap is back (the app re-applies what is missing).
- [ ] USB tether client: the same cap in both directions.
- [ ] Two limited devices at once, each with its own cap; removing one leaves the other.
- [ ] `tc filter show dev wlan0 parent ffff:` and the same for `usb0` still list `ttl_bpf` at pref 1 after Apply, after Unlimited and after the hotspot restart.
- [ ] Limiting the device that runs the console shows the warning in the form and in the confirm.
- [ ] A declined confirm sends nothing; bad values (7, 125001, 12.5, abc) are refused in the form.
- [ ] With another traffic setup on `br0` (root qdisc not `noqueue` or the app's own `htb`) the app stops and says so, and changes nothing.

## Declined or refused
- [x] A declined confirm sends nothing and writes no backup (`ls -l /data/local/matchitool`).
- [x] Bad values are refused in each form (IP `x`, `8.8.8.8`, the current IP, an IP inside the pool; MTU 1200; MSS above MTU minus 40).
- [x] "Forget backup" removes the file.

## After
- [x] SMS tool, Live Status and AT & Radio still work.
- [x] The phone is not hotter than before.
- [x] The progress banner shows during the MTU / MSS and APN waits.
- [x] Final state is the stock values listed at the top.

## AT channel (added 15 Nov 2026, after AT & Radio showed "no output" on the F50)
- [x] Full diagnose, step "sendat architecture & execution": PASS. On a WARN or FAIL, copy the raw "sendat check" text (header bytes, size, hash, AT test exit code and output) with the log.
- [x] AT & Radio, quick button **Signal quality**: prints a reply. If it prints nothing, Restart modem must refuse ("did not answer a plain AT ... nothing was changed") and no "Radio restarting" badge stays on the header.
- [x] VoLTE / VoNR toggle: on failure the toast says what the modem replied, or that it did not answer AT.
- [x] Advanced Network Diagnostics: every global IPv4 / IPv6 address is listed, default routes show (read from all routing tables), DNS lookup answers, IPv6 ping says "not supported" or answers.

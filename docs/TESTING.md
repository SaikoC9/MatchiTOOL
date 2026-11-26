# Testing: uninstall wipe

Current for MatchiTOOL 1.4.6.

Use scrcpy. Write the result of each below.

| # | Do | Expect |
| --- | --- | --- |
| T1 | Fresh install, switch ON. | `ps -A -o ARGS \| grep matchi_reaper` shows one. |
| T2 | Update to a newer build. | Nothing wiped. Still one reaper. |
| T3 | Downgrade. | Nothing wiped. |
| T4 | App info > Clear data. | Root files stay. Nothing wiped. |
| T5 | Uninstall from App info, no plugins. | All gone within about 1 minute. |
| T6 | Uninstall with the AdGuard plugin and Plugin guard on. | Process, `AGH_UI`, DNS redirect, boot lines gone. A hotspot client keeps DNS. |
| T7 | Uninstall while Wi-Fi is off by the auto switch. | Rest wiped. Wi-Fi stays off. `wifi_auto_off` gone. |
| T8 | Reboot, then uninstall. | Wiped (boot script path). |
| T9 | Uninstall, power off at once, power on. | Wipe finishes at boot. |
| T10 | Reinstall after uninstall. | Clean first start. No old leftovers. |
| T11 | Reboot with the app installed, several times, with and without screen lock. | Never wiped. |
| T12 | Power off in the middle of a wipe. | Next boot finishes it. |
| T13 | Speed limit on two devices, then uninstall. | `tc qdisc show dev br0` is stock. |

After T5 and T6 run each and expect no output:

```sh
ls /data/local/matchitool
ls /data/adb/service.d | grep matchi
ps -A -o ARGS | grep -i matchi
iptables -S | grep -i -e AGH -e 2334
ip6tables -S | grep -i -e AGH -e 2334
iptables -t nat -S | grep -i -e REDIRECT -e AGH
tc filter show dev br0 parent 1:
pm list packages | grep matchi
ls /data/data | grep matchi
```

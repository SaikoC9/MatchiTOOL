# Testing

Current for MatchiTOOL 1.4.5. This file replaces `TESTING_1.1.54_STABILITY.md`, `TESTING_1.2.0.md` and `TESTING_BOOT_CAPTURE.md`. A test counts as passed only when seen on the real F50 firmware; source checks do not certify runtime behaviour.

## 1. Automated checks (on a PC)

```sh
./scripts/validate.sh                 # page build, repo checks, route table, Node + shell tests, source tripwires
scripts/kotlin_pure_tests.sh           # the Kotlin tests that need no Android SDK (also run by validate.sh when java and gradle exist)
gradle :app:testDebugUnitTest         # all Kotlin unit tests (RootGateTest, HostControlTest, BootLogdModelTest, ...)
gradle :app:assembleRelease           # release build (R8 shrink)
scripts/check_release_apk.sh app/build/outputs/apk/release/app-release.apk   # manifest components, NanoHTTPD and assets survived R8 (CI runs it too); then install it and check the console starts
python3 scripts/phase0/test_round5_browser.py   # Chromium + Playwright, fake router; not part of validate.sh
node scripts/phase0/test_plugin_sandbox_browser.js app/src/main/assets/web/index.html   # Chromium + Playwright: sandboxed plugins; not part of validate.sh
```

What each covers is in the README ("Where the checks live"). The route table test (`scripts/test_route_gates.py`) must be updated whenever a route is added.

## 2. On the F50 (per release)

Run [`F50_CHECKLIST.md`](F50_CHECKLIST.md) and report any FAIL with the Radio report text. Also after installing a new build:

1. Console starts and routes answer; sign-in speed is acceptable (310,000 PBKDF2 iterations).
2. **Plugins > Root over HTTP...** works with HTTPS off; root calls from another device are refused (`insecure-off`) while it is off.
3. A plugin that calls `sha256` still works.
4. After stopping the host, the port 2334 ACCEPT rule is gone (`iptables -S | grep 2334`).
5. Root status reports UID 0 only after you approve MatchiTOOL in the root manager. Check command success, non-zero exit, timeout recovery, service restart and boot tasks.

## 3. Resource and leak checks

1. Run 20 short root diagnostics in a row; no more than the allowed concurrent root commands are accepted.
2. Start a deliberately slow root command and send another request: the UI gets a capacity message, not an endless pile of `su` processes.
3. Run a noisy command (over 1 MiB of output): the result says it was truncated, the `.matchi_out_*` temp file stops growing, and a small command works right after (the affected shell may be replaced). `ulimit -f` behaviour varies, so repeat on the real device.
4. Open and close Screen control 10 times; `ps -A | grep -E 'screencap|su -c sh'` shows the capture processes gone after viewers leave.
5. Leave the console idle for 15 minutes; the screen worker and persistent shells are released.

## 4. Live device status, thermal and diagnostics

Live device status only reads (CPU, memory, load, uptime, temperatures). Its temperature bands are advisory, not proof of throttling; a modem sensor may not be exposed.

1. Compare readings with the device's own values (battery sysfs, thermal zones, `ip addr`, `ip route`). Unavailable sensors must show as unavailable.
2. The monitor pauses when its panel is closed, another tool window is open, or the tab is hidden, and resumes after. Polling: router every 3 s, root every 15 s; slower when warm (6 s / 30 s) and hot (15 s / 90 s).
3. It makes no writes to sysfs, modem settings, firewall rules, CPU / GPU clocks, charging controls or vendor thermal services. The CPU Governor window is the one exception and writes only when you change something.
4. Network Diagnostics: gateway, public IPv4, public IPv6 and DNS are shown independently; with ICMP filtered or no IPv6 a failure is not presented as proof of no internet; no routes, DNS properties or firewall rules change.
5. Compare `ip route show table all`, `ip rule`, interface counters and DNS before and after opening the monitor: nothing changes.
6. Record battery temperature, modem thermal readings and ambient conditions at idle and during normal tethering; do not create heat or disable vendor protections.

## 5. Soak

- 24 hours of normal use with periodic dashboard use.
- Reboot 10 times: one host service, at most one screen worker, no duplicate boot watchers.
- Disconnect and reconnect hotspot and USB tethering: recovery without duplicate firewall rules.
- Save logs without credentials, session tokens, IMEI values or modem authentication data.

## 6. Boot capture (Log Catcher > Boot capture)

Needs root and Magisk (or KernelSU / APatch). Not yet verified on a real F50.

1. `/data/adb/service.d/` runs at boot: install, reboot, open Boot capture. State says Running and `context.txt` "started" is after boot.
2. The install self-test passes. If it says "not confirmed", read `events.log` and check `logcat -b all -d | head`.
3. If `dmesg -w` does not work, `events.log` shows "kernel source 0 ended" and the script falls back to `logcat -b kernel`, then `/proc/kmsg`.
4. The script starts through `setsid` and is not killed when the app's root shell ends (still Running a minute after install).
5. Force-stop and update the app: capture keeps going; the script is re-installed only when its version header changed.
6. Fill /data close to the minimum free space: state becomes paused-low-space and resumes when space returns.
7. Each `su` call may show a Magisk toast; install and status use one call each.
8. SELinux: do not rely on permissive. Check `getenforce` in `context.txt` and that files are written while enforcing.
9. Viewer: with boot capture on, the Log Catcher session list shows `logcat.log` / `dmesg.log` under "Boot capture". Lines show time, PID / thread, level, tag; Prev / Next / Latest and "Go to time" work; the counters line shows boot line counts.
10. Counters: with device capture on, seen / shown / collapsed / dropped / gaps grow per source. Any `quiet_*` WARNING is a failure that used to be swallowed silently: report it.

## 7. Wi-Fi off while USB tethering is on

The F50 has no screen, so everything is done from another device. You need the router on its own power, a PC on USB with adb, a phone to watch the Wi-Fi list ("CE 2" below is the hotspot name; use yours), and the router password saved in the app. Keep the PC on USB for the console: the hotspot goes away during these tests.

A **half-unplug** means pulling the cable just far enough to lose data while power stays. A full unplug switches the router off. adb does not work while the cable is half out, so read the log afterwards:

```sh
adb shell su -c 'tail -40 /data/local/matchitool/wifi_auto.log'
adb shell su -c 'cat /data/local/matchitool/wifi_auto_off'   # exists = the app turned Wi-Fi off
```

Switch ON in the app for every test unless it says otherwise.

| Test | Do | Pass when |
|---|---|---|
| T1 | Start tethering. | Wi-Fi is off within 25 s. The state file reads `band=5g` (or `2g`). |
| T2 | Half-unplug the cable. Repeat 3 times without a power cycle. | Wi-Fi is back within 25 s each time. The state file is gone. |
| T4 | Keep the cable in. Disconnect the adapter on the PC (`nmcli device disconnect <interface>`). | Same as T2. |
| T5 | Turn Wi-Fi off by hand, then start tethering, then half-unplug. | Wi-Fi stays off. No state file. |
| T6 | Reboot the router while tethered with Wi-Fi off. Cable stays in. | Wi-Fi stays off after the boot. The state file is kept. |
| T7 | Tether with Wi-Fi off, then unplug everything and power the router from the wall only. Repeat 3 times. | Wi-Fi is back about 90 s after power-on (`Root fallback` in the log). The state file is gone. |
| T8 | While tethered, turn Wi-Fi on by hand. | Wi-Fi stays on. The log shows `DROP_STATE`. |
| T9 | Turn the switch off while the app is holding Wi-Fi off. | Wi-Fi is back at once. |
| T10 | While tethered, kill the app (`kill -9 $(pidof com.matchi.tool)`). Do not use force-stop: it keeps the app stopped until you open it. | The app restarts by itself, the state file stays and Wi-Fi stays off. |
| T11 | Tether for 30 minutes or more (the known failure came after 7 hours), then half-unplug. | Wi-Fi is back within 25 s. The log shows `Wi-Fi set reply` with `result : success`. |

If a test fails, keep `wifi_auto.log` and the state file and report both. After a half-unplug the PC can stay on "Setting network address"; disconnect and connect the adapter again, or power-cycle the router.

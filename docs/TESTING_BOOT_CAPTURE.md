# Boot capture - checks to run on the device

1. Magisk (or KSU) present and `/data/adb/service.d/` is run at boot: install, reboot, open Boot capture: state must say Running and `context.txt` "started" must be after boot.
2. Install result shows the self-test passing. If it says "not confirmed", read `events.log` and check whether `logcat -b all -f ... -r -n` works on this firmware (`logcat -b all -d | head`).
3. `dmesg -w` works? Otherwise `events.log` shows "kernel source 0 ended" and the script falls back to `logcat -b kernel`, then `/proc/kmsg`.
4. The script starts through `setsid`; confirm it is NOT killed when the app's root shell ends (status stays Running a minute after install).
5. Force-stop and update the app: capture must keep going; after the update the script is re-installed only when its version header changed.
6. Fill /data close to the minimum free space: state changes to paused-low-space and resumes when space returns.
7. Each su call may show a Magisk toast; install and status use one call each.
8. SELinux: do not rely on permissive; check `getenforce` in `context.txt` and that files are written while enforcing.
9. Build first: `./gradlew testDebugUnitTest` (QuietTest, LogLineParserTest, SourceCountersTest, BootLogdModelTest, NoiseGateTest must pass).
10. Viewer: with boot capture on, open the Log Catcher session list: logcat.log / dmesg.log files appear under "Boot capture". Open one: lines show time, PID/thread, level, tag; Prev/Next/Latest and "Go to time" work; the counters line shows boot line counts.
11. Counters: start a session with device capture on; the line under the selector shows seen/shown/collapsed/dropped/gaps per source and they grow. `quiet_*` WARNING entries, if any, are failures that used to be swallowed silently: report them.

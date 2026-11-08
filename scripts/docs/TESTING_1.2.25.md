# Testing 1.2.25 (old leftovers)

1. Fake an old layout (adb/su): start `sh /data/local/matchitool/dpi/dpi.sh watch` from a copy of any script that has the header line `# UFI anti-DPI helper`, and add `sh /data/local/matchitool/dpi/dpi.sh start >/dev/null 2>&1 &` to boot.sh.
2. Open Bypass: a toast says leftovers were found. Quick setup > **Run check** > **Copy report** has an OLD LEFTOVERS section.
3. Quick setup > **Clean old leftovers**: the list matches step 1; press Clean up. Then `ps -A | grep -E 'ttl.sh|dpi.sh|nfqws'` shows no old-path process, the old script is a stub, the old boot line is gone, and your current boot entry (if on) is still there.
4. Press the button again: "No old leftovers found". `cat /data/local/matchitool/events.log` lists what was removed.
5. Stop everything and Apply also clean old leftovers.
6. On a PC: `bash scripts/test_legacy_cleanup.sh` (also run by `scripts/validate.sh`).
7. Dry run (adb/su, with the helper's `LEGACY_SH` loaded): `LEGACY_DRY=1 legacy_clean` prints WOULD_* lines and changes nothing; `legacy_scan` gives the same list before and after.

# Testing 1.2.24 (Bypass stays off)

Run on the device after installing, with root granted.

1. Bypass > **Strong**. Check TTL and Anti-DPI show active, boot auto-apply on.
2. Bypass > **Stop everything** (or Remove on a tab). The toast must say boot auto-apply is off too.
3. Full report > `boot line: none`, `keep-alive: stopped`, `off switch: ON`, no `nfqws` process, no `UFI_DPI` / `UFI_TTL` chains.
4. **Reboot the device.** Wait 2 minutes. Run the report again: everything must still be off.
5. Close the page, open it again, open Bypass: still off (opening it never applies anything).
6. Press **Strong** again: rules come back, `off switch: not set`, boot auto-apply on.
7. Orphan test (optional, adb/su): `kill -9` the keep-alive, delete `watch.pid`, press Stop: no `ttl.sh watch` / `dpi.sh watch` process may remain (`ps -A | grep -E 'ttl.sh|dpi.sh|nfqws'`).

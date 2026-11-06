# Changelog

## 1.1.35 - IMEI read-out after restart, SMS delete of sent messages, faster delete
- **IMEI showed "unknown" while "Kept after reboot ... (active)".** Right after Apply saved IMEI / Change IMEI the modem restarts and does not answer for about 30 s, and the window then showed "unknown" and wrongly claimed "(active)". The IMEI is now read with `AT+CGSN`, `AT+CGSN=1`, `AT+GSN` and, last, Android's phone service; while the modem is silent the window shows "reading..." and asks again every 4 s (up to about 50 s). "(active)" is only shown when the modem really reports the saved IMEI; otherwise it says the modem reports a different IMEI or could not be read.
- **Delete of your own (sent) messages.** The message is now found in Android's SMS store / modem storage by number + text, then by text + time (sent messages can be stored without a usable number), then as the only outgoing message with that text. Senders without digits (DITO, GCASH) are no longer treated as the same number. If no store has the message at all, it is hidden from the list (kept in this browser, "Show N hidden messages" brings them back) and the toast says it was only hidden; the files that contain its text are listed in `/data/local/matchitool/sms_delete_debug.txt` on the router to find the real store.
- **Delete is much faster.** The row disappears at once and returns with the reason if the delete fails. The router's "ignores set calls" state is remembered for an hour (it was forgotten at every page load). Android's SMS store is read in the background when the list loads, so Delete needs one root call; the method that worked last (root / phone / system) is tried first and "Deleted 1 rows" is trusted without a second read. Android store and modem storage are looked up in parallel. The router list is re-checked in the background after the delete.
- **Bypass window cut off on the right (phone).** The window's id sits on the full-screen overlay and the plugin gave it `width:94vw`, so on a phone the overlay stopped 6% short: the right strip was not covered and the box sat off-centre. The overlay is now full width and only the box is limited (600 px), centred on both phone and PC.
- **Compact UI (PC and phone).** Smaller base text (13 px), shorter header, tighter cards and popups (padding 14 px / 12 px on phone), shorter buttons and inputs (32 px / 34 px instead of 40 px / 43 px), smaller toasts, popups sized to the screen with dynamic viewport height so phone toolbars no longer hide the Close button.
- **Live Status button removed** (the Live device status panel on the Device overview card stays and is the only view; its popup was a duplicate). Full diagnose now checks the panel instead of the button.

## 1.1.34 - IMEI survives reboot, SMS send/delete fixes, Close buttons bottom-right
- **IMEI kept after reboot.** The firmware can put the factory IMEI back at boot, so `AT+SPIMEI` alone did not last. Change IMEI / Restore first-seen now also save the chosen IMEI on the router (`/data/local/matchitool/imei_target.txt`). At every boot the app waits for the modem and, if it reports a different IMEI, writes the saved one again (max 3 tries per slot, then restarts the modem). New **Apply saved IMEI now** button runs the same keeper on demand and the AT & Radio window shows what is kept.
- **Close buttons** are now at the bottom right of every window (Device diagnostics, Full diagnose, USB controls, Firmware inspector, Root terminal, Built-in tools and all tool popups) and stay visible while the content scrolls.
- **SMS send via Android, Android 13 order:** the F50 reports sdk 33 and accepted the call with transaction 5 but the sent box stays empty for a non-default SMS app, so that is no proof of failure. Transactions are now tried in the order 6, 7, 5, 8 on Android 13, a success reply counts as sent (telephony log lines are shown), and the working form is no longer hidden behind a sent-box check.
- **SMS send via Android.** The router ignores every "set" here and sendat cannot pass Ctrl-Z, so Send now goes router (skipped once it is known dead) -> Android telephony (`service call isms` as the phone / shell user, checked in the sent box so it is never sent twice) -> modem AT.
- **Delete is fast again (10-15 s -> a few seconds).** One router try; when it answers with an empty body the router is skipped for 10 minutes and the Android SMS store is used first.
- **Modem info** used `ATI`, which this modem rejects (`+CME ERROR: 4`). It now runs `AT+CGMI`, `AT+CGMM` and `AT+CGMR`.
- **Network debug** read only 4 files because the router page is a RequireJS app (`data-main`, modules without `.js`). Detection now follows the main module and the modules it lists.
- **Network debug detection** found nothing (`goformIds: (none)`, `lteSet:false`) because the router's index page and its scripts do not contain the band-lock commands. Detect now follows html / json / template files too (up to 80), accepts more goformId spellings, and when the page has no band-lock text it searches the router's own web files on the device as root and reads the ones that mention band lock or neighbor cells. The report lists every file read and every goformId on the page.
- **SMS send (router):** requests now look like the router's own page (browser User-Agent / Accept headers, field order isTest first and AD last, `GSM7_default` for plain GSM text, `UNICODE` otherwise).
- **SMS send (modem):** more Ctrl-Z forms are tried and the error lists the reply of every form, so the exact sendat answer can be seen.
- **SMS delete (Android store):** when plain root is refused, delete is retried as the phone (1001) and system (1000) users and directly in the telephony database (if sqlite3 exists), each verified.

## 1.1.33 - SMS delete / send failures (empty router reply, modem "Unsupported escape sequence")
- **Delete:** when the router answers a delete with an empty body, the host now retries with a fresh router login, then with the upper-case form of the AD token, and checks the message list after each try. If the router still refuses, the message is looked up in every modem storage (loose text match, so long or re-wrapped texts are found) and then in Android's SMS store, and deleted there. Success is only reported when the message is really gone from the router's list.
- **Send via modem:** sendat rejected the command built with real CR / Ctrl-Z bytes (`500 Unsupported escape sequence`). The terminator is now also passed as `\x1a` / `\u001a` escapes that sendat decodes itself; the next form is only tried when sendat rejected the command text, so a message is never sent twice.
- **AT & Radio: Change IMEI.** Shows the current IMEI, accepts a new 14 or 15 digit IMEI (check digit validated / added), asks for confirmation, writes it with `AT+SPIMEI=<slot>,"<imei>"` and restarts the modem (`AT+CFUN=1,1`). The current IMEI is backed up on the router (`/data/local/matchitool/imei_backup.txt`) and in the browser before anything is written; no write happens if the current IMEI cannot be read or the backup fails; the modem restart is a separate confirmation. **Restore first-seen** writes the earliest recorded IMEI back.
- **Reboot** moved from Device status to the right of CONTROL CENTER on the home card.
- **Network debug rewritten as a native tool** (4G / 5G band lock, neighbor cells, cell lock, locked cells, in MatchiTOOL's own style). It reads the command names from the router's own web page (`Detect commands`, new read-only `/api/zte/page`) and only sends a command that page uses; 4G band lock is wired, the rest stays disabled until its command is identified (Copy report). Selecting no band is refused.
- New optional `retry` field on `/api/zte` (0 = normal, 1 = fresh login, 2 = fresh login + upper-case AD).

## 1.1.32 - SMS delete and message text fixes
- **Network debug** (new button on the home card): the router's own Network Debug page (4G / 5G band lock, neighbor cells, cell lock, locked cells) opens inside MatchiTOOL, with an Open in new tab button if the router refuses to be framed. MatchiTOOL sends no radio command itself: the router applies the changes with its own firmware commands, so nothing is guessed.
- **Live device status is compact:** the 5G NR / 4G LTE box shows RSRP, RSRQ and SINR side by side in one slim row with band, PCI and channel in its header, the three temperatures are one small row of chips, and the signal card is smaller, so the whole panel takes about half the height.
- **Send no longer dead-ends on "Send failed: unknown":** if the router refuses (or does not answer) the send, the message is sent through the modem (AT commands as root) instead; only if both fail you get an error with both reasons.
- Router errors now carry a short diagnostic in brackets (AD token ok/missing, session yes/no, HTTP code, start of the reply), so a refusal can be traced.
- **Same dialog style in the Android app:** the Enable LAN access confirmation (home screen and Access & security) now uses the app's dark dialog (Cancel / red Enable) instead of the plain system dialog, and its text says "router admin password" instead of "access token".
- **Confirm dialogs match the app:** the browser's plain "192.168.0.1:2334 says" box is replaced by an in-page dialog in the app's dark style (Cancel / red action button, Esc or a click outside cancels) for Delete message, Delete plugin, Reboot, Remove nfqws and the USB mode changes.
- **Root cause of "Delete does nothing" (and Send via the router):** the F50 firmware ignores every router "set" request that has no AD token and answers with an empty body (the error said `router said: empty reply`). The host now adds the token the router's own web page uses, `AD = md5(md5(wa_inner_version + cr_version) + RD)` with a fresh RD per request, to every set call.
- The SMS popup no longer has the Router settings box (gateway / password): the router password is learned automatically and the gateway is 192.168.0.1.
- **Blue flash on tap/click (phone and PC):** tapping a button, toggle or tool flashed a blue box for a moment. The page now turns off the browser's tap highlight and the focus ring / text selection that a mouse click leaves, for every button, switch, link and summary (keyboard focus still shows a ring). The Bypass window already did this for itself; it now applies everywhere, including SMS, Live Status and the other tool popups.
- **No password to enter in the app.** The web console now signs in with the router's own admin password (the exact one for 192.168.0.1): the host checks what you type against the router itself, and when the router accepts it the password is remembered for the SMS / signal tools. It also follows a changed router password (a typed password the router accepts replaces the stored one). On start the app additionally tries to read the router's password as root (`nv get admin_Password`) and keeps it only if the router accepts it. The Router gateway, Router password and Access token cards are removed from the app (Access & security keeps only LAN access; the home screen no longer has a Router password row; the gateway stays 192.168.0.1). After 3 bad logins from one address the router is no longer asked, to avoid its own lockout.
- **SMS Delete now works and tells you the truth.** The router often answered "success" (or an empty reply) without deleting anything, and the tool then just refreshed the list, so the message came back. Delete now checks the router's answer, retries with the other message-id format, confirms the message is really gone from the list, and falls back to deleting it from the modem storage by AT command. If everything fails you get an error with the router's reply instead of nothing.
- Messages shown from Android's own SMS store can now be deleted too (as root, by `_id`); before, Delete always said it was not supported.
- Modem delete retries with `AT+CMGD=<idx>,0` for modems that need the flag.
- **SMS text shown as random letters** (`SGkhIFlvdXIg...`): some firmware returns the message body as base64 (UTF-8). It is now decoded automatically, only when the result is clean printable text, so normal messages are never altered.
- Delete button shows "Deleting..." while working and a "Deleted" confirmation.
- **Router session expiry:** the router drops idle web sessions but still answers a "set" made with the dead cookie with HTTP 200 `{"result":"failure"}`, so Delete / Send SMS silently did nothing after a few idle minutes (only a restart helped). The app now signs in again when the session has been idle for 2 minutes, before the call is made, so a "set" is never repeated.
- **Web host start crash:** switching LAN access restarts the host, and if the old instance still held port 2334 the new one threw inside the service and crashed it. Start now retries for several seconds off the main thread.
- **Root shell:** a shell killed after a timeout could still be handed to the next command for a moment (process destroy is asynchronous), causing a spurious failure; killed shells are now marked dead at once. The temp output file of a timed-out command is removed instead of left in `/data/local/tmp`.

## 1.1.31 - Router API port auto-detect (fixes SMS / signal on the F50)
- The F50 has nothing listening on port 80, so every router web API call failed with `Failed to connect to /192.168.0.1:80`. The app now probes 80, 8080, 9090 and 9999 for the ZTE goform API and uses the first that answers (cached, re-detected after a failure).
- The Router gateway setting also accepts `host:port` (e.g. `192.168.0.1:8080`) to force a port.
- New built-in tool **Clean memory** (button on the home card, needs root): stops background third-party apps (never the foreground app, launcher, keyboard or MatchiTOOL), trims the system and reclaims memory, then reports how much was freed. Full diagnose lists it under Built-in tools without running it.
- **Bypass speed:** closing the Bypass window now really stops its background checks (they kept running every 30 s and made the next open queue behind them). Internet / DNS tests run in parallel and give up after about 2 s instead of 3-8 s each. Opening skips the duplicate re-read and checks the helper scripts at most every 10 minutes. Standard / Strong / Off repaint right after applying and run the internet test in the background. The automatic check also skips a round while the root shell is busy.
- **Persistent root shells (all tools):** the host now keeps up to 3 root shells open and feeds scripts to them, instead of starting `su` for every command (150-400 ms each on a hot device, and Bypass / Live Status / SMS / diagnose issue dozens). Each script still runs in its own child shell, so `exit` or a failing command cannot end the session; output goes through a temp file so a background daemon cannot pollute a later result; a timeout closes that shell and the next command opens a fresh one; if all shells are busy or one cannot start, the old one-shot `su` path is used.
- **USB crash fix:** the 6 `FATAL EXCEPTION ... IllegalArgumentException` entries in the crash log were the USB controls running `svc usb setFunctions` with combinations Android rejects (`mtp,adb`, `ecm`; svc accepts exactly one plain function). **Tether off** now restores the default mode through `sys.usb.config` (same path as enabling), and `svc` is only a fallback with a single valid function (`rndis` / `mtp` / `ptp` / `midi` / `ncm`). Full diagnose now names this crash instead of "none identified".
- **Bypass reopens instantly:** closing the window now only hides it, and opening it again shows the same window (about 50 ms, one background ping) instead of rebuilding it and re-running about 7 root commands. The root check runs once, the iptables support probes (TTL, MSS, NFQUEUE, connbytes - each creates and deletes a chain) run once instead of on every refresh, and the 30 s auto check is a ping only, with a full re-read every 2 minutes.
- **Bypass no longer waits for the internet test:** with no working internet every ping runs into its timeout, and the DNS lookup of `google.com` can hang 10 s or more, and the test sat in the same queue as the buttons, so a click right after opening waited behind it. The test now runs on its own root shell, pings the IP first (2 s at most) and the name only if that works (4 s at most), and a reopen within 60 s does not run it again. Simulated with 4 s pings: Standard right after reopening finishes in 0.7 s.
- **Less heat:** Live Status polls every 10 s instead of 5 s, reads the four modem AT values in one call (new `/api/at/batch`) instead of four, and refreshes the heavy `dumpsys telephony.registry` only every 30 s. The app's own Live signal card refreshes every 15 s instead of 8 s.
- **Live Status** pauses its 5 s polling while another tool window is open, so tools no longer compete with it for the root shell.
- Full diagnose no longer warns about port 80 when another usual router port is listening.

## 1.1.30 - Native app redesign and launcher icon (app screens only)
- New home screen: Live signal card (bars, dBm, quality, network badge, operator and registration, RSRQ / SINR / battery; refreshes every 8 s while open), Open web console button, Router page link, and the Access & security group (Root access badge, LAN access switch, Web admin password row). Footer shows the installed version.
- New **Access & security** screen (opened from the Web admin password row): Router gateway, Web admin password (Save / Remove), LAN access switch with warning, Access token (masked, Copy / Reset).
- The app now has a launcher icon (adaptive, plus themed/monochrome icon on Android 13+) and a proper notification icon, so it no longer shows the default Android icon after install.
- **One password:** the separate web admin password is gone. The app now stores the router's own admin password (192.168.0.1) and uses it to sign in to the web console and for the SMS / signal tools. Any length is accepted (ZTE defaults can be short). The access token still works until a router password is saved.
- **Login lockout fix:** only bad logins count toward the "Too many attempts" lockout. A browser tab with an old session token no longer locks out the real login after the password or token changes.
- Scrollbars are hidden everywhere in the web console (page, popups, Full diagnose report, terminal). Scrolling still works.
- Dark theme for all native screens. The web console, its logo and every tool are unchanged.

## 1.1.30 - Live device status on the Control Center
- The Control Center (Device overview) card now ends with a **Live device status** panel that is always visible and refreshes by itself every 5 seconds (paused while the tab is hidden). No button press needed. The **Live Status** button still opens the same data in a larger popup.
- New design: signal-bar icon (0-5 bars, coloured by quality) with the dBm value, operator and network badge (5G NSA / 5G SA / 4G LTE), battery icon with charging state, 5G NR and 4G LTE boxes with RSRP / RSRQ / SINR quality gauges, band, PCI and channel, and battery / system / modem temperature tiles. Works on phone widths.
- Data fixes: signal bars now come from RSRP (5G first, then LTE), then the router's bar count, Android's signal level and finally CSQ (shown as RSSI); the router's `rssi` is no longer shown as LTE RSRP; blank router values are no longer read as 0; the shell and modem reads run in parallel so a refresh is faster; the router API is retried every 3 minutes instead of every minute.

## 1.1.29 - SMS works when the router web API (port 80) is unreachable
- On the F50 the app cannot connect to the router web API at `192.168.0.1:80`, so SMS always showed `Failed to connect to /192.168.0.1:80` no matter what admin password was saved (the password is never reached when the connection itself fails).
- **No login needed:** with no router password saved, the SMS tool skips the router login entirely and works through the modem's AT commands (`sendat`, as root): read (`AT+CMGL`, ME then SM storage), send and delete (`AT+CMGD`). If a router password is saved, the router API is tried first and the modem is the fallback (retried once a minute).
- **Send in PDU mode (UCS2):** any character works and long messages are split into concatenated parts (up to 10, about 670 characters). The old 70/160 character limit is gone.
- **Inbox backup:** if the modem storage is empty, messages are read (read-only) from Android's own SMS store as root.
- Router connect timeout lowered to 2.5 s so the fallback is quick.
- Wrong-password and other router errors are still shown as-is (no silent fallback for those).
- The host now reports connection failures as `Router web API unreachable at <host>:80 (...)` instead of a raw socket error.

## 1.1.28 - Diagnostics, Full diagnose, USB and Firmware as popups
- Device diagnostics, Full diagnose, USB controls and the Firmware manifest inspector are no longer on the main page. Control Center buttons open each as a popup (Close button, click outside, or Esc). Full diagnose uses a wider popup for the report.
- Element ids are unchanged, so every control and the diagnose itself work as before.

## 1.1.27 - Root terminal and plugins as popups
- The Root terminal and Built-in tools / custom plugins cards are no longer on the main page. Control Center has two buttons, **Root terminal** and **Built-in tools & plugins**, that open each one as a popup (close with the Close button, a click outside, or Esc).
- The cards keep their element ids, so the tools, plugin upload and Full diagnose work as before.

## 1.1.26 - Bypass window footer always visible on desktop
- On desktop widths the Bypass window overflowed by about 50 px (the scroll area's height ignored the footer bar), so Run check / Copy report / Close sat under the window's own scrollbar. The scroll area now takes the remaining space and the footer stays pinned. Phone layout unchanged.

## 1.1.25 - Device diagnostics report clarity
- Tool list now prints `name: path` for every tool (found paths had no name before). `sendat` and `nfqws` are looked up in their real app locations instead of PATH, so they no longer show as unavailable when installed.
- Added policy routing rules, default routes in all tables and DNS properties (the main table has no default route on this firmware, which looked like a fault).
- Storage section explains the bind-mount mount point and shows the real /data device.

## 1.1.24 - Top menu removed
- Removed the duplicate top navigation bar (Overview, Diagnostics, Full diagnose, USB, Firmware, Terminal, Plugins); the Control Center buttons cover it. The Host connected status stays on the right.

## 1.1.23 - Bypass toggle switches on desktop
- The Block QUIC / Auto-apply switches were stretched into tall blocks on desktop browsers because the page's global `button`/`input` min-height and padding applied to them (only touch screens reset it). Switches now keep their 36x20 / 32x18 size on every screen.

## 1.1.22 - Diagnose: no-load detection
- Reverted the 1.1.20 rule that treated a little observed traffic as working data. If ping and DNS both fail while the SIM is registered with an active data session, the diagnose now FAILs and names the likely cause (no load/balance or data plan).
- Bypass self-test advice no longer blames nfqws when the SIM has no load.

## 1.1.21 - Diagnose: charger watchdog false alarm
- Kernel scan no longer flags the charger IC message `set watchdog timer 0s`; it only matches real watchdog bite/timeout/reset and lockups.
- Crash scan now shows the exception text and warns when 3 or more app crashes are logged since boot.

## 1.1.20 - Diagnose: false alarms removed (from a real F50 report)
- APN check accepts the unquoted `+CGDCONT` format the modem prints.
- `AT+CSQ` = 99 is no longer a "no signal" failure while registered (normal on 5G NR).
- Kernel scan no longer matches `debug:`; the crash scan names the crashed process and only warns if it is MatchiTOOL.
- Internet/uplink checks treat real traffic (rx bytes, live connections) as proof data works when ICMP ping is blocked; interface errors are judged by error ratio, not raw count.
- Blocked-process threshold raised (kernel threads in D state are normal on this device).
## 1.1.19 - Full diagnose: real malfunction detection (32 -> 55 checks)
- Every WARN/FAIL now carries a **Fix** line, and the report adds **Probable root causes** and **Since last run** (new / fixed problems).
- New device-health checks: root speed, SELinux, clock drift, temperatures (all thermal zones + battery), battery health, memory/CPU/blocked processes, read-only or full `/data` and inodes, kernel/crash log scan, core services (system_server, netd, rild, dnsmasq, hostapd).
- New hotspot/network checks: br0 + IP forwarding + NAT, uplink MTU/IPv4/errors, IP vs DNS failure, interface error counters.
- New modem checks: SIM present/locked, radio mode (CFUN), registration (LTE/5G/CS, denied/searching), packet attach, PDP/APN, signal (RSSI/RSRP), modem latency, router modem state.
- New host/page checks: parallel-request stability, port 2334 binding, 404 handling, boot.sh syntax and last boot result, `sendat` CPU architecture and execution, plugin/tool syntax compile (nothing executed), duplicate element ids, uncaught JS errors.
- Still strictly read-only.
## 1.1.18 - Full diagnose: fixes from a real F50 report
- AT checks: `sendat` returns `OK` glued to the data (`+CSQ: 99,99OK`); the diagnose expected a separate word and wrongly reported every AT query as failed. It now matches `OK` at the end and flags real `ERROR` replies. `AT+CGMM?` (a typo) is now `AT+CGMM`.
- Internet check: the F50's main routing table has no default route, so a plain ping from the root shell fails instantly. The check now also pings through the detected uplink interface and reports that case as reachable.
- New check "Router web server ports" lists the device's listening TCP ports, to show whether anything serves the router web API on port 80.

## 1.1.17 - Full diagnose
- New **Full diagnose** card on the web page (also in the top menu and on the home card). One button runs 32 read-only checks across every function: login/session, browser features, page controls, root shell, shell failure reporting, device info, storage, system commands, host diagnostics, USB status, USB/AT/plugin input validation, `sendat`, AT on both SIM slots, router web API and SMS storage, plugin manager, the six built-in tools (loaded, button present once, and the data path each one needs), the firmware inspector and internet reachability.
- Results are PASS / WARN / FAIL / SKIP with a "Needs attention" list at the top. Each check has its own timeout, so one hung command cannot freeze the run.
- **Copy report** puts the whole report on the clipboard (with a fallback for plain-HTTP LAN pages where the browser has no clipboard API, and an auto-select if the browser blocks copying). **Download .txt** saves it as a file.
- Nothing is changed on the device: no USB/ADB switching, reboot, SMS send/delete, Bypass apply or router writes. The report never contains the token or any password.
- The page now checks its own version against the app's, and warns if a cached old page is being shown.

## 1.1.16 - Tools built into the web page
- Bypass, Device Status, AT & Radio, SMS, Signal Info and Live Status are now embedded in the web page (`web/index.html`) and load automatically after login. No uploading, no `plugins/` folder, no APK-side tool files or `/api/builtin` endpoint.
- The page lists them under **Built-in tools**; **Custom plugins** is only for scripts you upload yourself.
- If copies of these tools were uploaded earlier (or left by old versions), the page removes them from the device so nothing loads twice.
- Updating the tools means editing `index.html`; they arrive with the app because the page ships in the APK.

## 1.1.15 - Tools are web-only again
- Bypass, Device Status, AT & Radio, SMS, Signal Info and Live Status are no longer built into the APK. They live in the `plugins/` folder of the repo and are installed from the web page (Plugins card -> choose file, several can be selected at once).
- Removed the `/api/builtin` endpoint, the `assets/builtin` folder and the "Built-in tools" section. The app no longer deletes plugin files on start.
- To update a tool, upload its new `.js` (same file name replaces the old one). App updates no longer change tools.
- The `sendat` binary stays in the APK because AT & Radio needs a native executable.

## 1.1.14 - Built-in tools (no longer plugins)
- Bypass, Device Status, AT & Radio, SMS, Signal Info and Live Status are now built into MatchiTOOL. They ship inside the APK (`assets/builtin`) and are served by a new `/api/builtin` endpoint, so an app update always updates them: no more copying to the device, no stale versions, and they can no longer be disabled or deleted by accident.
- The web page lists them under **Built-in tools**; **Custom plugins** is now only for scripts you upload yourself.
- Copies of the old bundled plugins left on the device by earlier versions are removed on start so nothing loads twice.
- Bypass wording that referred to UFI-TOOLS now refers to MatchiTOOL.

## 1.1.13 - USB mode switching for the F50
- On the F50, `svc usb setFunctions` is killed (exit 137). USB modes are now switched by setting `sys.usb.config` (trying `<fn>,mtp,adb` first, then `<fn>,adb`) so init applies the configfs change; `svc` is only a time-limited fallback.
- Success is now verified in configfs (the function must be linked into the active gadget config) before the interface is bridged into `br0`.
- The output always lists the active gadget functions and USB network interfaces so a failure can be diagnosed.

## 1.1.12 - USB Ethernet bridging and quieter Live Status
- RNDIS / CDC-ECM modes now also bring the new USB network interface up and bridge it into `br0` (the hotspot LAN), then report the resulting interfaces. Previously only the gadget function was switched, so the PC saw no working network. The action now fails with a clear message if the USB config does not actually change.
- Restore default USB mode removes the interface from the bridge first.
- Live Status no longer shows the unreachable router web API as an error; it is noted in the raw panel and the status line shows which source is used.

## 1.1.11 - Admin password login
- The web page now logs in with an admin password set in the app (new "Web admin password" card) instead of the random token. The password is stored only as a salted PBKDF2 hash.
- Until a password is set, the login still accepts the access token, so nobody is locked out after updating.
- New `/api/login` endpoint shares the existing per-IP lockout (8 bad attempts = 1 minute). Setting, changing or removing the password rotates the token and signs out existing web sessions.
- The long-press token dialog is unchanged and still works as a recovery path.

## 1.1.10 - Live Status works without the router web API
- On the F50 the router web API on port 80 was unreachable from the app, so every Live Status field showed a dash. Live Status now falls back to the modem's AT commands (operator, registration, signal) and Android telephony (`dumpsys telephony.registry`) for RSRP/RSRQ/SINR.
- The router web API is retried only once a minute after a failure, so it can't stall each refresh.
- Modem temperature now comes from the nr/modem thermal zone.
- Added a collapsible raw-output panel to help diagnose fields that stay blank on a given firmware.

## 1.1.9 - USB error visibility
- USB control failures returned HTTP 400, which made the web UI show only "Request failed (400)" and hide the real reason. They now return 200 with `success:false`, so the command output is displayed.
- On failure the output now includes the exit code, whether `svc` exists, and the device's USB properties.

## 1.1.8 - LAN access switch
- Added a LAN access card to the app screen (with a warning dialog). Turning it on makes the web UI reachable from devices on the F50 hotspot at `http://<F50 IP>:2334`; it restarts the web server automatically.
- When LAN is on and no Wi-Fi client IP exists (the F50 is the hotspot), the app now shows the router address instead of "Wi-Fi unavailable".
- LAN access stays off by default.

## 1.1.7 - Web Live Status plugin and fixes
- Added the read-only `Live_Status.js` dashboard plugin (modem signal/band, battery, thermal).
- Fixed overlapping refreshes: polling now skips a tick while the previous request is still running, so slow modem/shell reads no longer pile up on the host.
- Fixed polling continuing after the dialog closed; the timer now stops itself.
- Fixed modem/shell errors being overwritten by the "Last updated" line; errors now stay visible.
- Bumped versionCode to 117 / versionName to 1.1.7 (also `/api/ping` and `scripts/validate.sh`). Bundled plugins only refresh on installed devices when versionCode changes, so this bump is required for plugin fixes to reach the app.
- CI now runs `bash scripts/validate.sh`, so it no longer depends on the file's executable bit.
- Fixed Kotlin compile errors in `WebServer.kt`: shell variables `$x` and `$BASE` inside Kotlin strings were being read as Kotlin templates; they are now escaped.

## 1.1.6 - Version metadata alignment
- Corrected Android versionName to 1.1.6 and incremented versionCode to 116.
- Corrected the `/api/ping` version response to report 1.1.6.
- No device-control behavior or API routes changed in this metadata-only fix.

## 1.0.1 - 2026-11-05

- Standardized the product identity and release artifact naming as **MatchiTOOL** throughout the project.
- Kept the Android application label, web interface title, Gradle root project, package namespace, and internal data paths under the MatchiTOOL identity.
- No root, modem, plugin, or firmware behavior changed in this branding-only update.

## 1.0.0 - 2026-11-05

- Forked the Android management host into the MatchiTOOL project.
- Replaced the UFI `socat` Unix-socket bridge with an optional direct `su -c sh` backend for devices that are already rooted.
- Removed UFI-specific setup and boot-script dependencies from the Android host.
- Added MatchiTOOL-managed boot tasks executed through an already-authorized root manager.
- Moved Bypass TTL, Anti-DPI, lock, and boot-state files under `/data/local/matchitool/`.
- Retained the plugin bridge contract and modem/SMS/signal features where possible.
- Added private-source-IP checks and token throttling for privileged web API requests.
- Preserved third-party license notices and added the Bypass MIT license text.
- Added source validation and a CI debug-APK build workflow.
- Documented the separate, firmware-specific stock F50 rooting route; the app does not itself root or flash the hotspot.


## 1.1.0 - Advanced technician release

- Added a read-only device diagnostics report for Android build, root identity, kernel, network routes, storage, and available servicing/network tools.
- Added XML/scatter firmware manifest inspection with partition-name extraction, file size, and SHA-256 fingerprint. Inspection never flashes or writes partitions.
- Added diagnostics and firmware inspector panels to the browser UI while retaining existing plugin APIs and bundled plugins.
- Incremented Android versionCode to 110 and versionName to 1.1.0.
- Kept the existing UFI-derived plugin and shell bridge compatibility surface.

### Limitations

- Firmware inspection is metadata-only; it is not a flashing engine or a guarantee of device/build compatibility.
- Device diagnostics depend on commands available on the Android/root environment.
- Android Gradle/APK build and physical-device testing must still be performed in an Android SDK environment.


## 1.1.1 - Security and servicing foundation

- Changed the web server default bind address to loopback (`127.0.0.1`); LAN access is now opt-in from the Android host screen and requires an explicit warning confirmation.
- Updated the foreground notification and host screen to show whether the server is local-only or LAN-enabled.
- Preserved the token-authenticated API and added a request-size/NUL-byte guard to the root shell endpoint.
- Expanded firmware manifest preflight with XML well-formedness checking, model/project hints, critical-partition warnings, and explicit unverified-compatibility status.
- Preserved existing plugin endpoints, settings keys, bundled plugins, and root bridge names.
- Incremented Android versionCode to 111 and versionName to 1.1.1.

### Security notes

- LAN mode still uses HTTP. Enable it only on a trusted private network, keep the token secret, and never port-forward the service.
- The root shell and plugin bridge remain privileged compatibility interfaces. Only install trusted plugins and treat LAN access as granting powerful control over the rooted Android host.
- Local-only binding is the default; existing saved preferences and plugin settings are not reset by this release.


## 1.1.2 - Discovery feature removal

- Removed ADB and Fastboot discovery UI, JavaScript handlers, backend routes, and discovery implementation.
- Removed ADB/Fastboot from the diagnostics tool-availability list and updated source validation to assert that discovery remains absent.
- Kept firmware manifest inspection, general device diagnostics, existing settings, root bridge, and bundled plugins.
- No chipset-level Qualcomm, MediaTek, or Unisoc detection is included or advertised.
- Incremented Android versionCode to 112 and versionName to 1.1.2.


## 1.1.3

- Added root-backed USB debugging enable/disable controls.
- Added USB tethering enable/disable controls using Android USB RNDIS functions, preserving ADB when enabled.
- Added USB state reporting for ADB, USB function configuration, and RNDIS interfaces.
- Documented Android ROM/kernel limitations and cable reconnection guidance.


## 1.1.4 - ZTE F50 USB Ethernet modes

- Added separate USB Ethernet mode actions for RNDIS and CDC-ECM.
- Added live reporting of active USB functions, saved USB configuration, detected gadget-function support, and network interfaces.
- Preserved ADB in the selected USB function when USB debugging is enabled.
- Added restore-default behavior based on the firmware's saved USB configuration, removing RNDIS/ECM function tokens before restoring.
- Kept USB controls separate from ADB/Fastboot device discovery; no discovery endpoints were reintroduced.
- Incremented Android versionCode to 114 and versionName to 1.1.4.

### Device validation note

- Source-level validation does not prove the exact CDC-ECM function token or `svc usb setFunctions` behavior on every F50 firmware build. Confirm the reported live config and test each mode on the target F50 before relying on it.


## 1.1.5 - Centered IP status screen
- Replaced the phone-only warning screen with the centered MatchiTOOL status UI.
- Added a clickable ZTE F50 router address (default 192.168.0.1).
- Added a clickable local MatchiTOOL web address (127.0.0.1:2334).
- Added long-press token access and live root authorization status.
- Updated Android versionCode to 115 and versionName to 1.1.5.

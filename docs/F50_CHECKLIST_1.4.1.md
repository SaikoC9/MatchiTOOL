# F50 check list for 1.4.1 (review item 26)

Nothing below was run on a real F50 by the person who wrote the code. Run it before calling 1.4.1 done. Tick each line, and for a FAIL copy the text of
**Radio report** (AT & Radio window) and the Live status "raw output" (Live device status, raw) so the cause can be found.
Everything marked "unchanged" was checked on the F50 on 11 Nov 2026 (see the CHANGELOG) and only needs a quick look after the update.

## A. AT & Radio window (rewrite: network mode, band lock and cell lock moved out)
- [ ] Open **AT & Radio**: it shows the SIM slot picker, VoLTE / VoNR, the quick AT buttons, the AT box and the output. No network mode, band or cell lock controls.
- [ ] Switch the SIM slot picker 0 -> 1 -> 0: a quick button (for example `AT+CSQ`) answers on each slot.
- [ ] **NR bands**: prints the supported 5G band list.
- [ ] **Radio report**: starts with "Radio on/off: UNKNOWN", then shows CFUN, CEREG, C5GREG, COPS and the router keys. Nothing is written (band lock and mode unchanged afterwards).
- [ ] **Restart modem** (confirm): signal drops about 30 s, the window says the radio is back, the dashboard registers again. (Same code as the band-lock restart, unchanged.)
- [ ] VoLTE / VoNR switches show their state and a change is read back.
- [ ] Close and reopen the window while a restart is running: no second restart starts.

## B. Performance mode button (top row, next to Change IP)
- [ ] The button is there. It opens a window that shows ON or OFF as the router reports it.
- [ ] Turn on (confirm) -> the window says the router saved it and applies it after a reboot. **No radio restart happens** (signal stays).
- [ ] After a device reboot the CPU cores 4 to 7 are online (Live status "CPU frequency"), and Turn off + reboot brings the old state back.
- [ ] If the router does not report `performance_mode`, the window says so and offers nothing.

## C. Items 22 to 25 of the review (new in the patched5 build)
- [ ] **Source label (25):** in Live device status, the 4G and 5G boxes end with `router` or `Android`. On the F50 expect `Android` for PCI / Ch (the router keys are empty). Hover shows the explanation.
- [ ] **Cell lock fallback (22):** with Live device status showing a 4G or 5G PCI, open **Cell lock**. "This phone is on" now lists the cell with "(Android telephony)" and a **Lock this cell** button.
  Compare its PCI and EARFCN with the Live status box. Compare also with a row in "Neighbours" if the same cell is listed there.
- [ ] Press **Lock this cell**: the confirm says the cell comes from Android telephony. Cancel once (nothing is sent). Then lock it: after 60 s the modem is registered, the lock stays.
  If the PCI or channel differs from what the router really uses, the modem will not register: auto-unlock removes the lock after 60 s. Write the difference down.
- [ ] With Live device status closed or older than 2 minutes, "This phone is on" says no serving cell (the fallback is not used on old data).
- [ ] **Unlock all cells** still works.
- [ ] **No-service warning (24):** lock one band (for example LTE B1 only) where B1 is not available. When Live status shows no service, a red line appears on **Radio settings**: "A band lock is active and Live Status shows no service ... Unlock all".
  **Unlock all** -> the line disappears once service is back. With every band allowed and no service there must be NO such line.
- [ ] **Radio state (23):** nowhere does the page claim the radio is on or off as a fact. Full diagnose, step "SIM and radio state", says the radio on/off state cannot be read.

## D. Web page (items 18 to 21, patched4)
- [ ] Open any popup (Terminal, Plugins ...): Tab and Shift+Tab stay inside it, **Escape** closes it, focus returns to the button that opened it.
- [ ] Language selector in the header: Filipino changes the header, sign-in, home buttons and popup titles; reload keeps the choice; English changes it back.
- [ ] Sign out and sign in again in Filipino: the sign-in text is translated, the password box still works with the keyboard (Enter).

## E. Not changed, quick look
- [ ] Band lock and Unlock all, radio restart, auto-unlock of a wrong cell (PCI 999), unlock all cells (checked 11 Nov 2026).
- [ ] Console starts after install, HTTPS or the "not encrypted" bar as before, sign-in speed with the new 310,000-iteration hash (patched2).

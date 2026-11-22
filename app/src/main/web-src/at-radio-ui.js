/*
 * AT & Radio - MatchiTOOL plugin
 * The window for the AT console, the VoLTE / VoNR switches, the quick reads, Restart modem and the Radio report (formats: docs/AT_RADIO_FORMATS.md).
 * Network mode, band lock and cell lock are on the dashboard (dash-radio.js, dash-cell.js).
 * AT commands are sent with MatchiTOOL's own sendat binary (tools/sendat).
 * The window logic (reply cleaning, command check, history, switch read-back, number meanings) is web-src/at-console.js (window.MatchiAtConsole).
 * Everything that talks to the modem or router for settings is web-src/radio-core.js (window.MatchiRadio). This file is only the window.
 */
(() => {
  'use strict';
  const MODAL = 'matchi_at_modal', BTN_ID = 'matchi_at_btn';
  if (document.getElementById(BTN_ID)) return;

  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const R = window.MatchiRadio, A = window.MatchiAtConsole;
  const { fields, tidy, zte, sleep, sh } = R;
  const hist = A.makeHistory(30);
  let slotNo = 0;
  const slot = () => slotNo;
  const at = (command) => R.at(command, slot());
  const atSlot = (command, sl) => R.at(command, sl);

  // ---- IMEI ---------------------------------------------------------------------------------------------
  // Unisoc modems write the IMEI with AT+SPIMEI=<slot>,"<imei>". Safety rules built into this flow:
  //  1. The current IMEI must be readable first; otherwise nothing is written (there would be no way back).
  //  2. The current IMEI is backed up on the router itself (/data/local/matchitool/imei_backup.txt, append-only,
  //     survives clearing the browser) and in this browser, BEFORE anything is written.
  //  3. Only a valid 15-digit IMEI (Luhn check digit) is accepted; obvious junk (all one digit) is refused.
  //  4. The confirmation shows current -> new. The modem is NOT restarted automatically: after the write the IMEI is read
  //     back, and a restart is a separate question you can decline.
  // Changing an IMEI is restricted or illegal in some countries: use it only to restore your own device's IMEI or where
  // the law allows it. Write down the IMEI printed on the router's label as well.
  const BACKUP = '/data/local/matchitool/imei_backup.txt';
  const luhnOk = (d) => {
    if (!/^\d{15}$/.test(d)) return false;
    let sum = 0;
    for (let i = 0; i < 15; i++) { let n = +d[14 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; }
    return sum % 10 === 0;
  };
  const luhnDigit = (d14) => { for (let c = 0; c < 10; c++) if (luhnOk(d14 + c)) return String(c); return '0'; };
  const IMEI_RX = /(?<!\d)\d{15}(?!\d)/;
  // Reads the IMEI the modem reports. Right after a modem restart (Apply saved IMEI, Change IMEI) the modem does not
  // answer for ~30 s, and one AT form may be refused while another works, so several forms are tried, then Android's
  // own phone service as a last resort. Returns '' only when nothing answered.
  async function readImei() {
    for (const c of ['AT+CGSN', 'AT+CGSN=1', 'AT+GSN']) {
      try { const m = String(await at(c)).match(IMEI_RX); if (m) return m[0]; } catch (_) {}
    }
    try {
      // service call iphonesubinfo prints the answer as a Parcel: the digits sit between quotes, separated by dots.
      const out = await sh('for C in 1 2; do if [ $C = 1 ]; then service call iphonesubinfo 1 s16 com.android.shell; else service call iphonesubinfo 2 i32 ' + slot() + ' s16 com.android.shell; fi; done 2>&1');
      const txt = (out.match(/'([^']*)'/g) || []).map((s) => s.slice(1, -1).replace(/[^0-9]/g, '')).join(' ');
      const m = txt.match(IMEI_RX); if (m) return m[0];
    } catch (_) {}
    return '';
  }
  const origKey = () => 'matchi_orig_imei_' + slot();
  // Appends "<time> slot <n> <imei>" on the router. Digits only, so nothing needs shell quoting. Returns true when the line is there.
  async function backupImei(v) {
    const line = new Date().toISOString().replace(/[^0-9T:-]/g, '') + ' slot ' + slot() + ' ' + v;
    const out = await sh('mkdir -p /data/local/matchitool && echo "' + line + '" >> ' + BACKUP + ' && grep -c " ' + v + '$" ' + BACKUP);
    return /^\d+$/.test(out.trim().split('\n').pop());
  }
  // The earliest IMEI recorded for this slot (router file first, then this browser).
  async function firstSeen() {
    try {
      const out = await sh('grep " slot ' + slot() + ' " ' + BACKUP + ' 2>/dev/null | head -n 1');
      const m = out.match(/slot \d (\d{15})/); if (m) return m[1];
    } catch (_) {}
    try { return localStorage.getItem(origKey()) || ''; } catch (_) { return ''; }
  }
  // Remember the chosen IMEI on the router: the keeper (runs at every boot, also "Apply saved IMEI now") writes it again
  // whenever the firmware puts the factory IMEI back. Digits only, so nothing needs shell quoting.
  const TARGET = '/data/local/matchitool/imei_target.txt', TRIES = '/data/local/matchitool/imei_tries.txt';
  async function saveTarget(v) {
    const sl = slot();
    const out = await sh('mkdir -p /data/local/matchitool && { grep -v "^' + sl + ' " ' + TARGET + ' 2>/dev/null; echo "' + sl + ' ' + v + '"; } > ' + TARGET + '.n && mv -f ' + TARGET + '.n ' + TARGET +
      ' && { grep -v "^' + sl + ' " ' + TRIES + ' > ' + TRIES + '.n 2>/dev/null; mv -f ' + TRIES + '.n ' + TRIES + '; } ; grep -c "^' + sl + ' ' + v + '$" ' + TARGET);
    return /^1$/.test(out.trim().split('\n').pop());
  }
  async function savedTarget() {
    try { const m = (await sh('grep "^' + slot() + ' " ' + TARGET + ' 2>/dev/null | head -n 1')).match(/^\d (\d{15})/m); return m ? m[1] : ''; } catch (_) { return ''; }
  }
  async function applySaved() {
    const r = await api('/api/imei/apply', { method: 'POST', body: JSON.stringify({ force: true }) });
    if (r.error) throw new Error(r.error);
    return String(r.result || '');
  }
  let imeiGen = 0;   // a newer showImei() call (slot change, button press) cancels the older one's retries
  async function showImei(tries) {
    const gen = ++imeiGen, max = tries == null ? 12 : tries;
    for (let n = 0; ; n++) {
      const cur = document.getElementById('matchi_imei_cur'); if (!cur || gen !== imeiGen) return;   // window closed / superseded
      try {
        const v = await readImei();
        if (gen !== imeiGen) return;
        const sv = document.getElementById('matchi_imei_saved');
        let t = ''; try { t = await savedTarget(); } catch (_) {}
        if (!v && n < max) {
          // The modem is usually just restarting: say so and ask again every 4 s instead of showing "unknown".
          cur.textContent = 'reading… (modem not answering yet)';
          if (sv) sv.textContent = t ? 'Kept after reboot: ' + t : 'Not saved for reboot yet.';
          await new Promise((r) => setTimeout(r, 4000)); continue;
        }
        cur.textContent = v || 'unreadable (the modem did not answer; press IMEI above to try again)';
        if (sv) sv.textContent = !t ? 'Not saved for reboot yet.'
          : 'Kept after reboot: ' + t + (!v ? '' : v === t ? '  (active: the modem reports it)' : '  (the modem reports a different IMEI: press Apply saved IMEI now)');
        if (v) {
          try { if (!localStorage.getItem(origKey())) localStorage.setItem(origKey(), v); } catch (_) {}
          try { if (!(await firstSeen())) await backupImei(v); } catch (_) {}   // first time this slot is seen: keep it
        }
        return;
      } catch (e) { cur.textContent = 'unreadable (' + e.message + ')'; return; }
    }
  }
  async function writeImei(imei) {
    if (/^\d{14}$/.test(imei)) imei += luhnDigit(imei);   // 14 digits: the check digit is added for you
    if (!luhnOk(imei)) throw new Error('IMEI must be 15 digits with a valid check digit');
    if (/^(\d)\1{14}$/.test(imei)) throw new Error('That IMEI is not valid');
    const before = await readImei();
    if (!before) throw new Error('The current IMEI could not be read, so nothing was changed (no way to go back)');
    if (before === imei) throw new Error('That is already the current IMEI');
    if (!(await askDialog({ title: 'Change the IMEI?', message: 'SIM slot ' + slot() + '\nfrom ' + before + '\nto ' + imei + '\n\nA wrong IMEI can break the SIM connection.', check: 'I understand', okText: 'Change IMEI', danger: true, maxWidth: '360px' }))) return false;
    if (!(await backupImei(before))) throw new Error('Backup failed. IMEI unchanged.');
    log('Backup saved: ' + before + ' (' + BACKUP + ')');
    log('> AT+SPIMEI=' + slot() + ',"' + imei + '"');
    const r = await at('AT+SPIMEI=' + slot() + ',"' + imei + '"');
    log(r || '(no output)');
    if (/ERROR/i.test(r) || !/OK/i.test(r)) throw new Error('Modem rejected the change (' + (r.trim() || 'no reply') + '). IMEI unchanged.');
    try { log((await saveTarget(imei)) ? 'Saved for every boot: the IMEI is written again if the firmware restores the old one.' : 'Could not save the IMEI for reboot (the change may be lost at the next boot).'); }
    catch (e) { log('Saving for reboot failed: ' + e.message); }
    let now = ''; try { now = await readImei(); } catch (_) {}
    log('IMEI now reads: ' + (now || 'unknown') + (now === imei ? '' : ' (may only change after a modem restart)'));
    if (await askConfirm('IMEI written. Restart modem to apply? Data drops ~30 s.', 'Restart modem', false)) {
      log('> AT+CFUN=1,1');
      try { log(await at('AT+CFUN=1,1') || '(no output)'); } catch (e) { log('Restart: ' + e.message); }
      createToast('Modem restarting. Reopen this window in about 30 seconds to check the IMEI.', 'green');
    } else createToast('IMEI written. Restart the modem or the router for it to take effect.', 'green');
    return true;
  }



  // ---- console ------------------------------------------------------------------------------------------
  const out = () => document.getElementById('at_out');
  function log(line) { const o = out(); if (!o) return; o.textContent += line + '\n'; o.scrollTop = o.scrollHeight; }
  async function sendOne(cmd) {
    log('> ' + cmd);
    try { const raw = await at(cmd); log(A.cleanReply(raw) || '(no output)'); return String(raw || ''); }
    catch (e) { log('Error: ' + e.message); return ''; }
  }
  async function nrBands() {
    try {
      const f = R.parseNrSupported(await at('AT+SP5GCMDS="get nr support_band"'));
      log('> 5G bands this modem supports\n' + (f.length ? f.map((b) => 'n' + b).join(' ') : '(none parsed)'));
    } catch (e) { log('Error: ' + e.message); }
  }
  // AT+CSQ only covers 2G/3G/4G and says 99 on 5G, so the LTE values (AT+CESQ) and the router's own 5G values are read too.
  async function signal() {
    log('> Signal (AT+CSQ, AT+CESQ, router)');
    for (const c of ['AT+CSQ', 'AT+CESQ']) {
      try {
        const raw = await at(c);
        log(A.cleanReply(raw) || '(no output)');
        const why = c === 'AT+CSQ' ? A.describeCsq(raw) : A.describeCesq(raw);
        if (why) log('  -> ' + why);
      } catch (e) { log(c + ': ' + e.message); }
    }
    const rows = [['Network', 'network_type', ''], ['5G RSRP', 'Z5g_rsrp', ' dBm'], ['5G RSRQ', 'Z5g_rsrq', ' dB'], ['5G SINR', 'Z5g_SINR', ' dB'], ['5G PCI', 'nr5g_pci', ''],
      ['5G band', 'nr5g_action_band', ''], ['5G channel', 'nr5g_action_channel', ''], ['LTE RSRP', 'lte_rsrp', ' dBm'], ['LTE RSRQ', 'lte_rsrq', ' dB'],
      ['LTE SINR', 'lte_snr', ' dB'], ['LTE PCI', 'lte_pci', ''], ['LTE band', 'wan_active_band', '']];
    try {
      const d = (await zte('get', { multi_data: '1', cmd: rows.map((r) => r[1]).join(',') })) || {};
      const lines = rows.map(([label, key, unit]) => { const v = d[key] == null ? '' : String(d[key]).trim(); return v ? label + ' ' + v + unit : ''; }).filter(Boolean);
      log(lines.length ? 'Router:\n  ' + lines.join('\n  ') : 'The router has no signal values for this firmware.');
    } catch (e) { log('Router values not available: ' + e.message + '. Live Status shows the signal from Android telephony instead.'); }
  }
  async function run(cmd) {
    if (cmd === '@signal') return signal();
    if (cmd === '@nrbands') return nrBands();
    // a quick read made of several commands: run each in turn, keep going when one is not supported
    for (const c of String(cmd).split('|')) await sendOne(c);
  }
  function sendTyped() {
    const box = document.getElementById('at_in'); if (!box) return;
    const chk = A.checkCommand(box.value);
    if (!chk.ok) { if (box.value.trim()) log(chk.error); box.focus(); return; }
    if (/AT\+SPIMEI\s*=\s*\d+\s*,\s*"NEW"/i.test(chk.cmd)) { log('Replace NEW with the 15-digit IMEI first, then press Send.'); box.focus(); return; }   // never send the placeholder
    hist.push(chk.cmd); box.value = '';
    run(chk.cmd);
  }

  // ---- voice switches ------------------------------------------------------------------------------------
  const swEl = (id) => document.getElementById('at_sw_' + id), stEl = (id) => document.getElementById('at_st_' + id);
  const lockSwitches = (on) => { for (const d of A.SWITCHES) { const e = swEl(d.id); if (e) e.disabled = on; } };
  let swGen = 0;   // a newer refresh (slot change, after a switch) retires an older one, so a slow read of the other SIM cannot paint over it
  async function refreshSwitches() {
    const gen = ++swGen;
    lockSwitches(true);
    for (const d of A.SWITCHES) { const s = stEl(d.id); if (s) s.textContent = 'reading…'; }
    for (const d of A.SWITCHES) {
      const el = swEl(d.id), st = stEl(d.id); if (!el) continue;
      try {
        const v = A.readSwitch(d, await at(d.read));
        if (gen !== swGen) return;
        if (v === null) { st.textContent = 'unknown'; continue; }
        el.checked = v; el.disabled = false; st.textContent = v ? 'on' : 'off';
      } catch (e) { if (gen !== swGen) return; st.textContent = 'not available'; log(d.label + ': ' + e.message); }
    }
  }
  async function toggle(d, on) {
    lockSwitches(true);   // one modem write at a time
    try {
      const raw = String(await at(d.write(on)) || '');
      if (!raw.includes('OK')) {
        const why = raw.trim() ? ' (modem said: ' + raw.replace(/\s+/g, ' ').trim().slice(0, 80) + ')' : ': the modem did not answer AT (sendat printed nothing). Run Full diagnose';
        createToast(d.label + ' change failed' + why, 'red');
      } else {
        // OK only means the modem took the command: read it back after a short wait and say so when it did not stick.
        await sleep(1500);
        let rawBack = '', got = null;
        try { rawBack = String(await at(d.read)); got = A.readSwitch(d, rawBack); } catch (e) { rawBack = 'read failed: ' + e.message; }
        log('> ' + d.label + ' ' + (on ? 'on' : 'off') + ': modem said ' + raw.replace(/\s+/g, ' ').trim() + '; read back (' + d.read + '): ' + (rawBack.replace(/\s+/g, ' ').trim() || '(no output)'));
        const v = A.judgeSwitch(on, got);
        if (v === 'unreadable') createToast(d.label + ': the modem said OK but the state could not be read back', 'red');
        else if (v === 'differs') createToast(d.label + ': the modem said OK but still reads ' + (got ? 'on' : 'off') + '. It may need a modem restart. Details are in the output.', 'red');
        else createToast(d.label + (on ? ' on' : ' off') + ' (confirmed by read-back)', 'green');
      }
    } catch (err) { createToast(err.message, 'red'); }
    refreshSwitches();
  }

  let radioBusy = false;
  function setRadioBusy(on) {
    radioBusy = on;
    const el = document.getElementById('at_restart'); if (el) el.disabled = on;
  }

  // Radio restart: R.radioCycle in radio-core.js (order, meaning of 5/4 and the on-device script are explained there).
  // Counts as a busy period so Live Status stops polling while the modem restarts (also when this window is closed meanwhile).
  const radioCycle = async () => { const done = R.beginBusy('Radio restarting, ~30 s'); try { return await R.radioCycle({ log, toast: createToast }); } finally { done(); } };

  // Read-only snapshot for support: radio state per SIM slot, registration, and what the router reports for bands / mode / serving cell.
  // Nothing is written. The text is shown here and copied to the clipboard when the browser allows it.
  async function radioReport() {
    if (radioBusy) return;
    log('> Radio report (read only)');
    const out = [];
    const tryAt = async (c, sl) => { try { out.push(c + (sl === undefined ? '' : '  [slot ' + sl + ']') + '\n' + (tidy(sl === undefined ? await at(c) : await atSlot(c, sl)) || '(no output)')); } catch (e) { out.push(c + '\nError: ' + e.message); } };
    out.push('Radio on/off: UNKNOWN\nRadio state can\'t be read on the F50. Check registration (AT+CEREG? / AT+C5GREG?) instead.');
    await tryAt('AT+CFUN?', 0); await tryAt('AT+CFUN?', 1);
    for (const c of ['AT+CEREG?', 'AT+C5GREG?', 'AT+COPS?', 'AT+SP5GCMDS="get nr support_band"']) await tryAt(c);
    const keys = 'lte_band_lock,nr_band_lock,net_select,BearerPreference,performance_mode,network_type,nr5g_action_band,nr5g_action_channel,nr5g_pci,wan_active_band,wan_active_channel,lte_pci,locked_cell_info';
    try { out.push('router (' + keys.split(',').length + ' keys)\n' + JSON.stringify(await zte('get', { multi_data: '1', cmd: keys }), null, 1)); } catch (e) { out.push('router\nError: ' + e.message); }
    const text = out.join('\n\n');
    log(text);
    try { await navigator.clipboard.writeText(text); createToast('Radio report copied', 'green'); }
    catch (_) { createToast('Radio report is in the window: select it and copy', 'green'); }
  }
  async function rebootModem() {
    if (radioBusy) return;
    const ok = await askConfirm('Restart the modem?\n\nSignal drops ~30 s. SMS and data stop.', 'Restart modem', true);
    if (!ok) return;
    setRadioBusy(true);
    try { await radioCycle(); } finally { setRadioBusy(false); }
  }


  // ---- window --------------------------------------------------------------------------------------------
  function atStyle() {
    if (document.getElementById('at_css')) return;
    const st = document.createElement('style'); st.id = 'at_css';
    st.textContent = `
#matchi_at_modal .modal{padding:10px 12px}
#matchi_at_modal h3{margin:0 0 6px!important}
#matchi_at_modal .mfoot{margin-top:4px!important}
#matchi_at_modal h3{display:flex;align-items:center;justify-content:space-between;gap:8px}
#matchi_at_modal .at-seg{display:inline-flex;gap:4px}
#matchi_at_modal .at-seg button{min-height:0!important;padding:4px 10px!important;font-size:12px!important;font-weight:500;border:0!important;border-radius:7px!important;background:transparent!important;color:var(--mut)!important;box-shadow:none!important;transform:none!important;outline:none!important}
#matchi_at_modal .at-seg button:hover{color:var(--fg)!important}
#matchi_at_modal .at-seg button[aria-pressed=true]{background:rgba(85,168,255,.16)!important;color:var(--acc2)!important;font-weight:600}
#matchi_at_modal .at-sec{margin-bottom:5px}
#matchi_at_modal .at-h{font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:0 0 3px}
#matchi_at_modal .at-voice{display:grid;grid-template-columns:1fr 1fr;gap:5px}
#matchi_at_modal .at-voice .at-h{grid-column:1/-1;margin:0}
#matchi_at_modal .at-sw{display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center;padding:5px 9px;border-radius:10px;background:rgba(139,170,211,.10)}
#matchi_at_modal .at-sw small{display:block;font-size:11px;color:var(--mut)}
#matchi_at_modal .at-st{font-size:11px;color:var(--mut);text-align:right}
#matchi_at_modal .at-sw input:checked{background-color:var(--acc)!important}
#matchi_at_modal .at-chips{display:flex;flex-wrap:wrap;gap:4px}
#matchi_at_modal .at-chips button,#matchi_at_modal .at-bar button{min-height:0!important;padding:4px 9px!important;font-size:12px!important;font-weight:500;line-height:1.2;border:0!important;border-radius:7px!important;background:rgba(139,170,211,.12)!important;color:var(--fg)!important;box-shadow:none!important;transform:none!important}
#matchi_at_modal .at-chips button:hover,#matchi_at_modal .at-bar button:hover{background:rgba(139,170,211,.22)!important;transform:none!important;box-shadow:none!important}
#matchi_at_modal #at_imei{color:#ffb86b!important;background:rgba(255,184,107,.12)!important}
#matchi_at_modal .at-bar{display:flex;gap:6px;align-items:center;margin:6px 0 4px}
#matchi_at_modal .at-bar input{flex:1;min-width:0;min-height:0!important;padding:5px 10px!important;font-size:12.5px!important;border-radius:9px!important;background:transparent!important;border:1px solid var(--bd)!important}
#matchi_at_modal .at-bar #at_send{background:var(--acc)!important;color:#04101f!important;font-weight:600;padding:5px 12px!important}
#matchi_at_modal .at-bar #at_send:disabled{opacity:.45}
#matchi_at_modal .at-tools{display:flex;justify-content:space-between;align-items:center}
#matchi_at_modal .at-tools .at-chips button{background:transparent!important;color:var(--mut)!important}
#matchi_at_modal .at-tools .at-chips button:hover{background:rgba(139,170,211,.12)!important;color:var(--fg)!important}
#matchi_at_modal #at_out{background:var(--bg);border:0;border-radius:10px;padding:6px 10px;height:64px;overflow:auto;white-space:pre-wrap;margin:3px 0 0;font-size:11px;line-height:1.45}`;
    document.head.appendChild(st);
  }
  const chip = (label, attr, val) => `<button type="button" ${attr}="${esc(val)}">${esc(label)}</button>`;
  function open() {
    atStyle();
    const groups = A.groups.map((g) => `<div class="at-sec"><div class="at-h">${esc(g.name)}</div><div class="at-chips">${g.items.map((i) => chip(i[0], 'data-run', i[1])).join('')}</div></div>`).join('');
    const switches = A.SWITCHES.map((d) => `<div class="at-sw"><div><b>${esc(d.label)}</b><small>${esc(d.note)}</small></div><span class="at-st" id="at_st_${d.id}">reading…</span><input type="checkbox" id="at_sw_${d.id}" disabled aria-label="${esc(d.label)}"></div>`).join('');
    createModal({
      name: MODAL, title: 'AT & Radio', maxWidth: '560px', showConfirm: false, onClose: () => true,
      content:
        '<div class="at-top"><div class="at-seg" role="group" aria-label="SIM slot"><button type="button" data-slot="0" aria-pressed="true">SIM 0</button><button type="button" data-slot="1" aria-pressed="false">SIM 1</button></div></div>' +
        `<div class="at-sec at-voice"><div class="at-h">Voice</div>${switches}</div>` + groups +
        '<div class="at-sec"><div class="at-h">Actions</div><div class="at-chips"><button type="button" id="at_restart">Restart modem</button><button type="button" id="at_report">Radio report</button><button type="button" id="at_imei">Change IMEI…</button></div></div>' +
        '<div class="at-bar"><input id="at_in" placeholder="AT command, e.g. AT+CSQ" autocomplete="off" autocapitalize="characters" spellcheck="false"><button type="button" id="at_send">Send</button></div>' +
        '<div class="at-tools"><span class="at-h" style="margin:0">Output</span><span class="at-chips"><button type="button" id="at_copy">Copy</button><button type="button" id="at_clear">Clear</button></span></div>' +
        '<pre id="at_out"></pre>',
    });
    showModal(MODAL);
    slotNo = 0;
    const root = document.getElementById(MODAL);
    { const h = root.querySelector('h3'), top = root.querySelector('.at-top'); if (h && top && top.firstElementChild) { h.appendChild(top.firstElementChild); top.remove(); } }   // SIM switch on the title line
    root.querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => run(b.dataset.run)));
    root.querySelectorAll('[data-slot]').forEach((b) => (b.onclick = () => {
      slotNo = b.dataset.slot === '1' ? 1 : 0;
      root.querySelectorAll('[data-slot]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      refreshSwitches();
    }));
    for (const d of A.SWITCHES) swEl(d.id).onchange = (e) => toggle(d, e.target.checked);
    const box = document.getElementById('at_in');
    box.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendTyped(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); box.value = hist.prev(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); box.value = hist.next(); }
    };
    document.getElementById('at_send').onclick = sendTyped;
    document.getElementById('at_clear').onclick = () => { const o = out(); if (o) o.textContent = ''; };
    document.getElementById('at_copy').onclick = async () => {
      const t = (out() && out().textContent) || '';
      try { await navigator.clipboard.writeText(t); createToast('Output copied', 'green'); } catch (_) { createToast('Select the output and copy it by hand', 'red'); }
    };
    document.getElementById('at_imei').onclick = () => {   // only puts the command in the box; nothing is sent until Send
      box.value = 'AT+SPIMEI=' + slot() + ',"NEW"'; box.focus();
      const p = box.value.indexOf('NEW'); try { box.setSelectionRange(p, p + 3); } catch (_) { /* not fatal */ }
    };
    document.getElementById('at_report').onclick = radioReport;
    document.getElementById('at_restart').onclick = rebootModem;
    refreshSwitches();
  }

  const host = document.querySelector('.actions-buttons'); if (!host) return;
  const b = document.createElement('button');
  b.id = BTN_ID; b.textContent = 'AT & Radio'; b.onclick = open; host.appendChild(b);
})();

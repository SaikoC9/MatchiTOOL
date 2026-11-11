/*
 * AT & Radio - MatchiTOOL plugin
 * Ported from UFI-TOOLS (MIT, (c) 2025 Minikano): AT command terminal, VoLTE / VoNR switches, NR band list,
 * modem restart (formats: docs/AT_RADIO_FORMATS.md). Network mode, band lock and cell lock are on the dashboard (dash-radio.js, dash-cell.js).
 * AT commands are sent with the sendat binary from UFI-TOOLS, bundled with MatchiTOOL.
 * This file is only the window. Everything that talks to the modem or router is in web-src/radio-core.js (window.MatchiRadio).
 */
(() => {
  'use strict';
  const MODAL = 'matchi_at_modal', BTN_ID = 'matchi_at_btn';
  if (document.getElementById(BTN_ID)) return;

  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slot = () => parseInt(document.getElementById('matchi_at_slot')?.value || '0', 10);
  const R = window.MatchiRadio;
  const { fields, tidy, zte, sleep, parseNrSupported, sh } = R;
  const at = (command) => R.at(command, slot());
  const atSlot = (command, sl) => R.at(command, sl);
  const getVoLTE = async () => parseInt(fields(await at('AT+CAVIMS?'))[0], 10) === 1;
  const getVoNR = async () => parseInt(fields(await at('AT+SP5GCMDS="get nr synch_param",42'))[2], 10) === 1;
  const setVoLTE = async (on) => (await at('AT+CAVIMS=' + (on ? 1 : 0))).includes('OK');
  const setVoNR = async (on) => (await at('AT+SP5GCMDS="set nr param",45,' + (on ? 1 : 0))).includes('OK');

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
    if (!(await askConfirm('Change the IMEI of SIM slot ' + slot() + '\nfrom ' + before + '\nto ' + imei + '?\n\nThe current IMEI is saved on the router first. Changing an IMEI is restricted or illegal in some countries; only use your own device\'s IMEI or where the law allows it.', 'Change IMEI', true))) return false;
    if (!(await backupImei(before))) throw new Error('Could not save a backup of the current IMEI on the router, so nothing was changed');
    log('Backup saved: ' + before + ' (' + BACKUP + ')');
    log('> AT+SPIMEI=' + slot() + ',"' + imei + '"');
    const r = await at('AT+SPIMEI=' + slot() + ',"' + imei + '"');
    log(r || '(no output)');
    if (/ERROR/i.test(r) || !/OK/i.test(r)) throw new Error('Modem did not accept the IMEI change (' + (r.trim() || 'no reply') + '). Nothing was changed.');
    try { log((await saveTarget(imei)) ? 'Saved for every boot: the IMEI is written again if the firmware restores the old one.' : 'Could not save the IMEI for reboot (the change may be lost at the next boot).'); }
    catch (e) { log('Saving for reboot failed: ' + e.message); }
    let now = ''; try { now = await readImei(); } catch (_) {}
    log('IMEI now reads: ' + (now || 'unknown') + (now === imei ? '' : ' (may only change after a modem restart)'));
    if (await askConfirm('The IMEI was written. Restart the modem now so it takes effect? (Mobile data drops for about 30 seconds.)', 'Restart modem', false)) {
      log('> AT+CFUN=1,1');
      try { log(await at('AT+CFUN=1,1') || '(no output)'); } catch (e) { log('Restart: ' + e.message); }
      createToast('Modem restarting. Reopen this window in about 30 seconds to check the IMEI.', 'green');
    } else createToast('IMEI written. Restart the modem or the router for it to take effect.', 'green');
    return true;
  }

  const PRESETS = [
    ['Signal quality', '@signal'], ['Operator', 'AT+COPS?'], ['Registration', 'AT+CEREG?'],
    ['IMEI', 'AT+CGSN'], ['IMSI', 'AT+CIMI'], ['SIM ICCID', 'AT+CCID'], ['Modem info', 'AT+CGMI|AT+CGMM|AT+CGMR'],
    ['QoS', 'AT+CGEQOSRDP=1'],
  ];

  // ---- Router radio settings. Read on open and after a change only, never polled. Formats: docs/AT_RADIO_FORMATS.md. ----
  let radioBusy = false;

  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  // "Signal quality": AT+CSQ only covers 2G/3G/4G and answers 99,99 ("unknown") while the modem is on 5G. So also ask AT+CESQ
  // (LTE RSRP/RSRQ) and the router's own 5G values, and say in words what a 99 means.
  async function signal() {
    log('> Signal quality (AT+CSQ, AT+CESQ, router)');
    let csq = '', cesq = '';
    try { csq = tidy(await at('AT+CSQ')); } catch (e) { log('AT+CSQ: ' + e.message); }
    if (csq) {
      log(csq);
      const m = csq.match(/\+CSQ:\s*(\d+)/);
      if (m) log(+m[1] === 99 ? '  -> CSQ 99 = unknown. Normal on 5G: CSQ only measures 2G/3G/4G. The 5G values are below.'
        : '  -> signal strength ' + (-113 + 2 * Math.min(+m[1], 31)) + ' dBm');
    }
    try { cesq = tidy(await at('AT+CESQ')); } catch (e) { log('AT+CESQ: ' + e.message); }
    if (cesq) {
      log(cesq);
      const m = cesq.match(/\+CESQ:\s*(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/);
      if (m) {
        const rsrq = +m[5], rsrp = +m[6];
        log('  -> LTE RSRP ' + (rsrp <= 97 ? (-140 + rsrp) + ' dBm' : 'unknown') + ', RSRQ ' + (rsrq <= 34 ? (-19.5 + 0.5 * rsrq) + ' dB' : 'unknown'));
      }
    }
    try {
      const keys = ['network_type', 'Z5g_rsrp', 'Z5g_rsrq', 'Z5g_SINR', 'nr5g_pci', 'nr5g_action_band', 'nr5g_action_channel', 'lte_rsrp', 'lte_rsrq', 'lte_snr', 'lte_pci', 'wan_active_band'];
      const r = await api('/api/zte', { method: 'POST', body: JSON.stringify({ op: 'get', params: { multi_data: '1', cmd: keys.join(',') } }) });
      const d = (r && r.data) || {}, v = (k) => (d[k] === undefined || d[k] === null || String(d[k]).trim() === '' ? null : String(d[k]).trim());
      const row = (label, k, unit) => v(k) !== null && num(v(k)) !== null ? label + ' ' + v(k) + unit : (v(k) !== null && !unit ? label + ' ' + v(k) : null);
      const lines = [v('network_type') && 'Network ' + v('network_type'),
        row('5G RSRP', 'Z5g_rsrp', ' dBm'), row('5G RSRQ', 'Z5g_rsrq', ' dB'), row('5G SINR', 'Z5g_SINR', ' dB'),
        row('5G PCI', 'nr5g_pci', ''), v('nr5g_action_band') && '5G band ' + v('nr5g_action_band'), row('5G channel', 'nr5g_action_channel', ''),
        row('LTE RSRP', 'lte_rsrp', ' dBm'), row('LTE RSRQ', 'lte_rsrq', ' dB'), row('LTE SINR', 'lte_snr', ' dB'),
        row('LTE PCI', 'lte_pci', ''), v('wan_active_band') && 'LTE band ' + v('wan_active_band')].filter(Boolean);
      log(lines.length ? 'Router:\n  ' + lines.join('\n  ') : 'Router answered but has no signal values for this firmware.');
    } catch (e) { log('Router values not available: ' + e.message + '. Live Status shows the signal from Android telephony instead.'); }
  }

  function log(line) {
    const o = document.getElementById('matchi_at_out'); if (!o) return;
    o.textContent += line + '\n'; o.scrollTop = o.scrollHeight;
  }
  async function run(cmd) {
    cmd = (cmd || '').trim(); if (!cmd) return;
    if (cmd === '@signal') return signal();
    if (cmd.includes('|')) {   // preset made of several commands: run each, keep going when one is not supported
      for (const c of cmd.split('|')) { log('> ' + c); try { log(tidy(await at(c)) || '(no output)'); } catch (e) { log('Error: ' + e.message); } }
      return;
    }
    log('> ' + cmd);
    try { log(tidy(await at(cmd)) || '(no output)'); } catch (e) { log('Error: ' + e.message); }
  }

  function setRadioBusy(on) {
    radioBusy = on;
    const el = document.getElementById('matchi_reboot'); if (el) el.disabled = on;
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
    const ok = await askConfirm('Restart the modem?\n\nSignal will drop for about 30 seconds. SMS and data stop until it is back.', 'Restart modem', true);
    if (!ok) return;
    setRadioBusy(true);
    try { await radioCycle(); } finally { setRadioBusy(false); }
  }

  let swGen = 0;   // a newer refresh (slot change, after a switch) retires an older one, so a slow read of the other SIM slot cannot paint over it
  async function refreshSwitches() {
    const gen = ++swGen, items = [['matchi_volte', getVoLTE], ['matchi_vonr', getVoNR]];
    for (const [id] of items) { const e0 = document.getElementById(id); if (e0) e0.disabled = true; }
    for (const [id, getter] of items) {
      const el = document.getElementById(id); if (!el) continue;
      try { const v = await getter(); if (gen !== swGen) return; el.checked = v; el.disabled = false; }
      catch (e) { if (gen !== swGen) return; el.disabled = true; log(id + ': ' + e.message); }
    }
  }

  // Compact look for this window only: small switches in one row, smaller buttons / inputs / output box.
  function atStyle() {
    if (document.getElementById('matchi_at_css')) return;
    const st = document.createElement('style'); st.id = 'matchi_at_css';
    st.textContent = `
#matchi_at_modal .modal{padding:12px}
#matchi_at_modal .at-tg{display:flex;gap:14px;align-items:center;margin:0 0 8px}
#matchi_at_modal .at-tg label{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;line-height:1;cursor:pointer}
#matchi_at_modal input[type=checkbox]{-webkit-appearance:none;appearance:none;flex:0 0 auto;width:30px;height:17px;min-height:0;padding:0;margin:0;border:0;border-radius:9px;background-color:rgba(255,255,255,.22);background-image:radial-gradient(circle,#fff 6px,transparent 6.5px);background-size:17px 17px;background-repeat:no-repeat;background-position:0 50%;transition:background-position .18s,background-color .18s;cursor:pointer}
#matchi_at_modal input[type=checkbox]:checked{background-color:rgba(100,230,164,.75);background-position:100% 50%}
#matchi_at_modal input[type=checkbox]:disabled{opacity:.45;cursor:default}
#matchi_at_modal select{min-height:28px;padding:2px 6px;font-size:12px;border-radius:7px}
#matchi_at_modal button{min-height:28px;padding:3px 9px;font-size:12px;border-radius:7px}
#matchi_at_modal input[type=text],#matchi_at_modal input:not([type]),#matchi_at_modal input[inputmode]{min-height:30px;padding:4px 9px;font-size:12.5px}
#matchi_at_out{height:150px!important;padding:8px!important;font-size:11px;line-height:1.45;margin-top:8px!important}`;
    document.head.appendChild(st);
  }
  function open() {
    atStyle();
    createModal({
      name: MODAL, title: 'AT & Radio', maxWidth: '560px', showConfirm: false, onClose: () => true,
      content:
        '<div style="display:flex;gap:8px;margin-bottom:8px"><select id="matchi_at_slot"><option value="0">SIM slot 0</option><option value="1">SIM slot 1</option></select></div>' +
        '<div class="at-tg">' +
        '<label><input type="checkbox" id="matchi_volte" disabled> VoLTE</label>' +
        '<label><input type="checkbox" id="matchi_vonr" disabled> VoNR</label></div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">' +
        PRESETS.map((p) => `<button type="button" data-at="${esc(p[1])}">${esc(p[0])}</button>`).join('') +
        '<button type="button" id="matchi_bands">NR bands</button><button type="button" id="matchi_reboot">Restart modem</button><button type="button" id="matchi_report">Radio report</button><button type="button" id="matchi_chg">Change IMEI</button></div>' +
        '<div style="display:flex;gap:6px"><input id="matchi_at_in" placeholder="AT command, e.g. AT+CSQ" autocomplete="off" autocapitalize="characters" spellcheck="false" style="flex:1;min-width:0"><button type="button" id="matchi_apply">Apply</button></div>' +
        '<pre id="matchi_at_out" style="background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:10px;height:200px;overflow:auto;white-space:pre-wrap;margin:10px 0 0"></pre>',
    });
    showModal(MODAL);
    const root = document.getElementById(MODAL);
    root.querySelectorAll('[data-at]').forEach((b) => (b.onclick = () => run(b.dataset.at)));
    // Enter and the Apply button do the same thing: send what is in the box.
    const applyBox = () => {
      const i = document.getElementById('matchi_at_in'); if (!i) return;
      const v = i.value.trim(); if (!v) return;
      if (/AT\+SPIMEI\s*=\s*\d+\s*,\s*"NEW"/i.test(v)) { log('Replace NEW with the 15-digit IMEI first, then press Apply.'); i.focus(); return; }   // never send the placeholder
      i.value = ''; run(v);
    };
    document.getElementById('matchi_at_in').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); applyBox(); } };
    document.getElementById('matchi_apply').onclick = applyBox;
    document.getElementById('matchi_chg').onclick = () => {   // only shows the command in the box; nothing is sent until you press Enter
      const i = document.getElementById('matchi_at_in'); if (!i) return;
      i.value = 'AT+SPIMEI=' + slot() + ',"NEW"'; i.focus();
      const p = i.value.indexOf('NEW'); try { i.setSelectionRange(p, p + 3); } catch (_) { /* not fatal */ }
    };
    document.getElementById('matchi_bands').onclick = async () => {
      try {
        const f = parseNrSupported(await at('AT+SP5GCMDS="get nr support_band"'));
        log('> NR supported bands\n' + (f.length ? f.map((b) => 'n' + b).join(' ') : '(none parsed)'));
      } catch (e) { log('Error: ' + e.message); }
    };
    for (const [id, setter, name] of [['matchi_volte', setVoLTE, 'VoLTE'], ['matchi_vonr', setVoNR, 'VoNR']]) {
      document.getElementById(id).onchange = async (e) => {
        const on = e.target.checked;
        for (const x of ['matchi_volte', 'matchi_vonr']) { const c = document.getElementById(x); if (c) c.disabled = true; }   // one modem write at a time
        try { const ok = await setter(on); createToast(ok ? name + (on ? ' on' : ' off') : name + ' change failed', ok ? 'green' : 'red'); }
        catch (err) { createToast(err.message, 'red'); }
        refreshSwitches();
      };
    }
    document.getElementById('matchi_report').onclick = radioReport;
    document.getElementById('matchi_reboot').onclick = rebootModem;
    document.getElementById('matchi_at_slot').onchange = () => { refreshSwitches(); };
    refreshSwitches();
  }

  const host = document.querySelector('.actions-buttons'); if (!host) return;
  const b = document.createElement('button');
  b.id = BTN_ID; b.textContent = 'AT & Radio'; b.onclick = open; host.appendChild(b);
})();


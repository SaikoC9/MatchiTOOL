/*
 * AT & Radio - MatchiTOOL plugin
 * Ported from UFI-TOOLS (MIT, (c) 2025 Minikano): AT command terminal, VoLTE / VoNR switches, NR band list,
 * network mode, performance mode, band lock, cell lock, modem restart (formats: docs/AT_RADIO_FORMATS.md).
 * AT commands are sent with the sendat binary from UFI-TOOLS, bundled with MatchiTOOL.
 */
(() => {
  'use strict';
  const MODAL = 'matchi_at_modal', BTN_ID = 'matchi_at_btn';
  if (document.getElementById(BTN_ID)) return;

  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slot = () => parseInt(document.getElementById('matchi_at_slot')?.value || '0', 10);
  async function at(command) {
    const r = await api('/api/at', { method: 'POST', body: JSON.stringify({ command, slot: slot() }) });
    if (r.error) throw new Error(r.error);
    return r.result || '';
  }
  // Same parsing as UFI-TOOLS: take the text between the first ":" and "OK", split on ",".
  const fields = (raw) => raw.split('OK')[0].split(':').slice(1).join(':').replace(/["\r\n]/g, ' ').split(',').map((x) => x.trim());
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
  async function sh(cmd, timeout) {
    const r = await api('/api/shell', { method: 'POST', body: JSON.stringify({ cmd, timeout: timeout || 15000 }) });
    if (r.error) throw new Error(r.error);
    return String(r.content || '');
  }
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

  // ---- Router radio settings (goform through the /api/zte proxy). Read on open and after a change only, never polled. ----
  // Values from UFI-TOOLS 4.1.5 (docs/AT_RADIO_FORMATS.md). Key and parameter names are the router's own.
  const NET_MODES = [
    ['WL_AND_5G', 'Auto 5G/4G/3G'], ['LTE_AND_5G', '5G NSA'], ['Only_5G', '5G SA'], ['Only_LTE', '4G only'],
  ];
  const netLabel = (v) => (NET_MODES.find((m) => m[0] === v) || [v, v])[1];
  const clean = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
  async function zte(op, params) {
    const r = await api('/api/zte', { method: 'POST', body: JSON.stringify({ op, params, retry: 0 }) });
    if (r.error) throw new Error(r.error);
    return r.data;
  }
  // One read for both keys. A key the firmware does not know comes back empty: that means "hide the control", never "show 0".
  async function readRadio() {
    const d = (await zte('get', { multi_data: '1', cmd: 'net_select,BearerPreference,performance_mode' })) || {};
    if (typeof d !== 'object') throw new Error('Unexpected router answer');
    return { net: clean(d.net_select) || clean(d.BearerPreference), perf: clean(d.performance_mode) };
  }
  async function setRouter(params) {
    const d = await zte('set', params);
    const res = d && typeof d === 'object' ? d.result : d;
    if (String(res).trim() !== 'success') throw new Error('Router refused the change (' + (res === undefined ? 'no answer' : String(res).slice(0, 80)) + ')');
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let radioBusy = false;

  // sendat prints the closing OK/ERROR with no line break after the data ("+CSQ: 99,99OK"). Put it on its own line and drop blank lines.
  const tidy = (t) => String(t || '').replace(/\r/g, '').replace(/([^\n])(OK|ERROR|\+CME ERROR:[^\n]*|\+CMS ERROR:[^\n]*)\s*$/, '$1\n$2').replace(/\n{2,}/g, '\n').trim();
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
    for (const id of ['matchi_nm', 'matchi_pm', 'matchi_reboot', ...bandBtns]) { const el = document.getElementById(id); if (el) el.disabled = on; }
    document.querySelectorAll('#matchi_cell_panel button.at-cl').forEach((el) => { el.disabled = on; });
  }
  // Show what the router reports. Unknown value (other firmware) is shown as-is in its own option, never mapped to a guess.
  async function refreshRadio() {
    const nmRow = document.getElementById('matchi_nm_row'), pmRow = document.getElementById('matchi_pm_row');
    if (!nmRow || !pmRow) return;
    let st;
    try { st = await readRadio(); }
    catch (e) { nmRow.style.display = pmRow.style.display = 'none'; log('Router settings not available: ' + e.message); return; }
    const nm = document.getElementById('matchi_nm'), pm = document.getElementById('matchi_pm');
    if (!nm || !pm) return;
    if (st.net) {
      nm.querySelectorAll('option[data-extra]').forEach((o) => o.remove());
      if (!NET_MODES.some((m) => m[0] === st.net)) { const o = document.createElement('option'); o.value = st.net; o.dataset.extra = '1'; o.textContent = 'Current: ' + st.net; nm.appendChild(o); }
      nm.value = st.net; nm.dataset.cur = st.net; nmRow.style.display = 'flex';
    } else nmRow.style.display = 'none';
    if (st.perf === '0' || st.perf === '1') { pm.checked = st.perf === '1'; pm.dataset.cur = st.perf; pmRow.style.display = ''; }
    else pmRow.style.display = 'none';
  }
  async function changeNetMode(e) {
    const nm = e.target, prev = nm.dataset.cur || '', next = nm.value;
    if (radioBusy || !next || next === prev) return;
    const ok = await askConfirm('Change network mode from "' + netLabel(prev) + '" to "' + netLabel(next) + '"?\n\n' +
      (next === 'Only_5G' || next === 'Only_LTE' ? 'The phone may lose signal if this network is not available here. ' : '') + 'To go back, choose "Auto 5G/4G/3G".', 'Change');
    if (!ok) { nm.value = prev; return; }
    setRadioBusy(true);
    try {
      log('> Network mode: ' + netLabel(prev) + ' -> ' + netLabel(next));
      await setRouter({ goformId: 'SET_BEARER_PREFERENCE', BearerPreference: next });
      let st = null;
      try { st = await readRadio(); } catch (_) { /* shown below */ }
      if (st && st.net === next) { log('Router now reports: ' + netLabel(next)); createToast('Network mode: ' + netLabel(next), 'green'); }
      else { log('Router accepted the change but reports ' + (st && st.net ? netLabel(st.net) : 'nothing') + '. It may need a moment; open this window again to check.'); createToast('Sent, but the router does not report the new mode yet', 'red'); }
    } catch (err) { log('Network mode failed: ' + err.message); createToast(err.message, 'red'); }
    setRadioBusy(false);
    refreshRadio();
  }
  async function changePerf(e) {
    const pm = e.target, prev = pm.dataset.cur || '', next = pm.checked ? '1' : '0';
    if (radioBusy || next === prev) return;
    const ok = await askConfirm((pm.checked ? 'Turn performance mode ON?' : 'Turn performance mode OFF?') + '\n\nThe router saves it now, but it only takes effect after the router is rebooted. Nothing changes until then.', pm.checked ? 'Turn on' : 'Turn off');
    if (!ok) { pm.checked = prev === '1'; return; }
    setRadioBusy(true);
    try {
      log('> Performance mode ' + (pm.checked ? 'on' : 'off') + ' (effective after reboot)');
      await setRouter({ goformId: 'PERFORMANCE_MODE_SETTING', performance_mode: next });
      let st = null;
      try { st = await readRadio(); } catch (_) { /* shown below */ }
      if (st && st.perf === next) log('Router now reports performance mode ' + (next === '1' ? 'on' : 'off') + '. Reboot the router to apply it.');
      else log('Router accepted the change but reports ' + (st && st.perf ? st.perf : 'nothing') + '. Reboot the router, then open this window again to check.');
      createToast('Saved. Effective after reboot', 'green');
    } catch (err) { log('Performance mode failed: ' + err.message); createToast(err.message, 'red'); }
    setRadioBusy(false);
    refreshRadio();
  }
  // ---- Band lock (Phase 2). Formats: docs/AT_RADIO_FORMATS.md. Read on open and after a change only, never polled. ----
  // LTE_BAND_LOCK / lte_band_lock and NR_BAND_LOCK / nr_band_lock take bare integers joined by ",". Unlike UFI (which sends both
  // and calls one "success" enough), BOTH sent commands must answer "success", and nothing is sent with zero bands ticked.
  const LTE_BANDS = [1, 2, 3, 4, 5, 7, 8, 12, 13, 17, 18, 19, 20, 25, 26, 28, 34, 38, 39, 40, 41, 42, 43];
  const BAND_ORIG = 'matchi_band_orig';
  // "1,3,n28" -> [1,3,28]. null = key not reported at all (hide); '' / "all" / junk -> [] (nothing parsed; raw text is kept for display).
  const parseBands = (v) => {
    if (v === undefined || v === null) return null;
    const out = String(v).split(',').map((x) => parseInt(String(x).trim().replace(/^n/i, ''), 10)).filter((n) => n > 0 && n < 1000);
    return [...new Set(out)].sort((a, b) => a - b);
  };
  const bandText = (l) => l.join(',');
  const bandState = { lte: [], nr: [], lteRaw: '', nrRaw: '', lteSup: [], nrSup: [], haveLte: false, haveNr: false, sel: { lte: new Set(), nr: new Set() } };
  async function readBands() {
    const d = (await zte('get', { multi_data: '1', cmd: 'lte_band_lock,nr_band_lock' })) || {};
    if (typeof d !== 'object') throw new Error('Unexpected router answer');
    return { lteRaw: d.lte_band_lock, nrRaw: d.nr_band_lock, lte: parseBands(d.lte_band_lock), nr: parseBands(d.nr_band_lock) };
  }
  async function readNrSupported() {
    try { return fields(await at('AT+SP5GCMDS="get nr support_band"')).slice(1).map((x) => parseInt(x.replace(/\\/g, ''), 10)).filter((x) => !isNaN(x)); }
    catch (_) { return []; }
  }
  const bandBtns = ['matchi_band_lock', 'matchi_band_unlock', 'matchi_band_restore', 'matchi_band_reapply'];
  function paintBands() {
    const box = document.getElementById('matchi_band_row'); if (!box) return;
    const mk = (type, list, label) => {
      const g = document.getElementById('matchi_band_' + type); if (!g) return;
      g.style.display = list.length ? '' : 'none';
      g.querySelector('.at-bl').textContent = label;
      g.querySelector('.at-bc').innerHTML = list.map((b) => `<button type="button" class="at-bd${bandState.sel[type].has(b) ? ' on' : ''}" data-bt="${type}" data-b="${b}">${type === 'nr' ? 'n' : 'B'}${b}</button>`).join('');
    };
    mk('lte', bandState.lteSup, 'LTE bands (locked now: ' + (bandState.haveLte ? (bandState.lte.length ? bandText(bandState.lte) : (bandState.lteRaw.trim() || 'none reported')) : 'not reported') + ')');
    mk('nr', bandState.nrSup, '5G NR bands (locked now: ' + (bandState.haveNr ? (bandState.nr.length ? bandText(bandState.nr) : (bandState.nrRaw.trim() || 'none reported')) : 'not reported') + ')');
    const rs = document.getElementById('matchi_band_restore'); if (rs) rs.style.display = bandOrig() ? '' : 'none';
  }
  const bandOrig = () => { try { return JSON.parse(localStorage.getItem(BAND_ORIG) || 'null'); } catch (_) { return null; } };
  // The very first lock state seen on this router is kept in this browser, so "Restore original" can send back exactly what the router reported.
  function rememberOrig(b) {
    try { if (!localStorage.getItem(BAND_ORIG)) localStorage.setItem(BAND_ORIG, JSON.stringify({ lte: b.lteRaw == null ? null : String(b.lteRaw), nr: b.nrRaw == null ? null : String(b.nrRaw) })); } catch (_) { /* not fatal */ }
  }
  async function refreshBands(keepSel) {
    const row = document.getElementById('matchi_band_row'); if (!row) return;
    let b;
    try { b = await readBands(); } catch (e) { row.style.display = 'none'; log('Band lock not available: ' + e.message); return; }
    if (!document.getElementById('matchi_band_row')) return;
    if (b.lte === null && b.nr === null) { row.style.display = 'none'; log('Band lock: this firmware does not report lte_band_lock / nr_band_lock, so the control is hidden.'); return; }
    bandState.haveLte = b.lte !== null; bandState.haveNr = b.nr !== null;
    bandState.lte = b.lte || []; bandState.nr = b.nr || [];
    bandState.lteRaw = b.lteRaw == null ? '' : String(b.lteRaw); bandState.nrRaw = b.nrRaw == null ? '' : String(b.nrRaw);
    // A changed list also covers bands the router reports as locked but that are not in the built-in list.
    bandState.lteSup = bandState.haveLte ? [...new Set([...LTE_BANDS, ...bandState.lte])].sort((x, y) => x - y) : [];
    if (bandState.haveNr) {
      const sup = bandState.nrSup.length ? bandState.nrSup : await readNrSupported();
      bandState.nrSup = [...new Set([...sup, ...bandState.nr])].sort((x, y) => x - y);
    } else bandState.nrSup = [];
    if (!keepSel) { bandState.sel.lte = new Set(bandState.lte); bandState.sel.nr = new Set(bandState.nr); }
    rememberOrig(b);
    row.style.display = '';
    paintBands();
  }
  const bandsMsg = (l, n) => (l.length ? l.map((x) => (n ? 'n' : 'B') + x).join(' ') : 'none');
  const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  // The router may drop bands the modem does not support (for example n6), so a read-back that is a non-empty subset of what was sent counts as applied.
  // ok = applied; dropped = bands that were sent but not reported back.
  const bandsCheck = (read, want) => {
    const r = read || [], dropped = want.filter((x) => !r.includes(x));
    return { ok: r.length > 0 && r.every((x) => want.includes(x)), dropped };
  };
  // Sends only the types that are given (each a comma string). Both must answer success; the first failure stops the rest.
  async function sendBands(parts) {
    const sent = [];
    for (const [goformId, param, value] of parts) {
      await setRouter({ goformId, [param]: value }); sent.push(goformId);
    }
    return sent;
  }
  async function applyBandChange(title, detail, parts, expect) {
    if (radioBusy) return;
    if (!(await askConfirm(title + '\n\n' + detail + '\n\nWrong bands can leave the phone without signal. After saving, the modem radio is restarted (signal drops for about 30 s) so the lock takes effect. To go back use \"Restore original\" or \"Unlock all\" here.', 'Apply', true))) return;
    setRadioBusy(true);
    try {
      log('> ' + parts.map((p) => p[0] + ' ' + p[2]).join(' + '));
      const sent = await sendBands(parts);
      log('Router answered success: ' + sent.join(', '));
      let b = null; try { b = await readBands(); } catch (_) { /* shown below */ }
      const bad = [], notes = [];
      if (b && expect.lte !== undefined) { const c = bandsCheck(b.lte, expect.lte); if (!c.ok) bad.push('LTE reports ' + bandsMsg(b.lte || [], false)); else if (c.dropped.length) notes.push('LTE ' + bandsMsg(c.dropped, false) + ' not supported, dropped by the router'); }
      if (b && expect.nr !== undefined) { const c = bandsCheck(b.nr, expect.nr); if (!c.ok) bad.push('5G NR reports ' + bandsMsg(b.nr || [], true)); else if (c.dropped.length) notes.push('5G NR ' + bandsMsg(c.dropped, true) + ' not supported, dropped by the router'); }
      if (notes.length) log('Note: ' + notes.join('; ') + '.');
      if (!b) log('Could not read the bands back. Open this window again to check.');
      else if (bad.length) { log('Router accepted the change but ' + bad.join('; ') + '. Open this window again to check.'); createToast('Sent, but the router does not report the new bands yet', 'red'); }
      else {
        log('Router now reports the new band lock. The modem only uses it after a radio restart, doing that now.');
        createToast('Band lock saved, restarting radio', 'green');
        await radioCycle(true);
      }
    } catch (err) { log('Band lock failed: ' + err.message); createToast(err.message, 'red'); }
    setRadioBusy(false);
    refreshBands(false);
  }
  async function lockBands() {
    const l = [...bandState.sel.lte].sort((a, b) => a - b), n = [...bandState.sel.nr].sort((a, b) => a - b);
    if (!l.length && !n.length) { createToast('Tick at least one band first', 'red'); log('Band lock: nothing ticked, nothing sent. Use \"Unlock all\" to remove a lock.'); return; }
    const parts = [], expect = {}, lines = [];
    if (l.length) { parts.push(['LTE_BAND_LOCK', 'lte_band_lock', bandText(l)]); expect.lte = l; lines.push('LTE: ' + bandsMsg(l, false)); }
    if (n.length) { parts.push(['NR_BAND_LOCK', 'nr_band_lock', bandText(n)]); expect.nr = n; lines.push('5G NR: ' + bandsMsg(n, true)); }
    await applyBandChange('Lock these bands?', lines.join('\n') + (l.length && n.length ? '' : '\n(The other type is left unchanged.)'), parts, expect);
  }
  async function unlockBands() {
    const parts = [], expect = {}, lines = [];
    if (bandState.haveLte && bandState.lteSup.length) { parts.push(['LTE_BAND_LOCK', 'lte_band_lock', bandText(bandState.lteSup)]); expect.lte = bandState.lteSup; lines.push('LTE: ' + bandsMsg(bandState.lteSup, false)); }
    if (bandState.haveNr && bandState.nrSup.length) { parts.push(['NR_BAND_LOCK', 'nr_band_lock', bandText(bandState.nrSup)]); expect.nr = bandState.nrSup; lines.push('5G NR: ' + bandsMsg(bandState.nrSup, true)); }
    if (!parts.length) { createToast('No band list to unlock with', 'red'); return; }
    await applyBandChange('Unlock all: allow every listed band?', lines.join('\n') + '\n\nThis sends the full list shown above. The router may report a different list for \"no lock\"; \"Restore original\" sends back exactly what it reported when this tool first read it.', parts, expect);
  }
  async function restoreBands() {
    const o = bandOrig(); if (!o) return;
    const parts = [], expect = {}, lines = [];
    if (o.lte !== null && bandState.haveLte) { parts.push(['LTE_BAND_LOCK', 'lte_band_lock', o.lte]); const e = parseBands(o.lte); if (e && e.length) expect.lte = e; lines.push('LTE: ' + (o.lte.trim() || '(empty)')); }
    if (o.nr !== null && bandState.haveNr) { parts.push(['NR_BAND_LOCK', 'nr_band_lock', o.nr]); const e = parseBands(o.nr); if (e && e.length) expect.nr = e; lines.push('5G NR: ' + (o.nr.trim() || '(empty)')); }
    if (!parts.length) { createToast('Nothing to restore', 'red'); return; }
    await applyBandChange('Restore the original band lock?', 'As first reported by the router:\n' + lines.join('\n'), parts, expect);
  }
  async function reapplyNetMode() {
    if (radioBusy) return;
    const nm = document.getElementById('matchi_nm'), cur = nm && nm.dataset.cur;
    if (!cur) { createToast('Network mode is not known, so it cannot be re-applied', 'red'); return; }
    if (!(await askConfirm('Re-apply network mode \"' + netLabel(cur) + '\" so the modem picks up the band lock?\n\nSignal may drop for a few seconds.', 'Re-apply'))) return;
    setRadioBusy(true);
    try { log('> Re-apply network mode ' + netLabel(cur)); await setRouter({ goformId: 'SET_BEARER_PREFERENCE', BearerPreference: cur }); log('Router accepted it.'); createToast('Network mode re-applied', 'green'); }
    catch (err) { log('Re-apply failed: ' + err.message); createToast(err.message, 'red'); }
    setRadioBusy(false);
  }

  // ---- Cell lock (Phase 3, highest risk). Formats: docs/AT_RADIO_FORMATS.md. Read only when the "Cell lock" button is pressed or refreshed. ----
  // CELL_LOCK takes pci, earfcn, rat (12 = 4G, 16 = 5G); UNLOCK_ALL_CELL takes nothing. neighbor_cell_info / locked_cell_info are lists.
  const toList = (v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.trim()) { try { const j = JSON.parse(v); return Array.isArray(j) ? j : []; } catch (_) { return []; } }
    return [];
  };
  const ratLabel = (r) => (String(r) === '12' ? '4G' : '5G');   // same as UFI: 12 is 4G, anything else is shown as 5G
  // The neighbour list has no rat field. Only a band written as "n78" / "B3" decides it; a bare number does not, and then the user picks.
  const guessRat = (band) => { const b = String(band == null ? '' : band).trim(); return /^n/i.test(b) ? '16' : /^b/i.test(b) ? '12' : ''; };
  const cellOk = (pci, earfcn, rat) => /^\d{1,4}$/.test(pci) && +pci <= 1007 && /^\d{1,7}$/.test(earfcn) && +earfcn <= 3279165 && (rat === '12' || rat === '16');
  const cellState = { nb: [], locked: [] };
  let cellGen = 0;   // a newer lock or an unlock cancels a pending auto-unlock check
  const cellKeep = () => { try { return localStorage.getItem('matchi_cell_auto') !== '0'; } catch (_) { return true; } };
  async function readCells() {
    const d = (await zte('get', { multi_data: '1', cmd: 'neighbor_cell_info,locked_cell_info' })) || {};
    if (typeof d !== 'object') throw new Error('Unexpected router answer');
    if (d.neighbor_cell_info === undefined && d.locked_cell_info === undefined) throw new Error('this firmware reports neither neighbor_cell_info nor locked_cell_info');
    return { nb: toList(d.neighbor_cell_info), locked: toList(d.locked_cell_info) };
  }
  // Registered = the modem reports status 1 (home) or 5 (roaming) on LTE or 5G. When nothing answers, it counts as not registered (unlocking is the safe side).
  async function isRegistered() {
    for (const c of ['AT+CEREG?', 'AT+C5GREG?']) {
      try { const m = tidy(await at(c)).match(/\+C(?:5G|E)REG:\s*\d+\s*,\s*(\d+)/); if (m && (m[1] === '1' || m[1] === '5')) return true; } catch (_) { /* try the next */ }
    }
    return false;
  }
  function paintCells() {
    const pn = document.getElementById('matchi_cell_list'); if (!pn) return;
    const cell = (c) => c == null || c === '' ? '-' : esc(c);
    const lk = cellState.locked.length ? cellState.locked.map((c) => `<div>${esc(ratLabel(c.rat))} · EARFCN ${cell(c.earfcn)} · PCI ${cell(c.pci)}</div>`).join('') : '<div>No locked cell</div>';
    const nb = cellState.nb.length ? cellState.nb.map((c, i) => `<div class="at-cr"><span>${cell(c.band)} · EARFCN ${cell(c.earfcn)} · PCI ${cell(c.pci)} · RSRP ${cell(c.rsrp)} · RSRQ ${cell(c.rsrq)} · SINR ${cell(c.sinr)}</span><button type="button" class="at-cl" data-ci="${i}">Lock</button></div>`).join('') : '<div>No neighbor cells</div>';
    pn.innerHTML = '<div class="at-bl">Locked now</div>' + lk + '<div class="at-bl" style="margin-top:6px">Neighbor cells</div>' + nb;
  }
  async function refreshCells() {
    const pn = document.getElementById('matchi_cell_list'); if (!pn) return;
    pn.textContent = 'reading…';
    try { const c = await readCells(); cellState.nb = c.nb; cellState.locked = c.locked; paintCells(); }
    catch (e) { pn.textContent = 'Cell info not available: ' + e.message + '. Unlock all still works.'; log('Cell info not available: ' + e.message); }
  }
  async function lockCell(pci, earfcn, rat) {
    if (radioBusy) return;
    if (!cellOk(pci, earfcn, rat)) { createToast('PCI, EARFCN or type is not valid', 'red'); return; }
    const ok = await askConfirm('Lock to this cell?\n\n' + ratLabel(rat) + ' · EARFCN ' + earfcn + ' · PCI ' + pci +
      '\n\nWARNING: a wrong cell can leave the phone with no signal or an unstable one. \"Unlock all cells\" stays on this screen. ' +
      (cellKeep() ? 'If the modem is not registered 60 seconds after the lock, the lock is removed automatically.' : 'Automatic unlock is OFF: you must unlock by hand.'), 'Lock cell', true);
    if (!ok) return;
    setRadioBusy(true);
    let sent = false;
    try {
      log('> CELL_LOCK ' + ratLabel(rat) + ' earfcn=' + earfcn + ' pci=' + pci);
      await setRouter({ goformId: 'CELL_LOCK', pci, earfcn, rat }); sent = true;
      let c = null; try { c = await readCells(); } catch (_) { /* shown below */ }
      if (c) { cellState.nb = c.nb; cellState.locked = c.locked; paintCells(); }
      const hit = c && c.locked.some((x) => String(x.pci) === pci && String(x.earfcn) === earfcn && String(x.rat) === rat);
      if (hit) { log('Router now reports the locked cell.'); createToast('Cell locked', 'green'); }
      else { log('Router accepted the lock but does not list it (yet). Check Signal quality, and unlock if the signal is gone.'); createToast('Sent, but the router does not list the lock yet', 'red'); }
    } catch (err) { log('Cell lock failed: ' + err.message); createToast(err.message, 'red'); }
    setRadioBusy(false);
    if (sent && cellKeep()) cellWatch();
  }
  async function unlockCells(auto) {
    if (radioBusy && !auto) return;
    if (!auto && !(await askConfirm('Unlock all cells?\n\nThe modem may re-register for a few seconds.', 'Unlock all'))) return;
    cellGen++;   // cancel a pending auto-unlock check
    setRadioBusy(true);
    try {
      log('> UNLOCK_ALL_CELL' + (auto ? ' (automatic)' : ''));
      await setRouter({ goformId: 'UNLOCK_ALL_CELL' });
      let c = null; try { c = await readCells(); } catch (_) { /* shown below */ }
      if (c) { cellState.nb = c.nb; cellState.locked = c.locked; paintCells(); }
      if (c && !c.locked.length) log('Router reports no locked cell.'); else log('Router accepted the unlock but still lists a locked cell, or could not be read. Press Refresh.');
      createToast('Cells unlocked', 'green');
    } catch (err) { log('Unlock failed: ' + err.message + '. Try again, or restart the modem.'); createToast(err.message, 'red'); }
    setRadioBusy(false);
  }
  // One check 60 s after a lock: not registered -> the lock is removed. Cancelled by an unlock or a newer lock. Never repeats.
  async function cellWatch() {
    const gen = ++cellGen;
    log('Auto-unlock check in 60 s (switch it off with the tick box if you do not want it).');
    for (let t = 0; t < 12; t++) { await sleep(5000); if (gen !== cellGen) return; }
    if (!cellKeep()) { log('Auto-unlock is off: the cell lock stays.'); return; }
    let reg = false; try { reg = await isRegistered(); } catch (_) { /* counts as not registered */ }
    if (gen !== cellGen) return;
    if (reg) { log('Modem is registered 60 s after the lock: the lock stays. Unlock all cells to remove it.'); return; }
    log('Not registered 60 s after the lock: removing the lock.');
    for (let i = 0; i < 10 && radioBusy; i++) await sleep(1000);
    await unlockCells(true);
  }

  // Radio restart, copied from UFI-TOOLS 4.1.5 (its code is obfuscated; the order was read from the real call sites):
  //   AT+SFUN=5 on SIM slot 0, then slot 1 (radio OFF), then AT+SFUN=4 on slot 0, then slot 1 (radio ON), 100 ms apart.
  // 5 = off and 4 = on (Unisoc). An earlier version here had them the other way round, so the "restart" turned the radio OFF and left it there.
  // The whole sequence runs ON the device in ONE root call. Found on the F50: while the radio is off the browser loses the host for a few
  // seconds, so a step sent from the page ("slot 0 on") never arrived and the radio stayed off. On the device nothing depends on the page.
  // A slot that did not switch off is sent the "on" command once (as UFI does); a slot that did is retried for about 16 s.
  async function atSlot(command, sl) {
    const r = await api('/api/at', { method: 'POST', body: JSON.stringify({ command, slot: sl }) });
    if (r.error) throw new Error(r.error);
    return r.result || '';
  }
  const CYCLE_SH = [
    'SA=/data/data/com.matchi.tool/files/sendat',
    '[ -x "$SA" ] || { echo NOSENDAT; exit 0; }',
    'tx() { "$SA" -n "$1" -c "$2" 2>&1 | tr "\\n\\r" "  "; }',
    'o0=$(tx 0 AT+SFUN=5); echo "OFF0:$o0"',
    'o1=$(tx 1 AT+SFUN=5); echo "OFF1:$o1"',
    'sleep 0.1',
    'for s in 0 1; do',
    '  eval "o=\\$o$s"; n=1; case "$o" in *OK*) n=8;; esac',
    '  i=0; ok=0; r=',
    '  while [ $i -lt $n ]; do r=$(tx $s AT+SFUN=4); case "$r" in *OK*) ok=1; break;; esac; i=$((i+1)); [ $i -lt $n ] && sleep 2; done',
    '  echo "ON$s:$ok:$r"',
    'done',
  ].join('\n');
  async function radioCycle(quiet) {
    log('> Radio restart (AT+SFUN=5 radio off, then AT+SFUN=4 radio on, SIM slots 0 and 1, as UFI-TOOLS does; runs on the device)');
    let text = '', lost = false;
    try { text = await sh(CYCLE_SH, 60000); }
    catch (e) { lost = true; log('The page lost the host while the radio was off (' + e.message + '). The restart keeps going on the device; waiting for the host to come back...'); }
    const get = (k) => { const m = text.match(new RegExp('^' + k + ':(.*)$', 'm')); return m ? m[1].trim() : ''; };
    if (!lost) {
      if (/NOSENDAT/.test(text)) { log('The AT tool (sendat) was not found on the device. Nothing was changed.'); createToast('Radio restart failed, nothing changed', 'red'); return false; }
      for (const sl of [0, 1]) { log('slot ' + sl + ' off: ' + (get('OFF' + sl) || '(no output)')); const o = get('ON' + sl); log('slot ' + sl + ' on: ' + (o ? o.replace(/^[01]:/, '') : '(no output)')); }
      const off = [/OK/.test(get('OFF0')), /OK/.test(get('OFF1'))];
      if (!off[0] && !off[1]) { log('Radio-off step failed on both slots. Nothing was changed.'); createToast('Radio restart failed, nothing changed', 'red'); return false; }
      const bad = [0, 1].filter((sl) => off[sl] && !/^1:/.test(get('ON' + sl)));
      if (!bad.length) { log('Radio is back on. Registration can take about 30 s, then check Live Status.'); createToast('Radio restarted', 'green'); return true; }
      lost = true;   // an "on" step did not get OK: fall through to the check below
      log('Slot ' + bad.join(', ') + ' did not confirm "on". Checking again...');
    }
    // The host (or the modem) is away for a short while. Wait until an AT read answers, then send "on" once more: it is harmless when the radio is already on.
    let up = false;
    for (let i = 0; i < 30 && !up; i++) {
      await sleep(3000);
      try { await atSlot('AT+CSQ', 0); up = true; } catch (_) { /* still away */ }
    }
    if (!up) { log('WARNING: the host or the modem did not answer for 90 s. The radio may still be OFF. When this window works again run AT+SFUN=4 (slot 0, then slot 1), or reboot the device.'); createToast('Radio may still be off: run AT+SFUN=4', 'red'); return false; }
    let ok0 = false;
    for (const sl of [0, 1]) {
      let last = '';
      for (let i = 0; i < 3; i++) { try { last = tidy(await atSlot('AT+SFUN=4', sl)); if (last.includes('OK')) break; } catch (e) { last = e.message; } await sleep(2000); }
      log('slot ' + sl + ' on (again): ' + (last || '(no output)'));
      if (sl === 0) ok0 = last.includes('OK');
    }
    if (ok0) { log('Radio is on. Registration can take about 30 s, then check Live Status.'); createToast('Radio restarted', 'green'); return true; }
    log('WARNING: the radio may still be OFF on slot 0. Run AT+SFUN=4 here now, or reboot the device.'); createToast('Radio may still be off: run AT+SFUN=4', 'red'); return false;
  }

  // Read-only snapshot for support: radio state per SIM slot, registration, and what the router reports for bands / mode / serving cell.
  // Nothing is written. The text is shown here and copied to the clipboard when the browser allows it.
  async function radioReport() {
    if (radioBusy) return;
    log('> Radio report (read only)');
    const out = [];
    const tryAt = async (c, sl) => { try { out.push(c + (sl === undefined ? '' : '  [slot ' + sl + ']') + '\n' + (tidy(sl === undefined ? await at(c) : await atSlot(c, sl)) || '(no output)')); } catch (e) { out.push(c + '\nError: ' + e.message); } };
    await tryAt('AT+SFUN?', 0); await tryAt('AT+SFUN?', 1);
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
    try { await radioCycle(false); } finally { setRadioBusy(false); }
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
#matchi_at_modal .at-bc{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 8px}
#matchi_at_modal .at-bd{min-height:24px;padding:2px 7px;font-size:11.5px;opacity:.6}
#matchi_at_modal .at-bd.on{opacity:1;background:rgba(100,230,164,.35)}
#matchi_at_modal .at-bl{font-size:12px;opacity:.85}
#matchi_at_modal .at-cr{display:flex;align-items:center;justify-content:space-between;gap:6px;margin:2px 0;font-size:11.5px}
#matchi_at_modal #matchi_cell_panel{border:1px solid var(--bd);border-radius:8px;padding:8px;margin-bottom:8px;font-size:11.5px}
#matchi_at_modal #matchi_cell_panel input{width:70px;min-width:0}
#matchi_at_out{height:150px!important;padding:8px!important;font-size:11px;line-height:1.45;margin-top:8px!important}`;
    document.head.appendChild(st);
  }
  function open() {
    atStyle();
    createModal({
      name: MODAL, title: 'AT & Radio', maxWidth: '560px', showConfirm: false, onClose: () => true,
      content:
        '<div style="display:flex;gap:8px;margin-bottom:8px"><select id="matchi_at_slot"><option value="0">SIM slot 0</option><option value="1">SIM slot 1</option></select></div>' +
        '<div id="matchi_nm_row" style="display:none;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap"><label for="matchi_nm">Network mode</label>' +
        '<select id="matchi_nm">' + NET_MODES.map((m) => `<option value="${esc(m[0])}">${esc(m[1])}</option>`).join('') + '</select></div>' +
        '<div class="at-tg" id="matchi_pm_row" style="display:none"><label><input type="checkbox" id="matchi_pm"> Performance mode <small>(effective after reboot)</small></label></div>' +
        '<div id="matchi_band_row" style="display:none;margin-bottom:8px">' +
        '<div id="matchi_band_lte" style="display:none"><div class="at-bl"></div><div class="at-bc"></div></div>' +
        '<div id="matchi_band_nr" style="display:none"><div class="at-bl"></div><div class="at-bc"></div></div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px"><button type="button" id="matchi_band_lock">Lock ticked bands</button><button type="button" id="matchi_band_unlock">Unlock all</button><button type="button" id="matchi_band_restore" style="display:none">Restore original</button><button type="button" id="matchi_band_reapply">Re-apply network mode</button></div></div>' +
        '<div style="font-size:11.5px;opacity:.7;margin-bottom:8px">Network mode and performance mode apply to the whole router, not to the SIM slot above.</div>' +
        '<div id="matchi_cell_panel" style="display:none"><div style="color:#ff9a9a;margin-bottom:6px">Warning: locking the wrong cell can leave the phone with no signal or an unstable one.</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px"><button type="button" class="at-cl" id="matchi_cell_unlock">Unlock all cells</button><button type="button" class="at-cl" id="matchi_cell_refresh">Refresh</button><label style="display:inline-flex;align-items:center;gap:4px"><input type="checkbox" id="matchi_cell_auto"> Auto-unlock if not registered after 60 s</label></div>' +
        '<div id="matchi_cell_list"></div>' +
        '<div class="at-bl" style="margin-top:6px">Lock by hand</div><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center"><input id="matchi_cell_pci" inputmode="numeric" placeholder="PCI"><input id="matchi_cell_earfcn" inputmode="numeric" placeholder="EARFCN"><select id="matchi_cell_rat"><option value="">Type…</option><option value="12">4G</option><option value="16">5G</option></select><button type="button" class="at-cl" id="matchi_cell_manual">Lock</button></div></div>' +
        '<div class="at-tg">' +
        '<label><input type="checkbox" id="matchi_volte" disabled> VoLTE</label>' +
        '<label><input type="checkbox" id="matchi_vonr" disabled> VoNR</label></div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">' +
        PRESETS.map((p) => `<button type="button" data-at="${esc(p[1])}">${esc(p[0])}</button>`).join('') +
        '<button type="button" id="matchi_cell_btn">Cell lock</button><button type="button" id="matchi_bands">NR bands</button><button type="button" id="matchi_reboot">Restart modem</button><button type="button" id="matchi_report">Radio report</button><button type="button" id="matchi_chg">Change IMEI</button></div>' +
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
        const f = fields(await at('AT+SP5GCMDS="get nr support_band"')).slice(1).map((x) => parseInt(x.replace(/\\/g, ''), 10)).filter((x) => !isNaN(x));
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
    document.getElementById('matchi_nm').onchange = changeNetMode;
    document.getElementById('matchi_pm').onchange = changePerf;
    document.getElementById('matchi_band_row').onclick = (e) => {
      const t = e.target.closest && e.target.closest('.at-bd'); if (!t || radioBusy) return;
      const set = bandState.sel[t.dataset.bt], b = +t.dataset.b;
      if (set.has(b)) set.delete(b); else set.add(b);
      t.classList.toggle('on', set.has(b));
    };
    document.getElementById('matchi_report').onclick = radioReport;
    document.getElementById('matchi_band_lock').onclick = lockBands;
    document.getElementById('matchi_band_unlock').onclick = unlockBands;
    document.getElementById('matchi_band_restore').onclick = restoreBands;
    document.getElementById('matchi_band_reapply').onclick = reapplyNetMode;
    document.getElementById('matchi_cell_btn').onclick = () => {
      const pn = document.getElementById('matchi_cell_panel'); const show = pn.style.display === 'none'; pn.style.display = show ? '' : 'none';
      if (show) refreshCells();
    };
    const auto = document.getElementById('matchi_cell_auto'); auto.checked = cellKeep();
    auto.onchange = () => { try { localStorage.setItem('matchi_cell_auto', auto.checked ? '1' : '0'); } catch (_) { /* not fatal */ } };
    document.getElementById('matchi_cell_refresh').onclick = refreshCells;
    document.getElementById('matchi_cell_unlock').onclick = () => unlockCells(false);
    document.getElementById('matchi_cell_manual').onclick = () => {
      const g = (id) => document.getElementById(id).value.trim();
      lockCell(g('matchi_cell_pci'), g('matchi_cell_earfcn'), g('matchi_cell_rat'));
    };
    document.getElementById('matchi_cell_list').onclick = (e) => {
      const t = e.target.closest && e.target.closest('[data-ci]'); if (!t) return;
      const c = cellState.nb[+t.dataset.ci]; if (!c) return;
      const rat = guessRat(c.band) || document.getElementById('matchi_cell_rat').value;
      if (!rat) { createToast('Choose 4G or 5G in the box below first (the band name does not say)', 'red'); return; }
      lockCell(String(c.pci), String(c.earfcn), rat);
    };
    document.getElementById('matchi_reboot').onclick = rebootModem;
    document.getElementById('matchi_at_slot').onchange = () => { refreshSwitches(); bandState.nrSup = []; refreshBands(false); };
    refreshSwitches();
    refreshRadio();
    refreshBands(false);
  }

  const host = document.querySelector('.actions-buttons'); if (!host) return;
  const b = document.createElement('button');
  b.id = BTN_ID; b.textContent = 'AT & Radio'; b.onclick = open; host.appendChild(b);
})();


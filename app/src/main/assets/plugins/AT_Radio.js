/*
 * AT & Radio - MatchiTOOL plugin
 * Ported from UFI-TOOLS (MIT, (c) 2025 Minikano): AT command terminal, VoLTE / VoNR switches, NR band list.
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

  const PRESETS = [
    ['Signal quality', '@signal'], ['Operator', 'AT+COPS?'], ['Registration', 'AT+CEREG?'],
    ['IMEI', 'AT+CGSN'], ['SIM ICCID', 'AT+CCID'], ['Modem info', 'ATI'],
  ];

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
    log('> ' + cmd);
    try { log(tidy(await at(cmd)) || '(no output)'); } catch (e) { log('Error: ' + e.message); }
  }

  async function refreshSwitches() {
    for (const [id, getter] of [['matchi_volte', getVoLTE], ['matchi_vonr', getVoNR]]) {
      const el = document.getElementById(id); if (!el) continue;
      try { el.checked = await getter(); el.disabled = false; } catch (e) { el.disabled = true; log(id + ': ' + e.message); }
    }
  }

  function open() {
    createModal({
      name: MODAL, title: 'AT & Radio', maxWidth: '560px', showConfirm: false, onClose: () => true,
      content:
        '<div style="display:flex;gap:8px;margin-bottom:8px"><select id="matchi_at_slot"><option value="0">SIM slot 0</option><option value="1">SIM slot 1</option></select></div>' +
        '<div style="display:flex;gap:16px;margin-bottom:10px;flex-wrap:wrap">' +
        '<label><input type="checkbox" id="matchi_volte" disabled style="width:auto"> VoLTE</label>' +
        '<label><input type="checkbox" id="matchi_vonr" disabled style="width:auto"> VoNR</label></div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">' +
        PRESETS.map((p) => `<button type="button" data-at="${esc(p[1])}">${esc(p[0])}</button>`).join('') +
        '<button type="button" id="matchi_bands">NR bands</button></div>' +
        '<input id="matchi_at_in" placeholder="AT command, e.g. AT+CSQ" autocomplete="off" autocapitalize="characters" spellcheck="false">' +
        '<pre id="matchi_at_out" style="background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:10px;height:200px;overflow:auto;white-space:pre-wrap;margin:10px 0 0"></pre>',
    });
    showModal(MODAL);
    const root = document.getElementById(MODAL);
    root.querySelectorAll('[data-at]').forEach((b) => (b.onclick = () => run(b.dataset.at)));
    document.getElementById('matchi_at_in').onkeydown = (e) => { if (e.key === 'Enter') { run(e.target.value); e.target.value = ''; } };
    document.getElementById('matchi_bands').onclick = async () => {
      try {
        const f = fields(await at('AT+SP5GCMDS="get nr support_band"')).slice(1).map((x) => parseInt(x.replace(/\\/g, ''), 10)).filter((x) => !isNaN(x));
        log('> NR supported bands\n' + (f.length ? f.map((b) => 'n' + b).join(' ') : '(none parsed)'));
      } catch (e) { log('Error: ' + e.message); }
    };
    for (const [id, setter, name] of [['matchi_volte', setVoLTE, 'VoLTE'], ['matchi_vonr', setVoNR, 'VoNR']]) {
      document.getElementById(id).onchange = async (e) => {
        const on = e.target.checked;
        try { const ok = await setter(on); createToast(ok ? name + (on ? ' on' : ' off') : name + ' change failed', ok ? 'green' : 'red'); }
        catch (err) { createToast(err.message, 'red'); }
        refreshSwitches();
      };
    }
    document.getElementById('matchi_at_slot').onchange = refreshSwitches;
    refreshSwitches();
  }

  const host = document.querySelector('.actions-buttons'); if (!host) return;
  const b = document.createElement('button');
  b.id = BTN_ID; b.textContent = 'AT & Radio'; b.onclick = open; host.appendChild(b);
})();

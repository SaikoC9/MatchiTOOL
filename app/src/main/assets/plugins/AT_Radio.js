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
    ['Signal quality', 'AT+CSQ'], ['Operator', 'AT+COPS?'], ['Registration', 'AT+CEREG?'],
    ['IMEI', 'AT+CGSN'], ['SIM ICCID', 'AT+CCID'], ['Modem info', 'ATI'],
  ];

  function log(line) {
    const o = document.getElementById('matchi_at_out'); if (!o) return;
    o.textContent += line + '\n'; o.scrollTop = o.scrollHeight;
  }
  async function run(cmd) {
    cmd = (cmd || '').trim(); if (!cmd) return;
    log('> ' + cmd);
    try { log(await at(cmd) || '(no output)'); } catch (e) { log('Error: ' + e.message); }
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

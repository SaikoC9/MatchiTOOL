/*
 * Signal Info - MatchiTOOL plugin
 * Ported idea from UFI-TOOLS (MIT, (c) 2025 Minikano): live 4G/5G signal data from the router's web API.
 * Falls back to AT commands (AT+CSQ / AT+COPS? / AT+CEREG?) when the web API is not reachable.
 */
(() => {
  'use strict';
  const MODAL = 'matchi_signal_modal', BTN_ID = 'matchi_signal_btn';
  if (document.getElementById(BTN_ID)) return;

  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const KEYS = [
    'network_type', 'network_provider', 'signalbar', 'rssi',
    'lte_rsrp', 'lte_rsrq', 'lte_snr', 'lte_pci', 'wan_active_band', 'wan_active_channel',
    'Z5g_rsrp', 'Z5g_rsrq', 'Z5g_SINR', 'nr5g_pci', 'nr5g_action_band', 'nr5g_action_channel',
  ];

  // Threshold tables: [excellent, good, fair]; below fair is poor. Higher is better for all three.
  const RATE = { rsrp: [-80, -90, -100], rsrq: [-8, -11, -15], sinr: [20, 13, 0] };
  const LABEL = ['Excellent', 'Good', 'Fair', 'Poor'];
  const COLOR = ['#2b8a3e', '#66a80f', '#e8590c', '#c92a2a'];
  function rate(kind, v) {
    const n = parseFloat(v); if (isNaN(n)) return '';
    const t = RATE[kind]; let i = 0; while (i < 3 && n < t[i]) i++;
    return `<span style="color:${COLOR[i]}">${LABEL[i]}</span>`;
  }
  const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';

  function section(title, rows) {
    rows = rows.filter((r) => has(r[1]));
    if (!rows.length) return '';
    return `<div style="margin:10px 0 4px;font-weight:600">${esc(title)}</div><table style="width:100%;border-collapse:collapse">` +
      rows.map((r) => `<tr><td style="padding:4px 8px 4px 0;opacity:.7">${esc(r[0])}</td><td style="padding:4px 0;text-align:right">${esc(r[1])}${r[2] ? ' ' + r[2] : ''}</td></tr>`).join('') +
      '</table>';
  }

  function render(d) {
    const bars = parseInt(d.signalbar, 10);
    const barTxt = isNaN(bars) ? '' : '▮'.repeat(bars) + '▯'.repeat(Math.max(0, 5 - bars));
    return section('Connection', [
      ['Network', d.network_type], ['Operator', d.network_provider], ['Signal bars', barTxt],
      ['RSSI', has(d.rssi) ? d.rssi + ' dBm' : ''],
    ]) + section('4G (LTE)', [
      ['RSRP', has(d.lte_rsrp) ? d.lte_rsrp + ' dBm' : '', rate('rsrp', d.lte_rsrp)],
      ['RSRQ', has(d.lte_rsrq) ? d.lte_rsrq + ' dB' : '', rate('rsrq', d.lte_rsrq)],
      ['SINR', has(d.lte_snr) ? d.lte_snr + ' dB' : '', rate('sinr', d.lte_snr)],
      ['PCI', d.lte_pci], ['Band', d.wan_active_band], ['Channel (EARFCN)', d.wan_active_channel],
    ]) + section('5G (NR)', [
      ['RSRP', has(d.Z5g_rsrp) ? d.Z5g_rsrp + ' dBm' : '', rate('rsrp', d.Z5g_rsrp)],
      ['RSRQ', has(d.Z5g_rsrq) ? d.Z5g_rsrq + ' dB' : '', rate('rsrq', d.Z5g_rsrq)],
      ['SINR', has(d.Z5g_SINR) ? d.Z5g_SINR + ' dB' : '', rate('sinr', d.Z5g_SINR)],
      ['PCI', d.nr5g_pci], ['Band', d.nr5g_action_band], ['Channel (NR-ARFCN)', d.nr5g_action_channel],
    ]);
  }

  async function viaAt() {
    const run = async (command) => {
      const r = await api('/api/at', { method: 'POST', body: JSON.stringify({ command, slot: 0 }) });
      if (r.error) throw new Error(r.error);
      return r.result || '';
    };
    const out = [];
    for (const c of ['AT+CSQ', 'AT+COPS?', 'AT+CEREG?']) out.push('> ' + c + '\n' + (await run(c)));
    return '<pre style="white-space:pre-wrap;margin:0">' + esc(out.join('\n\n')) + '</pre>';
  }

  async function refresh() {
    const box = document.getElementById('matchi_signal_body'); if (!box) return;
    try {
      const r = await api('/api/zte', { method: 'POST', body: JSON.stringify({ op: 'get', params: { multi_data: '1', cmd: KEYS.join(',') } }) });
      if (r.error) throw new Error(r.error);
      const html = r.data && typeof r.data === 'object' ? render(r.data) : '';
      if (!html) throw new Error('router returned no signal fields');
      box.innerHTML = html;
    } catch (e) {
      try { box.innerHTML = '<div class="mut" style="margin-bottom:6px">Router API unavailable (' + esc(e.message) + '). Showing AT data:</div>' + (await viaAt()); }
      catch (e2) { box.textContent = 'Error: ' + e.message + ' / ' + e2.message; }
    }
  }

  let timer = null;
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

  function open() {
    createModal({
      name: MODAL, title: 'Signal info', maxWidth: '460px', showConfirm: false, onClose: () => { stop(); return true; },
      content: '<div id="matchi_signal_body">Loading…</div>' +
        '<div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap">' +
        '<button type="button" id="matchi_signal_refresh">Refresh</button>' +
        '<label><input type="checkbox" id="matchi_signal_auto" style="width:auto"> Auto (5 s)</label></div>',
    });
    showModal(MODAL);
    document.getElementById('matchi_signal_refresh').onclick = refresh;
    document.getElementById('matchi_signal_auto').onchange = (e) => {
      stop(); if (e.target.checked) timer = setInterval(() => { if (document.getElementById('matchi_signal_body')) refresh(); else stop(); }, 5000);
    };
    refresh();
  }

  const host = document.querySelector('.actions-buttons'); if (!host) return;
  const b = document.createElement('button');
  b.id = BTN_ID; b.textContent = 'Signal info'; b.onclick = open; host.appendChild(b);
})();

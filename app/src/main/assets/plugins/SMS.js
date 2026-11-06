/*
 * SMS - MatchiTOOL plugin
 * Ported idea from UFI-TOOLS (MIT, (c) 2025 Minikano): read, send and delete SMS using the router's web API.
 * Needs the router admin password (set once in the plugin's settings row).
 * Not included: SMS forwarding to email/webhook.
 */
(() => {
  'use strict';
  const MODAL = 'matchi_sms_modal', BTN_ID = 'matchi_sms_btn';
  if (document.getElementById(BTN_ID)) return;

  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // The router stores message text as UTF-16BE hex (4 hex digits per character).
  function hexToText(h) {
    h = String(h || '');
    if (!h || h.length % 4 || /[^0-9A-Fa-f]/.test(h)) return h;
    let s = '';
    for (let i = 0; i < h.length; i += 4) s += String.fromCharCode(parseInt(h.substr(i, 4), 16));
    return s;
  }
  function textToHex(t) {
    let h = '';
    for (let i = 0; i < t.length; i++) h += t.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
    return h;
  }
  // "26,11,05,13:42:00,+8" or "26,11,05,13,42,00,+8" -> "2026-11-05 13:42:00"
  function fmtDate(d) {
    const p = String(d || '').split(/[,:]/).map((x) => x.trim());
    if (p.length < 6 || p.slice(0, 6).some((x) => !/^\d+$/.test(x))) return String(d || '');
    return `20${p[0].padStart(2, '0')}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')} ${p[3].padStart(2, '0')}:${p[4].padStart(2, '0')}:${p[5].padStart(2, '0')}`;
  }
  function smsTime() {
    const n = new Date(), z = (v) => String(v).padStart(2, '0');
    const tz = -n.getTimezoneOffset() / 60;
    return [z(n.getFullYear() % 100), z(n.getMonth() + 1), z(n.getDate()), z(n.getHours()), z(n.getMinutes()), z(n.getSeconds()), (tz >= 0 ? '+' : '') + tz].join(';');
  }
  const isOut = (tag) => ['2', '3', '4'].includes(String(tag)); // 2 sent, 3 send failed, 4 draft

  async function zte(op, params) {
    const r = await api('/api/zte', { method: 'POST', body: JSON.stringify({ op, params }) });
    if (r.error) throw new Error(r.error);
    return r.data;
  }
  const el = (id) => document.getElementById(id);

  async function load() {
    const box = el('matchi_sms_list'); if (!box) return;
    box.textContent = 'Loading…';
    try {
      const d = await zte('get', { cmd: 'sms_data_total', page: '0', data_per_page: '500', mem_store: '1', tags: '10', order_by: 'order by id desc' });
      const list = (d && d.messages) || [];
      if (!list.length) { box.innerHTML = '<div class="mut">No messages.</div>'; return; }
      box.textContent = '';
      for (const m of list) {
        const row = document.createElement('div');
        row.style.cssText = 'border-top:1px solid var(--bd);padding:8px 0';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:13px';
        const who = document.createElement('b'); who.textContent = (isOut(m.tag) ? '→ ' : '← ') + m.number;
        const when = document.createElement('span'); when.className = 'mut'; when.style.flex = '1'; when.textContent = fmtDate(m.date);
        const del = document.createElement('button'); del.textContent = 'Delete'; del.style.padding = '3px 8px';
        del.onclick = async () => {
          if (!confirm('Delete this message?')) return;
          try { await zte('set', { goformId: 'DELETE_SMS', msg_id: m.id + ';', notCallback: 'true' }); load(); }
          catch (e) { createToast(e.message, 'red'); }
        };
        head.append(who, when, del);
        const body = document.createElement('div'); body.style.cssText = 'white-space:pre-wrap;word-break:break-word;margin-top:4px';
        body.textContent = hexToText(m.content);
        row.append(head, body); box.appendChild(row);
      }
    } catch (e) { box.textContent = 'Error: ' + e.message; }
  }

  async function send() {
    const num = el('matchi_sms_num').value.trim(), text = el('matchi_sms_text').value;
    if (!/^\+?[0-9;]{3,40}$/.test(num)) return createToast('Enter a valid number', 'red');
    if (!text) return createToast('Message is empty', 'red');
    const btn = el('matchi_sms_send'); btn.disabled = true;
    try {
      const d = await zte('set', { goformId: 'SEND_SMS', notCallback: 'true', Number: num, sms_time: smsTime(), MessageBody: textToHex(text), ID: '-1', encode_type: 'UNICODE' });
      const ok = d && typeof d === 'object' && d.result === 'success';
      createToast(ok ? 'Message sent' : 'Send failed: ' + (d && d.result ? d.result : 'unknown'), ok ? 'green' : 'red');
      if (ok) { el('matchi_sms_text').value = ''; setTimeout(load, 1500); }
    } catch (e) { createToast(e.message, 'red'); }
    btn.disabled = false;
  }

  async function loadCfg() {
    try {
      const c = await api('/api/zte/config');
      el('matchi_sms_host').value = c.host || '';
      el('matchi_sms_pass').placeholder = c.passwordSet ? '(saved, leave empty to keep)' : 'Router admin password';
    } catch (_) {}
  }
  async function saveCfg() {
    const body = { host: el('matchi_sms_host').value.trim() };
    if (el('matchi_sms_pass').value) body.password = el('matchi_sms_pass').value;
    try {
      const r = await api('/api/zte/config', { method: 'POST', body: JSON.stringify(body) });
      if (r.error) throw new Error(r.error);
      el('matchi_sms_pass').value = ''; createToast('Saved'); loadCfg(); load();
    } catch (e) { createToast(e.message, 'red'); }
  }

  function open() {
    createModal({
      name: MODAL, title: 'SMS', maxWidth: '620px', showConfirm: false, onClose: () => true,
      content:
        '<div style="display:flex;gap:8px;margin-bottom:8px"><input id="matchi_sms_num" placeholder="Number, e.g. +639171234567" inputmode="tel" autocomplete="off"></div>' +
        '<textarea id="matchi_sms_text" rows="3" placeholder="Message" style="width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--bd);border-radius:8px;padding:9px;font:inherit"></textarea>' +
        '<div style="display:flex;gap:8px;margin:8px 0"><button type="button" id="matchi_sms_send">Send</button><button type="button" id="matchi_sms_refresh">Refresh inbox</button></div>' +
        '<div id="matchi_sms_list" style="max-height:45vh;overflow:auto"></div>' +
        '<details style="margin-top:10px"><summary class="mut">Router settings</summary>' +
        '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><input id="matchi_sms_host" placeholder="Gateway, e.g. 192.168.0.1" style="flex:1;min-width:150px">' +
        '<input id="matchi_sms_pass" type="password" placeholder="Router admin password" autocomplete="off" style="flex:1;min-width:150px">' +
        '<button type="button" id="matchi_sms_save">Save</button></div></details>',
    });
    showModal(MODAL);
    el('matchi_sms_send').onclick = send;
    el('matchi_sms_refresh').onclick = load;
    el('matchi_sms_save').onclick = saveCfg;
    loadCfg(); load();
  }

  const host = document.querySelector('.actions-buttons'); if (!host) return;
  const b = document.createElement('button');
  b.id = BTN_ID; b.textContent = 'SMS'; b.onclick = open; host.appendChild(b);
})();

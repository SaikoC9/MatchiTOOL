/*
 * SMS - MatchiTOOL plugin
 * Ported idea from UFI-TOOLS (MIT, (c) 2025 Minikano): read, send and delete SMS using the router's web API.
 * Needs the router admin password (set once in the plugin's settings row).
 * Conversation view (messages grouped by number; open one to read and reply), the plain all-messages list as a switch, and Delete all.
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

  // ---- messages: read, group by number, show, delete ------------------------------------------------------------------------
  let msgs = [], view = 'conv', openKey = null;   // view: 'conv' (conversations) or 'list' (all messages, newest first)
  const mk = (tag, css, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text !== undefined) e.textContent = text; return e; };
  // Same person, different writing (+639171234567 / 09171234567): compare the last 9 digits. Short sender names compare as written.
  const keyOf = (n) => { const d = String(n || '').replace(/\D/g, ''); return d.length >= 7 ? d.slice(-9) : String(n || '').trim().toLowerCase(); };
  const later = (a, b) => (a.date === b.date ? Number(a.id) - Number(b.id) : (a.date < b.date ? -1 : 1));

  async function fetchMsgs() {
    const d = await zte('get', { cmd: 'sms_data_total', page: '0', data_per_page: '500', mem_store: '1', tags: '10', order_by: 'order by id desc' });
    msgs = ((d && d.messages) || []).map((m) => ({ id: String(m.id), number: String(m.number || ''), tag: m.tag, date: fmtDate(m.date), text: hexToText(m.content) })).sort(later);
  }
  function groups() {
    const g = new Map();
    for (const m of msgs) {
      const k = keyOf(m.number);
      if (!g.has(k)) g.set(k, { key: k, number: m.number, items: [] });
      const c = g.get(k); c.items.push(m); c.number = m.number;   // items are oldest first, so number ends as the newest one
    }
    return new Map([...g.entries()].sort((x, y) => later(y[1].items[y[1].items.length - 1], x[1].items[x[1].items.length - 1])));
  }
  // The router deletes several messages in one call: msg_id = "id1;id2;id3;". Sent in groups of 20.
  async function removeIds(ids) {
    for (let i = 0; i < ids.length; i += 20) {
      const d = await zte('set', { goformId: 'DELETE_SMS', msg_id: ids.slice(i, i + 20).join(';') + ';', notCallback: 'true' });
      if (d && typeof d === 'object' && d.result && d.result !== 'success') throw new Error('Delete failed: ' + d.result);
    }
  }
  function busy(on) { for (const id of ['matchi_sms_delall', 'matchi_sms_view', 'matchi_sms_refresh']) { const b = el(id); if (b) b.disabled = on; } }

  async function deleteIds(ids, ask) {
    if (!ids.length || !confirm(ask)) return;
    busy(true);
    try { await removeIds(ids); await fetchMsgs(); createToast('Deleted', 'green'); }
    catch (e) { createToast(e.message, 'red'); try { await fetchMsgs(); } catch (_) {} }
    render(); busy(false);
  }
  // Delete all: what the inbox shows is read, deleted, read again; repeated while the count goes down (the list holds up to 500 at a time).
  async function deleteAll() {
    if (!msgs.length) return createToast('No messages', 'red');
    if (!confirm('Delete ALL ' + msgs.length + ' messages on the router? This cannot be undone.')) return;
    busy(true);
    try {
      for (let round = 0; round < 10 && msgs.length; round++) {
        const before = msgs.length;
        await removeIds(msgs.map((m) => m.id));
        await fetchMsgs();
        if (msgs.length >= before) break;
      }
      openKey = null;
      createToast(msgs.length ? msgs.length + ' messages are still there' : 'All messages deleted', msgs.length ? 'red' : 'green');
    } catch (e) { createToast(e.message, 'red'); try { await fetchMsgs(); } catch (_) {} }
    render(); busy(false);
  }

  function renderFlat(box) {
    for (const m of [...msgs].reverse()) {
      const row = mk('div', 'border-top:1px solid var(--bd);padding:8px 0');
      const head = mk('div', 'display:flex;gap:8px;align-items:center;font-size:13px');
      const del = mk('button', 'padding:3px 8px', 'Delete');
      del.onclick = () => deleteIds([m.id], 'Delete this message?');
      const when = mk('span', 'flex:1', m.date); when.className = 'mut';
      head.append(mk('b', '', (isOut(m.tag) ? '→ ' : '← ') + m.number), when, del);
      row.append(head, mk('div', 'white-space:pre-wrap;word-break:break-word;margin-top:4px', m.text));
      box.appendChild(row);
    }
  }
  function renderConvList(box, convs) {
    for (const c of convs.values()) {
      const last = c.items[c.items.length - 1];
      const row = mk('div', 'border-top:1px solid var(--bd);padding:9px 2px;display:flex;gap:10px;align-items:center;cursor:pointer');
      row.setAttribute('role', 'button'); row.tabIndex = 0;
      const left = mk('div', 'flex:1;min-width:0');
      const snippet = mk('div', 'font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', (isOut(last.tag) ? '→ ' : '') + last.text.replace(/\s+/g, ' '));
      snippet.className = 'mut';
      left.append(mk('b', 'font-size:13.5px', c.number), snippet);
      const right = mk('div', 'text-align:right;font-size:11.5px;flex:none');
      right.className = 'mut';
      right.append(mk('div', '', last.date.slice(0, 16)), mk('div', 'font-weight:700', c.items.length + (c.items.length === 1 ? ' message' : ' messages')));
      row.append(left, right);
      const go = () => { openKey = c.key; const n = el('matchi_sms_num'); if (n) n.value = c.number; render(); };
      row.onclick = go;
      row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
      box.appendChild(row);
    }
  }
  function renderThread(box, c) {
    const bar = mk('div', 'display:flex;gap:8px;align-items:center;margin-bottom:8px;position:sticky;top:0;background:var(--card,var(--bg));padding:2px 0;z-index:1');
    const back = mk('button', 'padding:3px 10px', '← Back');
    back.onclick = () => { openKey = null; render(); };
    const delc = mk('button', 'padding:3px 8px', 'Delete conversation');
    delc.onclick = () => deleteIds(c.items.map((m) => m.id), 'Delete all ' + c.items.length + ' messages with ' + c.number + '?');
    bar.append(back, mk('b', 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis', c.number), delc);
    box.appendChild(bar);
    const col = mk('div', 'display:flex;flex-direction:column;gap:6px');
    for (const m of c.items) {
      const out = isOut(m.tag);
      const bub = mk('div', 'max-width:85%;padding:7px 10px;border-radius:12px;align-self:' + (out ? 'flex-end' : 'flex-start') + ';background:' + (out ? 'rgba(90,150,255,.18)' : 'rgba(255,255,255,.07)'));
      const meta = mk('div', 'display:flex;gap:8px;align-items:center;font-size:11px;margin-top:4px');
      meta.className = 'mut';
      const del = mk('button', 'padding:1px 6px;font-size:11px;margin-left:auto', 'Delete');
      del.onclick = () => deleteIds([m.id], 'Delete this message?');
      meta.append(mk('span', '', (String(m.tag) === '3' ? 'Send failed · ' : String(m.tag) === '4' ? 'Draft · ' : '') + m.date), del);
      bub.append(mk('div', 'white-space:pre-wrap;word-break:break-word', m.text), meta);
      col.appendChild(bub);
    }
    box.appendChild(col);
    box.scrollTop = box.scrollHeight;   // newest message at the bottom, in view
  }
  function render() {
    const box = el('matchi_sms_list'); if (!box) return;
    box.textContent = '';
    const vb = el('matchi_sms_view'); if (vb) vb.textContent = view === 'conv' ? 'View: Conversations' : 'View: All messages';
    const da = el('matchi_sms_delall'); if (da) da.textContent = msgs.length ? 'Delete all (' + msgs.length + ')' : 'Delete all';
    if (!msgs.length) { const d = mk('div', '', 'No messages.'); d.className = 'mut'; box.appendChild(d); return; }
    if (view === 'list') return renderFlat(box);
    const convs = groups();
    if (openKey && convs.has(openKey)) return renderThread(box, convs.get(openKey));
    openKey = null; renderConvList(box, convs);
  }
  async function load() {
    const box = el('matchi_sms_list'); if (!box) return;
    box.textContent = 'Loading…';
    try { await fetchMsgs(); render(); } catch (e) { box.textContent = 'Error: ' + e.message; }
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
        '<div style="display:flex;gap:8px;margin:8px 0"><button type="button" id="matchi_sms_send">Send</button><button type="button" id="matchi_sms_refresh">Refresh inbox</button><button type="button" id="matchi_sms_view">View: Conversations</button><button type="button" id="matchi_sms_delall" style="margin-left:auto">Delete all</button></div>' +
        '<div id="matchi_sms_list" style="max-height:45vh;overflow:auto"></div>' +
        '<details style="margin-top:10px"><summary class="mut">Router settings</summary>' +
        '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><input id="matchi_sms_host" placeholder="Gateway, e.g. 192.168.0.1" style="flex:1;min-width:150px">' +
        '<input id="matchi_sms_pass" type="password" placeholder="Router admin password" autocomplete="off" style="flex:1;min-width:150px">' +
        '<button type="button" id="matchi_sms_save">Save</button></div></details>',
    });
    showModal(MODAL);
    el('matchi_sms_send').onclick = send;
    el('matchi_sms_refresh').onclick = load;
    el('matchi_sms_view').onclick = () => { view = view === 'conv' ? 'list' : 'conv'; openKey = null; render(); };
    el('matchi_sms_delall').onclick = deleteAll;
    el('matchi_sms_save').onclick = saveCfg;
    loadCfg(); load();
  }

  const host = document.querySelector('.actions-buttons'); if (!host) return;
  const b = document.createElement('button');
  b.id = BTN_ID; b.textContent = 'SMS'; b.onclick = open; host.appendChild(b);
})();

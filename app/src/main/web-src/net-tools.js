/*
 * Network window. Button "Network" in the top button row. Tabs: Data, Wi-Fi, Devices, APN, LAN / DHCP, MTU / MSS.
 * Phase 1: every tab reads. Phase 2: the Data tab also switches mobile data off / on (confirm, send, re-read ppp_status every 2 s for at
 * most 30 s, never claim success without the re-read). Phase 4: the Devices tab renames, blocks and unblocks devices (confirm, send, re-read
 * the lists, say what the router reports). Phase 5: the APN tab reads the profile list, switches back to Auto, uses / adds / edits / deletes profiles
 * (confirm, send, re-read, then check that mobile data is connected; writes only in Manual mode, plus one guarded way in from Auto). Phase 7: the MTU / MSS tab changes both values with the router's own call (confirm, backup copy by root, send, wait for the restart, re-read, root checks).
 * Phase 6a: the LAN / DHCP tab changes the DHCP pool and the lease (same steps: confirm, backup copy by root, send, wait for the restart, re-read).
 * Phase 6b: the same tab changes the router IP (pool moved into the new subnet, pending note written by root, host told the new address, host checks the router after the restart and
 * puts the old values back if needed) and puts DHCP back On when it was switched Off elsewhere. The mask is not changed and DHCP is never switched Off here.
 * Phase 3: the Wi-Fi tab switches band (2.4 GHz only / 5 GHz only / Off) and changes name, security, SSID broadcast, password and max devices (confirm, backup copy by root, send, wait for Wi-Fi to restart, re-read).
 * Everything else is still read only; the one root call (MTU / MSS tab) is a
 * read-only command that the user starts with a button. Parsing lives in web-src/net-core.js (window.MatchiNetCore, tested by scripts/test_net_tools.js);
 * router calls go through window.MatchiRadio.zte (the same /api/zte proxy as the radio tools).
 *  - Reads happen when a tab is opened for the first time and on the Refresh button. No timer, no polling.
 *  - While the window is open Live Status is paused (MatchiRadio.beginBusy), and it reads once again after the window closes.
 *  - A key the router leaves empty shows "Not reported by this router", never a made-up value.
 *  - The Wi-Fi password and APN passwords are never shown: the parser does not copy them.
 *  - Every value is put on the page with textContent (no markup built from router text).
 */
function mountNetTools() {
  'use strict';
  const R = window.MatchiRadio, N = window.MatchiNetCore, host = document.querySelector('.actions-buttons');
  if (!R || !N || !host || document.getElementById('matchi_net_btn')) return;
  const MODAL = 'matchi_net_modal', NOT = 'Not reported by this router';
  const st = { tab: 'data', cache: {}, root: null, rootErr: '', rootBusy: false, loading: false, release: null, act: null, actMsg: null, devAct: false, devMsg: null, me: '', apnAct: false, apnMsg: null, apnForm: null, mtuAct: false, mtuMsg: null, mtuForm: null, lanAct: false, lanMsg: null, lanForm: null, lanIp: '', wifiAct: false, wifiMsg: null, wifiForm: null, wifiBandSel: null, prog: '' };
  let epoch = 0, actId = 0;
  // Any write or wait in progress (one change at a time, whichever tab it started on).
  const anyAct = () => !!(st.act || st.devAct || st.apnAct || st.mtuAct || st.lanAct || st.wifiAct);

  // ---- tiny DOM helper (text only) ------------------------------------------------------------------------------------------
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag), a = attrs || {};
    for (const k of Object.keys(a)) {
      if (k === 'class') e.className = a[k];
      else if (k === 'text') e.textContent = a[k];
      else e.setAttribute(k, a[k]);
    }
    for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c && c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  };
  const $ = (id) => document.getElementById(id);
  const notReported = () => h('span', { class: 'net-mut' }, NOT);
  const val = (v) => (v === null || v === undefined || v === '' ? notReported() : String(v));
  const kv = (rows) => h('dl', { class: 'net-kv' }, rows.map(([k, v, note]) => [h('dt', {}, k), h('dd', {}, val(v), note ? h('span', { class: 'net-note' }, ' ' + note) : null)]));
  const note = (t, cls) => (window.MatchiTip && String(t).length >= window.MatchiTip.LONG ? window.MatchiTip.make(t) : h('p', { class: 'net-p' + (cls ? ' ' + cls : '') }, t));   // a long explanation becomes an icon button; a click shows the text
  const allEmpty = (o, keys) => !o || keys.every((k) => o[k] === null || o[k] === undefined || (Array.isArray(o[k]) && !o[k].length));

  // ---- tab renderers: parsed router answer -> a node ------------------------------------------------------------------------
  function viewData(d) {
    const p = N.parseData(d);
    if (allEmpty(p, ['ppp', 'mode', 'roaming'])) return note(NOT + ' (mobile data status).');
    const word = p.state === 'connected' ? 'Connected' : p.state === 'disconnected' ? 'Disconnected' : p.state === 'changing' ? 'Changing' : null;
    const next = N.dataNext(p.state);
    const btn = h('button', { type: 'button', id: 'matchi_net_data_btn' }, st.act ? (st.act === 'off' ? 'Turning off…' : 'Turning on…') : next === 'off' ? 'Turn mobile data off' : next === 'on' ? 'Turn mobile data on' : 'Wait…');
    if (st.act || st.devAct || !next) btn.disabled = true;
    btn.onclick = () => dataSwitch(next);
    return h('div', {},
      kv([['Mobile data', word, p.ppp ? '(' + p.ppp + ')' : ''], ['Connection mode', p.modeLabel], ['Data roaming', p.roaming]]),
      h('div', { class: 'net-actions' }, btn),
      st.actMsg ? note(st.actMsg.text, st.actMsg.bad ? 'net-warn' : '') : null,
      note('Wi-Fi, cable and this console stay reachable while mobile data is off. Needs a fresh sign-in.', 'net-mut'));
  }
  // Phase 3: a band choice (2.4 GHz only / 5 GHz only / Off, its own Apply, like the stock page), then ONE form for the band that is on. The password is
  // never read into the page: the field starts empty and "empty" means "keep the current one" (net-core.js reads it from the router at apply time).
  function viewWifi(d) {
    const w = N.parseWifi(d);
    if (!w || (w.moduleOn === null && !w.entries.length)) return note(NOT + ' (Wi-Fi settings).');
    const mode = N.wifiMode(w), busy = anyAct();
    const top = kv([['Wi-Fi', w.moduleOn === null ? null : w.moduleOn ? 'On' : 'Off'], ['Band in use', N.wifiSummary(w)], ['Devices on Wi-Fi', w.clients === null ? null : String(w.clients)]]);
    const msg = st.wifiMsg ? h('div', {}, st.wifiMsg.lines.map((t) => note(t, st.wifiMsg.bad ? 'net-warn' : ''))) : null;
    const mk = (label, id, fn, danger) => { const x = h('button', { type: 'button', id, class: danger ? 'net-danger' : '' }, label); if (busy) x.disabled = true; x.onclick = fn; return x; };
    // band choice
    if (!st.wifiBandSel || st.wifiBandSel.base !== String(mode)) st.wifiBandSel = { base: String(mode), value: mode === '2g' || mode === '5g' || mode === 'off' ? mode : '' };
    const sel = h('select', { id: 'matchi_wifi_band' }, (st.wifiBandSel.value ? [] : [h('option', { value: '' }, '(choose)')]).concat(N.WIFI_BANDS.map(([k, t]) => h('option', { value: k }, t))));
    sel.value = st.wifiBandSel.value; if (busy) sel.disabled = true; sel.onchange = () => { st.wifiBandSel.value = sel.value; };
    const bandSec = h('section', { class: 'net-sec net-form' }, h('h4', {}, 'Wi-Fi switch'),
      h('div', { class: 'net-frow' }, h('label', { for: 'matchi_wifi_band' }, 'Band'), sel),
      h('div', { class: 'net-actions' }, mk('Apply band (Wi-Fi restarts)', 'matchi_wifi_band_apply', () => wifiBandSubmit(sel.value), true)),
      note('Only one band is on at a time. Switching band, or turning Wi-Fi Off, disconnects every Wi-Fi device, including the one you are using if it is on Wi-Fi. If Wi-Fi is Off, this console is reachable only from a cable (USB / Ethernet) connection: choose a band here to turn it on again.', 'net-mut'));
    const act = N.wifiActive(w), snap = N.wifiSnapOf(act);
    const blocks = w.entries.map((e) => h('section', { class: 'net-sec' },
      h('h4', {}, e.band + (e.on === null ? '' : e.on ? ' · on' : ' · off')),
      kv([['Network name (SSID)', e.ssid], ['Security', e.auth], ['SSID broadcast', e.broadcast === null ? null : e.broadcast ? 'Visible' : 'Hidden'],
        ['Max devices', e.maxStations === null ? null : String(e.maxStations)], ['Country code', e.country]])));
    let form;
    if (mode === 'off') form = note('Wi-Fi is Off. Choose a band above to turn it on; the settings form appears for the band that is on.', 'net-mut');
    else if (!act || !snap) form = note('The settings are not changed here: the router must report one band on, with its name, security mode (one this tool offers), SSID broadcast and max devices.', 'net-mut');
    else form = wifiForm(snap, act, busy);
    return h('div', {}, st.wifiAct ? progNote() : null, top, msg, bandSec, form, blocks,
      note('A band change or a save restarts Wi-Fi.', 'net-mut'));
  }
  function wifiForm(snap, act, busy) {
    const curPw = st.cache.wifi && st.cache.wifi.d ? N.wifiPlainPw(st.cache.wifi.d) : null;   // shown like the stock page (dots + Display password); kept in memory only
    const base = [snap.ssid, snap.auth, snap.hidden, snap.max, curPw || ''].join('|');
    if (!st.wifiForm || st.wifiForm.base !== base) st.wifiForm = { base, ssid: snap.ssid, auth: snap.auth, visible: !snap.hidden, max: String(snap.max), pw: snap.auth === 'OPEN' ? '' : (curPw || '') };
    const f = st.wifiForm;
    const row = (label, el) => h('div', { class: 'net-frow' }, h('label', { for: el.id }, label), el);
    const ssid = h('input', { type: 'text', id: 'matchi_wifi_ssid', maxlength: '32', autocomplete: 'off', spellcheck: 'false' }); ssid.value = f.ssid; ssid.oninput = () => { f.ssid = ssid.value; };
    const auth = h('select', { id: 'matchi_wifi_auth' }, N.WIFI_AUTH.map(([k, t]) => h('option', { value: k }, t))); auth.value = f.auth;
    const pass = h('input', { type: 'password', id: 'matchi_wifi_pass', maxlength: '63', autocomplete: 'new-password', spellcheck: 'false' }); pass.value = f.pw || ''; pass.oninput = () => { f.pw = pass.value; };
    const show = h('input', { type: 'checkbox', id: 'matchi_wifi_show' }); show.onchange = () => { pass.type = show.checked ? 'text' : 'password'; };
    const vis = h('input', { type: 'checkbox', id: 'matchi_wifi_visible' }); vis.checked = f.visible; vis.onchange = () => { f.visible = vis.checked; };
    const max = h('select', { id: 'matchi_wifi_max' }, Array.from({ length: N.WIFI_MAX_STATIONS }, (_, i) => h('option', { value: String(i + 1) }, String(i + 1)))); max.value = f.max; max.onchange = () => { f.max = max.value; };
    const syncPass = () => { pass.disabled = busy || auth.value === 'OPEN'; };
    auth.onchange = () => { f.auth = auth.value; syncPass(); };
    for (const e of [ssid, auth, pass, show, vis, max]) if (busy) e.disabled = true;
    syncPass();
    const err = h('p', { class: 'net-p net-warn', id: 'matchi_wifi_err' }, '');
    const mk = (label, id, fn, danger) => { const x = h('button', { type: 'button', id, class: danger ? 'net-danger' : '' }, label); if (busy) x.disabled = true; x.onclick = fn; return x; };
    return h('section', { class: 'net-sec net-form' }, h('h4', {}, 'Change Wi-Fi settings (' + act.band + ')'),
      row('Network name (SSID)', ssid), row('Broadcast SSID (visible)', vis), row('Security mode', auth),
      row('Wi-Fi password', pass), row('Display password', show), row('Max devices', max), err,
      h('div', { class: 'net-actions' }, mk('Apply settings (Wi-Fi restarts)', 'matchi_wifi_apply', () => wifiSubmit(ssid.value, auth.value, vis.checked, max.value, pass, err), true)),
      note('The password box shows the current password as dots (tick Display password to read it). Edit it to change it, or empty it to keep the current one (8 to 63 characters). Open means no password. The old values are saved first, so "Restore saved values" can put them back. If you are on Wi-Fi you are disconnected: reconnect to the new name and password, then press Refresh.', 'net-mut'),
      h('div', { class: 'net-actions' }, mk('Restore saved values (root)', 'matchi_wifi_restore', wifiRestore, false), mk('Forget backup (root)', 'matchi_wifi_forget', wifiForget, false)));
  }
  function viewDevices(d) {
    const p = N.parseDevices(d);
    if (!p) return note(NOT + ' (device lists).');
    const acl = N.parseAcl(d);
    const head = note(p.rows.length + (p.rows.length === 1 ? ' device' : ' devices') + ': ' + p.wifi + ' on Wi-Fi, ' + p.cable + ' on cable.');
    const extra = [];
    if (!p.cableReported) extra.push(note('The cable list is ' + NOT.toLowerCase() + '.', 'net-mut'));
    if (!p.wifiReported) extra.push(note('The Wi-Fi list is ' + NOT.toLowerCase() + '.', 'net-mut'));
    if (p.routerCount !== null && p.wifiReported && p.routerCount !== p.wifi) extra.push(note('The router counts ' + p.routerCount + ' on Wi-Fi; the list shows ' + p.wifi + '.', 'net-mut'));
    const msg = st.devMsg ? note(st.devMsg.text, st.devMsg.bad ? 'net-warn' : '') : null;
    const refusal = N.aclRefusal(acl);
    const blockedMacs = new Set(acl ? acl.black.map((b) => b.mac) : []);
    const act = (label, fn, danger) => { const b = h('button', { type: 'button', class: 'net-act' + (danger ? ' net-danger' : '') }, label); if (st.devAct) b.disabled = true; b.onclick = fn; return b; };
    let table = null;
    if (p.rows.length) {
      table = h('div', { class: 'net-scroll' }, h('table', { class: 'net-tbl' },
        h('thead', {}, h('tr', {}, ['Name', 'IP address', 'MAC address', 'Type', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, p.rows.map((r) => {
          const self = N.isSelf(r.ip, st.me), canAct = N.isMac(r.mac);
          const cell = h('td', { class: 'net-rowact' });
          if (canAct) cell.append(act('Rename', () => devRename(r)));
          if (self) cell.append(h('span', { class: 'net-mut' }, ' this device'));
          else if (canAct && !refusal && !blockedMacs.has(r.mac)) cell.append(act('Block', () => devBlock(r, acl), true));
          return h('tr', {}, h('td', {}, r.name || '(no name)'), h('td', {}, r.ip || '-'), h('td', {}, r.mac || '-'), h('td', {}, r.type), cell);
        }))));
    }
    const blocked = [];
    if (acl && acl.black.length) {
      blocked.push(h('h4', {}, 'Blocked devices'));
      blocked.push(h('ul', { class: 'net-ul' }, acl.black.map((b) => h('li', {}, (b.name || '(no name)') + ' · ' + b.mac + ' ',
        refusal ? null : act('Unblock', () => devUnblock(b, acl))))));
    }
    if (refusal) extra.push(note(refusal, 'net-mut'));
    if (!st.me) extra.push(note('The address of the device you are using was not found, so Block does not know which row is yours. Do not block your own device.', 'net-mut'));
    return h('div', {}, head, msg, table, blocked, extra);
  }
  function viewApn(d) {
    const a = N.parseApn(d);
    if (!a || (!a.mode && !a.hasSlots && !a.inUse && !a.auto)) return note(NOT + ' (APN).');
    const refusal = N.apnRefusal(a), busy = st.apnAct || st.act || st.devAct || st.wifiAct;
    const act = (label, fn, danger, id) => { const b = h('button', { type: 'button', class: 'net-act' + (danger ? ' net-danger' : '') }, label); if (id) b.id = id; if (busy) b.disabled = true; b.onclick = fn; return b; };
    const line = (p) => (p ? (p.name || '(no name)') + (p.apn ? ' · ' + p.apn : '') : null);
    const modeWord = a.mode === 'auto' ? 'Auto' : a.mode === 'manual' ? 'Manual' : a.mode;
    const top = kv([['APN mode', modeWord], ['In use', line(a.inUse)], ['Automatic profile', a.auto ? line(a.auto) : null]]);
    const autoBtn = act('Switch to Auto', apnToAuto, false, 'matchi_net_apn_auto');
    if (a.mode !== 'manual') autoBtn.disabled = true;
    const bar = h('div', { class: 'net-actions' }, autoBtn);
    if (N.apnCanAdd(a)) bar.append(act('Add profile', () => apnOpenForm({ mode: 'add', slot: a.freeSlots[0], init: { name: '', apn: '', pdp: 'IPv4v6', auth: 'none', user: '', pass: '' } }), false, 'matchi_net_apn_add'));
    if (!refusal && a.mode === 'auto' && a.auto && a.auto.apn && a.freeSlots.length) bar.append(act('Copy the automatic profile', () => apnOpenForm({ mode: 'copy', slot: a.freeSlots[0], init: N.autoAsForm(a) }), false, 'matchi_net_apn_copy'));
    let table = null;
    if (a.profiles.length) {
      table = h('div', { class: 'net-scroll' }, h('table', { class: 'net-tbl' },
        h('thead', {}, h('tr', {}, ['Name', 'APN', 'Type', 'Login', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, a.profiles.map((p) => {
          const cell = h('td', { class: 'net-rowact' });
          if (N.apnCanUse(a, p)) cell.append(act('Use', () => apnUse(a, p), false));
          if (N.isInUse(a, p)) cell.append(h('span', { class: 'net-mut' }, ' in use '));
          if (N.apnCanEdit(a, p)) cell.append(act('Edit', () => apnOpenForm({ mode: 'edit', slot: p.slot, init: { name: p.name, apn: p.apn, pdp: N.PDP_TYPES.includes(p.pdp) ? p.pdp : 'IPv4v6', auth: N.APN_AUTH.includes(p.auth) ? p.auth : 'none', user: '', pass: '' } }), false));
          if (a.mode === 'manual' && !N.apnDeleteRefusal(a, p)) cell.append(act('Delete', () => apnDelete(a, p), true));
          return h('tr', {}, h('td', {}, p.name || '(no name)'), h('td', {}, p.apn || '-'), h('td', {}, N.pdpLabel(p.pdp)), h('td', {}, N.authLabelApn(p.auth)), cell);
        }))));
    }
    const msg = st.apnMsg ? note(st.apnMsg.text, st.apnMsg.bad ? 'net-warn' : '') : null;
    const notes = [];
    if (refusal) notes.push(note(refusal, 'net-mut'));
    else if (a.mode === 'auto') notes.push(note('Add, Edit and Delete work only in Manual mode. "Use" switches the router to Manual mode with that profile; "Switch to Auto" brings the automatic profile back.', 'net-mut'));
    notes.push(note('User names and passwords are not read from the router and never shown. When you edit a profile that has a login, type both again. A wrong APN means no mobile data: press "Switch to Auto" to get it back.', 'net-mut'));
    return h('div', {}, st.apnAct ? progNote() : null, top, bar, msg, st.apnForm ? apnFormView(a) : null, table || (a.hasSlots ? note('No manual profiles are stored.', 'net-mut') : note('Profile list: ' + NOT.toLowerCase() + '.', 'net-mut')), notes);
  }
  // The add / edit / copy form. Values are read from the inputs when Save is pressed; the password input is emptied as soon as it has been used.
  function apnFormView(a) {
    const f = st.apnForm, i = f.init;
    const inp = (id, v, type) => { const e = h('input', { type: type || 'text', id, maxlength: '63', autocomplete: 'off', spellcheck: 'false' }); e.value = v || ''; return e; };
    const sel = (id, opts, v) => { const e = h('select', { id }, opts.map(([k, t]) => h('option', { value: k }, t))); e.value = v; return e; };
    const row = (label, el) => h('div', { class: 'net-frow' }, h('label', { for: el.id }, label), el);
    const err = h('p', { class: 'net-p net-warn', id: 'matchi_apn_err' }, '');
    const save = h('button', { type: 'button', id: 'matchi_apn_save' }, f.mode === 'edit' ? 'Save changes' : f.mode === 'copy' ? 'Save and use' : 'Save profile');
    const cancel = h('button', { type: 'button', id: 'matchi_apn_cancel' }, 'Cancel');
    if (st.apnAct) { save.disabled = true; }
    save.onclick = () => apnSubmit(a, err);
    cancel.onclick = () => apnCloseForm();
    return h('section', { class: 'net-sec net-form' },
      h('h4', {}, f.mode === 'edit' ? 'Edit profile (slot ' + f.slot + ')' : f.mode === 'copy' ? 'Copy the automatic profile (slot ' + f.slot + ')' : 'New profile (slot ' + f.slot + ')'),
      row('Profile name', inp('matchi_apn_name', i.name)), row('APN', inp('matchi_apn_apn', i.apn)),
      row('Type', sel('matchi_apn_pdp', [['IPv4v6', 'IPv4 + IPv6'], ['IP', 'IPv4 only'], ['IPv6', 'IPv6 only']], i.pdp)),
      row('Authentication', sel('matchi_apn_auth', [['none', 'None'], ['pap', 'PAP'], ['chap', 'CHAP']], i.auth)),
      row('User name', inp('matchi_apn_user', '', 'text')), row('Login password', inp('matchi_apn_pass', '', 'password')),
      note('User name and password are used only with PAP or CHAP.', 'net-mut'), err, h('div', { class: 'net-actions' }, save, cancel));
  }
  function viewLan(d) {
    const p = N.parseLan(d);
    if (allEmpty(p, ['ip', 'mask', 'dhcp', 'start', 'end', 'leaseRaw', 'mac'])) return note(NOT + ' (LAN / DHCP).');
    const pool = p.start && p.end ? p.start + ' - ' + p.end : null;
    const info = kv([['Router IP address', p.ip], ['Subnet mask', p.mask], ['DHCP server', p.dhcp], ['DHCP pool', pool],
      ['Lease time', p.leaseHours !== null ? N.leaseText(p.leaseHours) : p.leaseRaw], ['Router MAC address', p.mac]]);
    const msg = st.lanMsg ? h('div', {}, st.lanMsg.lines.map((t) => note(t, st.lanMsg.bad ? 'net-warn' : ''))) : null;
    const known = p.ip && p.mask && p.dhcp === 'On' && p.start && p.end && p.leaseHours !== null;
    const off = !known && p.ip && p.mask && p.dhcp === 'Off';
    return h('div', {}, st.lanAct ? progNote() : null, info, msg,
      known ? lanForm(p) : off ? lanDhcpOff(p) : note('The pool and the lease are not changed here: the router must report its IP, mask, pool and lease, with the DHCP server On.', 'net-mut'),
      known ? lanIpForm(p) : null,
      note('The subnet mask is not changed in this window, and DHCP is not switched Off here (only back On, when it was switched Off elsewhere).', 'net-mut'));
  }
  const lanBusy = () => st.lanAct || st.act || st.devAct || st.apnAct || st.mtuAct || st.wifiAct;
  // Phase 6b: change the router IP (the pool moves into the new subnet in the same call). Checks are in net-core.js (lanIpCheck).
  function lanIpForm(p) {
    const busy = lanBusy();
    const e = h('input', { type: 'text', id: 'matchi_lan_ip', maxlength: '15', autocomplete: 'off', placeholder: 'for example 192.168.1.1' }); e.value = st.lanIp || ''; e.oninput = () => { st.lanIp = e.value; }; if (busy) e.disabled = true;
    const err = h('p', { class: 'net-p net-warn', id: 'matchi_lan_ip_err' }, '');
    const x = h('button', { type: 'button', id: 'matchi_lan_ip_apply', class: 'net-danger' }, 'Change router IP (router restarts)'); if (busy) x.disabled = true; x.onclick = () => lanIpSubmit(e.value, err);
    return h('section', { class: 'net-sec net-form' }, h('h4', {}, 'Change router IP address'),
      h('div', { class: 'net-frow' }, h('label', { for: 'matchi_lan_ip' }, 'New router IP'), e), err, h('div', { class: 'net-actions' }, x),
      note('Highest risk in this window. The pool moves into the new subnet in the same step (same host numbers), the mask stays ' + p.mask + '. The router restarts, then the OLD address ' + p.ip + ' answers nothing and this console is at the new address: your PC or phone must get an address in the new subnet (reconnect; a fixed address must be changed). The old values are saved first, and after the restart MatchiTOOL checks the router and puts them back if it came up with something else. Do this from a cable device you can reach again. \"Restore saved values\" also works from the new address.', 'net-mut'));
  }
  // DHCP is Off (switched off on the stock page): the one change offered is putting it back On with the pool the router still reports (or the stock pool for a /24).
  function lanDhcpOff(p) {
    const busy = lanBusy();
    const x = h('button', { type: 'button', id: 'matchi_lan_dhcpon', class: 'net-danger' }, 'Restore DHCP (router restarts)'); if (busy) x.disabled = true; x.onclick = lanDhcpOn;
    return h('section', { class: 'net-sec net-form' }, h('h4', {}, 'DHCP server is Off'),
      note('Devices get no address while the DHCP server is Off. Restore DHCP sends the stock call with the pool the router reports (or .2 - .253 on a /24) and the lease; the router IP and the mask stay the same. The router restarts.', 'net-warn'),
      h('div', { class: 'net-actions' }, x));
  }
  // The pool / lease form: three fields, checked by net-core.js; Apply restarts the router. The old values are saved by root before anything is sent.
  function lanForm(p) {
    const base = [p.start, p.end, p.leaseHours].join('/');
    if (!st.lanForm || st.lanForm.base !== base) st.lanForm = { base, start: p.start, end: p.end, lease: String(p.leaseHours) };
    const busy = st.lanAct || st.act || st.devAct || st.apnAct || st.mtuAct || st.wifiAct;
    const inp = (id, v, key, max) => { const e = h('input', { type: 'text', id, maxlength: String(max), autocomplete: 'off' }); e.value = v; e.oninput = () => { st.lanForm[key] = e.value; }; if (busy) e.disabled = true; return e; };
    const row = (label, el) => h('div', { class: 'net-frow' }, h('label', { for: el.id }, label), el);
    const err = h('p', { class: 'net-p net-warn', id: 'matchi_lan_err' }, '');
    const a = inp('matchi_lan_start', st.lanForm.start, 'start', 15), b = inp('matchi_lan_end', st.lanForm.end, 'end', 15), c = inp('matchi_lan_lease', st.lanForm.lease, 'lease', 3);
    const mk = (label, id, fn, danger) => { const x = h('button', { type: 'button', id, class: danger ? 'net-danger' : '' }, label); if (busy) x.disabled = true; x.onclick = fn; return x; };
    return h('section', { class: 'net-sec net-form' }, h('h4', {}, 'Change DHCP pool / lease'),
      row('Pool start', a), row('Pool end', b), row('Lease (hours)', c), err,
      h('div', { class: 'net-actions' }, mk('Apply (router restarts)', 'matchi_lan_apply', () => lanSubmit(a.value, b.value, c.value, err), true)),
      note('Every apply restarts the router: internet, Wi-Fi and this console are away for about 1 to 2 minutes. Devices keep their address until they renew it; one that holds an address outside the new pool gets a new one. The old values are saved first, so \"Restore saved values\" can put them back. Lease: ' + N.LEASE_MIN + ' to ' + N.LEASE_MAX + ' hours (this tool\'s own limit).', 'net-mut'),
      h('div', { class: 'net-actions' }, mk('Restore saved values (root)', 'matchi_lan_restore', lanRestore, false), mk('Forget backup (root)', 'matchi_lan_forget', lanForget, false)));
  }
  function viewMtu(d) {
    const p = N.parseMtu(d);
    const known = !!p && p.mtu !== null && p.mss !== null;
    const router = !p || (p.mtu === null && p.mss === null) ? note(NOT + ' (MTU / MSS).')
      : h('div', {}, kv([['MTU (router setting)', p.mtu === null ? null : String(p.mtu)], ['MSS (router setting)', p.mss === null ? null : String(p.mss)]]), p.warn ? note(p.warn, 'net-warn') : null);
    const msg = st.mtuMsg ? h('div', {}, st.mtuMsg.lines.map((t) => note(t, st.mtuMsg.bad ? 'net-warn' : ''))) : null;
    return h('div', {}, st.mtuAct ? progNote() : null, router, msg, known ? mtuForm(p) : note('MTU and MSS are not changed here: the router did not report both values.', 'net-mut'),
      note('On the F50 test the stock MSS rule applied to the router itself, not to devices connected to it. The real values below come from a read-only root check.', 'net-mut'),
      rootBlock());
  }
  // The change form: two numbers, checked by net-core.js; Apply restarts the router. The old values are saved by root before anything is sent.
  function mtuForm(p) {
    const base = p.mtu + '/' + p.mss;
    if (!st.mtuForm || st.mtuForm.base !== base) st.mtuForm = { base, mtu: String(p.mtu), mss: String(p.mss) };
    const busy = st.mtuAct || st.act || st.devAct || st.apnAct || st.lanAct || st.wifiAct;
    const inp = (id, v, key) => { const e = h('input', { type: 'text', id, maxlength: '4', inputmode: 'numeric', autocomplete: 'off' }); e.value = v; e.oninput = () => { st.mtuForm[key] = e.value; }; if (busy) e.disabled = true; return e; };
    const row = (label, el) => h('div', { class: 'net-frow' }, h('label', { for: el.id }, label), el);
    const err = h('p', { class: 'net-p net-warn', id: 'matchi_mtu_err' }, '');
    const mtuIn = inp('matchi_mtu_mtu', st.mtuForm.mtu, 'mtu'), mssIn = inp('matchi_mtu_mss', st.mtuForm.mss, 'mss');
    const mk = (label, id, fn, danger) => { const b = h('button', { type: 'button', id, class: danger ? 'net-danger' : '' }, label); if (busy) b.disabled = true; b.onclick = fn; return b; };
    const useDefault = mk('MSS = MTU − 40', 'matchi_mtu_default', () => {
      const m = String(mtuIn.value).trim();
      if (!/^\d{1,4}$/.test(m)) { err.textContent = 'Type a whole-number MTU first, then press this button.'; return; }
      const mtu = parseInt(m, 10);
      if (mtu < N.MTU_MIN || mtu > N.MTU_MAX) { err.textContent = 'Fix the MTU first: it must be between ' + N.MTU_MIN + ' and ' + N.MTU_MAX + '. Then press this button.'; return; }
      mssIn.value = String(N.mtuDefaultMss(mtu)); st.mtuForm.mss = mssIn.value; err.textContent = '';
    });
    const apply = mk('Apply (router restarts)', 'matchi_mtu_apply', () => mtuSubmit(mtuIn.value, mssIn.value, err), true);
    return h('section', { class: 'net-sec net-form' }, h('h4', {}, 'Change MTU / MSS'),
      row('MTU', mtuIn), row('MSS', mssIn), err, h('div', { class: 'net-actions' }, apply, useDefault),
      note('Every apply restarts the router: internet, Wi-Fi and this console are away for about 1 to 2 minutes. A bad value can break some sites. The old values are saved first, so "Restore saved values" can put them back.', 'net-mut'),
      h('div', { class: 'net-actions' }, mk('Restore saved values (root)', 'matchi_mtu_restore', mtuRestore, false), mk('Forget backup (root)', 'matchi_mtu_forget', mtuForget, false)));
  }
  function rootBlock() {
    const btn = h('button', { type: 'button', id: 'matchi_net_root' }, st.rootBusy ? 'Reading…' : st.root || st.rootErr ? 'Read again (root)' : 'Read real values (root)');
    if (st.rootBusy) btn.disabled = true;
    btn.onclick = rootRead;
    const out = [h('h4', {}, 'Real values on the phone'), h('div', { class: 'net-actions' }, btn)];
    if (st.rootErr) out.push(note('Not available: ' + N.maskSecrets(st.rootErr), 'net-warn'));
    const r = st.root;
    if (r) {
      out.push(kv([
        ['Internet interface', r.noRoute ? null : r.wanDev, r.noRoute ? '(no route to the internet found: is mobile data on?)' : ''],
        ['Interface MTU', r.wanMtu === null ? null : String(r.wanMtu), r.wanState ? '(' + r.wanState + ')' : ''],
      ]));
      if (r.rules.length) {
        out.push(h('h4', {}, 'TCPMSS rules found'));
        out.push(h('pre', { class: 'net-pre' }, r.rules.map((x) => x.family + ' ' + x.table + ': ' + x.text).join('\n')));
        const texts = r.rules.map((x) => x.family + x.table + x.text);
        if (new Set(texts).size < texts.length) out.push(note('Some rules appear twice. The stock firmware builds them that way; it is not an error.', 'net-mut'));
      } else out.push(note('No TCPMSS rule found.', 'net-mut'));
    }
    return h('section', { class: 'net-sec' }, out);
  }
  const VIEWS = { data: viewData, wifi: viewWifi, devices: viewDevices, apn: viewApn, lan: viewLan, mtu: viewMtu };

  // ---- window state ---------------------------------------------------------------------------------------------------------
  const setStatus = (t) => { const s = $('matchi_net_status'); if (s) s.textContent = st.only ? '' : (t || ''); };   // the Devices-only window shows no status / updated line
  // The progress banner at the top of the APN and MTU / MSS tabs while a change is running: what is happening now, in words (the small status line is easy to miss).
  const progress = (t) => { st.prog = t || ''; const e = $('matchi_net_prog'); if (e) e.textContent = st.prog; setStatus(st.prog); };
  const progNote = () => (st.prog ? h('p', { class: 'net-p net-prog', id: 'matchi_net_prog', role: 'status', 'aria-live': 'polite' }, st.prog) : null);
  const syncButtons = () => {
    const r = $('matchi_net_refresh'); if (r) r.disabled = st.loading || anyAct();
    document.querySelectorAll('#matchi_net_tabs [role=tab]').forEach((b) => { const on = b.dataset.tab === st.tab; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; b.classList.toggle('on', on); });
  };
  function paint(tab) {
    const body = $('matchi_net_body'); if (!body || tab !== st.tab) return;
    const c = st.cache[tab];
    body.replaceChildren(c ? VIEWS[tab](c.d) : h('p', { class: 'net-p net-mut' }, 'Reading…'));
    syncButtons();
  }
  async function load(tab) {
    const my = ++epoch;
    st.loading = true; syncButtons(); setStatus('Reading…');
    if (!st.cache[tab]) paint(tab);
    try {
      const d = tab === 'devices' ? await readDevicesRaw() : await R.zte('get', { multi_data: '1', cmd: N.READ[tab] });
      if (my !== epoch) return;
      st.cache[tab] = { d, at: Date.now() };
      paint(tab); setStatus('Updated ' + new Date().toLocaleTimeString());
    } catch (e) {
      if (my !== epoch) return;
      delete st.cache[tab];
      const body = $('matchi_net_body');
      if (body && tab === st.tab) body.replaceChildren(note('Could not read the router: ' + N.maskSecrets(e.message), 'net-warn'));
      setStatus('Read failed');
    } finally { if (my === epoch) { st.loading = false; syncButtons(); } }
  }
  function select(tab) {
    if (!VIEWS[tab]) return;
    st.tab = tab; syncButtons();
    if (st.cache[tab]) { epoch++; st.loading = false; paint(tab); syncButtons(); setStatus('Updated ' + new Date(st.cache[tab].at).toLocaleTimeString()); } else load(tab);
  }
  // ---- mobile data off / on -------------------------------------------------------------------------------------------------
  const readPpp = async () => N.parseData(await R.zte('get', { multi_data: '1', cmd: N.READ.data }));
  async function dataSwitch(action) {
    if (!action || st.act) return;
    const ok = await askConfirm(action === 'off'
      ? 'Turn mobile data off?\n\nInternet through the SIM stops for every device. The router stays reachable on Wi-Fi and cable. To go back, press "Turn mobile data on".'
      : 'Turn mobile data on?\n\nThe router connects to the mobile network again. This can take up to 30 seconds.', action === 'off' ? 'Turn off' : 'Turn on', action === 'off');
    if (!ok) return;
    const my = ++actId;
    st.act = action; st.actMsg = null; syncButtons(); paint('data'); setStatus('Sending…');
    const live = () => my === actId;
    try {
      try { await R.setRouter(N.dataCall(action), true); }
      catch (e) { if (live()) st.actMsg = { bad: true, text: 'Not sent: ' + N.maskSecrets(e.message) }; return; }
      const t0 = Date.now(); let p = null, reached = false;
      for (;;) {
        await R.sleep(2000);
        if (!live()) return;
        try { p = await readPpp(); } catch (_) { /* keep waiting; the last real value is shown below */ }
        if (!live()) return;
        if (p) { st.cache.data = { d: { ppp_status: p.ppp, dial_mode: p.mode, roam_setting_option: p.roaming === 'On' ? '1' : p.roaming === 'Off' ? '0' : '' }, at: Date.now() }; }
        if (p && N.dataReached(action, p.state)) { reached = true; break; }
        if (Date.now() - t0 >= 30000) break;
        setStatus('Waiting for the router… ' + Math.round((Date.now() - t0) / 1000) + ' s');
      }
      const now = p && p.ppp ? p.ppp : 'no answer';
      st.actMsg = reached
        ? { bad: false, text: action === 'off' ? 'Mobile data is off (' + now + ').' : 'Mobile data is on (' + now + ').' }
        : { bad: true, text: 'The router did not reach the wanted state within 30 seconds. It reports: ' + now + '. Press Refresh to read it again.' };
    } finally {
      if (live()) { st.act = null; if (st.tab === 'data') { paint('data'); setStatus(st.actMsg && st.actMsg.bad ? 'Check the result above' : 'Updated ' + new Date().toLocaleTimeString()); } syncButtons(); }
    }
  }
  // ---- devices: rename, block, unblock (Phase 4) ----------------------------------------------------------------------------
  // The Devices tab = the station lists (multi_data) + the block list + the names (two single commands). The block list is never guessed: when
  // its read fails the keys stay absent and parseAcl gives null, so Block / Unblock are hidden. Names that fail to read leave the station names.
  async function readDevicesRaw() {
    const d = await R.zte('get', { multi_data: '1', cmd: N.READ.devices });
    const out = Object.assign({}, d && typeof d === 'object' ? d : {});
    try {
      const a = await R.zte('get', { cmd: N.READ_ACL });
      if (a && typeof a === 'object') for (const k of ['AclMode', 'WhiteMacList', 'BlackMacList', 'WhiteNameList', 'BlackNameList']) if (a[k] !== undefined) out[k] = a[k];
    } catch (_) { /* block list not read */ }
    try {
      const n = await R.zte('get', { cmd: N.READ_NAMES });
      if (n && Array.isArray(n.devices)) out.hostNameList = n.devices;
    } catch (_) { /* station names stay */ }
    return out;
  }
  // Send one device change, then read the lists again until `check(parsed)` is true (up to 3 reads, 1 s apart). Nothing is claimed without it.
  async function devApply(call, check, okText, badText) {
    st.devAct = true; st.devMsg = null; syncButtons(); paint('devices'); setStatus('Sending…');
    const my = ++actId;
    try {
      try { await R.setRouter(call, true); }
      catch (e) { st.devMsg = { bad: true, text: 'Not sent: ' + N.maskSecrets(e.message) }; return; }
      let d = null, good = false;
      for (let i = 0; i < 3 && !good; i++) {
        await R.sleep(1000);
        if (my !== actId) return;
        try { d = await readDevicesRaw(); } catch (_) { continue; }
        if (my !== actId) return;
        good = !!check(d);
      }
      if (d) st.cache.devices = { d, at: Date.now() };
      st.devMsg = good ? { bad: false, text: okText } : { bad: true, text: badText + ' Press Refresh to read the lists again.' };
    } finally {
      if (my === actId) { st.devAct = false; if (st.tab === 'devices') { paint('devices'); setStatus(st.devMsg && st.devMsg.bad ? 'Check the result above' : 'Updated ' + new Date().toLocaleTimeString()); } syncButtons(); }
    }
  }
  async function devRename(r) {
    if (st.devAct) return;
    const v = await askText({ title: 'Rename device', message: 'New name for ' + r.mac + (r.ip ? ' (' + r.ip + ')' : '') + '. Letters, digits, space, dot, dash, underscore; up to 31 characters.', value: r.name || '', okText: 'Rename' });
    if (v === null || v === undefined) return;
    const name = String(v).trim(), err = N.hostnameError(name);
    if (err) { st.devMsg = { bad: true, text: err }; paint('devices'); return; }
    if (name === r.name) return;
    if (!(await askConfirm('Rename this device?\n\n' + r.mac + '\nfrom "' + (r.name || '(no name)') + '"\nto "' + name + '"', 'Rename'))) return;
    const call = N.renameCall(r.mac, name);
    await devApply(call, (d) => { const x = N.parseDevices(d); return !!x && x.rows.some((q) => q.mac === r.mac && q.name === name); },
      'Renamed to "' + name + '".', 'The router does not report the new name yet.');
  }
  async function devBlock(r, acl) {
    if (st.devAct) return;
    const unsure = !st.me ? '\n\nThis page could not tell which device you are using. If this is it, you lose this console.' : '';
    if (!(await askConfirm('Block this device?\n\n' + (r.name || '(no name)') + '\n' + r.mac + (r.ip ? '\n' + r.ip : '') + '\n\nIt is cut off from this router (Wi-Fi and cable). To go back, press Unblock in the "Blocked devices" list.' + unsure, 'Block', true))) return;
    let call; try { call = N.blockCall(acl, r.mac, r.name); } catch (e) { st.devMsg = { bad: true, text: e.message }; paint('devices'); return; }
    await devApply(call, (d) => { const a = N.parseAcl(d); return !!a && a.black.some((b) => b.mac === r.mac); },
      'Blocked ' + r.mac + '.', 'The router does not list this device as blocked.');
  }
  async function devUnblock(b, acl) {
    if (st.devAct) return;
    if (!(await askConfirm('Unblock this device?\n\n' + (b.name || '(no name)') + '\n' + b.mac + '\n\nIt can connect to this router again.', 'Unblock'))) return;
    let call; try { call = N.unblockCall(acl, b.mac); } catch (e) { st.devMsg = { bad: true, text: e.message }; paint('devices'); return; }
    await devApply(call, (d) => { const a = N.parseAcl(d); return !!a && !a.black.some((x) => x.mac === b.mac); },
      'Unblocked ' + b.mac + '.', 'The router still lists this device as blocked.');
  }
  // ---- APN (Phase 5) ---------------------------------------------------------------------------------------------------------
  // Every APN change: send the step(s), re-read the profile list (up to 5 reads, 2 s apart) until `check(parsed)` holds, and for changes that move
  // the data connection ("data" true) read ppp_status for up to 20 s more. Nothing is claimed without the re-read. `rollback`: if a LATER step of a
  // multi-step change is refused, the Auto call is sent so the router is not left in Manual mode on the wrong profile.
  const readApnRaw = () => R.zte('get', { multi_data: '1', cmd: N.READ.apn });
  async function apnApply(steps, check, okText, badText, opts) {
    const o = opts || {};
    st.apnAct = true; st.apnMsg = null; progress('Sending the change to the router…'); syncButtons(); paint('apn');
    const my = ++actId;
    try {
      for (let i = 0; i < steps.length; i++) {
        try { await R.setRouter(steps[i], true); }
        catch (e) {
          let extra = '';
          if (i > 0 && o.rollback) { try { await R.setRouter(N.apnAutoCall(), true); extra = ' The router was switched back to Auto.'; } catch (_) { extra = ' Could not switch back to Auto: press "Switch to Auto".'; } }
          st.apnMsg = { bad: true, text: 'Not sent: ' + N.maskSecrets(e.message) + extra }; return;
        }
        if (i < steps.length - 1) { await R.sleep(1000); if (my !== actId) return; }
      }
      progress('Sent. Reading the profile list back to check it…');
      let d = null, good = false;
      for (let i = 0; i < 5 && !good; i++) {
        await R.sleep(2000);
        if (my !== actId) return;
        try { d = await readApnRaw(); } catch (_) { continue; }
        if (my !== actId) return;
        good = !!check(N.parseApn(d));
      }
      if (d) st.cache.apn = { d, at: Date.now() };
      if (!good) { st.apnMsg = { bad: true, text: badText + ' Press Refresh to read it again.' + (o.data ? ' If mobile data is down, press "Switch to Auto".' : '') }; return; }
      if (!o.data) { st.apnMsg = { bad: false, text: okText }; return; }
      let ppp = null;
      for (let i = 0; i < 10; i++) {
        try { ppp = await readPpp(); } catch (_) { /* keep waiting */ }
        if (my !== actId) return;
        if (ppp && ppp.state === 'connected') break;
        progress('Changed. Waiting for mobile data to reconnect… ' + (i + 1) * 2 + ' s of up to 20 s.');
        await R.sleep(2000);
        if (my !== actId) return;
      }
      st.apnMsg = ppp && ppp.state === 'connected' ? { bad: false, text: okText + ' Mobile data is connected (' + ppp.ppp + ').' }
        : { bad: true, text: okText + ' But mobile data is not connected (' + (ppp && ppp.ppp ? ppp.ppp : 'no answer') + '). If it does not come back, press "Switch to Auto".' };
    } finally {
      if (my === actId) { st.apnAct = false; st.prog = ''; if (st.tab === 'apn') { paint('apn'); setStatus(st.apnMsg && st.apnMsg.bad ? 'Check the result above' : 'Updated ' + new Date().toLocaleTimeString()); } syncButtons(); }
    }
  }
  const profText = (p) => '"' + (p.name || '(no name)') + '"\nAPN ' + (p.apn || '(none)') + '\n' + N.pdpLabel(p.pdp) + ' · login ' + N.authLabelApn(p.auth);
  async function apnToAuto() {
    if (st.apnAct) return;
    if (!(await askConfirm('Switch APN to Auto?\n\nThe router picks the profile for your SIM by itself. Mobile data restarts and can drop for up to 30 seconds. Your manual profiles stay in the list.', 'Switch to Auto'))) return;
    await apnApply([N.apnAutoCall()], (a) => !!a && a.mode === 'auto', 'APN mode is Auto.', 'The router does not report Auto mode.', { data: true });
  }
  async function apnUse(a, p) {
    if (st.apnAct || !N.apnCanUse(a, p)) return;
    if (!(await askConfirm('Use this profile?\n\n' + profText(p) + '\n\n' + (a.mode === 'auto' ? 'This switches the router to Manual APN mode. ' : '') + 'Mobile data restarts and can drop for up to 30 seconds. A wrong APN means no mobile data; to go back press "Switch to Auto".', 'Use profile', true))) return;
    let call; try { call = N.apnDefaultCall(p.slot, p.pdp); } catch (e) { st.apnMsg = { bad: true, text: e.message }; paint('apn'); return; }
    await apnApply([call], (x) => !!x && x.mode === 'manual' && N.sameProfile(x.inUse, p.name, p.apn), 'Now using "' + p.name + '".', 'The router does not report "' + p.name + '" as the profile in use.', { data: true });
  }
  async function apnDelete(a, p) {
    if (st.apnAct) return;
    const r = N.apnDeleteRefusal(a, p); if (r) { st.apnMsg = { bad: true, text: r }; paint('apn'); return; }
    if (!(await askConfirm('Delete this profile?\n\n' + profText(p) + '\nslot ' + p.slot + '\n\nThe profile is removed from the router. The router stays in Manual mode.', 'Delete', true))) return;
    let call; try { call = N.apnDeleteCall(p.slot); } catch (e) { st.apnMsg = { bad: true, text: e.message }; paint('apn'); return; }
    // The router moves the later profiles up one slot after a delete (seen on the F50), so the check is by name and APN, not by slot: fewer copies than before.
    const same = (q) => q.name === p.name && q.apn === p.apn, before = a.profiles.filter(same).length;
    await apnApply([call], (x) => !!x && x.profiles.filter(same).length < before, 'Deleted "' + p.name + '".', 'The router still lists "' + p.name + '".');
  }
  function apnOpenForm(f) { if (st.apnAct) return; st.apnForm = f; st.apnMsg = null; paint('apn'); }
  function apnCloseForm() {
    const pw = $('matchi_apn_pass'); if (pw) pw.value = '';
    st.apnForm = null; paint('apn');
  }
  async function apnSubmit(a, errEl) {
    const f = st.apnForm; if (!f || st.apnAct) return;
    const g = (id) => { const e = $(id); return e ? String(e.value == null ? '' : e.value) : ''; };
    const form = { name: g('matchi_apn_name').trim(), apn: g('matchi_apn_apn').trim(), pdp: g('matchi_apn_pdp'), auth: g('matchi_apn_auth'), user: g('matchi_apn_user'), pass: g('matchi_apn_pass') };
    let call; try { call = N.apnSaveCall(form, f.slot); } catch (e) { if (errEl) errEl.textContent = e.message; return; }
    const prof = { name: form.name, apn: form.apn, pdp: form.pdp, auth: form.auth };
    const inUse = f.mode === 'edit' && a.inUse && a.inUse.name === (f.init.name) && a.inUse.apn === f.init.apn;
    const text = (f.mode === 'edit' ? 'Save changes to slot ' + f.slot + '?' : f.mode === 'copy' ? 'Save this profile in slot ' + f.slot + ' and use it?' : 'Add this profile in slot ' + f.slot + '?') + '\n\n' + profText(prof)
      + (f.mode === 'copy' ? '\n\nThis switches the router to Manual APN mode with this profile. Mobile data restarts and can drop for up to 30 seconds; to go back press "Switch to Auto".'
        : inUse ? '\n\nThis is the profile in use: mobile data restarts and can drop for up to 30 seconds.' : '');
    const ok = await askConfirm(text, f.mode === 'edit' ? 'Save' : f.mode === 'copy' ? 'Save and use' : 'Add', f.mode !== 'add');
    if (!ok) return;
    const steps = [call];
    if (f.mode === 'copy') { try { steps.push(N.apnDefaultCall(f.slot, form.pdp)); } catch (e) { if (errEl) errEl.textContent = e.message; return; } }
    const pw = $('matchi_apn_pass'); if (pw) pw.value = '';   // the password lives only in `call` now
    st.apnForm = null;
    const saved = (x) => !!x && x.profiles.some((q) => q.slot === f.slot && q.name === form.name && q.apn === form.apn);
    if (f.mode === 'copy') await apnApply(steps, (x) => saved(x) && x.mode === 'manual' && N.sameProfile(x.inUse, form.name, form.apn), 'Saved and now using "' + form.name + '".', 'The router does not report "' + form.name + '" as the profile in use.', { data: true, rollback: true });
    else await apnApply(steps, saved, (f.mode === 'edit' ? 'Saved "' : 'Added "') + form.name + '".', 'The router does not list "' + form.name + '" in slot ' + f.slot + ' yet.', { data: inUse });
  }
  // ---- MTU / MSS (Phase 7, Path A) -----------------------------------------------------------------------------------------------
  // Steps: fresh read -> confirm naming old -> new -> backup copy written by root and read back (no backup, no change) -> SET_DEVICE_MTU -> the router restarts ->
  // wait for the console (up to about 3 minutes, a failed read just means "not back yet") -> re-read -> data state -> root read of the real interface -> one ping.
  // The wait stops by itself if the console asks for a new sign-in. Nothing is claimed that the re-read did not show. There is no automatic revert after the restart
  // (that needs app code that runs at boot); the way back is "Restore saved values", which sends the saved old pair and restarts the router again.
  const mtuReadRaw = () => R.zte('get', { multi_data: '1', cmd: N.READ.mtu });
  const mtuRead = async () => N.parseMtu(await mtuReadRaw());
  const MTU_WAIT_FIRST_MS = 15000, MTU_WAIT_STEP_MS = 5000, MTU_WAIT_TRIES = 34, MTU_DATA_TRIES = 12;
  async function mtuApply(want, why) {
    if (anyAct()) return;
    st.mtuAct = true; st.mtuMsg = null; progress('Reading the current values from the router…'); syncButtons(); paint('mtu');
    const my = ++actId;
    const done = (bad, lines) => { st.mtuMsg = { bad, lines }; };
    try {
      let cur; try { cur = await mtuRead(); } catch (e) { done(true, ['Not sent: could not read the current values (' + N.maskSecrets(e.message) + ').']); return; }
      if (!cur || cur.mtu === null || cur.mss === null) { done(true, ['Not sent: the router did not report MTU and MSS.']); return; }
      if (cur.mtu === want.mtu && cur.mss === want.mss) { done(false, ['The router already has MTU ' + cur.mtu + ' and MSS ' + cur.mss + '. Nothing was sent.']); return; }
      if (my !== actId) return;
      let call; try { call = N.mtuCall(want.mtu, want.mss); } catch (e) { done(true, ['Not sent: ' + e.message]); return; }
      const ok = await askConfirm((why || 'Change MTU / MSS?') + '\n\nMTU ' + cur.mtu + ' → ' + want.mtu + '\nMSS ' + cur.mss + ' → ' + want.mss
        + '\n\nThe router restarts. Internet, Wi-Fi and this console are away for about 1 to 2 minutes. The old values are saved first. MSS here applies to the router itself, not to connected devices. A bad value can break some sites.', 'Apply and restart', true);
      if (!ok) { st.mtuAct = false; return; }
      if (my !== actId) return;
      // the backup copy: written, then read back; without it nothing is sent
      progress('Saving a backup copy of the old values…');
      try {
        const w = await R.sh(N.mtuBackupWriteSh({ mtu: cur.mtu, mss: cur.mss }, want, Date.now()), 15000);
        const back = N.parseMtuBackup(await R.sh(N.MTU_BACKUP_READ_SH, 15000));
        if (!String(w).includes('MATCHI_BACKUP_OK') || !back || back.old.mtu !== cur.mtu || back.old.mss !== cur.mss) throw new Error('the copy could not be read back');
      } catch (e) { done(true, ['Not sent: the backup copy of the old values could not be saved (' + N.maskSecrets(e.message) + '). Nothing was changed.']); return; }
      progress('Sending the change to the router…');
      try { await R.setRouter(call, true); }
      catch (e) { done(true, ['Not sent: ' + N.maskSecrets(e.message) + '. Nothing was changed.']); return; }
      // the router answers once more before it restarts: wait first, then ask until it is back
      let back = null, wentDown = false, authStop = false;
      progress('Sent. The router is restarting now: internet, Wi-Fi and this console will drop for about 1 to 2 minutes. Keep this window open.');
      await R.sleep(MTU_WAIT_FIRST_MS); if (my !== actId) return;
      for (let i = 0; i < MTU_WAIT_TRIES; i++) {
        try {
          const r = await mtuRead();
          if (r && r.mtu !== null && r.mss !== null) { back = r; if (wentDown || (r.mtu === want.mtu && r.mss === want.mss)) break; }
        } catch (e) { wentDown = true; if (N.isAuthError(e.message)) { authStop = true; break; } }
        if (my !== actId) return;
        progress('The router is restarting… ' + Math.round((MTU_WAIT_FIRST_MS + (i + 1) * MTU_WAIT_STEP_MS) / 1000) + ' s of up to 3 minutes. Keep this window open.');
        await R.sleep(MTU_WAIT_STEP_MS); if (my !== actId) return;
      }
      if (authStop) { done(true, ['The console is asking for a new sign-in after the restart. Sign in again and press Refresh to see the values. The old values are saved: "Restore saved values" puts them back.']); return; }
      if (!back) { done(true, ['The console did not answer again within about 3 minutes. Wait a little, then press Refresh. The old values (MTU ' + cur.mtu + ', MSS ' + cur.mss + ') are saved: "Restore saved values" puts them back.']); return; }
      progress('The router is back. Reading the values…');
      try { st.cache.mtu = { d: await mtuReadRaw(), at: Date.now() }; } catch (_) { /* the view keeps the last values */ }
      const lines = [], same = back.mtu === want.mtu && back.mss === want.mss;
      let bad = !same;
      lines.push(same ? 'The router restarted and reports MTU ' + back.mtu + ', MSS ' + back.mss + '.' : 'The router is back but reports MTU ' + back.mtu + ' and MSS ' + back.mss + ', not the wanted ' + want.mtu + ' / ' + want.mss + '.');
      let ppp = null;
      for (let i = 0; i < MTU_DATA_TRIES; i++) {
        try { ppp = await readPpp(); } catch (_) { /* keep waiting */ }
        if (my !== actId) return;
        if (ppp && ppp.state === 'connected') break;
        progress('The router is back. Waiting for mobile data… ' + (i + 1) * 5 + ' s of up to 60 s.'); await R.sleep(MTU_WAIT_STEP_MS); if (my !== actId) return;
      }
      if (ppp && ppp.state === 'connected') lines.push('Mobile data is connected (' + ppp.ppp + ').'); else { bad = true; lines.push('Mobile data is not connected (' + (ppp && ppp.ppp ? ppp.ppp : 'no answer') + ').'); }
      if (ppp && ppp.state === 'connected') {
        progress('Mobile data is up. Checking the real interface and the connection…');
        try {
          st.root = N.parseRootNet(await R.sh(N.ROOT_READ_SH, 20000)); st.rootErr = '';
          const f = N.wanFollowed(st.root, want.mtu);
          if (want.mtu === cur.mtu) lines.push('MTU was not changed, only MSS.');
          else if (f === true) lines.push('The mobile interface MTU is ' + st.root.wanMtu + ': it follows the new MTU.');
          else if (f === false) { bad = true; lines.push('The mobile interface MTU is ' + st.root.wanMtu + ': it did NOT follow the router setting (' + want.mtu + '). The router value alone does not change the real interface.'); }
          else lines.push('The real interface MTU could not be read.');
        } catch (e) { lines.push('The real interface could not be read (' + N.maskSecrets(e.message) + ').'); }
        try {
          const pg = N.parsePing(await R.sh(N.PING_SH, 20000));
          if (pg === true) lines.push('A ping to 1.1.1.1 through the mobile connection worked. That does not prove every site loads: open a page on a phone.');
          else { bad = true; lines.push(pg === false ? 'A ping to 1.1.1.1 through the mobile connection FAILED.' : 'The ping check gave no answer.'); }
        } catch (e) { lines.push('The ping check could not run (' + N.maskSecrets(e.message) + ').'); }
      }
      lines.push(bad ? 'If something is wrong, "Restore saved values" puts the old values (MTU ' + cur.mtu + ', MSS ' + cur.mss + ') back; the router restarts again.' : 'The old values (MTU ' + cur.mtu + ', MSS ' + cur.mss + ') stay saved for "Restore saved values".');
      done(bad, lines);
      st.mtuForm = null;
    } finally {
      if (my === actId) { st.mtuAct = false; st.prog = ''; if (st.tab === 'mtu') { paint('mtu'); setStatus(st.mtuMsg && st.mtuMsg.bad ? 'Check the result above' : 'Updated ' + new Date().toLocaleTimeString()); } syncButtons(); }
    }
  }
  async function mtuSubmit(mtuText, mssText, errEl) {
    const c = N.mtuCheck(mtuText, mssText);
    if (c.error) { if (errEl) errEl.textContent = c.error; return; }
    await mtuApply({ mtu: c.mtu, mss: c.mss }, 'Change MTU / MSS?');
  }
  async function mtuRestore() {
    if (anyAct()) return;
    let saved; try { saved = N.parseMtuBackup(await R.sh(N.MTU_BACKUP_READ_SH, 15000)); } catch (e) { st.mtuMsg = { bad: true, lines: ['Could not read the saved values (' + N.maskSecrets(e.message) + ').'] }; paint('mtu'); return; }
    if (!saved) { st.mtuMsg = { bad: true, lines: ['No saved values found (or the file is not valid).'] }; paint('mtu'); return; }
    await mtuApply({ mtu: saved.old.mtu, mss: saved.old.mss }, 'Put the saved values back?');
  }
  async function mtuForget() {
    if (st.mtuAct) return;
    if (!(await askConfirm('Delete the saved copy of the old MTU / MSS values?\n\nAfter this "Restore saved values" has nothing to restore.', 'Delete', true))) return;
    try { const o = await R.sh(N.MTU_BACKUP_DELETE_SH, 15000); st.mtuMsg = String(o).includes('MATCHI_BACKUP_GONE') ? { bad: false, lines: ['The saved copy was deleted.'] } : { bad: true, lines: ['The saved copy could not be deleted.'] }; }
    catch (e) { st.mtuMsg = { bad: true, lines: ['Could not delete the saved copy (' + N.maskSecrets(e.message) + ').'] }; }
    paint('mtu');
  }
  // ---- LAN / DHCP pool and lease (Phase 6a) ---------------------------------------------------------------------------------------
  // Same steps as the MTU / MSS change: fresh read -> confirm naming old -> new -> backup copy by root, read back (no backup, no change) -> DHCP_SETTING with the whole
  // set (IP and mask unchanged) -> the router restarts -> wait for the console -> re-read -> data state. The router IP does not change, so the console stays on the
  // same address. No automatic revert (the way back is "Restore saved values"); the router IP and DHCP on / off are not part of this step.
  const lanReadRaw = () => R.zte('get', { multi_data: '1', cmd: N.READ.lan });
  const lanRead = async () => N.parseLan(await lanReadRaw());
  const consoleUrl = (ip) => { const l = (window && window.location) || {}; return (l.protocol || 'http:') + '//' + ip + (l.port ? ':' + l.port : ''); };
  // kinds (opt.kind): 'pool' (default: pool / lease, IP unchanged), 'ip' (Phase 6b: new router IP, pool moved into the new subnet, mac_ip_reset=1), 'ipback' (restore while the
  // router is at the saved NEW address: the old IP, pool and lease go back), 'dhcpon' (Restore DHCP after the server was switched Off). For the two IP kinds a pending note is
  // written by root before the send, and after the send the host is told the new address (/api/net/lan-applied); Kotlin (LanRevert) checks the router after the restart.
  async function lanApply(want, why, restore, opt) {
    if (anyAct()) return;
    const o = opt || {};
    st.lanAct = true; st.lanMsg = null; progress('Reading the current values from the router…'); syncButtons(); paint('lan');
    const my = ++actId;
    const done = (bad, lines) => { st.lanMsg = { bad, lines }; };
    try {
      let cur; try { cur = await lanRead(); } catch (e) { done(true, ['Not sent: could not read the current values (' + N.maskSecrets(e.message) + ').']); return; }
      let kind = o.kind || 'pool';
      if (restore && o.saved && N.lanRestoreKind(cur, o.saved) === 'ip') kind = 'ipback';
      const ipKind = kind === 'ip' || kind === 'ipback', onKind = kind === 'dhcpon';
      const oldSnap = N.lanSnapOf(cur);
      if (onKind) { if (!cur || !cur.ip || !cur.mask) { done(true, ['Not sent: the router did not report its IP address and subnet mask.']); return; } }
      else if (!cur || !oldSnap || cur.dhcp !== 'On') { done(true, ['Not sent: the router did not report a complete LAN / DHCP set with the DHCP server On.']); return; }
      if (kind === 'pool' && cur.start === want.start && cur.end === want.end && cur.leaseHours === want.lease) { done(false, ['The router already has pool ' + cur.start + ' - ' + cur.end + ' and lease ' + N.leaseText(cur.leaseHours) + '. Nothing was sent.']); return; }
      if (my !== actId) return;
      let call, plan = null;
      try {
        if (kind === 'ip') call = N.lanIpCall(cur, want);
        else if (kind === 'ipback') call = N.lanIpRestoreCall(cur, o.saved);
        else if (onKind) { plan = N.lanDhcpOnCall(cur); call = plan.call; }
        else call = restore ? N.lanRestoreCall(cur, want) : N.lanCall(cur, want);
      } catch (e) { done(true, ['Not sent: ' + e.message]); return; }
      const wantAll = { ip: call.lanIp, mask: call.lanNetmask, start: call.dhcpStart, end: call.dhcpEnd, lease: Number(call.dhcpLease) };
      const newSnap = N.lanSnapOk(wantAll);
      const url = ipKind ? consoleUrl(wantAll.ip) : '';
      const poolLines = 'Pool ' + (cur.start || '-') + ' - ' + (cur.end || '-') + ' → ' + wantAll.start + ' - ' + wantAll.end + '\nLease ' + (cur.leaseHours === null || cur.leaseHours === undefined ? '-' : N.leaseText(cur.leaseHours)) + ' → ' + N.leaseText(wantAll.lease);
      const restartText = 'The router restarts. Internet, Wi-Fi and this console are away for about 1 to 2 minutes.';
      let msg;
      if (ipKind) {
        msg = (why || 'Change the router IP address?') + '\n\nRouter IP ' + cur.ip + ' → ' + wantAll.ip + '\n' + poolLines + '\nSubnet mask ' + cur.mask + ' stays the same.\n\n' + restartText
          + ' After that the OLD address ' + cur.ip + ' answers nothing: this console is then at ' + url + '. Devices get new addresses (reconnect them); a PC with a fixed address must be set to the new subnet.'
          + (kind === 'ip' ? ' The old values are saved first, and after the restart MatchiTOOL checks the router and puts the old values back if it came up with something else.' : '');
      } else if (onKind) {
        msg = (why || 'Switch the DHCP server back On?') + '\n\nThe DHCP server is Off now: devices get no address.\n' + poolLines + '\nRouter IP ' + cur.ip + ' and mask ' + cur.mask + ' stay the same.\n\n' + restartText + ' Devices renew their address on their own afterwards.';
      } else {
        msg = (why || 'Change the DHCP pool / lease?') + '\n\n' + poolLines + '\nRouter IP ' + cur.ip + ' and mask ' + cur.mask + ' stay the same.\n\n' + restartText.replace(/\.$/, '') + '. The old values are saved first. Devices renew their address on their own afterwards; one with an address outside the new pool gets a new one.';
      }
      const ok = await askConfirm(msg, kind === 'ip' ? 'Change IP and restart' : kind === 'ipback' ? 'Restore and restart' : onKind ? 'Switch On and restart' : 'Apply and restart', true);
      if (!ok) { st.lanAct = false; return; }
      if (my !== actId) return;
      if (!onKind) {
        progress('Saving a backup copy of the old values…');
        try {
          if (kind !== 'ipback') {   // the restore keeps the copy of the ORIGINAL values; the pending note below still guards this change
            const w = await R.sh(N.lanBackupWriteSh(oldSnap, newSnap, Date.now()), 15000);
            const back = N.parseLanBackup(await R.sh(N.LAN_BACKUP_READ_SH, 15000));
            if (!String(w).includes('MATCHI_BACKUP_OK') || !back || back.old.start !== oldSnap.start || back.old.end !== oldSnap.end || back.old.lease !== oldSnap.lease || back.old.ip !== oldSnap.ip) throw new Error('the copy could not be read back');
          }
          if (ipKind) {
            const w2 = await R.sh(N.lanPendingWriteSh(oldSnap, newSnap, Date.now()), 15000);
            const back2 = N.parseLanBackup(await R.sh(N.LAN_PENDING_READ_SH, 15000));
            if (!String(w2).includes('MATCHI_BACKUP_OK') || !back2 || back2.new.ip !== newSnap.ip || back2.old.ip !== oldSnap.ip) throw new Error('the pending note could not be read back');
          }
        } catch (e) { done(true, ['Not sent: the backup copy of the old values could not be saved (' + N.maskSecrets(e.message) + '). Nothing was changed.']); return; }
      }
      progress('Sending the change to the router…');
      try { await R.setRouter(call, true); }
      catch (e) {
        if (ipKind) { try { await R.sh(N.LAN_PENDING_DELETE_SH, 15000); } catch (_) { /* a stale note is dropped by the host after 30 minutes */ } }
        done(true, ['Not sent: ' + N.maskSecrets(e.message) + '. Nothing was changed.']); return;
      }
      let appliedNote = null;
      if (ipKind) {
        // the old address is about to stop answering: point the host at the new one now (it also checks the router after the restart)
        try { await api('/api/net/lan-applied', { method: 'POST', body: JSON.stringify({ ip: wantAll.ip }) }); }
        catch (e) { appliedNote = 'The console could not be pointed at the new address automatically (' + N.maskSecrets(e.message) + '). After the restart MatchiTOOL checks the router itself.'; }
      }
      let back = null, wentDown = false, authStop = false;
      progress('Sent. The router is restarting now: internet, Wi-Fi and this console will drop for about 1 to 2 minutes. Keep this window open.' + (ipKind ? ' The console is then at ' + url + '.' : ''));
      await R.sleep(MTU_WAIT_FIRST_MS); if (my !== actId) return;
      for (let i = 0; i < MTU_WAIT_TRIES; i++) {
        try {
          const r = await lanRead();
          if (r && r.start !== null && r.end !== null && r.leaseHours !== null) { back = r; if (wentDown || N.lanReached(r, wantAll)) break; }
        } catch (e) { wentDown = true; if (N.isAuthError(e.message)) { authStop = true; break; } }
        if (my !== actId) return;
        progress('The router is restarting… ' + Math.round((MTU_WAIT_FIRST_MS + (i + 1) * MTU_WAIT_STEP_MS) / 1000) + ' s of up to 3 minutes. Keep this window open.' + (ipKind ? ' The console is then at ' + url + '.' : ''));
        await R.sleep(MTU_WAIT_STEP_MS); if (my !== actId) return;
      }
      const way = oldSnap ? ('The old values (' + (ipKind ? 'router IP ' + cur.ip + ', ' : '') + 'pool ' + cur.start + ' - ' + cur.end + ', lease ' + N.leaseText(cur.leaseHours) + ') are saved: \"Restore saved values\" puts them back.') : '';
      const where = ipKind ? ' If this page does not come back, open ' + url + ' (the old address ' + cur.ip + ' answers nothing now).' : '';
      if (authStop) { done(true, ['The console is asking for a new sign-in after the restart. Sign in again and press Refresh to see the values.' + where + ' ' + way]); return; }
      if (!back) { done(true, ['The console did not answer again within about 3 minutes. Wait a little, then press Refresh.' + where + ' ' + way]); return; }
      progress('The router is back. Reading the values…');
      try { st.cache.lan = { d: await lanReadRaw(), at: Date.now() }; } catch (_) { /* the view keeps the last values */ }
      const lines = [], same = N.lanReached(back, wantAll) && back.ip === wantAll.ip;
      let bad = !same;
      lines.push(same ? 'The router restarted and reports ' + (ipKind ? 'router IP ' + back.ip + ', ' : '') + 'pool ' + back.start + ' - ' + back.end + ', lease ' + N.leaseText(back.leaseHours) + (onKind ? ', DHCP On' : '') + '.'
        : 'The router is back but reports ' + (ipKind ? 'router IP ' + back.ip + ', ' : '') + 'pool ' + back.start + ' - ' + back.end + ', lease ' + (back.leaseHours === null ? back.leaseRaw : N.leaseText(back.leaseHours)) + ', DHCP ' + (back.dhcp || 'not reported') + ', not the wanted values.');
      if (back.ip !== wantAll.ip || back.mask !== cur.mask) { bad = true; if (!ipKind || back.ip !== wantAll.ip) lines.push('The router IP / mask now read ' + back.ip + ' / ' + back.mask + ', not ' + wantAll.ip + ' / ' + cur.mask + '.'); }
      if (appliedNote) lines.push(appliedNote);
      if (ipKind && same) { try { await R.sh(N.LAN_PENDING_DELETE_SH, 15000); } catch (_) { /* the host drops a stale note after 30 minutes */ } lines.push('The console is at ' + url + '.'); }
      let ppp = null;
      for (let i = 0; i < MTU_DATA_TRIES; i++) {
        try { ppp = await readPpp(); } catch (_) { /* keep waiting */ }
        if (my !== actId) return;
        if (ppp && ppp.state === 'connected') break;
        progress('The router is back. Waiting for mobile data… ' + (i + 1) * 5 + ' s of up to 60 s.'); await R.sleep(MTU_WAIT_STEP_MS); if (my !== actId) return;
      }
      if (ppp && ppp.state === 'connected') lines.push('Mobile data is connected (' + ppp.ppp + ').'); else { bad = true; lines.push('Mobile data is not connected (' + (ppp && ppp.ppp ? ppp.ppp : 'no answer') + ').'); }
      lines.push('Devices renew their address on their own: reconnect one that does not get internet. ' + (onKind ? '' : bad ? '\"Restore saved values\" puts the old values back; the router restarts again.' : 'The old values stay saved for \"Restore saved values\".'));
      done(bad, lines);
      st.lanForm = null; st.lanIp = '';
    } finally {
      if (my === actId) { st.lanAct = false; st.prog = ''; if (st.tab === 'lan') { paint('lan'); setStatus(st.lanMsg && st.lanMsg.bad ? 'Check the result above' : 'Updated ' + new Date().toLocaleTimeString()); } syncButtons(); }
    }
  }
  async function lanIpSubmit(ipT, errEl) {
    const cur = st.cache.lan && st.cache.lan.d ? N.parseLan(st.cache.lan.d) : null, c = N.lanIpCheck(cur, ipT);
    if (c.error) { if (errEl) errEl.textContent = c.error; return; }
    if (errEl) errEl.textContent = '';
    await lanApply({ ip: c.ip }, 'Change the router IP address?', false, { kind: 'ip' });
  }
  async function lanDhcpOn() { await lanApply(null, 'Switch the DHCP server back On?', false, { kind: 'dhcpon' }); }
  async function lanSubmit(startT, endT, leaseT, errEl) {
    const cur = st.cache.lan && st.cache.lan.d ? N.parseLan(st.cache.lan.d) : null, c = N.lanPoolCheck(cur, startT, endT, leaseT);
    if (c.error) { if (errEl) errEl.textContent = c.error; return; }
    if (errEl) errEl.textContent = '';
    await lanApply({ start: c.start, end: c.end, lease: c.lease }, 'Change the DHCP pool / lease?', false);
  }
  async function lanRestore() {
    if (anyAct()) return;
    let saved; try { saved = N.parseLanBackup(await R.sh(N.LAN_BACKUP_READ_SH, 15000)); } catch (e) { st.lanMsg = { bad: true, lines: ['Could not read the saved values (' + N.maskSecrets(e.message) + ').'] }; paint('lan'); return; }
    if (!saved) { st.lanMsg = { bad: true, lines: ['No saved values found (or the file is not valid).'] }; paint('lan'); return; }
    await lanApply(saved.old, 'Put the saved values back?', true, { saved });   // saved.old also holds the saved IP and mask; lanApply picks the restore that fits (pool / lease, or the old IP too when the router is at the saved new address) and refuses if neither fits
  }
  async function lanForget() {
    if (st.lanAct) return;
    if (!(await askConfirm('Delete the saved copy of the old LAN / DHCP values?\n\nAfter this \"Restore saved values\" has nothing to restore.', 'Delete', true))) return;
    try { const o = await R.sh(N.LAN_BACKUP_DELETE_SH, 15000); st.lanMsg = String(o).includes('MATCHI_BACKUP_GONE') ? { bad: false, lines: ['The saved copy was deleted.'] } : { bad: true, lines: ['The saved copy could not be deleted.'] }; }
    catch (e) { st.lanMsg = { bad: true, lines: ['Could not delete the saved copy (' + N.maskSecrets(e.message) + ').'] }; }
    paint('lan');
  }
  // ---- Wi-Fi: band switch and settings (Phase 3) ----------------------------------------------------------------------------------
  // Both restart Wi-Fi. A device on Wi-Fi (maybe the one showing this page) is disconnected, so the wait loop treats a failed read as "not back yet" and
  // keeps asking for about 90 s. Nothing is claimed that the re-read did not show. The settings change saves the old values by root first (no backup, no write);
  // a band switch needs no file: the way back is to choose the old band.
  const WIFI_WAIT_FIRST_MS = 8000, WIFI_WAIT_STEP_MS = 4000, WIFI_WAIT_TRIES = 22;
  const wifiReadRaw = () => R.zte('get', { multi_data: '1', cmd: N.READ.wifi });
  // Ask until check(parsed, raw) holds; returns {w, raw, wentDown, authStop, got}. Reads that fail are "not back yet", except a sign-in demand, which stops the wait.
  async function wifiWait(my, check, label) {
    let w = null, raw = null, wentDown = false, authStop = false, got = false, ok = false;
    await R.sleep(WIFI_WAIT_FIRST_MS); if (my !== actId) return null;
    for (let i = 0; i < WIFI_WAIT_TRIES; i++) {
      try { raw = await wifiReadRaw(); w = N.parseWifi(raw); got = true; if (check(w, raw)) { ok = true; break; } }
      catch (e) { wentDown = true; if (N.isAuthError(e.message)) { authStop = true; break; } }
      if (my !== actId) return null;
      progress(label + ' ' + Math.round((WIFI_WAIT_FIRST_MS + (i + 1) * WIFI_WAIT_STEP_MS) / 1000) + ' s of up to ' + Math.round((WIFI_WAIT_FIRST_MS + WIFI_WAIT_TRIES * WIFI_WAIT_STEP_MS) / 1000) + ' s. Keep this window open.');
      await R.sleep(WIFI_WAIT_STEP_MS); if (my !== actId) return null;
    }
    return { w, raw, wentDown, authStop, got, ok };
  }
  const wifiEnd = (my) => { if (my === actId) { st.wifiAct = false; st.prog = ''; if (st.tab === 'wifi') { paint('wifi'); setStatus(st.wifiMsg && st.wifiMsg.bad ? 'Check the result above' : 'Updated ' + new Date().toLocaleTimeString()); } syncButtons(); } };
  async function wifiBandSubmit(mode) {
    if (anyAct()) return;
    if (mode !== '2g' && mode !== '5g' && mode !== 'off') { st.wifiMsg = { bad: true, lines: ['Choose 2.4 GHz only, 5 GHz only or Off first.'] }; paint('wifi'); return; }
    st.wifiAct = true; st.wifiMsg = null; progress('Reading the current Wi-Fi state from the router…'); syncButtons(); paint('wifi');
    const my = ++actId, done = (bad, lines) => { st.wifiMsg = { bad, lines }; };
    const nameOf = (m) => (N.WIFI_BANDS.find((b) => b[0] === m) || [m, String(m)])[1];
    try {
      let w; try { w = N.parseWifi(await wifiReadRaw()); } catch (e) { done(true, ['Not sent: could not read the current state (' + N.maskSecrets(e.message) + ').']); return; }
      const now = N.wifiMode(w);
      if (now === null) { done(true, ['Not sent: the router did not report the Wi-Fi state.']); return; }
      if (now === mode) { done(false, ['Wi-Fi is already ' + nameOf(mode) + '. Nothing was sent.']); return; }
      if (my !== actId) return;
      let call; try { call = N.wifiBandCall(mode); } catch (e) { done(true, ['Not sent: ' + e.message]); return; }
      const lockout = mode === 'off' ? '\n\nWi-Fi will be OFF. This console is then reachable only from a cable (USB / Ethernet) connection. If you are not on a cable you lose it, and Wi-Fi stays off until it is turned on from a cable connection.'
        : '\n\nDevices that do not support this band cannot reconnect.';
      const ok = await askConfirm((mode === 'off' ? 'Turn Wi-Fi off?' : 'Switch Wi-Fi to ' + nameOf(mode) + '?') + '\n\nNow: ' + (N.wifiSummary(w) || 'unknown') + ' → ' + nameOf(mode)
        + '\n\nWi-Fi restarts. Every device on Wi-Fi is disconnected, including the one you are using if it is on Wi-Fi. They reconnect on their own if the network name and password stay the same.' + lockout
        + '\n\nWay back: choose ' + nameOf(now === 'both' || now === 'other' ? '5g' : now) + ' here.', mode === 'off' ? 'Turn off' : 'Switch band', true);
      if (!ok) { st.wifiAct = false; return; }
      if (my !== actId) return;
      progress('Sending the band change to the router…');
      try { await R.setRouter(call, true); } catch (e) { done(true, ['Not sent: ' + N.maskSecrets(e.message) + '. Nothing was changed.']); return; }
      progress('Sent. Wi-Fi is restarting now: Wi-Fi devices drop for a short while. Keep this window open.');
      const r = await wifiWait(my, (x) => N.wifiBandReached(x, mode), 'Wi-Fi is restarting…'); if (!r) return;
      if (r.authStop) { done(true, ['The console is asking for a new sign-in. Sign in again and press Refresh to see the Wi-Fi state.']); return; }
      if (!r.got) { done(true, ['The console did not answer within about ' + Math.round((WIFI_WAIT_FIRST_MS + WIFI_WAIT_TRIES * WIFI_WAIT_STEP_MS) / 1000) + ' s. If you were on Wi-Fi, reconnect to it (it may be Off now) and press Refresh.']); return; }
      if (r.raw) st.cache.wifi = { d: r.raw, at: Date.now() };
      st.wifiForm = null; st.wifiBandSel = null;
      done(!r.ok, r.ok ? ['The router reports Wi-Fi: ' + N.wifiSummary(r.w) + '.' + (mode === 'off' ? ' To turn it on again choose a band here (from a cable connection).' : ' Wi-Fi devices reconnect on their own; one that does not reconnect may not support this band.')]
        : ['The router answers but reports Wi-Fi: ' + (N.wifiSummary(r.w) || 'unknown') + ', not ' + nameOf(mode) + '. Press Refresh to read it again.']);
    } finally { wifiEnd(my); }
  }
  async function wifiApply(want, why, restore) {
    if (anyAct()) return;
    st.wifiAct = true; st.wifiMsg = null; progress('Reading the current Wi-Fi settings from the router…'); syncButtons(); paint('wifi');
    const my = ++actId, done = (bad, lines) => { st.wifiMsg = { bad, lines }; };
    try {
      let raw, w; try { raw = await wifiReadRaw(); w = N.parseWifi(raw); } catch (e) { done(true, ['Not sent: could not read the current settings (' + N.maskSecrets(e.message) + ').']); return; }
      const act = N.wifiActive(w), cur = N.wifiSnapOf(act);
      if (!act || !cur) { done(true, ['Not sent: the router must report one band on, with its name, a security mode this tool offers, SSID broadcast and max devices.']); return; }
      if (my !== actId) return;
      const pwChanges = N.wifiPwChange(raw, want);
      if (N.wifiSame(cur, want) && !pwChanges) { done(false, ['The router already has these settings. Nothing was sent.']); return; }
      let call; try { call = N.wifiSaveCall(raw, want); } catch (e) { done(true, ['Not sent: ' + e.message]); return; }
      let oldSnap; try { oldSnap = N.wifiBackupSnap(raw, cur, want, pwChanges); } catch (e) { done(true, ['Not sent: ' + e.message + ' Nothing was changed.']); return; }
      const newSnap = { ssid: want.ssid, auth: want.auth, hidden: want.hidden, max: want.max };
      const lines = N.wifiChangeLines(cur, want, pwChanges), rejoin = cur.ssid !== want.ssid || cur.auth !== want.auth || pwChanges;
      const ok = await askConfirm((why || 'Change the Wi-Fi settings?') + '\n\n' + act.band + '\n' + lines.join('\n')
        + '\n\nWi-Fi restarts. Every device on Wi-Fi is disconnected, including the one you are using if it is on Wi-Fi.' + (rejoin ? ' Reconnect to the new name and password, then press Refresh.' : ' They reconnect on their own.')
        + '\n\nThe old values are saved first; "Restore saved values" puts them back.', 'Apply and restart Wi-Fi', true);
      if (!ok) { st.wifiAct = false; return; }
      if (my !== actId) return;
      progress('Saving a backup copy of the old values…');
      try {
        const wr = await R.sh(N.wifiBackupWriteSh(oldSnap, newSnap, Date.now()), 15000);
        const back = N.parseWifiBackup(await R.sh(N.WIFI_BACKUP_READ_SH, 15000));
        if (!String(wr).includes('MATCHI_BACKUP_OK') || !back || !N.wifiSame(back.old, oldSnap) || (oldSnap.pwB64 || null) !== (back.old.pwB64 || null)) throw new Error('the copy could not be read back');
      } catch (e) { done(true, ['Not sent: the backup copy of the old values could not be saved (' + N.maskSecrets(e.message) + '). Nothing was changed.']); return; }
      progress('Sending the Wi-Fi settings to the router…');
      try { await R.setRouter(call, true); } catch (e) { done(true, ['Not sent: ' + N.maskSecrets(e.message) + '. Nothing was changed.']); return; }
      call = null;
      progress('Sent. Wi-Fi is restarting now: Wi-Fi devices drop for a short while. Keep this window open.');
      const r = await wifiWait(my, (x, rawNow) => N.wifiReached(N.wifiActive(x), want) && (!pwChanges || N.wifiHasPassword(rawNow, N.wifiWantPw(want))), 'Wi-Fi is restarting…'); if (!r) return;
      const way = 'The old values are saved: "Restore saved values" puts them back (if you are on Wi-Fi, reconnect first).';
      if (r.authStop) { done(true, ['The console is asking for a new sign-in. Sign in again and press Refresh to see the values. ' + way]); return; }
      if (!r.got) { done(true, ['The console did not answer within about ' + Math.round((WIFI_WAIT_FIRST_MS + WIFI_WAIT_TRIES * WIFI_WAIT_STEP_MS) / 1000) + ' s. If you were on Wi-Fi, reconnect to ' + (rejoin ? '"' + want.ssid + '" with the new settings' : 'your Wi-Fi') + ' and press Refresh. ' + way]); return; }
      if (r.raw) st.cache.wifi = { d: r.raw, at: Date.now() };
      const e2 = N.wifiActive(r.w), out = [];
      if (r.ok) out.push('The router reports the new settings: "' + want.ssid + '", ' + (N.WIFI_AUTH.find((x) => x[0] === want.auth) || [0, want.auth])[1] + ', ' + (want.hidden ? 'hidden' : 'visible') + ', max ' + want.max + ' devices' + (pwChanges ? ', and the new password' : '') + '.');
      else {
        out.push('The router answers but does not report all the wanted settings.' + (e2 ? ' It reports "' + e2.ssid + '", ' + (e2.auth || 'no security mode') + ', ' + (e2.broadcast === null ? 'broadcast not reported' : e2.broadcast ? 'visible' : 'hidden') + ', max ' + (e2.maxStations === null ? 'not reported' : e2.maxStations) + ' devices.' : ' No band is reported as on.'));
        if (e2 && N.wifiReached(e2, want) && pwChanges) out.push('The name, security, SSID broadcast and max devices match, but the router does not report the new password.');
      }
      out.push(r.ok ? 'The old values stay saved for "Restore saved values". If a device cannot join, check the password it uses.' : way + ' Press Refresh to read the settings again.');
      done(!r.ok, out); st.wifiForm = null;
    } finally { wifiEnd(my); }
  }
  async function wifiSubmit(ssid, auth, visible, max, passEl, errEl) {
    const w = st.cache.wifi && st.cache.wifi.d ? N.parseWifi(st.cache.wifi.d) : null, act = N.wifiActive(w);
    const typed = passEl ? passEl.value : '';
    const c = N.wifiFormCheck(act, { ssid, auth, hidden: !visible, max, pw: typed });
    if (c.error) { if (errEl) errEl.textContent = c.error; return; }
    if (errEl) errEl.textContent = '';
    const want = { ssid: c.ssid, auth: c.auth, hidden: c.hidden, max: c.max, pw: c.pw };
    // the password box keeps its text while the router restarts (and after a declined confirm or an error); after a saved change the form is rebuilt from the router's fresh reply
    await wifiApply(want, 'Change the Wi-Fi settings?', false);
  }
  async function wifiRestore() {
    if (anyAct()) return;
    let saved; try { saved = N.parseWifiBackup(await R.sh(N.WIFI_BACKUP_READ_SH, 15000)); } catch (e) { st.wifiMsg = { bad: true, lines: ['Could not read the saved values (' + N.maskSecrets(e.message) + ').'] }; paint('wifi'); return; }
    if (!saved) { st.wifiMsg = { bad: true, lines: ['No saved values found (or the file is not valid).'] }; paint('wifi'); return; }
    const o = saved.old;
    await wifiApply({ ssid: o.ssid, auth: o.auth, hidden: o.hidden, max: o.max, pwB64: o.pwB64 }, 'Put the saved values back?', true);
  }
  async function wifiForget() {
    if (st.wifiAct) return;
    if (!(await askConfirm('Delete the saved copy of the old Wi-Fi settings?\n\nAfter this "Restore saved values" has nothing to restore. The copy may hold the old Wi-Fi password.', 'Delete', true))) return;
    try { const o = await R.sh(N.WIFI_BACKUP_DELETE_SH, 15000); st.wifiMsg = String(o).includes('MATCHI_BACKUP_GONE') ? { bad: false, lines: ['The saved copy was deleted.'] } : { bad: true, lines: ['The saved copy could not be deleted.'] }; }
    catch (e) { st.wifiMsg = { bad: true, lines: ['Could not delete the saved copy (' + N.maskSecrets(e.message) + ').'] }; }
    paint('wifi');
  }
  async function findMe() {
    try { const r = await api('/api/net/whoami'); st.me = r && r.ip ? N.plainIp(r.ip) : ''; } catch (_) { st.me = ''; }
    if (st.tab === 'devices' && st.cache.devices) paint('devices');
  }
  async function rootRead() {
    if (st.rootBusy) return;
    st.rootBusy = true; st.rootErr = ''; paint('mtu');
    try {
      const out = await R.sh(N.ROOT_READ_SH, 20000);
      st.root = N.parseRootNet(out);
      if (!st.root) st.rootErr = 'the phone gave no usable answer';
    } catch (e) { st.root = null; st.rootErr = e.message; }
    st.rootBusy = false; paint('mtu');
  }
  function release() { if (st.release) { try { st.release(); } catch (_) { /* not fatal */ } st.release = null; } }

  // ---- window ---------------------------------------------------------------------------------------------------------------
  function netStyle() {
    if ($('matchi_net_style')) return;
    const s = document.createElement('style'); s.id = 'matchi_net_style';
    s.textContent = `#matchi_net_modal .net-top{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:10px}
#matchi_net_tabs{display:flex;gap:5px;flex-wrap:wrap}
#matchi_net_modal button{min-height:30px;padding:3px 10px;font-size:12.5px;border-radius:7px}
#matchi_net_modal [role=tab].on{border-color:var(--acc);background:#17365c}
#matchi_net_body{min-height:120px}
#matchi_net_status{font-size:11.5px;margin-top:10px;color:var(--mut)}
#matchi_net_modal .net-kv{display:grid;grid-template-columns:minmax(120px,38%) 1fr;gap:4px 12px;margin:0 0 8px}
#matchi_net_modal .net-kv dt{color:var(--mut)}#matchi_net_modal .net-kv dd{margin:0;word-break:break-word}
#matchi_net_modal .net-mut,#matchi_net_modal .net-note{color:var(--mut)}
#matchi_net_modal .net-warn{color:var(--danger)}
#matchi_net_modal .net-p{margin:6px 0}
#matchi_net_modal h4{margin:12px 0 6px;font-size:12.5px;letter-spacing:.04em}
#matchi_net_modal .net-sec{border-top:1px solid var(--bd);margin-top:10px;padding-top:2px}
#matchi_net_modal .net-actions{margin:6px 0}
#matchi_net_modal .net-scroll{overflow-x:auto;margin:8px 0}
#matchi_net_modal .net-tbl{border-collapse:collapse;width:100%;font-size:12.5px}
#matchi_net_modal .net-tbl th,#matchi_net_modal .net-tbl td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--bd);white-space:nowrap}
#matchi_net_modal .net-ul{margin:4px 0;padding-left:18px}
#matchi_net_modal .net-rowact{white-space:nowrap}#matchi_net_modal .net-act{margin-right:4px;min-height:26px;padding:2px 8px}
#matchi_net_modal .net-frow{display:grid;grid-template-columns:minmax(110px,32%) 1fr;gap:8px;align-items:center;margin:5px 0}#matchi_net_modal .net-frow input,#matchi_net_modal .net-frow select{min-height:30px;padding:3px 8px}
#matchi_net_modal .net-prog{padding:8px 10px;border-radius:8px;background:rgba(90,150,255,.14);border:1px solid rgba(90,150,255,.4)}
#matchi_net_modal .net-danger{border-color:rgba(255,100,124,.5)}
#matchi_net_modal .net-pre{background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:8px;margin:6px 0;font-size:11px;line-height:1.45;white-space:pre-wrap;overflow:auto;max-height:160px}`;
    document.head.appendChild(s);
  }
  function open(startTab, only) {
    st.only = only === true;   // true: the Devices tile's own window, no tabs, titled Devices
    const first = typeof startTab === 'string' && VIEWS[startTab] ? startTab : 'data';   // the click on the Network button passes an event, not a tab
    netStyle();
    release(); st.release = R.beginBusy('Network window open');
    st.cache = {}; st.root = null; st.rootErr = ''; st.rootBusy = false; st.tab = first; epoch++; actId++; st.act = null; st.actMsg = null; st.devAct = false; st.devMsg = null; st.me = ''; st.apnAct = false; st.apnMsg = null; st.apnForm = null; st.mtuAct = false; st.mtuMsg = null; st.mtuForm = null; st.lanAct = false; st.lanMsg = null; st.lanForm = null; st.lanIp = ''; st.wifiAct = false; st.wifiMsg = null; st.wifiForm = null; st.wifiBandSel = null; st.prog = ''; st.loading = false;
    createModal({
      name: MODAL, title: st.only ? 'Devices' : 'Network', maxWidth: '640px', showConfirm: false, onClose: () => { epoch++; actId++; st.act = null; st.devAct = false; st.apnAct = false; st.apnForm = null; st.mtuAct = false; st.lanAct = false; st.wifiAct = false; st.prog = ''; release(); return true; },
      content: '<div class="net-top">' + (st.only ? '<span></span>' : '<div id="matchi_net_tabs" role="tablist" aria-label="Network sections"></div>') + '<button type="button" id="matchi_net_refresh">Refresh</button></div>' +
        '<div id="matchi_net_body" role="tabpanel" aria-live="polite"></div><div id="matchi_net_status" role="status"></div>',
    });
    showModal(MODAL);
    const tabs = $('matchi_net_tabs');
    if (tabs) for (const [id, label] of N.TABS) {
      const b = h('button', { type: 'button', role: 'tab', 'data-tab': id, id: 'matchi_net_tab_' + id }, label);
      b.onclick = () => select(id);
      b.onkeydown = (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const ids = N.TABS.map((t) => t[0]), i = ids.indexOf(id), n = ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
        e.preventDefault(); select(n); const nb = $('matchi_net_tab_' + n); if (nb) nb.focus();
      };
      tabs.appendChild(b);
    }
    $('matchi_net_refresh').onclick = () => { if (!st.loading) { delete st.cache[st.tab]; if (st.tab === 'mtu') st.mtuForm = null; if (st.tab === 'lan') st.lanForm = null; if (st.tab === 'wifi') { st.wifiForm = null; st.wifiBandSel = null; } load(st.tab); } };   // Refresh also puts the MTU form back to the router's values
    load(first); syncButtons();
    findMe();
  }
  window.MatchiNetOpen = open;
  window.MatchiDevicesOpen = () => open('devices', true);   // the Devices tile in Live device status: only the device list, no Network tabs

  const b = document.createElement('button');
  b.id = 'matchi_net_btn'; b.type = 'button'; b.textContent = 'Network'; b.onclick = open;
  const ref = $('matchi_perf_btn');
  if (ref && ref.parentNode === host) ref.after(b); else host.appendChild(b);
}

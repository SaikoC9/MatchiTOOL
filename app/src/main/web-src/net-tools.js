/*
 * Network window. Button "Network" in the top button row. Tabs: Data, Wi-Fi, Devices, APN, LAN / DHCP, MTU / MSS.
 * Phase 1: every tab reads. Phase 2: the Data tab also switches mobile data off / on (confirm, send, re-read ppp_status every 2 s for at
 * most 30 s, never claim success without the re-read). Phase 4: the Devices tab renames, blocks and unblocks devices (confirm, send, re-read
 * the lists, say what the router reports). Phase 5: the APN tab reads the profile list, switches back to Auto, uses / adds / edits / deletes profiles
 * (confirm, send, re-read, then check that mobile data is connected; writes only in Manual mode, plus one guarded way in from Auto). Phase 7: the MTU / MSS tab changes both values with the router's own call (confirm, backup copy by root, send, wait for the restart, re-read, root checks).
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
  const st = { tab: 'data', cache: {}, root: null, rootErr: '', rootBusy: false, loading: false, release: null, act: null, actMsg: null, devAct: false, devMsg: null, me: '', apnAct: false, apnMsg: null, apnForm: null, mtuAct: false, mtuMsg: null, mtuForm: null };
  let epoch = 0, actId = 0;

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
  const note = (t, cls) => h('p', { class: 'net-p' + (cls ? ' ' + cls : '') }, t);
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
  function viewWifi(d) {
    const w = N.parseWifi(d);
    if (!w || (w.moduleOn === null && !w.entries.length)) return note(NOT + ' (Wi-Fi settings).');
    const top = kv([['Wi-Fi', w.moduleOn === null ? null : w.moduleOn ? 'On' : 'Off'], ['Band in use', N.wifiSummary(w)], ['Devices on Wi-Fi', w.clients === null ? null : String(w.clients)]]);
    const blocks = w.entries.map((e) => h('section', { class: 'net-sec' },
      h('h4', {}, e.band + (e.on === null ? '' : e.on ? ' · on' : ' · off')),
      kv([['Network name (SSID)', e.ssid], ['Security', e.auth], ['SSID broadcast', e.broadcast === null ? null : e.broadcast ? 'Visible' : 'Hidden'],
        ['Max devices', e.maxStations === null ? null : String(e.maxStations)], ['Country code', e.country]])));
    return h('div', {}, top, blocks, note('The Wi-Fi password is not shown or kept here. Which chip is which band is a guess until the band switch is captured.', 'net-mut'));
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
    const refusal = N.apnRefusal(a), busy = st.apnAct || st.act || st.devAct;
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
    return h('div', {}, top, bar, msg, st.apnForm ? apnFormView(a) : null, table || (a.hasSlots ? note('No manual profiles are stored.', 'net-mut') : note('Profile list: ' + NOT.toLowerCase() + '.', 'net-mut')), notes);
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
    return kv([['Router IP address', p.ip], ['Subnet mask', p.mask], ['DHCP server', p.dhcp], ['DHCP pool', pool],
      ['Lease time', p.leaseHours !== null ? N.leaseText(p.leaseHours) : p.leaseRaw], ['Router MAC address', p.mac]]);
  }
  function viewMtu(d) {
    const p = N.parseMtu(d);
    const known = !!p && p.mtu !== null && p.mss !== null;
    const router = !p || (p.mtu === null && p.mss === null) ? note(NOT + ' (MTU / MSS).')
      : h('div', {}, kv([['MTU (router setting)', p.mtu === null ? null : String(p.mtu)], ['MSS (router setting)', p.mss === null ? null : String(p.mss)]]), p.warn ? note(p.warn, 'net-warn') : null);
    const msg = st.mtuMsg ? h('div', {}, st.mtuMsg.lines.map((t) => note(t, st.mtuMsg.bad ? 'net-warn' : ''))) : null;
    return h('div', {}, router, msg, known ? mtuForm(p) : note('MTU and MSS are not changed here: the router did not report both values.', 'net-mut'),
      note('On the F50 test the stock MSS rule applied to the router itself, not to devices connected to it. The real values below come from a read-only root check.', 'net-mut'),
      rootBlock());
  }
  // The change form: two numbers, checked by net-core.js; Apply restarts the router. The old values are saved by root before anything is sent.
  function mtuForm(p) {
    const base = p.mtu + '/' + p.mss;
    if (!st.mtuForm || st.mtuForm.base !== base) st.mtuForm = { base, mtu: String(p.mtu), mss: String(p.mss) };
    const busy = st.mtuAct || st.act || st.devAct || st.apnAct;
    const inp = (id, v, key) => { const e = h('input', { type: 'text', id, maxlength: '4', inputmode: 'numeric', autocomplete: 'off' }); e.value = v; e.oninput = () => { st.mtuForm[key] = e.value; }; if (busy) e.disabled = true; return e; };
    const row = (label, el) => h('div', { class: 'net-frow' }, h('label', { for: el.id }, label), el);
    const err = h('p', { class: 'net-p net-warn', id: 'matchi_mtu_err' }, '');
    const mtuIn = inp('matchi_mtu_mtu', st.mtuForm.mtu, 'mtu'), mssIn = inp('matchi_mtu_mss', st.mtuForm.mss, 'mss');
    const mk = (label, id, fn, danger) => { const b = h('button', { type: 'button', id, class: danger ? 'net-danger' : '' }, label); if (busy) b.disabled = true; b.onclick = fn; return b; };
    const useDefault = mk('MSS = MTU − 40', 'matchi_mtu_default', () => { const c = N.mtuCheck(mtuIn.value, String(N.MSS_MIN)); if (c.error && !/MSS/.test(c.error)) { err.textContent = c.error; return; } mssIn.value = String(N.mtuDefaultMss(parseInt(mtuIn.value, 10))); st.mtuForm.mss = mssIn.value; err.textContent = ''; });
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
  const setStatus = (t) => { const s = $('matchi_net_status'); if (s) s.textContent = t || ''; };
  const syncButtons = () => {
    const r = $('matchi_net_refresh'); if (r) r.disabled = st.loading || !!st.act || st.devAct || st.apnAct || st.mtuAct;
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
    st.apnAct = true; st.apnMsg = null; syncButtons(); paint('apn'); setStatus('Sending…');
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
        setStatus('Waiting for mobile data… ' + (i + 1) * 2 + ' s');
        await R.sleep(2000);
        if (my !== actId) return;
      }
      st.apnMsg = ppp && ppp.state === 'connected' ? { bad: false, text: okText + ' Mobile data is connected (' + ppp.ppp + ').' }
        : { bad: true, text: okText + ' But mobile data is not connected (' + (ppp && ppp.ppp ? ppp.ppp : 'no answer') + '). If it does not come back, press "Switch to Auto".' };
    } finally {
      if (my === actId) { st.apnAct = false; if (st.tab === 'apn') { paint('apn'); setStatus(st.apnMsg && st.apnMsg.bad ? 'Check the result above' : 'Updated ' + new Date().toLocaleTimeString()); } syncButtons(); }
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
    await apnApply([call], (x) => !!x && !x.profiles.some((q) => q.slot === p.slot), 'Deleted "' + p.name + '".', 'The router still lists "' + p.name + '".');
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
    if (st.mtuAct || st.act || st.devAct || st.apnAct) return;
    st.mtuAct = true; st.mtuMsg = null; syncButtons(); paint('mtu'); setStatus('Reading the router…');
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
      try {
        const w = await R.sh(N.mtuBackupWriteSh({ mtu: cur.mtu, mss: cur.mss }, want, Date.now()), 15000);
        const back = N.parseMtuBackup(await R.sh(N.MTU_BACKUP_READ_SH, 15000));
        if (!String(w).includes('MATCHI_BACKUP_OK') || !back || back.old.mtu !== cur.mtu || back.old.mss !== cur.mss) throw new Error('the copy could not be read back');
      } catch (e) { done(true, ['Not sent: the backup copy of the old values could not be saved (' + N.maskSecrets(e.message) + '). Nothing was changed.']); return; }
      setStatus('Sending…');
      try { await R.setRouter(call, true); }
      catch (e) { done(true, ['Not sent: ' + N.maskSecrets(e.message) + '. Nothing was changed.']); return; }
      // the router answers once more before it restarts: wait first, then ask until it is back
      let back = null, wentDown = false, authStop = false;
      await R.sleep(MTU_WAIT_FIRST_MS); if (my !== actId) return;
      for (let i = 0; i < MTU_WAIT_TRIES; i++) {
        try {
          const r = await mtuRead();
          if (r && r.mtu !== null && r.mss !== null) { back = r; if (wentDown || (r.mtu === want.mtu && r.mss === want.mss)) break; }
        } catch (e) { wentDown = true; if (N.isAuthError(e.message)) { authStop = true; break; } }
        if (my !== actId) return;
        setStatus('The router is restarting… ' + Math.round((MTU_WAIT_FIRST_MS + (i + 1) * MTU_WAIT_STEP_MS) / 1000) + ' s');
        await R.sleep(MTU_WAIT_STEP_MS); if (my !== actId) return;
      }
      if (authStop) { done(true, ['The console is asking for a new sign-in after the restart. Sign in again and press Refresh to see the values. The old values are saved: "Restore saved values" puts them back.']); return; }
      if (!back) { done(true, ['The console did not answer again within about 3 minutes. Wait a little, then press Refresh. The old values (MTU ' + cur.mtu + ', MSS ' + cur.mss + ') are saved: "Restore saved values" puts them back.']); return; }
      try { st.cache.mtu = { d: await mtuReadRaw(), at: Date.now() }; } catch (_) { /* the view keeps the last values */ }
      const lines = [], same = back.mtu === want.mtu && back.mss === want.mss;
      let bad = !same;
      lines.push(same ? 'The router restarted and reports MTU ' + back.mtu + ', MSS ' + back.mss + '.' : 'The router is back but reports MTU ' + back.mtu + ' and MSS ' + back.mss + ', not the wanted ' + want.mtu + ' / ' + want.mss + '.');
      let ppp = null;
      for (let i = 0; i < MTU_DATA_TRIES; i++) {
        try { ppp = await readPpp(); } catch (_) { /* keep waiting */ }
        if (my !== actId) return;
        if (ppp && ppp.state === 'connected') break;
        setStatus('Waiting for mobile data… ' + (i + 1) * 5 + ' s'); await R.sleep(MTU_WAIT_STEP_MS); if (my !== actId) return;
      }
      if (ppp && ppp.state === 'connected') lines.push('Mobile data is connected (' + ppp.ppp + ').'); else { bad = true; lines.push('Mobile data is not connected (' + (ppp && ppp.ppp ? ppp.ppp : 'no answer') + ').'); }
      if (ppp && ppp.state === 'connected') {
        setStatus('Checking the real interface…');
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
      if (my === actId) { st.mtuAct = false; if (st.tab === 'mtu') { paint('mtu'); setStatus(st.mtuMsg && st.mtuMsg.bad ? 'Check the result above' : 'Updated ' + new Date().toLocaleTimeString()); } syncButtons(); }
    }
  }
  async function mtuSubmit(mtuText, mssText, errEl) {
    const c = N.mtuCheck(mtuText, mssText);
    if (c.error) { if (errEl) errEl.textContent = c.error; return; }
    await mtuApply({ mtu: c.mtu, mss: c.mss }, 'Change MTU / MSS?');
  }
  async function mtuRestore() {
    if (st.mtuAct || st.act || st.devAct || st.apnAct) return;
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
#matchi_net_modal .net-danger{border-color:rgba(255,100,124,.5)}
#matchi_net_modal .net-pre{background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:8px;margin:6px 0;font-size:11px;line-height:1.45;white-space:pre-wrap;overflow:auto;max-height:160px}`;
    document.head.appendChild(s);
  }
  function open() {
    netStyle();
    release(); st.release = R.beginBusy('Network window open');
    st.cache = {}; st.root = null; st.rootErr = ''; st.rootBusy = false; st.tab = 'data'; epoch++; actId++; st.act = null; st.actMsg = null; st.devAct = false; st.devMsg = null; st.me = ''; st.apnAct = false; st.apnMsg = null; st.apnForm = null; st.mtuAct = false; st.mtuMsg = null; st.mtuForm = null; st.loading = false;
    createModal({
      name: MODAL, title: 'Network', maxWidth: '640px', showConfirm: false, onClose: () => { epoch++; actId++; st.act = null; st.devAct = false; st.apnAct = false; st.apnForm = null; st.mtuAct = false; release(); return true; },
      content: '<div class="net-top"><div id="matchi_net_tabs" role="tablist" aria-label="Network sections"></div><button type="button" id="matchi_net_refresh">Refresh</button></div>' +
        '<div id="matchi_net_body" role="tabpanel" aria-live="polite"></div><div id="matchi_net_status" role="status"></div>',
    });
    showModal(MODAL);
    const tabs = $('matchi_net_tabs');
    for (const [id, label] of N.TABS) {
      const b = h('button', { type: 'button', role: 'tab', 'data-tab': id, id: 'matchi_net_tab_' + id }, label);
      b.onclick = () => select(id);
      b.onkeydown = (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const ids = N.TABS.map((t) => t[0]), i = ids.indexOf(id), n = ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
        e.preventDefault(); select(n); const nb = $('matchi_net_tab_' + n); if (nb) nb.focus();
      };
      tabs.appendChild(b);
    }
    $('matchi_net_refresh').onclick = () => { if (!st.loading) { delete st.cache[st.tab]; load(st.tab); } };
    load('data');
    findMe();
  }

  const b = document.createElement('button');
  b.id = 'matchi_net_btn'; b.type = 'button'; b.textContent = 'Network'; b.onclick = open;
  const ref = $('matchi_perf_btn');
  if (ref && ref.parentNode === host) ref.after(b); else host.appendChild(b);
}

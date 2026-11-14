/*
 * Network window. Button "Network" in the top button row. Tabs: Data, Wi-Fi, Devices, APN, LAN / DHCP, MTU / MSS.
 * Phase 1: every tab reads. Phase 2: the Data tab also switches mobile data off / on (confirm, send, re-read ppp_status every 2 s for at
 * most 30 s, never claim success without the re-read). Phase 4: the Devices tab renames, blocks and unblocks devices (confirm, send, re-read
 * the lists, say what the router reports). Everything else is still read only; the one root call (MTU / MSS tab) is a
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
  const st = { tab: 'data', cache: {}, root: null, rootErr: '', rootBusy: false, loading: false, release: null, act: null, actMsg: null, devAct: false, devMsg: null, me: '' };
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
    const p = N.parseApn(d);
    if (allEmpty(p, ['mode', 'autoProfile', 'v4', 'v6'])) return note(NOT + ' (APN).');
    const lists = [];
    for (const [label, c] of [['IPv4 profiles', p.v4], ['IPv6 profiles', p.v6]]) {
      if (!c) continue;
      lists.push(h('h4', {}, label));
      if (c.kind === 'list') lists.push(h('ul', { class: 'net-ul' }, c.items.map((it) => h('li', {}, N.apnLine(it)))));
      else lists.push(h('pre', { class: 'net-pre' }, c.text));
    }
    return h('div', {},
      kv([['APN mode', p.mode], ['Automatic profile', p.autoProfile]]),
      lists.length ? lists : note('Profile list: ' + NOT.toLowerCase() + '. It can come back empty while the mode is Auto.', 'net-mut'),
      note('Passwords are never shown here.', 'net-mut'));
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
    const router = !p || (p.mtu === null && p.mss === null) ? note(NOT + ' (MTU / MSS).')
      : h('div', {}, kv([['MTU (router setting)', p.mtu === null ? null : String(p.mtu)], ['MSS (router setting)', p.mss === null ? null : String(p.mss)]]), p.warn ? note(p.warn, 'net-warn') : null);
    return h('div', {}, router,
      note('On the F50 test the stock MSS rule applied to the router itself, not to devices connected to it. The real values below come from a read-only root check.', 'net-mut'),
      rootBlock());
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
    const r = $('matchi_net_refresh'); if (r) r.disabled = st.loading || !!st.act || st.devAct;
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
#matchi_net_modal .net-danger{border-color:rgba(255,100,124,.5)}
#matchi_net_modal .net-pre{background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:8px;margin:6px 0;font-size:11px;line-height:1.45;white-space:pre-wrap;overflow:auto;max-height:160px}`;
    document.head.appendChild(s);
  }
  function open() {
    netStyle();
    release(); st.release = R.beginBusy('Network window open');
    st.cache = {}; st.root = null; st.rootErr = ''; st.rootBusy = false; st.tab = 'data'; epoch++; actId++; st.act = null; st.actMsg = null; st.devAct = false; st.devMsg = null; st.me = ''; st.loading = false;
    createModal({
      name: MODAL, title: 'Network', maxWidth: '640px', showConfirm: false, onClose: () => { epoch++; actId++; st.act = null; st.devAct = false; release(); return true; },
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

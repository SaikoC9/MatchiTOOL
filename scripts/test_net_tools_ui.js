#!/usr/bin/env node
// Network window (web-src/net-tools.js), Phase 1: the real file run against a tiny fake DOM and a scripted MatchiRadio, so a typo or a bad
// render path shows up without a router or a browser. Checks: the button, one read per tab (always "get"), what each tab shows, that the
// Wi-Fi password never reaches the page, the root button, the error path, and that closing the window releases the Live Status pause.
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../app/src/main/web-src/net-tools.js'), 'utf8');
const N = require('../app/src/main/web-src/net-core.js');

// ---- fake DOM (only what net-tools.js uses) ---------------------------------------------------------------------------------
class Node {
  constructor(tag, text) { this.tag = tag; this.nodeType = text === undefined ? 1 : 3; this._text = text; this.children = []; this.attrs = {}; this.parentNode = null; this.className = ''; this.disabled = false; this.tabIndex = 0; this.style = {};
    this.classList = { toggle: (c, on) => { const s = new Set(this.className.split(' ').filter(Boolean)); if (on) s.add(c); else s.delete(c); this.className = [...s].join(' '); } };
    this.dataset = new Proxy({}, { get: (_, k) => this.attrs['data-' + String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())] }); }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = String(v); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
  append(...kids) { for (const k of kids) this.appendChild(k); }
  appendChild(k) { if (k.parentNode) k.parentNode.children.splice(k.parentNode.children.indexOf(k), 1); k.parentNode = this; this.children.push(k); return k; }
  replaceChildren(...kids) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...kids); }
  after(n) { const p = this.parentNode; p.children.splice(p.children.indexOf(this) + 1, 0, n); n.parentNode = p; }
  focus() { Node.focused = this; }
  get textContent() { return this.nodeType === 3 ? this._text : this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = []; this.append(new Node('#text', String(v))); }
  walk(f) { f(this); for (const c of this.children) if (c.nodeType === 1) c.walk(f); }
  find(f) { let r = null; this.walk((n) => { if (!r && f(n)) r = n; }); return r; }
  findAll(f) { const r = []; this.walk((n) => { if (f(n)) r.push(n); }); return r; }
}
const root = new Node('html'), head = new Node('head'), body = new Node('body'); root.append(head, body);
const host = new Node('div'); host.className = 'actions-buttons'; body.append(host);
const doc = {
  createElement: (t) => new Node(t), createTextNode: (t) => new Node('#text', String(t)), head, body,
  getElementById: (id) => root.find((n) => n.attrs.id === id),
  querySelector: (sel) => (sel === '.actions-buttons' ? host : null),
  querySelectorAll: (sel) => { assert.strictEqual(sel, '#matchi_net_tabs [role=tab]'); const t = doc.getElementById('matchi_net_tabs'); return t ? t.findAll((n) => n.attrs.role === 'tab') : []; },
};
const ids = {};   // createModal stub: builds the static pieces by id, and checks the static content really holds those ids
let modalOpts = null;
const createModal = (o) => {
  modalOpts = o; const m = new Node('div'); m.attrs.id = o.name;
  for (const id of ['matchi_net_tabs', 'matchi_net_refresh', 'matchi_net_body', 'matchi_net_status']) { assert(o.content.includes('id="' + id + '"'), 'content lacks #' + id); const n = new Node(id === 'matchi_net_refresh' ? 'button' : 'div'); n.attrs.id = id; m.append(n); }
  assert(!/<script|on\w+=|\$\{/.test(o.content), 'static content only');
  body.append(m); return { el: m };
};
const showModal = () => {};

// ---- scripted radio ---------------------------------------------------------------------------------------------------------
const calls = [], shells = [], sets = [], confirms = []; let black = '', blackNames = '', hostOverride = null, me = '192.168.0.10', pppNow = 'ipv4_ipv6_connected', stuck = false, setFail = null, confirmAnswer = true; let busyNow = 0, released = 0, failNext = null;
const WIFI = { WiFiModuleSwitch: '1', wifi_access_sta_num: '1', ResponseList: [0, 1].map((i) => ({ ChipIndex: i, AccessPointIndex: '0', AccessPointSwitchStatus: i === 1 ? '1' : '0', SSID: 'HomeNet', ApMaxStationNumber: 10, AuthMode: 'WPA2PSKWPA3PSK', ApBroadcastDisabled: '0', CountryCode: 'CN', Password: 'TopSecret-pass-1', PasswordShow: 'TopSecret-pass-1' })) };
const ANSWERS = {
  data: { ppp_status: 'ipv4_ipv6_connected', dial_mode: 'auto_dial', roam_setting_option: 'off', dial_roam_setting_option: '' },
  wifi: WIFI,
  devices: { station_list: [{ mac_addr: 'AA:BB:CC:DD:EE:01', hostname: 'My-Phone', ip_addr: '192.168.0.10' }], lan_station_list: [{ mac_addr: 'AA:BB:CC:DD:EE:02', hostname: 'GL-MT3000', ip_addr: '192.168.0.2' }], wifi_access_sta_num: '1' },
  apn: { apn_mode: 'auto', apn_auto_profile: '', APN_config: '', ipv6_APN_config: '' },
  lan: { lan_ipaddr: '192.168.0.1', lan_netmask: '255.255.255.0', dhcpEnabled: '1', dhcpStart: '192.168.0.2', dhcpEnd: '192.168.0.253', dhcpLease_hour: '24h', mac_address: '02:00:00:00:00:01' },
  mtu: { mtu: '1500', tcp_mss: '1460' },
};
const ROOT_OUT = '##route\n1.1.1.1 dev sipa_eth0 src 100.95.85.97\n##link\n14: sipa_eth0: <NOARP,UP,LOWER_UP> mtu 1500 qdisc x\n##filter\n-A INPUT -p tcp -j TCPMSS --set-mss 1460\n-A INPUT -p tcp -j TCPMSS --set-mss 1460\n##mangle\n##filter6\n##mangle6\n##end\n';
const R = {
  zte: async (op, params) => { calls.push({ op, params }); if (failNext) { const e = failNext; failNext = null; throw e; } const tab = Object.keys(N.READ).find((k) => N.READ[k] === params.cmd); if (tab === 'data') return Object.assign({}, ANSWERS.data, { ppp_status: pppNow });
    if (tab === 'devices') { const d = JSON.parse(JSON.stringify(ANSWERS.devices)); d.AclMode = '2'; d.WhiteMacList = ''; d.WhiteNameList = ''; d.BlackMacList = black; d.BlackNameList = blackNames; if (hostOverride) d.lan_station_list[0].hostname = hostOverride; return d; }
    return ANSWERS[tab]; },
  sh: async (cmd) => { shells.push(cmd); return ROOT_OUT; },
  beginBusy: () => { busyNow++; return () => { busyNow--; released++; }; }, isBusy: () => busyNow > 0,
  sleep: async () => {},
  setRouter: async (params, allowEmpty) => { sets.push({ params, allowEmpty }); if (setFail) { const e = setFail; setFail = null; throw e; }
    if (params.goformId === 'setDeviceAccessControlList') { if (!stuck) { black = params.BlackMacList; blackNames = params.BlackNameList; } return; }
    if (params.goformId === 'EDIT_HOSTNAME') { if (!stuck) hostOverride = params.hostname; return; }
    if (!stuck) pppNow = params.goformId === 'DISCONNECT_NETWORK' ? 'ppp_disconnected' : 'ipv4_ipv6_connected'; },
};
const win = { MatchiRadio: R, MatchiNetCore: N };
const askConfirm = async (msg, ok, danger) => { confirms.push({ msg, ok, danger }); return confirmAnswer; };
const texts = []; let textAnswer = null;
const askText = async (o) => { texts.push(o); return textAnswer; };
const api = async (url) => { assert.strictEqual(url, '/api/net/whoami'); return { ip: '::ffff:' + me }; };
const mount = new Function('window', 'document', 'createModal', 'showModal', 'askConfirm', 'askText', 'api', src + '\nreturn mountNetTools;')(win, doc, createModal, showModal, askConfirm, askText, api);
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const bodyText = () => doc.getElementById('matchi_net_body').textContent;
const click = async (n) => { n.onclick(); await flush(); };
const tabBtn = (id) => doc.getElementById('matchi_net_tab_' + id);

(async () => {
  mount();
  const btn = doc.getElementById('matchi_net_btn');
  assert(btn && btn.textContent === 'Network' && btn.parentNode === host, 'Network button is in the button row');
  mount(); assert.strictEqual(host.children.length, 1, 'mounting twice adds one button');

  await click(btn);                                              // open: reads the Data tab once, pauses Live Status
  assert.strictEqual(modalOpts.title, 'Network'); assert.strictEqual(busyNow, 1);
  assert.strictEqual(calls.length, 1); assert.deepStrictEqual(calls[0], { op: 'get', params: { multi_data: '1', cmd: N.READ.data } });
  assert(/Connected/.test(bodyText()) && /ipv4_ipv6_connected/.test(bodyText()) && /Automatic/.test(bodyText()), 'data tab: ' + bodyText());
  assert.strictEqual(doc.getElementById('matchi_net_tab_data').attrs['aria-selected'], 'true');
  assert(/Updated/.test(doc.getElementById('matchi_net_status').textContent));
  assert.strictEqual(doc.getElementById('matchi_net_tabs').children.length, 6);

  await click(tabBtn('wifi'));
  let t = bodyText();
  assert(/HomeNet/.test(t) && /5 GHz only \(probably\)/.test(t) && /WPA2-PSK \/ WPA3-PSK/.test(t) && /Chip 0/.test(t) && /Visible/.test(t), 'wifi tab: ' + t);
  assert(!t.includes('TopSecret'), 'the Wi-Fi password must not reach the page');
  assert(!JSON.stringify(doc.body, (k, v) => (k === 'parentNode' ? undefined : v)).includes('TopSecret'), 'nor any attribute of the page');

  await click(tabBtn('devices'));
  t = bodyText();
  assert(/2 devices: 1 on Wi-Fi, 1 on cable/.test(t) && /My-Phone/.test(t) && /GL-MT3000/.test(t) && /aa:bb:cc:dd:ee:02/.test(t) && /Cable/.test(t), 'devices tab: ' + t);
  assert.strictEqual(doc.getElementById('matchi_net_body').findAll((n) => n.tag === 'tr').length, 3, 'header + 2 rows');

  await click(tabBtn('apn'));
  t = bodyText(); assert(/auto/.test(t) && /Not reported by this router/.test(t), 'apn tab: ' + t);
  await click(tabBtn('lan'));
  t = bodyText(); assert(/192\.168\.0\.1/.test(t) && /255\.255\.255\.0/.test(t) && /192\.168\.0\.2 - 192\.168\.0\.253/.test(t) && /24 hours/.test(t) && /DHCP serverOn/.test(t), 'lan tab: ' + t);
  await click(tabBtn('mtu'));
  t = bodyText(); assert(/1500/.test(t) && /1460/.test(t) && /Read real values \(root\)/.test(t) && shells.length === 0, 'mtu tab: ' + t);

  const rootBtn = doc.getElementById('matchi_net_root');       // the root read starts only from this button
  await click(rootBtn);
  assert.strictEqual(shells.length, 1); assert.strictEqual(shells[0], N.ROOT_READ_SH);
  t = bodyText(); assert(/sipa_eth0/.test(t) && /--set-mss 1460/.test(t) && /appear twice/.test(t) && /Read again/.test(t), 'root result: ' + t);

  assert(calls.every((c) => c.op === 'get'), 'only reads were sent');
  assert.strictEqual(sets.length, 0, 'no write so far');
  const nSetsBefore = 0;
  assert.strictEqual(calls.length, 6, 'one read per tab, nothing else (no polling)');

  // switching to a tab already read shows it again without asking the router
  await click(tabBtn('data')); assert.strictEqual(calls.length, 6); assert(/Connected/.test(bodyText()));
  // Refresh asks again
  await click(doc.getElementById('matchi_net_refresh')); assert.strictEqual(calls.length, 7);
  // an error is shown, and a password in the message is hidden
  failNext = new Error('router said ppp_passwd=abc123 not ok');
  await click(doc.getElementById('matchi_net_refresh'));
  t = bodyText(); assert(/Could not read the router/.test(t) && !t.includes('abc123') && /\[hidden\]/.test(t), 'error view: ' + t);
  assert(/Read failed/.test(doc.getElementById('matchi_net_status').textContent));
  assert.strictEqual(doc.getElementById('matchi_net_refresh').disabled, false, 'Refresh is usable again after a failure');
  // a read that fails on a tab with no cache does not leave stale data behind
  await click(doc.getElementById('matchi_net_refresh')); assert(/Connected/.test(bodyText()));

  // ---- Phase 2: mobile data off / on ----
  await click(tabBtn('data'));
  const dbtn = () => doc.getElementById('matchi_net_data_btn');
  assert.strictEqual(dbtn().textContent, 'Turn mobile data off'); assert.strictEqual(dbtn().disabled, false);
  confirmAnswer = false; await click(dbtn());                       // declined: nothing is sent
  assert.strictEqual(confirms.length, 1); assert(/Internet through the SIM stops/.test(confirms[0].msg) && confirms[0].danger === true); assert.strictEqual(sets.length, 0);
  confirmAnswer = true; await click(dbtn());                        // confirmed: sent once, re-read, reported only after the re-read
  assert.strictEqual(sets.length, 1); assert.deepStrictEqual(sets[0].params, { goformId: 'DISCONNECT_NETWORK', notCallback: 'true' }); assert.strictEqual(sets[0].allowEmpty, true);
  assert(/Mobile data is off \(ppp_disconnected\)/.test(bodyText()) && /Disconnected/.test(bodyText()), 'after off: ' + bodyText());
  assert.strictEqual(dbtn().textContent, 'Turn mobile data on'); assert.strictEqual(doc.getElementById('matchi_net_refresh').disabled, false);
  await click(dbtn());
  assert.strictEqual(sets.length, 2); assert.deepStrictEqual(sets[1].params, { goformId: 'CONNECT_NETWORK', notCallback: 'true' });
  assert(/Mobile data is on \(ipv4_ipv6_connected\)/.test(bodyText()), 'after on: ' + bodyText());
  // the router refuses (old sign-in): the message is shown, nothing is claimed
  setFail = new Error('Session too old for root commands'); await click(dbtn());
  assert(/Not sent: Session too old/.test(bodyText()) && !/Mobile data is o/.test(bodyText()), 'refused: ' + bodyText());
  assert.strictEqual(dbtn().disabled, false, 'button usable again after a refusal');
  // the router says success but ppp_status never changes: after 30 s the real value is shown, not success
  stuck = true; const realNow = Date.now; let fake = realNow(); Date.now = () => (fake += 5000);
  await click(dbtn()); Date.now = realNow; stuck = false;
  assert(/did not reach the wanted state within 30 seconds/.test(bodyText()) && /ipv4_ipv6_connected/.test(bodyText()) && !/Mobile data is o/.test(bodyText()), 'stuck: ' + bodyText());
  // closing the window while a switch is waiting stops the wait quietly
  pppNow = 'ipv4_ipv6_connected';

  // ---- Phase 4: devices ----
  sets.length = 0; confirms.length = 0; pppNow = 'ipv4_ipv6_connected';
  await click(tabBtn('devices')); await click(doc.getElementById('matchi_net_refresh'));
  const btns = (label) => doc.getElementById('matchi_net_body').findAll((n) => n.tag === 'button' && n.textContent === label);
  const rowOf = (name) => doc.getElementById('matchi_net_body').findAll((n) => n.tag === 'tr').find((r) => r.textContent.includes(name));
  assert.strictEqual(btns('Rename').length, 2, 'a Rename button on each row');
  assert(/this device/.test(rowOf('My-Phone').textContent) && !rowOf('My-Phone').findAll((n) => n.textContent === 'Block').length, 'no Block on the row of the device in use: ' + rowOf('My-Phone').textContent);
  assert.strictEqual(btns('Block').length, 1, 'Block only on the other device');
  // rename
  textAnswer = null; await click(rowOf('GL-MT3000').findAll((n) => n.textContent === 'Rename')[0]); assert.strictEqual(sets.length, 0, 'cancelled rename sends nothing');
  textAnswer = 'bad;name'; await click(rowOf('GL-MT3000').findAll((n) => n.textContent === 'Rename')[0]); assert.strictEqual(sets.length, 0); assert(/Use only letters/.test(bodyText()), 'bad name refused: ' + bodyText());
  textAnswer = 'GL Router'; confirmAnswer = false; await click(rowOf('GL-MT3000').findAll((n) => n.textContent === 'Rename')[0]); assert.strictEqual(sets.length, 0, 'declined rename sends nothing');
  confirmAnswer = true; await click(rowOf('GL-MT3000').findAll((n) => n.textContent === 'Rename')[0]);
  assert.strictEqual(sets.length, 1); assert.deepStrictEqual(sets[0].params, { goformId: 'EDIT_HOSTNAME', mac: 'aa:bb:cc:dd:ee:02', hostname: 'GL Router' });
  assert(/Renamed to "GL Router"/.test(bodyText()) && /GL Router/.test(rowOf('GL Router').textContent), 'after rename: ' + bodyText());
  // block (confirm names the MAC), then it shows under Blocked devices with Unblock
  sets.length = 0; confirmAnswer = false; await click(btns('Block')[0]); assert.strictEqual(sets.length, 0, 'declined block sends nothing');
  confirmAnswer = true; confirms.length = 0; await click(btns('Block')[0]);
  assert(/aa:bb:cc:dd:ee:02/.test(confirms[0].msg) && confirms[0].danger === true);
  assert.strictEqual(sets.length, 1); assert.deepStrictEqual(sets[0].params, { goformId: 'setDeviceAccessControlList', AclMode: '2', WhiteMacList: '', BlackMacList: 'aa:bb:cc:dd:ee:02;', WhiteNameList: '', BlackNameList: 'GL Router;' });
  assert(/Blocked aa:bb:cc:dd:ee:02/.test(bodyText()) && /Blocked devices/.test(bodyText()) && btns('Unblock').length === 1, 'after block: ' + bodyText());
  // unblock
  sets.length = 0; await click(btns('Unblock')[0]);
  assert.strictEqual(sets.length, 1); assert.deepStrictEqual(sets[0].params, { goformId: 'setDeviceAccessControlList', AclMode: '2', WhiteMacList: '', BlackMacList: '', WhiteNameList: '', BlackNameList: '' });
  assert(/Unblocked aa:bb:cc:dd:ee:02/.test(bodyText()) && !/Blocked devices/.test(bodyText()) && btns('Unblock').length === 0, 'after unblock: ' + bodyText());
  // refused write (old sign-in): shown, nothing claimed, lists unchanged
  setFail = new Error('Session too old for root commands'); await click(btns('Block')[0]);
  assert(/Not sent: Session too old/.test(bodyText()) && !/Blocked aa/.test(bodyText()) && btns('Unblock').length === 0, 'refused: ' + bodyText());
  // the router says success but the list never changes: after 3 reads the real state is reported, not success
  stuck = true; await click(btns('Block')[0]); stuck = false;
  assert(/does not list this device as blocked/.test(bodyText()) && !/Blocked aa/.test(bodyText()), 'stuck: ' + bodyText());
  stuck = false; black = ''; blackNames = ''; hostOverride = null;
  await click(tabBtn('data'));

  // keyboard: ArrowRight moves to the next tab
  let prevented = false; tabBtn('data').onkeydown({ key: 'ArrowRight', preventDefault() { prevented = true; } }); await flush();
  assert(prevented && doc.getElementById('matchi_net_tab_wifi').attrs['aria-selected'] === 'true');

  // closing releases the Live Status pause exactly once and lets the window close
  assert.strictEqual(busyNow, 1);
  assert.strictEqual(modalOpts.onClose(), true); assert.strictEqual(busyNow, 0); assert.strictEqual(released, 1);
  modalOpts.onClose(); assert.strictEqual(released, 1, 'a second close releases nothing more');

  // opening again starts clean (no cached values, no second pause left over)
  await click(btn); assert.strictEqual(busyNow, 1); assert(/Connected/.test(bodyText()));
  modalOpts.onClose(); assert.strictEqual(busyNow, 0);
  console.log('net tools ui ok: 6 tabs read once each (get only), password never on the page, root read only from its button, close releases the pause');
})().catch((e) => { console.error(e); process.exit(1); });

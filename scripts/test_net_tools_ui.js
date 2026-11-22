#!/usr/bin/env node
// Network window (web-src/net-tools.js): the real file run against a tiny fake DOM and a scripted MatchiRadio, so a typo or a bad
// render path shows up without a router or a browser. Checks: the button, one read per tab (always "get"), what each tab shows, that the
// Wi-Fi password never reaches the page, the root button, the error path, and that closing the window releases the Live Status pause.
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../app/src/main/web-src/net-tools.js'), 'utf8');
const N = require('../app/src/main/web-src/net-core.js');
const cp = require('child_process'), os = require('os');

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
  for (const id of ['matchi_net_tabs', 'matchi_net_refresh', 'matchi_net_body', 'matchi_net_status']) { if (id === 'matchi_net_tabs' && o.title === 'Devices') continue;   /* the Devices-only window has no tabs */ assert(o.content.includes('id="' + id + '"'), 'content lacks #' + id); const n = new Node(id === 'matchi_net_refresh' ? 'button' : 'div'); n.attrs.id = id; m.append(n); }
  assert(!/<script|on\w+=|\$\{/.test(o.content), 'static content only');
  body.append(m); return { el: m };
};
const showModal = () => {};

// ---- scripted radio ---------------------------------------------------------------------------------------------------------
const calls = [], shells = [], sets = [], confirms = []; let aclMissing = false, black = '', blackNames = '', hostOverride = null, me = '192.168.0.10', pppNow = 'ipv4_ipv6_connected', stuck = false, setFail = null, confirmAnswer = true; let busyNow = 0, released = 0, failNext = null;
// The Wi-Fi part of the fake router: the real F50 reply shape (two chips, ChipIndex tells the band, Password in clear text) and the stock calls.
// A save or a band switch makes Wi-Fi "restart" (the next reads fail). The backup file is written by a REAL shell into a temp folder.
const wifiState = { module: '1', chip: 1, ssid: 'HomeNet', auth: 'WPA2PSKWPA3PSK', hidden: '0', max: 10, pw: 'TopSecret-pass-1' }; let wifiDown = 0, stuckWifi = false, failWifiBackup = false, wifiReadErr = null, wifiSendPw = null;
const wifiTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'matchi-ui-wifi-')), wifiFile = path.join(wifiTmp, 'wifi_backup.json');
const wifiAnswer = () => { if (wifiDown > 0) { wifiDown--; throw new Error(wifiReadErr || 'Failed to fetch'); }
  return { WiFiModuleSwitch: wifiState.module, wifi_access_sta_num: '1', ResponseList: [0, 1].map((i) => ({ ChipIndex: i, AccessPointIndex: '0', AccessPointSwitchStatus: wifiState.module === '1' && wifiState.chip === i ? '1' : '0', SSID: wifiState.ssid, ApMaxStationNumber: wifiState.max, AuthMode: wifiState.auth, ApBroadcastDisabled: wifiState.hidden, CountryCode: 'CN', Pmf_switch: true,
    Password: wifiState.auth === 'OPEN' ? '' : wifiState.pw, PasswordShow: wifiState.auth === 'OPEN' ? '' : wifiState.pw })) }; };
const wifiWrite = (q) => {
  if (q.goformId === 'switchWiFiChip') { if (!stuckWifi) { wifiState.module = '1'; wifiState.chip = q.ChipEnum === 'chip1' ? 0 : 1; wifiDown = 2; } }
  else if (q.goformId === 'switchWiFiModule') { if (!stuckWifi) { wifiState.module = q.SwitchOption === '0' ? '0' : '1'; wifiDown = 2; } }
  else if (q.goformId === 'setAccessPointInfo') { wifiSendPw = q.Password === undefined ? null : Buffer.from(q.Password, 'base64').toString(); if (!stuckWifi) { wifiState.ssid = q.SSID; wifiState.auth = q.AuthMode; wifiState.hidden = q.ApBroadcastDisabled; wifiState.max = Number(q.ApMaxStationNumber); if (q.Password !== undefined) wifiState.pw = wifiSendPw; wifiDown = 2; } }
};
const ANSWERS = {
  data: { ppp_status: 'ipv4_ipv6_connected', dial_mode: 'auto_dial', roam_setting_option: 'off', dial_roam_setting_option: '' },
  wifi: null,   // built from wifiState below
  devices: { station_list: [{ mac_addr: 'AA:BB:CC:DD:EE:01', hostname: 'My-Phone', ip_addr: '192.168.0.10' }], lan_station_list: [{ mac_addr: 'AA:BB:CC:DD:EE:02', hostname: 'GL-MT3000', ip_addr: '192.168.0.2' }], wifi_access_sta_num: '1' },
  apn: null,   // built from apnState below
  lan: { lan_ipaddr: '192.168.0.1', lan_netmask: '255.255.255.0', dhcpEnabled: '1', dhcpStart: '192.168.0.2', dhcpEnd: '192.168.0.253', dhcpLease_hour: '24h', mac_address: '02:00:00:00:00:01' },
  mtu: null,   // built from mtuState below
};
// The APN part of the fake router: the real F50 layout (numbered slots, "($)" fields) and the stock APN_PROC_EX behaviour.
const DEFS = 'default($)default($)manual($)*99#($)none($)($)($)IPv4v6($)($)($)($)($)', DITO_S = 'DITO($)internet.dito.ph($)manual($)*99#($)none($)($)($)IPv4v6($)($)($)($)($)';
const apnState = { mode: 'auto', slots: [DEFS].concat(Array(19).fill('')), used: ['DITO', 'internet.dito.ph'], idx: '' }; let apnBreak = false, failOn = null;
const apnAnswer = () => Object.assign({ apn_mode: apnState.mode, apn_interface_version: '', profile_name: apnState.used[0], wan_apn: apnState.used[1], apn_auto_config: DITO_S, index: apnState.idx, Current_index: apnState.idx, ppp_passwd: 'secret-ppp-reply', ppp_username: 'secret-user-reply' },
  Object.fromEntries(apnState.slots.map((t, i) => ['APN_config' + i, t])));
const apnWrite = (q) => {
  if (stuckApn) return;
  const i = Number(q.index);
  if (q.apn_mode === 'auto' && !q.apn_action) { apnState.mode = 'auto'; apnState.used = ['DITO', 'internet.dito.ph']; apnState.idx = ''; }
  else if (q.apn_action === 'save') { apnState.mode = 'manual'; apnState.slots[i] = [q.profile_name, q.wan_apn || q.ipv6_wan_apn, 'manual', '*99#', q.ppp_auth_mode || q.ipv6_ppp_auth_mode, '', '', q.pdp_type, '', '', '', ''].join('($)'); }
  else if (q.apn_action === 'set_default') { const f = apnState.slots[i].split('($)'); apnState.mode = 'manual'; apnState.used = [f[0], f[1]]; apnState.idx = String(i); }
  else if (q.apn_action === 'delete') { apnState.slots.splice(i, 1); apnState.slots.push(''); }   // the real router moves the later profiles up one slot
  if (apnBreak) pppNow = 'ppp_disconnected';
};
let stuckApn = false, sleepSpy = null;
// The MTU part of the fake router: SET_DEVICE_MTU changes the values and the router "restarts" (the next reads fail), the backup file lives in fileText.
const mtuState = { mtu: 1500, mss: 1460, ifMtu: 1500 }; let mtuDown = 0, stuckMtu = false, ignoreMtu = 0, restartOldMtu = false, retryLevels = [], followWan = true, pingOk = true, fileText = '', failBackup = false, mtuReadErr = null;
const mtuAnswer = () => { if (mtuDown > 0) { mtuDown--; throw new Error(mtuReadErr || 'Failed to fetch'); } return { mtu: String(mtuState.mtu), tcp_mss: String(mtuState.mss) }; };
// The LAN part of the fake router: DHCP_SETTING changes pool / lease and the router "restarts" (the next reads fail); the backup file lives in lanFile.
const lanState = { ip: '192.168.0.1', mask: '255.255.255.0', dhcp: '1', start: '192.168.0.2', end: '192.168.0.253', lease: 24 }; let lanDown = 0, stuckLan = false, lanFile = '', failLanBackup = false, lanReadErr = null, pendingFile = '', failPending = false;
const lanAnswer = () => { if (lanDown > 0) { lanDown--; throw new Error(lanReadErr || 'Failed to fetch'); } return { lan_ipaddr: lanState.ip, lan_netmask: lanState.mask, dhcpEnabled: lanState.dhcp, dhcpStart: lanState.start, dhcpEnd: lanState.end, dhcpLease_hour: lanState.lease + 'h', mac_address: '02:00:00:00:00:01' }; };
const rootOut = () => ROOT_OUT.replace('mtu 1500 qdisc', 'mtu ' + mtuState.ifMtu + ' qdisc');
const ROOT_OUT = '##route\n1.1.1.1 dev sipa_eth0 src 100.95.85.97\n##link\n14: sipa_eth0: <NOARP,UP,LOWER_UP> mtu 1500 qdisc x\n##filter\n-A INPUT -p tcp -j TCPMSS --set-mss 1460\n-A INPUT -p tcp -j TCPMSS --set-mss 1460\n##mangle\n##filter6\n##mangle6\n##end\n';
const R = {
  zte: async (op, params) => { calls.push({ op, params }); if (failNext) { const e = failNext; failNext = null; throw e; } const tab = Object.keys(N.READ).find((k) => N.READ[k] === params.cmd);   // ACL / names are single commands, handled below if (tab === 'data') return Object.assign({}, ANSWERS.data, { ppp_status: pppNow });
    if (params.cmd === 'queryDeviceAccessControlList') return aclMissing ? {} : { AclMode: '2', WhiteMacList: '', BlackMacList: black, WhiteNameList: '', BlackNameList: blackNames };
    if (params.cmd === 'hostNameList') { const d = ANSWERS.devices; return { devices: [...d.station_list, ...d.lan_station_list].map((e) => ({ hostname: hostOverride && e.mac_addr === 'AA:BB:CC:DD:EE:02' ? hostOverride : e.hostname, mac: e.mac_addr.toLowerCase() })) }; }
    if (tab === 'data') return Object.assign({}, ANSWERS.data, { ppp_status: pppNow });
    if (tab === 'wifi') return wifiAnswer();
    if (tab === 'apn') return apnAnswer();
    if (tab === 'mtu') return mtuAnswer();
    if (tab === 'lan') return lanAnswer();
    return ANSWERS[tab]; },
  sh: async (cmd) => { shells.push(cmd);
    if (cmd.includes('wifi_backup.json')) { if (failWifiBackup && cmd.includes('mkdir')) throw new Error('read-only file system'); return cp.execFileSync('/bin/sh', ['-c', cmd.split('/data/local/matchitool').join(wifiTmp)], { encoding: 'utf8' }); }
    if (cmd.includes('mtu_backup.json') && cmd.includes("printf '%s' '")) { if (failBackup) throw new Error('read-only file system'); fileText = cmd.split("printf '%s' '")[1].split("' >")[0]; return 'MATCHI_BACKUP_OK\n'; }
    if (cmd.includes('lan_backup.json') && cmd.includes("printf '%s' '")) { if (failLanBackup) throw new Error('read-only file system'); lanFile = cmd.split("printf '%s' '")[1].split("' >")[0]; return 'MATCHI_BACKUP_OK\n'; }
    if (cmd.includes('lan_pending.json') && cmd.includes("printf '%s' '")) { if (failPending) throw new Error('read-only file system'); pendingFile = cmd.split("printf '%s' '")[1].split("' >")[0]; return 'MATCHI_BACKUP_OK\n'; }
    if (cmd === N.LAN_PENDING_READ_SH) return pendingFile;
    if (cmd === N.LAN_PENDING_DELETE_SH) { pendingFile = ''; return 'MATCHI_BACKUP_GONE\n'; }
    if (cmd === N.LAN_BACKUP_READ_SH) return lanFile;
    if (cmd === N.LAN_BACKUP_DELETE_SH) { lanFile = ''; return 'MATCHI_BACKUP_GONE\n'; }
    if (cmd === N.MTU_BACKUP_READ_SH) return fileText;
    if (cmd === N.MTU_BACKUP_DELETE_SH) { fileText = ''; return 'MATCHI_BACKUP_GONE\n'; }
    if (cmd === N.PING_SH) return pingOk ? 'MATCHI_PING_OK\n' : 'MATCHI_PING_FAIL\n';
    return rootOut(); },
  beginBusy: () => { busyNow++; return () => { busyNow--; released++; }; }, isBusy: () => busyNow > 0,
  sleep: async () => { if (sleepSpy) { const e = doc.getElementById('matchi_net_prog'); sleepSpy.push(e ? e.textContent : null); } },
  setRouter: async (params, allowEmpty, level) => { sets.push({ params, allowEmpty, level }); if (setFail) { const e = setFail; setFail = null; throw e; }
    if (params.goformId === 'setDeviceAccessControlList') { if (!stuck) { black = params.BlackMacList; blackNames = params.BlackNameList; } return; }
    if (params.goformId === 'APN_PROC_EX') { if (failOn && params.apn_action === failOn) { failOn = null; throw new Error('Router refused the change (failure)'); } apnWrite(params); return; }
    if (params.goformId === 'SET_DEVICE_MTU') { if (mtuDown > 0) throw new Error('Failed to fetch'); /* a router that is down answers nothing */ retryLevels.push(level || 0); if (ignoreMtu > 0) { ignoreMtu--; return 'empty'; } if (restartOldMtu) { mtuDown = 2; return 'empty'; } if (!stuckMtu) { mtuState.mtu = Number(params.mtu); mtuState.mss = Number(params.tcp_mss); if (followWan) mtuState.ifMtu = mtuState.mtu; mtuDown = 2; } return; }
    if (params.goformId === 'DHCP_SETTING') { if (lanDown > 0) throw new Error('Failed to fetch'); if (!stuckLan) { lanState.ip = params.lanIp; lanState.mask = params.lanNetmask; lanState.start = params.dhcpStart; lanState.end = params.dhcpEnd; lanState.lease = Number(params.dhcpLease); lanState.dhcp = '1'; lanDown = 2; } return; }
    if (params.goformId === 'switchWiFiChip' || params.goformId === 'switchWiFiModule' || params.goformId === 'setAccessPointInfo') { if (wifiDown > 0) throw new Error('Failed to fetch'); wifiWrite(params); return; }
    if (params.goformId === 'EDIT_HOSTNAME') { if (!stuck) hostOverride = params.hostname; return; }
    if (!stuck) pppNow = params.goformId === 'DISCONNECT_NETWORK' ? 'ppp_disconnected' : 'ipv4_ipv6_connected'; },
};
const win = { MatchiRadio: R, MatchiNetCore: N };
const askConfirm = async (msg, ok, danger) => { confirms.push({ msg, ok, danger }); return confirmAnswer; };
const texts = []; let textAnswer = null;
const askText = async (o) => { texts.push(o); return textAnswer; };
const applied = []; let applyFail = null;
// The host's Wi-Fi-off-while-tethered switch (/api/wifiauto): a GET shows the status line, a POST sets the switch (and may be refused).
const waHost = { enabled: false, passwordSaved: true, running: false, status: 'Off' }; const waPosts = []; let waGets = 0, waPostFail = null, waGetFail = null;
const waReply = () => ({ enabled: waHost.enabled, passwordSaved: waHost.passwordSaved, running: waHost.running, status: waHost.enabled ? 'Watching: no USB tethering' : 'Off' });
// The host's per-device speed limits (/api/net/limits, /api/net/limit): saved rows, what the phone reports (active), and the ways a call can go wrong.
const lim = { rows: [], note: '', rootBusy: false, getFail: null, postFail: null, refuse: null, ignore: false }; const limPosts = []; let limGets = 0;
const limReply = () => ({ success: true, lanUp: true, rootBusy: lim.rootBusy, note: lim.note, minKbps: 8, maxKbps: 125000, limits: lim.rows.map((r) => Object.assign({}, r)) });
const limApi = (url, opts) => {
  if (url === '/api/net/limits') { limGets++; if (lim.getFail) throw new Error(lim.getFail); return limReply(); }
  const b = JSON.parse(opts.body); assert.strictEqual(opts.method, 'POST'); limPosts.push(b);
  if (lim.postFail) throw new Error(lim.postFail);
  if (lim.refuse) return { success: false, error: lim.refuse };
  if (!lim.ignore) { lim.rows = lim.rows.filter((r) => r.mac !== b.mac); if (b.down !== null || b.up !== null) lim.rows.push({ mac: b.mac, down: b.down, up: b.up, ip: b.ip, online: true, active: true }); }
  return limReply();
};
const api = async (url, opts) => { if (url === '/api/net/limits' || url === '/api/net/limit') return limApi(url, opts); if (url === '/api/wifiauto') { if (opts && opts.method === 'POST') { if (waPostFail) throw new Error(waPostFail); const b = JSON.parse(opts.body); waPosts.push(b); waHost.enabled = b.enabled; waHost.running = b.enabled; return waReply(); } waGets++; if (waGetFail) throw new Error(waGetFail); return waReply(); } if (url === '/api/net/lan-applied') { if (applyFail) throw new Error(applyFail); applied.push(Object.assign({ method: opts.method }, JSON.parse(opts.body))); return { ok: true }; } assert.strictEqual(url, '/api/net/whoami'); return { ip: '::ffff:' + me }; };
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
  assert(/HomeNet/.test(t) && /5 GHz only/.test(t) && /WPA2-PSK \/ WPA3-PSK/.test(t) && /Chip 0/.test(t) && /Visible/.test(t), 'wifi tab: ' + t);
  assert(!t.includes('TopSecret'), 'the Wi-Fi password is never written as visible text');
  const pwBox = doc.getElementById('matchi_wifi_pass');
  assert(pwBox && pwBox.value === 'TopSecret-pass-1' && pwBox.attrs.type === 'password', 'the password box is pre-filled and masked, like the stock page');
  const dump = JSON.stringify(doc.body, (k, v) => (k === 'parentNode' ? undefined : v));
  assert.strictEqual(dump.split('TopSecret').length - 1, 1, 'the password is in the password box only, no other node or attribute');

  // USB tethering switch: shown with the status the host reports, off by default; turning it on asks first and sends {enabled:true}.
  assert.strictEqual(waGets, 1, 'the Wi-Fi tab reads the switch status once');
  let waBox = doc.getElementById('matchi_wifi_auto');
  assert(waBox && !waBox.checked && !waBox.disabled, 'the switch is there, off, and usable');
  assert(/Turn Wi-Fi off while USB tethering is on/.test(bodyText()) && doc.getElementById('matchi_wifi_auto_status').textContent === 'Off', 'switch label and status line');
  confirmAnswer = false; waBox.checked = true; await click({ onclick: () => waBox.onchange() });
  assert.strictEqual(waPosts.length, 0, 'a declined confirm sends nothing'); assert(!doc.getElementById('matchi_wifi_auto').checked, 'and the box goes back to off');
  confirmAnswer = true; waBox = doc.getElementById('matchi_wifi_auto'); waBox.checked = true; await click({ onclick: () => waBox.onchange() });
  assert.deepStrictEqual(waPosts, [{ enabled: true }]); assert(/Turn Wi-Fi off while USB tethering is on/.test(confirms[confirms.length - 1].msg));
  waBox = doc.getElementById('matchi_wifi_auto');
  assert(waBox.checked && doc.getElementById('matchi_wifi_auto_status').textContent === 'Watching: no USB tethering', 'after saving, the box is on and shows the host status');
  waBox.checked = false; const confirmsBefore = confirms.length; await click({ onclick: () => waBox.onchange() });
  assert.deepStrictEqual(waPosts[1], { enabled: false }); assert.strictEqual(confirms.length, confirmsBefore, 'turning it off asks nothing');
  assert(!doc.getElementById('matchi_wifi_auto').checked && doc.getElementById('matchi_wifi_auto_status').textContent === 'Off');
  waPostFail = 'Sign in again'; waBox = doc.getElementById('matchi_wifi_auto'); waBox.checked = true; await click({ onclick: () => waBox.onchange() });
  assert(/Not saved: Sign in again/.test(bodyText()) && !doc.getElementById('matchi_wifi_auto').checked, 'a refused save says so and leaves the switch as the host has it'); waPostFail = null;
  waGetFail = 'offline'; await click(doc.getElementById('matchi_net_refresh'));
  assert(doc.getElementById('matchi_wifi_auto').disabled && /Could not read the status \(offline\)/.test(doc.getElementById('matchi_wifi_auto_status').textContent), 'an unreadable status disables the box and says why'); waGetFail = null;
  await click(doc.getElementById('matchi_net_refresh'));
  confirms.length = 0;   // the switch's own confirmations are checked above; later checks count from zero

  await click(tabBtn('devices'));
  t = bodyText();
  assert(/2 devices · 1 on Wi-Fi · 1 on cable/.test(t) && /My-Phone/.test(t) && /GL-MT3000/.test(t) && /aa:bb:cc:dd:ee:02/.test(t) && /Cable/.test(t), 'devices tab: ' + t);
  assert.strictEqual(doc.getElementById('matchi_net_body').findAll((n) => n.tag === 'tr').length, 3, 'header + 2 rows');

  await click(tabBtn('apn'));
  t = bodyText(); assert(/APN modeAuto/.test(t) && /DITO · internet\.dito\.ph/.test(t) && /Switch to Auto/.test(t) && !t.includes('secret-'), 'apn tab: ' + t);
  await click(tabBtn('lan'));
  t = bodyText(); assert(/192\.168\.0\.1/.test(t) && /255\.255\.255\.0/.test(t) && /192\.168\.0\.2 - 192\.168\.0\.253/.test(t) && /24 hours/.test(t) && /DHCP serverOn/.test(t), 'lan tab: ' + t);
  await click(tabBtn('mtu'));
  t = bodyText(); assert(/1500/.test(t) && /1460/.test(t) && /Read real values/.test(t) && shells.length === 0, 'mtu tab: ' + t);

  const rootBtn = doc.getElementById('matchi_net_root');       // the root read starts only from this button
  await click(rootBtn);
  assert.strictEqual(shells.length, 1); assert.strictEqual(shells[0], N.ROOT_READ_SH);
  t = bodyText(); assert(/sipa_eth0/.test(t) && /--set-mss 1460/.test(t) && /appear twice/.test(t) && /Read again/.test(t), 'root result: ' + t);

  assert(calls.every((c) => c.op === 'get'), 'only reads were sent');
  assert.strictEqual(sets.length, 0, 'no write so far');
  const nSetsBefore = 0;
  assert.strictEqual(calls.length, 10, 'one read per tab (the Devices tab reads 3 things) plus the two Refresh presses on the Wi-Fi tab above, nothing else (no polling)');

  // switching to a tab already read shows it again without asking the router
  await click(tabBtn('data')); assert.strictEqual(calls.length, 10); assert(/Connected/.test(bodyText()));
  // Refresh asks again
  await click(doc.getElementById('matchi_net_refresh')); assert.strictEqual(calls.length, 11);
  // an error is shown, and a password in the message is hidden
  failNext = new Error('router said ppp_passwd=abc123 not ok');
  await click(doc.getElementById('matchi_net_refresh'));
  t = bodyText(); assert(/Could not read the router/.test(t) && !t.includes('abc123') && /\[hidden\]/.test(t), 'error view: ' + t);
  assert(/Read failed/.test(doc.getElementById('matchi_net_status').textContent));
  assert.strictEqual(doc.getElementById('matchi_net_refresh').disabled, false, 'Refresh is usable again after a failure');
  // a read that fails on a tab with no cache does not leave stale data behind
  await click(doc.getElementById('matchi_net_refresh')); assert(/Connected/.test(bodyText()));

  // ---- Mobile data off / on ----
  await click(tabBtn('data'));
  const dbtn = () => doc.getElementById('matchi_net_data_btn');
  assert.strictEqual(dbtn().textContent, 'Turn mobile data off'); assert.strictEqual(dbtn().disabled, false);
  confirmAnswer = false; await click(dbtn());                       // declined: nothing is sent
  assert.strictEqual(confirms.length, 1); assert(/Internet stops for all devices/.test(confirms[0].msg) && confirms[0].danger === true); assert.strictEqual(sets.length, 0);
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

  // ---- Devices ----
  sets.length = 0; confirms.length = 0; pppNow = 'ipv4_ipv6_connected';
  await click(tabBtn('devices')); await click(doc.getElementById('matchi_net_refresh'));
  const btns = (label) => doc.getElementById('matchi_net_body').findAll((n) => n.tag === 'button' && n.textContent === label);
  const rowOf = (name) => doc.getElementById('matchi_net_body').findAll((n) => n.tag === 'tr').find((r) => r.textContent.includes(name));
  assert.strictEqual(btns('Rename').length, 2, 'a Rename button on each row');
  assert(/this device/.test(rowOf('My-Phone').textContent) && !rowOf('My-Phone').findAll((n) => n.textContent === 'Block').length, 'no Block on the row of the device in use: ' + rowOf('My-Phone').textContent);
  assert.strictEqual(btns('Block').length, 1, 'Block only on the other device');
  // the block list could not be read: Block / Unblock are hidden, never guessed
  aclMissing = true; await click(doc.getElementById('matchi_net_refresh'));
  assert.strictEqual(btns('Block').length, 0, 'no Block when the list was not read'); assert(/Block list unavailable/.test(bodyText()));
  aclMissing = false; await click(doc.getElementById('matchi_net_refresh')); assert.strictEqual(btns('Block').length, 1);
  // rename
  textAnswer = null; await click(rowOf('GL-MT3000').findAll((n) => n.textContent === 'Rename')[0]); assert.strictEqual(sets.length, 0, 'cancelled rename sends nothing');
  textAnswer = 'bad;name'; await click(rowOf('GL-MT3000').findAll((n) => n.textContent === 'Rename')[0]); assert.strictEqual(sets.length, 0); assert(/Allowed: letters/.test(bodyText()), 'bad name refused: ' + bodyText());
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
  // ---- Devices: Limit speed ----
  {
    const GL = 'aa:bb:cc:dd:ee:02', ME = 'aa:bb:cc:dd:ee:01';
    const lbtn = (id) => doc.getElementById(id);
    const rowBtn = (name) => rowOf(name).findAll((n) => n.tag === 'button' && n.textContent === 'Limit')[0];
    const typeIn = (down, up) => { lbtn('matchi_lim_down').value = down; lbtn('matchi_lim_up').value = up; };
    limPosts.length = 0; confirms.length = 0; limGets = 0; lim.rows = []; lim.getFail = null; lim.postFail = null; lim.refuse = null; lim.ignore = false; lim.note = '';
    await click(doc.getElementById('matchi_net_refresh'));
    assert.strictEqual(limGets, 1, 'one limits read per Devices read'); assert.strictEqual(btns('Limit').length, 2, 'Limit speed on both rows (both addresses are in 192.168.0.2 to 254)');
    assert(/Limit/.test(doc.getElementById('matchi_net_body').findAll((n) => n.tag === 'th').map((n) => n.textContent).join(' ')), 'a Limit column');
    // cancel and bad input send nothing
    await click(rowBtn('GL Router')); assert(/Limit speed · GL Router \(192\.168\.0\.2\)/.test(bodyText()), 'form names the device: ' + bodyText());
    assert.strictEqual(lbtn('matchi_lim_down').getAttribute('placeholder'), 'Unlimited');
    // the hint beside each field follows what is typed (KB/s -> Mbps), and no button in the window carries a red / danger class
    assert.strictEqual(lbtn('matchi_lim_down_hint').textContent, 'KB/s · Unlimited', 'empty field hint');
    lbtn('matchi_lim_down').value = '1000'; lbtn('matchi_lim_down').oninput(); assert.strictEqual(lbtn('matchi_lim_down_hint').textContent, 'KB/s ≈ 8 Mbps', 'hint follows typing');
    lbtn('matchi_lim_down').value = 'x1'; lbtn('matchi_lim_down').oninput(); assert.strictEqual(lbtn('matchi_lim_down_hint').textContent, 'KB/s', 'not a number: unit only');
    lbtn('matchi_lim_down').value = ''; lbtn('matchi_lim_down').oninput();
    assert.strictEqual(root.findAll((n) => n.tag === 'button' && /danger/.test(n.className)).length, 0, 'no button in the Network window has a danger class');
    assert.strictEqual(lbtn('matchi_lim_apply').className, '', 'Apply is a plain button');
    await click(lbtn('matchi_lim_cancel')); assert(!/Limit speed · /.test(bodyText()) && limPosts.length === 0, 'cancel closes the form, sends nothing');
    await click(rowBtn('GL Router')); typeIn('5', ''); await click(lbtn('matchi_lim_apply'));
    assert(/Download must be 8 to 125000 KB\/s/.test(lbtn('matchi_lim_err').textContent) && limPosts.length === 0 && confirms.length === 0, 'too small: refused before any confirm');
    typeIn('12.5', ''); await click(lbtn('matchi_lim_apply')); assert(/whole number/.test(lbtn('matchi_lim_err').textContent) && limPosts.length === 0);
    typeIn('', '200000'); await click(lbtn('matchi_lim_apply')); assert(/Upload must be 8 to 125000/.test(lbtn('matchi_lim_err').textContent) && limPosts.length === 0);
    // declined confirm sends nothing and keeps the form
    typeIn('500', '250'); confirmAnswer = false; await click(lbtn('matchi_lim_apply'));
    assert.strictEqual(limPosts.length, 0, 'declined: nothing sent'); assert(/Download 500 KB\/s, Upload 250 KB\/s/.test(confirms[0].msg) && /aa:bb:cc:dd:ee:02/.test(confirms[0].msg) && /IPv4/.test(confirms[0].msg) && !/slows this console/.test(confirms[0].msg), 'confirm names device and limits: ' + confirms[0].msg);
    assert(lbtn('matchi_lim_form'), 'form stays after a decline');
    // apply: the body, the re-read, the column
    confirmAnswer = true; await click(lbtn('matchi_lim_apply'));
    assert.deepStrictEqual(limPosts, [{ mac: GL, ip: '192.168.0.2', down: 500, up: 250 }]);
    assert(/Limit set for aa:bb:cc:dd:ee:02: Download 500 KB\/s, Upload 250 KB\/s\. The phone reports it as active\./.test(bodyText()) && !lbtn('matchi_lim_form'), 'after apply: ' + bodyText());
    assert(/↓ 500 · ↑ 250 KB\/s/.test(rowOf('GL Router').textContent) && /Limit/.test(rowOf('GL Router').textContent) && /No limit/.test(rowOf('My-Phone').textContent) && !/↓/.test(rowOf('My-Phone').textContent), 'row shows the limit the phone reports');
    // the form starts from the saved values; one side only (empty = Unlimited)
    await click(rowBtn('GL Router')); assert.strictEqual(lbtn('matchi_lim_down').value, '500'); assert.strictEqual(lbtn('matchi_lim_up').value, '250');
    limPosts.length = 0; typeIn('300', ''); await click(lbtn('matchi_lim_apply')); assert.deepStrictEqual(limPosts, [{ mac: GL, ip: '192.168.0.2', down: 300, up: null }]);
    assert(/↓ 300 KB\/s · ↑ Unlimited/.test(rowOf('GL Router').textContent), 'one side: ' + rowOf('GL Router').textContent);
    // remove: both empty
    limPosts.length = 0; confirms.length = 0; await click(rowBtn('GL Router')); typeIn('', ''); await click(lbtn('matchi_lim_apply'));
    assert.deepStrictEqual(limPosts, [{ mac: GL, ip: '192.168.0.2', down: null, up: null }]); assert(/Remove the speed limit/.test(confirms[0].msg) && confirms[0].ok === 'Remove limit');
    assert(/Limit removed from aa:bb:cc:dd:ee:02/.test(bodyText()) && !/↓/.test(rowOf('GL Router').textContent) && /No limit/.test(rowOf('GL Router').textContent), 'after remove: ' + bodyText());
    // removing a limit that does not exist sends nothing
    limPosts.length = 0; confirms.length = 0; await click(rowBtn('GL Router')); typeIn('', ''); await click(lbtn('matchi_lim_apply'));
    assert.strictEqual(limPosts.length, 0); assert.strictEqual(confirms.length, 0); assert(/No limit is set/.test(bodyText()));
    // the device in use: warned twice (form + confirm), and the confirm is a danger one
    confirms.length = 0; await click(rowBtn('My-Phone')); assert(/limiting it slows this console down too/.test(bodyText()), 'form warns: ' + bodyText());
    typeIn('1000', '1000'); await click(lbtn('matchi_lim_apply')); assert(/this console slows down too/.test(confirms[0].msg) && confirms[0].danger === true);
    assert.strictEqual(limPosts[limPosts.length - 1].mac, ME);
    limPosts.length = 0; await click(rowBtn('My-Phone')); typeIn('', ''); await click(lbtn('matchi_lim_apply')); assert.strictEqual(limPosts.length, 1, 'own limit removed again');
    // host refuses / call fails / old sign-in: shown, nothing claimed, the column unchanged
    limPosts.length = 0; lim.refuse = 'br0 already has another traffic setup'; await click(rowBtn('GL Router')); typeIn('400', ''); await click(lbtn('matchi_lim_apply'));
    assert(/Not applied: br0 already has another traffic setup/.test(bodyText()) && !/Limit set for/.test(bodyText()) && !/↓ 400/.test(bodyText()), 'refused: ' + bodyText()); assert(lbtn('matchi_lim_form'), 'the form stays open after a failure');
    lim.refuse = null; lim.postFail = 'Session too old for root commands - sign in again'; await click(lbtn('matchi_lim_apply')); assert(/Not applied: Session too old for root commands/.test(bodyText()) && /Refresh/.test(bodyText()));
    lim.postFail = null;
    // the phone says OK but does not hold the limit: not claimed
    lim.ignore = true; await click(lbtn('matchi_lim_apply')); assert(/does not report this limit as active/.test(bodyText()) && !/Limit set for/.test(bodyText()), 'ignored: ' + bodyText());
    lim.ignore = false; await click(lbtn('matchi_lim_cancel'));
    // saved but not on the phone now / host note
    lim.rows = [{ mac: GL, down: 100, up: null, ip: '192.168.0.2', online: true, active: false }]; lim.note = 'br0 already has another traffic setup; limits are not applied'; lim.rootBusy = true;
    await click(doc.getElementById('matchi_net_refresh')); assert(/↓ 100 KB\/s · ↑ Unlimited/.test(rowOf('GL Router').textContent) && /saved, not on the phone now/.test(rowOf('GL Router').textContent) && /limits are not applied/.test(bodyText()), 'inactive: ' + bodyText());
    lim.rows = []; lim.note = ''; lim.rootBusy = false;
    // the limits read fails (old sign-in): the list still shows, the reason is shown, Limit speed is still there
    lim.getFail = 'Session too old for root commands - sign in again'; await click(doc.getElementById('matchi_net_refresh'));
    assert(/Speed limits not read: Session too old/.test(bodyText()) && /My-Phone/.test(bodyText()) && btns('Limit').length === 2, 'limits read failed: ' + bodyText()); lim.getFail = null;
    // a device without a usable address has no button
    await click(doc.getElementById('matchi_net_refresh')); assert.strictEqual(btns('Limit').length, 2);
  }
  // refused write (old sign-in): shown, nothing claimed, lists unchanged
  setFail = new Error('Session too old for root commands'); await click(btns('Block')[0]);
  assert(/Not sent: Session too old/.test(bodyText()) && !/Blocked aa/.test(bodyText()) && btns('Unblock').length === 0, 'refused: ' + bodyText());
  // the router says success but the list never changes: after 3 reads the real state is reported, not success
  stuck = true; await click(btns('Block')[0]); stuck = false;
  assert(/does not list this device as blocked/.test(bodyText()) && !/Blocked aa/.test(bodyText()), 'stuck: ' + bodyText());
  stuck = false; black = ''; blackNames = ''; hostOverride = null;
  await click(tabBtn('data'));

  // ---- APN ----
  sets.length = 0; confirms.length = 0; confirmAnswer = true; pppNow = 'ipv4_ipv6_connected';
  await click(tabBtn('apn')); await click(doc.getElementById('matchi_net_refresh'));
  const ab = (label) => doc.getElementById('matchi_net_body').findAll((n) => n.tag === 'button' && n.textContent === label);
  const apnRow = (name) => doc.getElementById('matchi_net_body').findAll((n) => n.tag === 'tr').find((r) => r.children[0] && r.children[0].textContent === name);
  const setVal = (id, v) => { doc.getElementById(id).value = v; };
  const noSecrets = () => { const all = JSON.stringify(doc.body, (k, v) => (k === 'parentNode' ? undefined : v)); assert(!/secret-ppp|secret-user|secret-form-pw/.test(all), 'no password or login on the page'); };
  t = bodyText();
  assert(/APN modeAuto/.test(t) && /In useDITO · internet\.dito\.ph/.test(t) && /Name.*APN/.test(t) && apnRow('default'), 'apn auto view: ' + t); noSecrets();
  assert.strictEqual(ab('Switch to Auto')[0].disabled, true, 'already Auto');
  assert(ab('Edit').length === 0 && ab('Delete').length === 0 && ab('Add profile').length === 0 && ab('Use').length === 1 && ab('Copy the automatic profile').length === 1, 'Auto mode offers Use and Copy only');
  // Use (switches to Manual): declined = nothing sent, then confirmed
  confirmAnswer = false; await click(ab('Use')[0]); assert.strictEqual(sets.length, 0, 'declined Use sends nothing'); assert(/Manual APN mode/.test(confirms[0].msg) && confirms[0].danger === true, confirms[0].msg);
  confirmAnswer = true; await click(ab('Use')[0]);
  assert.strictEqual(sets.length, 1); assert.deepStrictEqual(sets[0].params, { goformId: 'APN_PROC_EX', apn_mode: 'manual', apn_action: 'set_default', set_default_flag: '1', pdp_type: 'IPv4v6', index: '0' });
  t = bodyText(); assert(/Now using "default"/.test(t) && /Mobile data is connected/.test(t) && /APN modeManual/.test(t), 'after Use: ' + t);
  assert(ab('Add profile').length === 1 && ab('Edit').length === 1 && ab('Delete').length === 0 && ab('Switch to Auto')[0].disabled === false, 'Manual mode: Add and Edit, no Delete of the only profile, Auto enabled');
  // Add: a bad value is refused in the form (nothing sent), a good one is confirmed, sent with the next free slot, and the password is not kept
  sets.length = 0; confirms.length = 0;
  await click(ab('Add profile')[0]); assert(doc.getElementById('matchi_apn_save'), 'the form opens');
  setVal('matchi_apn_name', 'a;b'); setVal('matchi_apn_apn', 'x.y'); await click(doc.getElementById('matchi_apn_save'));
  assert.strictEqual(sets.length, 0); assert(/Profile name: use only/.test(doc.getElementById('matchi_apn_err').textContent), 'form error shown');
  await click(doc.getElementById('matchi_apn_cancel')); assert(!doc.getElementById('matchi_apn_save'), 'cancel closes the form'); assert.strictEqual(sets.length, 0);
  await click(ab('Add profile')[0]); setVal('matchi_apn_name', 'Test'); setVal('matchi_apn_apn', 'test.apn'); setVal('matchi_apn_auth', 'pap'); setVal('matchi_apn_user', 'tester'); setVal('matchi_apn_pass', 'secret-form-pw');
  confirmAnswer = false; await click(doc.getElementById('matchi_apn_save')); assert.strictEqual(sets.length, 0, 'declined Add sends nothing');
  confirmAnswer = true; await click(doc.getElementById('matchi_apn_save'));
  assert(/Add this profile in slot 1/.test(confirms[1].msg) && !confirms[1].msg.includes('secret-form-pw'), 'the confirm never shows the password');
  assert.strictEqual(sets.length, 1); assert.strictEqual(sets[0].params.apn_action, 'save'); assert.strictEqual(sets[0].params.index, '1'); assert.strictEqual(sets[0].params.profile_name, 'Test');
  assert.strictEqual(sets[0].params.ppp_username, 'tester'); assert.strictEqual(sets[0].params.ppp_passwd, 'secret-form-pw', 'the typed password is what is sent');
  t = bodyText(); assert(/Added "Test"/.test(t) && apnRow('Test') && /PAP/.test(apnRow('Test').textContent) && !doc.getElementById('matchi_apn_pass'), 'after Add: ' + t); noSecrets();
  // Edit
  sets.length = 0; await click(apnRow('Test').findAll((n) => n.textContent === 'Edit')[0]);
  assert.strictEqual(doc.getElementById('matchi_apn_name').value, 'Test'); assert.strictEqual(doc.getElementById('matchi_apn_user').value, '', 'the login is never prefilled');
  setVal('matchi_apn_apn', 'test2.apn'); setVal('matchi_apn_auth', 'none'); await click(doc.getElementById('matchi_apn_save'));
  assert.strictEqual(sets.length, 1); assert.strictEqual(sets[0].params.index, '1'); assert.strictEqual(sets[0].params.wan_apn, 'test2.apn'); assert.strictEqual(sets[0].params.ppp_username, '');
  t = bodyText(); assert(/Saved "Test"/.test(t) && /test2\.apn/.test(t), 'after Edit: ' + t);
  // a login profile needs the login typed again
  await click(apnRow('Test').findAll((n) => n.textContent === 'Edit')[0]); setVal('matchi_apn_auth', 'chap'); sets.length = 0; await click(doc.getElementById('matchi_apn_save'));
  assert.strictEqual(sets.length, 0); assert(/User name: 1–64/.test(doc.getElementById('matchi_apn_err').textContent)); await click(doc.getElementById('matchi_apn_cancel'));
  // Use "Test", then Delete "default" (no longer in use) ; the profile in use has no Delete
  sets.length = 0; await click(apnRow('Test').findAll((n) => n.textContent === 'Use')[0]);
  assert.strictEqual(sets[0].params.index, '1'); assert(/Now using "Test"/.test(bodyText()), 'after Use 2: ' + bodyText());
  assert.strictEqual(apnRow('Test').findAll((n) => n.textContent === 'Delete').length, 0, 'no Delete on the profile in use'); assert.strictEqual(apnRow('default').findAll((n) => n.textContent === 'Delete').length, 1);
  sets.length = 0; confirms.length = 0; await click(apnRow('default').findAll((n) => n.textContent === 'Delete')[0]);
  assert(confirms[0].danger === true && /slot 0/.test(confirms[0].msg)); assert.deepStrictEqual(sets[0].params, { goformId: 'APN_PROC_EX', apn_action: 'delete', apn_mode: 'manual', index: '0' });
  t = bodyText(); assert(/Deleted "default"/.test(t) && !apnRow('default'), 'after Delete: ' + t);
  // Switch to Auto
  sets.length = 0; await click(ab('Switch to Auto')[0]); assert.deepStrictEqual(sets[0].params, { goformId: 'APN_PROC_EX', apn_mode: 'auto' });
  t = bodyText(); assert(/APN mode is Auto/.test(t) && /Mobile data is connected/.test(t) && /APN modeAuto/.test(t), 'after Auto: ' + t);
  // Copy the automatic profile: save in the first free slot, then use it; the second step failing switches back to Auto
  sets.length = 0; await click(ab('Copy the automatic profile')[0]);
  assert.strictEqual(doc.getElementById('matchi_apn_name').value, 'DITO'); assert.strictEqual(doc.getElementById('matchi_apn_apn').value, 'internet.dito.ph');
  failOn = 'set_default'; await click(doc.getElementById('matchi_apn_save'));
  assert.deepStrictEqual(sets.map((x) => x.params.apn_action || x.params.apn_mode), ['save', 'set_default', 'auto'], 'save, refused default, then the Auto call');
  t = bodyText(); assert(/Not sent/.test(t) && /switched back to Auto/.test(t) && /APN modeAuto/.test(t), 'rollback: ' + t);
  sets.length = 0; await click(ab('Copy the automatic profile')[0]); await click(doc.getElementById('matchi_apn_save'));
  assert.deepStrictEqual(sets.map((x) => x.params.apn_action), ['save', 'set_default']); assert(/Saved and now using "DITO"/.test(bodyText()), 'copy: ' + bodyText());
  // mobile data does not come back after a change: said plainly, with the way back
  apnBreak = true; sets.length = 0; await click(ab('Switch to Auto')[0]); apnBreak = false;
  t = bodyText(); assert(/APN mode is Auto/.test(t) && /mobile data is not connected \(ppp_disconnected\)/.test(t) && /Switch to Auto/.test(t), 'data down: ' + t); pppNow = 'ipv4_ipv6_connected';
  // the router says success but the list does not change: the real state is reported, not success
  stuckApn = true; sets.length = 0; await click(ab('Use')[0]); stuckApn = false;
  assert(/does not report/.test(bodyText()) && !/Now using/.test(bodyText()), 'stuck: ' + bodyText());
  // refused write (old sign-in)
  setFail = new Error('Session too old for root commands'); await click(ab('Use')[0]); assert(/Not sent: Session too old/.test(bodyText()), 'refused: ' + bodyText());
  noSecrets();
  await click(tabBtn('data'));

  // ---- MTU / MSS ----
  sets.length = 0; confirms.length = 0; shells.length = 0; confirmAnswer = true; pppNow = 'ipv4_ipv6_connected';
  await click(tabBtn('mtu')); await click(doc.getElementById('matchi_net_refresh'));
  const mt = () => doc.getElementById('matchi_net_body').textContent;
  const mb = (id) => doc.getElementById(id);
  assert.strictEqual(shells.length, 0, 'opening the tab runs no root command');
  assert(mb('matchi_mtu_mtu').value === '1500' && mb('matchi_mtu_mss').value === '1460' && mb('matchi_mtu_apply'), 'the form shows the router values');
  // bad input: refused in the form, nothing sent, no root call
  const trySubmit = async (m1, m2) => { mb('matchi_mtu_mtu').value = m1; mb('matchi_mtu_mss').value = m2; await click(mb('matchi_mtu_apply')); };
  for (const [a, b, re] of [['abc', '1460', /MTU must be a whole number/], ['1500', '', /MSS must be a whole number/], ['1200', '1100', /out of range \(1280 to 1500\)/], ['1501', '1460', /out of range \(1280 to 1500\)/], ['1500', '1461', /not be larger than MTU minus 40/], ['1500', '100', /at least 536/]]) {
    await trySubmit(a, b); assert(re.test(mb('matchi_mtu_err').textContent), a + '/' + b + ': ' + mb('matchi_mtu_err').textContent);
  }
  assert.strictEqual(sets.length, 0); assert.strictEqual(shells.length, 0); assert.strictEqual(confirms.length, 0);
  mb('matchi_mtu_mtu').value = '1200'; await click(mb('matchi_mtu_default')); assert(/Fix the MTU first/.test(mb('matchi_mtu_err').textContent) && mb('matchi_mtu_mss').value !== '1160', 'bad MTU: the default button explains');
  mb('matchi_mtu_mtu').value = 'abc'; await click(mb('matchi_mtu_default')); assert(/Type a whole-number MTU first/.test(mb('matchi_mtu_err').textContent));
  // Refresh puts the form back to the router values
  await click(doc.getElementById('matchi_net_refresh')); assert(mb('matchi_mtu_mtu').value === '1500' && mb('matchi_mtu_mss').value === '1460', 'Refresh resets the MTU form');
  mb('matchi_mtu_mtu').value = '1400'; await click(mb('matchi_mtu_default')); assert.strictEqual(mb('matchi_mtu_mss').value, '1360', 'MSS = MTU - 40 button');
  // same values: nothing sent
  await trySubmit('1500', '1460'); assert.strictEqual(sets.length, 0); assert(/already has MTU 1500 and MSS 1460/.test(mt()), mt());
  // declined confirm: nothing sent, no backup written
  confirmAnswer = false; await trySubmit('1500', '1459'); assert.strictEqual(sets.length, 0); assert.strictEqual(shells.length, 0, 'declined: no backup written');
  assert(/MTU 1500 → 1500/.test(confirms[0].msg) && /MSS 1460 → 1459/.test(confirms[0].msg) && /router restarts/i.test(confirms[0].msg) && confirms[0].danger === true, confirms[0].msg);
  // the backup cannot be written: nothing is sent
  confirmAnswer = true; failBackup = true; await trySubmit('1500', '1459'); failBackup = false;
  assert.strictEqual(sets.length, 0); assert(/backup copy of the old values could not be saved/.test(mt()), mt());
  // the real change: backup written first, then the call, then the wait, then the checks
  shells.length = 0; sets.length = 0; calls.length = 0;
  sleepSpy = []; await trySubmit('1500', '1459'); const spied = sleepSpy; sleepSpy = null;
  assert(spied.length >= 2 && spied.every((x) => x), 'a progress banner is on the screen at every wait: ' + JSON.stringify(spied));
  assert(/Router restarting.*Keep this window open/.test(spied[0]) && spied.some((x) => /restarting… \d+ s of up to 3 minutes/.test(x)), 'the banner says what is happening: ' + JSON.stringify(spied));
  assert(!doc.getElementById('matchi_mtu_apply').disabled && !doc.getElementById('matchi_net_prog'), 'the banner is gone when the change is done');
  assert(shells[0].includes('mtu_backup.json') && shells[0].includes('"old":{"mtu":1500,"mss":1460},"new":{"mtu":1500,"mss":1459}'), 'backup first: ' + shells[0]);
  assert.strictEqual(sets.length, 1); assert.deepStrictEqual(sets[0].params, { goformId: 'SET_DEVICE_MTU', mtu: '1500', tcp_mss: '1459' }); assert.strictEqual(sets[0].allowEmpty, true);
  t = mt(); assert(/The router restarted and reports MTU 1500, MSS 1459/.test(t) && /Mobile data is connected/.test(t) && /MTU was not changed, only MSS/.test(t) && /Ping to 1\.1\.1\.1 worked/.test(t) && /Restore/.test(t) && !/FAILED|did NOT/.test(t), 'after change: ' + t);
  assert.strictEqual(mb('matchi_mtu_mss').value, '1459', 'the form now shows the new values'); assert(!/MTU 1500 → ?1500.*stuck/.test(t));
  assert(mtuState.mss === 1459 && fileText.includes('"old":{"mtu":1500,"mss":1460}'));
  // restore: reads the saved copy, confirms, sends the old pair
  sets.length = 0; confirms.length = 0; await click(mb('matchi_mtu_restore'));
  assert(/Put the saved values back/.test(confirms[0].msg) && /MSS 1459 → 1460/.test(confirms[0].msg)); assert.deepStrictEqual(sets[0].params, { goformId: 'SET_DEVICE_MTU', mtu: '1500', tcp_mss: '1460' });
  assert(/reports MTU 1500, MSS 1460/.test(mt()), 'after restore: ' + mt());
  // an MTU change the real interface does not follow is said plainly
  followWan = false; sets.length = 0; await trySubmit('1400', '1360'); followWan = true;
  t = mt(); assert(/did not follow the router setting \(1400\)/.test(t) && /Restore/.test(t), 'no follow: ' + t); mtuState.ifMtu = 1500;
  // an MTU change the interface follows
  await trySubmit('1500', '1460'); sets.length = 0; await trySubmit('1450', '1410');
  assert(/Interface MTU matches the new setting \(1450\)/.test(mt()), 'follow: ' + mt());
  // ping fails: reported as a problem
  pingOk = false; await trySubmit('1500', '1460'); pingOk = true;
  assert(/Ping to 1\.1\.1\.1 failed/.test(mt()), 'ping: ' + mt());
  // the router says success but keeps the old values: the real value is shown, not success
  // (1) the router ignores the command and never restarts (a lost sign-in answers EMPTY and does nothing): the command is sent 3 times, each with a fresh
  // sign-in (levels 0, 1, 2), then it says so at once; it does NOT wait 3 minutes and does NOT say "the router is back"
  stuckMtu = true; sets.length = 0; await trySubmit('1500', '1459'); stuckMtu = false;
  t = mt(); assert(/Router ignored the change after 3 tries/.test(t) && /still has MTU 1500 and MSS 1460/.test(t) && !/The router restarted and reports|is back with different values|didn\'t restart/.test(t), 'ignored: ' + t);
  assert.deepStrictEqual(sets.map((x) => x.level || 0), [0, 1, 2], 'three sends, fresh sign-in on the 2nd and 3rd');
  assert(!doc.getElementById('matchi_net_prog') && !doc.getElementById('matchi_mtu_apply').disabled, 'the window is free again after the refusal');
  // (2) the first send is ignored, the second (fresh sign-in) is taken: the change goes through and the result is real
  ignoreMtu = 1; sets.length = 0; await trySubmit('1500', '1459'); ignoreMtu = 0;
  t = mt(); assert(sets.length === 2 && sets[1].level === 1 && /The router restarted and reports MTU 1500, MSS 1459/.test(t) && !/ignored/.test(t), 'second send took: ' + t + ' / ' + sets.length);
  await trySubmit('1500', '1460');
  // (3) the router restarts but comes back with the OLD values: said plainly, with the real values
  restartOldMtu = true; sets.length = 0; await trySubmit('1500', '1459'); restartOldMtu = false;
  t = mt(); assert(sets.length === 1 && /Router is back with different values: MTU 1500, MSS 1460 \(wanted 1500 \/ 1459\)/.test(t) && !/The router restarted and reports|ignored/.test(t) && !/MTU was not changed, only MSS/.test(t), 'restarted with old values: ' + t);
  // the console asks for a new sign-in after the restart: the wait stops and says so
  mtuReadErr = 'HTTP 401 sign in required'; await trySubmit('1500', '1459'); mtuReadErr = null;
  assert(/Sign in again, then tap Refresh/.test(mt()) && /Restore/.test(mt()), 'auth: ' + mt());
  // refused write (old sign-in): nothing claimed
  mtuDown = 0; setFail = new Error('Session too old for root commands'); sets.length = 0; await trySubmit('1500', '1458');
  assert(/Not sent: Session too old/.test(mt()) && /Nothing was changed/.test(mt()), 'refused: ' + mt());
  // forget the backup
  confirms.length = 0; await click(mb('matchi_mtu_forget')); assert(/Delete the saved MTU\/MSS backup/.test(confirms[0].msg) && /saved copy was deleted/.test(mt()) && fileText === '');
  await click(mb('matchi_mtu_restore')); assert(/No saved values found/.test(mt()), 'restore without backup: ' + mt());
  await click(tabBtn('data'));

  // ---- LAN / DHCP pool and lease ----
  sets.length = 0; confirms.length = 0; shells.length = 0; calls.length = 0; confirmAnswer = true; pppNow = 'ipv4_ipv6_connected';
  await click(tabBtn('lan')); await click(doc.getElementById('matchi_net_refresh'));
  const lb = (id) => doc.getElementById(id), lt = () => bodyText();
  assert(lb('matchi_lan_start').value === '192.168.0.2' && lb('matchi_lan_end').value === '192.168.0.253' && lb('matchi_lan_lease').value === '24' && lb('matchi_lan_apply'), 'the form shows the router values: ' + lt());
  assert(/Mask unchanged/.test(lt()) && shells.length === 0, 'no root command when the tab opens');
  const lanTry = async (a, b, c) => { lb('matchi_lan_start').value = a; lb('matchi_lan_end').value = b; lb('matchi_lan_lease').value = c; await click(lb('matchi_lan_apply')); };
  for (const [a, b, c, re] of [['x', '192.168.0.9', '24', /start is not a valid/], ['192.168.0.2', '192.168.1.9', '24', /outside the router network/], ['192.168.0.1', '192.168.0.9', '24', /must not be inside the pool/],
    ['192.168.0.9', '192.168.0.2', '24', /Pool start must come before/], ['192.168.0.2', '192.168.0.9', '0', /Lease must be whole hours/], ['192.168.0.2', '192.168.0.255', '24', /network or the broadcast/]]) {
    await lanTry(a, b, c); assert(re.test(lb('matchi_lan_err').textContent), a + '/' + b + '/' + c + ': ' + lb('matchi_lan_err').textContent);
    assert.strictEqual(sets.length, 0); assert.strictEqual(confirms.length, 0); assert.strictEqual(shells.length, 0);
  }
  // unchanged values: nothing sent
  await lanTry('192.168.0.2', '192.168.0.253', '24'); assert.strictEqual(sets.length, 0); assert(/already has pool 192\.168\.0\.2 - 192\.168\.0\.253 and lease 24 hours\. Nothing was sent/.test(lt()), lt());
  // declined confirm: nothing sent, no backup
  confirmAnswer = false; await lanTry('192.168.0.10', '192.168.0.200', '12'); assert.strictEqual(sets.length, 0); assert.strictEqual(shells.length, 0, 'declined: no backup');
  assert(/Pool 192\.168\.0\.2 - 192\.168\.0\.253 → 192\.168\.0\.10 - 192\.168\.0\.200/.test(confirms[0].msg) && /Lease 24 hours → 12 hours/.test(confirms[0].msg) && /router restarts/i.test(confirms[0].msg) && /192\.168\.0\.1 and mask 255\.255\.255\.0 stay the same/.test(confirms[0].msg) && confirms[0].danger === true, confirms[0].msg);
  // the backup cannot be written: nothing is sent
  confirmAnswer = true; failLanBackup = true; await lanTry('192.168.0.10', '192.168.0.200', '12'); failLanBackup = false;
  assert.strictEqual(sets.length, 0); assert(/backup copy of the old values could not be saved/.test(lt()) && /Nothing was changed/.test(lt()), lt());
  // the real change
  shells.length = 0; sets.length = 0; calls.length = 0;
  sleepSpy = []; await lanTry('192.168.0.10', '192.168.0.200', '12'); const lspy = sleepSpy; sleepSpy = null;
  assert(lspy.length >= 2 && lspy.every((x) => x) && /Router restarting.*Keep this window open/.test(lspy[0]) && lspy.some((x) => /restarting… \d+ s of up to 3 minutes/.test(x)), 'banner at every wait: ' + JSON.stringify(lspy));
  assert(!lb('matchi_net_prog') && !lb('matchi_lan_apply').disabled, 'the banner is gone when done');
  assert(shells[0].includes('lan_backup.json') && shells[0].includes('"old":{"ip":"192.168.0.1","mask":"255.255.255.0","start":"192.168.0.2","end":"192.168.0.253","lease":24}') && shells[0].includes('"new":{"ip":"192.168.0.1","mask":"255.255.255.0","start":"192.168.0.10","end":"192.168.0.200","lease":12}'), 'backup first: ' + shells[0]);
  assert.strictEqual(sets.length, 1); assert.deepStrictEqual(sets[0].params, { goformId: 'DHCP_SETTING', lanIp: '192.168.0.1', lanNetmask: '255.255.255.0', lanDhcpType: 'SERVER', dhcpStart: '192.168.0.10', dhcpEnd: '192.168.0.200', dhcpLease: '12', dhcp_reboot_flag: '1', mac_ip_reset: '0' }); assert.strictEqual(sets[0].allowEmpty, true);
  t = lt(); assert(/The router restarted and reports pool 192\.168\.0\.10 - 192\.168\.0\.200, lease 12 hours/.test(t) && /Mobile data is connected/.test(t) && /Reconnect any device without internet/.test(t) && /Restore/.test(t), 'result: ' + t);
  assert(!/is back with different values/.test(t) && lb('matchi_lan_start').value === '192.168.0.10' && lb('matchi_lan_lease').value === '12', 'the form now shows the new values');
  assert(lanState.start === '192.168.0.10' && lanFile.includes('"old":{"ip":"192.168.0.1","mask":"255.255.255.0","start":"192.168.0.2"'));
  // a lease-only change keeps the pool exactly
  sets.length = 0; shells.length = 0; await lanTry('192.168.0.10', '192.168.0.200', '48');
  assert.strictEqual(sets.length, 1); assert(sets[0].params.dhcpLease === '48' && sets[0].params.dhcpStart === '192.168.0.10' && sets[0].params.dhcpEnd === '192.168.0.200' && sets[0].params.lanIp === '192.168.0.1', JSON.stringify(sets[0].params));
  // restore: reads the file, confirms, sends the OLD set (saved before the 48 h change: pool .10-.200, lease 12)
  sets.length = 0; confirms.length = 0; await click(lb('matchi_lan_restore'));
  assert(/Put the saved values back/.test(confirms[0].msg) && /Lease 48 hours → 12 hours/.test(confirms[0].msg), confirms[0].msg); assert.deepStrictEqual(sets[0].params.dhcpLease, '12');
  assert(/reports pool 192\.168\.0\.10 - 192\.168\.0\.200, lease 12 hours/.test(lt()), 'after restore: ' + lt());
  // restore refuses when the router IP is not the saved one any more
  lanState.ip = '192.168.5.1'; lanFile = lanFile.replace(/"ip":"192\.168\.0\.1"/, '"ip":"192.168.0.1"'); sets.length = 0; await click(lb('matchi_net_refresh')); await click(lb('matchi_lan_restore'));
  assert.strictEqual(sets.length, 0); assert(/not the saved one any more/.test(lt()), 'restore with another IP: ' + lt()); lanState.ip = '192.168.0.1'; await click(lb('matchi_net_refresh'));
  // the router comes back with other values: said plainly
  stuckLan = true; sets.length = 0; await lanTry('192.168.0.20', '192.168.0.100', '6'); stuckLan = false;
  t = lt(); assert(/Router ignored the change after 3 tries/.test(t) && !/The router restarted and reports|is back with different values/.test(t), 'ignored: ' + t); assert.deepStrictEqual(sets.map((x) => x.level || 0), [0, 1, 2], 'DHCP: three sends, fresh sign-in on the 2nd and 3rd');
  // the console asks for a new sign-in after the restart: the wait stops and says so
  lanReadErr = 'HTTP 401 sign in required'; await lanTry('192.168.0.30', '192.168.0.100', '6'); lanReadErr = null;
  assert(/Sign in again, then tap Refresh/.test(lt()) && /Restore/.test(lt()), 'auth: ' + lt());
  // refused write (old sign-in): nothing claimed
  lanDown = 0; setFail = new Error('Session too old for root commands'); sets.length = 0; await lanTry('192.168.0.40', '192.168.0.100', '6');
  assert(/Not sent: Session too old/.test(lt()) && /Nothing was changed/.test(lt()), 'refused: ' + lt());
  // ---- Router IP change ----
  const ipb = () => lb('matchi_lan_ip_apply'), ipTry = async (v) => { lb('matchi_lan_ip').value = v; await click(ipb()); };
  lanState.start = '192.168.0.10'; lanState.end = '192.168.0.200'; lanState.lease = 12; await click(lb('matchi_net_refresh'));   // known starting point (the tests above left other values)
  sets.length = 0; confirms.length = 0; shells.length = 0; applied.length = 0; confirmAnswer = true;
  assert(lb('matchi_lan_ip') && ipb() && /Change router IP address/.test(lt()) && shells.length === 0, '6b form: ' + lt());
  for (const [v, re] of [['x', /not a valid IPv4/], ['8.8.8.8', /must be private/], ['192.168.0.1', /matches the current/], ['192.168.0.255', /network or broadcast/], ['192.168.0.100', /inside the pool/]]) {
    await ipTry(v); assert(re.test(lb('matchi_lan_ip_err').textContent), v + ': ' + lb('matchi_lan_ip_err').textContent);
    assert.strictEqual(sets.length, 0); assert.strictEqual(confirms.length, 0); assert.strictEqual(shells.length, 0); assert.strictEqual(applied.length, 0);
  }
  // declined: nothing sent, nothing written; the confirm names the old and new IP, the new pool, the new console address and the restart
  confirmAnswer = false; await ipTry('192.168.1.1'); assert.strictEqual(sets.length, 0); assert.strictEqual(shells.length, 0, 'declined: no backup, no note'); assert.strictEqual(applied.length, 0);
  assert(/Router IP 192\.168\.0\.1 → 192\.168\.1\.1/.test(confirms[0].msg) && /Pool 192\.168\.0\.10 - 192\.168\.0\.200 → 192\.168\.1\.10 - 192\.168\.1\.200/.test(confirms[0].msg) && /old address 192\.168\.0\.1 stops working/.test(confirms[0].msg)
    && /The console moves to http:\/\/192\.168\.1\.1/.test(confirms[0].msg) && /router restarts/i.test(confirms[0].msg) && /restores them if the router comes up with different values/.test(confirms[0].msg) && confirms[0].danger === true, confirms[0].msg);
  // the pending note cannot be written: nothing is sent
  confirmAnswer = true; failPending = true; await ipTry('192.168.1.1'); failPending = false;
  assert.strictEqual(sets.length, 0); assert.strictEqual(applied.length, 0); assert(/could not be saved/.test(lt()) && /Nothing was changed/.test(lt()), lt());
  // the real change: backup, then the pending note, then the call, then the host is told the new address
  shells.length = 0; sets.length = 0; applied.length = 0; sleepSpy = []; await ipTry('192.168.1.1'); const ispy = sleepSpy; sleepSpy = null;
  assert(/Router restarting.*console is then at http:\/\/192\.168\.1\.1/.test(ispy[0]), 'banner names the new console address: ' + ispy[0]);
  assert(shells[0].includes('lan_backup.json') && shells[0].includes('"old":{"ip":"192.168.0.1"') && shells[0].includes('"new":{"ip":"192.168.1.1"'), shells[0]);
  const pend = shells.find((c) => c.includes('lan_pending.json') && c.includes("printf '%s' '"));
  assert(pend && pend.includes('"new":{"ip":"192.168.1.1","mask":"255.255.255.0","start":"192.168.1.10","end":"192.168.1.200","lease":12}') && shells.indexOf(pend) > 0, 'pending note after the backup: ' + pend);
  assert.strictEqual(sets.length, 1); assert.deepStrictEqual(sets[0].params, { goformId: 'DHCP_SETTING', lanIp: '192.168.1.1', lanNetmask: '255.255.255.0', lanDhcpType: 'SERVER', dhcpStart: '192.168.1.10', dhcpEnd: '192.168.1.200', dhcpLease: '12', dhcp_reboot_flag: '1', mac_ip_reset: '1' });
  assert.deepStrictEqual(applied, [{ method: 'POST', ip: '192.168.1.1' }]);
  t = lt(); assert(/The router restarted and reports router IP 192\.168\.1\.1, pool 192\.168\.1\.10 - 192\.168\.1\.200, lease 12 hours/.test(t) && /The console is at http:\/\/192\.168\.1\.1\./.test(t) && /Mobile data is connected/.test(t), 'ip result: ' + t);
  assert.strictEqual(pendingFile, '', 'the pending note is deleted once the router is verified'); assert(lanFile.includes('"old":{"ip":"192.168.0.1"') && lanFile.includes('"new":{"ip":"192.168.1.1"'), 'the backup keeps the old and the new values');
  assert.strictEqual(lanState.ip, '192.168.1.1');
  // restore from the NEW address: the old IP, pool and lease go back; the backup of the original values is not overwritten; the host is told the old address
  shells.length = 0; sets.length = 0; confirms.length = 0; applied.length = 0; const bkBefore = lanFile; await click(lb('matchi_lan_restore'));
  assert(/Router IP 192\.168\.1\.1 → 192\.168\.0\.1/.test(confirms[0].msg) && /stops working\. The console moves to http:\/\/192\.168\.0\.1/.test(confirms[0].msg), confirms[0].msg);
  assert.strictEqual(sets.length, 1); assert.deepStrictEqual(sets[0].params, { goformId: 'DHCP_SETTING', lanIp: '192.168.0.1', lanNetmask: '255.255.255.0', lanDhcpType: 'SERVER', dhcpStart: '192.168.0.10', dhcpEnd: '192.168.0.200', dhcpLease: '12', dhcp_reboot_flag: '1', mac_ip_reset: '1' });
  assert(!shells.some((c) => c.includes('lan_backup.json') && c.includes("printf '%s' '")) && lanFile === bkBefore, 'restore keeps the original backup'); assert.deepStrictEqual(applied, [{ method: 'POST', ip: '192.168.0.1' }]);
  assert(/reports router IP 192\.168\.0\.1, pool 192\.168\.0\.10 - 192\.168\.0\.200/.test(lt()) && pendingFile === '' && lanState.ip === '192.168.0.1', 'after the restore: ' + lt());
  // the router ignores the change (never restarts): said plainly, the pending note is removed, no claim of success
  stuckLan = true; shells.length = 0; sets.length = 0; applied.length = 0; await ipTry('192.168.1.1'); stuckLan = false;
  t = lt(); assert(/Router ignored the change after 3 tries/.test(t) && !/The router restarted and reports|is back with different values/.test(t) && applied.length === 0, 'ignored ip: ' + t + ' / applied ' + applied.length);
  assert(pendingFile === '', 'the router never took the change (three empty replies, no restart): the pending note is removed: ' + pendingFile);
  // the host cannot be told: the change still goes through and the text says so
  applyFail = 'HTTP 500'; sets.length = 0; await ipTry('192.168.1.1'); applyFail = null; assert(/could not be pointed at the new address automatically/.test(lt()), lt());
  // put the router back for the next tests
  await click(lb('matchi_lan_restore')); assert.strictEqual(lanState.ip, '192.168.0.1', 'state back to the old IP');
  // a refused write (old sign-in) on an IP change: the pending note is removed again, the host is not told
  lanDown = 0; setFail = new Error('Session too old for root commands'); sets.length = 0; applied.length = 0; await ipTry('192.168.1.1');
  assert(/Not sent: Session too old/.test(lt()) && /Nothing was changed/.test(lt()) && applied.length === 0 && pendingFile === '', 'refused ip change: ' + lt());
  // DHCP Off: no pool form and no IP form, only Restore DHCP, which sends the stock call with the pool the router still reports
  lanState.dhcp = '0'; await click(lb('matchi_net_refresh')); assert(!lb('matchi_lan_apply') && !lb('matchi_lan_ip_apply') && lb('matchi_lan_dhcpon') && /DHCP server is Off/.test(lt()), 'dhcp off: ' + lt());
  sets.length = 0; shells.length = 0; confirms.length = 0; confirmAnswer = false; await click(lb('matchi_lan_dhcpon')); assert.strictEqual(sets.length, 0); assert.strictEqual(shells.length, 0);
  assert(/Switch the DHCP server back On/.test(confirms[0].msg) && /Router IP 192\.168\.0\.1 and mask 255\.255\.255\.0 stay the same/.test(confirms[0].msg) && /router restarts/i.test(confirms[0].msg), confirms[0].msg);
  applied.length = 0; confirmAnswer = true; await click(lb('matchi_lan_dhcpon'));
  assert.strictEqual(sets.length, 1); assert.deepStrictEqual(sets[0].params, { goformId: 'DHCP_SETTING', lanIp: '192.168.0.1', lanNetmask: '255.255.255.0', lanDhcpType: 'SERVER', dhcpStart: '192.168.0.10', dhcpEnd: '192.168.0.200', dhcpLease: '12', dhcp_reboot_flag: '1', mac_ip_reset: '0' });
  assert.strictEqual(shells.length, 0, 'Restore DHCP writes no backup and no pending note (the router IP does not change)'); assert.strictEqual(applied.length, 0);
  assert(/reports pool 192\.168\.0\.10 - 192\.168\.0\.200, lease 12 hours, DHCP On/.test(lt()) && lanState.dhcp === '1', 'dhcp back on: ' + lt());
  // a missing value (no IP): no forms, no write
  lanState.ip = ''; await click(lb('matchi_net_refresh')); assert(!lb('matchi_lan_apply') && !lb('matchi_lan_ip_apply') && !lb('matchi_lan_dhcpon') && /Pool and lease unchanged/.test(lt()), 'no ip: ' + lt()); lanState.ip = '192.168.0.1'; await click(lb('matchi_net_refresh'));
  // forget the backup
  confirms.length = 0; await click(lb('matchi_lan_forget')); assert(/Delete the saved LAN\/DHCP backup/.test(confirms[0].msg) && /saved copy was deleted/.test(lt()) && lanFile === '');
  await click(lb('matchi_lan_restore')); assert(/No saved values found/.test(lt()), 'restore without backup: ' + lt());
  // one change at a time: the MTU form cannot start while a LAN change runs (flags checked in the source guard); the data tab still works after
  await click(tabBtn('data'));

  // ---- Wi-Fi band and settings ----
  sets.length = 0; confirms.length = 0; shells.length = 0; calls.length = 0; confirmAnswer = true; wifiDown = 0; wifiReadErr = null; stuckWifi = false;
  await click(tabBtn('wifi')); await click(doc.getElementById('matchi_net_refresh'));
  const wb = (id) => doc.getElementById(id), wt = () => bodyText();
  const b64 = (x) => Buffer.from(x).toString('base64');
  assert(wb('matchi_wifi_ssid').value === 'HomeNet' && wb('matchi_wifi_max').value === '10' && wb('matchi_wifi_visible').checked === true && wb('matchi_wifi_auth').value === 'WPA2PSKWPA3PSK' && wb('matchi_wifi_band').value === '5g', 'the form shows the router values: ' + wt());
  assert.strictEqual(wb('matchi_wifi_pass').value, 'TopSecret-pass-1', 'the password field is pre-filled with the current password, like the stock page'); assert.strictEqual(wb('matchi_wifi_pass').attrs.type, 'password');
  assert.strictEqual(shells.length, 0, 'no root command when the tab opens');
  const wifiTry = async (o) => { const f = Object.assign({ ssid: wifiState.ssid, vis: wifiState.hidden === '0', auth: wifiState.auth, max: String(wifiState.max), pass: '' }, o); wb('matchi_wifi_ssid').value = f.ssid; wb('matchi_wifi_visible').checked = f.vis; wb('matchi_wifi_auth').value = f.auth; wb('matchi_wifi_max').value = f.max; wb('matchi_wifi_pass').value = f.pass; await click(wb('matchi_wifi_apply')); };
  // the show-password box only flips the field type
  wb('matchi_wifi_show').checked = true; wb('matchi_wifi_show').onchange(); assert.strictEqual(wb('matchi_wifi_pass').type, 'text'); wb('matchi_wifi_show').checked = false; wb('matchi_wifi_show').onchange(); assert.strictEqual(wb('matchi_wifi_pass').type, 'password');
  // bad values are refused in the form: nothing read for writing, nothing sent, no confirm, no root command
  for (const [o, re] of [[{ ssid: '' }, /must not be empty/], [{ ssid: 'a'.repeat(33) }, /max 32 bytes/], [{ ssid: ' x' }, /start or end with a space/], [{ pass: 'short' }, /8–63/], [{ pass: 'a'.repeat(64) }, /8–63/], [{ max: '0' }, /Max devices/], [{ max: '11' }, /Max devices/]]) {
    await wifiTry(o); assert(re.test(wb('matchi_wifi_err').textContent), JSON.stringify(o) + ': ' + wb('matchi_wifi_err').textContent);
    assert.strictEqual(sets.length, 0); assert.strictEqual(confirms.length, 0); assert.strictEqual(shells.length, 0);
  }
  // unchanged values: nothing sent
  await wifiTry({}); assert.strictEqual(sets.length, 0); assert.strictEqual(confirms.length, 0); assert(/already has these settings\. Nothing was sent/.test(wt()), wt());
  // the typed password equals the current one: still "nothing to change"
  await wifiTry({ pass: 'TopSecret-pass-1' }); assert.strictEqual(sets.length, 0); assert(/Nothing was sent/.test(wt()));
  // declined confirm: nothing sent, no backup
  confirmAnswer = false; await wifiTry({ max: '7' }); assert.strictEqual(sets.length, 0); assert.strictEqual(shells.length, 0, 'declined: no backup');
  assert(/Max devices: 10 → 7/.test(confirms[0].msg) && /Wi-Fi restarts/.test(confirms[0].msg) && /All devices disconnect/.test(confirms[0].msg) && confirms[0].danger === true && !/Password/.test(confirms[0].msg), confirms[0].msg);
  // the backup cannot be written: nothing is sent
  confirmAnswer = true; failWifiBackup = true; await wifiTry({ max: '7' }); failWifiBackup = false;
  assert.strictEqual(sets.length, 0); assert(/backup copy of the old values could not be saved/.test(wt()) && /Nothing was changed/.test(wt()), wt());
  // the real change: max devices 10 -> 7, password kept (read from the router, encoded by net-core.js)
  shells.length = 0; sets.length = 0; calls.length = 0;
  sleepSpy = []; await wifiTry({ max: '7' }); const wspy = sleepSpy; sleepSpy = null;
  assert(wspy.length >= 2 && wspy.every((x) => x) && /Wi-Fi is restarting now.*Keep this window open/.test(wspy[0]) && wspy.some((x) => /Wi-Fi is restarting… \d+ s of up to \d+ s/.test(x)), 'banner at every wait: ' + JSON.stringify(wspy));
  assert(!wb('matchi_net_prog') && !wb('matchi_wifi_apply').disabled, 'the banner is gone when done');
  assert(/wifi_backup\.json/.test(shells[0]) && !/Password/.test(shells[0]), 'backup first, without a password when it is not lost: ' + shells[0].replace(/'/g, '').slice(0, 200));
  assert.strictEqual(sets.length, 1); assert.deepStrictEqual(sets[0].params, { goformId: 'setAccessPointInfo', ChipIndex: '0', AccessPointIndex: '0', SSID: 'HomeNet', ApIsolate: '0', AuthMode: 'WPA2PSKWPA3PSK', ApBroadcastDisabled: '0', ApMaxStationNumber: '7', EncrypType: 'CCMP', Password: b64('TopSecret-pass-1') }); assert.strictEqual(sets[0].allowEmpty, true);
  assert.deepStrictEqual(Object.keys(sets[0].params), ['goformId', 'ChipIndex', 'AccessPointIndex', 'SSID', 'ApIsolate', 'AuthMode', 'ApBroadcastDisabled', 'ApMaxStationNumber', 'EncrypType', 'Password']);
  t = wt(); assert(/The router reports the new settings: "HomeNet", WPA2-PSK \/ WPA3-PSK, visible, max 7 devices\./.test(t) && /Restore/.test(t) && !/does not report/.test(t), 'result: ' + t);
  assert(wb('matchi_wifi_max').value === '7' && wifiState.max === 7, 'the form now shows the new values');
  assert(!fs.readFileSync(wifiFile, 'utf8').includes('Password') && fs.readFileSync(wifiFile, 'utf8').includes('"max":10'), 'the saved copy holds the old max and no password');
  // a name with a space, a hidden SSID and a NEW password: the confirm never names the password; the old one is saved (it would be lost)
  const passEl = wb('matchi_wifi_pass');
  confirms.length = 0; shells.length = 0; sets.length = 0;
  await wifiTry({ ssid: 'Home Net 2', vis: false, pass: 'brand-new-pass-9' });
  assert(/Network name: "HomeNet" → "Home Net 2"/.test(confirms[0].msg) && /SSID broadcast: Visible → Hidden/.test(confirms[0].msg) && /Password: will change/.test(confirms[0].msg) && /Reconnect to the new name and password/.test(confirms[0].msg), confirms[0].msg);
  assert(!confirms[0].msg.includes('brand-new') && !confirms[0].msg.includes('TopSecret'), 'no password in the confirm');
  assert.strictEqual(passEl.value, 'brand-new-pass-9', 'the password box keeps its text while the change runs'); assert.strictEqual(wb('matchi_wifi_pass').value, 'brand-new-pass-9', 'and the rebuilt form shows the password the router reports now');
  assert.deepStrictEqual(sets[0].params, { goformId: 'setAccessPointInfo', ChipIndex: '0', AccessPointIndex: '0', SSID: 'Home Net 2', ApIsolate: '0', AuthMode: 'WPA2PSKWPA3PSK', ApBroadcastDisabled: '1', ApMaxStationNumber: '7', EncrypType: 'CCMP', Password: b64('brand-new-pass-9') });
  assert(JSON.parse(fs.readFileSync(wifiFile, 'utf8')).old.Password === b64('TopSecret-pass-1') && wifiState.pw === 'brand-new-pass-9' && wifiState.hidden === '1', 'the old password is in the saved copy; the router has the new one');
  t = wt(); assert(/The router reports the new settings: "Home Net 2".*hidden, max 7 devices, and the new password\./.test(t), 'result: ' + t);
  assert(!wt().match(/brand-new|TopSecret/) && (JSON.stringify(doc.body, (k, v) => (k === 'parentNode' ? undefined : v)).match(/brand-new|TopSecret/g) || []).length <= 1, 'the password is only in the masked password box, never in text, a message or a confirm');
  // restore: reads the saved copy, confirms, sends the OLD name, visibility and password (the saved one)
  sets.length = 0; confirms.length = 0; await click(wb('matchi_wifi_restore'));
  assert(/Put the saved values back/.test(confirms[0].msg) && /Network name: "Home Net 2" → "HomeNet"/.test(confirms[0].msg) && /Password: will change/.test(confirms[0].msg) && /SSID broadcast: Hidden → Visible/.test(confirms[0].msg), confirms[0].msg);
  assert.deepStrictEqual(sets[0].params, { goformId: 'setAccessPointInfo', ChipIndex: '0', AccessPointIndex: '0', SSID: 'HomeNet', ApIsolate: '0', AuthMode: 'WPA2PSKWPA3PSK', ApBroadcastDisabled: '0', ApMaxStationNumber: '7', EncrypType: 'CCMP', Password: b64('TopSecret-pass-1') });
  assert(/The router reports the new settings: "HomeNet"/.test(wt()) && wifiState.pw === 'TopSecret-pass-1', 'after restore: ' + wt());
  // an open network: no password is sent, EncrypType NONE, the old password is saved first, the confirm warns
  sets.length = 0; confirms.length = 0; shells.length = 0; await wifiTry({ auth: 'OPEN' });
  assert(/Security: WPA2-PSK \/ WPA3-PSK → Open \(no password\)/.test(confirms[0].msg) && /No password\. Anyone in range can join/.test(confirms[0].msg), confirms[0].msg);
  assert.deepStrictEqual(sets[0].params, { goformId: 'setAccessPointInfo', ChipIndex: '0', AccessPointIndex: '0', SSID: 'HomeNet', ApIsolate: '0', AuthMode: 'OPEN', ApBroadcastDisabled: '0', ApMaxStationNumber: '7', EncrypType: 'NONE' });
  assert(JSON.parse(fs.readFileSync(wifiFile, 'utf8')).old.Password === b64('TopSecret-pass-1') && /reports the new settings: "HomeNet", Open \(no password\)/.test(wt()), 'open: ' + wt());
  // from open back to a password mode: without a typed password the form refuses (nothing to keep); with one it is sent
  sets.length = 0; await wifiTry({ auth: 'WPA3PSK' }); assert(/none to keep/.test(wb('matchi_wifi_err').textContent) && sets.length === 0, wb('matchi_wifi_err').textContent);
  await wifiTry({ auth: 'WPA3PSK', pass: 'second-pass-55' }); assert.strictEqual(sets[0].params.AuthMode, 'WPA3PSK'); assert.strictEqual(sets[0].params.Password, b64('second-pass-55')); assert(/reports the new settings: "HomeNet", WPA3-PSK/.test(wt()), wt());
  // restore from that copy puts the OPEN network back (the old state had no password)
  sets.length = 0; await click(wb('matchi_wifi_restore')); assert.strictEqual(sets[0].params.AuthMode, 'OPEN'); assert(!('Password' in sets[0].params)); assert.strictEqual(wifiState.auth, 'OPEN');
  await wifiTry({ auth: 'WPA2PSKWPA3PSK', pass: 'TopSecret-pass-1' }); assert.strictEqual(wifiState.auth, 'WPA2PSKWPA3PSK');
  // the router says OK but keeps the old values: the real values are shown, not success
  stuckWifi = true; sets.length = 0; await wifiTry({ max: '3' }); stuckWifi = false;
  t = wt(); assert(/Router ignored the change after 3 tries/.test(t) && /Wi-Fi was not changed/.test(t) && !/reports the new settings/.test(t), 'ignored: ' + t); assert.deepStrictEqual(sets.map((x) => x.level || 0), [0, 1, 2], 'Wi-Fi settings: three sends, fresh sign-in on the 2nd and 3rd');
  // the console asks for a new sign-in after the restart: the wait stops and says so
  wifiDown = 0; wifiReadErr = 'HTTP 401 sign in required'; await wifiTry({ max: '3' }); wifiReadErr = null; wifiDown = 0;
  assert(/Sign in again, then tap Refresh/.test(wt()) && /Restore/.test(wt()), 'auth: ' + wt());
  // the console never answers again (the page was on Wi-Fi): the message says what to do
  wifiState.max = 7; wifiDown = 0; await click(wb('matchi_net_refresh')); wifiReadErr = 'Failed to fetch'; sets.length = 0;
  { const real = R.setRouter; R.setRouter = async (p, a) => { await real(p, a); wifiDown = 999; }; await wifiTry({ max: '4' }); R.setRouter = real; wifiDown = 0; wifiReadErr = null; }
  assert(/did not answer within about \d+ s\. If you were on Wi-Fi, reconnect to your Wi-Fi and press Refresh/.test(wt()), 'no answer: ' + wt());
  await click(wb('matchi_net_refresh'));
  // refused write (old sign-in): nothing claimed
  wifiDown = 0; setFail = new Error('Session too old for root commands'); sets.length = 0; await wifiTry({ max: '2' });
  assert(/Not sent: Session too old/.test(wt()) && /Nothing was changed/.test(wt()), 'refused: ' + wt());
  // band: the same band sends nothing; a switch confirms (danger), sends the captured call, and the form follows the band that is on
  await click(wb('matchi_net_refresh')); sets.length = 0; confirms.length = 0; shells.length = 0;
  wb('matchi_wifi_band').value = '5g'; await click(wb('matchi_wifi_band_apply')); assert(/already 5 GHz only\. Nothing was sent/.test(wt()) && sets.length === 0 && confirms.length === 0, wt());
  wb('matchi_wifi_band').value = ''; await click(wb('matchi_wifi_band_apply')); assert(/Choose 2\.4 GHz only, 5 GHz only or Off first/.test(wt()) && sets.length === 0);
  confirmAnswer = false; wb('matchi_wifi_band').value = '2g'; await click(wb('matchi_wifi_band_apply')); assert.strictEqual(sets.length, 0, 'declined: nothing sent'); confirmAnswer = true;
  assert(/Switch Wi-Fi to 2\.4 GHz only\?/.test(confirms[0].msg) && /Now: 5 GHz only → 2\.4 GHz only/.test(confirms[0].msg) && /All devices reconnect if name and password are unchanged/.test(confirms[0].msg) && /Way back: choose 5 GHz only/.test(confirms[0].msg) && confirms[0].danger === true, confirms[0].msg);
  sets.length = 0; wb('matchi_wifi_band').value = '2g'; await click(wb('matchi_wifi_band_apply'));
  assert.deepStrictEqual(sets[0].params, { goformId: 'switchWiFiChip', ChipEnum: 'chip1', GuestEnable: '0' }); assert.strictEqual(shells.length, 0, 'a band switch needs no backup file');
  t = wt(); assert(/The router reports Wi-Fi: 2\.4 GHz only\./.test(t) && /Chip 0 \(2\.4 GHz\)/.test(t) && wb('matchi_wifi_band').value === '2g', 'band 2g: ' + t);
  // Off: the strongest warning, then the form is replaced by a note
  confirms.length = 0; sets.length = 0; wb('matchi_wifi_band').value = 'off'; await click(wb('matchi_wifi_band_apply'));
  assert(/Turn Wi-Fi off\?/.test(confirms[0].msg) && /Console works over USB\/Ethernet only/.test(confirms[0].msg) && /Way back: choose 2\.4 GHz only/.test(confirms[0].msg) && confirms[0].danger === true, confirms[0].msg);
  assert.deepStrictEqual(sets[0].params, { goformId: 'switchWiFiModule', SwitchOption: '0' });
  t = wt(); assert(/The router reports Wi-Fi: Off\./.test(t) && /Wi-Fi is Off\. Choose a band above/.test(t) && !wb('matchi_wifi_apply'), 'off: ' + t);
  // from Off to 5 GHz: the captured switchWiFiChip call, chip2
  sets.length = 0; wb('matchi_wifi_band').value = '5g'; await click(wb('matchi_wifi_band_apply'));
  assert.deepStrictEqual(sets[0].params, { goformId: 'switchWiFiChip', ChipEnum: 'chip2', GuestEnable: '0' }); assert(/The router reports Wi-Fi: 5 GHz only\./.test(wt()) && wb('matchi_wifi_apply'), wt());
  // the router answers success but stays on the old band: said plainly
  stuckWifi = true; sets.length = 0; wb('matchi_wifi_band').value = '2g'; await click(wb('matchi_wifi_band_apply')); stuckWifi = false;
  assert(/Router ignored the change after 3 tries/.test(wt()) && /Wi-Fi was not changed/.test(wt()) && !/The router reports Wi-Fi: 2\.4/.test(wt()), 'band ignored: ' + wt());
  // refused band write: nothing claimed
  setFail = new Error('Session too old for root commands'); sets.length = 0; wb('matchi_wifi_band').value = '2g'; await click(wb('matchi_wifi_band_apply')); assert(/Not sent: Session too old/.test(wt()) && /Nothing was changed/.test(wt()), wt());
  // forget the backup
  confirms.length = 0; await click(wb('matchi_wifi_forget')); assert(/Delete the Wi-Fi backup/.test(confirms[0].msg) && /may contain the old Wi-Fi password/.test(confirms[0].msg) && /saved copy was deleted/.test(wt()) && !fs.existsSync(wifiFile), wt());
  await click(wb('matchi_wifi_restore')); assert(/No saved values found/.test(wt()), 'restore without backup: ' + wt());
  assert(!wt().match(/brand-new|TopSecret|second-pass/) && (JSON.stringify(doc.body, (k, v) => (k === 'parentNode' ? undefined : v)).match(/brand-new|TopSecret|second-pass/g) || []).length <= 1, 'the password is only in the masked password box at the end');
  fs.rmSync(wifiTmp, { recursive: true, force: true });
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

  // the Devices tile: its own window (title Devices, no tabs, no Updated line) with the same device table; a normal open afterwards is the Network window again
  assert.strictEqual(typeof win.MatchiDevicesOpen, 'function', 'MatchiDevicesOpen exists');
  win.MatchiDevicesOpen(); await flush();
  assert.strictEqual(modalOpts.title, 'Devices'); assert(!modalOpts.content.includes('matchi_net_tabs'), 'no tabs');
  assert(/2 devices · 1 on Wi-Fi · 1 on cable/.test(bodyText()) && /My-Phone/.test(bodyText()) && /GL-MT3000/.test(bodyText()) && /aa:bb:cc:dd:ee:02/.test(bodyText()), 'devices only: ' + bodyText());
  assert.strictEqual(doc.getElementById('matchi_net_status').textContent, '', 'no Updated line');
  await click(doc.getElementById('matchi_net_refresh')); assert(/My-Phone/.test(bodyText()) && doc.getElementById('matchi_net_status').textContent === '', 'refresh keeps it');
  modalOpts.onClose(); assert.strictEqual(busyNow, 0);
  await click(btn); assert.strictEqual(modalOpts.title, 'Network'); assert(modalOpts.content.includes('matchi_net_tabs'), 'tabs are back'); assert(/Updated/.test(doc.getElementById('matchi_net_status').textContent));
  modalOpts.onClose(); assert.strictEqual(busyNow, 0);
  console.log('net tools ui ok: 6 tabs read once each (get only), password never on the page, Wi-Fi band and settings changes, root read only from its button, close releases the pause');
})().catch((e) => { console.error(e); process.exit(1); });

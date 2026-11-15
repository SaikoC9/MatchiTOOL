#!/usr/bin/env node
// Network window (web-src/net-tools.js), Phase 1: the real file run against a tiny fake DOM and a scripted MatchiRadio, so a typo or a bad
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
  for (const id of ['matchi_net_tabs', 'matchi_net_refresh', 'matchi_net_body', 'matchi_net_status']) { assert(o.content.includes('id="' + id + '"'), 'content lacks #' + id); const n = new Node(id === 'matchi_net_refresh' ? 'button' : 'div'); n.attrs.id = id; m.append(n); }
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
const mtuState = { mtu: 1500, mss: 1460, ifMtu: 1500 }; let mtuDown = 0, stuckMtu = false, followWan = true, pingOk = true, fileText = '', failBackup = false, mtuReadErr = null;
const mtuAnswer = () => { if (mtuDown > 0) { mtuDown--; throw new Error(mtuReadErr || 'Failed to fetch'); } return { mtu: String(mtuState.mtu), tcp_mss: String(mtuState.mss) }; };
// The LAN part of the fake router: DHCP_SETTING changes pool / lease and the router "restarts" (the next reads fail); the backup file lives in lanFile.
const lanState = { ip: '192.168.0.1', mask: '255.255.255.0', dhcp: '1', start: '192.168.0.2', end: '192.168.0.253', lease: 24 }; let lanDown = 0, stuckLan = false, lanFile = '', failLanBackup = false, lanReadErr = null;
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
    if (cmd === N.LAN_BACKUP_READ_SH) return lanFile;
    if (cmd === N.LAN_BACKUP_DELETE_SH) { lanFile = ''; return 'MATCHI_BACKUP_GONE\n'; }
    if (cmd === N.MTU_BACKUP_READ_SH) return fileText;
    if (cmd === N.MTU_BACKUP_DELETE_SH) { fileText = ''; return 'MATCHI_BACKUP_GONE\n'; }
    if (cmd === N.PING_SH) return pingOk ? 'MATCHI_PING_OK\n' : 'MATCHI_PING_FAIL\n';
    return rootOut(); },
  beginBusy: () => { busyNow++; return () => { busyNow--; released++; }; }, isBusy: () => busyNow > 0,
  sleep: async () => { if (sleepSpy) { const e = doc.getElementById('matchi_net_prog'); sleepSpy.push(e ? e.textContent : null); } },
  setRouter: async (params, allowEmpty) => { sets.push({ params, allowEmpty }); if (setFail) { const e = setFail; setFail = null; throw e; }
    if (params.goformId === 'setDeviceAccessControlList') { if (!stuck) { black = params.BlackMacList; blackNames = params.BlackNameList; } return; }
    if (params.goformId === 'APN_PROC_EX') { if (failOn && params.apn_action === failOn) { failOn = null; throw new Error('Router refused the change (failure)'); } apnWrite(params); return; }
    if (params.goformId === 'SET_DEVICE_MTU') { if (!stuckMtu) { mtuState.mtu = Number(params.mtu); mtuState.mss = Number(params.tcp_mss); if (followWan) mtuState.ifMtu = mtuState.mtu; mtuDown = 2; } return; }
    if (params.goformId === 'DHCP_SETTING') { if (!stuckLan) { lanState.ip = params.lanIp; lanState.mask = params.lanNetmask; lanState.start = params.dhcpStart; lanState.end = params.dhcpEnd; lanState.lease = Number(params.dhcpLease); lanDown = 2; } return; }
    if (params.goformId === 'switchWiFiChip' || params.goformId === 'switchWiFiModule' || params.goformId === 'setAccessPointInfo') { wifiWrite(params); return; }
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
  assert(/HomeNet/.test(t) && /5 GHz only/.test(t) && /WPA2-PSK \/ WPA3-PSK/.test(t) && /Chip 0/.test(t) && /Visible/.test(t), 'wifi tab: ' + t);
  assert(!t.includes('TopSecret'), 'the Wi-Fi password must not reach the page');
  assert(!JSON.stringify(doc.body, (k, v) => (k === 'parentNode' ? undefined : v)).includes('TopSecret'), 'nor any attribute of the page');

  await click(tabBtn('devices'));
  t = bodyText();
  assert(/2 devices: 1 on Wi-Fi, 1 on cable/.test(t) && /My-Phone/.test(t) && /GL-MT3000/.test(t) && /aa:bb:cc:dd:ee:02/.test(t) && /Cable/.test(t), 'devices tab: ' + t);
  assert.strictEqual(doc.getElementById('matchi_net_body').findAll((n) => n.tag === 'tr').length, 3, 'header + 2 rows');

  await click(tabBtn('apn'));
  t = bodyText(); assert(/APN modeAuto/.test(t) && /DITO · internet\.dito\.ph/.test(t) && /Switch to Auto/.test(t) && !t.includes('secret-'), 'apn tab: ' + t);
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
  assert.strictEqual(calls.length, 8, 'one read per tab (the Devices tab reads 3 things), nothing else (no polling)');

  // switching to a tab already read shows it again without asking the router
  await click(tabBtn('data')); assert.strictEqual(calls.length, 8); assert(/Connected/.test(bodyText()));
  // Refresh asks again
  await click(doc.getElementById('matchi_net_refresh')); assert.strictEqual(calls.length, 9);
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
  // the block list could not be read: Block / Unblock are hidden, never guessed
  aclMissing = true; await click(doc.getElementById('matchi_net_refresh'));
  assert.strictEqual(btns('Block').length, 0, 'no Block when the list was not read'); assert(/did not report its block list/.test(bodyText()));
  aclMissing = false; await click(doc.getElementById('matchi_net_refresh')); assert.strictEqual(btns('Block').length, 1);
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

  // ---- Phase 5: APN ----
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
  assert.strictEqual(sets.length, 0); assert(/User name: 1 to 64/.test(doc.getElementById('matchi_apn_err').textContent)); await click(doc.getElementById('matchi_apn_cancel'));
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

  // ---- Phase 7: MTU / MSS ----
  sets.length = 0; confirms.length = 0; shells.length = 0; confirmAnswer = true; pppNow = 'ipv4_ipv6_connected';
  await click(tabBtn('mtu')); await click(doc.getElementById('matchi_net_refresh'));
  const mt = () => doc.getElementById('matchi_net_body').textContent;
  const mb = (id) => doc.getElementById(id);
  assert.strictEqual(shells.length, 0, 'opening the tab runs no root command');
  assert(mb('matchi_mtu_mtu').value === '1500' && mb('matchi_mtu_mss').value === '1460' && mb('matchi_mtu_apply'), 'the form shows the router values');
  // bad input: refused in the form, nothing sent, no root call
  const trySubmit = async (m1, m2) => { mb('matchi_mtu_mtu').value = m1; mb('matchi_mtu_mss').value = m2; await click(mb('matchi_mtu_apply')); };
  for (const [a, b, re] of [['abc', '1460', /MTU must be a whole number/], ['1500', '', /MSS must be a whole number/], ['1200', '1100', /between 1280 and 1500/], ['1501', '1460', /between 1280 and 1500/], ['1500', '1461', /not be larger than MTU minus 40/], ['1500', '100', /at least 536/]]) {
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
  assert(/MTU 1500 → 1500/.test(confirms[0].msg) && /MSS 1460 → 1459/.test(confirms[0].msg) && /router restarts/.test(confirms[0].msg) && confirms[0].danger === true, confirms[0].msg);
  // the backup cannot be written: nothing is sent
  confirmAnswer = true; failBackup = true; await trySubmit('1500', '1459'); failBackup = false;
  assert.strictEqual(sets.length, 0); assert(/backup copy of the old values could not be saved/.test(mt()), mt());
  // the real change: backup written first, then the call, then the wait, then the checks
  shells.length = 0; sets.length = 0; calls.length = 0;
  sleepSpy = []; await trySubmit('1500', '1459'); const spied = sleepSpy; sleepSpy = null;
  assert(spied.length >= 3 && spied.every((x) => x), 'a progress banner is on the screen at every wait: ' + JSON.stringify(spied));
  assert(/router is restarting now.*Keep this window open/.test(spied[0]) && spied.some((x) => /restarting… \d+ s of up to 3 minutes/.test(x)), 'the banner says what is happening: ' + JSON.stringify(spied));
  assert(!doc.getElementById('matchi_mtu_apply').disabled && !doc.getElementById('matchi_net_prog'), 'the banner is gone when the change is done');
  assert(shells[0].includes('mtu_backup.json') && shells[0].includes('"old":{"mtu":1500,"mss":1460},"new":{"mtu":1500,"mss":1459}'), 'backup first: ' + shells[0]);
  assert.strictEqual(sets.length, 1); assert.deepStrictEqual(sets[0].params, { goformId: 'SET_DEVICE_MTU', mtu: '1500', tcp_mss: '1459' }); assert.strictEqual(sets[0].allowEmpty, true);
  t = mt(); assert(/The router restarted and reports MTU 1500, MSS 1459/.test(t) && /Mobile data is connected/.test(t) && /MTU was not changed, only MSS/.test(t) && /ping to 1\.1\.1\.1 through the mobile connection worked/.test(t) && /Restore saved values/.test(t) && !/FAILED|did NOT/.test(t), 'after change: ' + t);
  assert.strictEqual(mb('matchi_mtu_mss').value, '1459', 'the form now shows the new values'); assert(!/MTU 1500 → ?1500.*stuck/.test(t));
  assert(mtuState.mss === 1459 && fileText.includes('"old":{"mtu":1500,"mss":1460}'));
  // restore: reads the saved copy, confirms, sends the old pair
  sets.length = 0; confirms.length = 0; await click(mb('matchi_mtu_restore'));
  assert(/Put the saved values back/.test(confirms[0].msg) && /MSS 1459 → 1460/.test(confirms[0].msg)); assert.deepStrictEqual(sets[0].params, { goformId: 'SET_DEVICE_MTU', mtu: '1500', tcp_mss: '1460' });
  assert(/reports MTU 1500, MSS 1460/.test(mt()), 'after restore: ' + mt());
  // an MTU change the real interface does not follow is said plainly
  followWan = false; sets.length = 0; await trySubmit('1400', '1360'); followWan = true;
  t = mt(); assert(/did NOT follow the router setting \(1400\)/.test(t) && /Restore saved values/.test(t), 'no follow: ' + t); mtuState.ifMtu = 1500;
  // an MTU change the interface follows
  await trySubmit('1500', '1460'); sets.length = 0; await trySubmit('1450', '1410');
  assert(/mobile interface MTU is 1450: it follows the new MTU/.test(mt()), 'follow: ' + mt());
  // ping fails: reported as a problem
  pingOk = false; await trySubmit('1500', '1460'); pingOk = true;
  assert(/ping to 1\.1\.1\.1 through the mobile connection FAILED/.test(mt()), 'ping: ' + mt());
  // the router says success but keeps the old values: the real value is shown, not success
  stuckMtu = true; sets.length = 0; await trySubmit('1500', '1459'); stuckMtu = false;
  t = mt(); assert(/is back but reports MTU 1500 and MSS 1460, not the wanted 1500 \/ 1459/.test(t) && !/The router restarted and reports/.test(t), 'stuck: ' + t);
  // the console asks for a new sign-in after the restart: the wait stops and says so
  mtuReadErr = 'HTTP 401 sign in required'; await trySubmit('1500', '1459'); mtuReadErr = null;
  assert(/asking for a new sign-in/.test(mt()) && /Restore saved values/.test(mt()), 'auth: ' + mt());
  // refused write (old sign-in): nothing claimed
  mtuDown = 0; setFail = new Error('Session too old for root commands'); sets.length = 0; await trySubmit('1500', '1458');
  assert(/Not sent: Session too old/.test(mt()) && /Nothing was changed/.test(mt()), 'refused: ' + mt());
  // forget the backup
  confirms.length = 0; await click(mb('matchi_mtu_forget')); assert(/Delete the saved copy/.test(confirms[0].msg) && /saved copy was deleted/.test(mt()) && fileText === '');
  await click(mb('matchi_mtu_restore')); assert(/No saved values found/.test(mt()), 'restore without backup: ' + mt());
  await click(tabBtn('data'));

  // ---- Phase 6a: LAN / DHCP pool and lease ----
  sets.length = 0; confirms.length = 0; shells.length = 0; calls.length = 0; confirmAnswer = true; pppNow = 'ipv4_ipv6_connected';
  await click(tabBtn('lan')); await click(doc.getElementById('matchi_net_refresh'));
  const lb = (id) => doc.getElementById(id), lt = () => bodyText();
  assert(lb('matchi_lan_start').value === '192.168.0.2' && lb('matchi_lan_end').value === '192.168.0.253' && lb('matchi_lan_lease').value === '24' && lb('matchi_lan_apply'), 'the form shows the router values: ' + lt());
  assert(/IP address, the subnet mask and DHCP on \/ off are not changed/.test(lt()) && shells.length === 0, 'no root command when the tab opens');
  const lanTry = async (a, b, c) => { lb('matchi_lan_start').value = a; lb('matchi_lan_end').value = b; lb('matchi_lan_lease').value = c; await click(lb('matchi_lan_apply')); };
  for (const [a, b, c, re] of [['x', '192.168.0.9', '24', /start is not a valid/], ['192.168.0.2', '192.168.1.9', '24', /outside the router network/], ['192.168.0.1', '192.168.0.9', '24', /must not be inside the pool/],
    ['192.168.0.9', '192.168.0.2', '24', /must not be after/], ['192.168.0.2', '192.168.0.9', '0', /whole number of hours/], ['192.168.0.2', '192.168.0.255', '24', /network or the broadcast/]]) {
    await lanTry(a, b, c); assert(re.test(lb('matchi_lan_err').textContent), a + '/' + b + '/' + c + ': ' + lb('matchi_lan_err').textContent);
    assert.strictEqual(sets.length, 0); assert.strictEqual(confirms.length, 0); assert.strictEqual(shells.length, 0);
  }
  // unchanged values: nothing sent
  await lanTry('192.168.0.2', '192.168.0.253', '24'); assert.strictEqual(sets.length, 0); assert(/already has pool 192\.168\.0\.2 - 192\.168\.0\.253 and lease 24 hours\. Nothing was sent/.test(lt()), lt());
  // declined confirm: nothing sent, no backup
  confirmAnswer = false; await lanTry('192.168.0.10', '192.168.0.200', '12'); assert.strictEqual(sets.length, 0); assert.strictEqual(shells.length, 0, 'declined: no backup');
  assert(/Pool 192\.168\.0\.2 - 192\.168\.0\.253 → 192\.168\.0\.10 - 192\.168\.0\.200/.test(confirms[0].msg) && /Lease 24 hours → 12 hours/.test(confirms[0].msg) && /router restarts/.test(confirms[0].msg) && /192\.168\.0\.1 and mask 255\.255\.255\.0 stay the same/.test(confirms[0].msg) && confirms[0].danger === true, confirms[0].msg);
  // the backup cannot be written: nothing is sent
  confirmAnswer = true; failLanBackup = true; await lanTry('192.168.0.10', '192.168.0.200', '12'); failLanBackup = false;
  assert.strictEqual(sets.length, 0); assert(/backup copy of the old values could not be saved/.test(lt()) && /Nothing was changed/.test(lt()), lt());
  // the real change
  shells.length = 0; sets.length = 0; calls.length = 0;
  sleepSpy = []; await lanTry('192.168.0.10', '192.168.0.200', '12'); const lspy = sleepSpy; sleepSpy = null;
  assert(lspy.length >= 3 && lspy.every((x) => x) && /router is restarting now.*Keep this window open/.test(lspy[0]) && lspy.some((x) => /restarting… \d+ s of up to 3 minutes/.test(x)), 'banner at every wait: ' + JSON.stringify(lspy));
  assert(!lb('matchi_net_prog') && !lb('matchi_lan_apply').disabled, 'the banner is gone when done');
  assert(shells[0].includes('lan_backup.json') && shells[0].includes('"old":{"ip":"192.168.0.1","mask":"255.255.255.0","start":"192.168.0.2","end":"192.168.0.253","lease":24}') && shells[0].includes('"new":{"ip":"192.168.0.1","mask":"255.255.255.0","start":"192.168.0.10","end":"192.168.0.200","lease":12}'), 'backup first: ' + shells[0]);
  assert.strictEqual(sets.length, 1); assert.deepStrictEqual(sets[0].params, { goformId: 'DHCP_SETTING', lanIp: '192.168.0.1', lanNetmask: '255.255.255.0', lanDhcpType: 'SERVER', dhcpStart: '192.168.0.10', dhcpEnd: '192.168.0.200', dhcpLease: '12', dhcp_reboot_flag: '1', mac_ip_reset: '0' }); assert.strictEqual(sets[0].allowEmpty, true);
  t = lt(); assert(/The router restarted and reports pool 192\.168\.0\.10 - 192\.168\.0\.200, lease 12 hours/.test(t) && /Mobile data is connected/.test(t) && /Devices renew their address/.test(t) && /Restore saved values/.test(t), 'result: ' + t);
  assert(!/is back but reports/.test(t) && lb('matchi_lan_start').value === '192.168.0.10' && lb('matchi_lan_lease').value === '12', 'the form now shows the new values');
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
  t = lt(); assert(/is back but reports pool 192\.168\.0\.10 - 192\.168\.0\.200, lease 12 hours/.test(t) && !/The router restarted and reports/.test(t) && /Restore saved values/.test(t), 'stuck: ' + t);
  // the console asks for a new sign-in after the restart: the wait stops and says so
  lanReadErr = 'HTTP 401 sign in required'; await lanTry('192.168.0.30', '192.168.0.100', '6'); lanReadErr = null;
  assert(/asking for a new sign-in/.test(lt()) && /Restore saved values/.test(lt()), 'auth: ' + lt());
  // refused write (old sign-in): nothing claimed
  lanDown = 0; setFail = new Error('Session too old for root commands'); sets.length = 0; await lanTry('192.168.0.40', '192.168.0.100', '6');
  assert(/Not sent: Session too old/.test(lt()) && /Nothing was changed/.test(lt()), 'refused: ' + lt());
  // DHCP Off or a missing value: no form, no write
  lanState.dhcp = '0'; await click(lb('matchi_net_refresh')); assert(!lb('matchi_lan_apply') && /DHCP server is not changed|not changed here: the router must report/.test(lt()), 'dhcp off: ' + lt()); lanState.dhcp = '1'; await click(lb('matchi_net_refresh'));
  // forget the backup
  confirms.length = 0; await click(lb('matchi_lan_forget')); assert(/Delete the saved copy of the old LAN/.test(confirms[0].msg) && /saved copy was deleted/.test(lt()) && lanFile === '');
  await click(lb('matchi_lan_restore')); assert(/No saved values found/.test(lt()), 'restore without backup: ' + lt());
  // one change at a time: the MTU form cannot start while a LAN change runs (flags checked in the source guard); the data tab still works after
  await click(tabBtn('data'));

  // ---- Phase 3: Wi-Fi band and settings ----
  sets.length = 0; confirms.length = 0; shells.length = 0; calls.length = 0; confirmAnswer = true; wifiDown = 0; wifiReadErr = null; stuckWifi = false;
  await click(tabBtn('wifi')); await click(doc.getElementById('matchi_net_refresh'));
  const wb = (id) => doc.getElementById(id), wt = () => bodyText();
  const b64 = (x) => Buffer.from(x).toString('base64');
  assert(wb('matchi_wifi_ssid').value === 'HomeNet' && wb('matchi_wifi_max').value === '10' && wb('matchi_wifi_visible').checked === true && wb('matchi_wifi_auth').value === 'WPA2PSKWPA3PSK' && wb('matchi_wifi_band').value === '5g', 'the form shows the router values: ' + wt());
  assert.strictEqual(wb('matchi_wifi_pass').value || '', '', 'the password field starts empty'); assert.strictEqual(wb('matchi_wifi_pass').attrs.type, 'password');
  assert.strictEqual(shells.length, 0, 'no root command when the tab opens');
  const wifiTry = async (o) => { const f = Object.assign({ ssid: wifiState.ssid, vis: wifiState.hidden === '0', auth: wifiState.auth, max: String(wifiState.max), pass: '' }, o); wb('matchi_wifi_ssid').value = f.ssid; wb('matchi_wifi_visible').checked = f.vis; wb('matchi_wifi_auth').value = f.auth; wb('matchi_wifi_max').value = f.max; wb('matchi_wifi_pass').value = f.pass; await click(wb('matchi_wifi_apply')); };
  // the show-password box only flips the field type
  wb('matchi_wifi_show').checked = true; wb('matchi_wifi_show').onchange(); assert.strictEqual(wb('matchi_wifi_pass').type, 'text'); wb('matchi_wifi_show').checked = false; wb('matchi_wifi_show').onchange(); assert.strictEqual(wb('matchi_wifi_pass').type, 'password');
  // bad values are refused in the form: nothing read for writing, nothing sent, no confirm, no root command
  for (const [o, re] of [[{ ssid: '' }, /must not be empty/], [{ ssid: 'a'.repeat(33) }, /at most 32 bytes/], [{ ssid: ' x' }, /start or end with a space/], [{ pass: 'short' }, /8 to 63/], [{ pass: 'a'.repeat(64) }, /8 to 63/], [{ max: '0' }, /Max devices/], [{ max: '11' }, /Max devices/]]) {
    await wifiTry(o); assert(re.test(wb('matchi_wifi_err').textContent), JSON.stringify(o) + ': ' + wb('matchi_wifi_err').textContent);
    assert.strictEqual(sets.length, 0); assert.strictEqual(confirms.length, 0); assert.strictEqual(shells.length, 0);
  }
  // unchanged values: nothing sent
  await wifiTry({}); assert.strictEqual(sets.length, 0); assert.strictEqual(confirms.length, 0); assert(/already has these settings\. Nothing was sent/.test(wt()), wt());
  // the typed password equals the current one: still "nothing to change"
  await wifiTry({ pass: 'TopSecret-pass-1' }); assert.strictEqual(sets.length, 0); assert(/Nothing was sent/.test(wt()));
  // declined confirm: nothing sent, no backup
  confirmAnswer = false; await wifiTry({ max: '7' }); assert.strictEqual(sets.length, 0); assert.strictEqual(shells.length, 0, 'declined: no backup');
  assert(/Max devices: 10 → 7/.test(confirms[0].msg) && /Wi-Fi restarts/.test(confirms[0].msg) && /including the one you are using/.test(confirms[0].msg) && confirms[0].danger === true && !/Password/.test(confirms[0].msg), confirms[0].msg);
  // the backup cannot be written: nothing is sent
  confirmAnswer = true; failWifiBackup = true; await wifiTry({ max: '7' }); failWifiBackup = false;
  assert.strictEqual(sets.length, 0); assert(/backup copy of the old values could not be saved/.test(wt()) && /Nothing was changed/.test(wt()), wt());
  // the real change: max devices 10 -> 7, password kept (read from the router, encoded by net-core.js)
  shells.length = 0; sets.length = 0; calls.length = 0;
  sleepSpy = []; await wifiTry({ max: '7' }); const wspy = sleepSpy; sleepSpy = null;
  assert(wspy.length >= 3 && wspy.every((x) => x) && /Wi-Fi is restarting now.*Keep this window open/.test(wspy[0]) && wspy.some((x) => /Wi-Fi is restarting… \d+ s of up to \d+ s/.test(x)), 'banner at every wait: ' + JSON.stringify(wspy));
  assert(!wb('matchi_net_prog') && !wb('matchi_wifi_apply').disabled, 'the banner is gone when done');
  assert(/wifi_backup\.json/.test(shells[0]) && !/Password/.test(shells[0]), 'backup first, without a password when it is not lost: ' + shells[0].replace(/'/g, '').slice(0, 200));
  assert.strictEqual(sets.length, 1); assert.deepStrictEqual(sets[0].params, { goformId: 'setAccessPointInfo', ChipIndex: '0', AccessPointIndex: '0', SSID: 'HomeNet', ApIsolate: '0', AuthMode: 'WPA2PSKWPA3PSK', ApBroadcastDisabled: '0', ApMaxStationNumber: '7', EncrypType: 'CCMP', Password: b64('TopSecret-pass-1') }); assert.strictEqual(sets[0].allowEmpty, true);
  assert.deepStrictEqual(Object.keys(sets[0].params), ['goformId', 'ChipIndex', 'AccessPointIndex', 'SSID', 'ApIsolate', 'AuthMode', 'ApBroadcastDisabled', 'ApMaxStationNumber', 'EncrypType', 'Password']);
  t = wt(); assert(/The router reports the new settings: "HomeNet", WPA2-PSK \/ WPA3-PSK, visible, max 7 devices\./.test(t) && /Restore saved values/.test(t) && !/does not report/.test(t), 'result: ' + t);
  assert(wb('matchi_wifi_max').value === '7' && wifiState.max === 7, 'the form now shows the new values');
  assert(!fs.readFileSync(wifiFile, 'utf8').includes('Password') && fs.readFileSync(wifiFile, 'utf8').includes('"max":10'), 'the saved copy holds the old max and no password');
  // a name with a space, a hidden SSID and a NEW password: the confirm never names the password; the old one is saved (it would be lost)
  const passEl = wb('matchi_wifi_pass');
  confirms.length = 0; shells.length = 0; sets.length = 0;
  await wifiTry({ ssid: 'Home Net 2', vis: false, pass: 'brand-new-pass-9' });
  assert(/Network name: "HomeNet" → "Home Net 2"/.test(confirms[0].msg) && /SSID broadcast: Visible → Hidden/.test(confirms[0].msg) && /Password: will change/.test(confirms[0].msg) && /Reconnect to the new name and password/.test(confirms[0].msg), confirms[0].msg);
  assert(!confirms[0].msg.includes('brand-new') && !confirms[0].msg.includes('TopSecret'), 'no password in the confirm');
  assert.strictEqual(passEl.value, '', 'the typed password field is emptied as soon as it has been used');
  assert.deepStrictEqual(sets[0].params, { goformId: 'setAccessPointInfo', ChipIndex: '0', AccessPointIndex: '0', SSID: 'Home Net 2', ApIsolate: '0', AuthMode: 'WPA2PSKWPA3PSK', ApBroadcastDisabled: '1', ApMaxStationNumber: '7', EncrypType: 'CCMP', Password: b64('brand-new-pass-9') });
  assert(JSON.parse(fs.readFileSync(wifiFile, 'utf8')).old.Password === b64('TopSecret-pass-1') && wifiState.pw === 'brand-new-pass-9' && wifiState.hidden === '1', 'the old password is in the saved copy; the router has the new one');
  t = wt(); assert(/The router reports the new settings: "Home Net 2".*hidden, max 7 devices, and the new password\./.test(t), 'result: ' + t);
  assert(!JSON.stringify(doc.body, (k, v) => (k === 'parentNode' ? undefined : v)).match(/brand-new|TopSecret/), 'no password anywhere on the page, before or after');
  // restore: reads the saved copy, confirms, sends the OLD name, visibility and password (the saved one)
  sets.length = 0; confirms.length = 0; await click(wb('matchi_wifi_restore'));
  assert(/Put the saved values back/.test(confirms[0].msg) && /Network name: "Home Net 2" → "HomeNet"/.test(confirms[0].msg) && /Password: will change/.test(confirms[0].msg) && /SSID broadcast: Hidden → Visible/.test(confirms[0].msg), confirms[0].msg);
  assert.deepStrictEqual(sets[0].params, { goformId: 'setAccessPointInfo', ChipIndex: '0', AccessPointIndex: '0', SSID: 'HomeNet', ApIsolate: '0', AuthMode: 'WPA2PSKWPA3PSK', ApBroadcastDisabled: '0', ApMaxStationNumber: '7', EncrypType: 'CCMP', Password: b64('TopSecret-pass-1') });
  assert(/The router reports the new settings: "HomeNet"/.test(wt()) && wifiState.pw === 'TopSecret-pass-1', 'after restore: ' + wt());
  // an open network: no password is sent, EncrypType NONE, the old password is saved first, the confirm warns
  sets.length = 0; confirms.length = 0; shells.length = 0; await wifiTry({ auth: 'OPEN' });
  assert(/Security: WPA2-PSK \/ WPA3-PSK → Open \(no password\)/.test(confirms[0].msg) && /NO password: anyone in range can join/.test(confirms[0].msg), confirms[0].msg);
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
  t = wt(); assert(/answers but does not report all the wanted settings\. It reports "HomeNet", WPA2-PSK \/ WPA3-PSK, visible, max 7 devices/.test(t) && !/reports the new settings/.test(t) && /Restore saved values/.test(t), 'stuck: ' + t);
  // the console asks for a new sign-in after the restart: the wait stops and says so
  wifiDown = 0; wifiReadErr = 'HTTP 401 sign in required'; await wifiTry({ max: '3' }); wifiReadErr = null; wifiDown = 0;
  assert(/asking for a new sign-in/.test(wt()) && /Restore saved values/.test(wt()), 'auth: ' + wt());
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
  assert(/Switch Wi-Fi to 2\.4 GHz only\?/.test(confirms[0].msg) && /Now: 5 GHz only → 2\.4 GHz only/.test(confirms[0].msg) && /Every device on Wi-Fi is disconnected/.test(confirms[0].msg) && /Way back: choose 5 GHz only/.test(confirms[0].msg) && confirms[0].danger === true, confirms[0].msg);
  sets.length = 0; wb('matchi_wifi_band').value = '2g'; await click(wb('matchi_wifi_band_apply'));
  assert.deepStrictEqual(sets[0].params, { goformId: 'switchWiFiChip', ChipEnum: 'chip1', GuestEnable: '0' }); assert.strictEqual(shells.length, 0, 'a band switch needs no backup file');
  t = wt(); assert(/The router reports Wi-Fi: 2\.4 GHz only\./.test(t) && /Chip 0 \(2\.4 GHz\)/.test(t) && wb('matchi_wifi_band').value === '2g', 'band 2g: ' + t);
  // Off: the strongest warning, then the form is replaced by a note
  confirms.length = 0; sets.length = 0; wb('matchi_wifi_band').value = 'off'; await click(wb('matchi_wifi_band_apply'));
  assert(/Turn Wi-Fi off\?/.test(confirms[0].msg) && /only from a cable \(USB \/ Ethernet\) connection/.test(confirms[0].msg) && /Way back: choose 2\.4 GHz only/.test(confirms[0].msg) && confirms[0].danger === true, confirms[0].msg);
  assert.deepStrictEqual(sets[0].params, { goformId: 'switchWiFiModule', SwitchOption: '0' });
  t = wt(); assert(/The router reports Wi-Fi: Off\./.test(t) && /Wi-Fi is Off\. Choose a band above/.test(t) && !wb('matchi_wifi_apply'), 'off: ' + t);
  // from Off to 5 GHz: the captured switchWiFiChip call, chip2
  sets.length = 0; wb('matchi_wifi_band').value = '5g'; await click(wb('matchi_wifi_band_apply'));
  assert.deepStrictEqual(sets[0].params, { goformId: 'switchWiFiChip', ChipEnum: 'chip2', GuestEnable: '0' }); assert(/The router reports Wi-Fi: 5 GHz only\./.test(wt()) && wb('matchi_wifi_apply'), wt());
  // the router answers success but stays on the old band: said plainly
  stuckWifi = true; sets.length = 0; wb('matchi_wifi_band').value = '2g'; await click(wb('matchi_wifi_band_apply')); stuckWifi = false;
  assert(/answers but reports Wi-Fi: 5 GHz only, not 2\.4 GHz only/.test(wt()) && !/The router reports Wi-Fi: 2\.4/.test(wt()), 'band stuck: ' + wt());
  // refused band write: nothing claimed
  setFail = new Error('Session too old for root commands'); sets.length = 0; wb('matchi_wifi_band').value = '2g'; await click(wb('matchi_wifi_band_apply')); assert(/Not sent: Session too old/.test(wt()) && /Nothing was changed/.test(wt()), wt());
  // forget the backup
  confirms.length = 0; await click(wb('matchi_wifi_forget')); assert(/Delete the saved copy of the old Wi-Fi settings/.test(confirms[0].msg) && /may hold the old Wi-Fi password/.test(confirms[0].msg) && /saved copy was deleted/.test(wt()) && !fs.existsSync(wifiFile), wt());
  await click(wb('matchi_wifi_restore')); assert(/No saved values found/.test(wt()), 'restore without backup: ' + wt());
  assert(!JSON.stringify(doc.body, (k, v) => (k === 'parentNode' ? undefined : v)).match(/brand-new|TopSecret|second-pass/), 'no password on the page at the end');
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
  console.log('net tools ui ok: 6 tabs read once each (get only), password never on the page, Wi-Fi band and settings changes, root read only from its button, close releases the pause');
})().catch((e) => { console.error(e); process.exit(1); });

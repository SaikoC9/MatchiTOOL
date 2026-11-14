#!/usr/bin/env node
// Network window, Phase 1 (read only): the pure parsers in web-src/net-core.js, fed with the shapes the F50 gave in Phase 0 of
// MatchiTOOL_Network_Tools_PLAN.txt, plus a guard that web-src/net-tools.js (the window) cannot write anything.
// No router, no browser.
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const N = require('../app/src/main/web-src/net-core.js');
const ui = fs.readFileSync(path.join(__dirname, '../app/src/main/web-src/net-tools.js'), 'utf8');
const eq = assert.deepStrictEqual;

// ---- tabs and read keys -----------------------------------------------------------------------------------------------------
eq(N.TABS.map((t) => t[0]), ['data', 'wifi', 'devices', 'apn', 'lan', 'mtu']);
eq(Object.keys(N.READ), N.TABS.map((t) => t[0]));
for (const [k, v] of Object.entries(N.READ)) assert(/^[A-Za-z0-9_,]+$/.test(v), 'read list of ' + k + ' has odd characters');
assert(N.READ.lan.includes('dhcpLease_hour') && N.READ.mtu === 'mtu,tcp_mss' && N.READ.data.startsWith('ppp_status'));

// ---- helpers ----------------------------------------------------------------------------------------------------------------
eq(N.clean(''), null); eq(N.clean(undefined), null); eq(N.clean(null), null); eq(N.clean('  x '), 'x'); eq(N.clean(0), '0');
eq(N.num('10'), 10); eq(N.num(10), 10); eq(N.num(''), null); eq(N.num('1.5'), null); eq(N.num('24h'), null);
eq(N.toList('[{"a":1}]'), [{ a: 1 }]); eq(N.toList('garbage'), []); eq(N.toList(''), []); eq(N.toList(undefined), []); eq(N.toList([1]), [1]);
eq(N.normMac('AA:BB:CC:DD:EE:01'), 'aa:bb:cc:dd:ee:01'); eq(N.normMac('aa-bb-cc-dd-ee-02'), 'aa:bb:cc:dd:ee:02'); eq(N.normMac('AABBCCDDEE03'), 'aa:bb:cc:dd:ee:03');
eq(N.normMac('not a mac'), 'not a mac'); eq(N.normMac(undefined), '');
eq(N.pick({ a: 1 }, 'a'), 1); eq(N.pick({ q: { a: 2 } }, 'a'), 2); eq(N.pick({ q: '{"a":3}' }, 'a'), 3); eq(N.pick({ q: 'x' }, 'a'), undefined); eq(N.pick(null, 'a'), undefined);

// ---- Data (the F50 reports ipv4_ipv6_connected, a family of values) ---------------------------------------------------------
eq(N.connState('ipv4_ipv6_connected'), 'connected'); eq(N.connState('ppp_connected'), 'connected'); eq(N.connState('ipv4_connected'), 'connected');
eq(N.connState('ppp_disconnected'), 'disconnected'); eq(N.connState('ipv4_ipv6_disconnected'), 'disconnected');
eq(N.connState('ppp_connecting'), 'changing'); eq(N.connState('disconnecting'), 'changing'); eq(N.connState(''), null); eq(N.connState(undefined), null);
const data = N.parseData({ ppp_status: 'ipv4_ipv6_connected', dial_mode: 'auto_dial', roam_setting_option: 'off', dial_roam_setting_option: '' });
eq(data, { ppp: 'ipv4_ipv6_connected', state: 'connected', mode: 'auto_dial', modeLabel: 'Automatic', roaming: 'Off' });
eq(N.parseData({}), { ppp: null, state: null, mode: null, modeLabel: null, roaming: null });   // empty = not reported, never "off" or "disconnected"
eq(N.parseData('junk'), null);
// Phase 2: mobile data off / on (bodies captured on the F50)
eq(N.dataCall('off'), { goformId: 'DISCONNECT_NETWORK', notCallback: 'true' });
eq(N.dataCall('on'), { goformId: 'CONNECT_NETWORK', notCallback: 'true' });
assert.throws(() => N.dataCall('toggle')); assert.throws(() => N.dataCall('__proto__')); assert.throws(() => N.dataCall(undefined));
N.dataCall('off').goformId = 'x'; eq(N.dataCall('off').goformId, 'DISCONNECT_NETWORK');   // callers get a copy
eq(N.dataNext('connected'), 'off'); eq(N.dataNext('disconnected'), 'on'); eq(N.dataNext('changing'), null); eq(N.dataNext(null), null);
eq(N.connState('ppp_disconnected'), 'disconnected');   // the real "off" value seen on the F50
assert(N.dataReached('off', 'disconnected') && !N.dataReached('off', 'connected') && !N.dataReached('off', 'changing'));
assert(N.dataReached('on', 'connected') && !N.dataReached('on', 'disconnected') && !N.dataReached('on', null) && !N.dataReached('x', 'connected'));

// ---- Wi-Fi: bands by ChipIndex, password never copied ----------------------------------------------------------------------
const chip = (i, on, extra) => Object.assign({ ChipIndex: i, AccessPointIndex: '0', AccessPointSwitchStatus: on ? '1' : '0', SSID: 'HomeNet', ApMaxStationNumber: 10, AuthMode: 'WPA2PSKWPA3PSK',
  ApBroadcastDisabled: '0', Pmf_switch: true, CountryCode: 'CN', EncrypType: '', Password: 'TopSecret-pass-1', PasswordShow: 'TopSecret-pass-1' }, extra || {});
const wifiReply = { WiFiModuleSwitch: '1', ResponseList: [chip(0, false), chip(1, true)] };
const w = N.parseWifi(wifiReply);
eq(w.moduleOn, true); eq(w.entries.length, 2);
eq(w.entries[0].chip, 0); eq(w.entries[0].on, false); eq(w.entries[1].chip, 1); eq(w.entries[1].on, true);
eq(w.entries[1].ssid, 'HomeNet'); eq(w.entries[1].auth, 'WPA2-PSK / WPA3-PSK'); eq(w.entries[1].broadcast, true); eq(w.entries[1].maxStations, 10); eq(w.entries[1].country, 'CN');
assert(!JSON.stringify(w).includes('TopSecret'), 'the Wi-Fi password must not be in the parsed object');
assert(!/password/i.test(JSON.stringify(w)), 'no password key in the parsed object');
eq(N.wifiSummary(w), '5 GHz only (probably)');
eq(N.wifiSummary(N.parseWifi({ WiFiModuleSwitch: '1', ResponseList: [chip(0, true), chip(1, false)] })), '2.4 GHz only (probably)');
eq(N.wifiSummary(N.parseWifi({ WiFiModuleSwitch: '1', ResponseList: [chip(0, false), chip(1, false)] })), 'Off');
eq(N.wifiSummary(N.parseWifi({ WiFiModuleSwitch: '0', ResponseList: [chip(0, false), chip(1, false)] })), 'Off');
eq(N.wifiSummary(N.parseWifi({ WiFiModuleSwitch: '1', ResponseList: [chip(0, true), chip(1, true)] })), 'Both chips on');
eq(N.parseWifi({ WiFiModuleSwitch: '1', ResponseList: [chip(1, true, { ApBroadcastDisabled: '1' })] }).entries[0].broadcast, false);   // 1 = SSID hidden
// the answer may be nested under the query names, or the list may be a JSON string
const wn = N.parseWifi({ queryWiFiModuleSwitch: { WiFiModuleSwitch: '1' }, queryAccessPointInfo: { ResponseList: [chip(1, true)] } });
eq(wn.moduleOn, true); eq(wn.entries.length, 1);
eq(N.parseWifi({ WiFiModuleSwitch: '1', ResponseList: JSON.stringify([chip(1, true)]) }).entries.length, 1);
eq(N.parseWifi({}), { moduleOn: null, entries: [], clients: null });                     // nothing reported
eq(N.wifiSummary(N.parseWifi({})), null);
eq(N.parseWifi({ WiFiModuleSwitch: '1', ResponseList: [chip(1, true)], wifi_access_sta_num: '2' }).clients, 2);
eq(N.parseWifi({ WiFiModuleSwitch: '1', ResponseList: [{ ChipIndex: 1 }] }).entries[0].ssid, null);   // an empty field is null
eq(N.chipLabel(0), 'Chip 0 (probably 2.4 GHz)'); eq(N.chipLabel(1), 'Chip 1 (probably 5 GHz)'); eq(N.chipLabel(2), 'Chip 2'); eq(N.chipLabel(null), 'Unknown band');
eq(N.authLabel('OPEN'), 'Open'); eq(N.authLabel('WPA2PSK'), 'WPA2-PSK'); eq(N.authLabel('SomethingNew'), 'SomethingNew'); eq(N.authLabel(''), null);

// ---- Devices: Wi-Fi + cable merged, three fields only ----------------------------------------------------------------------
const dev = N.parseDevices({
  station_list: [{ mac_addr: 'AA:BB:CC:DD:EE:01', hostname: 'Zeta-PC', ip_addr: '192.168.0.10' }, { mac_addr: 'AA:BB:CC:DD:EE:05', hostname: 'alpha-phone', ip_addr: '192.168.0.9' }],
  lan_station_list: [{ mac_addr: 'aa-bb-cc-dd-ee-02', hostname: 'GL-MT3000', ip_addr: '192.168.0.2' }],
  wifi_access_sta_num: '2',
});
eq(dev.rows.map((r) => r.type + ':' + r.name), ['Wi-Fi:alpha-phone', 'Wi-Fi:Zeta-PC', 'Cable:GL-MT3000']);   // Wi-Fi first, then by name
eq(dev.rows[2].mac, 'aa:bb:cc:dd:ee:02'); eq(dev.wifi, 2); eq(dev.cable, 1); eq(dev.routerCount, 2); eq(dev.wifiReported, true); eq(dev.cableReported, true);
eq(N.mergeDevices([{ mac_addr: 'AA:BB:CC:DD:EE:01', hostname: 'a', ip_addr: '1.1.1.1' }], [{ mac_addr: 'aa:bb:cc:dd:ee:01', hostname: 'a', ip_addr: '1.1.1.1' }]).map((r) => r.type), ['Wi-Fi']);   // same MAC once
eq(N.mergeDevices([{ mac_addr: 'A', hostname: 'x', ip_addr: '192.168.0.100' }, { mac_addr: 'B', hostname: 'x', ip_addr: '192.168.0.20' }], []).map((r) => r.ip), ['192.168.0.20', '192.168.0.100']);   // numeric IP order
eq(N.mergeDevices('[{"mac_addr":"AA:BB:CC:DD:EE:09","hostname":"j","ip_addr":"1.2.3.4"}]', '').length, 1);   // JSON string list
eq(N.mergeDevices([{ mac_address: 'AA:BB:CC:DD:EE:08', hostname: 'old', ip_addr: '1.2.3.5' }], [])[0].mac, 'aa:bb:cc:dd:ee:08');   // mac_address spelling accepted
eq(N.mergeDevices([{}, 'x', null], []), []);
eq(N.parseDevices({ station_list: '', lan_station_list: '' }).rows, []);                 // reported, nobody connected
eq(N.parseDevices({}), null);                                                           // neither key came back
eq(N.parseDevices({ station_list: [] }).cableReported, false);

// ---- APN: Auto mode comes back empty on the F50; passwords never show -----------------------------------------------------
eq(N.parseApn({ apn_mode: 'auto', apn_auto_profile: '', APN_config: '', ipv6_APN_config: '' }), { mode: 'auto', autoProfile: null, v4: null, v6: null });
const apnList = N.parseApn({ apn_mode: 'manual', APN_config: [{ profile_name: 'Home', apn: 'internet', pdp_type: 'IPv4v6', ppp_passwd: 'pw1', apn_ppp_passwd: 'pw2', ppp_username: 'u' }] });
eq(apnList.v4.kind, 'list'); assert(!JSON.stringify(apnList).includes('pw1') && !JSON.stringify(apnList).includes('pw2'), 'APN password must be dropped');
eq(N.apnLine(apnList.v4.items[0]), 'Home · internet · IPv4v6');
eq(N.apnLine({}), '(no name)');
const apnText = N.parseApn({ apn_mode: 'manual', APN_config: 'Home($)internet ppp_passwd=pw3&x=1' });
eq(apnText.v4.kind, 'text'); assert(!apnText.v4.text.includes('pw3') && apnText.v4.text.includes('[hidden]'), 'masked text: ' + apnText.v4.text);
eq(N.maskSecrets('apn_ppp_passwd=abc&apn_wan_apn=x'), 'apn_ppp_passwd=[hidden]&apn_wan_apn=x');
eq(N.maskSecrets('{"Password":"abc","SSID":"h"}'), '{"Password":[hidden],"SSID":"h"}');
eq(N.maskSecrets('password prompt shown'), 'password prompt shown');
eq(N.maskSecrets(undefined), '');
assert(N.isPassKey('ppp_passwd') && N.isPassKey('Password') && N.isPassKey('PasswordShow') && N.isPassKey('apn_ppp_passwd') && !N.isPassKey('ppp_username'));

// ---- LAN / DHCP: the lease read value has an "h" on the end -----------------------------------------------------------------
const lan = N.parseLan({ lan_ipaddr: '192.168.0.1', lan_netmask: '255.255.255.0', dhcpEnabled: '1', dhcpStart: '192.168.0.2', dhcpEnd: '192.168.0.253', dhcpLease_hour: '24h', mac_address: 'AA:BB', dhcp_reboot_flag: '', lan_gateway: '' });
eq(lan, { ip: '192.168.0.1', mask: '255.255.255.0', dhcp: 'On', start: '192.168.0.2', end: '192.168.0.253', leaseRaw: '24h', leaseHours: 24, mac: 'AA:BB' });
eq(N.parseLease('24h'), 24); eq(N.parseLease('1H'), 1); eq(N.parseLease('48'), 48); eq(N.parseLease('abc'), null); eq(N.parseLease(''), null); eq(N.parseLease('1.5h'), null);
eq(N.leaseText(24), '24 hours'); eq(N.leaseText(1), '1 hour'); eq(N.leaseText(null), null);
eq(N.parseLan({ dhcpEnabled: '0' }).dhcp, 'Off'); eq(N.parseLan({ dhcpEnabled: '' }).dhcp, null);
eq(N.parseLan({ dhcpLease_hour: 'weird' }).leaseHours, null); eq(N.parseLan({ dhcpLease_hour: 'weird' }).leaseRaw, 'weird');

// ---- MTU / MSS ------------------------------------------------------------------------------------------------------------
eq(N.parseMtu({ mtu: '1500', tcp_mss: '1460' }), { mtu: 1500, mss: 1460, warn: null });
eq(N.parseMtu({ mtu: '1500', tcp_mss: '1459' }).warn, null);   // lower than MTU - 40 is fine
eq(N.parseMtu({ mtu: '1500', tcp_mss: '1461' }).warn, 'MSS is larger than MTU minus 40 (1460)');
eq(N.parseMtu({ mtu: '', tcp_mss: '' }), { mtu: null, mss: null, warn: null });

// ---- Root read of the real values (read-only commands) -----------------------------------------------------------------
assert(!/\b(set|add|del|delete|flush|replace|append|insert)\b|iptables -[ADIRFXPN]\b|ip link set|setprop/i.test(N.ROOT_READ_SH.replace(/ip -o link show|echo '##[a-z0-9]+'/g, '')), 'the root command must only read');
assert(N.ROOT_READ_SH.includes('ip route get 1.1.1.1') && N.ROOT_READ_SH.includes('iptables -S') && N.ROOT_READ_SH.includes('ip6tables'));
const rootText = [
  '##route', '1.1.1.1 dev sipa_eth0 table sipa_eth0 src 100.95.85.97 uid 0', '    cache mtu 1500',
  '##link',
  '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\\    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00',
  '14: sipa_eth0: <NOARP,UP,LOWER_UP> mtu 1500 qdisc pfifo_fast state UNKNOWN mode DEFAULT group default qlen 1000\\    link/none',
  '15: br0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default qlen 1000\\    link/ether 02:00:00:00:00:01 brd ff:ff:ff:ff:ff:ff',
  '##filter',
  '-A INPUT -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1460', '-A INPUT -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1460',
  '-A OUTPUT -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1460', '-A OUTPUT -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1460',
  '##mangle', '-A tetherctrl_mangle_FORWARD -p tcp -m tcp --tcp-flags SYN SYN -j TCPMSS --clamp-mss-to-pmtu',
  '##filter6', '##mangle6', '##end', ''].join('\n');
const rn = N.parseRootNet(rootText);
eq(rn.wanDev, 'sipa_eth0'); eq(rn.wanMtu, 1500); eq(rn.wanState, 'UP'); eq(rn.noRoute, false); eq(rn.wanSrc, '100.95.85.97');
eq(rn.rules.length, 5); eq(rn.rules.filter((x) => x.table === 'filter').length, 4); eq(rn.rules.filter((x) => x.table === 'mangle').length, 1); eq(rn.rules.every((x) => x.family === 'IPv4'), true);
// a WAN with a smaller MTU is reported as it is, and the loopback line is not taken for it
const rn2 = N.parseRootNet('##route\n1.1.1.1 dev rmnet0 src 10.0.0.2\n##link\n3: rmnet0: <UP> mtu 1400 qdisc x state UP\n##filter\n##mangle\n##filter6\n-A INPUT -p tcp -j TCPMSS --set-mss 1380\n##mangle6\n##end\n');
eq(rn2.wanMtu, 1400); eq(rn2.rules.length, 1); eq(rn2.rules[0].family, 'IPv6');
// no route: mobile data off
const rn3 = N.parseRootNet('##route\nRTNETLINK answers: Network is unreachable\n##link\n14: sipa_eth0: <NOARP,UP> mtu 1500 qdisc x\n##filter\n##mangle\n##end\n');
eq(rn3.noRoute, true); eq(rn3.wanDev, null); eq(rn3.wanMtu, null);
// error text that grep let through is not a rule; the interface name must match exactly (sipa_eth0 is not sipa_eth01)
eq(N.parseRootNet('##route\n1.1.1.1 dev sipa_eth01\n##link\n14: sipa_eth0: <UP> mtu 1500\n##filter\niptables: Permission denied\n##end\n').wanMtu, null);
eq(N.parseRootNet('##route\n1.1.1.1 dev sipa_eth0\n##link\n14: sipa_eth0: <UP> mtu 1500\n##filter\niptables: Permission denied\n##end\n').rules, []);
eq(N.parseRootNet(''), null); eq(N.parseRootNet('nothing useful'), null);
eq(N.sections('##a\nx\n\ny\n##b\n'), { a: ['x', 'y'], b: [] });

// ---- Phase 4: devices rename / block / unblock (bodies captured on the F50) ----
assert(N.READ.devices.includes('BlackMacList') && N.READ.devices.includes('AclMode'));
eq(N.parseAcl({ BlackMacList: '', BlackNameList: '', WhiteMacList: '', WhiteNameList: '', AclMode: '2' }), { mode: '2', black: [], whiteMacs: [], whiteNames: [] });
const acl0 = N.parseAcl({ AclMode: '2', BlackMacList: '', BlackNameList: '', WhiteMacList: '', WhiteNameList: '' });
eq(N.blockCall(acl0, '52:E3:AC:5A:EF:7D', 'POCO-F6'), { goformId: 'setDeviceAccessControlList', AclMode: '2', WhiteMacList: '', BlackMacList: '52:e3:ac:5a:ef:7d;', WhiteNameList: '', BlackNameList: 'POCO-F6;' });
const acl1 = N.parseAcl({ AclMode: '2', BlackMacList: '52:e3:ac:5a:ef:7d;', BlackNameList: 'POCO-F6;', WhiteMacList: '', WhiteNameList: '' });
eq(acl1.black, [{ mac: '52:e3:ac:5a:ef:7d', name: 'POCO-F6' }]);
eq(N.unblockCall(acl1, '52:e3:ac:5a:ef:7d'), { goformId: 'setDeviceAccessControlList', AclMode: '2', WhiteMacList: '', BlackMacList: '', WhiteNameList: '', BlackNameList: '' });   // = the captured unblock
eq(N.blockCall(acl1, 'aa:bb:cc:dd:ee:01', 'Tab').BlackMacList, '52:e3:ac:5a:ef:7d;aa:bb:cc:dd:ee:01;');   // others stay blocked
eq(N.unblockCall(N.parseAcl({ BlackMacList: '52:e3:ac:5a:ef:7d;aa:bb:cc:dd:ee:01;', BlackNameList: 'A;B;' }), 'aa:bb:cc:dd:ee:01').BlackNameList, 'A;');
eq(N.blockCall(acl0, '52:e3:ac:5a:ef:7d', 'bad;name&x=1').BlackNameList, 'badnamex1;');                  // separators never reach the form
eq(N.blockCall(acl0, '52:e3:ac:5a:ef:7d', ';;;').BlackNameList, 'device;');
assert.throws(() => N.blockCall(acl1, '52:E3:AC:5A:EF:7D', 'x'), /already blocked/); assert.throws(() => N.unblockCall(acl0, '52:e3:ac:5a:ef:7d'), /not in the block list/);
assert.throws(() => N.blockCall(acl0, 'not-a-mac', 'x')); assert.throws(() => N.blockCall(null, '52:e3:ac:5a:ef:7d', 'x'));
const aclW = N.parseAcl({ AclMode: '1', WhiteMacList: 'aa:bb:cc:dd:ee:01;', WhiteNameList: 'W;', BlackMacList: '' });   // allow-list mode: never touched
assert(N.aclRefusal(aclW) && N.aclRefusal(null) && N.aclRefusal(acl0) === null);
assert.throws(() => N.blockCall(aclW, '52:e3:ac:5a:ef:7d', 'x'), /allow list/); assert.throws(() => N.unblockCall(aclW, '52:e3:ac:5a:ef:7d'), /allow list/);
eq(N.renameCall('28:56:5A:3A:EF:6F', ' ako '), { goformId: 'EDIT_HOSTNAME', mac: '28:56:5a:3a:ef:6f', hostname: 'ako' });   // = the captured rename
for (const bad of ['', '   ', 'a;b', 'a&b', 'a=b', 'a%41', 'x'.repeat(32), 'na\nme']) assert(N.hostnameError(bad), 'bad name: ' + JSON.stringify(bad));
for (const good of ['ako', 'My Phone 2', 'GL-MT3000', 'a.b_c-d', 'x'.repeat(31)]) assert.strictEqual(N.hostnameError(good), null, good);
assert.throws(() => N.renameCall('nope', 'x')); assert.throws(() => N.renameCall('28:56:5a:3a:ef:6f', 'a;b'));
assert(N.isSelf('192.168.0.179', '::ffff:192.168.0.179') && !N.isSelf('192.168.0.2', '192.168.0.179') && !N.isSelf('192.168.0.2', '') && !N.isSelf('', ''));

// ---- The window writes only mobile data off / on (Phase 2); everything else is read only ------------------------------------------------------------------------
assert(!/\.innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(ui), 'net-tools.js must put values on the page with textContent, not markup');
assert(!/setBands|cellLock|cellUnlock|radioCycle|\.at\(/.test(ui), 'net-tools.js must not call another MatchiRadio writer');
const setCalls = ui.match(/R\.setRouter\([^;]*;/g) || [];
assert(setCalls.length === 2 && /^R\.setRouter\(N\.dataCall\(action\), true\)/.test(setCalls[0]) && /^R\.setRouter\(call, true\)/.test(setCalls[1]), 'the only router writes: mobile data and the device call: ' + setCalls.join(' | '));
assert(/askConfirm\(/.test(ui.slice(0, ui.indexOf('R.setRouter('))), 'a confirm dialog comes before the write');
assert(!/\bcall\s*=\s*\{/.test(ui) && (ui.match(/call = N\.(renameCall|blockCall|unblockCall)\(/g) || []).length === 3, 'the device call is always built by net-core.js');
assert(!/zte\(\s*['"]set['"]/.test(ui) && !/goform_set_cmd_process|goformId/.test(ui), 'net-tools.js must not build a router set call itself (net-core.js dataCall does)');
assert(!/localStorage|sessionStorage|document\.cookie/.test(ui), 'net-tools.js stores nothing');
assert(!/setInterval|setTimeout/.test(ui), 'no timers: no polling (plan rule 6); the 30 s wait loop is bounded and starts only after a confirmed switch');
const zteCalls = ui.match(/R\.zte\(([^)]*)\)/g) || [];
assert(zteCalls.length >= 1 && zteCalls.every((c) => /^R\.zte\(\s*'get'/.test(c)), 'every router call in net-tools.js must be a get: ' + zteCalls.join(' | '));
assert((ui.match(/R\.sh\(/g) || []).length === 1 && ui.includes('R.sh(N.ROOT_READ_SH'), 'the only root call is the fixed read-only command');
assert(ui.includes('R.beginBusy(') && ui.includes('release()'), 'Live Status is paused while the window is open (plan rule 7)');
assert(!/\.(Password|PasswordShow|passwd|ppp_passwd|apn_ppp_passwd|passphrase)\b|['"](Password|PasswordShow|passwd|ppp_passwd|apn_ppp_passwd|passphrase)['"]/.test(ui), 'the window never reads a password field of the router');
console.log('net tools ok: parsers for 6 tabs, password never copied, the window writes only mobile data off / on and device rename / block / unblock');

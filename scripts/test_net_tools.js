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
eq(N.wifiSummary(w), '5 GHz only');
eq(N.wifiSummary(N.parseWifi({ WiFiModuleSwitch: '1', ResponseList: [chip(0, true), chip(1, false)] })), '2.4 GHz only');
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
eq(N.chipLabel(0), 'Chip 0 (2.4 GHz)'); eq(N.chipLabel(1), 'Chip 1 (5 GHz)'); eq(N.chipLabel(2), 'Chip 2'); eq(N.chipLabel(null), 'Unknown band');
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

// ---- APN (Phase 5): the real F50 reply (Auto mode, 2026-11-15), the numbered slots, the checks and the captured bodies -----------------------------------
const DEF = 'default($)default($)manual($)*99#($)none($)($)($)IPv4v6($)($)($)($)($)', DITO = 'DITO($)internet.dito.ph($)manual($)*99#($)none($)($)($)IPv4v6($)($)($)($)($)';
assert(N.READ.apn.startsWith('apn_interface_version,APN_config0,APN_config1,') && N.READ.apn.includes('APN_config19') && N.READ.apn.includes('ipv6_APN_config19') && N.READ.apn.includes('apn_auto_config') && N.READ.apn.includes('Current_index'));
const apnAuto = N.parseApn({ apn_mode: 'auto', apn_interface_version: '', APN_config0: DEF, APN_config1: '', APN_config19: '', profile_name: 'DITO', wan_apn: 'internet.dito.ph', apn_auto_config: DITO, index: '', Current_index: '', ppp_passwd: 'pw1', ppp_username: 'user1' });
eq(apnAuto.mode, 'auto'); eq(apnAuto.uiVersion, false); eq(apnAuto.hasSlots, true);
eq(apnAuto.profiles, [{ slot: 0, name: 'default', apn: 'default', auth: 'none', pdp: 'IPv4v6' }]);
eq(apnAuto.auto, { name: 'DITO', apn: 'internet.dito.ph', auth: 'none', pdp: 'IPv4v6' }); eq(apnAuto.inUse, { name: 'DITO', apn: 'internet.dito.ph' });
eq(apnAuto.indexKeys, []); eq(apnAuto.freeSlots.length, 19); assert(!apnAuto.freeSlots.includes(0));
assert(!JSON.stringify(apnAuto).includes('pw1') && !JSON.stringify(apnAuto).includes('user1'), 'the parsed APN object holds no user name or password');
assert(!JSON.stringify(N.parseApn({ APN_config0: 'Home($)internet($)manual($)*99#($)pap($)myuser($)mypass($)IPv4v6($)($)($)($)($)', apn_mode: 'manual' })).match(/myuser|mypass/), 'login positions are never copied');
eq(N.parseApn({ apn_mode: 'manual', APN_config0: 'junk without the separator' }).profiles, []);            // not the known layout: not guessed
eq(N.parseProfile(''), null); eq(N.parseProfile('a($)b'), null); eq(N.parseProfile('($)($)($)($)($)($)($)($)'), null);
eq(N.parseProfile('Home($)internet($)manual($)*99#($)PAP($)($)($)IPv4v6($)'), { name: 'Home', apn: 'internet', auth: 'pap', pdp: 'IPv4v6' });
eq(N.parseApn('junk'), null);
assert(N.apnRefusal(null) && N.apnRefusal(N.parseApn({ apn_mode: '', APN_config0: DEF })) && N.apnRefusal(N.parseApn({ apn_mode: 'auto' })) && N.apnRefusal(N.parseApn({ apn_mode: 'auto', apn_interface_version: '2', APN_config0: DEF })));
eq(N.apnRefusal(apnAuto), null);
// who may do what: Auto mode only "use"; Manual mode also edit / add / delete
const mk = (mode, slots, used, idx) => N.parseApn(Object.assign({ apn_mode: mode, profile_name: used[0], wan_apn: used[1], index: idx === undefined ? '' : String(idx), Current_index: idx === undefined ? '' : String(idx) },
  Object.fromEntries(slots.map((t, i) => ['APN_config' + i, t]))));
const HOME = 'Home($)internet($)manual($)*99#($)none($)($)($)IPv4v6($)($)($)($)($)', WORK = 'Work($)work.apn($)manual($)*99#($)pap($)($)($)IP($)($)($)($)($)';
const mAuto = mk('auto', [HOME, WORK], ['DITO', 'internet.dito.ph']), mMan = mk('manual', [HOME, WORK], ['Home', 'internet'], 0);
assert(N.apnCanUse(mAuto, mAuto.profiles[0]) && !N.apnCanEdit(mAuto, mAuto.profiles[0]) && !N.apnCanAdd(mAuto) && N.apnDeleteRefusal(mAuto, mAuto.profiles[0]));
assert(!N.apnCanUse(mMan, mMan.profiles[0]), 'the profile in use has no Use'); assert(N.apnCanUse(mMan, mMan.profiles[1]) && N.apnCanEdit(mMan, mMan.profiles[1]) && N.apnCanAdd(mMan));
assert(/in use/.test(N.apnDeleteRefusal(mMan, mMan.profiles[0])), 'the profile in use is never deleted'); eq(N.apnDeleteRefusal(mMan, mMan.profiles[1]), null);
assert(/in use/.test(N.apnDeleteRefusal(mk('manual', [HOME, WORK], ['', ''], 1), mk('manual', [HOME, WORK], ['', ''], 1).profiles[1])), 'the slot the router names as current is refused even when the name keys are empty');
assert(/only usable profile/.test(N.apnDeleteRefusal(mk('manual', [HOME, ''], ['Other', 'x']), mk('manual', [HOME, ''], ['Other', 'x']).profiles[0])), 'the last usable profile stays');
assert(!N.apnCanUse(mk('auto', ['Blank($)($)manual($)*99#($)none($)($)($)IPv4v6($)'], ['DITO', 'x']), { slot: 0, name: 'Blank', apn: '', pdp: 'IPv4v6' }), 'a profile with no APN cannot be used');
assert(!N.apnCanAdd(mk('manual', Array.from({ length: 20 }, () => HOME), ['x', 'y'])), 'no free slot, no Add');
eq(N.autoAsForm(apnAuto), { name: 'DITO', apn: 'internet.dito.ph', pdp: 'IPv4v6', auth: 'none', user: '', pass: '' }); eq(N.autoAsForm({ auto: null }), null);
assert(N.sameProfile({ name: 'DITO', apn: '' }, 'DITO', 'internet.dito.ph') && N.sameProfile({ name: 'DITO', apn: 'internet.dito.ph' }, 'DITO', '') && N.sameProfile({ name: 'DITO', apn: 'a' }, 'DITO', 'a'), 'empty APN right after a switch still matches by name');
assert(!N.sameProfile({ name: 'DITO', apn: 'a' }, 'DITO', 'b') && !N.sameProfile({ name: 'X', apn: '' }, 'DITO', '') && !N.sameProfile(null, 'DITO', 'a') && !N.sameProfile({ name: '', apn: '' }, '', ''), 'different names or different non-empty APNs never match');
// form checks
const okForm = { name: 'Test', apn: 'internet.dito.ph', pdp: 'IPv4v6', auth: 'none', user: '', pass: '' };
eq(N.apnFormError(okForm), null);
for (const bad of [{ name: '' }, { name: 'a;b' }, { name: 'x'.repeat(32) }, { apn: '' }, { apn: 'a b' }, { apn: 'a&b=1' }, { apn: 'x'.repeat(64) }, { pdp: 'IPv5' }, { auth: 'ntlm' },
  { auth: 'pap', user: '', pass: 'x' }, { auth: 'chap', user: 'u', pass: '' }, { auth: 'pap', user: 'has space', pass: 'x' }, { auth: 'pap', user: 'u', pass: 'x'.repeat(65) }])
  assert(N.apnFormError(Object.assign({}, okForm, bad)), 'bad form: ' + JSON.stringify(bad));
eq(N.apnFormError(Object.assign({}, okForm, { auth: 'pap', user: 'me@x.ph', pass: 'p#ss&w=rd' })), null);       // URL-encoded by the host, so these are fine
// captured bodies
eq(N.apnAutoCall(), { goformId: 'APN_PROC_EX', apn_mode: 'auto' });                                           // = isTest=false&goformId=APN_PROC_EX&apn_mode=auto
eq(Object.entries(N.apnSaveCall({ name: 'default', apn: 'default', pdp: 'IPv4v6', auth: 'none', user: '', pass: '' }, 0)),
  Object.entries({ goformId: 'APN_PROC_EX', apn_action: 'save', apn_mode: 'manual', profile_name: 'default', wan_dial: '*99#', apn_select: 'manual', pdp_type: 'IPv4v6', pdp_select: 'auto', pdp_addr: '', index: '0',
    wan_apn: 'default', ppp_auth_mode: 'none', ppp_username: '', ppp_passwd: '', dns_mode: 'auto', prefer_dns_manual: '', standby_dns_manual: '',
    ipv6_wan_apn: 'default', ipv6_ppp_auth_mode: 'none', ipv6_ppp_username: '', ipv6_ppp_passwd: '', ipv6_dns_mode: 'auto', ipv6_prefer_dns_manual: '', ipv6_standby_dns_manual: '' }));   // same keys, same ORDER as the capture
eq(N.apnDefaultCall(0, 'IPv4v6'), { goformId: 'APN_PROC_EX', apn_mode: 'manual', apn_action: 'set_default', set_default_flag: '1', pdp_type: 'IPv4v6', index: '0' });   // = the captured set-default
eq(N.apnDeleteCall(3), { goformId: 'APN_PROC_EX', apn_action: 'delete', apn_mode: 'manual', index: '3' });
const sIP = N.apnSaveCall({ name: 'V4', apn: 'a.b', pdp: 'IP', auth: 'pap', user: 'u', pass: 'p' }, 2), sV6 = N.apnSaveCall({ name: 'V6', apn: 'a.b', pdp: 'IPv6', auth: 'none', user: 'zz', pass: 'zz' }, 2);
assert(sIP.wan_apn === 'a.b' && sIP.ppp_username === 'u' && sIP.ppp_passwd === 'p' && !('ipv6_wan_apn' in sIP), 'IPv4 only sends the IPv4 part');
assert(sV6.ipv6_wan_apn === 'a.b' && !('wan_apn' in sV6) && sV6.ipv6_ppp_username === '' && sV6.ipv6_ppp_passwd === '', 'IPv6 only sends the IPv6 part; auth none sends no login');
for (const f of [() => N.apnSaveCall(okForm, 20), () => N.apnSaveCall(okForm, -1), () => N.apnSaveCall(okForm, 1.5), () => N.apnSaveCall(Object.assign({}, okForm, { name: '' }), 1), () => N.apnDeleteCall(20), () => N.apnDefaultCall(0, 'x'), () => N.apnDefaultCall('0', 'IP')]) assert.throws(f);
eq(N.authLabelApn('chap'), 'CHAP'); eq(N.pdpLabel('IPv4v6'), 'IPv4 + IPv6');
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
assert(N.READ_ACL === 'queryDeviceAccessControlList' && N.READ_NAMES === 'hostNameList' && !N.READ.devices.includes('BlackMacList'));
eq(N.parseAcl({ station_list: [] }), null); eq(N.parseAcl({}), null);   // block list not read -> null (Block / Unblock hidden, never guess)
assert(N.aclRefusal(N.parseAcl({ station_list: [] })));
// real replies seen on the F50 (2026-11-15): two blocked entries, and hostNameList names win over the station_list hostname
eq(N.parseAcl({ AclMode: '2', WhiteMacList: '', BlackMacList: '1e:d4:3e:cb:c7:ba;e2:56:0b:64:b4:93;', WhiteNameList: '', BlackNameList: 'POCO-F6;POCO-F6;' }).black,
  [{ mac: '1e:d4:3e:cb:c7:ba', name: 'POCO-F6' }, { mac: 'e2:56:0b:64:b4:93', name: 'POCO-F6' }]);
const dv = N.parseDevices({ station_list: [{ mac_addr: '28:56:5a:3a:ef:6f', hostname: 'DESKTOP-H5SSC7L', ip_addr: '192.168.0.112' }], lan_station_list: [{ mac_addr: '5C:4D:BF:88:9C:78', hostname: 'GL-MT3000', ip_addr: '192.168.0.4' }],
  hostNameList: [{ hostname: 'DESKTOP', mac: '28:56:5a:3a:ef:6f' }, { hostname: 'GL-MT3000', mac: '5c:4d:bf:88:9c:78' }] });
eq(dv.rows.map((r) => r.name), ['DESKTOP', 'GL-MT3000']);
eq(N.parseDevices({ station_list: [{ mac_addr: 'aa:bb:cc:dd:ee:01', hostname: 'Phone', ip_addr: '1.1.1.1' }], hostNameList: 'junk' }).rows[0].name, 'Phone');   // no usable names: station name stays
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

// ---- MTU / MSS change (Phase 7): checks, the captured call, the backup copy, the helpers -------------------------------------------------------------------
eq(N.mtuCheck(1500, 1460), { mtu: 1500, mss: 1460 }); eq(N.mtuCheck(' 1280 ', '1240'), { mtu: 1280, mss: 1240 }); eq(N.mtuCheck('1500', '1459'), { mtu: 1500, mss: 1459 });
for (const [a, b] of [['', '1460'], ['1500', ''], ['abc', '1460'], ['15e2', '1460'], ['-1500', '1460'], ['1500.5', '1460'], ['1279', '1240'], ['1501', '1460'], ['1500', '1461'], ['1280', '1241'], ['1500', '535'], ['99999', '1460'], [null, null]])
  assert(N.mtuCheck(a, b).error, 'bad MTU / MSS: ' + a + '/' + b);
eq(N.mtuDefaultMss(1500), 1460);
eq(N.mtuCall(1500, 1459), { goformId: 'SET_DEVICE_MTU', mtu: '1500', tcp_mss: '1459' });     // = the captured body, mtu first, BOTH values always
eq(Object.keys(N.mtuCall(1400, 1360)), ['goformId', 'mtu', 'tcp_mss']);
assert.throws(() => N.mtuCall(1500, 1461)); assert.throws(() => N.mtuCall('x', 1460));
const bk = N.mtuBackupWriteSh({ mtu: 1500, mss: 1460 }, { mtu: 1400, mss: 1360 }, 1731633600000);
assert(bk.includes('/data/local/matchitool/mtu_backup.json') && bk.includes('umask 077') && bk.includes('MATCHI_BACKUP_OK') && bk.includes('{"old":{"mtu":1500,"mss":1460},"new":{"mtu":1400,"mss":1360},"at":1731633600000}'), bk);
assert.throws(() => N.mtuBackupWriteSh({ mtu: "1500'; rm -rf /; '", mss: 1460 }, { mtu: 1500, mss: 1459 }, 1), /valid MTU/);   // nothing but checked integers reaches the shell
assert.throws(() => N.mtuBackupWriteSh({ mtu: 1500, mss: 1460 }, { mtu: 1500, mss: 99999 }, 1));
assert(!/[`$;]/.test(N.mtuBackupWriteSh({ mtu: 1500, mss: 1460 }, { mtu: 1500, mss: 1459 }, 7).replace(/ && /g, ' ').replace("printf '%s'", 'printf')), 'no shell metacharacters besides the fixed &&');
eq(N.parseMtuBackup('{"old":{"mtu":1500,"mss":1460},"new":{"mtu":1500,"mss":1459},"at":5}\n'), { old: { mtu: 1500, mss: 1460 }, new: { mtu: 1500, mss: 1459 }, at: 5 });
for (const bad of ['', 'nope', '{}', '{"old":{"mtu":1500,"mss":1460}}', '{"old":{"mtu":1500,"mss":9},"new":{"mtu":1500,"mss":1459}}', '{"old":{"mtu":"x","mss":1460},"new":{"mtu":1500,"mss":1459}}', null, undefined]) eq(N.parseMtuBackup(bad), null);
eq(N.wanFollowed({ noRoute: false, wanMtu: 1450 }, 1450), true); eq(N.wanFollowed({ noRoute: false, wanMtu: 1500 }, 1450), false); eq(N.wanFollowed({ noRoute: true, wanMtu: null }, 1450), null); eq(N.wanFollowed(null, 1450), null);
eq(N.parsePing('MATCHI_PING_OK\n'), true); eq(N.parsePing('MATCHI_PING_FAIL'), false); eq(N.parsePing(''), null); eq(N.parsePing('ping: unknown host'), null);
for (const m of ['HTTP 401', 'sign in required', 'Unauthorized', 'Session expired', 'please log in', '403 Forbidden']) assert(N.isAuthError(m), m);
for (const m of ['Failed to fetch', 'NetworkError when attempting to fetch resource', 'timeout', '', null]) assert(!N.isAuthError(m), String(m));

// ---- LAN / DHCP pool and lease (Phase 6a) -----------------------------------------------------------------------------------
{
  const L = N.parseLan({ lan_ipaddr: '192.168.0.1', lan_netmask: '255.255.255.0', dhcpEnabled: '1', dhcpStart: '192.168.0.2', dhcpEnd: '192.168.0.253', dhcpLease_hour: '24h', mac_address: 'AA:BB' });
  eq(N.ipv4Int('192.168.0.1'), 3232235521); eq(N.ipv4Int('0.0.0.0'), 0); eq(N.ipv4Int('256.1.1.1'), null); eq(N.ipv4Int('1.2.3'), null); eq(N.ipv4Int('192.168.00.1'), null); eq(N.ipv4Int('192.168.0.1 '), 3232235521); eq(N.ipv4Int(''), null); eq(N.ipv4Int('a.b.c.d'), null);
  eq(N.maskInt('255.255.255.0') !== null, true); eq(N.maskInt('255.255.255.248') !== null, true); eq(N.maskInt('255.0.0.0') !== null, true);
  for (const bad of ['255.0.255.0', '255.255.255.252', '255.255.255.255', '254.0.0.0', '0.0.0.0', '255.255.255.1', '', 'x']) eq(N.maskInt(bad), null, 'mask ' + bad);
  eq(N.isPrivateIp(N.ipv4Int('10.1.2.3')), true); eq(N.isPrivateIp(N.ipv4Int('172.16.0.1')), true); eq(N.isPrivateIp(N.ipv4Int('172.31.255.1')), true); eq(N.isPrivateIp(N.ipv4Int('172.32.0.1')), false); eq(N.isPrivateIp(N.ipv4Int('8.8.8.8')), false); eq(N.isPrivateIp(null), false);
  const ok = (a, b, c) => N.lanPoolCheck(L, a, b, c);
  eq(ok('192.168.0.2', '192.168.0.253', '24'), { start: '192.168.0.2', end: '192.168.0.253', lease: 24 });
  eq(ok('192.168.0.10', '192.168.0.10', '1'), { start: '192.168.0.10', end: '192.168.0.10', lease: 1 }, 'one address is allowed');
  eq(ok(' 192.168.0.20 ', '192.168.0.30', ' 168 ').start, '192.168.0.20');
  // the table of bad examples
  const bad = [
    [['192.168.0.2', '192.168.1.5', '24'], /outside the router network/], [['192.168.1.2', '192.168.0.50', '24'], /outside the router network/],
    [['192.168.0.0', '192.168.0.50', '24'], /network or the broadcast/], [['192.168.0.2', '192.168.0.255', '24'], /network or the broadcast/],
    [['192.168.0.50', '192.168.0.20', '24'], /must not be after/], [['192.168.0.1', '192.168.0.50', '24'], /must not be inside the pool/], [['192.168.0.2', '192.168.0.1', '24'], /must not be after|inside the pool/],
    [['192.168.0.2', '192.168.0.200', '0'], /whole number of hours/], [['192.168.0.2', '192.168.0.200', '169'], /whole number of hours/], [['192.168.0.2', '192.168.0.200', '1.5'], /whole number of hours/],
    [['192.168.0.2', '192.168.0.200', '24h'], /whole number of hours/], [['192.168.0.2', '192.168.0.200', ''], /whole number of hours/], [['192.168.0.2', '192.168.0.200', '-5'], /whole number of hours/],
    [['abc', '192.168.0.200', '24'], /start is not a valid/], [['192.168.0.2', '192.168.0.300', '24'], /end is not a valid/], [['', '', ''], /start is not a valid/],
  ];
  for (const [args, re] of bad) { const r = ok(...args); assert(r.error && re.test(r.error), JSON.stringify(args) + ' -> ' + JSON.stringify(r)); }
  // the pool is checked against the router's real subnet: a router on 10.0.0.0/24, and a /16
  const L10 = N.parseLan({ lan_ipaddr: '10.0.0.1', lan_netmask: '255.255.255.0', dhcpEnabled: '1', dhcpStart: '10.0.0.2', dhcpEnd: '10.0.0.200', dhcpLease_hour: '24h' });
  assert(N.lanPoolCheck(L10, '10.0.0.2', '10.0.0.9', '2').lease === 2 && N.lanPoolCheck(L10, '192.168.0.2', '192.168.0.9', '2').error);
  const L16 = N.parseLan({ lan_ipaddr: '172.20.0.1', lan_netmask: '255.255.0.0', dhcpEnabled: '1', dhcpStart: '172.20.0.2', dhcpEnd: '172.20.0.200', dhcpLease_hour: '24h' });
  assert(!N.lanPoolCheck(L16, '172.20.1.5', '172.20.200.9', '2').error && /network or the broadcast/.test(N.lanPoolCheck(L16, '172.20.0.0', '172.20.9.9', '2').error) && /network or the broadcast/.test(N.lanPoolCheck(L16, '172.20.9.9', '172.20.255.255', '2').error));
  // refused when the router state is not what this step needs
  for (const [lan, re] of [[null, /did not report/], [{}, /did not report/], [Object.assign({}, L, { dhcp: 'Off' }), /not On/], [Object.assign({}, L, { dhcp: null }), /not On/], [Object.assign({}, L, { ip: '8.8.8.8' }), /not a private address/], [Object.assign({}, L, { mask: '255.0.255.0' }), /not valid/], [Object.assign({}, L, { ip: '192.168.0.300' }), /not a private address/]]) {
    const r = N.lanPoolCheck(lan, '192.168.0.2', '192.168.0.100', '24'); assert(r.error && re.test(r.error), JSON.stringify(lan) + ' -> ' + JSON.stringify(r));
  }
  // the call: the WHOLE set, as captured (part C); key order starts with goformId; IP and mask sent back unchanged; strings only
  eq(N.lanCall(L, { start: '192.168.0.2', end: '192.168.0.253', lease: 48 }), { goformId: 'DHCP_SETTING', lanIp: '192.168.0.1', lanNetmask: '255.255.255.0', lanDhcpType: 'SERVER', dhcpStart: '192.168.0.2', dhcpEnd: '192.168.0.253', dhcpLease: '48', dhcp_reboot_flag: '1', mac_ip_reset: '0' });
  eq(Object.keys(N.lanCall(L, { start: '192.168.0.2', end: '192.168.0.253', lease: 48 })), ['goformId', 'lanIp', 'lanNetmask', 'lanDhcpType', 'dhcpStart', 'dhcpEnd', 'dhcpLease', 'dhcp_reboot_flag', 'mac_ip_reset']);
  assert(Object.values(N.lanCall(L, { start: '192.168.0.2', end: '192.168.0.253', lease: 48 })).every((v) => typeof v === 'string'));
  assert.throws(() => N.lanCall(L, { start: '192.168.0.2', end: '192.168.1.253', lease: 48 }), /outside the router network/);
  assert.throws(() => N.lanCall(Object.assign({}, L, { dhcp: 'Off' }), { start: '192.168.0.2', end: '192.168.0.9', lease: 1 }), /not On/);
  assert.throws(() => N.lanCall(L, null), /start is not a valid/);
  // snapshots, backup file, restore
  const snap = N.lanSnapOf(L); eq(snap, { ip: '192.168.0.1', mask: '255.255.255.0', start: '192.168.0.2', end: '192.168.0.253', lease: 24 });
  eq(N.lanSnapOf(Object.assign({}, L, { leaseHours: null })), null); eq(N.lanSnapOf(null), null);
  eq(N.lanSnapOk({ ip: '192.168.0.1', mask: '255.255.255.0', start: '192.168.0.2', end: '192.168.0.253', lease: 500 }).lease, 500, 'an old lease over 168 h can still be saved and restored');
  eq(N.lanSnapOk({ ip: '192.168.0.1', mask: '255.255.255.0', start: '192.168.0.9', end: '192.168.0.2', lease: 5 }), null);
  const newSnap = Object.assign({}, snap, { start: '192.168.0.10', lease: 2 });
  const sh = N.lanBackupWriteSh(snap, newSnap, 1700000000000);
  assert(sh.startsWith('mkdir -p /data/local/matchitool && umask 077 && printf \'%s\' \'{"old":{"ip":"192.168.0.1"') && sh.endsWith("' > /data/local/matchitool/lan_backup.json && echo MATCHI_BACKUP_OK"), sh);
  const body = sh.split("printf '%s' '")[1].split("' >")[0];
  eq(N.parseLanBackup(body), { old: snap, new: newSnap, at: 1700000000000 });
  assert.throws(() => N.lanBackupWriteSh(snap, Object.assign({}, newSnap, { start: "1.2.3.4'; reboot; '" }), 1), /Not a valid/);
  assert.throws(() => N.lanBackupWriteSh(Object.assign({}, snap, { ip: '192.168.0.1$(id)' }), newSnap, 1), /Not a valid/);
  eq(N.parseLanBackup(''), null); eq(N.parseLanBackup('garbage'), null); eq(N.parseLanBackup('{"old":{},"new":{}}'), null); eq(N.parseLanBackup(null), null);
  eq(N.LAN_BACKUP_READ_SH, 'cat /data/local/matchitool/lan_backup.json 2>/dev/null'); eq(N.LAN_BACKUP_DELETE_SH, 'rm -f /data/local/matchitool/lan_backup.json && echo MATCHI_BACKUP_GONE');
  eq(N.lanRestoreCall(L, snap).dhcpLease, '24');
  eq(N.lanRestoreCall(L, Object.assign({}, snap, { lease: 500 })).dhcpLease, '500', 'restore does not apply the new-value limits');
  assert.throws(() => N.lanRestoreCall(Object.assign({}, L, { ip: '192.168.5.1' }), snap), /not the saved one any more/);
  assert.throws(() => N.lanRestoreCall(Object.assign({}, L, { mask: '255.255.0.0' }), snap), /not the saved one any more/);
  assert.throws(() => N.lanRestoreCall(Object.assign({}, L, { dhcp: 'Off' }), snap), /not On/);
  assert.throws(() => N.lanRestoreCall(L, { ip: 'x' }), /not valid/);
  // the confirming re-read
  eq(N.lanReached(L, { start: '192.168.0.2', end: '192.168.0.253', lease: 24 }), true); eq(N.lanReached(L, { start: '192.168.0.2', end: '192.168.0.253', lease: 12 }), false);
  eq(N.lanReached(Object.assign({}, L, { dhcp: 'Off' }), { start: '192.168.0.2', end: '192.168.0.253', lease: 24 }), false); eq(N.lanReached(null, {}), false);
}


// ---- Wi-Fi: band switch and settings (Phase 3; formats captured on the F50, part M of the plan) --------------------------------------------------------------
{
  const cp = require('child_process'), os = require('os');
  // base64 matches the platform's, and the decoder is strict
  for (const t of ['', 'a', 'ab', 'abc', 'abcd', 'Passw0rd! ~x', '12345678901234567890123456789012345678901234567890123456789012']) { eq(N.b64Ascii(t), Buffer.from(t).toString('base64')); eq(N.b64Dec(N.b64Ascii(t)), t); }
  assert.throws(() => N.b64Ascii('caf\u00e9pass1'), /printable ASCII/); eq(N.b64Dec('abc'), null); eq(N.b64Dec('a$b='), null); eq(N.b64Dec('QUJD='), null); eq(N.b64Dec('QQ==QQ=='), null);
  // SSID rules
  eq(N.utf8Len('abc'), 3); eq(N.utf8Len('\u00e9'), 2); eq(N.utf8Len('\u20ac'), 3);
  eq(N.wifiSsidError('CE 2', true), null); eq(N.wifiSsidError('', true) !== null, true); eq(N.wifiSsidError('a'.repeat(32), true), null); assert(N.wifiSsidError('a'.repeat(33), true));
  assert(N.wifiSsidError('\u00e9'.repeat(17), true), '17 x 2 bytes is 34 bytes'); assert(N.wifiSsidError('a\nb', true)); assert(N.wifiSsidError(' x', true)); eq(N.wifiSsidError(' x', false), null);
  // reply shapes as the F50 gives them (real key names; the password is a dummy)
  const PW = 'Dummy-pass-123';
  const ent = (i, on, o) => Object.assign({ ChipIndex: i, AccessPointIndex: '0', AccessPointSwitchStatus: on ? '1' : '0', SSID: 'CE 2', ApMaxStationNumber: 10, AuthMode: 'WPA2PSKWPA3PSK', ApBroadcastDisabled: '0', EncrypType: '', Password: PW, PasswordShow: PW }, o || {});
  const raw5 = { WiFiModuleSwitch: '1', ResponseList: [ent(0, false), ent(1, true)] };
  const w5 = N.parseWifi(raw5), act = N.wifiActive(w5);
  eq(act.chip, 1); eq(act.pwSet, true); eq(N.wifiMode(w5), '5g'); eq(N.wifiMode(N.parseWifi({ WiFiModuleSwitch: '1', ResponseList: [ent(0, true), ent(1, false)] })), '2g');
  eq(N.wifiMode(N.parseWifi({ WiFiModuleSwitch: '0', ResponseList: [ent(0, false), ent(1, false)] })), 'off'); eq(N.wifiMode(N.parseWifi({ WiFiModuleSwitch: '1', ResponseList: [ent(0, true), ent(1, true)] })), 'both'); eq(N.wifiMode(null), null);
  eq(N.wifiActive(N.parseWifi({ WiFiModuleSwitch: '1', ResponseList: [ent(0, true), ent(1, true)] })), null);
  assert(!/pass/i.test(JSON.stringify(w5)) || !JSON.stringify(w5).includes(PW), 'no password text in the parsed object');
  const snap = N.wifiSnapOf(act); eq(snap, { ssid: 'CE 2', auth: 'WPA2PSKWPA3PSK', hidden: false, max: 10 });
  eq(N.wifiSnapOf(N.wifiActive(N.parseWifi({ WiFiModuleSwitch: '1', ResponseList: [ent(1, true, { AuthMode: 'WPAPSKWPA2PSK' })] }))), null);   // a mode this tool does not offer: not editable
  eq(N.wifiSnapOf(N.wifiActive(N.parseWifi({ WiFiModuleSwitch: '1', ResponseList: [ent(1, true, { ApBroadcastDisabled: '' })] }))), null); eq(N.wifiSnapOf(null), null);
  eq(N.wifiHasPassword(raw5, PW), true); eq(N.wifiHasPassword(raw5, 'other-pass-9'), false); eq(N.wifiHasPassword({}, PW), false);
  // the call = the captured bodies, field for field, in the stock order (isTest first and AD last are added by the host)
  const pwB = Buffer.from(PW).toString('base64');
  const keep = { ssid: 'CE 2', auth: 'WPA2PSKWPA3PSK', hidden: false, max: 1 };
  eq(N.wifiSaveCall(raw5, keep), { goformId: 'setAccessPointInfo', ChipIndex: '0', AccessPointIndex: '0', SSID: 'CE 2', ApIsolate: '0', AuthMode: 'WPA2PSKWPA3PSK', ApBroadcastDisabled: '0', ApMaxStationNumber: '1', EncrypType: 'CCMP', Password: pwB });   // "max station number 10 to 1"
  eq(Object.keys(N.wifiSaveCall(raw5, keep)), ['goformId', 'ChipIndex', 'AccessPointIndex', 'SSID', 'ApIsolate', 'AuthMode', 'ApBroadcastDisabled', 'ApMaxStationNumber', 'EncrypType', 'Password']);
  eq(N.wifiSaveCall(raw5, Object.assign({}, keep, { max: 10, hidden: true })).ApBroadcastDisabled, '1');                                    // "Broadcast SSID from on to off"
  eq(N.wifiSaveCall(raw5, Object.assign({}, keep, { max: 10, ssid: 'AKO' })).SSID, 'AKO');                                                  // "CE 2 to AKO"
  eq(N.wifiSaveCall(raw5, Object.assign({}, keep, { max: 10, auth: 'WPA3PSK' })).AuthMode, 'WPA3PSK'); eq(N.wifiSaveCall(raw5, Object.assign({}, keep, { max: 10, auth: 'WPA2PSK' })).EncrypType, 'CCMP');
  const open = N.wifiSaveCall(raw5, Object.assign({}, keep, { max: 10, auth: 'OPEN' }));                                                    // "wpa2 to open": EncrypType=NONE, no Password
  eq(open, { goformId: 'setAccessPointInfo', ChipIndex: '0', AccessPointIndex: '0', SSID: 'CE 2', ApIsolate: '0', AuthMode: 'OPEN', ApBroadcastDisabled: '0', ApMaxStationNumber: '10', EncrypType: 'NONE' }); assert(!('Password' in open));
  const fromOpen = N.wifiSaveCall({ WiFiModuleSwitch: '1', ResponseList: [ent(1, true, { AuthMode: 'OPEN', Password: '', PasswordShow: '' })] }, { ssid: 'CE 2', auth: 'WPA3PSK', hidden: false, max: 10, pw: 'new-pass-1234' });   // "OPEN to wpa3 plus the password"
  eq(fromOpen.Password, Buffer.from('new-pass-1234').toString('base64')); eq(fromOpen.EncrypType, 'CCMP');
  // keep-the-password needs one to keep; a typed one wins; a saved one (base64) is used as is; bad ones are refused
  assert.throws(() => N.wifiSaveCall({ WiFiModuleSwitch: '1', ResponseList: [ent(1, true, { AuthMode: 'OPEN', Password: '', PasswordShow: '' })] }, { ssid: 'x', auth: 'WPA2PSK', hidden: false, max: 5 }), /no Wi-Fi password to keep/);
  assert.throws(() => N.wifiSaveCall({ WiFiModuleSwitch: '1', ResponseList: [ent(0, false, { Password: 'aaaaaaaa1', PasswordShow: 'aaaaaaaa1' }), ent(1, true, { Password: 'bbbbbbbb2', PasswordShow: 'bbbbbbbb2' })] }, keep) && N.wifiSaveCall({ WiFiModuleSwitch: '1', ResponseList: [ent(1, true, { Password: 'aaaaaaaa1', PasswordShow: 'aaaaaaaa1' }), ent(1, true, { Password: 'bbbbbbbb2', PasswordShow: 'bbbbbbbb2' })] }, keep), /different passwords/);
  eq(N.wifiSaveCall(raw5, { ssid: 'a', auth: 'WPA3PSK', hidden: false, max: 3, pw: 'typed-pass-77' }).Password, Buffer.from('typed-pass-77').toString('base64'));
  eq(N.wifiSaveCall(raw5, { ssid: 'a', auth: 'WPA3PSK', hidden: false, max: 3, pwB64: Buffer.from('saved-pass-88').toString('base64') }).Password, Buffer.from('saved-pass-88').toString('base64'));
  for (const bad of [{ ssid: '', auth: 'OPEN', hidden: false, max: 1 }, { ssid: 'a', auth: 'WEP', hidden: false, max: 1 }, { ssid: 'a', auth: 'OPEN', hidden: 'no', max: 1 }, { ssid: 'a', auth: 'OPEN', hidden: false, max: 0 }, { ssid: 'a', auth: 'OPEN', hidden: false, max: 11 }, { ssid: 'a', auth: 'OPEN', hidden: false, max: '5' },
    { ssid: 'a', auth: 'WPA2PSK', hidden: false, max: 1, pw: 'short' }, { ssid: 'a', auth: 'WPA2PSK', hidden: false, max: 1, pwB64: '!!!!' }]) assert.throws(() => N.wifiSaveCall(raw5, bad), undefined, JSON.stringify(bad));
  assert.throws(() => N.wifiSaveCall(null, null));
  // the form check
  const fc = (o) => N.wifiFormCheck(act, Object.assign({ ssid: 'CE 2', auth: 'WPA2PSKWPA3PSK', hidden: false, max: '7', pw: '' }, o));
  eq(fc({}), { ssid: 'CE 2', auth: 'WPA2PSKWPA3PSK', hidden: false, max: 7, pw: null });
  eq(fc({ pw: 'abcdefgh' }).pw, 'abcdefgh'); assert(/8 to 63/.test(fc({ pw: 'abcdefg' }).error)); assert(/8 to 63/.test(fc({ pw: 'a'.repeat(64) }).error)); assert(/ASCII/.test(fc({ pw: 'caf\u00e9caf\u00e9' }).error));
  assert(/empty/.test(fc({ ssid: '' }).error)); assert(/space/.test(fc({ ssid: 'x ' }).error)); assert(/security/.test(fc({ auth: 'WEP' }).error)); assert(/Max devices/.test(fc({ max: '0' }).error) && /Max devices/.test(fc({ max: '11' }).error) && /Max devices/.test(fc({ max: 'x' }).error) && /Max devices/.test(fc({ max: '' }).error));
  eq(fc({ auth: 'OPEN', pw: 'ignored-1234' }).pw, null);   // open: a typed password is not used
  assert(/none to keep/.test(N.wifiFormCheck(N.wifiActive(N.parseWifi({ WiFiModuleSwitch: '1', ResponseList: [ent(1, true, { AuthMode: 'OPEN', Password: '', PasswordShow: '' })] })), { ssid: 'a', auth: 'WPA2PSK', hidden: false, max: '3', pw: '' }).error));
  // password change detection and the confirming checks
  eq(N.wifiPwChange(raw5, { pw: PW }), false); eq(N.wifiPwChange(raw5, { pw: 'brand-new-pw1' }), true); eq(N.wifiPwChange(raw5, {}), false); eq(N.wifiPwChange(raw5, { pwB64: Buffer.from('old-saved-pw1').toString('base64') }), true);
  eq(N.wifiSame(snap, { ssid: 'CE 2', auth: 'WPA2PSKWPA3PSK', hidden: false, max: 10 }), true); eq(N.wifiSame(snap, { ssid: 'CE 2', auth: 'WPA2PSKWPA3PSK', hidden: true, max: 10 }), false);
  const want7 = { ssid: 'CE 2', auth: 'WPA2PSKWPA3PSK', hidden: false, max: 7 };
  eq(N.wifiReached(act, Object.assign({}, want7, { max: 10 })), true); eq(N.wifiReached(act, want7), false); eq(N.wifiReached(null, want7), false);
  eq(N.wifiReached(Object.assign({}, act, { on: false }), Object.assign({}, want7, { max: 10 })), false);
  eq(N.wifiChangeLines(snap, { ssid: 'AKO', auth: 'OPEN', hidden: true, max: 3 }, true), ['Network name: "CE 2" → "AKO"', 'Security: WPA2-PSK / WPA3-PSK → Open (no password)', 'SSID broadcast: Visible → Hidden', 'Max devices: 10 → 3', 'Password: will change', 'The network will have NO password: anyone in range can join.']);
  assert(!N.wifiChangeLines(snap, { ssid: 'AKO', auth: 'WPA3PSK', hidden: false, max: 10 }, true).join('\n').includes('new-pass'), 'the confirm lines never carry a password');
  // the band calls = the captured bodies
  eq(N.wifiBandCall('2g'), { goformId: 'switchWiFiChip', ChipEnum: 'chip1', GuestEnable: '0' }); eq(N.wifiBandCall('5g'), { goformId: 'switchWiFiChip', ChipEnum: 'chip2', GuestEnable: '0' }); eq(N.wifiBandCall('off'), { goformId: 'switchWiFiModule', SwitchOption: '0' });
  for (const m of ['both', '', undefined, '__proto__', 'on']) assert.throws(() => N.wifiBandCall(m));
  eq(N.wifiBandReached(w5, '5g'), true); eq(N.wifiBandReached(w5, '2g'), false); eq(N.wifiBandReached(w5, 'off'), false); eq(N.wifiBandReached(null, 'off'), false); eq(N.wifiBandReached(w5, 'both'), false);
  eq(N.wifiBandReached(N.parseWifi({ WiFiModuleSwitch: '0', ResponseList: [ent(0, false), ent(1, false)] }), 'off'), true);
  // backup: the old password goes in only when the change would lose it; the key is "Password" so the log redactors hide it
  const cur = snap;
  eq(N.wifiBackupSnap(raw5, cur, { ssid: 'AKO', auth: 'WPA2PSKWPA3PSK', hidden: false, max: 10 }, false), { ssid: 'CE 2', auth: 'WPA2PSKWPA3PSK', hidden: false, max: 10 });
  eq(N.wifiBackupSnap(raw5, cur, { ssid: 'CE 2', auth: 'WPA2PSKWPA3PSK', hidden: false, max: 10 }, true).pwB64, pwB);
  eq(N.wifiBackupSnap(raw5, cur, { ssid: 'CE 2', auth: 'OPEN', hidden: false, max: 10 }, false).pwB64, pwB);
  assert.throws(() => N.wifiBackupSnap({ WiFiModuleSwitch: '1', ResponseList: [ent(1, true, { Password: 'x', PasswordShow: 'x' })] }, cur, { ssid: 'a', auth: 'WPA3PSK', hidden: false, max: 1 }, true), /cannot be saved/);
  // the backup command written for real: nasty names survive the shell and come back unchanged
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'matchi-wifi-'));
  const nasty = ['it\'s a "net"', '$(touch pwned)', '`touch pwned2`', 'a;b&c|d>e', 'back\\slash', "'; rm -rf / #", '\u00e9\u20ac net'];
  for (const name of nasty) {
    const o = Object.assign({}, snap, { ssid: name, pwB64: pwB }), n = Object.assign({}, snap, { ssid: 'AKO' });
    const sh = N.wifiBackupWriteSh(o, n, 1700000000000, tmp);
    const out = cp.execFileSync('/bin/sh', ['-c', sh], { encoding: 'utf8', cwd: tmp }); assert(out.includes('MATCHI_BACKUP_OK'), out);
    const back = N.parseWifiBackup(fs.readFileSync(path.join(tmp, 'wifi_backup.json'), 'utf8'));
    eq(back.old, { ssid: name, auth: 'WPA2PSKWPA3PSK', hidden: false, max: 10, pwB64: pwB }); eq(back.new.ssid, 'AKO'); eq(back.at, 1700000000000);
  }
  assert(!fs.existsSync(path.join(tmp, 'pwned')) && !fs.existsSync(path.join(tmp, 'pwned2')), 'no command in a name was run');
  assert(/"Password":"/.test(fs.readFileSync(path.join(tmp, 'wifi_backup.json'), 'utf8')), 'the saved password sits under the key Password');
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.throws(() => N.wifiBackupWriteSh(snap, snap, 1, '/tmp/x y'), /Bad backup folder/); assert.throws(() => N.wifiBackupWriteSh(snap, snap, 1, '/tmp/../etc'), /Bad backup folder/); assert.throws(() => N.wifiBackupWriteSh({ ssid: '' }, snap, 1));
  assert(/^mkdir -p \/data\/local\/matchitool && umask 077 && printf '%s' '/.test(N.wifiBackupWriteSh(snap, snap, 1)) && N.WIFI_BACKUP_PATH === '/data/local/matchitool/wifi_backup.json');
  eq(N.parseWifiBackup(''), null); eq(N.parseWifiBackup('{"old":{}}'), null); eq(N.parseWifiBackup('junk'), null);
  eq(N.parseWifiBackup('{"old":{"ssid":"a","auth":"OPEN","hidden":false,"max":3,"Password":"QUJDREVGR0g="},"new":{"ssid":"a","auth":"OPEN","hidden":false,"max":3},"at":1}'), null);   // an open network has no password to restore
  eq(N.parseWifiBackup('{"old":{"ssid":"a","auth":"WEP","hidden":false,"max":3},"new":{"ssid":"a","auth":"OPEN","hidden":false,"max":3}}'), null);
}

// ---- The window writes only mobile data off / on (Phase 2); everything else is read only ------------------------------------------------------------------------
assert(!/\.innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(ui), 'net-tools.js must put values on the page with textContent, not markup');
assert(!/setBands|cellLock|cellUnlock|radioCycle|\.at\(/.test(ui), 'net-tools.js must not call another MatchiRadio writer');
const setCalls = ui.match(/R\.setRouter\([^;]*;/g) || [];
assert(setCalls.length === 8 && /^R\.setRouter\(N\.dataCall\(action\), true\)/.test(setCalls[0]) && /^R\.setRouter\(call, true\)/.test(setCalls[1]) && /^R\.setRouter\(steps\[i\], true\)/.test(setCalls[2]) && /^R\.setRouter\(N\.apnAutoCall\(\), true\)/.test(setCalls[3]) && /^R\.setRouter\(call, true\)/.test(setCalls[4]) && /^R\.setRouter\(call, true\)/.test(setCalls[5]) && /^R\.setRouter\(call, true\)/.test(setCalls[6]) && /^R\.setRouter\(call, true\)/.test(setCalls[7]),
  'the only router writes: mobile data, the device call, the APN steps, the MTU call, the DHCP call, the Wi-Fi band call and the Wi-Fi settings call: ' + setCalls.join(' | '));
assert(/askConfirm\(/.test(ui.slice(0, ui.indexOf('R.setRouter('))), 'a confirm dialog comes before the write');
assert(!/\bcall\s*=\s*\{/.test(ui) && (ui.match(/call = N\.(renameCall|blockCall|unblockCall)\(/g) || []).length === 3, 'the device call is always built by net-core.js');
assert((ui.match(/call = N\.mtuCall\(/g) || []).length === 1, 'the MTU call is built by net-core.js');
assert((ui.match(/call = N\.wifiBandCall\(mode\)/g) || []).length === 1 && (ui.match(/call = N\.wifiSaveCall\(raw, want\)/g) || []).length === 1, 'the Wi-Fi calls are built by net-core.js (wifiBandCall / wifiSaveCall)');
assert((ui.match(/call = restore \? N\.lanRestoreCall\(cur, want\) : N\.lanCall\(cur, want\)/g) || []).length === 1, 'the DHCP call is built by net-core.js (lanCall / lanRestoreCall)');
assert(!/\bsteps\s*=\s*\[\s*\{/.test(ui) && (ui.match(/call = N\.apn(DefaultCall|DeleteCall|SaveCall)\(/g) || []).length === 3 && ui.includes('apnApply([N.apnAutoCall()]'), 'every APN call is built by net-core.js');
assert(!/zte\(\s*['"]set['"]/.test(ui) && !/goform_set_cmd_process|goformId/.test(ui), 'net-tools.js must not build a router set call itself (net-core.js does)');
// the password typed into the APN form is emptied as soon as it has been used, and is never put in an attribute
assert(ui.includes("pw.value = ''") && !/setAttribute\([^)]*pass/i.test(ui) && !/attrs?\[[^\]]*pass/i.test(ui), 'the APN form password is cleared after use');
assert(!/localStorage|sessionStorage|document\.cookie/.test(ui), 'net-tools.js stores nothing');
assert(!/setInterval|setTimeout/.test(ui), 'no timers: no polling (plan rule 6); the 30 s wait loop is bounded and starts only after a confirmed switch');
const zteCalls = ui.match(/R\.zte\(([^)]*)\)/g) || [];
assert(zteCalls.length >= 1 && zteCalls.every((c) => /^R\.zte\(\s*'get'/.test(c)), 'every router call in net-tools.js must be a get: ' + zteCalls.join(' | '));
// Root commands: the read-only check, the ping, and the backup file of the MTU change. Every one is a fixed command built in net-core.js (only validated integers go in).
const shCalls = ui.match(/R\.sh\(([^,)]*)/g) || [];
assert(shCalls.length === 15 && shCalls.every((c) => /^R\.sh\((N\.(ROOT_READ_SH|PING_SH|MTU_BACKUP_READ_SH|MTU_BACKUP_DELETE_SH|LAN_BACKUP_READ_SH|LAN_BACKUP_DELETE_SH|WIFI_BACKUP_READ_SH|WIFI_BACKUP_DELETE_SH)|N\.(mtu|lan|wifi)BackupWriteSh\()/.test(c)), 'root calls must all be fixed commands from net-core.js: ' + shCalls.join(' | '));
assert(!/R\.sh\(\s*['"`]/.test(ui) && !/R\.sh\([^)]*\+/.test(ui), 'no root command is built from strings in net-tools.js');
assert(ui.includes('R.beginBusy(') && ui.includes('release()'), 'Live Status is paused while the window is open (plan rule 7)');
assert(!/\.(Password|PasswordShow|passwd|ppp_passwd|apn_ppp_passwd|passphrase)\b|['"](Password|PasswordShow|passwd|ppp_passwd|apn_ppp_passwd|passphrase)['"]/.test(ui), 'the window never reads a password field of the router');
// The router may report Password as Base64 and PasswordShow as plain text (PASSWORD_ENCODE): the plain one is used and a save never double-encodes it.
{
  const plain = '@716241PLDThome@', b = N.b64Ascii(plain);
  const mk = (o) => ({ WiFiModuleSwitch: '1', ResponseList: [Object.assign({ ChipIndex: 1, AccessPointIndex: '0', AccessPointSwitchStatus: '1', SSID: 'CE 2', ApMaxStationNumber: 10, AuthMode: 'WPA2PSKWPA3PSK', ApBroadcastDisabled: '0', EncrypType: '' }, o)] });
  const keep = { ssid: 'CE 2', auth: 'WPA2PSKWPA3PSK', hidden: false, max: 2 };
  for (const o of [{ Password: b, PasswordShow: b }, { Password: b, PasswordShow: plain }, { Password: plain, PasswordShow: b }, { Password: plain, PasswordShow: plain }]) {
    assert.strictEqual(N.wifiPlainPw(mk(o)), plain);
    assert.strictEqual(N.wifiSaveCall(mk(o), keep).Password, b, 'sent as Base64 of the plain password, once');
  }
}
console.log('net tools ok: parsers for 6 tabs, password never copied, the window writes only mobile data, device rename / block / unblock, the APN calls, the MTU call, the DHCP pool / lease call and the Wi-Fi band and settings calls, all built by net-core.js');

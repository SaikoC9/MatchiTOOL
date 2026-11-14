/*
 * MatchiNetCore - the pure part of the Network window (web-src/net-tools.js): which router keys to read, how to turn the router's
 * answers into plain objects, and the small text helpers. No document, no api(), no router call in here, so node can test it
 * without a router (scripts/test_net_tools.js). Plan and the values seen on the F50: MatchiTOOL_Network_Tools_PLAN.txt (Phase 0).
 *
 * Rules kept here:
 *  - A key the router leaves EMPTY means "not reported": every parser gives null for it, never 0 / "off" (the tab then says so).
 *  - The Wi-Fi password and APN passwords are NEVER copied into a parsed object (the router's reply holds them in clear text).
 *  - Reads need no gate. The write calls built here: mobile data off / on (Phase 2, dataCall) and device rename / block / unblock (Phase 4); more come with later phases.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.MatchiNetCore = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // ---- What each tab reads (goform_get_cmd_process, multi_data=1, comma list) -------------------------------------------------
  const READ = {
    data: 'ppp_status,dial_mode,roam_setting_option,dial_roam_setting_option',
    wifi: 'queryWiFiModuleSwitch,queryAccessPointInfo,wifi_access_sta_num',
    devices: 'station_list,lan_station_list,wifi_access_sta_num,AclMode,BlackMacList,BlackNameList,WhiteMacList,WhiteNameList',
    apn: 'apn_mode,apn_auto_profile,APN_config,ipv6_APN_config',
    lan: 'lan_ipaddr,lan_netmask,dhcpEnabled,dhcpStart,dhcpEnd,dhcpLease_hour,mac_address',
    mtu: 'mtu,tcp_mss',
  };
  const TABS = [
    ['data', 'Data'], ['wifi', 'Wi-Fi'], ['devices', 'Devices'], ['apn', 'APN'], ['lan', 'LAN / DHCP'], ['mtu', 'MTU / MSS'],
  ];

  // ---- Small helpers ----------------------------------------------------------------------------------------------------------
  // Empty, undefined and null all mean "the router does not report this".
  const clean = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
  const num = (v) => { const t = clean(v); if (t === null || !/^-?\d+$/.test(t)) return null; return parseInt(t, 10); };
  // The router sends some lists as an array and some as a JSON string; a plain non-JSON string is not a list.
  const toList = (v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.trim()) { try { const j = JSON.parse(v); return Array.isArray(j) ? j : []; } catch (_) { return []; } }
    return [];
  };
  // Look for a key at the top level first, then one level down (a multi-key read may nest a query's answer under the query's name).
  const pick = (d, name) => {
    if (!d || typeof d !== 'object') return undefined;
    if (d[name] !== undefined) return d[name];
    for (const k of Object.keys(d)) {
      let v = d[k];
      if (typeof v === 'string' && v.trim().startsWith('{')) { try { v = JSON.parse(v); } catch (_) { continue; } }
      if (v && typeof v === 'object' && !Array.isArray(v) && v[name] !== undefined) return v[name];
    }
    return undefined;
  };
  const isObj = (d) => !!d && typeof d === 'object' && !Array.isArray(d);
  // Lower-case, colon separated; anything that is not 12 hex digits is returned as it came (trimmed).
  const normMac = (m) => {
    const t = String(m == null ? '' : m).trim();
    const h = t.replace(/[^0-9A-Fa-f]/g, '');
    return /^[0-9A-Fa-f]{12}$/.test(h) && t.replace(/[0-9A-Fa-f:.-]/g, '') === '' ? h.toLowerCase().replace(/(..)(?=.)/g, '$1:') : t;
  };
  const isPassKey = (k) => /pass(wd|word|phrase)|^pwd$|_pwd$/i.test(String(k));

  // Hide secrets in text that is shown on screen or kept in a log: key=value, key: value and JSON "key":"value" for password-like keys.
  const maskSecrets = (text) => String(text == null ? '' : text).replace(
    /(\b[\w-]*(?:passwd|password(?:show)?|passphrase|pwd))("?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&"']+)/gi,
    (a, k, sep) => k + sep + '[hidden]');

  // ---- Data -------------------------------------------------------------------------------------------------------------------
  // The F50 reports ipv4_ipv6_connected, so this is a FAMILY of values, not one string. Anything that is neither is "changing".
  function connState(ppp) {
    const t = clean(ppp); if (t === null) return null;
    const s = t.toLowerCase();
    if (s.includes('disconnected')) return 'disconnected';
    if (s.includes('connected')) return 'connected';
    return 'changing';
  }
  const modeLabel = (v) => { const t = clean(v); return t === null ? null : t === 'auto_dial' ? 'Automatic' : t === 'manual_dial' || t === 'manual' ? 'Manual' : t; };
  const onOff = (v) => { const t = clean(v); return t === null ? null : t === '1' || t.toLowerCase() === 'on' || t.toLowerCase() === 'true' ? 'On' : t === '0' || t.toLowerCase() === 'off' || t.toLowerCase() === 'false' ? 'Off' : t; };
  // Mobile data off / on (Phase 2). Request bodies captured from the stock page on the F50 (2026-11-14, AD token added by the host):
  //   isTest=false&notCallback=true&goformId=DISCONNECT_NETWORK      isTest=false&notCallback=true&goformId=CONNECT_NETWORK
  // Off reads ppp_disconnected afterwards. Both goformIds need the fresh sign-in (NetGoform.kt).
  const DATA_CALLS = {
    off: { goformId: 'DISCONNECT_NETWORK', notCallback: 'true' },
    on: { goformId: 'CONNECT_NETWORK', notCallback: 'true' },
  };
  function dataCall(action) {
    if (!Object.prototype.hasOwnProperty.call(DATA_CALLS, action)) throw new Error('Unknown mobile data action: ' + action);
    return Object.assign({}, DATA_CALLS[action]);
  }
  // The action the Data tab offers for a state: connected -> "off", disconnected -> "on", anything else (changing, unknown) -> none.
  const dataNext = (state) => (state === 'connected' ? 'off' : state === 'disconnected' ? 'on' : null);
  // Did the re-read reach the wanted state? action "off" wants disconnected, "on" wants connected.
  const dataReached = (action, state) => (action === 'off' ? state === 'disconnected' : action === 'on' ? state === 'connected' : false);
  function parseData(d) {
    if (!isObj(d)) return null;
    const ppp = clean(d.ppp_status);
    return { ppp, state: connState(ppp), mode: clean(d.dial_mode), modeLabel: modeLabel(d.dial_mode), roaming: onOff(d.roam_setting_option) };
  }

  // ---- Wi-Fi ------------------------------------------------------------------------------------------------------------------
  // Bands are told apart by ChipIndex (AccessPointIndex is "0" in both entries on the F50). Chip 0 = 2.4 GHz and chip 1 = 5 GHz is a strong
  // guess from the stock page (chip 1 is the one that is on while the page says 5.0GHz Only), not confirmed yet: the label says so.
  const chipLabel = (chip) => (chip === 0 ? 'Chip 0 (probably 2.4 GHz)' : chip === 1 ? 'Chip 1 (probably 5 GHz)' : chip === null ? 'Unknown band' : 'Chip ' + chip);
  const authLabel = (v) => {
    const t = clean(v); if (t === null) return null;
    const MAP = { OPEN: 'Open', WPA2PSK: 'WPA2-PSK', WPA3PSK: 'WPA3-PSK', WPA2PSKWPA3PSK: 'WPA2-PSK / WPA3-PSK', WPAPSKWPA2PSK: 'WPA-PSK / WPA2-PSK', WPAPSK: 'WPA-PSK' };
    return MAP[t.toUpperCase()] || t;
  };
  function parseWifi(d) {
    if (!isObj(d)) return null;
    const sw = clean(pick(d, 'WiFiModuleSwitch'));
    const entries = toList(pick(d, 'ResponseList')).filter(isObj).map((e) => {
      const chip = num(e.ChipIndex);
      const dis = clean(e.ApBroadcastDisabled);
      // Only named fields are copied: Password and PasswordShow stay out of the object on purpose.
      return {
        chip, band: chipLabel(chip), on: clean(e.AccessPointSwitchStatus) === null ? null : clean(e.AccessPointSwitchStatus) === '1',
        ssid: clean(e.SSID), auth: authLabel(e.AuthMode), authRaw: clean(e.AuthMode),
        broadcast: dis === null ? null : dis === '0', maxStations: num(e.ApMaxStationNumber), country: clean(e.CountryCode),
      };
    });
    if (sw === null && !entries.length) return { moduleOn: null, entries: [], clients: num(d.wifi_access_sta_num) };
    return { moduleOn: sw === null ? null : sw === '1', entries, clients: num(d.wifi_access_sta_num) };
  }
  // The mode the stock page shows: one of "2.4 GHz only", "5 GHz only", "Off" (null when it cannot be told).
  function wifiSummary(w) {
    if (!w || w.moduleOn === null) return null;
    if (!w.moduleOn) return 'Off';
    const on = w.entries.filter((e) => e.on);
    if (!on.length) return 'Off';
    if (on.length > 1) return 'Both chips on';
    return on[0].chip === 0 ? '2.4 GHz only (probably)' : on[0].chip === 1 ? '5 GHz only (probably)' : 'On';
  }

  // ---- Devices ----------------------------------------------------------------------------------------------------------------
  // station_list = Wi-Fi, lan_station_list = cable. Each entry has only mac_addr, hostname, ip_addr (mac_address is accepted too).
  const devRow = (e, type) => ({ type, name: clean(e.hostname) || '', ip: clean(e.ip_addr) || '', mac: normMac(e.mac_addr !== undefined ? e.mac_addr : e.mac_address) });
  const ipKey = (ip) => String(ip).split('.').map((x) => ('000' + x).slice(-3)).join('.');
  function mergeDevices(wifi, cable) {
    const seen = new Set(), out = [];
    for (const [list, type] of [[toList(wifi), 'Wi-Fi'], [toList(cable), 'Cable']]) {
      for (const e of list) {
        if (!isObj(e)) continue;
        const r = devRow(e, type);
        if (!r.mac && !r.ip && !r.name) continue;
        const k = r.mac ? r.mac.toLowerCase() : r.type + '|' + r.ip + '|' + r.name;
        if (seen.has(k)) continue;   // the same device in both lists is shown once, as Wi-Fi
        seen.add(k); out.push(r);
      }
    }
    const rank = (t) => (t === 'Wi-Fi' ? 0 : 1);
    out.sort((a, b) => rank(a.type) - rank(b.type) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || ipKey(a.ip).localeCompare(ipKey(b.ip)));
    return out;
  }
  // null = neither list key came back at all (hide the tab's table); [] = reported but nobody is connected.
  function parseDevices(d) {
    if (!isObj(d)) return null;
    const hasW = d.station_list !== undefined, hasC = d.lan_station_list !== undefined;
    if (!hasW && !hasC) return null;
    const rows = mergeDevices(d.station_list, d.lan_station_list);
    return { rows, wifi: rows.filter((r) => r.type === 'Wi-Fi').length, cable: rows.filter((r) => r.type === 'Cable').length, routerCount: num(d.wifi_access_sta_num), wifiReported: hasW, cableReported: hasC };
  }

  // ---- Devices: rename, block, unblock (Phase 4) ------------------------------------------------------------------------------
  // Captured on the F50 (2026-11-15), AD added by the host:
  //   rename:  isTest=false&goformId=EDIT_HOSTNAME&mac=28%3A56%3A5a%3A3a%3Aef%3A6f&hostname=ako
  //   block:   goformId=setDeviceAccessControlList&isTest=false&AclMode=2&WhiteMacList=&BlackMacList=52%3Ae3...%3B&WhiteNameList=&BlackNameList=POCO-F6%3B
  //   unblock: same call with every list empty (the call always carries the WHOLE set, so the tool reads the current lists first).
  // Lists are ";" terminated ("mac;" / "name;", several back to back). AclMode=2 is the block-list mode the stock page sends.
  const isMac = (m) => /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(String(m == null ? '' : m).trim());
  const splitAcl = (v) => { const t = clean(v); return t === null ? [] : t.split(';').map((x) => x.trim()).filter(Boolean); };
  function parseAcl(d) {
    if (!isObj(d)) return null;
    const macs = splitAcl(d.BlackMacList).map(normMac), names = splitAcl(d.BlackNameList);
    const black = macs.map((mac, i) => ({ mac, name: names[i] || '' }));
    return { mode: clean(d.AclMode), black, whiteMacs: splitAcl(d.WhiteMacList), whiteNames: splitAcl(d.WhiteNameList) };
  }
  // Why blocking / unblocking must not touch the lists (null = fine). A white list in use is a mode we never captured: do not guess it.
  function aclRefusal(acl) {
    if (!acl) return 'The router did not report its block list, so it is not changed here.';
    if (acl.whiteMacs.length || acl.mode === '1') return 'The router uses an allow list (white list). Blocking is not changed here because that mode was not captured.';
    return null;
  }
  // Host names: letters, digits, space, dot, dash, underscore; 1 to 31 characters. (Narrower than the router, on purpose: ";" "&" "=" "%" would break the
  // forms that carry the name.)
  const hostnameError = (n) => {
    const t = String(n == null ? '' : n).trim();
    if (!t) return 'The name is empty.';
    if (t.length > 31) return 'The name is longer than 31 characters.';
    if (!/^[A-Za-z0-9 ._-]+$/.test(t)) return 'Use only letters, digits, space, dot, dash and underscore.';
    return null;
  };
  function renameCall(mac, name) {
    if (!isMac(mac)) throw new Error('Not a MAC address: ' + mac);
    const e = hostnameError(name); if (e) throw new Error(e);
    return { goformId: 'EDIT_HOSTNAME', mac: normMac(mac), hostname: String(name).trim() };
  }
  const aclText = (l) => l.map((x) => x + ';').join('');
  const aclName = (n) => { const t = String(n == null ? '' : n).replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 31); return t || 'device'; };
  function aclCall(black) {
    return { goformId: 'setDeviceAccessControlList', AclMode: '2', WhiteMacList: '', BlackMacList: aclText(black.map((b) => b.mac)), WhiteNameList: '', BlackNameList: aclText(black.map((b) => aclName(b.name))) };
  }
  function blockCall(acl, mac, name) {
    const r = aclRefusal(acl); if (r) throw new Error(r);
    if (!isMac(mac)) throw new Error('Not a MAC address: ' + mac);
    const m = normMac(mac);
    if (acl.black.some((b) => b.mac === m)) throw new Error('This device is already blocked.');
    return aclCall(acl.black.concat([{ mac: m, name }]));
  }
  function unblockCall(acl, mac) {
    const r = aclRefusal(acl); if (r) throw new Error(r);
    const m = normMac(mac);
    if (!acl.black.some((b) => b.mac === m)) throw new Error('This device is not in the block list.');
    return aclCall(acl.black.filter((b) => b.mac !== m));
  }
  // The address a request comes from, as the router lists it ("::ffff:192.168.0.179" -> "192.168.0.179").
  const plainIp = (ip) => String(ip == null ? '' : ip).trim().replace(/^::ffff:/i, '');
  const isSelf = (rowIp, myIp) => { const a = plainIp(rowIp), b = plainIp(myIp); return a !== '' && a === b; };

  // ---- APN --------------------------------------------------------------------------------------------------------------------
  // In Auto mode the F50 returns APN_config and ipv6_APN_config EMPTY, and the key that holds the profile list is not known yet.
  // So Phase 1 shows the mode and whatever comes back, with every password-like field removed. A non-list text is shown masked.
  function stripPass(o) {
    if (Array.isArray(o)) return o.map(stripPass);
    if (!isObj(o)) return o;
    const r = {}; for (const k of Object.keys(o)) { if (!isPassKey(k)) r[k] = stripPass(o[k]); }
    return r;
  }
  function apnConfig(v) {
    const t = clean(v); if (t === null) return null;
    const l = toList(v);
    if (l.length) return { kind: 'list', items: l.map(stripPass) };
    return { kind: 'text', text: maskSecrets(t) };
  }
  function parseApn(d) {
    if (!isObj(d)) return null;
    return { mode: clean(d.apn_mode), autoProfile: clean(d.apn_auto_profile), v4: apnConfig(d.APN_config), v6: apnConfig(d.ipv6_APN_config) };
  }
  // One readable line for a profile object (only the fields UFI's names say exist; passwords are already gone).
  function apnLine(p) {
    if (!isObj(p)) return String(p);
    const name = clean(p.profile_name || p.apn_m_profile_name || p.name) || '(no name)';
    const apn = clean(p.apn || p.wan_apn || p.apn_wan_apn) || '';
    const pdp = clean(p.pdp_type || p.apn_pdp_type) || '';
    return [name, apn, pdp].filter(Boolean).join(' · ');
  }

  // ---- LAN / DHCP -------------------------------------------------------------------------------------------------------------
  // dhcpLease_hour comes as a STRING with an "h" on the end ("24h"). null when it is not a whole number of hours.
  function parseLease(v) {
    const t = clean(v); if (t === null) return null;
    const m = t.match(/^(\d+)\s*h?$/i);
    return m ? parseInt(m[1], 10) : null;
  }
  const leaseText = (h) => (h === null || h === undefined ? null : h + (h === 1 ? ' hour' : ' hours'));
  function parseLan(d) {
    if (!isObj(d)) return null;
    const leaseRaw = clean(d.dhcpLease_hour);
    return {
      ip: clean(d.lan_ipaddr), mask: clean(d.lan_netmask), dhcp: onOff(d.dhcpEnabled), start: clean(d.dhcpStart), end: clean(d.dhcpEnd),
      leaseRaw, leaseHours: parseLease(leaseRaw), mac: clean(d.mac_address),
    };
  }

  // ---- MTU / MSS --------------------------------------------------------------------------------------------------------------
  function parseMtu(d) {
    if (!isObj(d)) return null;
    const mtu = num(d.mtu), mss = num(d.tcp_mss);
    // The stock default is MSS = MTU - 40 (1500 / 1460). A larger MSS is worth a note; smaller is fine.
    const warn = mtu !== null && mss !== null && mss > mtu - 40 ? 'MSS is larger than MTU minus 40 (' + (mtu - 40) + ')' : null;
    return { mtu, mss, warn };
  }
  // One root command, read-only. Section marker lines split the output. Nothing here changes a rule or an interface.
  const ROOT_READ_SH =
    "echo '##route'; ip route get 1.1.1.1 2>&1; " +
    "echo '##link'; ip -o link show 2>&1; " +
    "echo '##filter'; iptables -S 2>&1 | grep -i TCPMSS; " +
    "echo '##mangle'; iptables -t mangle -S 2>&1 | grep -i TCPMSS; " +
    "echo '##filter6'; ip6tables -S 2>&1 | grep -i TCPMSS; " +
    "echo '##mangle6'; ip6tables -t mangle -S 2>&1 | grep -i TCPMSS; " +
    "echo '##end'";
  function sections(text) {
    const out = {}; let cur = null;
    for (const line of String(text == null ? '' : text).replace(/\r/g, '').split('\n')) {
      const m = line.match(/^##([a-z0-9]+)$/);
      if (m) { cur = m[1]; out[cur] = []; continue; }
      if (cur && line.trim()) out[cur].push(line.trim());
    }
    return out;
  }
  // WAN = the device that carries the route to 1.1.1.1 (found at run time, never hard-coded). Its MTU comes from "ip -o link show".
  function parseRootNet(text) {
    const s = sections(text);
    if (!s.route && !s.link) return null;
    const route = (s.route || []).join(' ');
    const dev = (route.match(/\bdev\s+([A-Za-z0-9_.:-]+)/) || [])[1] || null;
    const src = (route.match(/\bsrc\s+([0-9.]+)/) || [])[1] || null;
    let wanMtu = null, wanState = null;
    if (dev) {
      for (const l of s.link || []) {
        const m = l.match(/^\d+:\s+([^:@\s]+)(?:@\S+)?:\s+<([^>]*)>\s+mtu\s+(\d+)/);
        if (m && m[1] === dev) { wanMtu = parseInt(m[3], 10); wanState = /\bUP\b/.test(m[2]) ? 'UP' : 'DOWN'; }
      }
    }
    // Rules are listed as they are. The stock page writes every one twice (INPUT and OUTPUT, duplicated), which is how the stock boot builds them.
    const rules = (name, family) => (s[name] || []).filter((l) => /^-[AI]\s/.test(l)).map((l) => ({ family, table: name.startsWith('mangle') ? 'mangle' : 'filter', text: l }));
    const list = [...rules('filter', 'IPv4'), ...rules('mangle', 'IPv4'), ...rules('filter6', 'IPv6'), ...rules('mangle6', 'IPv6')];
    return { wanDev: dev, wanSrc: src, wanMtu, wanState, rules: list, noRoute: !dev };
  }

  return {
    READ, TABS, ROOT_READ_SH,
    clean, num, toList, pick, normMac, maskSecrets, isPassKey, stripPass,
    connState, modeLabel, onOff, parseData, dataCall, dataNext, dataReached,
    chipLabel, authLabel, parseWifi, wifiSummary,
    mergeDevices, parseDevices, isMac, parseAcl, aclRefusal, hostnameError, renameCall, blockCall, unblockCall, plainIp, isSelf,
    apnConfig, parseApn, apnLine,
    parseLease, leaseText, parseLan,
    parseMtu, sections, parseRootNet,
  };
});

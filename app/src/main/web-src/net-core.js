/*
 * MatchiNetCore - the pure part of the Network window (web-src/net-tools.js): which router keys to read, how to turn the router's
 * answers into plain objects, and the small text helpers. No document, no api(), no router call in here, so node can test it
 * without a router (scripts/test_net_tools.js). The values seen on the F50 are written down in docs/NETWORK_FORMATS.md.
 *
 * Rules kept here:
 *  - A key the router leaves EMPTY means "not reported": every parser gives null for it, never 0 / "off" (the tab then says so).
 *  - The Wi-Fi password and APN passwords are NEVER copied into a parsed object (the router's reply holds them in clear text).
 *  - Reads need no gate. The write calls are built further down: mobile data off / on (dataCall), devices, APN, Wi-Fi, LAN / DHCP and MTU / MSS.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.MatchiNetCore = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // The APN tab reads the same key list as the stock page (js/service.js, F50 2026-11-15): 20 numbered profile slots for IPv4 and IPv6, plus the keys of
  // the profile in use. apn_interface_version is EMPTY on this firmware, so the plain keys apply (a value of 2 or more would mean the *_ui keys).
  const APN_SLOTS = 20;
  const APN_READ = ['apn_interface_version',
    ...Array.from({ length: APN_SLOTS }, (_, i) => 'APN_config' + i), ...Array.from({ length: APN_SLOTS }, (_, i) => 'ipv6_APN_config' + i),
    'm_profile_name', 'profile_name', 'wan_dial', 'apn_select', 'pdp_type', 'pdp_select', 'pdp_addr', 'index', 'Current_index', 'apn_auto_config', 'ipv6_apn_auto_config',
    'apn_mode', 'wan_apn', 'ppp_auth_mode', 'ppp_username', 'ppp_passwd', 'dns_mode', 'prefer_dns_manual', 'standby_dns_manual',
    'ipv6_wan_apn', 'ipv6_pdp_type', 'ipv6_ppp_auth_mode', 'ipv6_ppp_username', 'ipv6_ppp_passwd', 'ipv6_dns_mode', 'ipv6_prefer_dns_manual', 'ipv6_standby_dns_manual',
    'apn_num_preset'].join(',');

  // ---- What each tab reads (goform_get_cmd_process, multi_data=1, comma list) -------------------------------------------------
  const READ = {
    data: 'ppp_status,dial_mode,roam_setting_option,dial_roam_setting_option',
    wifi: 'queryWiFiModuleSwitch,queryAccessPointInfo,wifi_access_sta_num',
    devices: 'station_list,lan_station_list,wifi_access_sta_num',
    apn: APN_READ,
    lan: 'lan_ipaddr,lan_netmask,dhcpEnabled,dhcpStart,dhcpEnd,dhcpLease_hour,mac_address',
    mtu: 'mtu,tcp_mss',
  };
  // The Devices tab also reads two single commands (NOT multi_data; seen in the stock page's script service.js on the F50, 2026-11-15):
  //   queryDeviceAccessControlList -> {AclMode, WhiteMacList, BlackMacList, WhiteNameList, BlackNameList}  (lists are ";" terminated)
  //   hostNameList                 -> {devices:[{hostname, mac}]}  (the names the stock page shows; EDIT_HOSTNAME changes these, not station_list)
  const READ_ACL = 'queryDeviceAccessControlList', READ_NAMES = 'hostNameList';
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
  // Mobile data off / on. Request bodies captured from the stock page on the F50 (2026-11-14, AD token added by the host):
  //   isTest=false&notCallback=true&goformId=DISCONNECT_NETWORK      isTest=false&notCallback=true&goformId=CONNECT_NETWORK
  // Off reads ppp_disconnected afterwards. Both goformIds need the fresh sign-in (NetGoform.kt: every set call not in OPEN_SET does).
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
  // Bands are told apart by ChipIndex (AccessPointIndex is "0" in both entries on the F50). Chip 0 = 2.4 GHz and chip 1 = 5 GHz: chip 1 is the one that is on
  // while the stock page says 5.0GHz Only, and the captured band switch agrees (ChipEnum=chip1 is "2.4GHz Only", chip2 is "5.0GHz Only", part M of the plan).
  // The Wi-Fi tab still checks it after every band switch: the re-read must show the wanted chip on.
  const chipLabel = (chip) => (chip === 0 ? 'Chip 0 (2.4 GHz)' : chip === 1 ? 'Chip 1 (5 GHz)' : chip === null ? 'Unknown band' : 'Chip ' + chip);
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
        // Only whether the router reports a password, never the password itself.
        pwSet: clean(e.Password) !== null || clean(e.PasswordShow) !== null,
      };
    });
    if (sw === null && !entries.length) return { moduleOn: null, entries: [], clients: num(d.wifi_access_sta_num) };
    return { moduleOn: sw === null ? null : sw === '1', entries, clients: num(d.wifi_access_sta_num) };
  }
  // Which band is on: 'off', '2g', '5g', 'both' (both chips report on), 'other' (an unknown chip), or null when it cannot be told.
  function wifiMode(w) {
    if (!w || w.moduleOn === null) return null;
    if (!w.moduleOn) return 'off';
    const on = w.entries.filter((e) => e.on);
    if (!on.length) return 'off';
    if (on.length > 1) return 'both';
    return on[0].chip === 0 ? '2g' : on[0].chip === 1 ? '5g' : 'other';
  }
  // The mode the stock page shows: one of "2.4 GHz only", "5 GHz only", "Off" (null when it cannot be told).
  function wifiSummary(w) {
    const m = wifiMode(w);
    return m === null ? null : { off: 'Off', both: 'Both chips on', '2g': '2.4 GHz only', '5g': '5 GHz only', other: 'On' }[m];
  }
  // The one band that is on (its parsed entry), or null when none or both are on.
  const wifiActive = (w) => { const on = w && w.entries ? w.entries.filter((e) => e.on) : []; return on.length === 1 ? on[0] : null; };

  // ---- Devices ----------------------------------------------------------------------------------------------------------------
  // station_list = Wi-Fi, lan_station_list = cable. Each entry has only mac_addr, hostname, ip_addr (mac_address is accepted too).
  const devRow = (e, type, names) => { const mac = normMac(e.mac_addr !== undefined ? e.mac_addr : e.mac_address); return { type, name: (names && names[mac.toLowerCase()]) || clean(e.hostname) || '', ip: clean(e.ip_addr) || '', mac }; };
  const ipKey = (ip) => String(ip).split('.').map((x) => ('000' + x).slice(-3)).join('.');
  // names: optional {mac -> name} from hostNameList; it wins over the hostname in station_list (the stock page does the same).
  function mergeDevices(wifi, cable, names) {
    const seen = new Set(), out = [];
    for (const [list, type] of [[toList(wifi), 'Wi-Fi'], [toList(cable), 'Cable']]) {
      for (const e of list) {
        if (!isObj(e)) continue;
        const r = devRow(e, type, names);
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
  const nameMap = (l) => { const m = {}; for (const e of toList(l)) if (isObj(e) && clean(e.mac) && clean(e.hostname)) m[normMac(e.mac).toLowerCase()] = clean(e.hostname); return m; };
  // null = neither list key came back at all (hide the tab's table); [] = reported but nobody is connected.
  function parseDevices(d) {
    if (!isObj(d)) return null;
    const hasW = d.station_list !== undefined, hasC = d.lan_station_list !== undefined;
    if (!hasW && !hasC) return null;
    const rows = mergeDevices(d.station_list, d.lan_station_list, nameMap(d.hostNameList));
    return { rows, wifi: rows.filter((r) => r.type === 'Wi-Fi').length, cable: rows.filter((r) => r.type === 'Cable').length, routerCount: num(d.wifi_access_sta_num), wifiReported: hasW, cableReported: hasC };
  }

  // ---- Devices: rename, block, unblock ------------------------------------------------------------------------------
  // Captured on the F50 (2026-11-15), AD added by the host:
  //   rename:  isTest=false&goformId=EDIT_HOSTNAME&mac=28%3A56%3A5a%3A3a%3Aef%3A6f&hostname=ako
  //   block:   goformId=setDeviceAccessControlList&isTest=false&AclMode=2&WhiteMacList=&BlackMacList=52%3Ae3...%3B&WhiteNameList=&BlackNameList=POCO-F6%3B
  //   unblock: same call with every list empty (the call always carries the WHOLE set, so the tool reads the current lists first).
  // Lists are ";" terminated ("mac;" / "name;", several back to back). AclMode=2 is the block-list mode the stock page sends.
  const isMac = (m) => /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(String(m == null ? '' : m).trim());
  const splitAcl = (v) => { const t = clean(v); return t === null ? [] : t.split(';').map((x) => x.trim()).filter(Boolean); };
  function parseAcl(d) {
    if (!isObj(d) || (d.BlackMacList === undefined && d.AclMode === undefined)) return null;   // not read: never guess the current list
    const macs = splitAcl(d.BlackMacList).map(normMac), names = splitAcl(d.BlackNameList);
    const black = macs.map((mac, i) => ({ mac, name: names[i] || '' }));
    return { mode: clean(d.AclMode), black, whiteMacs: splitAcl(d.WhiteMacList), whiteNames: splitAcl(d.WhiteNameList) };
  }
  // Why blocking / unblocking must not touch the lists (null = fine). A white list in use is a mode we never captured: do not guess it.
  function aclRefusal(acl) {
    if (!acl) return 'Block list unavailable. No change made.';
    if (acl.whiteMacs.length || acl.mode === '1') return 'Router uses an allow list. Blocking is unavailable.';
    return null;
  }
  // Host names: letters, digits, space, dot, dash, underscore; 1 to 31 characters. (Narrower than the router, on purpose: ";" "&" "=" "%" would break the
  // forms that carry the name.)
  const hostnameError = (n) => {
    const t = String(n == null ? '' : n).trim();
    if (!t) return 'The name is empty.';
    if (t.length > 31) return 'Name exceeds 31 characters.';
    if (!/^[A-Za-z0-9 ._-]+$/.test(t)) return 'Allowed: letters, digits, space, . - _';
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
    if (acl.black.some((b) => b.mac === m)) throw new Error('Already blocked.');
    return aclCall(acl.black.concat([{ mac: m, name }]));
  }
  function unblockCall(acl, mac) {
    const r = aclRefusal(acl); if (r) throw new Error(r);
    const m = normMac(mac);
    if (!acl.black.some((b) => b.mac === m)) throw new Error('Not blocked.');
    return aclCall(acl.black.filter((b) => b.mac !== m));
  }
  // The address a request comes from, as the router lists it ("::ffff:192.168.0.179" -> "192.168.0.179").
  const plainIp = (ip) => String(ip == null ? '' : ip).trim().replace(/^::ffff:/i, '');
  const isSelf = (rowIp, myIp) => { const a = plainIp(rowIp), b = plainIp(myIp); return a !== '' && a === b; };

  // Removes every password-like key from a nested reply (kept for callers that show a raw reply).
  function stripPass(o) {
    if (Array.isArray(o)) return o.map(stripPass);
    if (!isObj(o)) return o;
    const r = {}; for (const k of Object.keys(o)) { if (!isPassKey(k)) r[k] = stripPass(o[k]); }
    return r;
  }
  // ---- APN ----------------------------------------------------------------------------------------------------------
  // Read (F50, 2026-11-15, router in Auto mode): the profiles are in APN_config0..19, one string per slot, fields joined by "($)":
  //   "default($)default($)manual($)*99#($)none($)($)($)IPv4v6($)($)($)($)($)"
  //   position 0 name, 1 APN, 2 select, 3 dial, 4 auth, 5 and 6 = user name / password (order NOT confirmed: never shown, never copied), 7 PDP type, 8-11 unknown.
  // In Auto mode the profile in use is apn_auto_config (same layout) and index / Current_index come back EMPTY.
  // Writes, all APN_PROC_EX (bodies from the stock page on the F50, AD added by the host):
  //   Auto:        apn_mode=auto                                                      (captured; no apn_action, touches no profile)
  //   Save:        apn_action=save&apn_mode=manual&profile_name&wan_dial=*99#&apn_select=manual&pdp_type&pdp_select=auto&pdp_addr=&index&wan_apn&
  //                ppp_auth_mode&ppp_username&ppp_passwd&dns_mode=auto&prefer_dns_manual=&standby_dns_manual=&ipv6_*  (captured, IPv4v6)
  //   Set default: apn_mode=manual&apn_action=set_default&set_default_flag=1&pdp_type&index                       (captured)
  //   Delete:      apn_action=delete&apn_mode=manual&index                                                         (from the stock script, NOT captured)
  // EVERY write except Auto carries apn_mode=manual: it switches the router to Manual mode. On 2026-11-15 a blank "default" profile saved that way
  // into slot 0 took the data connection down. So this file only offers a write when the router is already in Manual mode, plus ONE way in
  // from Auto ("use this profile" = set_default of a profile that has an APN), and always keeps the Auto call one tap away.
  const APN_SEP = '($)';
  const PDP_TYPES = ['IPv4v6', 'IP', 'IPv6'];
  const APN_AUTH = ['none', 'pap', 'chap'];
  // One profile string -> name, apn, auth, pdp. User name and password positions are deliberately left out.
  function parseProfile(v) {
    const t = clean(v); if (t === null) return null;
    const f = String(v).split(APN_SEP);
    if (f.length < 8) return null;   // not the layout we know: do not guess
    const name = clean(f[0]) || '', apn = clean(f[1]) || '', auth = (clean(f[4]) || 'none').toLowerCase(), pdp = clean(f[7]) || '';
    if (!name && !apn) return null;
    return { name, apn, auth, pdp };
  }
  function parseApn(d) {
    if (!isObj(d)) return null;
    const mode = clean(d.apn_mode), ver = num(d.apn_interface_version);
    const profiles = [], seenSlots = [];
    for (let i = 0; i < APN_SLOTS; i++) {
      const raw = clean(d['APN_config' + i]);
      if (raw === null) continue;
      seenSlots.push(i);
      const p = parseProfile(raw);
      if (p) profiles.push(Object.assign({ slot: i }, p));
    }
    const hasSlots = Array.from({ length: APN_SLOTS }, (_, i) => d['APN_config' + i] !== undefined).some(Boolean);
    const auto = parseProfile(d.apn_auto_config);
    const usedName = clean(d.profile_name) || clean(d.m_profile_name), usedApn = clean(d.wan_apn);
    const free = []; for (let i = 0; i < APN_SLOTS; i++) if (clean(d['APN_config' + i]) === null) free.push(i);
    return {
      mode, uiVersion: ver !== null && ver >= 2, hasSlots, profiles, auto,
      inUse: usedName || usedApn ? { name: usedName || '', apn: usedApn || '' } : null,
      indexKeys: [num(d.index), num(d.Current_index)].filter((x) => x !== null),
      freeSlots: free, count: APN_SLOTS,
    };
  }
  // Why APN writes must not go out (null = fine to offer). Nothing is guessed: no mode, no slot keys, or the other key set means hands off.
  function apnRefusal(a) {
    if (!a) return 'APN settings unavailable.';
    if (a.uiVersion) return 'This firmware reports APN settings in a second format (apn_interface_version 2 or more) that was not captured. APN is read only here.';
    if (a.mode !== 'auto' && a.mode !== 'manual') return 'APN mode unknown. No change made.';
    if (!a.hasSlots) return 'The router did not report its profile list, so it is not changed here.';
    return null;
  }
  // The profile in use matches a profile of the list? (by name and APN; the slot keys are only reported in Manual mode and their meaning is not confirmed)
  // Right after a switch the router can report the profile name with an EMPTY wan_apn for a while (seen on the F50, 2026-11-15): an empty APN on either side counts as a name match.
  const sameProfile = (p, name, apn) => !!p && !!name && p.name === name && (p.apn === apn || p.apn === '' || apn === '');
  const isInUse = (a, p) => !!a && !!a.inUse && sameProfile(p, a.inUse.name, a.inUse.apn);
  // Is this slot the one the router calls current? Slot keys are a second signal, used only to refuse a delete, never to claim a success.
  const slotLooksActive = (a, p) => isInUse(a, p) || (a && a.mode === 'manual' && a.indexKeys.includes(p.slot));

  // ---- APN: form checks ----
  const apnNameError = (n) => {
    const t = String(n == null ? '' : n).trim();
    if (!t) return 'The profile name is empty.';
    if (t.length > 31) return 'The profile name is longer than 31 characters.';
    if (!/^[A-Za-z0-9 ._-]+$/.test(t)) return 'Profile name: use only letters, digits, space, dot, dash and underscore.';
    return null;
  };
  const apnApnError = (n) => {
    const t = String(n == null ? '' : n).trim();
    if (!t) return 'The APN is empty.';
    if (t.length > 63) return 'The APN is longer than 63 characters.';
    if (!/^[A-Za-z0-9._-]+$/.test(t)) return 'APN: use only letters, digits, dot, dash and underscore.';
    return null;
  };
  const credOk = (s) => /^[\x21-\x7E]{1,64}$/.test(String(s == null ? '' : s));   // printable, no space, 1-64 (the form body is URL-encoded by the host)
  // f = {name, apn, pdp, auth, user, pass}. Returns the first problem as text, or null.
  function apnFormError(f) {
    if (!f || typeof f !== 'object') return 'No form.';
    return apnNameError(f.name) || apnApnError(f.apn)
      || (PDP_TYPES.includes(f.pdp) ? null : 'Select a PDP type: IPv4v6, IPv4 or IPv6.')
      || (APN_AUTH.includes(f.auth) ? null : 'Select authentication: none, PAP or CHAP.')
      || (f.auth !== 'none' && !credOk(f.user) ? 'User name: 1–64 characters, no spaces.' : null)
      || (f.auth !== 'none' && !credOk(f.pass) ? 'Password: 1 to 64 characters, no spaces. It is not read back from the router, so type it again.' : null);
  }
  const apnSlotOk = (n) => Number.isInteger(n) && n >= 0 && n < APN_SLOTS;
  const pdpWire = (p) => (p === 'IP' ? 'IP' : p === 'IPv6' ? 'IPv6' : 'IPv4v6');
  // ---- APN: calls (object key order = the order of the stock page's body; the host puts isTest first and AD last) ----
  const apnAutoCall = () => ({ goformId: 'APN_PROC_EX', apn_mode: 'auto' });
  function apnSaveCall(f, slot) {
    const e = apnFormError(f); if (e) throw new Error(e);
    if (!apnSlotOk(slot)) throw new Error('Not a profile slot: ' + slot);
    const name = String(f.name).trim(), apn = String(f.apn).trim(), user = f.auth === 'none' ? '' : f.user, pass = f.auth === 'none' ? '' : f.pass;
    const v4 = { wan_apn: apn, ppp_auth_mode: f.auth, ppp_username: user, ppp_passwd: pass, dns_mode: 'auto', prefer_dns_manual: '', standby_dns_manual: '' };
    const v6 = { ipv6_wan_apn: apn, ipv6_ppp_auth_mode: f.auth, ipv6_ppp_username: user, ipv6_ppp_passwd: pass, ipv6_dns_mode: 'auto', ipv6_prefer_dns_manual: '', ipv6_standby_dns_manual: '' };
    const head = { goformId: 'APN_PROC_EX', apn_action: 'save', apn_mode: 'manual', profile_name: name, wan_dial: '*99#', apn_select: 'manual', pdp_type: pdpWire(f.pdp), pdp_select: 'auto', pdp_addr: '', index: String(slot) };
    // The stock script sends the IPv4 part for IP, the IPv6 part for IPv6 and both for IPv4v6 (the IPv6 part mirrors the IPv4 one, as the capture shows).
    return Object.assign(head, f.pdp === 'IP' ? v4 : f.pdp === 'IPv6' ? v6 : Object.assign(v4, v6));
  }
  function apnDefaultCall(slot, pdp) {
    if (!apnSlotOk(slot)) throw new Error('Not a profile slot: ' + slot);
    if (!PDP_TYPES.includes(pdp)) throw new Error('Unknown PDP type: ' + pdp);
    return { goformId: 'APN_PROC_EX', apn_mode: 'manual', apn_action: 'set_default', set_default_flag: '1', pdp_type: pdpWire(pdp), index: String(slot) };
  }
  function apnDeleteCall(slot) {
    if (!apnSlotOk(slot)) throw new Error('Not a profile slot: ' + slot);
    return { goformId: 'APN_PROC_EX', apn_action: 'delete', apn_mode: 'manual', index: String(slot) };
  }
  // ---- APN: which action is allowed now (the UI shows only these; each also throws on its own) ----
  // useProfile: from Auto or Manual, make this profile the one in use. Needs a profile with an APN.
  function apnCanUse(a, p) { return !apnRefusal(a) && !!p && !!p.apn && PDP_TYPES.includes(p.pdp) && !isInUse(a, p); }
  function apnCanEdit(a, p) { return !apnRefusal(a) && a.mode === 'manual' && !!p; }
  function apnCanAdd(a) { return !apnRefusal(a) && a.mode === 'manual' && a.freeSlots.length > 0; }
  // Delete: Manual mode only, never the profile in use, never the last usable profile.
  function apnDeleteRefusal(a, p) {
    const r = apnRefusal(a); if (r) return r;
    if (a.mode !== 'manual') return 'Delete requires Manual mode.';
    if (!p) return 'No such profile.';
    if (slotLooksActive(a, p)) return 'Profile in use. Set another as default, or switch to Auto.';
    if (a.profiles.filter((x) => x.slot !== p.slot && x.apn).length < 1) return 'Only profile. Add another, or switch to Auto.';
    return null;
  }
  // The add form copies the Auto profile (name, APN, auth, PDP) as a starting point; user name and password are never taken from the router.
  const autoAsForm = (a) => (a && a.auto ? { name: a.auto.name, apn: a.auto.apn, pdp: PDP_TYPES.includes(a.auto.pdp) ? a.auto.pdp : 'IPv4v6', auth: APN_AUTH.includes(a.auto.auth) ? a.auto.auth : 'none', user: '', pass: '' } : null);
  const authLabelApn = (v) => ({ none: 'None', pap: 'PAP', chap: 'CHAP' }[String(v).toLowerCase()] || (v || ''));
  const pdpLabel = (v) => ({ IPv4v6: 'IPv4 + IPv6', IP: 'IPv4', IPv6: 'IPv6' }[v] || v || '');

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

  // ---- LAN / DHCP: pool and lease ----------------------------------------------------------------------------------
  // Captured on the F50 (2026-11-14, part C): the stock page sends the WHOLE set every time and THE ROUTER RESTARTS after it:
  //   isTest=false&goformId=DHCP_SETTING&lanIp=192.168.0.1&lanNetmask=255.255.255.0&lanDhcpType=SERVER&dhcpStart=192.168.0.2&dhcpEnd=192.168.0.253
  //   &dhcpLease=24&dhcp_reboot_flag=1&mac_ip_reset=0&AD=<token>          reply {"result":"success"} (before the restart)
  // 6a changes ONLY the pool and the lease: the router IP and mask are sent back exactly as read, DHCP must be On (the "off" value was never captured),
  // so the console address does not change. The allowed lease range is not known: 1 to 168 hours is this tool's own limit (the cautious side).
  const LEASE_MIN = 1, LEASE_MAX = 168;
  const octet = '(0|[1-9]\\d{0,2})';
  const IPV4_RE = new RegExp('^' + [octet, octet, octet, octet].join('\\.') + '$');
  // a.b.c.d -> unsigned 32-bit number, or null (no leading zeros, each part 0-255)
  function ipv4Int(t) {
    const m = IPV4_RE.exec(String(t === undefined || t === null ? '' : t).trim()); if (!m) return null;
    const p = m.slice(1).map(Number); if (p.some((x) => x > 255)) return null;
    return ((p[0] * 16777216) + (p[1] * 65536) + (p[2] * 256) + p[3]) >>> 0;
  }
  // a mask of /8 to /29 made of ones then zeros (255.255.255.0 yes, 255.0.255.0 no)
  function maskInt(t) {
    const m = ipv4Int(t); if (m === null) return null;
    const inv = (~m) >>> 0;
    if (inv & ((inv + 1) >>> 0)) return null;
    return m >= 0xFF000000 && m <= 0xFFFFFFF8 ? m : null;
  }
  const isPrivateIp = (n) => n !== null && ((n >>> 24) === 10 || (n >>> 20) === 0xAC1 || (n >>> 16) === 0xC0A8);
  const leaseOk = (t) => /^\d{1,4}$/.test(String(t === undefined || t === null ? '' : t).trim()) && parseInt(t, 10) >= LEASE_MIN && parseInt(t, 10) <= LEASE_MAX;
  // lan = parseLan(...). Returns {start, end, lease} (strings, number) or {error: text}.
  function lanPoolCheck(lan, startT, endT, leaseT) {
    if (!lan || !lan.ip || !lan.mask) return { error: 'The router did not report its IP address and subnet mask.' };
    if (lan.dhcp !== 'On') return { error: 'The DHCP server is not On (or not reported). Only the pool and the lease are changed here, and only while DHCP is On.' };
    const ip = ipv4Int(lan.ip), mask = maskInt(lan.mask);
    if (!isPrivateIp(ip)) return { error: 'Router IP ' + lan.ip + ' must be private (10.x, 172.16–31.x, 192.168.x).' };
    if (mask === null) return { error: 'Invalid mask ' + lan.mask + '. Use /8 to /29.' };
    const start = ipv4Int(startT), end = ipv4Int(endT);
    if (start === null) return { error: 'The pool start is not a valid IPv4 address.' };
    if (end === null) return { error: 'The pool end is not a valid IPv4 address.' };
    const net = (ip & mask) >>> 0, bc = (net | ((~mask) >>> 0)) >>> 0;
    for (const [n, label] of [[start, 'start'], [end, 'end']]) {
      if (((n & mask) >>> 0) !== net) return { error: 'Pool ' + label + ' is outside the router network (' + lan.ip + ' / ' + lan.mask + ').' };
      if (n === net || n === bc) return { error: 'The pool ' + label + ' must not be the network or the broadcast address.' };
    }
    if (start > end) return { error: 'Pool start must come before pool end.' };
    if (ip >= start && ip <= end) return { error: 'The router IP ' + lan.ip + ' must not be inside the pool.' };
    if (!leaseOk(leaseT)) return { error: 'Lease must be whole hours, ' + LEASE_MIN + ' to ' + LEASE_MAX + '.' };
    return { start: String(startT).trim(), end: String(endT).trim(), lease: parseInt(leaseT, 10) };
  }
  // The whole set, as the stock page sends it. cur = parseLan(...) (IP and mask are sent back unchanged); want = {start, end, lease}.
  function lanCall(cur, want) {
    const c = lanPoolCheck(cur, want && want.start, want && want.end, want && want.lease); if (c.error) throw new Error(c.error);
    return { goformId: 'DHCP_SETTING', lanIp: cur.ip, lanNetmask: cur.mask, lanDhcpType: 'SERVER', dhcpStart: c.start, dhcpEnd: c.end, dhcpLease: String(c.lease), dhcp_reboot_flag: '1', mac_ip_reset: '0' };
  }
  // A saved copy is looser than a new value: an old state that the router itself held may break this tool's own rules (pool next to the limit, lease over 168 h),
  // and the way back must still work. Only the shape is checked: valid addresses, start <= end, a whole number of hours.
  function lanSnapOk(v) {
    if (!v || typeof v !== 'object') return null;
    const ip = ipv4Int(v.ip), mask = maskInt(v.mask), a = ipv4Int(v.start), b = ipv4Int(v.end);
    const lease = typeof v.lease === 'number' ? v.lease : (/^\d{1,4}$/.test(String(v.lease)) ? parseInt(v.lease, 10) : NaN);
    if (ip === null || mask === null || a === null || b === null || a > b || !Number.isInteger(lease) || lease < 1 || lease > 9999) return null;
    return { ip: String(v.ip).trim(), mask: String(v.mask).trim(), start: String(v.start).trim(), end: String(v.end).trim(), lease };
  }
  const lanSnapOf = (lan) => (lan ? lanSnapOk({ ip: lan.ip, mask: lan.mask, start: lan.start, end: lan.end, lease: lan.leaseHours }) : null);
  // Restore: the old pool and lease go back through the router's own call, but only while the router IP and mask are still the saved ones.
  function lanRestoreCall(cur, old) {
    const o = lanSnapOk(old); if (!o) throw new Error('The saved values are not valid.');
    if (!cur || cur.ip !== o.ip || cur.mask !== o.mask) throw new Error('The router IP or subnet mask is not the saved one any more. Nothing is restored.');
    if (cur.dhcp !== 'On') throw new Error('The DHCP server is not On.');
    return { goformId: 'DHCP_SETTING', lanIp: cur.ip, lanNetmask: cur.mask, lanDhcpType: 'SERVER', dhcpStart: o.start, dhcpEnd: o.end, dhcpLease: String(o.lease), dhcp_reboot_flag: '1', mac_ip_reset: '0' };
  }
  const LAN_BACKUP_PATH = '/data/local/matchitool/lan_backup.json';
  // The "pending change" note of a router IP change: same JSON as the backup, a different file. Kotlin (LanRevert) reads it after the restart.
  const LAN_PENDING_PATH = '/data/local/matchitool/lan_pending.json';
  function lanNoteSh(path, oldV, newV, at) {
    const o = lanSnapOk(oldV), n = lanSnapOk(newV);
    if (!o || !n) throw new Error('Not a valid LAN / DHCP set for the backup.');
    const ts = Number.isInteger(at) && at > 0 ? at : 0;
    const one = (x) => '{"ip":"' + x.ip + '","mask":"' + x.mask + '","start":"' + x.start + '","end":"' + x.end + '","lease":' + x.lease + '}';
    const json = '{"old":' + one(o) + ',"new":' + one(n) + ',"at":' + ts + '}';
    return "mkdir -p /data/local/matchitool && umask 077 && printf '%s' '" + json + "' > " + path + ' && echo MATCHI_BACKUP_OK';
  }
  const lanBackupWriteSh = (oldV, newV, at) => lanNoteSh(LAN_BACKUP_PATH, oldV, newV, at);
  const lanPendingWriteSh = (oldV, newV, at) => lanNoteSh(LAN_PENDING_PATH, oldV, newV, at);
  const LAN_PENDING_READ_SH = 'cat ' + LAN_PENDING_PATH + ' 2>/dev/null';
  const LAN_PENDING_DELETE_SH = 'rm -f ' + LAN_PENDING_PATH + ' && echo MATCHI_BACKUP_GONE';
  const LAN_BACKUP_READ_SH = 'cat ' + LAN_BACKUP_PATH + ' 2>/dev/null';
  const LAN_BACKUP_DELETE_SH = 'rm -f ' + LAN_BACKUP_PATH + ' && echo MATCHI_BACKUP_GONE';
  function parseLanBackup(text) {
    let j; try { j = JSON.parse(String(text === undefined || text === null ? '' : text).trim()); } catch (_) { return null; }
    if (!isObj(j)) return null;
    const o = lanSnapOk(j.old), n = lanSnapOk(j.new); if (!o || !n) return null;
    return { old: o, new: n, at: Number.isInteger(j.at) ? j.at : 0 };
  }
  // After the restart: does the router report the wanted pool and lease (and the same IP, mask, DHCP On)?
  const lanReached = (lan, want) => !!lan && lan.dhcp === 'On' && lan.start === want.start && lan.end === want.end && lan.leaseHours === want.lease;

  // ---- LAN / DHCP: router IP change ---------------------------------------------------------------------------------
  // Captured on the F50 (2026-11-15, part N): an IP change is the SAME DHCP_SETTING call, with the pool moved into the new subnet in the same Apply and
  // mac_ip_reset=1 (pool / lease only sends 0). After it the OLD address answers nothing, only the new one. The mask is never changed here (only
  // 255.255.255.0 was captured), DHCP stays On (the "off" value was never captured).
  // cur = parseLan(...). The pool keeps its host part: .2 - .253 on 192.168.0.x becomes .2 - .253 on 192.168.1.x. Returns {ip, start, end, lease} or {error}.
  function lanIpCheck(cur, newIpT) {
    if (!cur || !cur.ip || !cur.mask) return { error: 'The router did not report its IP address and subnet mask.' };
    if (cur.dhcp !== 'On') return { error: 'The DHCP server is not On (or not reported). The router IP is only changed while DHCP is On.' };
    const ip = ipv4Int(cur.ip), mask = maskInt(cur.mask), a = ipv4Int(cur.start), b = ipv4Int(cur.end);
    if (!isPrivateIp(ip) || mask === null) return { error: 'The router IP or the subnet mask read from the router is not usable here.' };
    if (a === null || b === null || a > b || !Number.isInteger(cur.leaseHours)) return { error: 'The router did not report a complete pool and lease.' };
    const nip = ipv4Int(newIpT);
    if (nip === null) return { error: 'The new router IP is not a valid IPv4 address.' };
    if (!isPrivateIp(nip)) return { error: 'New IP must be private (10.x, 172.16–31.x, 192.168.x).' };
    if (nip === ip) return { error: 'New IP matches the current IP.' };
    const net = (nip & mask) >>> 0, inv = (~mask) >>> 0, bc = (net | inv) >>> 0;
    if (nip === net || nip === bc) return { error: 'IP can\'t be the network or broadcast address.' };
    const start = (net | (a & inv)) >>> 0, end = (net | (b & inv)) >>> 0;
    if (start === net || start === bc || end === net || end === bc) return { error: 'Pool hits the network or broadcast address. Change the pool first.' };
    if (nip >= start && nip <= end) return { error: 'New IP is inside the pool (' + ipText(start) + ' - ' + ipText(end) + '). Change the pool first.' };
    return { ip: ipText(nip), start: ipText(start), end: ipText(end), lease: cur.leaseHours };
  }
  const ipText = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  // The whole set with the new IP: lanNetmask is sent back as read, mac_ip_reset is 1.
  function lanIpCall(cur, want) {
    const c = lanIpCheck(cur, want && want.ip); if (c.error) throw new Error(c.error);
    return { goformId: 'DHCP_SETTING', lanIp: c.ip, lanNetmask: cur.mask, lanDhcpType: 'SERVER', dhcpStart: c.start, dhcpEnd: c.end, dhcpLease: String(c.lease), dhcp_reboot_flag: '1', mac_ip_reset: '1' };
  }
  // Which restore is possible for this saved copy ({old, new}) and the router as it reads now? 'pool' = the router IP and mask are still the saved old ones
  // (put the old pool and lease back); 'ip' = the router is at the saved NEW address (put the old IP, pool and lease back); null = neither.
  function lanRestoreKind(cur, saved) {
    const o = saved && lanSnapOk(saved.old), n = saved && lanSnapOk(saved.new);
    if (!cur || !o || !n || !cur.ip || !cur.mask) return null;
    if (cur.ip === o.ip && cur.mask === o.mask) return 'pool';
    if (cur.ip === n.ip && cur.mask === n.mask && n.ip !== o.ip && o.mask === n.mask) return 'ip';
    return null;
  }
  // Put the old router IP, pool and lease back while the router is at the saved new address. Needs DHCP On.
  function lanIpRestoreCall(cur, saved) {
    if (lanRestoreKind(cur, saved) !== 'ip') throw new Error('The router is not at the saved new address any more. Nothing is restored.');
    if (cur.dhcp !== 'On') throw new Error('The DHCP server is not On.');
    const o = lanSnapOk(saved.old);
    return { goformId: 'DHCP_SETTING', lanIp: o.ip, lanNetmask: o.mask, lanDhcpType: 'SERVER', dhcpStart: o.start, dhcpEnd: o.end, dhcpLease: String(o.lease), dhcp_reboot_flag: '1', mac_ip_reset: '1' };
  }
  // "Restore DHCP": the recovery call from the 2026-11-15 incident (DHCP server switched off on the stock page, no device could get an address). cur = parseLan(...)
  // read while DHCP is NOT On. The pool the router still reports is kept when it passes the pool checks; otherwise only a /24 gets the stock pool .2 - .253.
  // Lease: the reported whole number of hours, else 24. mac_ip_reset=0 (the router IP does not change). Returns {call, start, end, lease} or throws.
  function lanDhcpOnCall(cur) {
    if (!cur || !cur.ip || !cur.mask) throw new Error('The router did not report its IP address and subnet mask.');
    if (cur.dhcp === 'On') throw new Error('DHCP already On.');
    if (cur.dhcp !== 'Off') throw new Error('DHCP state unknown. No change made.');
    const ip = ipv4Int(cur.ip), mask = maskInt(cur.mask);
    if (!isPrivateIp(ip) || mask === null) throw new Error('The router IP or the subnet mask read from the router is not usable here.');
    let lease = Number.isInteger(cur.leaseHours) && cur.leaseHours >= LEASE_MIN && cur.leaseHours <= LEASE_MAX ? cur.leaseHours : 24;
    let c = cur.start && cur.end ? lanPoolCheck({ ip: cur.ip, mask: cur.mask, dhcp: 'On' }, cur.start, cur.end, lease) : { error: 'none' };
    if (c.error) {
      if (cur.mask !== '255.255.255.0') throw new Error('The router does not report a usable pool for this subnet mask, so Restore DHCP cannot choose one.');
      const net = (ip & mask) >>> 0;
      c = lanPoolCheck({ ip: cur.ip, mask: cur.mask, dhcp: 'On' }, ipText(net + 2), ipText(net + 253), lease);
      if (c.error) throw new Error('Default pool (.2–.253) doesn\'t fit router IP ' + cur.ip + '.');
    }
    return { start: c.start, end: c.end, lease: c.lease, call: { goformId: 'DHCP_SETTING', lanIp: cur.ip, lanNetmask: cur.mask, lanDhcpType: 'SERVER', dhcpStart: c.start, dhcpEnd: c.end, dhcpLease: String(c.lease), dhcp_reboot_flag: '1', mac_ip_reset: '0' } };
  }

  // ---- MTU / MSS --------------------------------------------------------------------------------------------------------------
  function parseMtu(d) {
    if (!isObj(d)) return null;
    const mtu = num(d.mtu), mss = num(d.tcp_mss);
    // The stock default is MSS = MTU - 40 (1500 / 1460). A larger MSS is worth a note; smaller is fine.
    const warn = mtu !== null && mss !== null && mss > mtu - 40 ? 'MSS must not exceed MTU − 40 (' + (mtu - 40) + ')' : null;
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

  // ---- Wi-Fi: change -------------------------------------------------------------------------------------------------
  // Formats captured on the F50 stock page (2026-11-15, part M of the plan, AD token added by the host):
  //   band:  switchWiFiChip   isTest=false&goformId=switchWiFiChip&ChipEnum=chip1&GuestEnable=0      (chip1 = "2.4GHz Only", chip2 = "5.0GHz Only"; also turns Wi-Fi on from Off)
  //          switchWiFiModule isTest=false&goformId=switchWiFiModule&SwitchOption=0                  (Wi-Fi OFF)
  //   save:  goformId=setAccessPointInfo&isTest=false&ChipIndex=0&AccessPointIndex=0&SSID=CE+2&ApIsolate=0&AuthMode=WPA2PSKWPA3PSK&ApBroadcastDisabled=0
  //          &ApMaxStationNumber=10&EncrypType=CCMP&Password=<base64>        (the stock page sends ChipIndex=0 whichever band is on; PASSWORD_ENCODE is on in config.js)
  //          AuthMode WPA3PSK and WPA2PSK also use EncrypType=CCMP; OPEN sends EncrypType=NONE and NO Password. ApBroadcastDisabled=1 hides the SSID.
  // The whole set is sent every time, so a change of one field needs the current password: it is read from the router's reply at apply time, encoded here
  // and sent. It is never put in a parsed object, never shown and never stored; the one place it can reach a file is the backup (see wifiBackupWriteSh).
  const WIFI_AUTH = [['OPEN', 'Open (no password)'], ['WPA2PSK', 'WPA2-PSK (AES)'], ['WPA3PSK', 'WPA3-PSK'], ['WPA2PSKWPA3PSK', 'WPA2-PSK / WPA3-PSK']];   // config.js AUTH_MODES
  const WIFI_MAX_STATIONS = 10;   // config.js MAX_STATION_NUMBER and MAX_STATION_NUMBER_5G
  const WIFI_BANDS = [['2g', '2.4 GHz only'], ['5g', '5 GHz only'], ['off', 'Off']];
  const wifiAuthKnown = (a) => WIFI_AUTH.some((x) => x[0] === a);
  const B64A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const pwOk = (p) => typeof p === 'string' && /^[\x20-\x7e]{8,63}$/.test(p);
  // Base64 of printable ASCII only (a password with other characters is refused: how the stock page encodes them is not known).
  function b64Ascii(s) {
    const t = String(s); let out = '';
    if (!/^[\x20-\x7e]*$/.test(t)) throw new Error('Password: printable ASCII only.');
    for (let i = 0; i < t.length; i += 3) {
      const a = t.charCodeAt(i), b = i + 1 < t.length ? t.charCodeAt(i + 1) : -1, c = i + 2 < t.length ? t.charCodeAt(i + 2) : -1, n = (a << 16) | ((b < 0 ? 0 : b) << 8) | (c < 0 ? 0 : c);
      out += B64A[(n >> 18) & 63] + B64A[(n >> 12) & 63] + (b < 0 ? '=' : B64A[(n >> 6) & 63]) + (c < 0 ? '=' : B64A[n & 63]);
    }
    return out;
  }
  // Strict decode back to text (null when it is not valid base64 or not printable ASCII).
  function b64Dec(t) {
    const x = String(t == null ? '' : t); if (x.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(x)) return null;
    let out = '';
    for (let i = 0; i < x.length; i += 4) {
      const q = [0, 1, 2, 3].map((k) => (x[i + k] === '=' ? -2 : B64A.indexOf(x[i + k])));
      if (q[0] < 0 || q[1] < 0 || (q[2] === -2 && q[3] !== -2) || (i + 4 < x.length && (q[2] === -2 || q[3] === -2))) return null;
      const n = (q[0] << 18) | (q[1] << 12) | ((q[2] < 0 ? 0 : q[2]) << 6) | (q[3] < 0 ? 0 : q[3]);
      out += String.fromCharCode((n >> 16) & 255); if (q[2] !== -2) out += String.fromCharCode((n >> 8) & 255); if (q[3] !== -2) out += String.fromCharCode(n & 255);
    }
    return /^[\x20-\x7e]*$/.test(out) ? out : null;
  }
  const utf8Len = (s) => { let n = 0; for (const ch of String(s)) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; };
  // strict = a name typed now (no space at either end); loose = a saved or read name, which only has to be usable.
  function wifiSsidError(s, strict) {
    if (typeof s !== 'string' || s === '') return 'The network name must not be empty.';
    if (/[\u0000-\u001f\u007f]/.test(s)) return 'The network name must not contain control characters.';
    if (utf8Len(s) > 32) return 'Name max 32 bytes. Accents and symbols use 2–4 bytes each.';
    if (strict && s !== s.trim()) return 'Name can\'t start or end with a space.';
    return null;
  }
  // The plain password of one router entry. PASSWORD_ENCODE is on, so a firmware may hand back Password as Base64 and PasswordShow as the plain text (or the other way round):
  // when the two differ and one is the Base64 of the other, the decoded one is the plain password. Otherwise PasswordShow wins, then Password (as the router reports it).
  function wifiEntryPlain(e) {
    const P = clean(e.Password) !== null ? String(e.Password) : null, S = clean(e.PasswordShow) !== null ? String(e.PasswordShow) : null;
    if (P !== null && S !== null && P !== S) { if (b64Dec(P) === S) return S; if (b64Dec(S) === P) return P; }
    // This firmware (PASSWORD_ENCODE on) reports the SAME Base64 text in both fields, so a value that decodes to a printable 8 to 63 character password is Base64: use the decoded text.
    const v = S !== null ? S : P; if (v === null) return null;
    const d = b64Dec(v); return d !== null && pwOk(d) ? d : v;
  }
  // The password the router reports now, as plain text, or null (for the form to pre-fill, like the stock page). The caller keeps it in memory only.
  function wifiPlainPw(raw) { const c = wifiCurrentPw(raw); return c.error ? null : c.pw; }
  // The password the router reports now, for the chip(s) that are on (all chips when none is). Returns {pw} or {error}; the caller must not keep or show it.
  function wifiCurrentPw(raw) {
    const entries = toList(pick(raw, 'ResponseList')).filter(isObj), on = entries.filter((e) => clean(e.AccessPointSwitchStatus) === '1'), use = on.length ? on : entries, set = new Set();
    for (const e of use) { const p = wifiEntryPlain(e); if (p !== null) set.add(p); }
    if (!set.size) return { error: 'No saved Wi-Fi password. Enter one.' };
    if (set.size > 1) return { error: 'Passwords differ between chips. Enter a new one.' };
    return { pw: [...set][0] };
  }
  // true / false: does the router report exactly this password now? (Used to confirm a password change without ever returning the password.)
  const wifiHasPassword = (raw, plain) => { const c = wifiCurrentPw(raw); return !c.error && typeof plain === 'string' && c.pw === plain; };
  // The settings of one parsed entry as a plain set, or null when the router does not report all of them (or reports a mode this tool does not offer).
  function wifiSnapOk(v) {
    if (!isObj(v) || typeof v.ssid !== 'string' || wifiSsidError(v.ssid, false) || !wifiAuthKnown(v.auth) || typeof v.hidden !== 'boolean') return null;
    if (!Number.isInteger(v.max) || v.max < 1 || v.max > WIFI_MAX_STATIONS) return null;
    const o = { ssid: v.ssid, auth: v.auth, hidden: v.hidden, max: v.max };
    if (v.pwB64 !== undefined && v.pwB64 !== null) { const p = b64Dec(v.pwB64); if (p === null || !pwOk(p) || v.auth === 'OPEN') return null; o.pwB64 = v.pwB64; }
    return o;
  }
  const wifiSnapOf = (e) => (e ? wifiSnapOk({ ssid: e.ssid, auth: e.authRaw, hidden: e.broadcast === null ? null : !e.broadcast, max: e.maxStations }) : null);
  // What the form checks: returns {ssid, auth, hidden, max, pw} (pw = a typed password, or null to keep the current one) or {error: text}.
  // entry = the parsed active entry (does the router have a password to keep?).
  function wifiFormCheck(entry, f) {
    const x = f || {};
    const e1 = wifiSsidError(x.ssid, true); if (e1) return { error: e1 };
    if (!wifiAuthKnown(x.auth)) return { error: 'Choose a security mode from the list.' };
    if (typeof x.hidden !== 'boolean') return { error: 'Broadcast SSID must be ticked or not.' };
    const mt = String(x.max == null ? '' : x.max).trim();
    if (!/^\d{1,2}$/.test(mt) || parseInt(mt, 10) < 1 || parseInt(mt, 10) > WIFI_MAX_STATIONS) return { error: 'Max devices: whole number from 1 to ' + WIFI_MAX_STATIONS + '.' };
    const out = { ssid: x.ssid, auth: x.auth, hidden: x.hidden, max: parseInt(mt, 10), pw: null };
    if (x.auth === 'OPEN') return out;
    const pw = typeof x.pw === 'string' ? x.pw : '';
    if (pw !== '') {
      if (!/^[\x20-\x7e]*$/.test(pw)) return { error: 'Password: printable ASCII only.' };
      if (!pwOk(pw)) return { error: 'Password must be 8–63 characters.' };
      out.pw = pw; return out;
    }
    if (!entry || !entry.pwSet || entry.authRaw === 'OPEN') return { error: 'Type a password (8 to 63 characters): the router has none to keep.' };
    return out;
  }
  // The call that saves the settings, exactly as the stock page sends it. want = {ssid, auth, hidden, max} plus the password source:
  // pw (typed, plain) or pwB64 (already encoded, from a backup); neither = keep the current one, read from `raw` (the router's reply) here.
  function wifiSaveCall(raw, want) {
    const w = want || {};
    const ssidErr = wifiSsidError(w.ssid, false); if (ssidErr) throw new Error(ssidErr);
    if (!wifiAuthKnown(w.auth)) throw new Error('The security mode is not one this tool offers.');
    if (typeof w.hidden !== 'boolean') throw new Error('Broadcast SSID is not set.');
    if (!Number.isInteger(w.max) || w.max < 1 || w.max > WIFI_MAX_STATIONS) throw new Error('Max devices must be from 1 to ' + WIFI_MAX_STATIONS + '.');
    const open = w.auth === 'OPEN';
    const call = { goformId: 'setAccessPointInfo', ChipIndex: '0', AccessPointIndex: '0', SSID: w.ssid, ApIsolate: '0', AuthMode: w.auth, ApBroadcastDisabled: w.hidden ? '1' : '0', ApMaxStationNumber: String(w.max), EncrypType: open ? 'NONE' : 'CCMP' };
    if (open) return call;
    let plain;
    if (typeof w.pwB64 === 'string') { plain = b64Dec(w.pwB64); if (plain === null) throw new Error('The saved password is not valid.'); }
    else if (typeof w.pw === 'string' && w.pw !== '') plain = w.pw;
    else { const c = wifiCurrentPw(raw); if (c.error) throw new Error(c.error); plain = c.pw; }
    if (!pwOk(plain)) throw new Error('The password must be 8 to 63 printable ASCII characters. Type a new one.');
    call.Password = b64Ascii(plain);
    return call;
  }
  // The plain password a want carries (typed or saved), or null when it keeps the current one.
  const wifiWantPw = (want) => (want && typeof want.pwB64 === 'string' ? b64Dec(want.pwB64) : want && typeof want.pw === 'string' && want.pw !== '' ? want.pw : null);
  // Does this want change the password the router holds now? (false when it keeps it, or when it asks for what is already there)
  const wifiPwChange = (raw, want) => { const p = wifiWantPw(want); return p !== null && !wifiHasPassword(raw, p); };
  const wifiSame = (a, b) => !!a && !!b && a.ssid === b.ssid && a.auth === b.auth && a.hidden === b.hidden && a.max === b.max;
  // Did the re-read show the wanted settings on the band that is on?
  const wifiReached = (entry, want) => !!entry && !!want && entry.on === true && entry.ssid === want.ssid && entry.authRaw === want.auth && entry.broadcast === !want.hidden && entry.maxStations === want.max;
  // The lines of the confirm dialog: what changes, never the password itself.
  function wifiChangeLines(cur, want, pwChanges) {
    const out = []; const authName = (a) => (WIFI_AUTH.find((x) => x[0] === a) || [a, a])[1];
    if (cur.ssid !== want.ssid) out.push('Network name: "' + cur.ssid + '" → "' + want.ssid + '"');
    if (cur.auth !== want.auth) out.push('Security: ' + authName(cur.auth) + ' → ' + authName(want.auth));
    if (cur.hidden !== want.hidden) out.push('SSID broadcast: ' + (cur.hidden ? 'Hidden' : 'Visible') + ' → ' + (want.hidden ? 'Hidden' : 'Visible'));
    if (cur.max !== want.max) out.push('Max devices: ' + cur.max + ' → ' + want.max);
    if (pwChanges) out.push('Password: will change');
    if (want.auth === 'OPEN' && cur.auth !== 'OPEN') out.push('No password. Anyone in range can join.');
    return out;
  }
  // Band switch: '2g' / '5g' / 'off'. Which one is on is read back by wifiMode.
  function wifiBandCall(mode) {
    if (mode === '2g') return { goformId: 'switchWiFiChip', ChipEnum: 'chip1', GuestEnable: '0' };
    if (mode === '5g') return { goformId: 'switchWiFiChip', ChipEnum: 'chip2', GuestEnable: '0' };
    if (mode === 'off') return { goformId: 'switchWiFiModule', SwitchOption: '0' };
    throw new Error('Unknown Wi-Fi band: ' + mode);
  }
  const wifiBandReached = (w, mode) => (mode === '2g' || mode === '5g' || mode === 'off') && wifiMode(w) === mode;
  // The saved copy of the old settings (plan "BACKUP", rule 11): written by the root shell before the change, readable only by root. The old password goes in
  // (as the base64 the router takes, under the key "Password" so the log redactors hide it) ONLY when the change would otherwise lose it: the password changes
  // or the network becomes open. Otherwise a restore keeps the password the router has now.
  const WIFI_BACKUP_DIR = '/data/local/matchitool', WIFI_BACKUP_FILE = 'wifi_backup.json';
  const WIFI_BACKUP_PATH = WIFI_BACKUP_DIR + '/' + WIFI_BACKUP_FILE;
  const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  function wifiBackupSnap(raw, cur, want, pwChanges) {
    const o = { ssid: cur.ssid, auth: cur.auth, hidden: cur.hidden, max: cur.max };
    if (cur.auth !== 'OPEN' && (pwChanges || want.auth === 'OPEN')) { const c = wifiCurrentPw(raw); if (c.error || !pwOk(c.pw)) throw new Error('The current password cannot be saved (' + (c.error || 'it is not 8 to 63 printable ASCII characters') + ').'); o.pwB64 = b64Ascii(c.pw); }
    return o;
  }
  function wifiBackupWriteSh(oldV, newV, at, dir) {
    const o = wifiSnapOk(oldV), n = wifiSnapOk(newV);
    if (!o || !n) throw new Error('Not a valid Wi-Fi set for the backup.');
    const d = dir === undefined ? WIFI_BACKUP_DIR : dir; if (!/^\/[A-Za-z0-9_./-]+$/.test(d) || d.includes('..')) throw new Error('Bad backup folder.');
    const ts = Number.isInteger(at) && at > 0 ? at : 0;
    const one = (x) => { const r = { ssid: x.ssid, auth: x.auth, hidden: x.hidden, max: x.max }; if (x.pwB64) r.Password = x.pwB64; return r; };
    const json = JSON.stringify({ old: one(o), new: one({ ssid: n.ssid, auth: n.auth, hidden: n.hidden, max: n.max }), at: ts });
    return 'mkdir -p ' + d + ' && umask 077 && printf ' + shq('%s') + ' ' + shq(json) + ' > ' + d + '/' + WIFI_BACKUP_FILE + ' && echo MATCHI_BACKUP_OK';
  }
  const WIFI_BACKUP_READ_SH = 'cat ' + WIFI_BACKUP_PATH + ' 2>/dev/null || true';
  const WIFI_BACKUP_DELETE_SH = 'rm -f ' + WIFI_BACKUP_PATH + ' && echo MATCHI_BACKUP_GONE';
  function parseWifiBackup(text) {
    let j; try { j = JSON.parse(String(text == null ? '' : text).trim()); } catch (_) { return null; }
    if (!isObj(j) || !isObj(j.old) || !isObj(j.new)) return null;
    const o = wifiSnapOk({ ssid: j.old.ssid, auth: j.old.auth, hidden: j.old.hidden, max: j.old.max, pwB64: j.old.Password }), n = wifiSnapOk({ ssid: j.new.ssid, auth: j.new.auth, hidden: j.new.hidden, max: j.new.max });
    if (!o || !n) return null;
    return { old: o, new: n, at: Number.isInteger(j.at) ? j.at : 0 };
  }

  // ---- MTU / MSS: change (the router's own call) ----------------------------------------------------------------
  // Captured on the F50 (2026-11-14) and confirmed in the stock script service.js (2026-11-15):
  //   isTest=false&goformId=SET_DEVICE_MTU&mtu=1500&tcp_mss=1459&AD=<token>      reply {"result":"success"}, then THE ROUTER REBOOTS.
  // Both values are always sent together. Effect seen in the root checks (parts E and G): the property persist.sys.tetherconfig.sMss / sMtu follows, and the
  // INPUT / OUTPUT TCPMSS --set-mss rules are rebuilt at boot, so MSS acts on the router's own SYN packets, NOT on connected devices. The allowed ranges
  // are not known: the limits below are this tool's own (the cautious side).
  const MTU_MIN = 1280, MTU_MAX = 1500, MSS_MIN = 536;
  const mtuDefaultMss = (mtu) => mtu - 40;
  // Returns {mtu, mss} (numbers) or {error: text}.
  function mtuCheck(mtuText, mssText) {
    const a = String(mtuText == null ? '' : mtuText).trim(), b = String(mssText == null ? '' : mssText).trim();
    if (!/^\d{1,4}$/.test(a)) return { error: 'MTU must be a whole number.' };
    if (!/^\d{1,4}$/.test(b)) return { error: 'MSS must be a whole number.' };
    const mtu = parseInt(a, 10), mss = parseInt(b, 10);
    if (mtu < MTU_MIN || mtu > MTU_MAX) return { error: 'MTU out of range (' + MTU_MIN + ' to ' + MTU_MAX + '). Minimum for IPv6 is 1280.' };
    if (mss < MSS_MIN) return { error: 'MSS must be at least ' + MSS_MIN + '.' };
    if (mss > mtuDefaultMss(mtu)) return { error: 'MSS must not be larger than MTU minus 40 (' + mtuDefaultMss(mtu) + ' for MTU ' + mtu + ').' };
    return { mtu, mss };
  }
  function mtuCall(mtu, mss) {
    const c = mtuCheck(mtu, mss); if (c.error) throw new Error(c.error);
    return { goformId: 'SET_DEVICE_MTU', mtu: String(c.mtu), tcp_mss: String(c.mss) };
  }
  // The saved copy of the old values (plan "BACKUP", rule 11): written by the root shell before the change, readable only by root. Only integers go in.
  const MTU_BACKUP_PATH = '/data/local/matchitool/mtu_backup.json';
  function mtuBackupWriteSh(oldV, newV, at) {
    const o = mtuCheck(oldV && oldV.mtu, oldV && oldV.mss), n = mtuCheck(newV && newV.mtu, newV && newV.mss);
    if (o.error || n.error) throw new Error('Not a valid MTU / MSS pair for the backup.');
    const ts = Number.isInteger(at) && at > 0 ? at : 0;
    const json = '{"old":{"mtu":' + o.mtu + ',"mss":' + o.mss + '},"new":{"mtu":' + n.mtu + ',"mss":' + n.mss + '},"at":' + ts + '}';
    return "mkdir -p /data/local/matchitool && umask 077 && printf '%s' '" + json + "' > " + MTU_BACKUP_PATH + ' && echo MATCHI_BACKUP_OK';
  }
  const MTU_BACKUP_READ_SH = 'cat ' + MTU_BACKUP_PATH + ' 2>/dev/null';
  const MTU_BACKUP_DELETE_SH = 'rm -f ' + MTU_BACKUP_PATH + ' && echo MATCHI_BACKUP_GONE';
  function parseMtuBackup(text) {
    let j; try { j = JSON.parse(String(text == null ? '' : text).trim()); } catch (_) { return null; }
    if (!isObj(j) || !isObj(j.old) || !isObj(j.new)) return null;
    const o = mtuCheck(j.old.mtu, j.old.mss), n = mtuCheck(j.new.mtu, j.new.mss);
    if (o.error || n.error) return null;
    return { old: { mtu: o.mtu, mss: o.mss }, new: { mtu: n.mtu, mss: n.mss }, at: Number.isInteger(j.at) ? j.at : 0 };
  }
  // After the restart: does the real mobile interface carry the new MTU? true / false, or null when it cannot be told (no root read, no route).
  const wanFollowed = (root, mtu) => (!root || root.noRoute || root.wanMtu === null ? null : root.wanMtu === mtu);
  // One short ping to a public address from the phone itself, through the mobile interface. It shows the route works; it does NOT prove that sites load.
  const PING_SH = 'ping -c 2 -W 3 1.1.1.1 >/dev/null 2>&1 && echo MATCHI_PING_OK || echo MATCHI_PING_FAIL';
  const parsePing = (text) => { const t = String(text == null ? '' : text); return t.includes('MATCHI_PING_OK') ? true : t.includes('MATCHI_PING_FAIL') ? false : null; };
  // While the router restarts the console may ask for a new sign-in: that is not "still down", so the wait stops and says so.
  const isAuthError = (msg) => /\b(401|403)\b|unauthori[sz]ed|sign[- ]?in|log[- ]?in|session/i.test(String(msg == null ? '' : msg));

  // ---- Limit speed (Devices tab; the phone does the work with root and tc, docs/LIMIT_SPEED.md) -----------------------------------
  // The host (SpeedLimit.kt) checks everything again: these checks only keep an obvious mistake from being sent. KB/s bounds = SpeedLimit.MIN_KBPS / MAX_KBPS.
  const LIMIT_MIN = 8, LIMIT_MAX = 125000;
  const LIMIT_IP = /^192\.168\.0\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/;
  // A LAN address the limit can use (192.168.0.2 to 254; the router .1, .0 and .255 are refused), or null.
  const limitIp = (ip) => { const t = plainIp(ip); return LIMIT_IP.test(t) ? t : null; };
  // A MAC the limit can use: group (multicast / broadcast) and all-zero addresses are refused, like the host does.
  const limitMac = (m) => { if (!isMac(m)) return null; const n = normMac(m); return (parseInt(n.slice(0, 2), 16) & 1) === 0 && n !== '00:00:00:00:00:00' ? n : null; };
  // One field: '' = Unlimited (null). Anything else must be a whole number of KB/s inside the bounds. Returns { value, error }.
  function limitField(text, name) {
    const t = String(text == null ? '' : text).trim();
    if (t === '') return { value: null, error: null };
    if (!/^\d{1,9}$/.test(t)) return { value: null, error: name + ' must be a whole number of KB/s, or empty for Unlimited.' };
    const v = Number(t);
    if (v < LIMIT_MIN || v > LIMIT_MAX) return { value: null, error: name + ' must be ' + LIMIT_MIN + ' to ' + LIMIT_MAX + ' KB/s, or empty for Unlimited.' };
    return { value: v, error: null };
  }
  // Both fields -> { down, up, error }. Both empty is allowed: it removes the limit.
  function limitCheck(downText, upText) {
    const d = limitField(downText, 'Download'), u = limitField(upText, 'Upload');
    return { down: d.value, up: u.value, error: d.error || u.error };
  }
  // The body of POST /api/net/limit. Throws a plain message when the device or a value is not usable.
  function limitCall(mac, ip, downText, upText) {
    const m = limitMac(mac); if (!m) throw new Error('This device has no usable MAC address: ' + mac);
    const a = limitIp(ip); if (!a) throw new Error('A limit needs a device address 192.168.0.2 to 192.168.0.254 (this device: ' + (plainIp(ip) || 'none') + ').');
    const c = limitCheck(downText, upText); if (c.error) throw new Error(c.error);
    return { mac: m, ip: a, down: c.down, up: c.up };
  }
  const limitKb = (v) => (Number.isInteger(v) && v > 0 ? v : null);
  // GET /api/net/limits (and the reply of POST /api/net/limit) -> { rows, lanUp, rootBusy, note }, or null when it is not that shape. Nothing is guessed.
  function parseLimits(d) {
    if (!isObj(d) || d.success !== true || !Array.isArray(d.limits)) return null;
    const rows = [];
    for (const r of d.limits) {
      const mac = isObj(r) ? limitMac(r.mac) : null; if (!mac) continue;
      rows.push({ mac, down: limitKb(r.down), up: limitKb(r.up), ip: typeof r.ip === 'string' && r.ip ? plainIp(r.ip) : null, online: r.online === true, active: r.active === true ? true : r.active === false ? false : null });
    }
    return { rows, lanUp: d.lanUp === true, rootBusy: d.rootBusy === true, note: typeof d.note === 'string' ? d.note.trim() : '' };
  }
  // The saved limit of one device, or null (no row, or a row with both sides Unlimited).
  function limitFor(parsed, mac) {
    const m = limitMac(mac); if (!parsed || !m) return null;
    const r = parsed.rows.find((x) => x.mac === m);
    return r && (r.down !== null || r.up !== null) ? r : null;
  }
  const limitSide = (v) => (v === null ? 'Unlimited' : v + ' KB/s');
  const limitText = (down, up) => 'Download ' + limitSide(down) + ', Upload ' + limitSide(up);
  // The short form shown in the Devices list: "\u2193 1000 \u00b7 \u2191 1000 KB/s" when both sides are set, else each side keeps its own unit ("\u2193 300 KB/s \u00b7 \u2191 Unlimited").
  const limitShort = (down, up) => (down !== null && up !== null ? '\u2193 ' + down + ' \u00b7 \u2191 ' + up + ' KB/s'
    : '\u2193 ' + (down === null ? 'Unlimited' : down + ' KB/s') + ' \u00b7 \u2191 ' + (up === null ? 'Unlimited' : up + ' KB/s'));
  // The hint beside a Download / Upload field while typing: KB/s -> Mbps (1 KB/s = 8 kbit/s). '' for text that is not a number, 'Unlimited' for an empty field.
  function limitMbps(text) {
    const t = String(text == null ? '' : text).trim();
    if (t === '') return 'Unlimited';
    if (!/^\d{1,9}$/.test(t)) return '';
    const m = Number(t) * 8 / 1000;
    const r = m >= 100 ? Math.round(m) : m >= 10 ? Math.round(m * 10) / 10 : Math.round(m * 100) / 100;
    return '\u2248 ' + r + ' Mbps';
  }
  // After a change: does the phone report exactly the wanted limit, and (when there is one) is it on the phone now? Not active = not reached.
  function limitReached(parsed, mac, down, up) {
    if (!parsed) return false;
    const r = limitFor(parsed, mac);
    if (down === null && up === null) return !r;
    return !!r && r.down === down && r.up === up && r.active !== false;
  }

  return {
    READ, READ_ACL, READ_NAMES, TABS, ROOT_READ_SH,
    clean, num, toList, pick, normMac, maskSecrets, isPassKey, stripPass,
    connState, modeLabel, onOff, parseData, dataCall, dataNext, dataReached,
    chipLabel, authLabel, parseWifi, wifiSummary, wifiMode, wifiActive,
    WIFI_AUTH, WIFI_BANDS, WIFI_MAX_STATIONS, wifiAuthKnown, b64Ascii, b64Dec, utf8Len, wifiSsidError, wifiHasPassword, wifiPlainPw, wifiEntryPlain, wifiSnapOk, wifiSnapOf, wifiFormCheck, wifiSaveCall, wifiWantPw, wifiPwChange, wifiSame, wifiReached,
    wifiChangeLines, wifiBandCall, wifiBandReached, WIFI_BACKUP_PATH, wifiBackupSnap, wifiBackupWriteSh, WIFI_BACKUP_READ_SH, WIFI_BACKUP_DELETE_SH, parseWifiBackup,
    mergeDevices, parseDevices, isMac, parseAcl, aclRefusal, hostnameError, renameCall, blockCall, unblockCall, plainIp, isSelf,
    APN_SLOTS, PDP_TYPES, APN_AUTH, parseProfile, parseApn, apnRefusal, apnNameError, apnApnError, apnFormError, apnAutoCall, apnSaveCall, apnDefaultCall, apnDeleteCall,
    apnCanUse, apnCanEdit, apnCanAdd, apnDeleteRefusal, isInUse, sameProfile, autoAsForm, authLabelApn, pdpLabel,
    parseLease, leaseText, parseLan,
    LEASE_MIN, LEASE_MAX, ipv4Int, maskInt, isPrivateIp, lanPoolCheck, lanCall, lanSnapOk, lanSnapOf, lanRestoreCall, LAN_BACKUP_PATH, lanBackupWriteSh, LAN_PENDING_PATH, lanPendingWriteSh, LAN_PENDING_READ_SH, LAN_PENDING_DELETE_SH, lanIpCheck, lanIpCall, lanRestoreKind, lanIpRestoreCall, lanDhcpOnCall, ipText, LAN_BACKUP_READ_SH, LAN_BACKUP_DELETE_SH, parseLanBackup, lanReached,
    parseMtu, sections, parseRootNet,
    MTU_MIN, MTU_MAX, MSS_MIN, mtuDefaultMss, mtuCheck, mtuCall, MTU_BACKUP_PATH, mtuBackupWriteSh, MTU_BACKUP_READ_SH, MTU_BACKUP_DELETE_SH, parseMtuBackup,
    wanFollowed, PING_SH, parsePing, isAuthError,
    LIMIT_MIN, LIMIT_MAX, limitIp, limitMac, limitField, limitCheck, limitCall, parseLimits, limitFor, limitText, limitShort, limitMbps, limitReached,
  };
});

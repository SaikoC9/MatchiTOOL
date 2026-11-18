/* at-console.js: MatchiTOOL's own logic for the AT & Radio window. No DOM, no network: scripts/test_at_console.js runs this file as it is.
 *   cleanReply(raw)          modem text -> tidy lines (the closing OK / ERROR on its own line, no blank lines)
 *   checkCommand(text)       what the person typed -> {ok, cmd} or {ok:false, error}
 *   makeHistory(max)         sent commands, newest last; prev() / next() walk it like a shell
 *   SWITCHES                 the two voice switches: how each is read, written and parsed (the AT strings are the modem's own)
 *   readSwitch(def, raw)     reply to def.read -> true / false / null (null = could not tell)
 *   judgeSwitch(want, got)   after a write: 'confirmed' | 'differs' | 'unreadable'
 *   describeCsq / describeCesq / describeReg   one-line meanings for the numbers
 *   groups                   the quick-read buttons, in the order the window shows them */
(() => {
  'use strict';

  const MAX_CMD = 200;

  // The modem's closing word is printed right behind the data ("+CSQ: 99,99OK"): put it on its own line.
  function cleanReply(raw) {
    const t = String(raw == null ? '' : raw).replace(/\r/g, '').replace(/\u0000/g, '');
    return t.replace(/([^\n])(OK|ERROR|\+CM[ES] ERROR:[^\n]*)[ \t]*$/, '$1\n$2')
      .split('\n').map((l) => l.replace(/[ \t]+$/, '')).filter((l) => l !== '').join('\n');
  }

  // Only a single line that starts with AT is ever sent. Control characters are refused, not removed.
  function checkCommand(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return { ok: false, error: 'Type an AT command first.' };
    if (/[\u0000-\u001f\u007f]/.test(s)) return { ok: false, error: 'The command must be one line of plain text.' };
    if (s.length > MAX_CMD) return { ok: false, error: 'The command is longer than ' + MAX_CMD + ' characters.' };
    if (!/^at/i.test(s)) return { ok: false, error: 'An AT command starts with AT, for example AT+CSQ.' };
    return { ok: true, cmd: 'AT' + s.slice(2) };
  }

  function makeHistory(max) {
    const cap = max || 30, list = [];
    let at = 0;
    return {
      push(c) { if (!c) return; if (list[list.length - 1] !== c) list.push(c); while (list.length > cap) list.shift(); at = list.length; },
      prev() { if (!list.length) return ''; at = Math.max(0, at - 1); return list[at]; },
      next() { if (at >= list.length - 1) { at = list.length; return ''; } at += 1; return list[at]; },
      all() { return list.slice(); },
    };
  }

  // The first number after the colon of the first "+TAG:" line, or of a ',' separated list at an index.
  const nums = (raw, tag) => {
    const m = String(raw || '').match(new RegExp('\\' + tag + '\\s*:\\s*([^\\n]*)'));
    return m ? m[1].split(',').map((x) => parseInt(x.replace(/[^\d-]/g, ''), 10)) : [];
  };

  const SWITCHES = [
    { id: 'volte', label: 'VoLTE', note: 'Calls over 4G', read: 'AT+CAVIMS?', write: (on) => 'AT+CAVIMS=' + (on ? 1 : 0),
      parse: (raw) => { const n = nums(raw, '+CAVIMS')[0]; return n === 1 ? true : n === 0 ? false : null; } },
    { id: 'vonr', label: 'VoNR', note: 'Calls over 5G', read: 'AT+SP5GCMDS="get nr synch_param",42', write: (on) => 'AT+SP5GCMDS="set nr param",45,' + (on ? 1 : 0),
      // Same reading the window has always used on the F50 (third comma field after the first colon); a "synch_param,42,<n>" pattern is the fallback.
      parse: (raw) => {
        const f = String(raw || '').split('OK')[0].split(':').slice(1).join(':').replace(/["\r\n]/g, ' ').split(',').map((x) => x.trim());
        let n = parseInt(f[2], 10);
        if (!Number.isFinite(n)) { const m = String(raw || '').match(/synch_param[^,]*,\s*\d+\s*,\s*(\d+)/); n = m ? parseInt(m[1], 10) : NaN; }
        return n === 1 ? true : n === 0 ? false : null;
      } },
  ];
  const readSwitch = (def, raw) => def.parse(raw);
  const judgeSwitch = (want, got) => (got === null || got === undefined ? 'unreadable' : got === want ? 'confirmed' : 'differs');

  function describeCsq(raw) {
    const n = nums(raw, '+CSQ')[0];
    if (!Number.isFinite(n)) return '';
    if (n === 99) return 'CSQ 99 means unknown. That is normal on 5G, where CSQ only measures 2G/3G/4G.';
    return 'Signal strength about ' + (-113 + 2 * Math.min(n, 31)) + ' dBm';
  }
  function describeCesq(raw) {
    const a = nums(raw, '+CESQ');
    if (a.length < 6 || !a.every(Number.isFinite)) return '';
    const rsrq = a[4], rsrp = a[5];
    return 'LTE RSRP ' + (rsrp <= 97 ? (-140 + rsrp) + ' dBm' : 'unknown') + ', RSRQ ' + (rsrq <= 34 ? (-19.5 + 0.5 * rsrq) + ' dB' : 'unknown');
  }
  const REG = { 0: 'not registered, not searching', 1: 'registered (home)', 2: 'searching', 3: 'registration denied', 4: 'unknown', 5: 'registered (roaming)' };
  function describeReg(raw) {
    const m = String(raw || '').match(/\+C(?:5G|E)REG:\s*\d+\s*,\s*(\d+)/);
    return m ? (REG[m[1]] || 'status ' + m[1]) : '';
  }

  // Quick reads. A command with "|" is several commands run one after another; "@signal" is the window's own signal read.
  const groups = [
    { name: 'This SIM', items: [['IMEI', 'AT+CGSN'], ['IMSI', 'AT+CIMI'], ['ICCID', 'AT+CCID'], ['Modem', 'AT+CGMI|AT+CGMM|AT+CGMR']] },
    { name: 'Network', items: [['Signal', '@signal'], ['Operator', 'AT+COPS?'], ['Registration', 'AT+CEREG?'], ['QoS', 'AT+CGEQOSRDP=1'], ['5G bands', '@nrbands']] },
  ];

  window.MatchiAtConsole = { cleanReply, checkCommand, makeHistory, SWITCHES, readSwitch, judgeSwitch, describeCsq, describeCesq, describeReg, groups };
})();

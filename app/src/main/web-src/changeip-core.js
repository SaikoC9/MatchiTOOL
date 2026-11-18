/* changeip-core.js: the logic of the Change IP tool, with no DOM and no network (scripts/test_changeip.js runs this file as it is).
 *   ipOf(text)            first valid IPv4 address in a text, or ''. Each part must be 0-255; HTML error pages, proxy messages and "1.2.3.4.5" give ''.
 *   localScript()         root script: the address of the mobile-data link (the source address Android uses to reach the internet).
 *   publicScript(quick)   root script: the public address as seen from outside (curl, then wget), tries two services.
 *   cycleScript()         root script: mobile data off, wait until the link is down, mobile data on again (3 tries). One script on purpose:
 *                         once it has started, data is switched back on even if the page stops waiting for it. Last line: "ENABLED|1" or "ENABLED|0".
 *   cycleOk(text)         true when that last line says data is on again.
 *   verdict(before, after) how to word the result. */
(() => {
  'use strict';

  function ipOf(text) {
    for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
      const t = raw.trim();
      const m = t.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (m && m.slice(1).every((p) => Number(p) <= 255)) return t;
    }
    return '';
  }

  const LOCAL_LINE = "ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i==\"src\"){print $(i+1);exit}}'";
  const localScript = () => LOCAL_LINE;

  // Where curl may be: the app's own copy first (it is always there once MatchiTOOL has started), then the system one.
  const FIND_CURL = [
    'C=""',
    'for c in /data/local/matchitool/bin/curl /data/data/com.matchi.tool/files/curl /data/user/0/com.matchi.tool/files/curl; do [ -x "$c" ] && C=$c && break; done',
    '[ -n "$C" ] || C=$(command -v curl)',
  ];
  const SERVICES = ['https://checkip.amazonaws.com/', 'https://api.ipify.org/'];

  function publicScript(quick) {
    const to = quick ? 5 : 8;
    const lines = ['ok() { case "$1" in ""|*[!0-9.]*) return 1;; *.*.*.*) return 0;; esac; return 1; }', ...FIND_CURL];
    for (const u of SERVICES) {
      lines.push(`if [ -n "$C" ]; then r=$($C -s --connect-timeout ${to} --max-time ${to + 2} ${u} 2>/dev/null); ok "$r" && echo "$r" && exit 0; fi`);
      if (!quick) lines.push(`if [ -n "$C" ]; then r=$($C -s --connect-timeout ${to} --max-time ${to + 2} --doh-url https://dns.google/dns-query ${u} 2>/dev/null); ok "$r" && echo "$r" && exit 0; fi`);
      lines.push(`for W in "wget -qO- -T ${to}" "busybox wget -qO- -T ${to}" "toybox wget -qO-"; do r=$($W ${u} 2>/dev/null); ok "$r" && echo "$r" && exit 0; done`);
      if (quick) break;                       // the quick read (before the switch) tries one service only
    }
    lines.push('exit 1');
    return lines.join('\n');
  }

  function cycleScript() {
    return [
      'svc data disable',
      'i=0',
      `while [ $i -lt 8 ]; do`,
      `  a=$(${LOCAL_LINE})`,
      '  [ -n "$a" ] || break',
      '  sleep 1; i=$((i+1))',
      'done',
      'sleep 1',
      'ok=0',
      'for t in 1 2 3; do svc data enable && ok=1 && break; sleep 2; done',
      'echo "ENABLED|$ok"',
    ].join('\n');
  }

  const cycleOk = (text) => /^ENABLED\|1\s*$/m.test(String(text || ''));

  // Wording of the result. A changed address is good news; the same one means the carrier handed the old one back.
  function verdict(before, after) {
    if (!after) return { kind: 'unknown', text: 'The new public address could not be read (no curl or wget with internet on the device).' };
    if (!before) return { kind: 'new', text: 'Public IP: ' + after };
    if (before === after) return { kind: 'same', text: 'Public IP: ' + after + ' (the same as before, try again)' };
    return { kind: 'changed', text: 'Public IP: ' + before + ' → ' + after };
  }

  window.MatchiChangeIp = { ipOf, localScript, publicScript, cycleScript, cycleOk, verdict };
})();

/* memclean-core.js: the logic of the Memory Cleaner tool, with no DOM and no network (scripts/test_memclean.js runs this file as it is).
 *   scanScript()          one root shell script: memory numbers, the foreground / home / keyboard app, every process with its RSS, the user-installed packages.
 *   parseScan(text)       its output -> {mem, top, home, ime, running: Map(pkg -> kB), user: [pkg]}
 *   candidates(scan)      the apps that may be offered for stopping: user-installed, running now, and not protected, biggest first.
 *   stopScript(pkgs, o)   the root script that stops the chosen apps, then (optionally) releases cached memory. Package names are checked here again.
 *   parseResult(text)     its output -> {beforeKb, afterKb, stopped}
 * Only apps the user installed (pm list packages -3) are ever offered. System packages are never touched. */
(() => {
  'use strict';

  const PKG_RX = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

  // Never offered, whatever the scan says: this app itself, and the apps that carry the router's connection (tunnels, proxies, root managers).
  const KEEP_EXACT = new Set(['com.matchi.tool']);
  const KEEP_PART = /easytier|mihomo|clash|v2ray|xray|sing-?box|wireguard|openvpn|tailscale|zerotier|magisk|apatch|kernelsu|ksu|sukisu|shizuku|termux/i;

  const kb = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };

  // "com.foo/.Main", "com.foo/com.foo.Main", "ComponentInfo{com.foo/...}" or a bare "com.foo" -> "com.foo". "", "null" -> ''.
  function pkgOf(s) {
    const t = String(s == null ? '' : s).trim();
    if (!t || t === 'null') return '';
    const m = t.match(/([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)(?:\/|$|\})/);
    return m ? m[1] : '';
  }
  // The package of the app on screen. `dumpsys activity top` says "ACTIVITY com.foo/.Main ..."; mCurrentFocus is the fallback ("Window{x u0 com.foo/com.foo.Main}").
  function topPkg(activityLine, focusLine) {
    const a = String(activityLine || '').match(/ACTIVITY\s+([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\//);
    if (a) return a[1];
    const f = String(focusLine || '').match(/\s([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\/[^\s}]+\}?\s*$/);
    return f ? f[1] : '';
  }

  function scanScript() {
    return [
      'echo "MEM|$(awk \'/^MemTotal:/{t=$2}/^MemAvailable:/{a=$2}/^SwapTotal:/{x=$2}/^SwapFree:/{y=$2}END{print t+0"|"a+0"|"x+0"|"y+0}\' /proc/meminfo)"',
      'echo "TOP|$(dumpsys activity top 2>/dev/null | grep -m1 \' ACTIVITY \')"',
      'echo "FOCUS|$(dumpsys window 2>/dev/null | grep -m1 mCurrentFocus)"',
      'echo "HOME|$(cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME 2>/dev/null | tail -n 1)"',
      'echo "IME|$(settings get secure default_input_method 2>/dev/null)"',
      'P=$(ps -A -o RSS,NAME 2>/dev/null)',
      'if [ -n "$P" ]; then echo "$P" | awk \'NR>1&&NF>=2{print "PS|"$1"|"$2}\'; else ps 2>/dev/null | awk \'NR>1&&NF>=5{print "PS|"$5"|"$NF}\'; fi',
      'pm list packages -3 2>/dev/null | sed \'s/^package:/USR|/\'',
    ].join('\n');
  }

  function parseScan(text) {
    const out = { mem: null, top: '', home: '', ime: '', running: new Map(), user: [] };
    let topLine = '', focusLine = '';
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.replace(/\r$/, '');
      const i = line.indexOf('|');
      if (i < 0) continue;
      const tag = line.slice(0, i), rest = line.slice(i + 1);
      if (tag === 'MEM') {
        const [t, a, st, sf] = rest.split('|');
        if (kb(t) && kb(a)) out.mem = { totalKb: kb(t), availKb: kb(a), swapTotalKb: kb(st), swapFreeKb: kb(sf) };
      } else if (tag === 'TOP') topLine = rest;
      else if (tag === 'FOCUS') focusLine = rest;
      else if (tag === 'HOME') out.home = pkgOf(rest);
      else if (tag === 'IME') out.ime = pkgOf(rest);
      else if (tag === 'PS') {
        const [r, name] = rest.split('|');
        const base = String(name || '').split(':')[0];     // "com.foo:remote" is a process of com.foo
        if (PKG_RX.test(base)) out.running.set(base, (out.running.get(base) || 0) + kb(r));
      } else if (tag === 'USR') {
        const p = rest.trim();
        if (PKG_RX.test(p) && !out.user.includes(p)) out.user.push(p);
      }
    }
    out.top = topPkg(topLine, focusLine);
    return out;
  }

  function isProtected(pkg, scan) {
    if (!PKG_RX.test(pkg)) return true;
    if (KEEP_EXACT.has(pkg) || KEEP_PART.test(pkg)) return true;
    return !!scan && (pkg === scan.top || pkg === scan.home || pkg === scan.ime);
  }

  function candidates(scan) {
    const list = [];
    for (const pkg of (scan && scan.user) || []) {
      if (!scan.running.has(pkg) || isProtected(pkg, scan)) continue;
      list.push({ pkg, kb: scan.running.get(pkg) });
    }
    return list.sort((a, b) => b.kb - a.kb || (a.pkg < b.pkg ? -1 : 1));
  }

  // opts.release: also sync, drop the page cache and compact memory. Nothing outside the stopped apps is changed permanently (no sysctl is written to stay).
  function stopScript(pkgs, opts) {
    const list = [...new Set((pkgs || []).filter((p) => PKG_RX.test(p) && !KEEP_EXACT.has(p)))];
    const o = opts || {};
    return [
      'MA() { awk \'/^MemAvailable:/{print $2; exit}\' /proc/meminfo; }',
      'echo "BEFORE|$(MA)"',
      'n=0',
      ...list.map((p) => `am force-stop '${p}' >/dev/null 2>&1 && n=$((n+1))`),
      'echo "STOPPED|$n"',
      'sleep 1',
      ...(o.release ? [
        'sync',
        '[ -w /proc/sys/vm/drop_caches ] && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null',
        '[ -w /proc/sys/vm/compact_memory ] && echo 1 > /proc/sys/vm/compact_memory 2>/dev/null',
        'sleep 1',
      ] : []),
      'echo "AFTER|$(MA)"',
    ].join('\n');
  }

  function parseResult(text) {
    const r = { beforeKb: 0, afterKb: 0, stopped: 0, ok: false };
    let seenBefore = false, seenAfter = false;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const m = raw.trim().match(/^(BEFORE|AFTER|STOPPED)\|(\d+)$/);
      if (!m) continue;
      if (m[1] === 'BEFORE') { r.beforeKb = kb(m[2]); seenBefore = true; }
      else if (m[1] === 'AFTER') { r.afterKb = kb(m[2]); seenAfter = true; }
      else r.stopped = Number(m[2]);
    }
    r.ok = seenBefore && seenAfter && r.beforeKb > 0 && r.afterKb > 0;
    return r;
  }

  function fmtKb(v) {
    const n = Math.max(0, Number(v) || 0);
    if (n >= 1048576) return (n / 1048576).toFixed(2) + ' GB';
    if (n >= 1024) return Math.round(n / 1024) + ' MB';
    return Math.round(n) + ' KB';
  }

  window.MatchiMemClean = { PKG_RX, pkgOf, topPkg, scanScript, parseScan, isProtected, candidates, stopScript, parseResult, fmtKb };
})();

#!/usr/bin/env node
// Phase 0: static scan of UFI-TOOLS plugins. Lists, per plugin, what it needs from the host.
// Usage: node scan_plugins.js [--json] [--csv] FILE_OR_DIR...
//   .txt  = a UFI export ("<!-- [KANO_PLUGIN_START] name -->" ... blocks; a .txt with no markers counts as one plugin)
//   .js .html .htm = one plugin each. A directory is searched for these (not into node_modules).
// STATIC ONLY: it reads source text. A URL or command built at run time shows as "dynamic", not as its value.
'use strict';
const fs = require('fs'), path = require('path');

const MARK = /<!--\s*\[KANO_PLUGIN_START\]\s*(.*?)\s*-->([\s\S]*?)<!--\s*\[KANO_PLUGIN_END\]\s*\1\s*-->/g;
const GLOBALS = ['createToast', 'createModal', 'showModal', 'closeModal', 'createFixedToast', 'requestInterval', 'uploadFileKano', 'downloadUrl',
  'KANO_baseURL', 'common_headers', 'runShellWithRoot', 'runShellWithUser', 'createSwitch', 'createFormToast', 'setBtnLoading', 'formatBytes',
  'escapeHtml', 'wait', 'debounce', 'copyText', 'UFI_DATA', 'getCookie', 'setCookie', 'kano-t', 'kano-sign', 'localStorage', 'sessionStorage',
  'checkAdvancedFunc', 'getData', 'postData', 'encodeBase64'];
// Page elements plugins look up or mount into (a plugin throws or mounts nowhere when the host lacks them).
const DOM = ['actions-buttons', 'collapseBtn_menu', 'collapse_box', 'functions-container'];
const TOOLS = ['curl', 'jq', 'sendat', 'zreq', 'ufi_req', 'sha256', 'socat', 'ttyd', 'adb', 'iperf3', 'imei_reader'];
const UFI_PATHS = [/\/data\/data\/com\.minikano\.f50_sms[A-Za-z0-9._\/-]*/g, /\/(?:sdcard|storage\/emulated\/0)\/ufi_tools_boot\.sh/g, /\/data\/local\/tmp\/[A-Za-z0-9._\/-]+/g];
// A name counts when it is not part of a longer name or property; window.X and parent.X count (they are the global).
const word = (n) => new RegExp('(^|[^A-Za-z0-9_$.-]|\\b(?:window|parent|top|self)\\.)' + n.replace(/[-]/g, '\\-') + '([^A-Za-z0-9_$-]|$)');

/** Plugins in one text: UFI blocks, or the whole text as one plugin when it has no markers. */
function split(text, name) {
  const out = []; MARK.lastIndex = 0; let m;
  while ((m = MARK.exec(text))) out.push({ name: m[1], code: m[2] });
  MARK.lastIndex = 0;
  return out.length ? out : (text.trim() ? [{ name, code: text }] : []);
}

function scan(code) {
  const s = String(code), uniq = (a) => [...new Set(a)].sort();
  const globals = GLOBALS.filter((g) => word(g).test(s));
  const tools = TOOLS.filter((t) => word(t).test(s));
  const dom = DOM.filter((d) => new RegExp('(^|[^A-Za-z0-9_$-])' + d + '([^A-Za-z0-9_$-]|$)').test(s));
  if (/(^|[^A-Za-z0-9_$.\"'#-])login\s*\(/.test(s) || /typeof\s+login\b/.test(s)) globals.push('login');
  const endpoints = [], dynamic = [];
  // /api/... literals, KANO_baseURL + '/x', and fetch(...) calls whose first argument is not one plain literal
  for (const m of s.matchAll(/['"`](\/api\/[A-Za-z0-9_\/.-]*)(\$\{[^`]*)?['"`]?/g)) (m[2] ? dynamic : endpoints).push(m[1].replace(/\/$/, '') || '/api');
  for (const m of s.matchAll(/KANO_baseURL\s*\+\s*(['"`])(\/[A-Za-z0-9_\/.-]*)(\$\{)?/g)) (m[3] ? dynamic : endpoints).push('/api' + m[2]);
  // `${KANO_baseURL}/AT?command=...` (template literal; the query part is ignored, the route name is kept)
  for (const m of s.matchAll(/\$\{\s*KANO_baseURL\s*\}(\/[A-Za-z0-9_\/.-]*)/g)) endpoints.push('/api' + m[1]);
  for (const m of s.matchAll(/\bfetch\s*\(\s*([^,)]{0,120})/g)) {
    const a = m[1].trim();
    if (/^(['"])[^'"]*\1$/.test(a) || /^`[^`$]*`$/.test(a)) continue;                 // one plain literal: seen above or not an /api call
    if (/KANO_baseURL\s*\+\s*['"`]\//.test(a) || /^`\$\{\s*KANO_baseURL\s*\}\//.test(a)) continue;   // resolved above
    dynamic.push('fetch(' + a.slice(0, 60) + ')');
  }
  const fields = [];
  for (const m of s.matchAll(/UFI_DATA\s*\.\s*([A-Za-z_$][\w$]*)/g)) fields.push(m[1]);
  for (const m of s.matchAll(/UFI_DATA\s*\[\s*['"]([^'"]+)['"]\s*\]/g)) fields.push(m[1]);
  const computedFields = /UFI_DATA\s*\[\s*[^'"\]\s]/.test(s);
  const ufiPaths = [];
  for (const rx of UFI_PATHS) for (const m of s.matchAll(rx)) ufiPaths.push(m[0]);
  const hosts = [...s.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map((m) => m[1].toLowerCase());
  return {
    globals, dom, tools, endpoints: uniq(endpoints), dynamic: uniq(dynamic), dataFields: uniq(fields), computedFields,
    ufiPaths: uniq(ufiPaths), hosts: uniq(hosts), root: /runShellWithRoot|\/api\/(?:root_shell|one_click_shell|shell)\b/.test(s),
    user: /runShellWithUser|\/api\/user_shell\b/.test(s), bytes: Buffer.byteLength(s),
  };
}

function collect(p, out) {
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const f of fs.readdirSync(p).sort()) if (f !== 'node_modules' && !f.startsWith('.')) collect(path.join(p, f), out); return; }
  if (/\.(txt|js|html?)$/i.test(p)) out.push(p);
}

function scanFiles(files) {
  const rows = [];
  for (const f of files) {
    const base = path.basename(f).replace(/\.(txt|js|html?)$/i, '');
    for (const pl of split(fs.readFileSync(f, 'utf8'), base)) rows.push({ file: f, name: pl.name, ...scan(pl.code) });
  }
  return rows;
}

function summary(rows) {
  const count = (pick) => { const m = new Map(); for (const r of rows) for (const k of pick(r)) m.set(k, (m.get(k) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); };
  return { plugins: rows.length, tools: count((r) => r.tools), endpoints: count((r) => r.endpoints), dataFields: count((r) => r.dataFields), globals: count((r) => r.globals),
    root: rows.filter((r) => r.root).length, user: rows.filter((r) => r.user).length, ufiPaths: rows.filter((r) => r.ufiPaths.length).length, dynamic: rows.filter((r) => r.dynamic.length).length };
}

module.exports = { split, scan, scanFiles, summary };

if (require.main === module) {
  const args = process.argv.slice(2), json = args.includes('--json'), csv = args.includes('--csv');
  const targets = args.filter((a) => !a.startsWith('--'));
  if (!targets.length) { console.error('usage: node scan_plugins.js [--json|--csv] FILE_OR_DIR...'); process.exit(2); }
  const files = []; try { for (const t of targets) collect(t, files); } catch (e) { console.error(e.message); process.exit(1); }
  if (!files.length) { console.error('no .txt, .js or .html files found'); process.exit(1); }
  const rows = scanFiles(files), sum = summary(rows);
  if (json) console.log(JSON.stringify({ rows, summary: sum }, null, 2));
  else if (csv) {
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"', cols = ['name', 'root', 'user', 'tools', 'endpoints', 'dynamic', 'dataFields', 'ufiPaths', 'hosts', 'globals'];
    console.log(cols.join(',')); for (const r of rows) console.log(cols.map((c) => q(Array.isArray(r[c]) ? r[c].join(' ') : r[c])).join(','));
  } else {
    for (const r of rows) {
      console.log(`${r.name}  (${r.bytes} bytes, ${path.basename(r.file)})`);
      console.log(`  shell: ${r.root ? 'root' : ''}${r.root && r.user ? ' + ' : ''}${r.user ? 'user' : ''}${!r.root && !r.user ? 'none' : ''}`);
      for (const [label, v] of [['tools', r.tools], ['api', r.endpoints], ['dynamic', r.dynamic], ['UFI_DATA', r.dataFields.concat(r.computedFields ? ['(computed keys)'] : [])], ['UFI paths', r.ufiPaths], ['hosts', r.hosts], ['page elements', r.dom], ['helpers', r.globals]])
        if (v.length) console.log(`  ${label}: ${v.join(', ')}`);
    }
    console.log(`\n${sum.plugins} plugin(s): ${sum.root} use root shell, ${sum.user} user shell, ${sum.ufiPaths} name UFI paths, ${sum.dynamic} have dynamic URLs`);
    for (const [label, list] of [['tools', sum.tools], ['api routes', sum.endpoints], ['UFI_DATA fields', sum.dataFields]]) if (list.length) console.log(`${label}: ` + list.map(([k, n]) => `${k} x${n}`).join(', '));
  }
}

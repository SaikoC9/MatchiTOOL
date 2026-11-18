#!/usr/bin/env node
// innerHTML lint. Finds every place the page writes markup (innerHTML / outerHTML / insertAdjacentHTML / document.write) and sorts it:
//   static   - the right-hand side is only literal text, nothing is interpolated            -> always fine
//   escaped  - the statement interpolates values and also calls esc( / escapeHtml( / MT_html -> fine (the call is not proven to cover every value)
//   reviewed - interpolates values without an escape call on that statement; listed in scripts/innerhtml-reviewed.json with the reason a person gave
// A new site that is none of these fails. A reviewed entry whose code vanished also fails, so the list cannot rot.
//   node scripts/check_innerhtml.js            check
//   node scripts/check_innerhtml.js --list     print every site with its class
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'app/src/main/assets/web/index.html'), 'utf8');
const reviewedFile = path.join(__dirname, 'innerhtml-reviewed.json');
const reviewed = fs.existsSync(reviewedFile) ? JSON.parse(fs.readFileSync(reviewedFile, 'utf8')) : {};
const SINK = /(\.innerHTML\s*\+?=(?!=)|\.outerHTML\s*=(?!=)|\.insertAdjacentHTML\s*\(|document\.write(?:ln)?\s*\()/;
const key = (s) => crypto.createHash('sha1').update(s.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 10);

function statementAt(lines, i) {            // from the sink to the first top-level ";" (outside strings, template literals and brackets), at most 25 lines
  const first = lines[i], at = first.search(SINK);
  let text = '', depth = 0, tick = 0, q = null;
  for (let k = i; k < Math.min(lines.length, i + 25); k++) {
    const ln = k === i ? first.slice(at) : lines[k];
    text += (k > i ? '\n' : '');
    for (let c = 0; c < ln.length; c++) {
      const ch = ln[c];
      text += ch;
      if (ch === '\\') { c++; text += ln[c] || ''; continue; }
      if (tick) { if (ch === '`') tick = 0; continue; }
      if (q) { if (ch === q) q = null; continue; }
      if (ch === '`') tick = 1; else if (ch === '"' || ch === "'") q = ch;
      else if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) { depth--; if (depth < 0) return text; }
      else if (ch === ';' && depth <= 0) return text;
    }
    if (q && !tick) q = null;                 // quotes never span lines outside a template literal
  }
  return text;
}
function classify(stmt) {
  const noStr = stmt.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");     // literal strings
  const interp = /\$\{/.test(noStr);
  const rest = noStr.replace(SINK, '').replace(/`[^`$]*`/g, '').replace(/''/g, '').replace(/[\s+;,()]/g, '');
  if (!interp && rest === '') return 'static';
  if (/\besc\(|\bescapeHtml\(|\bMT_html\b|\bsetHtml\(/.test(stmt)) return 'escaped';
  return 'review';
}

const lines = page.split('\n'), sites = [];
lines.forEach((ln, i) => { if (SINK.test(ln) && !/^\s*(\/\/|\*)/.test(ln)) { const stmt = statementAt(lines, i); sites.push({ line: i + 1, cls: classify(stmt), key: key(stmt), snip: ln.trim().slice(0, 110) }); } });

if (process.argv.includes('--list')) { for (const s of sites) console.log(String(s.line).padStart(5), s.cls.padEnd(7), s.key, s.snip); }
let bad = 0; const seen = new Set();
for (const s of sites) {
  if (s.cls !== 'review') continue;
  seen.add(s.key);
  if (!reviewed[s.key]) { console.error('line ' + s.line + ': markup is built with values and no esc()/MT_html on the statement:\n    ' + s.snip + '\n    Use MT_html.html`...` / esc(), or add key ' + s.key + ' to scripts/innerhtml-reviewed.json with the reason it is safe.'); bad++; }
}
for (const k of Object.keys(reviewed)) if (!seen.has(k)) { console.error('scripts/innerhtml-reviewed.json: entry ' + k + ' matches no code any more (' + reviewed[k] + '). Remove it.'); bad++; }
const n = (c) => sites.filter((s) => s.cls === c).length;
if (bad) process.exit(1);
console.log('innerHTML sites: ' + sites.length + ' (static ' + n('static') + ', escaped ' + n('escaped') + ', reviewed ' + n('review') + ')');

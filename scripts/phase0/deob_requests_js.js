#!/usr/bin/env node
// Phase 0: decodes the string table of an obfuscator.io style script (UFI-TOOLS requests.js) so it can be read.
// Usage: node deob_requests_js.js requests.js [out.js]      (default out: requests.decoded.js; prints a short report)
//
// How: the script keeps its strings in one function (an array) and reads them through a decoder function, after a
// rotation call that shuffles the array. This tool runs ONLY those three pieces in an empty vm context (no require, no
// network, 5 s limit), then replaces every decoder call that has literal arguments with the string it returns.
// Calls with computed arguments (for example _0xabc(x - 1)) stay as they are and are counted.
// Not run on main.js: it has a different string table (see the roadmap).
'use strict';
const fs = require('fs'), vm = require('vm');

/** Returns the index just after the closing brace/paren that matches the opener at [open] (strings and comments skipped). */
function matchClose(src, open) {
  const pairs = { '{': '}', '(': ')', '[': ']' };
  const stack = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return -1; i++; continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === '}' || c === ']') { if (stack.pop() !== c) return -1; if (!stack.length) return i + 1; }
  }
  return -1;
}

function decode(src) {
  // 1. the array function: a function whose body is "const X=[ 'a','b',... ]; ... return X" - found as the one the decoder calls.
  const fnRx = /function\s+(_0x[a-f0-9]+)\s*\(([^)]*)\)\s*\{/g;
  const fns = []; let m;
  while ((m = fnRx.exec(src))) { const open = m.index + m[0].length - 1, end = matchClose(src, open); if (end > 0) fns.push({ name: m[1], start: m.index, end, text: src.slice(m.index, end) }); }
  const arrayFn = fns.find(f => /=\s*\[\s*['"]/.test(f.text) && f.text.length > 2000);
  if (!arrayFn) throw new Error('string-array function not found (is this an obfuscator.io style file?)');
  const decoder = fns.find(f => f !== arrayFn && f.text.includes(arrayFn.name + '()'));
  if (!decoder) throw new Error('decoder function not found');
  // 2. the rotation call, if any: (function(a,b){...}(arrayFn, 0x1234)) near the top.
  let rotation = '';
  const rotRx = new RegExp('\\(function\\s*\\(');
  for (let i = src.search(rotRx); i >= 0 && i < src.length;) {
    const end = matchClose(src, i);
    if (end > 0) {
      const text = src.slice(i, end + (src[end] === ';' ? 1 : 0));
      if (text.includes(arrayFn.name) && /parseInt|push|shift/.test(text)) { rotation = text.endsWith(';') ? text : text + ';'; break; }
    }
    const next = src.slice(i + 1).search(rotRx); if (next < 0) break; i += 1 + next;
  }
  // 3. run them
  const ctx = vm.createContext({});
  vm.runInContext(arrayFn.text + '\n' + decoder.text + '\n' + rotation, ctx, { timeout: 5000 });
  const call = (args) => vm.runInContext(decoder.name + '(' + args + ')', ctx, { timeout: 5000 });
  // 4. aliases such as "const _0xabc=_0xdecoder;" and "const _0xabc = _0xalias,"
  const names = new Set([decoder.name]);
  for (let grew = true; grew;) {
    grew = false;
    for (const mm of src.matchAll(/(?:const|let|var)\s+(_0x[a-f0-9]+)\s*=\s*(_0x[a-f0-9]+)\s*[,;)]/g)) if (names.has(mm[2]) && !names.has(mm[1])) { names.add(mm[1]); grew = true; }
    for (const mm of src.matchAll(/,\s*(_0x[a-f0-9]+)\s*=\s*(_0x[a-f0-9]+)\s*[,;]/g)) if (names.has(mm[2]) && !names.has(mm[1])) { names.add(mm[1]); grew = true; }
  }
  // 5. replace calls whose arguments are numeric or string literals only
  const alt = [...names].join('|');
  const callRx = new RegExp('\\b(' + alt + ')\\(\\s*((?:0x[0-9a-fA-F]+|\\d+|\'[^\'\\\\]*\'|"[^"\\\\]*")(?:\\s*,\\s*(?:0x[0-9a-fA-F]+|\\d+|\'[^\'\\\\]*\'|"[^"\\\\]*"))*)\\s*\\)', 'g');
  let replaced = 0, failed = 0;
  const out = src.replace(callRx, (all, _n, args) => { try { const v = call(args); if (typeof v !== 'string') { failed++; return all; } replaced++; return JSON.stringify(v); } catch (_) { failed++; return all; } });
  const left = (out.match(new RegExp('\\b(' + alt + ')\\(', 'g')) || []).length - 2 * names.size; // definitions and alias lines are not calls
  return { code: out, replaced, failed, unresolved: Math.max(0, left), decoder: decoder.name, aliases: names.size - 1, arrayFn: arrayFn.name, rotated: !!rotation };
}
module.exports = { decode, matchClose };

if (require.main === module) {
  const [inp, outp] = process.argv.slice(2);
  if (!inp) { console.error('usage: node deob_requests_js.js requests.js [out.js]'); process.exit(2); }
  let r; try { r = decode(fs.readFileSync(inp, 'utf8')); } catch (e) { console.error('Could not decode: ' + e.message); process.exit(1); }
  const dest = outp || inp.replace(/\.js$/, '') + '.decoded.js';
  fs.writeFileSync(dest, r.code);
  console.log(`decoder ${r.decoder}, array ${r.arrayFn}, rotation ${r.rotated ? 'run' : 'none found'}, ${r.aliases} alias(es)`);
  console.log(`${r.replaced} string call(s) replaced, ${r.failed} failed, about ${r.unresolved} call(s) with computed arguments left`);
  console.log('written ' + dest);
  const api = [...new Set((r.code.match(/["']\/[A-Za-z0-9_\/.-]{2,}["']/g) || []))].sort();
  console.log('path-like strings (' + api.length + '): ' + api.slice(0, 60).join(' '));
}

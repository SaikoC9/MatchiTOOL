#!/usr/bin/env node
// Plugin code lives in app/src/main/web-src/*.js and is inlined into the one shipped page, app/src/main/assets/web/index.html,
// between marker lines:   /* @include web-src/NAME.js */ ... /* @end-include web-src/NAME.js */
// The page stays a single self-contained file (the APK and every test read that file); the split only changes where you edit.
//   node scripts/build-web.js          rewrite the included blocks in index.html from web-src/
//   node scripts/build-web.js --check  exit 1 if index.html differs from web-src/ or its PAGE_VERSION differs from version.properties (validate.sh runs this)
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), page = path.join(root, 'app/src/main/assets/web/index.html'), src = path.join(root, 'app/src/main/web-src');
const check = process.argv.includes('--check');
const html = fs.readFileSync(page, 'utf8');
const version = require('./version.js').name;   // version.properties is the one source of the app version
const re = /^\/\* @include web-src\/([A-Za-z0-9._-]+) \*\/\n[\s\S]*?^\/\* @end-include web-src\/\1 \*\//gm;
const used = new Set(); let bad = 0;
const out = html.replace(/const PAGE_VERSION='[^']*';/, "const PAGE_VERSION='" + version + "';").replace(re, (all, name) => {
  used.add(name);
  const f = path.join(src, name);
  if (!fs.existsSync(f)) { console.error('missing source file web-src/' + name); bad++; return all; }
  const body = fs.readFileSync(f, 'utf8');
  if (/<!--[\s\S]*<script/i.test(body)) { console.error('web-src/' + name + ' holds a comment opener followed by a script tag: inside the inline page script the HTML parser then ignores the real closing tag. Build the strings from pieces.'); bad++; return all; }
  if (/<\/script/i.test(body)) { console.error('web-src/' + name + ' contains "</script", which would end the page script early'); bad++; return all; }
  return '/* @include web-src/' + name + ' */\n' + body + '\n/* @end-include web-src/' + name + ' */';
});
for (const f of fs.readdirSync(src)) if (f.endsWith('.js') && !used.has(f)) { console.error('web-src/' + f + ' is not included anywhere in index.html'); bad++; }
if (bad) process.exit(1);
if (check) {
  if (out !== html) { console.error('index.html is out of date with web-src/. Run: node scripts/build-web.js (edit web-src/, not the included part of index.html)'); process.exit(1); }
  console.log('web-src and index.html are in sync (' + used.size + ' files)'); process.exit(0);
}
if (out !== html) { fs.writeFileSync(page, out); console.log('index.html updated from web-src (' + used.size + ' files)'); } else console.log('index.html already up to date (' + used.size + ' files)');

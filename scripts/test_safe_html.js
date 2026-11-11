#!/usr/bin/env node
// MT_html (web-src/safe-html.js): values are escaped unless marked, and scripts/check_innerhtml.js rejects a new unescaped innerHTML site.
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert'), vm = require('vm'), cp = require('child_process'), os = require('os');
const win = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/src/main/web-src/safe-html.js'), 'utf8'), { window: win });
const { html, raw, esc, setHtml } = win.MT_html;
const bad = '<img src=x onerror="alert(1)">\'';
assert.strictEqual(esc(bad), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;');
assert.strictEqual(String(html`<b>${bad}</b>`), '<b>' + esc(bad) + '</b>');
assert.strictEqual(String(html`<ul>${['a', '<b>'].map((i) => html`<li>${i}</li>`)}</ul>`), '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
assert.strictEqual(String(html`<p>${raw('<i>ok</i>')}${null}${false}${0}</p>`), '<p><i>ok</i>0</p>');
const el = {}; setHtml(el, '<b>x</b>'); assert.strictEqual(el.innerHTML, '&lt;b&gt;x&lt;/b&gt;');   // a plain string is escaped
setHtml(el, raw('<b>x</b>')); assert.strictEqual(el.innerHTML, '<b>x</b>');
assert.strictEqual(Object.isFrozen(win.MT_html), true);
// the lint must reject a new unescaped site and accept an escaped or static one
const root = path.join(__dirname, '..'), pg = path.join(root, 'app/src/main/assets/web/index.html'), orig = fs.readFileSync(pg, 'utf8');
function lint(extra) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-')), d = path.join(tmp, 'app/src/main/assets/web'), s = path.join(tmp, 'scripts');
  fs.mkdirSync(d, { recursive: true }); fs.mkdirSync(s, { recursive: true });
  fs.writeFileSync(path.join(d, 'index.html'), orig.replace('</body>', '<script>' + extra + '</script></body>'));
  for (const f of ['check_innerhtml.js', 'innerhtml-reviewed.json']) fs.copyFileSync(path.join(__dirname, f), path.join(s, f));
  const r = cp.spawnSync('node', [path.join(s, 'check_innerhtml.js')], { encoding: 'utf8' }); fs.rmSync(tmp, { recursive: true, force: true }); return r;
}
assert.strictEqual(lint('').status, 0);
assert.strictEqual(lint("box.innerHTML = '<b>' + userText + '</b>';").status, 1);
assert.strictEqual(lint('box.innerHTML = `<b>${userText}</b>`;').status, 1);
assert.strictEqual(lint("box.innerHTML = '<b>' + esc(userText) + '</b>';").status, 0);
assert.strictEqual(lint("box.innerHTML = '<b>fixed</b>';").status, 0);
assert.strictEqual(lint("MT_html.setHtml(box, MT_html.html`<b>${userText}</b>`);").status, 0);
console.log('safe html ok');

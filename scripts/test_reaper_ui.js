'use strict';
// The "Wipe on uninstall" card (web-src/reaper-ui.js): the status wording and that the page includes the card.
const assert = require('assert'), fs = require('fs'), path = require('path');
const ui = require('../app/src/main/web-src/reaper-ui.js');
const t = (n, f) => { f(); };
const ok = { ok: true, installed: true, installedVersion: 3, bundledVersion: 3, outdated: false, running: true, stub: true, stubCurrent: true };

t('all in order: watching, good', () => {
  const v = ui.statusView(ok, true, '');
  assert.strictEqual(v.level, 'good'); assert.ok(/Watching \(version 3\)/.test(v.text)); assert.ok(/Boot script in place/.test(v.text));
});
t('nothing read yet: neutral, no claim', () => {
  assert.deepStrictEqual(ui.statusView(null, true, ''), { text: 'Checking…', level: 'mut' });
});
t('an error or a failed root call is shown, never "watching"', () => {
  assert.strictEqual(ui.statusView(null, true, 'Session too old for root commands - sign in again').level, 'warn');
  assert.ok(/Session too old/.test(ui.statusView(null, true, 'Session too old for root commands - sign in again').text));
  const v = ui.statusView({ ok: false, error: 'no root' }, true, '');
  assert.strictEqual(v.level, 'warn'); assert.ok(/no root/.test(v.text)); assert.ok(!/Watching/.test(v.text));
});
t('switch ON but nothing installed / not running / no boot stub / old stub', () => {
  assert.ok(/Not installed yet/.test(ui.statusView({ ok: true, installed: false, running: false, stub: false }, true, '').text));
  const nr = ui.statusView({ ...ok, running: false }, true, ''); assert.strictEqual(nr.level, 'bad'); assert.ok(/not running/.test(nr.text));
  const ns = ui.statusView({ ...ok, stub: false }, true, ''); assert.strictEqual(ns.level, 'warn'); assert.ok(/boot script is missing/.test(ns.text));
  assert.strictEqual(ui.statusView({ ...ok, stubCurrent: false }, true, '').level, 'warn');
});
t('outdated watcher is still watching', () => {
  const v = ui.statusView({ ...ok, installedVersion: 2, bundledVersion: 3, outdated: true }, true, '');
  assert.strictEqual(v.level, 'good'); assert.ok(/version 2/.test(v.text) && /version 3/.test(v.text));
});
t('switch OFF: says nothing watches; a leftover watcher is flagged', () => {
  const off = ui.statusView({ ok: true, installed: false, running: false, stub: false }, false, '');
  assert.strictEqual(off.level, 'warn'); assert.ok(/Nothing is watching/.test(off.text)); assert.ok(/items below stay/.test(off.text));
  assert.ok(/still there/.test(ui.statusView(ok, false, '').text));
});
t('the page includes the card; the card builds no markup from text and has no uninstall action', () => {
  const page = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/web/index.html'), 'utf8');
  assert.ok(page.includes('/* @include web-src/reaper-ui.js */'));
  const src = fs.readFileSync(path.join(__dirname, '../app/src/main/web-src/reaper-ui.js'), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(src));
  assert.ok(/'\/api\/reaper'/.test(src) && /'\/api\/reaper\/status'/.test(src));
  assert.ok(!/ACTION_DELETE|pm uninstall/.test(src));
});
console.log('reaper ui test passed');

'use strict';
// The "Device commands" card (web-src/cmd-card.js): the list is read-only shell commands, and the page includes the card.
const assert = require('assert'), fs = require('fs'), path = require('path');
const ui = require('../app/src/main/web-src/cmd-card.js');
const t = (n, f) => { f(); };
t('groups: every row is a label and a command', () => {
  assert.ok(ui.GROUPS.length >= 5);
  for (const [name, rows] of ui.GROUPS) { assert.ok(name && rows.length); for (const [l, c] of rows) { assert.ok(l && c, name); } }
});
t('no command that changes the router or the SIM slot, or wipes anything', () => {
  const all = ui.GROUPS.flatMap(([, r]) => r.map((x) => x[1])).join('\n');
  assert.ok(!/sendat -n 1/.test(all)); assert.ok(!/zreq[^\n]*-body/.test(all)); assert.ok(!/\brm\s/.test(all)); assert.ok(!/\breboot\b/.test(all));
  assert.ok(!/(^|\n)kill -9/.test(all));
});
t('only Kill all copies stops anything', () => {
  const stops = ui.GROUPS.flatMap(([, r]) => r).filter(([, c]) => /pkill|\bkill\b/.test(c));
  assert.deepStrictEqual(stops.map((x) => x[0]), ['Kill all copies']);
});
t('the page includes the card and the card builds no markup from text', () => {
  const page = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/web/index.html'), 'utf8');
  assert.ok(page.includes('/* @include web-src/cmd-card.js */'));
  const src = fs.readFileSync(path.join(__dirname, '../app/src/main/web-src/cmd-card.js'), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(src));
});
console.log('cmd card test passed');

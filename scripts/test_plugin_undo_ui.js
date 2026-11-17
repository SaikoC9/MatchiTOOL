#!/usr/bin/env node
// Phase 3 / Step 4: the delete dialog's undo text and decisions (web-src/plugin-undo-ui.js), and that the delete handler in the page uses them.
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const ui = require('../app/src/main/web-src/plugin-undo-ui.js');
const sweep = require('../app/src/main/web-src/plugin-sweep-ui.js');
const page = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/web/index.html'), 'utf8');
let n = 0; const t = (name, f) => { f(); n++; };
const CH = 'firewall chain MY_CHAIN (iptables, table mangle)', BT = 'boot script 20-bypass-ttl.sh';
const info = (u) => ({ undo: Object.assign({ items: [], notUndone: [], hash: '' }, u) });
const un = (u) => ui.undoNorm(info(u));
const full = () => un({ items: [{ kind: 'chain', label: CH }, { kind: 'boot', label: BT }], hash: 'H1' });
const noSw = sweep.sweepNorm(null);

t('norm: missing undo = no items, no hash', () => {
  for (const x of [null, undefined, {}, { undo: null }]) {
    const u = ui.undoNorm(x); assert.deepStrictEqual(u.items, []); assert.deepStrictEqual(u.notUndone, []); assert.strictEqual(u.hash, '');
  }
});
t('norm: garbage items dropped, hash must be a string', () => {
  const u = un({ items: [{ kind: 'chain', label: CH }, null, {}, { kind: 'x' }, { label: '' }, { label: 5 }], hash: 7 });
  assert.strictEqual(u.items.length, 1); assert.strictEqual(u.items[0].label, CH); assert.strictEqual(u.hash, '');
});
t('mode: a headerless plugin with only undo items becomes \"sweep\" (the stop must run)', () => {
  assert.strictEqual(sweep.pluginDeleteMode({}, noSw, false, full()), 'sweep');
  assert.strictEqual(sweep.pluginDeleteMode({}, noSw, true, full()), 'sweep');
});
t('mode: no undo items = Phase 2 results; undo changes nothing when commands are declared or the stop cannot run', () => {
  const none = un({});
  assert.strictEqual(sweep.pluginDeleteMode({}, noSw, false, none), 'plain');
  assert.strictEqual(sweep.pluginDeleteMode({}, noSw, true, none), 'hook');
  assert.strictEqual(sweep.pluginDeleteMode({}, noSw, false), 'plain');   // old callers
  assert.strictEqual(sweep.pluginDeleteMode({ commands: ['a'] }, noSw, false, full()), 'stop');
  assert.strictEqual(sweep.pluginDeleteMode({ commands: ['a'], shared: ['B'] }, noSw, false, full()), 'shared');
  assert.strictEqual(sweep.pluginDeleteMode({ refused: [{}] }, noSw, false, full()), 'cannot');
  assert.strictEqual(sweep.pluginDeleteMode({}, sweep.sweepNorm({ sweep: { rootOk: true, overCap: true, found: 61 } }), false, full()), 'toomany');
});
t('modeRuns: stop, sweep and hook run the undo; shared, cannot, toomany, plain do not', () => {
  for (const x of ['stop', 'sweep', 'hook']) assert.strictEqual(ui.undoModeRuns(x), true, x);
  for (const x of ['shared', 'cannot', 'toomany', 'plain']) assert.strictEqual(ui.undoModeRuns(x), false, x);
});
t('text: lists every item, says \"if it is still there\", root, and that a leftover keeps the plugin', () => {
  const m = ui.undoDialogText(full(), 'sweep', false);
  assert.ok(m.includes('\u2022 ' + CH)); assert.ok(m.includes('\u2022 ' + BT));
  assert.ok(m.includes('if it is still there')); assert.ok(m.includes('as root')); assert.ok(m.includes('the plugin is kept'));
  assert.ok(!m.includes('Root is not available'));
});
t('text: stop and hook modes say the same; shared says \"if the stop runs\"', () => {
  assert.ok(ui.undoDialogText(full(), 'stop', false).includes('Then it also removes'));
  assert.ok(ui.undoDialogText(full(), 'hook', false).includes('Then it also removes'));
  const s = ui.undoDialogText(full(), 'shared', false);
  assert.ok(s.includes('If the stop runs')); assert.ok(s.includes(CH));
});
t('text: when the stop does not run (cannot, toomany, plain) the items are listed as staying, never as removed', () => {
  for (const mode of ['cannot', 'toomany', 'plain']) {
    const m = ui.undoDialogText(full(), mode, false);
    assert.ok(m.includes('stay in the system'), mode); assert.ok(m.includes(CH)); assert.ok(!m.includes('removes')); assert.ok(!m.includes('is kept'));
  }
});
t('text: root missing adds one sentence, only where the stop would run', () => {
  assert.ok(ui.undoDialogText(full(), 'sweep', true).includes('Root is not available'));
  assert.ok(!ui.undoDialogText(full(), 'cannot', true).includes('Root is not available'));
});
t('text: nothing to undo and nothing kept = empty', () => {
  for (const mode of ['plain', 'stop', 'sweep', 'hook', 'shared', 'cannot', 'toomany']) assert.strictEqual(ui.undoDialogText(un({}), mode, false), '');
});
t('text: items kept on purpose (shared guard) and ignored ledger lines are listed under \"Not undone\"', () => {
  const k = un({ notUndone: ['firewall chain X (iptables, table filter): also used by Other.js, so it is kept', '2 ledger line(s) ignored: not a valid chain or boot script entry'] });
  const m = ui.undoDialogText(k, 'plain', false);
  assert.ok(m.includes('Not undone:')); assert.ok(m.includes('also used by Other.js')); assert.ok(m.includes('2 ledger line(s) ignored'));
  assert.ok(!m.includes('removes'));
});
t('text: the dialog sets textContent, so ledger text is never altered', () => {
  const evil = 'boot script <img src=x onerror=alert(1)>$(rm -rf /).sh';
  assert.ok(ui.undoDialogText(un({ items: [{ kind: 'boot', label: evil }] }), 'sweep', false).includes(evil));
});
t('retry text: lists what Try again would remove; empty with nothing', () => {
  const m = ui.undoRetryText(full()); assert.ok(m.includes(CH)); assert.ok(m.includes(BT)); assert.ok(m.includes('Try again'));
  assert.strictEqual(ui.undoRetryText(un({})), '');
});
t('effects text: \"cannot undo\" only when the undo does not run', () => {
  assert.ok(ui.undoEffectsText(['firewall rules'], false).includes('deleting cannot undo'));
  const m = ui.undoEffectsText(['firewall rules'], true);
  assert.ok(!m.includes('cannot undo')); assert.ok(m.includes('Only the items listed above are undone'));
  assert.strictEqual(ui.undoEffectsText([], true), ''); assert.strictEqual(ui.undoEffectsText(null, false), '');
});
t('retry: a restart is not offered while a boot file or boot script is left', () => {
  assert.strictEqual(ui.leftHasBoot(['boot file still there: /data/local/matchitool/boot.d/20-x.sh']), true);
  assert.strictEqual(ui.leftHasBoot(['still there: boot script 20-bypass-ttl.sh']), true);
  assert.strictEqual(ui.leftHasBoot(['not undone: boot script 20-bypass-ttl.sh (symlink check failed)']), true);
  assert.strictEqual(ui.leftHasBoot(['still there: firewall chain MY_CHAIN (iptables, table mangle)']), false);
  assert.strictEqual(ui.leftHasBoot(['PID 5 sh']), false); assert.strictEqual(ui.leftHasBoot(null), false);
});
t('request: the undoHash goes with stop only, and the key is present even when empty', () => {
  assert.deepStrictEqual(ui.undoRequestFields(full(), true), { undoHash: 'H1' });
  assert.deepStrictEqual(ui.undoRequestFields(full(), false), {});
  assert.deepStrictEqual(ui.undoRequestFields(un({}), true), { undoHash: '' });
  assert.deepStrictEqual(ui.undoRequestFields(ui.undoNorm(null), true), { undoHash: '' });
});
t('toast: only after a stop that succeeded, with a count', () => {
  assert.strictEqual(ui.undoToastText(full(), true), ' (2 items no longer in the system)');
  assert.strictEqual(ui.undoToastText(un({ items: [{ kind: 'boot', label: BT }] }), true), ' (1 item no longer in the system)');
  assert.strictEqual(ui.undoToastText(full(), false), ''); assert.strictEqual(ui.undoToastText(un({}), true), '');
});

// The page handler.
t('page: handler wired to the helpers', () => {
  const h = page.slice(page.indexOf('d.onclick=async()=>{\n      let failure=null'));
  assert.ok(h.length > 1000);
  for (const needle of ['undoNorm(info)', 'pluginDeleteMode(sp,sw,hk,un)', 'undoDialogText(un,mode,noRoot)', 'undoRetryText(un)', 'undoEffectsText(fx,', 'leftHasBoot(left)', 'undoToastText(un,stopped)'])
    assert.ok(h.includes(needle), 'handler lacks ' + needle);
  assert.strictEqual((h.match(/undoRequestFields\(un,true\)/g) || []).length, 2, 'both stop paths (direct and after the hook) send undoHash');
  const skipLine = h.slice(h.indexOf('else if(skip)'), h.indexOf('else if(skip)') + 60);
  assert.ok(!skipLine.includes('undoHash') && !skipLine.includes('undoRequestFields'), 'Delete without stopping sends no undoHash');
  assert.ok(h.includes('msg+=swText+unText;swDone=true;') && h.includes('if(!swDone)msg+=swText+unText;'), 'the undo text is shown in every mode');
});
t('page: the host\'s undo 409 reopens the dialog', () => {
  const kt = fs.readFileSync(path.join(__dirname, '../app/src/main/java/com/matchi/tool/WebRoutesPlugins.kt'), 'utf8');
  const m = /put\("code", "plan-changed"\)\.put\("error", "(What it left behind[^"]*)"\)/.exec(kt);
  assert.ok(m, 'host 409 text for the undo not found'); assert.ok(/changed since you reviewed/.test(m[1]));
  assert.ok(kt.includes('req.has("undoHash")'), 'host reads undoHash');
});
console.log('plugin undo dialog tests passed (' + n + ')');

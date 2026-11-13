#!/usr/bin/env node
// Phase 2 / Step 6: the delete dialog's process-sweep text and decisions (web-src/plugin-sweep-ui.js), and that the delete handler in the page uses them.
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const ui = require('../app/src/main/web-src/plugin-sweep-ui.js');
const page = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/web/index.html'), 'utf8');
let n = 0; const t = (name, f) => { f(); n++; };
const cand = (pid, how, args) => ({ pid, start: 100 + pid, how, args });
const info = (s) => ({ sweep: Object.assign({ rootOk: true, candidates: [], notStopped: [], notes: [], found: 0, overCap: false, complete: true, sweepHash: '' }, s) });
const sw = (s) => ui.sweepNorm(info(s));

t('norm: missing sweep = unchecked, empty, no hash', () => {
  for (const x of [null, undefined, {}, { sweep: null }]) {
    const w = ui.sweepNorm(x);
    assert.strictEqual(w.checked, false); assert.deepStrictEqual(w.cands, []); assert.strictEqual(w.hash, ''); assert.strictEqual(w.overCap, false);
  }
});
t('norm: only rootOk === true counts as checked; garbage entries dropped', () => {
  assert.strictEqual(ui.sweepNorm({ sweep: { rootOk: 'yes' } }).checked, false);
  const w = sw({ candidates: [cand(7, 'tag', 'beat.sh'), null, { pid: 'x' }, { args: 'no pid' }], sweepHash: 'abc' });
  assert.strictEqual(w.cands.length, 1); assert.strictEqual(w.hash, 'abc');
});
t('norm: complete defaults to true only when the host did not say false', () => {
  assert.strictEqual(sw({}).complete, true); assert.strictEqual(sw({ complete: false }).complete, false);
});
t('proc line names PID, args and how', () => {
  assert.strictEqual(ui.sweepProcLine(cand(1234, 'tag', '/data/beat.sh')), 'PID 1234 /data/beat.sh (found by tag)');
  assert.ok(ui.sweepProcLine(cand(5, 'pidfile', 'x')).includes('pid file'));
  assert.ok(ui.sweepProcLine(cand(6, 'cmdline', 'x')).includes('weakest'));
  assert.strictEqual(ui.sweepProcLine({ pid: 9, how: 'tag', args: '' }), 'PID 9 (found by tag)');
});
t('mode: Phase 1 cases unchanged without a sweep', () => {
  const none = sw({});
  assert.strictEqual(ui.pluginDeleteMode({}, none), 'plain');
  assert.strictEqual(ui.pluginDeleteMode({ commands: ['a'] }, none), 'stop');
  assert.strictEqual(ui.pluginDeleteMode({ commands: ['a'], shared: ['B'] }, none), 'shared');
  assert.strictEqual(ui.pluginDeleteMode({ commands: ['a'], refused: [{ command: 'x' }] }, none), 'cannot');
  assert.strictEqual(ui.pluginDeleteMode({ refused: [{ command: 'x' }] }, none), 'cannot');
  assert.strictEqual(ui.pluginDeleteMode({ shared: ['B'] }, none), 'plain');   // as before: shared only matters with commands
});
t('mode: a headerless plugin with processes found becomes "sweep" (D2)', () => {
  assert.strictEqual(ui.pluginDeleteMode({}, sw({ candidates: [cand(1, 'tag', 'a')] })), 'sweep');
});
t('mode: declared commands + processes stay stop / shared; refused wins; over the cap = toomany', () => {
  const c = sw({ candidates: [cand(1, 'tag', 'a')] });
  assert.strictEqual(ui.pluginDeleteMode({ commands: ['a'] }, c), 'stop');
  assert.strictEqual(ui.pluginDeleteMode({ commands: ['a'], shared: ['B'] }, c), 'shared');
  assert.strictEqual(ui.pluginDeleteMode({ commands: ['a'], refused: [{}] }, c), 'cannot');
  const big = sw({ overCap: true, found: 61, candidates: [cand(1, 'tag', 'a')] });
  assert.strictEqual(ui.pluginDeleteMode({}, big), 'toomany');
  assert.strictEqual(ui.pluginDeleteMode({ commands: ['a'] }, big), 'toomany');
  assert.strictEqual(ui.pluginDeleteMode({ commands: ['a'], refused: [{}] }, big), 'cannot');
});
t('mode: an unchecked scan changes nothing', () => {
  assert.strictEqual(ui.pluginDeleteMode({}, ui.sweepNorm({ sweep: { rootOk: false, notes: ['cannot be checked: root is not available'] } })), 'plain');
  assert.strictEqual(ui.pluginDeleteMode({ commands: ['a'] }, ui.sweepNorm(null)), 'stop');
});
t('text sweep: lists every process, says "and everything they started"', () => {
  const w = sw({ candidates: [cand(1234, 'tag', 'beat.sh'), cand(1300, 'pidfile', 'beat.sh --loop')] });
  const m = ui.sweepDialogText(w, 'sweep', false);
  assert.ok(m.includes('PID 1234 beat.sh (found by tag)')); assert.ok(m.includes('PID 1300 beat.sh --loop (found by its pid file)'));
  assert.ok(m.includes('everything they started')); assert.ok(m.includes('as root'));
});
t('text plain: nothing found says so (D2); the old sentence stays in the handler', () => {
  const m = ui.sweepDialogText(sw({}), 'plain', false);
  assert.ok(m.includes('No running process was found for it.'));
  assert.ok(page.includes('This plugin declares no stop commands. Anything it started may keep running.'));
});
t('text plain with only guarded processes: says nothing will be ended, not "no process found"', () => {
  const w = ui.sweepNorm({ sweep: { rootOk: true, complete: true, candidates: [], notStopped: ['PID 4031 sh -c loop: also used by Other.js'] } });
  const m = ui.sweepDialogText(w, 'plain', false);
  assert.ok(m.includes('Nothing will be ended')); assert.ok(m.includes('Left running on purpose')); assert.ok(m.includes('also used by Other.js'));
  assert.ok(!m.includes('No running process was found'));
  assert.ok(ui.sweepDialogText(w, 'hook', false).includes('Nothing will be ended'));
});
t('text unchecked: says it could not be checked, lists nothing, with the reason', () => {
  const w = ui.sweepNorm({ sweep: { rootOk: false, notes: ['cannot be checked: the process check did not finish in time'] } });
  const m = ui.sweepDialogText(w, 'plain', false);
  assert.ok(m.includes('could not be checked')); assert.ok(m.includes('did not finish in time')); assert.ok(!m.includes('No running process was found'));
  assert.ok(!m.includes('PID'));
});
t('text unchecked: no second sentence when the data probe already said root is missing', () => {
  const w = ui.sweepNorm({ sweep: { rootOk: false, notes: ['cannot be checked: root is not available'] } });
  assert.strictEqual(ui.sweepDialogText(w, 'plain', true), '');
});
t('text cannot: running processes are listed as staying running', () => {
  const m = ui.sweepDialogText(sw({ candidates: [cand(8, 'tag', 'x')] }), 'cannot', false);
  assert.ok(m.includes('will keep running')); assert.ok(m.includes('PID 8'));
});
t('text shared / stop: scan sentence when nothing found; list when found', () => {
  assert.ok(ui.sweepDialogText(sw({}), 'stop', false).includes('scans for running processes'));
  const m = ui.sweepDialogText(sw({ candidates: [cand(3, 'cmdline', 'job.sh')] }), 'shared', false);
  assert.ok(m.includes('If the stop runs')); assert.ok(m.includes('PID 3 job.sh'));
});
t('text toomany: states the count, lists the shown ones, offers no stop', () => {
  const m = ui.sweepDialogText(sw({ overCap: true, found: 61, candidates: [cand(1, 'tag', 'a')] }), 'toomany', false);
  assert.ok(m.includes('61')); assert.ok(m.includes('nothing will be stopped')); assert.ok(m.includes('PID 1'));
});
t('text: processes left on purpose (shared guard) are listed; incomplete scan is flagged', () => {
  const m = ui.sweepDialogText(sw({ notStopped: ['PID 9 new.sh: also used by New.js'], complete: false }), 'plain', false);
  assert.ok(m.includes('Left running on purpose')); assert.ok(m.includes('also used by New.js')); assert.ok(m.includes('cut short'));
});
t('text: generic shared line only when no specific list is shown', () => {
  const a = ui.sweepDialogText(sw({ candidates: [cand(1, 'tag', 'a')] }), 'sweep', false);
  assert.ok(a.includes('never ended'));
  const b = ui.sweepDialogText(sw({ candidates: [cand(1, 'tag', 'a')], notStopped: ['PID 2 b: also used by X.js'] }), 'sweep', false);
  assert.ok(!b.includes('never ended') && b.includes('Left running on purpose'));
});
t('text: dialog text is plain text (the dialog sets textContent), process text is never altered', () => {
  const evil = '<img src=x onerror=alert(1)> $(rm -rf /)';
  assert.ok(ui.sweepDialogText(sw({ candidates: [cand(1, 'tag', evil)] }), 'sweep', false).includes(evil));
});
t('retry text: lists what Try again would end; empty when nothing or unchecked', () => {
  assert.ok(ui.sweepRetryText(sw({ candidates: [cand(4, 'tag', 'z')] })).includes('PID 4 z (found by tag)'));
  assert.strictEqual(ui.sweepRetryText(sw({})), '');
  assert.strictEqual(ui.sweepRetryText(ui.sweepNorm(null)), '');
});
t('request: the hash goes with stop only; "Delete without stopping" sends none', () => {
  const w = sw({ candidates: [cand(1, 'tag', 'a')], sweepHash: 'H1' });
  assert.deepStrictEqual(ui.sweepRequestFields(w, true), { sweepHash: 'H1' });
  assert.deepStrictEqual(ui.sweepRequestFields(w, false), {});
  assert.deepStrictEqual(ui.sweepRequestFields(sw({}), true), { sweepHash: '' });   // the key must be present even when empty, or the host runs no scan
  assert.deepStrictEqual(ui.sweepRequestFields(ui.sweepNorm(null), true), { sweepHash: '' });
});

// The page handler: the included block is in sync (build-web --check also does this) and the handler uses the helpers.
t('page: handler wired to the helpers', () => {
  const h = page.slice(page.indexOf('d.onclick=async()=>{\n      let failure=null'));
  assert.ok(h.length > 1000);
  for (const needle of ['sweepNorm(info)', 'pluginDeleteMode(sp,sw,hk,un)', 'sweepDialogText(sw,mode,noRoot)', 'sweepRetryText(sw)', 'sweepRequestFields(sw,true)'])
    assert.ok(h.includes(needle), 'handler lacks ' + needle);
  assert.ok(/stop=\(!failure&&\(mode==='stop'\|\|mode==='sweep'(\|\|mode==='hook')?\)\)/.test(h), 'sweep mode must send stop');
  assert.ok(/skip=choice==='skip'\|\|\(!failure&&\(mode==='cannot'\|\|mode==='toomany'\)\)/.test(h), 'toomany must skip the stop');
  // the skip branch sends no sweepHash
  const skipLine = h.slice(h.indexOf('else if(skip)'), h.indexOf('else if(skip)') + 60);
  assert.ok(!skipLine.includes('sweepHash'));
  assert.ok(h.includes("changed since you reviewed"), '409 text still reopens the dialog');
});
t('page: the 409 texts from the host both reopen the dialog', () => {
  const re = /changed since you reviewed/;
  assert.ok(re.test('The processes it started changed since you reviewed it; open the delete dialog again'));
  assert.ok(re.test('The plugin changed since you reviewed it; open the delete dialog again'));
});
console.log('plugin sweep dialog tests passed (' + n + ')');

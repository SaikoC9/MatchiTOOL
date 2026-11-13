#!/usr/bin/env node
// Phase 3 / Step 5: "Turn off and stop" (web-src/plugin-disable-ui.js), the page function pluginTurnOff run against scripted stubs, and the host route's keep branch (source order).
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const sweepUi = require('../app/src/main/web-src/plugin-sweep-ui.js'), undoUi = require('../app/src/main/web-src/plugin-undo-ui.js');
// plugin-disable-ui.js uses the helpers of the other two modules as page globals (one script scope in index.html): load it the same way, with them as parameters.
const deps = Object.assign({}, sweepUi, undoUi), depKeys = Object.keys(deps);
const dmod = { exports: {} };
new Function('module', ...depKeys, fs.readFileSync(path.join(__dirname, '../app/src/main/web-src/plugin-disable-ui.js'), 'utf8'))(dmod, ...depKeys.map((k) => deps[k]));
const dis = dmod.exports;
const ui = Object.assign({}, sweepUi, undoUi, dis);
const page = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/web/index.html'), 'utf8');
const kt = fs.readFileSync(path.join(__dirname, '../app/src/main/java/com/matchi/tool/WebRoutesPlugins.kt'), 'utf8');
const tests = []; const test = (name, f) => tests.push([name, f]); let n = 0;
const CH = 'firewall chain UFI_DPI (iptables, table mangle)', BT = 'boot script 20-bypass-ttl.sh';
const UNDO = { items: [{ kind: 'chain', label: CH }, { kind: 'boot', label: BT }], notUndone: [], hash: 'U1' };
const c1 = { pid: 11, start: 111, how: 'tag', args: 'beat.sh' };
const mkInfo = (o) => Object.assign({ rootOk: true, items: [], uploads: [], effects: [], stopPlan: { commands: [], refused: [], shared: [], planHash: '' },
  sweep: { rootOk: true, candidates: [], notStopped: [], notes: [], found: 0, overCap: false, complete: true, sweepHash: '' }, undo: { items: [], notUndone: [], hash: '' } }, o || {});
const withSweep = (c, h) => ({ sweep: { rootOk: true, candidates: c, notStopped: [], notes: [], found: c.length, overCap: false, complete: true, sweepHash: h } });

// ---- the pure helpers
const sw0 = sweepUi.sweepNorm(mkInfo()), un0 = undoUi.undoNorm(mkInfo()), unF = undoUi.undoNorm(mkInfo({ undo: UNDO }));
test('dialog: stop mode lists commands, says the file and data stay, offers \"Turn off only\"', () => {
  const d = ui.disableDialog('A.js', { commands: ['pkill -f beat'], check: 'pgrep -f beat' }, sw0, un0, 'stop', false);
  assert.ok(d.message.includes('Its file and its data stay') && d.message.includes('\u2022 pkill -f beat') && d.message.includes('\u2022 pgrep -f beat'));
  assert.strictEqual(d.okText, 'Turn off and stop'); assert.deepStrictEqual(d.extra, [{ text: 'Turn off only', value: 'skip' }]); assert.ok(!/delete/i.test(d.message));
});
test('dialog: sweep mode lists processes and the undo items', () => {
  const sw = sweepUi.sweepNorm(mkInfo(withSweep([c1], 'H1')));
  const d = ui.disableDialog('A.js', {}, sw, unF, 'sweep', false);
  assert.ok(d.message.includes('PID 11 beat.sh') && d.message.includes(CH) && d.message.includes(BT) && d.message.includes('if it is still there') && d.message.includes('declares no stop commands'));
  assert.strictEqual(d.okText, 'Turn off and stop');
});
test('dialog: cannot / toomany only offer turning off without stopping, and say the items stay', () => {
  const dc = ui.disableDialog('A.js', { refused: [{ command: 'rm -rf x', reason: 'not allowed' }] }, sw0, unF, 'cannot', false);
  assert.strictEqual(dc.okText, 'Turn off without stopping'); assert.deepStrictEqual(dc.extra, []); assert.ok(dc.message.includes('rm -rf x (not allowed)') && dc.message.includes('stay in the system'));
  const sw = sweepUi.sweepNorm(mkInfo({ sweep: { rootOk: true, overCap: true, found: 61, candidates: [c1] } }));
  const dt = ui.disableDialog('A.js', {}, sw, un0, 'toomany', false);
  assert.strictEqual(dt.okText, 'Turn off without stopping'); assert.ok(dt.message.includes('61'));
});
test('dialog: shared copy skips the stop by default and offers \"Turn off and stop anyway\"', () => {
  const d = ui.disableDialog('A.js', { commands: ['x'], shared: ['B.js'] }, sw0, un0, 'shared', false);
  assert.strictEqual(d.okText, 'Turn off, skip the stop'); assert.deepStrictEqual(d.extra, [{ text: 'Turn off and stop anyway', value: 'stop' }]); assert.ok(d.message.includes('B.js'));
});
test('wantsStop: only the stop buttons; the default of shared and every skip does not', () => {
  assert.strictEqual(ui.disableWantsStop('stop', true, null), true); assert.strictEqual(ui.disableWantsStop('sweep', true, null), true);
  assert.strictEqual(ui.disableWantsStop('shared', true, null), false); assert.strictEqual(ui.disableWantsStop('shared', 'stop', null), true);
  assert.strictEqual(ui.disableWantsStop('stop', 'skip', null), false); assert.strictEqual(ui.disableWantsStop('cannot', true, null), false); assert.strictEqual(ui.disableWantsStop('toomany', true, null), false);
  assert.strictEqual(ui.disableWantsStop('stop', true, { log: 'x' }), true); assert.strictEqual(ui.disableWantsStop('stop', 'skip', { log: 'x' }), false);
});
test('failure dialog: says it is still ON, lists leftovers, Try again, skip button; no restart for a boot script', () => {
  const f = { log: 'The stop did not finish.', leftovers: ['still there: ' + CH], notChecked: ['no check command'] };
  const d = ui.disableFailureDialog('A.js', f, sw0, unF);
  assert.ok(d.message.includes('was NOT turned off') && d.message.includes('Still there:') && d.message.includes('Not checked:') && d.message.includes('Try again would also remove'));
  assert.strictEqual(d.okText, 'Try again'); assert.deepStrictEqual(d.extra.map((e) => e.value), ['reboot', 'skip']);
  const b = ui.disableFailureDialog('A.js', { leftovers: ['still there: ' + BT] }, sw0, un0);
  assert.deepStrictEqual(b.extra.map((e) => e.value), ['skip']); assert.ok(!b.message.includes('A restart'));
});
test('request body: stop + keep, never erase or skipStop, the three hashes, undoHash present even when empty', () => {
  const b = ui.disableRequestBody('A.js', { planHash: 'P1' }, sweepUi.sweepNorm(mkInfo(withSweep([c1], 'H1'))), unF);
  assert.deepStrictEqual(b, { name: 'A.js', stop: true, keep: true, planHash: 'P1', sweepHash: 'H1', undoHash: 'U1' });
  const e = ui.disableRequestBody('A.js', {}, sw0, un0);
  assert.deepStrictEqual(e, { name: 'A.js', stop: true, keep: true, planHash: '', sweepHash: '', undoHash: '' });
  assert.ok(!('erase' in e) && !('skipStop' in e));
});
test('toast: claims \"stopped\" only when the host reported a successful stop', () => {
  assert.strictEqual(ui.disableToast('A.js', { ok: true, disabled: true }, unF), 'Turned off A.js');
  assert.strictEqual(ui.disableToast('A.js', { ok: true, stop: { success: false } }, unF), 'Turned off A.js');
  assert.ok(ui.disableToast('A.js', { ok: true, stop: { success: true } }, unF).includes('stopped what it started (2 items no longer in the system)'));
});

// ---- the real page function
const a = page.indexOf('async function pluginTurnOff(p){'), b = page.indexOf('\n}\n', a);
assert.ok(a > 0 && b > a);
const src = page.slice(a, b + 3);
const NAMES = ['sweepNorm', 'undoNorm', 'pluginDeleteMode', 'disableDialog', 'disableFailureDialog', 'disableWantsStop', 'disableRequestBody', 'disableToast'];
async function drive({ datas, dialogs, deletes }) {
  const calls = [], dlgs = [], toasts = [], clicks = [];
  const dataQ = datas.slice(), dlgQ = dialogs.slice(), delQ = (deletes || []).slice();
  const stub = {
    api: async (uri, o) => { const body = o && o.body ? JSON.parse(o.body) : null; calls.push({ uri, body });
      if (uri === '/api/plugins/data') { const x = dataQ.shift(); if (x === undefined) throw new Error('no data scripted'); if (x instanceof Error) throw x; return x; }
      if (uri === '/api/plugins/delete') { const x = delQ.shift(); if (x === undefined) throw new Error('no delete scripted'); if (x instanceof Error) throw x; return x; }
      throw new Error('unexpected ' + uri); },
    askDialog: async (o) => { dlgs.push(o); const v = dlgQ.shift(); return v === undefined ? null : v; },
    createToast: (m) => toasts.push(m), document: { getElementById: () => ({ click() { clicks.push(1); } }) },
  };
  for (const k of NAMES) stub[k] = ui[k];
  const keys = Object.keys(stub), f = new Function(...keys, src + '\nreturn pluginTurnOff;');
  const result = await f(...keys.map((k) => stub[k]))({ name: 'A.js' });
  return { result, calls, dlgs, toasts, clicks, dels: calls.filter((c) => c.uri === '/api/plugins/delete').map((c) => c.body) };
}
test('page: nothing to stop -> \"plain\", no dialog, no delete request (the caller toggles as before)', async () => {
  const r = await drive({ datas: [mkInfo()], dialogs: [] });
  assert.strictEqual(r.result, 'plain'); assert.strictEqual(r.dlgs.length, 0); assert.strictEqual(r.dels.length, 0);
});
test('page: the data call failed -> \"plain\" (turning off is never blocked by a failed probe)', async () => {
  const r = await drive({ datas: [new Error('offline')], dialogs: [] });
  assert.strictEqual(r.result, 'plain'); assert.strictEqual(r.dlgs.length, 0);
});
test('page: undo items only -> dialog \"Turn off and stop\", ONE keep request with the reviewed hashes, result done', async () => {
  const r = await drive({ datas: [mkInfo({ undo: UNDO })], dialogs: [true], deletes: [{ ok: true, disabled: true, stop: { success: true } }] });
  assert.strictEqual(r.result, 'done'); assert.strictEqual(r.dlgs[0].okText, 'Turn off and stop'); assert.ok(r.dlgs[0].message.includes(CH));
  assert.strictEqual(r.dels.length, 1); assert.deepStrictEqual(r.dels[0], { name: 'A.js', stop: true, keep: true, planHash: '', sweepHash: '', undoHash: 'U1' });
  assert.ok(r.toasts.some((m) => /^Turned off A\.js, and stopped/.test(m)));
});
test('page: \"Turn off only\" -> \"plain\" and no delete request', async () => {
  const r = await drive({ datas: [mkInfo({ undo: UNDO })], dialogs: ['skip'] });
  assert.strictEqual(r.result, 'plain'); assert.strictEqual(r.dels.length, 0);
});
test('page: cancel -> \"cancel\", nothing sent', async () => {
  const r = await drive({ datas: [mkInfo({ undo: UNDO })], dialogs: [null] });
  assert.strictEqual(r.result, 'cancel'); assert.strictEqual(r.dels.length, 0);
});
test('page: refused commands -> the stop is never requested even on OK (\"Turn off without stopping\")', async () => {
  const d = mkInfo({ undo: UNDO, stopPlan: { commands: [], refused: [{ command: 'x', reason: 'r' }], shared: [], planHash: 'P' } });
  const r = await drive({ datas: [d], dialogs: [true] });
  assert.strictEqual(r.result, 'plain'); assert.strictEqual(r.dels.length, 0); assert.strictEqual(r.dlgs[0].okText, 'Turn off without stopping');
});
test('page: a failed stop keeps it ON, opens the retry dialog, Try again sends a new request, then done', async () => {
  const fail = { ok: false, kept: true, stop: { success: false, log: 'undo: FAILED', leftovers: ['still there: ' + CH], notChecked: [] } };
  const r = await drive({ datas: [mkInfo({ undo: UNDO }), mkInfo({ undo: UNDO })], dialogs: [true, true], deletes: [fail, { ok: true, disabled: true, stop: { success: true } }] });
  assert.strictEqual(r.result, 'done'); assert.strictEqual(r.dels.length, 2); assert.strictEqual(r.dlgs[1].title, 'Stop did not finish'); assert.strictEqual(r.dlgs[1].okText, 'Try again');
  assert.ok(r.dlgs[1].message.includes('still there: ' + CH) && r.dlgs[1].message.includes('NOT turned off'));
});
test('page: a failed stop, then \"Turn off without stopping\" -> \"plain\" (no second request)', async () => {
  const fail = { ok: false, kept: true, stop: { success: false, log: 'x', leftovers: ['still there: ' + BT], notChecked: [] } };
  const r = await drive({ datas: [mkInfo({ undo: UNDO }), mkInfo({ undo: UNDO })], dialogs: [true, 'skip'], deletes: [fail] });
  assert.strictEqual(r.result, 'plain'); assert.strictEqual(r.dels.length, 1);
});
test('page: a failed stop with a boot script left offers no restart; with a chain left it does, and Restart clicks the button and cancels', async () => {
  const mk = (l) => ({ ok: false, kept: true, stop: { success: false, log: 'x', leftovers: [l], notChecked: [] } });
  const a1 = await drive({ datas: [mkInfo({ undo: UNDO }), mkInfo({ undo: UNDO })], dialogs: [true, null], deletes: [mk('still there: ' + BT)] });
  assert.deepStrictEqual(a1.dlgs[1].extra.map((e) => e.value), ['skip']);
  const a2 = await drive({ datas: [mkInfo({ undo: UNDO }), mkInfo({ undo: UNDO })], dialogs: [true, 'reboot'], deletes: [mk('still there: ' + CH)] });
  assert.deepStrictEqual(a2.dlgs[1].extra.map((e) => e.value), ['reboot', 'skip']); assert.strictEqual(a2.result, 'cancel'); assert.strictEqual(a2.clicks.length, 1);
});
test('page: a 409 \"changed since you reviewed\" reopens the dialog with fresh data; another error is thrown', async () => {
  const r = await drive({ datas: [mkInfo({ undo: UNDO }), mkInfo({ undo: Object.assign({}, UNDO, { hash: 'U2' }) })], dialogs: [true, true],
    deletes: [new Error('What it left behind in the system changed since you reviewed it; open the delete dialog again'), { ok: true, disabled: true }] });
  assert.strictEqual(r.result, 'done'); assert.deepStrictEqual(r.dels.map((d) => d.undoHash), ['U1', 'U2']); assert.ok(r.toasts.some((m) => /changed since you reviewed/.test(m)));
  await assert.rejects(drive({ datas: [mkInfo({ undo: UNDO })], dialogs: [true], deletes: [new Error('Password is wrong')] }), /Password is wrong/);
});
test('page: the shared default sends no stop; \"Turn off and stop anyway\" does', async () => {
  const sh = () => mkInfo({ undo: UNDO, stopPlan: { commands: ['x'], refused: [], shared: ['B.js'], planHash: 'P3' } });
  const x = await drive({ datas: [sh()], dialogs: [true] }); assert.strictEqual(x.result, 'plain'); assert.strictEqual(x.dels.length, 0);
  const y = await drive({ datas: [sh()], dialogs: ['stop'], deletes: [{ ok: true, disabled: true }] }); assert.strictEqual(y.result, 'done'); assert.strictEqual(y.dels[0].planHash, 'P3');
});
test('page: the toggle handler turns OFF through pluginTurnOff and falls back to the old toggle request', () => {
  const t = page.slice(page.indexOf("t.className='pm-sw'"), page.indexOf("const acts=document.createElement('div')"));
  assert.ok(t.includes('if(p.enabled){const o=await pluginTurnOff(p)'));
  assert.ok(t.includes("o==='cancel'") && t.includes("o==='done'") && t.includes("api('/api/plugins/toggle'"));
  assert.ok(t.indexOf('pluginTurnOff(p)') < t.indexOf("api('/api/plugins/toggle'"));
});

// ---- the host route: the keep branch (source order; the Kotlin is compiled by the Android build only)
test('host: keep is validated, switches off only AFTER a failed stop returned, and never reaches the file delete or the erase', () => {
  const iKeep = kt.indexOf('val keep = req.optBoolean("keep", false)'), iVal = kt.indexOf('if (keep && (!wantStop || skipStop || req.optBoolean("erase", false))) throw');
  const iFail = kt.indexOf('if (!report.success) return@run json(Response.Status.OK, JSONObject().put("ok", false).put("kept", true)');
  const iBranch = kt.indexOf('if (keep) {\n            Prefs.setEnabled(ctx, name, false)'), iPlan = kt.indexOf('val plan = if (req.optBoolean("erase", false)) pluginDataPlan(name) else null');
  const iDel = kt.indexOf('val deleted = File(pluginDir, name).delete()');
  for (const [k, v] of Object.entries({ iKeep, iVal, iFail, iBranch, iPlan, iDel })) assert.ok(v > 0, k);
  assert.ok(iKeep < iVal && iVal < iFail && iFail < iBranch && iBranch < iPlan && iPlan < iDel);
  const br = kt.slice(iBranch, iPlan); assert.ok(br.includes('return@run json') && br.includes('"disabled", true') && !br.includes('delete()') && !br.includes('eraseScript'));
  assert.ok(kt.includes('if (!keep) pluginPasswordCheck(s, req, "delete a plugin")'), 'owner decision: keep asks no password, every other delete still does');
  assert.ok(kt.includes('if (req.optBoolean("erase", false) || wantStop) rootGate(s)'), 'keep implies stop, so the root gate still applies');
  assert.ok(kt.indexOf('if (keep && (!wantStop') > kt.indexOf('if (!keep) pluginPasswordCheck'), 'sanity: validation order unchanged');
});

(async () => {
  let bad = 0;
  for (const [name, f] of tests) { try { await f(); n++; } catch (e) { bad++; console.error('FAIL ' + name + ': ' + (e && e.message)); } }
  if (bad) { console.error(bad + ' failed'); process.exit(1); }
  console.log('plugin disable dialog tests passed (' + n + ')');
})();

#!/usr/bin/env node
// Phase 2 / Step 7: the stop hook of a SANDBOXED plugin (matchi.onUninstall). Runs the real bridge text (SBX_PRELUDE) against a fake port, the page-side
// runner sbxHookRun with fake timers, the authorization of the two new bridge operations, the dialog helpers, and checks the delete handler's order:
// hook first, a failed hook keeps the plugin, the scan afterwards decides, the host is only told for its audit line.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/src/main/assets/web/index.html'), 'utf8');
const kt = fs.readFileSync(path.join(root, 'app/src/main/java/com/matchi/tool/WebRoutesPlugins.kt'), 'utf8');
const ui = require('../app/src/main/web-src/plugin-sweep-ui.js');
const a = html.indexOf('/* @include web-src/plugin-sandbox.js */'), b = html.indexOf('/* @end-include web-src/plugin-sandbox.js */');
assert.ok(a > 0 && b > a);
const ctx = vm.createContext({ window: {}, console, Map, Set, Date, Math, Number, JSON, String, Array, Promise, setTimeout, clearTimeout, api: async () => null, createToast() {}, closeModal() {} });
const sbx = vm.runInContext(html.slice(a, b) + '\n;({sbxAuthorize,sbxGrants,sbxRun,sbxOnMessage,sbxHookRun,SBX_PRELUDE,SBX_HOOK_MS})', ctx);
let n = 0;
const tests = []; const test = (name, f) => tests.push([name, f]);
const deq = (x, y, m) => assert.strictEqual(JSON.stringify(x), JSON.stringify(y), m);   // objects from the vm have another prototype
const tick = () => new Promise((r) => setImmediate(r));
const flush = async () => { for (let i = 0; i < 6; i++) await tick(); };

// ---- a fake frame running the REAL bridge text
function frame() {
  const fw = { listeners: {}, addEventListener(type, f) { (this.listeners[type] = this.listeners[type] || []).push(f); }, parent: { id: 'parent' } };
  const sent = [];
  const port = { postMessage(m) { sent.push(m); }, onmessage: null };
  vm.runInContext(sbx.SBX_PRELUDE, vm.createContext({ window: fw, Map, Promise, Error, String, Array, Object }));
  for (const f of fw.listeners.message) f({ source: fw.parent, data: { matchi: 'init' }, ports: [port] });
  return { fw, port, sent, run: (token) => port.onmessage({ data: { run: 'uninstall', token } }) };
}
test('frame: onUninstall registers through the bridge and is frozen with the rest', async () => {
  const f = frame();
  assert.strictEqual(typeof f.fw.matchi.onUninstall, 'function');
  f.fw.matchi.onUninstall(() => {});
  deq(f.sent.map((m) => m.op), ['hook.register']);
  assert.ok(Object.isFrozen(f.fw.matchi));
});
test('frame: onUninstall with a non-function is refused and registers nothing', async () => {
  const f = frame();
  await assert.rejects(f.fw.matchi.onUninstall('rm -rf /'), /needs a function/);
  assert.strictEqual(f.sent.length, 0);
});
test('frame: a run request calls the hook once and answers hook.done ok', async () => {
  const f = frame(); let calls = 0;
  f.fw.matchi.onUninstall(async () => { calls++; });
  f.sent.length = 0; f.run('tok1'); await flush();
  assert.strictEqual(calls, 1);
  deq(f.sent, [{ id: 0, op: 'hook.done', args: ['tok1', true, ''] }]);
});
test('frame: a hook that throws (sync or async) answers ok=false with the message', async () => {
  for (const fn of [() => { throw new Error('boom'); }, async () => { throw new Error('later'); }, () => Promise.reject('plain text')]) {
    const f = frame(); f.fw.matchi.onUninstall(fn); f.sent.length = 0; f.run('t'); await flush();
    assert.strictEqual(f.sent[0].op, 'hook.done'); assert.strictEqual(f.sent[0].args[1], false); assert.ok(f.sent[0].args[2].length > 0);
  }
});
test('frame: a hook that never finishes sends no answer (the page times out)', async () => {
  const f = frame(); f.fw.matchi.onUninstall(() => new Promise(() => {})); f.sent.length = 0; f.run('t'); await flush();
  deq(f.sent, []);
});
test('frame: a run request without a token, or an ordinary reply shape, does not run the hook', async () => {
  const f = frame(); let calls = 0; f.fw.matchi.onUninstall(() => { calls++; }); f.sent.length = 0;
  f.port.onmessage({ data: { run: 'uninstall' } }); f.port.onmessage({ data: { run: 'other', token: 'x' } }); f.port.onmessage({ data: { id: 99, ok: true } }); await flush();
  assert.strictEqual(calls, 0);
});
test('frame: a long error message is cut to 200 characters', async () => {
  const f = frame(); f.fw.matchi.onUninstall(() => { throw new Error('x'.repeat(900)); }); f.sent.length = 0; f.run('t'); await flush();
  assert.strictEqual(f.sent[0].args[2].length, 200);
});

// ---- authorization of the two new operations
const g0 = sbx.sbxGrants([]);
test('authorize: hook.register needs no grant and carries no arguments', async () => {
  deq(sbx.sbxAuthorize(g0, 'hook.register', ['evil'], null), { ok: true, op: 'hook.register', args: [] });
});
test('authorize: hook.done is cleaned; a bad token is refused; ok must be exactly true', async () => {
  deq(sbx.sbxAuthorize(g0, 'hook.done', ['abc', true, 'e'], null).args, ['abc', true, 'e']);
  deq(sbx.sbxAuthorize(g0, 'hook.done', ['abc', 'yes', null], null).args, ['abc', false, '']);
  assert.ok(!sbx.sbxAuthorize(g0, 'hook.done', [5, true, ''], null).ok);
  assert.ok(!sbx.sbxAuthorize(g0, 'hook.done', ['x'.repeat(41), true, ''], null).ok);
  assert.ok(!sbx.sbxAuthorize(g0, 'hook.done', [], null).ok);
});
test('authorize: the hook gets no new power (shell still needs the exact approved command)', async () => {
  assert.ok(!sbx.sbxAuthorize(g0, 'shell', ['pkill -f beat.sh'], null).ok);
  assert.ok(sbx.sbxAuthorize(sbx.sbxGrants(['sbx:shell:pkill -f beat.sh']), 'shell', ['pkill -f beat.sh'], null).ok);
  assert.ok(!sbx.sbxAuthorize(sbx.sbxGrants(['sbx:shell:pkill -f beat.sh']), 'shell', ['pkill -f beat.sh; reboot'], null).ok);
});

// ---- page side: sbxHookRun with fake timers
function fakeTimers() { const q = []; return { q, set: (f, ms) => { q.push({ f, ms }); return q.length; }, clear: (id) => { if (q[id - 1]) q[id - 1].f = null; }, fire: () => q.forEach((x) => x.f && x.f()) }; }
const entry = (o) => Object.assign({ hook: true, dead: false, hookWait: null, port: { sent: [], postMessage(m) { this.sent.push(m); } } }, o);
test('run: no hook registered -> none, nothing sent (a plugin that never loaded has no entry at all)', async () => {
  deq(await sbx.sbxHookRun(entry({ hook: false }), 15000, fakeTimers()), { status: 'none', ran: false });
  deq(await sbx.sbxHookRun(undefined, 15000, fakeTimers()), { status: 'none', ran: false });
  deq(await sbx.sbxHookRun(null, 15000, fakeTimers()), { status: 'none', ran: false });
});
test('run: dead bridge / missing port -> dead, nothing sent', async () => {
  assert.strictEqual((await sbx.sbxHookRun(entry({ dead: true }), 15000, fakeTimers())).status, 'dead');
  assert.strictEqual((await sbx.sbxHookRun(entry({ port: null }), 15000, fakeTimers())).status, 'dead');
});
test('run: timeout after the limit; a late answer is ignored', async () => {
  const e = entry(), T = fakeTimers(); const p = sbx.sbxHookRun(e, 15000, T);
  assert.strictEqual(T.q[0].ms, 15000); assert.strictEqual(e.port.sent[0].run, 'uninstall');
  const token = e.port.sent[0].token; T.fire();
  const r = await p; assert.strictEqual(r.status, 'timeout'); assert.strictEqual(r.ran, false); assert.strictEqual(e.hookWait, null);
  await sbx.sbxRun(e, { op: 'hook.done', args: [token, true, ''] });   // late
  assert.strictEqual(e.hookWait, null);
});
test('run: the real answer path (hook.done through sbxOnMessage) resolves ok / failed', async () => {
  for (const [ok, status] of [[true, 'ok'], [false, 'failed']]) {
    const e = Object.assign(entry(), { g: g0, rate: { t: 0, n: 0 }, store: null, busy: 0 }); const T = fakeTimers(); const p = sbx.sbxHookRun(e, 15000, T);
    const token = e.port.sent[0].token;
    sbx.sbxOnMessage(e, { id: 0, op: 'hook.done', args: [token, ok, ok ? '' : 'it broke'] });
    const r = await p; assert.strictEqual(r.status, status); assert.strictEqual(r.ran, true);
    if (!ok) assert.strictEqual(r.error, 'it broke');
    assert.strictEqual(T.q[0].f, null, 'the timer is cleared');
  }
});
test('run: an answer with the wrong token is ignored (the hook cannot be answered for)', async () => {
  const e = entry(), T = fakeTimers(); const p = sbx.sbxHookRun(e, 15000, T);
  await sbx.sbxRun(e, { op: 'hook.done', args: ['guess', true, ''] });
  assert.ok(e.hookWait, 'still waiting'); T.fire(); assert.strictEqual((await p).status, 'timeout');
});
test('run: a second run while one is waiting is refused; a failing postMessage is dead', async () => {
  const e = entry(), T = fakeTimers(); sbx.sbxHookRun(e, 15000, T);
  const second = await sbx.sbxHookRun(e, 15000, T); assert.strictEqual(second.status, 'failed'); assert.strictEqual(second.ran, false);
  const bad = entry({ port: { postMessage() { throw new Error('closed'); } } });
  assert.strictEqual((await sbx.sbxHookRun(bad, 15000, fakeTimers())).status, 'dead');
});
test('register: hook.register through the bridge marks the entry', async () => {
  const e = Object.assign(entry({ hook: false }), { g: g0, rate: { t: 0, n: 0 }, busy: 0 });
  sbx.sbxOnMessage(e, { id: 0, op: 'hook.register', args: [] }); await flush(); assert.strictEqual(e.hook, true);
});
test('limit constant is 15 s', async () => { assert.strictEqual(sbx.SBX_HOOK_MS, 15000); });

// ---- dialog helpers
const sw = (o) => ui.sweepNorm({ sweep: Object.assign({ rootOk: true, candidates: [], notStopped: [], notes: [], found: 0, overCap: false, complete: true, sweepHash: '' }, o) });
const cand = (pid, args) => ({ pid, start: 10 + pid, how: 'tag', args });
test('mode: a registered hook turns "plain" into "hook"; everything else is unchanged', async () => {
  assert.strictEqual(ui.pluginDeleteMode({}, sw({}), true), 'hook');
  assert.strictEqual(ui.pluginDeleteMode({}, sw({}), false), 'plain');
  assert.strictEqual(ui.pluginDeleteMode({}, sw({ candidates: [cand(1, 'a')] }), true), 'sweep');
  assert.strictEqual(ui.pluginDeleteMode({ commands: ['x'] }, sw({}), true), 'stop');
  assert.strictEqual(ui.pluginDeleteMode({ refused: [{}] }, sw({}), true), 'cannot');
  assert.strictEqual(ui.pluginDeleteMode({}, sw({ overCap: true, found: 60 }), true), 'toomany');
});
test('text: the hook line says what it can do, that it is not believed, and that failure keeps the plugin', async () => {
  const m = ui.hookDialogText(['runs this root command: pkill -f beat.sh'], 'hook');
  assert.ok(m.includes('own stop code')); assert.ok(m.includes('15 s')); assert.ok(m.includes('pkill -f beat.sh')); assert.ok(m.includes('not believed')); assert.ok(m.includes('plugin is kept'));
  assert.ok(ui.hookDialogText([], 'hook').includes('nothing beyond toasts'));
  assert.ok(ui.hookDialogText([], 'shared').includes('If the stop runs'));
  for (const mode of ['plain', 'cannot', 'toomany']) assert.strictEqual(ui.hookDialogText(['x'], mode), '');
});
test('text: mode "hook" with nothing found says so', async () => {
  assert.ok(ui.sweepDialogText(sw({}), 'hook', false).includes('No running process was found for it.'));
});
test('subset: same PID + start + command line only', async () => {
  const before = [cand(1, 'a'), cand(2, 'b')];
  assert.ok(ui.sweepSubset(before, [cand(2, 'b')])); assert.ok(ui.sweepSubset(before, [])); assert.ok(ui.sweepSubset([], []));
  assert.ok(!ui.sweepSubset(before, [cand(3, 'c')])); assert.ok(!ui.sweepSubset(before, [{ pid: 1, start: 999, how: 'tag', args: 'a' }]));   // PID reuse
  assert.ok(!ui.sweepSubset(before, [cand(1, 'a changed')]));
});
test('after hook: clean/smaller scan -> ok with the NEW hash; new process -> changed; scan did not run / cut short / over cap -> blind (the hook decides nothing)', async () => {
  const before = sw({ candidates: [cand(1, 'a'), cand(2, 'b')], sweepHash: 'H0' });
  const r = ui.hookAfterScan(before, sw({ candidates: [cand(2, 'b')], sweepHash: 'H1' })); assert.strictEqual(r.kind, 'ok'); assert.strictEqual(r.sw.hash, 'H1');
  assert.strictEqual(ui.hookAfterScan(before, sw({})).kind, 'ok');
  assert.strictEqual(ui.hookAfterScan(before, sw({ candidates: [cand(9, 'new')], sweepHash: 'H9' })).kind, 'changed');
  const unchecked = ui.sweepNorm({ sweep: { rootOk: false, notes: ['cannot be checked: the process check did not finish in time'] } });
  const blind = ui.hookAfterScan(before, unchecked); assert.strictEqual(blind.kind, 'blind'); assert.ok(blind.message.includes('did not finish in time')); assert.ok(blind.message.includes('nothing shows that it worked'));
  assert.strictEqual(ui.hookAfterScan(before, ui.sweepNorm(null)).kind, 'blind');   // the data call failed
  assert.strictEqual(ui.hookAfterScan(before, sw({ complete: false })).kind, 'blind');
  assert.strictEqual(ui.hookAfterScan(before, sw({ overCap: true, found: 70 })).kind, 'blind');
});
test('reports: hook failure / timeout / dead read clearly and keep the plugin', async () => {
  assert.ok(ui.hookFailureReport({ status: 'timeout', error: 'no answer in 15 s' }).log.includes('did not finish'));
  assert.ok(ui.hookFailureReport({ status: 'failed', error: 'boom' }).log.includes('failed: boom'));
  assert.ok(ui.hookFailureReport({ status: 'dead', error: 'its window was closed' }).log.includes('could not run'));
  assert.ok(ui.hookFailureReport({ status: 'failed' }).notChecked[0].includes('plugin is kept'));
  assert.ok(ui.hookBlindReport('x').notChecked[0].includes('plugin is kept'));
});
test('request fields: only a tried hook is reported', async () => {
  deq(ui.hookRequestFields({ status: 'ok', ran: true }), { hookRan: true, hookStatus: 'ok' });
  deq(ui.hookRequestFields({ status: 'timeout', ran: false }), { hookRan: false, hookStatus: 'timeout' });
  deq(ui.hookRequestFields({ status: 'none', ran: false }), {});
  deq(ui.hookRequestFields(null), {});
});

// ---- the delete handler and the host route
const h = html.slice(html.indexOf('d.onclick=async()=>{\n      let failure=null'));
test('page: handler order is hook -> failure keeps plugin -> scan -> request', async () => {
  const iHook = h.indexOf('sbxHookRun(ent,SBX_HOOK_MS)'), iFail = h.indexOf('failure=hookFailureReport(h);continue'), iScan = h.indexOf('hookAfterScan(sw,'), iReq = h.indexOf("api('/api/plugins/delete'");
  assert.ok(iHook > 0 && iHook < iFail && iFail < iScan && iScan < iReq, 'order');
  assert.ok(h.includes('failure=hookBlindReport(after.message);continue'), 'a scan that could not show it worked keeps the plugin');
  assert.ok(h.includes("after.kind==='changed'"), 'a new process reopens the dialog');
});
test('page: the hook runs only for a stop, only for a sandboxed plugin that is loaded, never for "Delete without stopping"', async () => {
  assert.ok(h.includes("p.mode==='sandbox'?sbxEntries.get(p.name):null"));
  assert.ok(h.includes('if(stop&&ent&&ent.hook){'));
  assert.ok(!/else if\(skip\)\{[^}]*sbxHookRun/.test(h));
  assert.ok(/stop=\(!failure&&\(mode==='stop'\|\|mode==='sweep'\|\|mode==='hook'\)\)/.test(h));
});
test('page: the NEW hash replaces the old one after a hook; the host is told (audit only)', async () => {
  assert.ok(h.includes('Object.assign(body,sweepRequestFields(after.sw,true))'));
  assert.ok(h.includes('Object.assign(body,hookRequestFields(lastHook))'));
});
test('page: the toast never says "Stopped" for a hook alone', async () => {
  assert.ok(h.includes("hookDone&&!stopped?'. Its stop code ran and a scan found nothing left running'"));
  assert.ok(/stopped=r&&r\.stop&&r\.stop\.success===true/.test(h));
});
test('host: hookRan / hookStatus go to the audit log only and cannot change the outcome', async () => {
  assert.ok(/hookRan/.test(kt), 'route reads hookRan');
  const line = kt.split('\n').filter((l) => /hookRan/.test(l));
  assert.ok(line.every((l) => /auditShell|hookAuditLine/.test(l)), 'only audit lines use it: ' + line.join(' || '));
  assert.ok(!/stopMode\([^)]*hook/.test(kt) && !/stopHashMatches\([^)]*hook/.test(kt));
});

// ---- the REAL delete handler, run against scripted stubs (the closure text is cut out of the page)
const hs = html.indexOf('d.onclick=async()=>{\n      let failure=null'), he = html.indexOf('\n    const free=shown.length', hs);
assert.ok(hs > 0 && he > hs);
const handlerSrc = html.slice(hs, he);
const NAMES = ['sweepNorm', 'pluginDeleteMode', 'sweepDialogText', 'sweepRetryText', 'sweepRequestFields', 'hookDialogText', 'hookAfterScan', 'hookFailureReport', 'hookBlindReport', 'hookRequestFields'];
async function drive({ plugin, entries, hookResults, datas, dialogs }) {
  const calls = [], dlgs = [], toasts = [], d = {};
  const dataQ = datas.slice(), dlgQ = dialogs.slice(), hookQ = hookResults.slice();
  const stub = {
    p: plugin, d,
    api: async (uri, o) => { const body = o && o.body ? JSON.parse(o.body) : null; calls.push({ uri, body });
      if (uri === '/api/plugins/data') { const x = dataQ.shift(); if (x === undefined) throw new Error('no data scripted'); if (x instanceof Error) throw x; return x; }
      if (uri === '/api/plugins/delete') return { ok: true, stop: undefined };
      throw new Error('unexpected ' + uri); },
    askDialog: async (o) => { dlgs.push(o); const v = dlgQ.shift(); return v === undefined ? null : v; },
    createToast: (m) => toasts.push(m), sbxEntries: new Map(Object.entries(entries || {})),
    sbxHookRun: async () => { const r = hookQ.shift(); if (!r) throw new Error('hook ran but none scripted'); return r; }, SBX_HOOK_MS: 15000,
    sbxDescribe: (x) => 'can ' + x, sbxPurge() {}, pluginLsKeys: () => [], pluginSsKeys: () => [], pluginLsPrefixes: () => [], pluginKeyMine: () => false,
    refreshPluginList: async () => {}, document: { getElementById: () => ({ click() {} }) }, localStorage: { removeItem() {} }, sessionStorage: { removeItem() {} }, window: {},
  };
  for (const k of NAMES) stub[k] = ui[k];
  const keys = Object.keys(stub);
  const f = new Function(...keys, handlerSrc + '\nreturn d.onclick;');
  await f(...keys.map((k) => stub[k]))();
  return { calls, dlgs, toasts, deletes: calls.filter((c) => c.uri === '/api/plugins/delete').map((c) => c.body) };
}
const mkInfo = (cands, hash, extra) => Object.assign({ rootOk: true, items: [], uploads: [], effects: [], stopPlan: { commands: [], refused: [], shared: [], planHash: '' },
  sweep: { rootOk: true, candidates: cands, notStopped: [], notes: [], found: cands.length, overCap: false, complete: true, sweepHash: hash } }, extra || {});
const c1 = { pid: 11, start: 111, how: 'tag', args: 'beat.sh' }, c2 = { pid: 12, start: 112, how: 'tag', args: 'beat.sh --child' };
const sbxP = { name: 'Beat.js', mode: 'sandbox', code: '' };
const hooked = (extra) => ({ 'Beat.js': Object.assign({ name: 'Beat.js', hook: true, dead: false, grant: ['sbx:shell:pkill -f beat.sh'] }, extra || {}) });
test('handler: hook ok, scan shows fewer processes -> ONE delete request with stop, the NEW hash and the hook audit fields', async () => {
  const r = await drive({ plugin: sbxP, entries: hooked(), hookResults: [{ status: 'ok', ran: true }], datas: [mkInfo([c1, c2], 'H0'), mkInfo([c2], 'H1')], dialogs: [true] });
  assert.strictEqual(r.deletes.length, 1);
  const b = r.deletes[0]; assert.strictEqual(b.stop, true); assert.strictEqual(b.sweepHash, 'H1'); assert.strictEqual(b.hookRan, true); assert.strictEqual(b.hookStatus, 'ok'); assert.ok(!b.skipStop);
  assert.ok(r.dlgs[0].message.includes('own stop code') && r.dlgs[0].message.includes('can sbx:shell:pkill -f beat.sh') && r.dlgs[0].okText === 'Delete and stop');
});
test('handler: hook ok and nothing left -> stop request with the empty hash; the toast does not claim "Stopped"', async () => {
  const r = await drive({ plugin: sbxP, entries: hooked(), hookResults: [{ status: 'ok', ran: true }], datas: [mkInfo([], ''), mkInfo([], '')], dialogs: [true] });
  assert.strictEqual(r.dlgs[0].okText, 'Delete and stop');   // mode "hook": nothing found, but the plugin registered a stop hook
  assert.strictEqual(r.deletes.length, 1); assert.strictEqual(r.deletes[0].sweepHash, ''); assert.strictEqual(r.deletes[0].stop, true);
  assert.ok(r.toasts.some((m) => /stop code ran and a scan found nothing/.test(m)) && !r.toasts.some((m) => /^Stopped/.test(m)));
});
test('handler: hook fails -> NO delete request; the retry dialog says why; cancelling ends it', async () => {
  const r = await drive({ plugin: sbxP, entries: hooked(), hookResults: [{ status: 'failed', ran: true, error: 'boom' }], datas: [mkInfo([c1], 'H0'), mkInfo([c1], 'H0')], dialogs: [true, null] });
  assert.strictEqual(r.deletes.length, 0);
  assert.strictEqual(r.dlgs[1].title, 'Stop did not finish'); assert.ok(r.dlgs[1].message.includes('failed: boom') && r.dlgs[1].message.includes('NOT deleted') && r.dlgs[1].message.includes('PID 11'));
  assert.strictEqual(r.dlgs[1].okText, 'Try again');
});
test('handler: hook times out, then "Delete without stopping" -> skipStop, no sweepHash, the host is told it did not run', async () => {
  const r = await drive({ plugin: sbxP, entries: hooked(), hookResults: [{ status: 'timeout', ran: false, error: 'no answer in 15 s' }], datas: [mkInfo([c1], 'H0'), mkInfo([c1], 'H0')], dialogs: [true, 'skip'] });
  assert.strictEqual(r.deletes.length, 1); const b = r.deletes[0];
  assert.strictEqual(b.skipStop, true); assert.ok(!('sweepHash' in b)); assert.strictEqual(b.hookRan, false); assert.strictEqual(b.hookStatus, 'timeout');
});
test('handler: hook fails, then Try again runs the hook again', async () => {
  const r = await drive({ plugin: sbxP, entries: hooked(), hookResults: [{ status: 'failed', ran: true, error: 'x' }, { status: 'ok', ran: true }],
    datas: [mkInfo([c1], 'H0'), mkInfo([c1], 'H0'), mkInfo([], '')], dialogs: [true, true] });
  assert.strictEqual(r.deletes.length, 1); assert.strictEqual(r.deletes[0].hookStatus, 'ok'); assert.strictEqual(r.deletes[0].sweepHash, '');
});
test('handler: hook ok but the scan afterwards could not run -> NO delete request (the hook alone proves nothing)', async () => {
  const unchecked = { rootOk: false, items: [], stopPlan: {}, sweep: { rootOk: false, notes: ['cannot be checked: the process check did not finish in time'] } };
  const r = await drive({ plugin: sbxP, entries: hooked(), hookResults: [{ status: 'ok', ran: true }], datas: [mkInfo([c1], 'H0'), unchecked, unchecked], dialogs: [true, null] });
  assert.strictEqual(r.deletes.length, 0); assert.ok(r.dlgs[1].message.includes('nothing shows that it worked'));
  const r2 = await drive({ plugin: sbxP, entries: hooked(), hookResults: [{ status: 'ok', ran: true }], datas: [mkInfo([c1], 'H0'), new Error('net down'), mkInfo([c1], 'H0')], dialogs: [true, null] });
  assert.strictEqual(r2.deletes.length, 0);   // the data call itself failed
});
test('handler: hook ok but a NEW process appears -> no request, dialog opens again with the new list', async () => {
  const fresh = { pid: 99, start: 999, how: 'tag', args: 'respawned.sh' };
  const r = await drive({ plugin: sbxP, entries: hooked(), hookResults: [{ status: 'ok', ran: true }], datas: [mkInfo([c1], 'H0'), mkInfo([c1, fresh], 'H5'), mkInfo([c1, fresh], 'H5')], dialogs: [true, null] });
  assert.strictEqual(r.deletes.length, 0); assert.ok(r.toasts.some((m) => /not listed before/.test(m)));
  assert.strictEqual(r.dlgs.length, 2); assert.ok(r.dlgs[1].message.includes('respawned.sh') && r.dlgs[1].title === 'Confirm');
});
test('handler: a plugin that is not sandboxed, or has no hook, or is not loaded, never runs a hook (hook runner would throw)', async () => {
  for (const [pl, ent] of [[{ name: 'T.js', mode: 'trusted' }, hooked()], [sbxP, hooked({ hook: false })], [sbxP, {}], [sbxP, undefined]]) {
    const r = await drive({ plugin: pl, entries: ent, hookResults: [], datas: [mkInfo([c1], 'H0')], dialogs: [true] });
    assert.strictEqual(r.deletes.length, 1); assert.strictEqual(r.deletes[0].sweepHash, 'H0'); assert.ok(!('hookRan' in r.deletes[0]));
    assert.ok(!r.dlgs[0].message.includes('own stop code'));
  }
});
test('handler: a hook with a closed bridge is not offered and does not run', async () => {
  const r = await drive({ plugin: sbxP, entries: hooked({ dead: true }), hookResults: [], datas: [mkInfo([], '')], dialogs: [true] });
  assert.ok(!r.dlgs[0].message.includes('own stop code'));
});
test('handler: with declared commands the hook line comes with them, and a refused command still wins (no hook, no stop)', async () => {
  const withCmds = mkInfo([], '', { stopPlan: { commands: ['pkill -f beat.sh'], refused: [], shared: [], planHash: 'P1' } });
  const r = await drive({ plugin: sbxP, entries: hooked(), hookResults: [{ status: 'ok', ran: true }], datas: [withCmds, withCmds], dialogs: [true] });
  assert.ok(r.dlgs[0].message.includes('pkill -f beat.sh') && r.dlgs[0].message.includes('own stop code')); assert.strictEqual(r.deletes[0].planHash, 'P1');
  const refused = mkInfo([], '', { stopPlan: { commands: [], refused: [{ command: 'x', reason: 'r' }], shared: [], planHash: 'P2' } });
  const r2 = await drive({ plugin: sbxP, entries: hooked(), hookResults: [], datas: [refused], dialogs: [true] });
  assert.strictEqual(r2.deletes[0].skipStop, true); assert.ok(!('hookRan' in r2.deletes[0])); assert.ok(!r2.dlgs[0].message.includes('own stop code'));
});

(async () => {
  let bad = 0;
  for (const [name, f] of tests) { try { await f(); n++; } catch (e) { bad++; console.error('FAIL ' + name + ': ' + (e && e.message)); } }
  if (bad) { console.error(bad + ' failed'); process.exit(1); }
  console.log('plugin hook tests passed (' + n + ')');
})();

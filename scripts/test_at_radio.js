// radio-core.js (band lock, cell lock, AT parsing, radio restart order). No router, no browser: the real file is run with a fake api().
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../app/src/main/web-src/radio-core.js', 'utf8');
const calls = [];                       // every api() call, in order
let reply = () => ({});                 // set per test: (path, body) -> response object
const api = async (path, opt) => { const body = opt && opt.body ? JSON.parse(opt.body) : {}; calls.push({ path, body }); return reply(path, body); };
const win = {};
new Function('window', 'api', src)(win, api);
const R = win.MatchiRadio;
assert(R, 'window.MatchiRadio is not defined');
R.setSettle(0);   // no waiting for the router in tests
const { parseBands, toList, ratLabel, guessRat, cellOk, bandsCheck, parseNrSupported, fields } = R;
(async () => {
  assert.deepStrictEqual(parseBands('41,n78,3,3'), [3, 41, 78]);
  assert.deepStrictEqual(parseBands(''), []);
  assert.deepStrictEqual(parseBands('all'), []);
  assert.strictEqual(parseBands(undefined), null);   // key missing = hide, never "no bands"
  // the F50 reports plain comma lists, and the full list when nothing is locked (checked on the device)
  assert.deepStrictEqual(parseBands('1,2,3,4,5,7,8,12,13,17,18,19,20,25,26,28,34,38,39,40,41,42,43'), R.LTE_BANDS);
  assert.deepStrictEqual(parseBands('78'), [78]);
  assert.deepStrictEqual(toList([{ pci: '1' }]), [{ pci: '1' }]);
  assert.deepStrictEqual(toList('[{"pci":"2"}]'), [{ pci: '2' }]);
  assert.deepStrictEqual(toList(''), []);
  assert.deepStrictEqual(toList('garbage'), []);
  assert.strictEqual(ratLabel('12'), '4G'); assert.strictEqual(ratLabel('16'), '5G');
  assert.strictEqual(guessRat('n78'), '16'); assert.strictEqual(guessRat('B3'), '12'); assert.strictEqual(guessRat('78'), '');
  assert(cellOk('912', '504990', '16')); assert(cellOk('0', '1850', '12'));
  assert(!cellOk('1008', '1850', '12')); assert(!cellOk('9', '', '12')); assert(!cellOk('9', '1850', '')); assert(!cellOk('a', '1', '12'));
  // read-back after a lock: same list ok; unsupported band dropped (n6) still ok; wrong or empty is not
  assert.deepStrictEqual(bandsCheck([41], [41]), { ok: true, dropped: [] });
  assert.deepStrictEqual(bandsCheck([1, 5, 8, 28, 41, 78], [1, 5, 6, 8, 28, 41, 78]), { ok: true, dropped: [6] });
  assert(!bandsCheck([78], [41]).ok); assert(!bandsCheck([], [41]).ok); assert(!bandsCheck(null, [41]).ok);

  // F50 answer seen on the device: a stray "5" in front, and the first number is a COUNT, not band n6
  assert.deepStrictEqual(parseNrSupported('5+SP5GCMDS: get nr support_band,6,41,78,1,8,28,5\nOK'), [41, 78, 1, 8, 28, 5]);
  assert.deepStrictEqual(parseNrSupported('+SP5GCMDS: get nr support_band,3,78,41,1OK'), [78, 41, 1]);
  assert.deepStrictEqual(parseNrSupported('+SP5GCMDS: get nr support_band\nOK'), []);
  assert.deepStrictEqual(parseNrSupported('ERROR'), []);
  // stray first characters from the bridge do not move the fields
  assert.deepStrictEqual(fields('(+CEREG: 2,1,"304000","0009B002",11\nOK'), ['2', '1', '304000', '0009B002', '11']);
  assert.deepStrictEqual(fields('6+C5GREG: 2,1,"304000","30024C001",11,9,01.010101\nOK'), ['2', '1', '304000', '30024C001', '11', '9', '01.010101']);

  // setBands: sends every part, reads back, compares. Both must answer success; a refusal throws before anything else is sent.
  const router = { lte_band_lock: '1,3', nr_band_lock: '78' };
  reply = (path, b) => path === '/api/zte' ? { data: b.op === 'set' ? { result: 'success' } : router } : {};
  let r = await R.setBands([['LTE_BAND_LOCK', 'lte_band_lock', '1,3'], ['NR_BAND_LOCK', 'nr_band_lock', '78']], { lte: [1, 3], nr: [78] });
  assert.deepStrictEqual(r.sent, ['LTE_BAND_LOCK', 'NR_BAND_LOCK']); assert(r.ok); assert.deepStrictEqual(r.bad, []);
  r = await R.setBands([['LTE_BAND_LOCK', 'lte_band_lock', '8']], { lte: [8] });
  assert(!r.ok && r.bad.length === 1, 'router still reports 1,3 -> bad');
  calls.length = 0;
  reply = () => ({ data: { result: 'failure' } });
  await assert.rejects(R.setBands([['LTE_BAND_LOCK', 'lte_band_lock', '1'], ['NR_BAND_LOCK', 'nr_band_lock', '78']], {}), /refused/);
  assert.strictEqual(calls.length, 1, 'first refusal stops the rest');

  // radioCycle: the on-device script sends SFUN=5 on slot 0, slot 1, then SFUN=4 on slot 0, slot 1 (5 = off, 4 = on)
  const sh = R.CYCLE_SH;
  const at = (re) => sh.search(re);
  assert(at(/tx 0 AT\+SFUN=5/) < at(/tx 1 AT\+SFUN=5/) && at(/tx 1 AT\+SFUN=5/) < at(/tx \$s AT\+SFUN=4/), 'off slot 0, off slot 1, then on');
  const logs = [];
  reply = (path) => path === '/api/shell' ? { content: 'OFF0:+OK\nOFF1:+OK\nON0:1:OK\nON1:1:OK\n' } : {};
  assert.strictEqual(await R.radioCycle({ log: (l) => logs.push(l), toast: () => {} }), true);
  reply = (path) => path === '/api/shell' ? { content: 'NOSENDAT\n' } : {};
  assert.strictEqual(await R.radioCycle({ log: () => {}, toast: () => {} }), false);
  assert.strictEqual(await R.radioCycle(), false);   // no callbacks given: still works
  // radioCycle logs what happened to mobile data, and the verdict does not depend on it
  for (const [d, re] of [['ok', /internet works \(ping answered\)/], ['toggled', /switched off and on/], ['none', /no internet \(ping failed\)/], ['off', /switched off in Android/]]) {
    const lg = [];
    reply = (path) => path === '/api/shell' ? { content: 'OFF0:+OK\nOFF1:+OK\nON0:1:OK\nON1:1:OK\nDATA:' + d + '\n' } : {};
    assert.strictEqual(await R.radioCycle({ log: (l) => lg.push(l), toast: () => {} }), true);
    assert(lg.some((l) => re.test(l)), 'DATA:' + d + ' is logged');
  }
  assert(!logs.some((l) => /Mobile data/.test(l)), 'an answer without a DATA line logs nothing about mobile data');
  // the real on-device script, run in the host sh with fake sendat / ip / settings / svc (sleep is a no-op)
  {
    const cp = require('child_process'), os = require('os'), path = require('path');
    const run = (o) => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cyc-')), w = (n, t) => { fs.writeFileSync(path.join(d, n), '#!/bin/sh\n' + t + '\n', { mode: 0o755 }); };
      const st = path.join(d, 'state');
      fs.writeFileSync(st, o.route0 || 'no');   // does the internet work now (the fake ping reads it)
      w('sendat', o.sendat || 'echo OK');
      w('sleep', 'exit 0');
      w('settings', 'echo "' + (o.mobileData === undefined ? '1' : o.mobileData) + '"');
      w('svc', 'echo "$*" >> ' + d + '/svc.log; [ "$*" = "data enable" ] && echo ' + (o.routeAfterToggle || 'no') + ' > ' + st);   // the route appears only after the toggle
            w('ip', 'exit 0');   // only the NET: diagnostic line uses it
      w('ping', '[ "$(cat ' + st + ')" = yes ]');   // internet works when the state file says yes
      const script = R.CYCLE_SH.replace('/data/data/com.matchi.tool/files/sendat', path.join(d, 'sendat'));
      const out = cp.execFileSync('sh', ['-c', script], { env: { PATH: d + ':' + process.env.PATH }, encoding: 'utf8' });
      let svc = ''; try { svc = fs.readFileSync(path.join(d, 'svc.log'), 'utf8'); } catch (_) { /* no toggle */ }
      let s1 = ''; try { s1 = fs.readFileSync(path.join(d, 's1.log'), 'utf8'); } catch (_) { /* none */ }
      return { out, svc, s1 };
    };
    assert(!/route show default/.test(R.CYCLE_SH), 'the F50 has no default route in the main table even when online: never test for one');
    let r = run({ route0: 'yes' });
    assert(/DATA:ok/.test(r.out) && r.svc === '', 'internet works: no toggle');
    r = run({ route0: 'no', routeAfterToggle: 'yes' });
    assert(/DATA:toggled/.test(r.out) && r.svc === 'data disable\ndata enable\n', 'no internet: disable then enable, works again');
    r = run({ route0: 'no', routeAfterToggle: 'no' });
    assert(/DATA:none/.test(r.out) && r.svc === 'data disable\ndata enable\n', 'toggled once, still no internet');
    r = run({ route0: 'no', mobileData: 0 });
    assert(/DATA:off/.test(r.out) && r.svc === '', 'mobile data switched off by the owner: never touched');
    r = run({ route0: 'no', sendat: 'case "$*" in *SFUN=4*) echo ERROR;; *) echo OK;; esac' });
    assert(/DATA:skip/.test(r.out) && r.svc === '', 'radio did not come back: no data toggle');
    // one SIM slot (the F50): sendat has no device for slot 1, so slot 1 is skipped and never sent AT+SFUN
    r = run({ route0: 'yes', sendat: 'case "$*" in *"-n 1"*) echo "no modem AT device found for slot 1"; echo "$*" >> "$(dirname "$0")/s1.log";; *) echo OK;; esac' });
    assert(/OFF1:NOSLOT/.test(r.out) && /ON1:0:NOSLOT/.test(r.out) && /ON0:1:OK/.test(r.out) && /DATA:ok/.test(r.out), 'no slot 1: skipped, slot 0 restarted, data ok');
    assert(!/SFUN/.test(r.s1 || ''), 'no SFUN is sent to a slot that does not exist');
    r = run({ route0: 'no', sendat: 'echo ERROR' });
    assert(/NOAT:/.test(r.out) && !/DATA:/.test(r.out) && r.svc === '', 'modem silent: script stops before anything');
  }
  assert.strictEqual(await R.isRegistered(0), false);   // api returns nothing useful: counts as not registered (unlock is the safe side)
  // busy state: nested periods, listeners, release only once
  const seen = []; const off = R.onBusy((b, why) => seen.push([b, why]));
  assert(!R.isBusy());
  const d1 = R.beginBusy('Radio restarting, ~30 s'), d2 = R.beginBusy('Network mode changing');
  assert(R.isBusy() && R.busyReason() === 'Network mode changing');
  d2(); d2();   // a second call does nothing
  assert(R.isBusy() && R.busyReason() === 'Radio restarting, ~30 s');
  d1(); assert(!R.isBusy() && R.busyReason() === '');
  assert.deepStrictEqual(seen.map((x) => x[0]), [true, true, true, false]);
  off(); R.beginBusy('x')(); assert.strictEqual(seen.length, 4, 'unsubscribed listener hears nothing');
  R.onBusy(() => { throw new Error('bad listener'); }); R.beginBusy('y')();   // a throwing listener does not break the caller
  // waitRegistered: polls until stat 1 or 5, gives up after the limit
  let n = 0; reply = (path, b) => path === '/api/at' ? { result: ++n < 3 ? '+CEREG: 2,2\nOK' : '+CEREG: 2,1,"1","2",7\nOK' } : {};
  assert.strictEqual(await R.waitRegistered(0, { everyMs: 5, timeoutMs: 1000 }), true); assert(n >= 3);
  reply = () => ({ result: '+CEREG: 2,0\nOK' });
  assert.strictEqual(await R.waitRegistered(0, { everyMs: 5, timeoutMs: 30 }), false);

  // ---- cell lock (dashboard card + AT & Radio window share these) ----
  // servingCells: only the radio the network type says is in use, and only with a valid PCI + channel. NSA lists both. Never guessed.
  const sv = async (d) => { reply = (path) => path === '/api/zte' ? { data: d } : {}; return R.servingCells(); };
  const nrKeys = { nr5g_pci: '120', nr5g_action_channel: '636666', nr5g_action_band: 'n78', lte_pci: '301', wan_active_channel: '1850', wan_active_band: 'B3' };
  let sc = await sv({ network_type: '5G', ...nrKeys });
  assert.deepStrictEqual(sc.cells, [{ rat: '16', pci: '120', earfcn: '636666', band: 'n78' }], '5G (SA): only the NR cell');
  sc = await sv({ network_type: '4G LTE', ...nrKeys });
  assert.deepStrictEqual(sc.cells, [{ rat: '12', pci: '301', earfcn: '1850', band: 'B3' }], '4G: only the LTE cell, stale NR values ignored');
  sc = await sv({ network_type: 'ENDC', ...nrKeys });
  assert.deepStrictEqual(sc.cells.map((c) => c.rat), ['16', '12'], 'NSA offers both, the person picks');
  sc = await sv({ network_type: '5G', nr5g_pci: '', nr5g_action_channel: '636666' });
  assert.deepStrictEqual(sc.cells, [], 'missing PCI: nothing offered');
  sc = await sv({ network_type: '5G', nr5g_pci: '2000', nr5g_action_channel: '636666' });
  assert.deepStrictEqual(sc.cells, [], 'PCI out of range: nothing offered');
  sc = await sv({ ...nrKeys });
  assert.deepStrictEqual(sc.cells, [], 'network type not reported: nothing offered');
  // cellListed
  const cells = { nb: [], locked: [{ pci: 120, earfcn: 636666, rat: '16' }] };
  assert(R.cellListed(cells, '120', '636666', '16')); assert(!R.cellListed(cells, '120', '636666', '12')); assert(!R.cellListed(null, '1', '1', '12'));
  // cellLock / cellUnlock answer from the read-back
  calls.length = 0; let locked = [];
  reply = (path, b) => path !== '/api/zte' ? {} : b.op === 'set'
    ? (b.params.goformId === 'CELL_LOCK' ? (locked = [{ pci: b.params.pci, earfcn: b.params.earfcn, rat: b.params.rat }], { data: { result: 'success' } }) : (locked = [], { data: { result: 'success' } }))
    : { data: { neighbor_cell_info: [], locked_cell_info: locked } };
  let cl = await R.cellLock('120', '636666', '16');
  assert(cl.hit); assert.deepStrictEqual(calls[0].body.params, { goformId: 'CELL_LOCK', pci: '120', earfcn: '636666', rat: '16' });
  const cu = await R.cellUnlock(); assert(cu.none);
  assert(calls.some((c) => c.body.params && c.body.params.goformId === 'UNLOCK_ALL_CELL'));
  assert(!calls.some((c) => /SFUN/.test(JSON.stringify(c.body))), 'cell lock / unlock never restarts the radio');
  // F50: CELL_LOCK / UNLOCK_ALL_CELL answer with an EMPTY reply (success:true, data ''). That is accepted; the read-back decides. Other text is refused.
  locked = []; reply = (path, b) => path !== '/api/zte' ? {} : b.op === 'set'
    ? (b.params.goformId === 'CELL_LOCK' ? (locked = [{ pci: b.params.pci, earfcn: b.params.earfcn, rat: b.params.rat }], { data: '' }) : (locked = [], { data: '' }))
    : { data: { neighbor_cell_info: [], locked_cell_info: locked } };
  cl = await R.cellLock('100', '620640', '16'); assert(cl.hit && cl.reply === 'empty', 'empty reply accepted, lock confirmed by the read-back');
  assert((await R.cellUnlock()).none, 'empty reply on unlock accepted');
  reply = (path, b) => path === '/api/zte' ? (b.op === 'set' ? { data: '' } : { data: { neighbor_cell_info: [], locked_cell_info: [] } }) : {};
  cl = await R.cellLock('100', '620640', '16'); assert(!cl.hit, 'empty reply but the router lists nothing: not a hit (the card says so)');
  reply = (path, b) => path === '/api/zte' ? { data: b.op === 'set' ? { result: 'failure' } : {} } : {};
  await assert.rejects(R.cellLock('100', '620640', '16'), /refused/);
  await assert.rejects(R.cellUnlock(), /refused/);
  // Empty reply that changed NOTHING = the router ignored the command (lost sign-in / no AD token). The call is repeated with a fresh sign-in
  // (retry 1), then the older AD form (retry 2); a router that applies it on the retry is a success, one that never does is reported as ignored.
  {
    let lk = [], seen = [], applyAt = 99;   // applyAt: the retry level that finally works
    const mk = () => (path, b) => {
      if (path === '/api/zte/config') return { passwordSet: true };
      if (path !== '/api/zte') return {};
      if (b.op === 'set') { seen.push(b.retry); if (b.retry >= applyAt) lk = b.params.goformId === 'CELL_LOCK' ? [{ pci: b.params.pci, earfcn: b.params.earfcn, rat: b.params.rat }] : []; return { data: '' }; }
      return { data: { neighbor_cell_info: [], locked_cell_info: lk } };
    };
    lk = [{ pci: '100', earfcn: '620640', rat: '16' }]; seen = []; applyAt = 1; reply = mk();
    let u = await R.cellUnlock(); assert(u.none && u.attempts === 2, 'ignored at retry 0, applied after the fresh sign-in'); assert.deepStrictEqual(seen, [0, 1]);
    lk = []; seen = []; applyAt = 99; reply = mk();
    cl = await R.cellLock('100', '620640', '16'); assert(!cl.hit && cl.reply === 'empty' && cl.attempts === 3, 'never applied: 3 tries, reported as ignored'); assert.deepStrictEqual(seen, [0, 1, 2]);
    assert(/Reboot|password/.test(await R.emptyHint()));
    seen = []; lk = []; applyAt = 0; reply = mk();
    cl = await R.cellLock('100', '620640', '16'); assert(cl.hit && cl.attempts === 1 && seen.length === 1, 'applied on the first send (the F50 case): never repeated');
    // "success" is never repeated, even when the read-back does not show the change yet
    seen = []; reply = (path, b) => path === '/api/zte' ? (b.op === 'set' ? (seen.push(b.retry), { data: { result: 'success' } }) : { data: { neighbor_cell_info: [], locked_cell_info: [] } }) : {};
    cl = await R.cellLock('100', '620640', '16'); assert(!cl.hit && cl.reply === 'success' && seen.length === 1);
    // password not saved: the hint says so
    reply = (path) => path === '/api/zte/config' ? { passwordSet: false } : {};
    assert(/No router password saved/.test(await R.emptyHint()));
    // network mode: empty reply + old mode -> repeated; applied on retry 1 -> ok
    let mode = 'WL_AND_5G'; seen = [];
    reply = (path, b) => path !== '/api/zte' ? {} : b.op === 'set' ? (seen.push(b.retry), b.retry >= 1 && (mode = b.params.BearerPreference), { data: '' }) : { data: { net_select: mode } };
    let nm = await R.setNetMode('LTE_AND_5G'); assert(nm.ok && nm.attempts === 2 && nm.read.net === 'LTE_AND_5G');
    mode = 'WL_AND_5G'; reply = (path, b) => path !== '/api/zte' ? {} : b.op === 'set' ? { data: '' } : { data: { net_select: mode } };
    nm = await R.setNetMode('LTE_AND_5G'); assert(!nm.ok && nm.reply === 'empty' && nm.attempts === 3);
    reply = (path, b) => path !== '/api/zte' ? {} : b.op === 'set' ? { data: { result: 'failure' } } : { data: { net_select: mode } };
    await assert.rejects(R.setNetMode('LTE_AND_5G'), /refused/);
    // band lock with an empty reply that changes nothing: error with the reason, not "sent"
    let bl = '1,3'; reply = (path, b) => path === '/api/zte/config' ? { passwordSet: true } : path !== '/api/zte' ? {} : b.op === 'set' ? { data: '' } : { data: { lte_band_lock: bl, nr_band_lock: '78' } };
    await assert.rejects(R.setBands([['LTE_BAND_LOCK', 'lte_band_lock', '8']], { lte: [8] }), /empty reply 3 times/);
    reply = (path, b) => path !== '/api/zte' ? {} : b.op === 'set' ? (b.retry >= 1 && (bl = b.params.lte_band_lock), { data: '' }) : { data: { lte_band_lock: bl, nr_band_lock: '78' } };
    r = await R.setBands([['LTE_BAND_LOCK', 'lte_band_lock', '8']], { lte: [8] }); assert(r.ok, 'band lock applied after a fresh sign-in');
  }
  // watchCell: registered -> keeps, not registered -> asks the caller to unlock, a newer lock / unlock cancels it, switch-off is honoured
  const store = {}; global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  assert.strictEqual(R.cellAutoOn(), true, 'auto-unlock is ON by default');
  reply = (path) => path === '/api/at' ? { result: '+CEREG: 2,1,"1","2",7\nOK' } : {};
  assert.strictEqual(await R.watchCell({ waitMs: 20, stepMs: 5 }), 'registered');
  reply = () => ({ result: '+CEREG: 2,0\nOK' });
  assert.strictEqual(await R.watchCell({ waitMs: 20, stepMs: 5 }), 'unregistered');
  assert.strictEqual(await R.watchCell({ waitMs: 0 }), 'unregistered', 'waitMs 0 checks at once (used after a page reload)');
  let w = R.watchCell({ waitMs: 60, stepMs: 5 }); await R.sleep(15); reply = (path, b) => path === '/api/zte' ? { data: b.op === 'set' ? { result: 'success' } : { locked_cell_info: [], neighbor_cell_info: [] } } : {};
  await R.cellUnlock(); assert.strictEqual(await w, 'cancelled', 'an unlock cancels the pending check');
  reply = () => ({ result: '+CEREG: 2,0\nOK' });
  w = R.watchCell({ waitMs: 60, stepMs: 5 }); await R.sleep(15); const w2 = R.watchCell({ waitMs: 20, stepMs: 5 });
  assert.strictEqual(await w, 'cancelled', 'a newer watch replaces the older one'); assert.strictEqual(await w2, 'unregistered');
  R.setCellAuto(false); assert.strictEqual(R.cellAutoOn(), false);
  assert.strictEqual(await R.watchCell({ waitMs: 10, stepMs: 5 }), 'off', 'switched off: the lock stays');
  R.setCellAuto(true); assert.strictEqual(R.cellAutoOn(), true);
  console.log('at radio tests passed');
})().catch((e) => { console.error(e); process.exit(1); });

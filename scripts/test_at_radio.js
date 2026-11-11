// radio-core.js (band lock, cell lock, AT parsing, radio restart order). No router, no browser: the real file is run with a fake api().
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../app/src/main/web-src/radio-core.js', 'utf8');
const calls = [];                       // every api() call, in order
let reply = () => ({});                 // set per test: (path, body) -> response object
const api = async (path, opt) => { const body = JSON.parse(opt.body); calls.push({ path, body }); return reply(path, body); };
const win = {};
new Function('window', 'api', src)(win, api);
const R = win.MatchiRadio;
assert(R, 'window.MatchiRadio is not defined');
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

// speed-test.js core: input checks, the iperf3 script (in a real sh with a fake iperf3), the JSON parser, and the band test against a fake radio
// (it must put the old lock back whatever happens).
const fs = require('fs'), assert = require('assert'), os = require('os'), path = require('path'), cp = require('child_process');
const src = fs.readFileSync(__dirname + '/../app/src/main/web-src/speed-test.js', 'utf8');
const win = {}; new Function('window', src)(win);
const S = win.MatchiSpeed; assert(S, 'window.MatchiSpeed is not defined');

for (const h of ['iperf.example.com', '10.0.0.1', 'a', '2001:db8::1']) assert(S.validHost(h), h);
for (const h of ['', '-x', 'a b', 'a;rm -rf /', 'a$(id)', 'x\ny', '`id`', "a'b", 'a.b.', '1'.repeat(300), 'dead']) if (h !== 'dead') assert(!S.validHost(h), JSON.stringify(h));
assert(S.validPort(5201) && S.validPort('1') && !S.validPort(0) && !S.validPort(70000) && !S.validPort('5201;ls') && !S.validPort(''));
assert(S.validSecs(5) && !S.validSecs(2) && !S.validSecs(99) && !S.validSecs('5;x'));
assert.throws(() => S.script('bad host', 5201, 5, true));
assert.throws(() => S.script('ok.example', 99999, 5, true));

// parse
const good = JSON.stringify({ end: { sum_sent: { bits_per_second: 20e6, retransmits: 3 }, sum_received: { bits_per_second: 18.5e6 } } });
assert.deepStrictEqual(S.parse(good), { ok: true, mbps: 18.5, retrans: 3 });
assert.strictEqual(S.parse('NOIPERF3\n').ok, false);
assert(/not installed/.test(S.parse('NOIPERF3').error));
assert.strictEqual(S.parse('{"error":"unable to connect to server: Connection refused"}').error, 'unable to connect to server: Connection refused');
assert.strictEqual(S.parse('iperf3: error - the server is busy running a test').ok, false);
assert.strictEqual(S.parse('{ broken').ok, false);
assert.strictEqual(S.parse('').ok, false);
assert.deepStrictEqual(S.rank([{ band: 1, mbps: null }, { band: 3, mbps: 50 }, { band: 7, mbps: 90 }]).map((r) => r.band), [7, 3, 1]);

// the script, run in a real sh with a fake iperf3 (the script looks in the app's folder, so test the "not installed" branch and the command line shape)
const sc = S.script('h.example', 5201, 5, true);
assert(/-c h\.example -p 5201 -t 5 -J/.test(sc) && /-R/.test(sc) && !/-R/.test(S.script('h.example', 5201, 5, false)));
const r = cp.spawnSync('sh', ['-c', sc], { encoding: 'utf8' });
assert(/NOIPERF3/.test(r.stdout), 'without the binary the script must say NOIPERF3: ' + r.stdout + r.stderr);

// 4 streams and 1 s of slow start left out by default; both can be changed; bad values are refused
assert(/-J -O 1 -P 4 --connect-timeout/.test(sc), sc);
assert(/-P 1 /.test(S.script('h.example', 5201, 5, true, { streams: 1, omit: 0 })) && !/ -O /.test(S.script('h.example', 5201, 5, true, { streams: 1, omit: 0 })));
assert.throws(() => S.script('h.example', 5201, 5, true, { streams: 99 }));
assert.throws(() => S.script('h.example', 5201, 5, true, { streams: '4;ls' }));
assert(S.validStreams(1) && S.validStreams('8') && !S.validStreams(0) && !S.validStreams(9) && !S.validStreams('1;x'));
// ping: only when asked, only for a name or IPv4 address, and its lines never reach the JSON parser
assert(!/PING:/.test(sc) && /PING:/.test(S.script('h.example', 5201, 5, true, { ping: true })) && !/PING:/.test(S.script('2001:db8::1', 5201, 5, true, { ping: true })));
assert.deepStrictEqual(S.parsePing('PING:3 packets transmitted, 3 received, 0% packet loss, time 2003ms\nPING:rtt min/avg/max/mdev = 20.1/25.4/31.0/4.2 ms'), { ms: 25.4, jitter: 4.2, loss: 0 });
assert.deepStrictEqual(S.parsePing('PING:round-trip min/avg/max = 1.0/2.5/4.0 ms'), { ms: 2.5, jitter: null, loss: null });
assert.deepStrictEqual(S.parsePing('PING:3 packets transmitted, 0 received, 100% packet loss, time 2050ms'), { ms: null, jitter: null, loss: 100 });
assert.strictEqual(S.parsePing('{"end":{}}'), null);
assert.strictEqual(S.parse('PING:x = 1/2/3 ms\n' + good).mbps, 18.5);
// measure: a busy server is retried on the next port (two retries at most); other errors are not retried
(async () => {
  const mk = (answers) => { const calls = []; return { calls, run: async (sc) => { calls.push(sc); return answers[Math.min(calls.length - 1, answers.length - 1)]; } }; };
  const busyAns = '{"error":"the server is busy running a test. try again later"}';
  let m = mk([busyAns, good]), r = await S.measure(m.run, { host: 'h.example', port: 5201, secs: 5, streams: 4 }, true);
  assert(r.ok && r.port === 5202 && m.calls.length === 2 && / -p 5202 /.test(m.calls[1]), JSON.stringify(r));
  m = mk([busyAns]); r = await S.measure(m.run, { host: 'h.example', port: 5201, secs: 5, streams: 4 }, true);
  assert(!r.ok && m.calls.length === 3 && r.port === 5203);
  m = mk(['{"error":"unable to connect to server: Connection refused"}']); r = await S.measure(m.run, { host: 'h.example', port: 5201, secs: 5, streams: 1 }, false);
  assert(!r.ok && m.calls.length === 1 && / -P 1 /.test(m.calls[0]) && !/ -R/.test(m.calls[0]));
  m = mk(['PING:rtt min/avg/max/mdev = 9/10/11/1 ms\n' + good]); r = await S.measure(m.run, { host: 'h.example', port: 5201, secs: 5, streams: 4 }, true, { ping: true });
  assert(r.ok && r.ping && r.ping.ms === 10 && /ping -c 3/.test(m.calls[0]));
  m = mk([good]); r = await S.measure(m.run, { host: 'h.example', port: 5201, secs: 5, streams: 4 }, true);
  assert(r.ping === null && !/PING:/.test(m.calls[0]));
  await rest();
})().catch((e) => { console.error(e); process.exit(1); });

// band test with a fake radio
function fakeRadio(opt) {
  const o = opt || {}, calls = [], state = { lte: [1, 3, 7, 28], nr: [78] }, busy = [];
  return {
    calls, state, busy,
    LTE_BANDS: [1, 3, 7, 28], bandText: (l) => l.join(','), sleep: async () => {},
    readBands: async () => ({ lte: state.lte.slice(), nr: state.nr.slice() }),
    setBands: async (parts, expect) => {
      const [gf, , v] = parts[0]; calls.push(gf + ' ' + v);
      if (o.failLock && String(v) === String(o.failLock)) return { ok: false, bad: ['LTE reports none'] };
      if (o.failRestore && v === '1,3,7,28') throw new Error('router down');
      state[gf === 'LTE_BAND_LOCK' ? 'lte' : 'nr'] = v.split(',').map(Number); return { ok: true, bad: [] };
    },
    radioCycle: async () => { calls.push('cycle'); return !(o.cycleFail && calls.filter((c) => c === 'cycle').length === o.cycleFail); },
    waitRegistered: async () => !(o.noReg && state.lte.length === 1 && state.lte[0] === o.noReg),
    beginBusy: (why) => { busy.push('on'); return () => busy.push('off'); },
  };
}
async function rest() {
  // 1. normal run: three bands, ranked, old lock back, busy released
  let R = fakeRadio(), speeds = { 1: 30, 3: 80, 7: 55 };
  let out = await S.bandTest({ R, type: 'lte', bands: [1, 3, 7], full: [1, 3, 7, 28], log() {}, stop: () => false, signal: async () => ({ rsrp: -90, sinr: 10, band: 'B' }), speed: async () => ({ ok: true, mbps: speeds[R.state.lte[0]] }) });
  assert.deepStrictEqual(out.ranked.map((x) => x.band), [3, 7, 1]);
  assert(out.restored && R.state.lte.join() === '1,3,7,28', 'old lock must be back: ' + R.state.lte);
  assert.deepStrictEqual(R.busy, ['on', 'off']);
  // 2. a band the router refuses is a row with an error; the others still run
  R = fakeRadio({ failLock: 3 });
  out = await S.bandTest({ R, type: 'lte', bands: [1, 3, 7], full: [], log() {}, stop: () => false, signal: async () => ({}), speed: async () => ({ ok: true, mbps: 10 }) });
  assert(out.results.find((x) => x.band === 3).error && out.results.filter((x) => x.mbps === 10).length === 2 && out.restored && R.state.lte.join() === '1,3,7,28');
  // 3. no registration on a band: error row, test goes on, lock restored
  R = fakeRadio({ noReg: 7 });
  out = await S.bandTest({ R, type: 'lte', bands: [7, 1], full: [], log() {}, stop: () => false, signal: async () => ({}), speed: async () => ({ ok: true, mbps: 5 }) });
  assert(/registration/.test(out.results[0].error) && out.results[1].mbps === 5 && out.restored);
  // 4. stop between bands: lock restored
  R = fakeRadio(); let n = 0;
  out = await S.bandTest({ R, type: 'lte', bands: [1, 3, 7], full: [], log() {}, stop: () => n++ >= 1, signal: async () => ({}), speed: async () => ({ ok: true, mbps: 9 }) });
  assert.strictEqual(out.aborted, 'stopped'); assert(out.results.length === 1 && out.restored && R.state.lte.join() === '1,3,7,28');
  // 5. radio restart not confirmed: test aborts, restore still attempted
  R = fakeRadio({ cycleFail: 1 });
  out = await S.bandTest({ R, type: 'lte', bands: [1, 3], full: [], log() {}, stop: () => false, signal: async () => ({}), speed: async () => ({ ok: true, mbps: 9 }) });
  assert(/radio restart/.test(out.aborted) && R.calls[R.calls.length - 2].startsWith('LTE_BAND_LOCK 1,3,7,28'), 'restore must be tried: ' + R.calls);
  // 6. restore fails: said so, not hidden
  R = fakeRadio({ failRestore: true });
  out = await S.bandTest({ R, type: 'lte', bands: [1], full: [], log() {}, stop: () => false, signal: async () => ({}), speed: async () => ({ ok: true, mbps: 9 }) });
  assert.strictEqual(out.restored, false); assert.deepStrictEqual(R.busy, ['on', 'off']);
  // 7. old lock reads empty: the full supported list is used; no list at all: refuse before changing anything
  R = fakeRadio(); R.state.lte = [];
  out = await S.bandTest({ R, type: 'lte', bands: [1], full: [1, 3], log() {}, stop: () => false, signal: async () => ({}), speed: async () => ({ ok: true, mbps: 9 }) });
  assert(R.state.lte.join() === '1,3');
  R = fakeRadio(); R.state.lte = [];
  await assert.rejects(() => S.bandTest({ R, type: 'lte', bands: [1], full: [], log() {}, stop: () => false, signal: async () => ({}), speed: async () => ({}) }));
  assert.strictEqual(R.calls.length, 0);
  // 8. NR uses the NR lock only
  R = fakeRadio();
  await S.bandTest({ R, type: 'nr', bands: [78], full: [], log() {}, stop: () => false, signal: async () => ({}), speed: async () => ({ ok: true, mbps: 1 }) });
  assert(R.calls.filter((c) => c !== 'cycle').every((c) => c.startsWith('NR_BAND_LOCK')) && R.state.nr.join() === '78' && R.state.lte.join() === '1,3,7,28');
  // signal: junk and placeholder values are "no value"; real ones are kept
  assert.strictEqual(S.cleanRsrp('-95'), -95); assert.strictEqual(S.cleanRsrp(''), null); assert.strictEqual(S.cleanRsrp('0'), null); assert.strictEqual(S.cleanRsrp(undefined), null); assert.strictEqual(S.cleanRsrp('-999'), null);
  assert.strictEqual(S.cleanSinr('12'), 12); assert.strictEqual(S.cleanSinr('0'), 0); assert.strictEqual(S.cleanSinr(''), null);
  assert.strictEqual(S.cesqRsrp('+CESQ: 99,99,255,255,20,70\nOK'), -70); assert.strictEqual(S.cesqRsrp('+CESQ: 99,99,255,255,20,255'), null); assert.strictEqual(S.cesqRsrp('ERROR'), null);
  // an empty first answer is asked again (up to 6 times, until RSRP and SINR are both there)
  R = fakeRadio({}); let asks = 0;
  out = await S.bandTest({ R, type: 'lte', bands: [1], full: [], log() {}, stop: () => false, signal: async () => (++asks < 3 ? {} : { rsrp: '-95', sinr: '12', band: 'B1' }), speed: async () => ({ ok: true, mbps: 9 }) });
  assert(asks === 3 && out.results[0].rsrp === -95 && out.results[0].sinr === 12, 'signal must be retried: ' + asks);
  // a signal that never comes is not an error: row keeps its speed, rsrp and sinr stay empty
  R = fakeRadio({}); asks = 0;
  out = await S.bandTest({ R, type: 'lte', bands: [1], full: [], log() {}, stop: () => false, signal: async () => { asks++; throw new Error('router empty'); }, speed: async () => ({ ok: true, mbps: 9 }) });
  assert(asks === 9 && out.results[0].mbps === 9 && out.results[0].rsrp === null && out.results[0].sinr === null && !out.results[0].error);
  // Android telephony: LTE rsrp / rssnr, NR ssRsrp / ssSinr; 2147483647 is "no value"
  const tele = 'mSignalStrength=SignalStrength:{mCellSignalStrengths=[CellSignalStrengthLte: rssi=-70 rsrp=-95 rsrq=-9 rssnr=14 cqi=2147483647 level=3, CellSignalStrengthNr:{ssRsrp=-101 ssRsrq=-11 ssSinr=2147483647 level=2}]}';
  let tv = S.teleSignal(tele, 'lte'); assert(tv.rsrp === -95 && tv.sinr === 14, JSON.stringify(tv));
  tv = S.teleSignal(tele, 'nr'); assert(tv.rsrp === -101 && tv.sinr === null, JSON.stringify(tv));
  tv = S.teleSignal('CellSignalStrengthLte: rssi=-80 rsrp=2147483647 rssnr=2147483647 CellSignalStrengthLte: rsrp=-88 rssnr=7', 'lte'); assert(tv.rsrp === -88 && tv.sinr === 7, JSON.stringify(tv));
  tv = S.teleSignal('', 'lte'); assert(tv.rsrp === null && tv.sinr === null);
  // SINR is kept even when RSRP is missing
  R = fakeRadio({});
  out = await S.bandTest({ R, type: 'lte', bands: [1], full: [], log() {}, stop: () => false, signal: async () => ({ sinr: '9' }), speed: async () => ({ ok: true, mbps: 9 }) });
  assert(out.results[0].rsrp === null && out.results[0].sinr === 9);
  // AT+CESQ with the 5G fields (F50 answer): LTE 255 = none, ss_rsrp 54 -> -102 dBm, ss_sinr 67 -> 10 dB
  let ce = S.cesqAll('+CESQ: 99,99,255,255,255,255,73,54,67\nOK'); assert(ce.lteRsrp === null && ce.nrRsrp === -102 && ce.nrSinr === 10, JSON.stringify(ce));
  ce = S.cesqAll('+CESQ: 99,99,255,255,20,70'); assert(ce.lteRsrp === -70 && ce.nrRsrp === null && ce.nrSinr === null, JSON.stringify(ce));
  ce = S.cesqAll('ERROR'); assert(ce.lteRsrp === null && ce.nrRsrp === null);
  // network mode: with "4G only" the mode is re-sent after the restart; a band that stays on 5G is skipped, one that recovers is tested; in Auto the row is only marked
  const withMode = (net) => { const r = fakeRadio({}); r.sent = 0; r.readRadio = async () => ({ net }); r.setNetMode = async () => { r.sent++; return { ok: true }; }; return r; };
  R = withMode('Only_LTE'); let seq = ['ENDC', 'LTE'];
  out = await S.bandTest({ R, type: 'lte', bands: [1], full: [], log() {}, stop: () => false, link: async () => seq.shift() || 'LTE', signal: async () => ({}), speed: async () => ({ ok: true, mbps: 9 }) });
  assert(R.sent >= 1 && out.results[0].mbps === 9 && !out.results[0].g5 && !out.results[0].error, 'recovered link: ' + JSON.stringify(out.results[0]));
  R = withMode('Only_LTE'); let sp = 0;
  out = await S.bandTest({ R, type: 'lte', bands: [1], full: [], log() {}, stop: () => false, link: async () => 'ENDC', signal: async () => ({}), speed: async () => { sp++; return { ok: true, mbps: 9 }; } });
  assert(sp === 0 && out.results[0].mbps === null && /5G still on/.test(out.results[0].error) && !out.aborted && out.restored, 'stuck on 5G: ' + JSON.stringify(out.results[0]));
  R = withMode('WL_AND_5G');
  out = await S.bandTest({ R, type: 'lte', bands: [1], full: [], log() {}, stop: () => false, link: async () => 'ENDC', signal: async () => ({}), speed: async () => ({ ok: true, mbps: 9 }) });
  assert(R.sent === 0 && out.results[0].mbps === 9 && out.results[0].g5 === true && !out.results[0].error, 'auto mode: ' + JSON.stringify(out.results[0]));
  // no signal before the speed test, a real one after it: the second read is used
  R = fakeRadio({}); asks = 0;
  out = await S.bandTest({ R, type: 'lte', bands: [1], full: [], log() {}, stop: () => false, signal: async () => (++asks <= 6 ? {} : { rsrp: '-101', sinr: '-5', band: 'B1' }), speed: async () => ({ ok: true, mbps: 9 }) });
  assert(out.results[0].rsrp === -101 && out.results[0].sinr === -5 && out.results[0].mbps === 9, 'read after the speed test: ' + JSON.stringify(out.results[0]));
  // a reading that names another band than the locked one is the old band's value: ignored, the row says which band is active
  R = fakeRadio({});
  out = await S.bandTest({ R, type: 'lte', bands: [1], full: [], log() {}, stop: () => false, signal: async () => ({ rsrp: '-90', sinr: '10', band: 'LTE BAND 3' }), speed: async () => ({ ok: true, mbps: 9 }) });
  assert(out.results[0].rsrp === null && out.results[0].sinr === null && /3/.test(out.results[0].active) && out.results[0].mbps === 9, 'wrong band: ' + JSON.stringify(out.results[0]));
  R = fakeRadio({});
  out = await S.bandTest({ R, type: 'lte', bands: [1], full: [], log() {}, stop: () => false, signal: async () => ({ rsrp: '-90', sinr: '10', band: 'LTE BAND 1' }), speed: async () => ({ ok: true, mbps: 9 }) });
  assert(out.results[0].rsrp === -90 && out.results[0].sinr === 10, 'right band kept');
  // trace: every step is recorded with its raw answer, errors keep their message, the radio restart log is no longer thrown away
  R = fakeRadio({ failLock: 3 }); R.radioCycle = async (ui) => { ui.log('slot 0 off: OK'); return true; };
  let changes = 0; const tr = S.makeTrace(() => changes++);
  await S.bandTest({ R, type: 'lte', bands: [1, 3], full: [], log() {}, trace: tr, stop: () => false, signal: async () => ({ rsrp: '-90', sinr: '10', band: 'B1' }), speed: async () => ({ ok: true, mbps: 9, port: 5201 }) });
  const tx = tr.text();
  assert(/start: /.test(tx) && /readBands/.test(tx) && /old lock to restore: B1 B3 B7 B28/.test(tx), tx);
  assert(/setBands B1/.test(tx) && /radio restart: slot 0 off: OK/.test(tx) && /radioCycle returned: true/.test(tx) && /waitRegistered: registered/.test(tx), tx);
  assert(/speed result B1: .*"mbps":9/.test(tx) && /signal read B1/.test(tx), tx);
  assert(/band B3 ERROR: the router did not report the new lock/.test(tx), 'a refused lock must show in the trace: ' + tx);
  assert(/--- restore/.test(tx) && /restored/.test(tx) && /end: /.test(tx) && changes === tr.rows.length, tx);
  // a failing router read is traced with its message and still thrown
  R = fakeRadio(); R.readBands = async () => { throw new Error('router down'); };
  const tr2 = S.makeTrace(); await assert.rejects(() => S.bandTest({ R, type: 'lte', bands: [1], full: [], log() {}, trace: tr2, stop: () => false, signal: async () => ({}), speed: async () => ({}) }));
  assert(/readBands ERROR: router down/.test(tr2.text()));
  // long values are cut, the row count is capped
  const tr3 = S.makeTrace(null, 5); for (let k = 0; k < 20; k++) tr3('x' + k, 'y'.repeat(2000));
  assert(tr3.rows.length <= 5 && tr3.rows[tr3.rows.length - 1].data.length < 1000);
  // measure reports every raw answer to onRaw
  const raws = []; const mm = await S.measure(async () => 'iperf3: error - the server is busy running a test', { host: 'h.example', port: 5201, secs: 5, streams: 1 }, true, { onRaw: (x) => raws.push(x) });
  assert(raws.length === 3 && raws[0].port === 5201 && raws[2].port === 5203 && /busy/.test(raws[0].raw) && !mm.ok);
  // LTE row under 5G NSA: LTE fields empty, 5G values exist -> shown, labelled as 5G; not used when the link is plain LTE
  R = fakeRadio({});
  out = await S.bandTest({ R, type: 'lte', bands: [1], full: [], log() {}, stop: () => false, link: async () => '5G', signal: async () => ({ rsrp: '', sinr: '', band: '', nr: { rsrp: -102, sinr: 7, band: 'n78' } }), speed: async () => ({ ok: true, mbps: 9 }) });
  assert(out.results[0].rsrp === -102 && out.results[0].sinr === 7 && out.results[0].sig5 === 'n78' && out.results[0].g5 === true, 'NSA fallback: ' + JSON.stringify(out.results[0]));
  R = fakeRadio({});
  out = await S.bandTest({ R, type: 'lte', bands: [1], full: [], log() {}, stop: () => false, link: async () => 'LTE', signal: async () => ({ rsrp: '', sinr: '', nr: { rsrp: -102, sinr: 7 } }), speed: async () => ({ ok: true, mbps: 9 }) });
  assert(out.results[0].rsrp === null && !out.results[0].sig5, 'plain LTE must not borrow 5G values');
  // Auto mode is never changed unless the mode is already 4G only; a row with 5G attached is labelled and still ranked
  {
    const mk = () => { const r = fakeRadio({}); r.net = 'WL_AND_5G'; r.nets = []; r.readRadio = async () => ({ net: r.net }); r.setNetMode = async (m) => { r.net = m; r.nets.push(m); return { ok: true }; }; return r; };
    R = mk(); out = await S.bandTest({ R, type: 'lte', bands: [1], force4g: true, full: [], log() {}, stop: () => false, link: async () => 'LTE', signal: async () => ({}), speed: async () => ({ ok: true, mbps: 9 }) });
    assert(R.nets[0] === 'Only_LTE' && R.net === 'WL_AND_5G' && out.results[0].mbps === 9 && !out.results[0].mixed, 'forced 4G, mode put back: ' + R.nets);
    R = mk(); R.setNetMode = async () => ({ ok: false }); await assert.rejects(() => S.bandTest({ R, type: 'lte', bands: [1], force4g: true, full: [], log() {}, stop: () => false, link: async () => '5G', signal: async () => ({}), speed: async () => ({ ok: true, mbps: 99 }) }), /Could not set 4G only/); assert(R.calls.length === 0, 'nothing locked or restarted when 4G only cannot be set: ' + R.calls);
    R = mk(); out = await S.bandTest({ R, type: 'lte', bands: [1, 3], full: [], log() {}, stop: () => false, link: async () => '5G', signal: async () => ({}), speed: async () => ({ ok: true, mbps: 50 }) });
    assert(R.nets.length === 0 && out.results.every((x) => x.mixed && x.mbps === 50), 'Auto mode is left alone; 5G rows are labelled, still ranked');
  }
  // 5G NR test: a row whose link is not 5G is skipped with the reason; a 4G-only mode is lifted to Auto for the test and put back
  {
    const mk = (net) => { const r = fakeRadio({}); r.net = net; r.nets = []; r.readRadio = async () => ({ net: r.net }); r.setNetMode = async (m) => { r.net = m; r.nets.push(m); return { ok: true }; }; return r; };
    R = mk('Only_LTE'); out = await S.bandTest({ R, type: 'nr', bands: [78], full: [], log() {}, stop: () => false, link: async () => 'ENDC', signal: async () => ({}), speed: async () => ({ ok: true, mbps: 300 }) });
    assert(R.nets[0] === 'WL_AND_5G' && R.net === 'Only_LTE' && out.results[0].mbps === 300, 'NR: 4G only lifted, then put back: ' + R.nets);
    R = mk('WL_AND_5G'); let sp5 = 0; out = await S.bandTest({ R, type: 'nr', bands: [78], full: [], log() {}, stop: () => false, link: async () => 'LTE', signal: async () => ({}), speed: async () => { sp5++; return { ok: true, mbps: 1 }; } });
    assert(R.nets.length === 0 && sp5 === 0 && /5G not active/.test(out.results[0].error) && !out.aborted && out.restored, 'NR on a 4G link is skipped: ' + JSON.stringify(out.results[0]));
  }
  // a band that fails the network check (or is not supported) is skipped with its reason and the next band is tried, in 4G and 5G tests
  { const r = fakeRadio({}); r.readRadio = async () => ({ net: 'WL_AND_5G' }); r.setNetMode = async () => ({ ok: true }); let sp6 = 0;
    out = await S.bandTest({ R: r, type: 'nr', bands: [41, 78, 28], full: [], log() {}, stop: () => false, link: async () => (r.state.nr[0] === 78 ? 'ENDC' : 'LTE'), signal: async () => ({}), speed: async () => { sp6++; return { ok: true, mbps: 200 }; } });
    assert(out.results.length === 3 && sp6 === 1 && /5G not active/.test(out.results[0].error) && out.results[1].mbps === 200 && /5G not active/.test(out.results[2].error) && !out.aborted && out.restored, 'NR: skip and go on: ' + JSON.stringify(out.results));
    const r2 = fakeRadio({ noReg: 3 }); r2.readRadio = async () => ({ net: 'Only_LTE' }); r2.setNetMode = async () => ({ ok: true });
    out = await S.bandTest({ R: r2, type: 'lte', bands: [3, 1, 7], full: [], log() {}, stop: () => false, link: async () => (r2.state.lte[0] === 7 ? 'ENDC' : 'LTE'), signal: async () => ({}), speed: async () => ({ ok: true, mbps: 80 }) });
    assert(out.results.length === 3 && /registration/.test(out.results[0].error) && out.results[1].mbps === 80 && /5G still on/.test(out.results[2].error) && !out.aborted && out.restored, '4G: skip and go on: ' + JSON.stringify(out.results)); }
  // a signal read that never answers does not freeze the test: the row keeps its speed, the trace names the hang
  { await assert.rejects(() => S.withTimeout(new Promise(() => {}), 30, 'Live fresh()'), /Live fresh\(\) did not answer/); assert.strictEqual(await S.withTimeout(Promise.resolve(7), 30, 'x'), 7);
    const r = fakeRadio({}), t = S.makeTrace();
    out = await S.bandTest({ R: r, type: 'lte', bands: [1], full: [], log() {}, trace: t, signalTimeoutMs: 20, stop: () => false, signal: () => new Promise(() => {}), speed: async () => ({ ok: true, mbps: 9 }) });
    assert(out.results[0].mbps === 9 && !out.results[0].error && out.restored && /signal read ERROR: signal read did not answer/.test(t.text()), 'hung signal: ' + t.text()); }
  // no internet after the lock: the band is skipped with the reason (no speed test that can only time out), the next band is tried
  { const r = fakeRadio({}); let sp7 = 0, up = false;
    out = await S.bandTest({ R: r, type: 'lte', bands: [41, 3], full: [], log() {}, stop: () => false, signalTimeoutMs: 50, netWaitMs: 40, net: async () => up, signal: async () => (r.state.lte[0] === 3 ? (up = true, {}) : {}), speed: async () => { sp7++; return { ok: true, mbps: 20 }; } });
    assert(/no internet on B41/.test(out.results[0].error) && out.results[1].mbps === 20 && sp7 === 1 && out.restored, 'no internet: ' + JSON.stringify(out.results)); }
  assert.strictEqual(S.parse('{"error":"interrupt - the client has terminated by signal Terminated(15)"}').error, 'No data came through in time (weak or stalled link)');
  // CPU snapshots and the leftover-iperf3 check are written to the trace at the right moments
  { const r = fakeRadio({}), t = S.makeTrace(); let cl = 0;
    await S.bandTest({ R: r, type: 'lte', bands: [1], full: [], log() {}, trace: t, stop: () => false, cpu: async () => 'PID %CPU\n123 99 iperf3', cleanup: async () => { cl++; return 'none'; }, signal: async () => ({}), speed: async () => ({ ok: true, mbps: 9 }) });
    const x = t.text(); assert(/cpu before start/.test(x) && /cpu after restart B1/.test(x) && /cpu before speed B1/.test(x) && /cpu after speed B1/.test(x) && /123 99 iperf3/.test(x) && cl === 1 && /iperf3 left running\?: none/.test(x), x); }
  console.log('speed test ok: input checks, iperf3 script, parser, band test restores the old lock in every case, busy server retry, ping');
}

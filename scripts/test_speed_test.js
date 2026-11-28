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
  console.log('speed test ok: input checks, iperf3 script, parser, band test restores the old lock in every case, busy server retry, ping');
}

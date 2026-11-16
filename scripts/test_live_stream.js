// Live panel push stream, page side (real-time plan Phase 4). Cuts the REAL block between LIVE-STREAM-BEGIN / LIVE-STREAM-END out of index.html
// and runs it with a fake clock, a fake fetch (a scripted event stream) and stubbed page state, so a change to the page code is what gets tested.
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/assets/web/index.html'), 'utf8');
const a = html.indexOf('/* LIVE-STREAM-BEGIN */'), b = html.indexOf('/* LIVE-STREAM-END */');
if (a < 0 || b < a) { console.error('FAIL live stream block not found in index.html'); process.exit(1); }
const slice = html.slice(a, b);
let bad = 0; const ok = (c, n) => { if (!c) { bad++; console.error('FAIL', n); } };

// The page uses these from its surroundings; the test sets them.
function make(env = {}) {
  const calls = { fetch: [], builds: 0, paints: 0 };
  const T = { now: 1000000 };
  const queue = [];                       // scripted answers for fetch('/api/live/stream')
  const code = `
    let auto = true, mode = 'normal', hidden = false, onCard = true, batteryLow = false, radio = false, insecure = false, heat = 0, sysPart = null, last = null;
    const batLow = () => batteryLow, radioBusy = () => radio, insecurePage = () => insecure, heatLevel = () => heat, visible = () => onCard;
    const document = { get hidden() { return hidden; } };
    const TOKEN = 'tok';
    const build = () => { calls.builds++; return { cpu: sysPart && sysPart.cpu }; }, paint = () => { calls.paints++; };
    ${slice}
    return { LS, liveFresh, streamWanted, liveSys, applyFrame, handleLiveFrame, closeLive, openLive, syncLive,
      set(o) { if ('auto' in o) auto = o.auto; if ('mode' in o) mode = o.mode; if ('hidden' in o) hidden = o.hidden; if ('onCard' in o) onCard = o.onCard; if ('batteryLow' in o) batteryLow = o.batteryLow; if ('radio' in o) radio = o.radio; if ('insecure' in o) insecure = o.insecure; if ('heat' in o) heat = o.heat; if ('sysPart' in o) sysPart = o.sysPart; },
      get sysPart() { return sysPart; } };`;
  const fakeFetch = (url, opt) => {
    calls.fetch.push({ url, opt });
    if (url === '/api/live/view') return Promise.resolve({ ok: (env.viewStatus || 200) < 300, status: env.viewStatus || 200 });
    const next = queue.shift() || { status: 503, chunks: [] };
    const chunks = (next.chunks || []).map((c) => Buffer.from(c, 'utf8'));
    let i = 0;
    const body = { getReader: () => ({ read: () => new Promise((res, rej) => {
      if (opt.signal && opt.signal.aborted) return rej(new Error('aborted'));
      if (i < chunks.length) return res({ done: false, value: chunks[i++] });
      if (next.hang) { opt.signal.addEventListener('abort', () => rej(new Error('aborted'))); return; }
      res({ done: true });
    }) }) };
    return Promise.resolve({ ok: (next.status || 200) < 300, status: next.status || 200, headers: { get: (k) => (k.toLowerCase() === 'x-live-id' ? (next.id === undefined ? 'abcdef012345' : next.id) : null) }, body });
  };
  const ctx = { calls, fetch: fakeFetch, TextDecoder, AbortController, Date: { now: () => T.now }, Math, Number, Object, JSON, Array, String, Promise, setTimeout, clearTimeout };
  const api = vm.runInNewContext('(function(){' + code + '})', ctx)();
  return Object.assign(api, { T, queue, calls });
}
const frame = (o) => 'data: ' + JSON.stringify(Object.assign({ v: 1, seq: 1, t: 5, full: false }, o)) + '\n\n';
const FULL = frame({ full: true, cpu: 12.5, pc: { 0: 10, 1: 20 }, fq: { 0: [1, 936000, 1800000], 1: [0, 0, 1800000] }, tz: { 'soc-thermal': 45, 'mdm-q6': 51.5 }, sys: { l: [0.1, 0.25, 0.3], up: 100.5, mt: 4000000, ma: 2000000, at: 5 } });
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  // 1. A full frame fills the card values; the battery and telephony fields of the slow read stay.
  {
    const e = make(); e.set({ sysPart: { bat: 80, st: 3, temp: 300, zones: [{ t: 'old', v: 30 }], errs: [], cpu: 1, cores: [{ id: 0, pct: 1 }] } });
    e.queue.push({ chunks: [FULL], hang: true });
    e.openLive(); await tick(); await tick();
    const p = e.sysPart;
    ok(e.LS.on && e.LS.id === 'abcdef012345', 'connected, id taken from X-Live-Id');
    ok(p.cpu === 12.5 && p.cores.length === 2 && p.cores[1].pct === 20, 'cpu and per-core % from the stream ' + JSON.stringify(p.cores));
    ok(p.freqs.length === 2 && p.freqs[0].on === true && p.freqs[0].cur === 936000 && p.freqs[1].on === false, 'per-core speed (offline core = off)');
    ok(p.zones.length === 2 && p.zones[0].t === 'soc-thermal' && p.zones[0].v === 45, 'thermal zones replace the slow ones');
    ok(p.mem.pct === 50 && p.mem.used === 1953 && p.mem.total === 3906, 'memory: ' + JSON.stringify(p.mem));
    ok(p.load === '0.10 0.25 0.30' && p.upSec === 100.5, 'load and uptime ' + p.load);
    ok(p.bat === 80 && p.st === 3 && p.temp === 300, 'battery fields untouched');
    ok(e.liveFresh() && e.calls.paints >= 1, 'fresh, and the card was repainted');
    e.closeLive(false);
  }
  // 2. A delta changes only what it names; a full frame drops what it leaves out.
  {
    const e = make(); e.set({ sysPart: null });
    e.queue.push({ chunks: [FULL, frame({ seq: 2, cpu: 80, pc: { 1: 90 }, tz: { 'soc-thermal': 46 } })], hang: true });
    e.openLive(); await tick(); await tick();
    const p = e.sysPart;
    ok(p.cpu === 80 && p.cores[0].pct === 10 && p.cores[1].pct === 90, 'delta merged ' + JSON.stringify(p.cores));
    ok(p.zones.find((z) => z.t === 'soc-thermal').v === 46 && p.zones.find((z) => z.t === 'mdm-q6').v === 51.5, 'only the named zone changed');
    ok(p.mem.pct === 50, 'memory kept from the last frame that had it');
    e.handleLiveFrame(frame({ seq: 3, full: true, pc: { 0: 5 }, fq: {}, tz: { 'soc-thermal': 40 } }).trim());
    const q = e.sysPart;
    ok(q.cores.length === 1 && q.cores[0].pct === 5 && q.zones.length === 1 && q.zones[0].v === 40, 'full frame replaces the cores and zones ' + JSON.stringify(q.cores));
    ok(e.LS.st.cpu === undefined && Object.keys(e.LS.st.tz).length === 1 && e.LS.st.sys === null, 'a field missing from a full frame has no value');
    e.closeLive(false);
  }
  // 3. Bad data is ignored, never shown.
  {
    const e = make();
    ok(e.applyFrame({ v: 2, cpu: 5 }) === false, 'unknown version ignored');
    e.applyFrame({ v: 1, full: true, cpu: 500, pc: { 0: -5, x: 3, 1: 'a' }, fq: { 0: [1, 2] }, tz: { a: 0, b: 400, c: 50 }, sys: { l: [1, 2], up: 1, mt: 1, ma: 1 } });
    const st = e.LS.st;
    ok(st.cpu === 100 && st.pc[0] === 0 && !('x' in st.pc) && !(1 in st.pc), 'percentages clamped, junk keys dropped');
    ok(Object.keys(st.fq).length === 0 && Object.keys(st.tz).join() === 'c' && st.sys === null, 'bad speed / zone / sys values dropped');
  }
  // 4. The stream is wanted only in the right situations.
  {
    const e = make();
    ok(e.streamWanted(), 'Normal, cool, auto on');
    e.set({ mode: 'fast' }); ok(e.streamWanted(), 'Fast');
    e.set({ mode: 'eco' }); ok(!e.streamWanted(), 'Eco keeps the old polling');
    e.set({ mode: 'normal', auto: false }); ok(!e.streamWanted(), 'Live refresh off');
    e.set({ auto: true, batteryLow: true }); ok(!e.streamWanted(), 'battery pause');
    e.set({ batteryLow: false, radio: true }); ok(!e.streamWanted(), 'radio restart');
    e.set({ radio: false, insecure: true }); ok(!e.streamWanted(), 'plain HTTP');
    e.set({ insecure: false, heat: 1 }); ok(e.streamWanted(), 'warm phone: the stream stays (it carries the temperatures)');
    e.set({ heat: 2 }); ok(e.streamWanted(), 'hot phone: the stream stays');
  }
  // 5. Heat guard (Phase 5): the stream is never closed for heat; the repaint rate follows mode and heat (slowest wins), frames are always applied.
  {
    const e = make();
    e.queue.push({ chunks: [FULL], hang: true });
    e.syncLive(); await tick(); await tick();
    ok(e.LS.on, 'syncLive opens the stream');
    e.set({ heat: 2 }); e.syncLive();
    ok(e.LS.ctl && e.LS.on, 'hot: stream stays open');
    e.closeLive();
  }
  {
    const run = async (mode, heat, secs) => {
      const e = make(); e.set({ mode, heat });
      const f = (n) => frame({ seq: n, cpu: 10 + n }).trim();
      e.handleLiveFrame(FULL.trim());
      for (let i = 1; i <= secs; i++) { e.T.now += 1000; e.handleLiveFrame(f(i)); }
      return { paints: e.calls.paints, cpu: e.LS.st.cpu };
    };
    let r = await run('fast', 0, 10); ok(r.paints === 11, 'Live, cool: every frame is painted (' + r.paints + ')');
    r = await run('normal', 0, 9); ok(r.paints === 4, 'Balanced, cool: first frame, then every 3 s (' + r.paints + ')');
    r = await run('fast', 1, 10); ok(r.paints === 6, 'Live, warm: every 2 s (' + r.paints + ')');
    r = await run('fast', 2, 10); ok(r.paints === 3, 'Live, hot: every 5 s (' + r.paints + ')');
    r = await run('normal', 2, 10); ok(r.paints === 3 && r.cpu === 20, 'Balanced, hot: every 5 s, and the newest frame is still applied (' + r.paints + ', cpu ' + r.cpu + ')');
  }
  // 6. Hidden tab: not opened while hidden; an open stream is told hidden / visible once each, and a 404 reopens.
  {
    const e = make(); e.set({ hidden: true });
    e.queue.push({ chunks: [FULL], hang: true });
    e.syncLive(); ok(!e.LS.ctl, 'hidden tab does not open the stream');
    e.set({ hidden: false }); e.syncLive(); await tick(); await tick();
    ok(e.LS.on, 'opens when shown');
    const views = () => e.calls.fetch.filter((c) => c.url === '/api/live/view').map((c) => JSON.parse(c.opt.body));
    e.syncLive(); ok(views().length === 0, 'visible and already told: nothing sent');
    e.set({ hidden: true }); e.syncLive(); e.syncLive(); await tick();
    ok(views().length === 1 && views()[0].visible === false && views()[0].id === 'abcdef012345', 'hidden is sent once: ' + JSON.stringify(views()));
    ok(e.calls.fetch.find((c) => c.url === '/api/live/view').opt.headers['x-token'] === 'tok', 'x-token header sent');
    e.set({ hidden: false }); e.syncLive(); await tick();
    ok(views().length === 2 && views()[1].visible === true, 'visible again is sent');
    ok(e.liveFresh(), 'trusted for a few seconds after it came back');
    e.closeLive(false);
    // the host lost the stream (404): a new one is opened
    const f = make({ viewStatus: 404 }); f.queue.push({ chunks: [FULL], hang: true }); f.queue.push({ chunks: [FULL], hang: true });
    f.syncLive(); await tick(); await tick(); f.set({ hidden: true }); f.syncLive(); await tick(); await tick();
    ok(!f.LS.ctl, '404 closes the stream'); f.set({ hidden: false }); f.syncLive(); await tick();
    ok(f.LS.ctl, 'and the next tick opens a new one');
    f.closeLive(false);
  }
  // 7. Quiet or stale stream: the old polling takes over (liveFresh false); the next frame brings it back.
  {
    const e = make(); e.queue.push({ chunks: [FULL], hang: true });
    e.openLive(); await tick(); await tick();
    ok(e.liveFresh(), 'fresh');
    e.T.now += 3000; ok(e.liveFresh(), 'still fresh after 3 s');
    e.T.now += 4000; ok(!e.liveFresh(), 'no frame for 7 s: polling takes over');
    e.handleLiveFrame(frame({ seq: 9, cpu: 7 }).trim()); ok(e.liveFresh(), 'a frame brings it back');
    e.handleLiveFrame('event: stale\ndata: {"note":"x"}'); ok(!e.liveFresh(), 'event: stale: polling takes over at once');
    e.handleLiveFrame(frame({ seq: 10, cpu: 8 }).trim()); ok(e.liveFresh(), 'and the next frame clears it');
    e.closeLive(false);
  }
  // 8. Failures back off and never spin; a refused stream does not stop the page.
  {
    const e = make(); e.queue.push({ status: 403, chunks: [] });
    await e.openLive();
    ok(!e.LS.ctl && !e.LS.on && e.LS.fails === 1 && e.LS.retryAt >= e.T.now + 5000, 'refused: retry not before 5 s');
    e.syncLive(); ok(!e.LS.ctl, 'syncLive waits for the retry time');
    e.queue.push({ chunks: [FULL] });                           // a stream that ends by itself after one frame
    e.T.now = e.LS.retryAt + 1; await e.openLive();
    ok(e.LS.fails === 0 && !e.LS.ctl, 'a stream that delivered resets the failures');
    for (let i = 0; i < 6; i++) { e.queue.push({ status: 503 }); e.T.now = e.LS.retryAt + 1; await e.openLive(); }
    ok(e.LS.retryAt - e.T.now <= 30000 && e.LS.retryAt - e.T.now >= 29000, 'back-off is capped at 30 s: ' + (e.LS.retryAt - e.T.now));
    const g = make(); g.queue.push({ chunks: ['event: end\ndata: {"reason":"session"}\n\n'] }); await g.openLive();
    ok(g.LS.retryAt >= g.T.now + 30000, 'sign-in ended: wait 30 s');
  }
  // 9. A frame split over two chunks is put together; comments and unknown events are ignored.
  {
    const e = make(); const s = FULL;
    e.queue.push({ chunks: [': connected\n\n', s.slice(0, 40), s.slice(40), 'event: weird\ndata: 1\n\n'], hang: true });
    e.openLive(); await tick(); await tick(); await tick();
    ok(e.sysPart && e.sysPart.cpu === 12.5, 'split frame assembled');
    e.closeLive(false);
  }
  // 10. The stream's values go over a slow read and the stamp helper is fresh only with data.
  {
    const e = make(); ok(!e.liveFresh(), 'nothing connected: not fresh');
    const o = e.liveSys({ bat: 50, zones: [], errs: [] }); ok(o.bat === 50 && o.cpu === undefined, 'with no stream values the slow values stay');
  }
  if (bad) { console.error(bad + ' live stream test(s) failed'); process.exit(1); }
  console.log('live stream tests passed');
})();

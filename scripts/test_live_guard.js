// Live Status polling guard (plan phase 5). Cuts the REAL collectFast + constants out of index.html and runs them against a fake api():
// 4 s deadline per request, last values kept (stale) when a read fails, dropped after 60 s so the fallback takes over,
// light key list while failing, full list again after the first success.
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/assets/web/index.html'), 'utf8');
const a = html.indexOf('const zteOk = '), b = html.indexOf('  // SLOW: the root shell call');
if (a < 0 || b < a) { console.error('FAIL live fast-loop block not found'); process.exit(1); }
let slice = html.slice(a, b);
let bad = 0; const ok = (c, n) => { if (!c) { bad++; console.error('FAIL', n); } };
ok(/FAST_TIMEOUT_MS = 4000/.test(slice) && /STALE_KEEP_MS = 60000/.test(slice) && /STALE_MARK_S = 12/.test(slice), 'plan values: 4 s deadline, keep 60 s, mark stale at 12 s');
slice = slice.replace('FAST_TIMEOUT_MS = 4000', 'FAST_TIMEOUT_MS = 60');   // same code, short deadline so the test is quick
const seen = [];   // cmd lists sent to the router
let mode = 'ok';   // ok | fail | hang
const api = (p, opt) => new Promise((res, rej) => {
  seen.push(JSON.parse(opt.body).params.cmd);
  if (mode === 'ok') return res({ data: { network_type: '5G', signalbar: '4', Z5g_rsrp: '-100', realtime_rx_thrpt: '10', realtime_tx_thrpt: '5' } });
  if (mode === 'fail') return rej(new Error('Cannot reach MatchiTOOL host'));
  opt.signal.addEventListener('abort', () => rej(new Error('Cannot reach MatchiTOOL host')));   // hang: only the deadline ends it
});
const code = `let zteData = {}, zteNote = '', failF = 0, fastTried = false, lastOk = 0; const hist = [];
  const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
  const num = (v) => { const n = Number(v); return has(v) && Number.isFinite(n) ? n : undefined; };
  const KEYS = ['network_type', 'signalbar', 'lte_rsrp', 'Z5g_rsrp', 'realtime_rx_thrpt', 'realtime_tx_thrpt', 'nr5g_pci'];
  const build = () => ({ ok: true }); let last = null;
  ${slice}
  return { collectFast, st: () => ({ zteData, zteNote, failF, lastOk }), setOk: (t) => { lastOk = t; } };`;
const E = vm.runInNewContext('(function(api, AbortController, setTimeout, clearTimeout){' + code + '})', {})(api, AbortController, setTimeout, clearTimeout);
(async () => {
  let r = await E.collectFast(); E.setOk(Date.now());
  ok(r === true && E.st().failF === 0 && E.st().zteData.network_type === '5G', 'good read stores the values');
  ok(seen[0].split(',').length === 7, 'full key list while healthy');
  // failed read: values stay, failF counts, light list next time
  mode = 'fail'; r = await E.collectFast();
  ok(r === false && E.st().failF === 1 && E.st().zteData.network_type === '5G' && E.st().zteNote === '', 'failed read keeps the last values (stale), no fallback note yet');
  mode = 'ok'; seen.length = 0; r = await E.collectFast();
  ok(r === true && seen[0] === 'network_type,signalbar,lte_rsrp,Z5g_rsrp', 'after a failure only the signal keys are asked for');
  ok(E.st().failF === 0 && E.st().zteData.nr5g_pci === undefined && E.st().zteData.network_type === '5G', 'success resets the failure count and merges onto the old values');
  mode = 'ok'; seen.length = 0; await E.collectFast(); ok(seen[0].split(',').length === 7, 'full key list again after the first success');
  // a request that never answers is ended by the deadline
  mode = 'hang'; E.setOk(Date.now()); const t0 = Date.now(); r = await E.collectFast();
  ok(r === false && Date.now() - t0 < 1500 && E.st().failF === 1 && E.st().zteData.network_type === '5G', 'hung request ends at the deadline and keeps the values');
  // values older than 60 s are dropped so the fallback takes over
  mode = 'fail'; E.setOk(Date.now() - 61000); r = await E.collectFast();
  ok(r === false && !E.st().zteData.network_type && /unreachable/.test(E.st().zteNote), 'older than 60 s: values dropped, fallback note set');
  // never read at all: nothing to keep
  E.setOk(0); r = await E.collectFast(); ok(r === false && !E.st().zteData.network_type, 'never read: nothing kept');
  if (bad) process.exit(1); console.log('live guard tests passed');
})().catch((e) => { console.error(e); process.exit(1); });

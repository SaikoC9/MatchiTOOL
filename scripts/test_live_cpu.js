// Live Status CPU % (UFI-TOOLS method). Cuts the real parseSys() out of index.html and feeds it root-shell output with known numbers.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/assets/web/index.html'), 'utf8');
const a = html.indexOf('function parseSys(sh, errs) {'), b = html.indexOf('\n  }\n', a);
if (a < 0 || b < 0) { console.error('FAIL parseSys not found'); process.exit(1); }
const grabM = html.match(/const grab = [^\n]*/);
if (!grabM) { console.error('FAIL grab() not found'); process.exit(1); }
const make = () => new Function(grabM[0] + '\nlet prevCpu = null, lastCpu;\n' + html.slice(a, b + 4) + '\nreturn parseSys;')();
let bad = 0;
const ok = (c, n) => { if (!c) { bad++; console.error('FAIL', n); } };
const sys = (A, B, extra = '') => 'BATTERY\nlevel: 50\ntemperature: 300\nstatus: 3\nTHERMAL\nSYS\n' + A + B + extra + 'load: 0.1 0.1 0.1\nup: 100.5\nmem: 4000000 2000000\n';

// 1. 8 cores, busy 3 of 800 ticks on cpu (0.375 % -> 0.4), idle + iowait counted as idle, guest columns ignored
{
  const A = 'Acpu  1000 0 500 80000 100 0 0 0 99 99\nAcpu0 125 0 62 10000 12 0 0 0 0 0\nAcpu1 125 0 62 10000 12 0 0 0 0 0\n';
  const B = 'Bcpu  1001 0 502 80797 100 0 0 0 99 99\nBcpu0 126 0 63 10097 12 0 0 0 0 0\nBcpu1 125 0 62 10100 12 0 0 0 0 0\n';
  const r = make()(sys(A, B), []);
  ok(r.cpu === 0.4, 'quiet phone: 3 busy of 800 ticks = 0.4 % (got ' + r.cpu + ')');
  ok(r.cores.length === 2 && r.cores[0].id === 0 && r.cores[0].pct === 2 && r.cores[1].pct === 0, 'per core values ' + JSON.stringify(r.cores));
}
// 2. one decimal, never a whole-number floor: 1 busy tick of 1000 = 0.1 %
{
  const r = make()(sys('Acpu  0 0 0 0 0 0 0 0\n', 'Bcpu  1 0 0 999 0 0 0 0\n'), []);
  ok(r.cpu === 0.1, '1 of 1000 ticks = 0.1 % (got ' + r.cpu + ')');
}
// 3. fully busy and fully idle
{
  ok(make()(sys('Acpu  0 0 0 0 0 0 0 0\n', 'Bcpu  800 0 0 0 0 0 0 0\n'), []).cpu === 100, 'all busy = 100');
  ok(make()(sys('Acpu  0 0 0 0 0 0 0 0\n', 'Bcpu  0 0 0 800 0 0 0 0\n'), []).cpu === 0, 'all idle = 0');
}
// 4. no counter movement: no number (the card keeps the last one), never NaN
{
  const r = make()(sys('Acpu  5 0 5 90 0 0 0 0\n', 'Bcpu  5 0 5 90 0 0 0 0\n'), []);
  ok(r.cpu === undefined, 'no movement gives no value (got ' + r.cpu + ')');
}
// 5. old output form (cpu0: / cpu:) still works as a fallback
{
  const old = 'cpu0: cpu 100 0 100 800 0 0 0 0\ncpu: cpu 110 0 110 880 0 0 0 0\n';
  const r = make()(sys('', '', old), []);
  ok(r.cpu === 20, 'old form: 20 busy of 100 = 20 (got ' + r.cpu + ')');
}
if (bad) { console.error(bad + ' live cpu check(s) failed'); process.exit(1); }
console.log('live cpu tests passed');

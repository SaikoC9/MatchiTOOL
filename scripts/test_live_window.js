// Live Status usage window: feeds the real parseSys() + windowed() from index.html fake /proc/stat counters with known numbers and a fake clock.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/assets/web/index.html'), 'utf8');
const a = html.indexOf('const cpuHist = [];'), b = html.indexOf('\n  }\n', html.indexOf('function parseSys(sh, errs) {'));
const grabM = html.match(/const grab = [^\n]*/);
if (a < 0 || b < 0 || !grabM) { console.error('FAIL cpuHist / parseSys / grab not found'); process.exit(1); }
const make = () => new Function(grabM[0] + '\nlet prevCpu = null, lastCpu;\n' + html.slice(a, b + 4) + '\nreturn { parseSys, windowed };')();
let bad = 0;
const ok = (c, n) => { if (!c) { bad++; console.error('FAIL', n); } };
const sys = (A, B) => 'BATTERY\nlevel: 50\ntemperature: 300\nstatus: 3\nTHERMAL\nSYS\n' + A + B + 'load: 0.1 0.1 0.1\nup: 100.5\nmem: 4000000 2000000\n';
const rows = (tag, c) => (tag + 'cpu  ' + (c[0][0] + c[1][0]) + ' 0 0 ' + (c[0][1] + c[1][1]) + ' 0 0 0 0\n' + tag + 'cpu0 ' + c[0][0] + ' 0 0 ' + c[0][1] + ' 0 0 0 0\n' + tag + 'cpu1 ' + c[1][0] + ' 0 0 ' + c[1][1] + ' 0 0 0 0\n');
// A is 50 ticks (0.5 s) before B on every core, 10 of them busy: only the B counters feed the window, A just makes the plain 0.5 s reading exist
const out = (c) => sys(rows('A', c.map((x) => [Math.max(0, x[0] - 10), Math.max(0, x[1] - 40)])), rows('B', c));
{
  const { parseSys, windowed } = make();
  // core 0: 1 tick busy per 100 ticks = 1 %; core 1: 50 % busy. Reads every 1 s (100 ticks), fake clock.
  let t = 1000000, c = [[0, 0], [0, 0]];
  const step = () => { c = [[c[0][0] + 1, c[0][1] + 99], [c[1][0] + 50, c[1][1] + 50]]; t += 1000; return windowed(parseSys(out(c), []), t); };
  let p = step();   // first read: no history, the plain reading stays
  ok(p.cores.length === 2, 'first read keeps cores');
  p = step(); ok(p.cores[0].pct !== undefined, 'second read (1 s old base is too young) keeps the plain reading');
  p = step();   // newest sample at least 2 s older exists -> 200 ticks per core
  ok(p.cores[0].pct === 1 && p.cores[1].pct === 50, 'windowed per core ' + JSON.stringify(p.cores));
  ok(p.cpu === 25.5, 'overall equals the weighted mean of the cores: ' + p.cpu);
  // a short spike inside the window is counted by the window (the 0.5 s read alone could miss it)
  c = [[c[0][0] + 40, c[0][1] + 60], [c[1][0], c[1][1] + 100]]; t += 1000; p = windowed(parseSys(out(c), []), t);
  ok(p.cores[0].pct === 20.5, 'spike counted over the 2 s window (41 busy of 200 ticks): ' + p.cores[0].pct);
  // counters going backwards (restart): the plain reading is kept, nothing crashes
  c = [[5, 5], [5, 5]]; t += 1000; p = windowed(parseSys(out(c), []), t);
  ok(p && typeof p.cpu === 'number', 'counter reset keeps the plain reading');
  // history older than 20 s is dropped: a long pause falls back to the plain reading
  c = [[c[0][0] + 5, c[0][1] + 5], [c[1][0] + 5, c[1][1] + 5]]; t += 60000; const q = parseSys(out(c), []); p = windowed(q, t);
  ok(p.cpu === q.cpu, 'after a long pause the plain reading is used');
  // no counters at all: returns the input untouched
  ok(windowed({ cpu: 3, cores: [], raw: {} }, t).cpu === 3 && windowed(null) === null, 'no raw counters');
}
if (bad) { console.error(bad + ' failure(s)'); process.exit(1); }
console.log('live window tests passed');

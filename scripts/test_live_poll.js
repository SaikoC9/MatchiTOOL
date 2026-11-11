// Live Status polling intervals (plan Phase 6). Cuts the REAL interval code out of index.html (DELAY table, modes, heat level,
// battery pause, fast/slow back-off) and runs it with controlled state, so a change to the page code is what gets tested.
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/assets/web/index.html'), 'utf8');
const a = html.indexOf('const DELAY = {'), b = html.indexOf('// Automatic refresh switch');
if (a < 0 || b < 0 || b < a) { console.error('FAIL live interval block not found in index.html'); process.exit(1); }
const slice = html.slice(a, b);
let bad = 0;
const ok = (c, n) => { if (!c) { bad++; console.error('FAIL', n); } };

// Fresh copy of the code per case. localStorage is fake; state is set through the returned setter.
function make(store) {
  const code = 'let last = null, failF = 0, failS = 0;\n' + slice + `
    return { fastDelay, slowDelay, batLow, set(o) { if ('last' in o) last = o.last; if ('failF' in o) failF = o.failF; if ('failS' in o) failS = o.failS; if ('mode' in o) mode = o.mode; if ('batPause' in o) batPause = o.batPause; } };`;
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem() {}, removeItem() {} };
  return vm.runInNewContext('(function(localStorage){' + code + '})', {})(ls);
}
const at = (o, store = {}) => { const e = make(store); e.set(o); return [e.fastDelay(), e.slowDelay()]; };
const eq = (got, want, n) => ok(got[0] === want[0] && got[1] === want[1], n + ' (got ' + got + ', want ' + want + ')');
const heat = (l) => ({ last: { thermalLevel: l } });

// Modes while the phone is cool: the speeds from the plan
eq(at({}), [3000, 15000], 'normal, cool');
eq(at({ mode: 'fast' }), [0, 1000], 'fast, cool');
eq(at({ mode: 'eco' }), [9000, 45000], 'eco, cool');

// Heat table: warm and hot slow both loops down; level 3 (critical) is treated as hot
eq(at(heat(1)), [6000, 30000], 'normal, warm');
eq(at(heat(2)), [15000, 90000], 'normal, hot');
eq(at(heat(3)), [15000, 90000], 'normal, critical = hot');

// Fast mode must never push a warm or hot phone harder than the heat table allows
eq(at({ mode: 'fast', ...heat(1) }), [6000, 30000], 'fast on warm phone = heat table');
eq(at({ mode: 'fast', ...heat(2) }), [15000, 90000], 'fast on hot phone = heat table');
// Eco is kept when warm or hot, and the heat table still wins when it is slower
eq(at({ mode: 'eco', ...heat(1) }), [9000, 45000], 'eco, warm');
eq(at({ mode: 'eco', ...heat(2) }), [15000, 90000], 'eco, hot');

// The hot slow loop is slowed, never stopped
ok(isFinite(at(heat(2))[1]) && at(heat(2))[1] <= 90000, 'slow loop still runs when hot');

// Back-off: the router loop goes 3 / 6 / 12 / 24 / 30 s (capped at 30), the root loop 15 / 30 / 60 s; never faster than the heat delay
eq(at({ failF: 1, failS: 1 }), [3000, 15000], 'back-off step 1');
eq(at({ failF: 2, failS: 2 }), [6000, 30000], 'back-off step 2');
eq(at({ failF: 3, failS: 3 }), [12000, 60000], 'back-off step 3');
eq(at({ failF: 4, failS: 4 }), [24000, 60000], 'back-off step 4');
eq(at({ failF: 5, failS: 4 }), [30000, 60000], 'router back-off capped at 30 s');
eq(at({ failF: 50, failS: 50 }), [30000, 60000], 'back-off stays capped');
eq(at({ failF: 1, failS: 1, ...heat(2) }), [15000, 90000], 'back-off never faster than hot delay');

// Battery pause: below the level and not charging only; the root loop then checks once a minute, not faster
const bp = (last, batPause) => at({ batPause, last });
eq(bp({ bat: 15, charging: false }, 20), [3000, 60000], 'battery 15 % below 20 %: root loop 60 s');
eq(bp({ bat: 15, charging: true }, 20), [3000, 15000], 'charging: no pause');
eq(bp({ bat: 25, charging: false }, 20), [3000, 15000], 'battery above level: no pause');
eq(bp({ bat: 15, charging: false }, 0), [3000, 15000], 'pause Off by default');
eq(bp({ charging: false }, 20), [3000, 15000], 'battery unknown: no pause');
{ const e = make({}); e.set({ batPause: 20, last: { bat: 15, charging: false } }); ok(e.batLow() === true, 'batLow true below level');
  e.set({ last: { bat: 15, charging: true } }); ok(e.batLow() === false, 'batLow false while charging'); }

// Saved choices (liv_mode, liv_batpause) are read; junk is ignored; liv_thermal_test forces a level
eq(at({}, { liv_mode: 'eco' }), [9000, 45000], 'saved mode eco');
eq(at({}, { liv_mode: 'turbo' }), [3000, 15000], 'unknown saved mode ignored');
eq(at({}, { liv_thermal_test: '2' }), [15000, 90000], 'liv_thermal_test=2 forces hot');
eq(at({}, { liv_thermal_test: '9' }), [3000, 15000], 'liv_thermal_test junk ignored');
{ const e = make({ liv_batpause: '20' }); e.set({ last: { bat: 5, charging: false } }); ok(e.batLow(), 'saved battery pause 20 read'); }
{ const e = make({ liv_batpause: '17' }); e.set({ last: { bat: 5, charging: false } }); ok(!e.batLow(), 'saved battery pause 17 (not a choice) ignored'); }

// The constants themselves, so the plan table cannot drift unnoticed
ok(/DELAY = \{ fast: \[3000, 6000, 15000\], slow: \[15000, 30000, 90000\] \}/.test(slice), 'DELAY table text');
ok(/eco: \{ fast: 9000, slow: 45000 \}/.test(slice), 'eco speeds text');

if (bad) { console.error(bad + ' live poll check(s) failed'); process.exit(1); }
console.log('live poll interval tests passed');

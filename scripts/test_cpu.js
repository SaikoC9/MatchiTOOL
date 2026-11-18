// cpu-core.js (CPU usage / speed / mode logic). No device: the real file is run on sample output of the probe script.
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../app/src/main/web-src/cpu-core.js', 'utf8');
const win = {}; new Function('window', src)(win);
const C = win.MatchiCpu; assert(C, 'window.MatchiCpu is not defined');

// 8 cores, two clusters, cores 4-7 offline (no /proc/stat line for them).
const probe = (t) => [
  'N|0-7',
  ...[0, 1, 2, 3].map((i) => `O|${i}|1`), ...[4, 5, 6, 7].map((i) => `O|${i}|0`),
  'P|0|0 1 2 3|614400|614400|2002000|schedutil||schedutil userspace powersave performance|614400 768000 936000 2002000',
  'P|4|4 5 6 7|0|768000|2301000|userspace|1228800|schedutil userspace performance|768000 1228800 2301000',
  `T|all|${t.all}`, `T|0|${t.c0}`, `T|1|${t.c1}`, `T|2|100 0 100 800 0 0 0 0`, `T|3|100 0 100 800 0 0 0 0`,
  'B|0',
].join('\n');

const p1 = C.parseProbe(probe({ all: '1000 0 1000 8000 0 0 0 0', c0: '1000 0 0 9000 0 0 0 0', c1: '0 0 0 10000 0 0 0 0' }));
assert.strictEqual(p1.cores.length, 8);
assert.strictEqual(p1.clusters.length, 2);
assert.deepStrictEqual(p1.clusters[1].cpus, [4, 5, 6, 7]);
assert.strictEqual(p1.cores[0].curKhz, 614400);
assert.strictEqual(p1.cores[5].online, false);
assert.strictEqual(p1.cores[5].curKhz, 0, 'an offline core shows 0 MHz');
assert.strictEqual(p1.cores[5].ticks, null);
assert.strictEqual(p1.boot, false);
assert.deepStrictEqual(C.cpuList('0-3,6'), [0, 1, 2, 3, 6]);
assert.deepStrictEqual(C.cpuList('0 1 2 3'), [0, 1, 2, 3]);
assert.deepStrictEqual(C.cpuList('5-2,abc'), []);

// names
assert.strictEqual(C.clusterName(p1.clusters[0], p1.clusters), 'Little');
assert.strictEqual(C.clusterName(p1.clusters[1], p1.clusters), 'Big');
assert.strictEqual(C.clusterName(p1.clusters[0], [p1.clusters[0]]), 'All cores');
assert.strictEqual(C.modeName('schedutil'), 'Auto');
assert.strictEqual(C.modeName('some_new_gov'), 'some new gov');

// meter: first read gives nothing, second gives the busy share
const m = C.makeMeter();
let r = m.feed(p1, 0);
assert.deepStrictEqual(r.cores, {});
const p2 = C.parseProbe(probe({ all: '1500 0 1500 11000 0 0 0 0', c0: '1500 0 0 9000 0 0 0 0', c1: '0 0 0 10500 0 0 0 0' }));
r = m.feed(p2, 1000);
assert.strictEqual(r.cores[0], 100, 'core 0: 500 busy of 500');
assert.strictEqual(r.cores[1], 0);
assert.strictEqual(r.all, 25, 'all: 1000 busy of 4000');
assert.strictEqual(r.cores[5], undefined, 'offline core has no number');
// too short a window keeps the last value
const p3 = C.parseProbe(probe({ all: '1500 0 1500 11001 0 0 0 0', c0: '1500 0 0 9001 0 0 0 0', c1: '0 0 0 10501 0 0 0 0' }));
assert.strictEqual(m.feed(p3, 1200).cores[0], 100);
// counter going backwards restarts, no negative or >100 number
const p4 = C.parseProbe(probe({ all: '1 0 1 10 0 0 0 0', c0: '1 0 0 10 0 0 0 0', c1: '0 0 0 10 0 0 0 0' }));
const r4 = m.feed(p4, 5000);
assert(Object.values(r4.cores).every((v) => v >= 0 && v <= 100));

// scripts
const little = p1.clusters[0], big = p1.clusters[1];
assert.match(C.modeScript(little, 'powersave'), /policy0\/scaling_governor/);
assert.throws(() => C.modeScript(little, 'conservative'), /not offered/);
assert.throws(() => C.modeScript(little, 'x; reboot'), /not offered/);
assert.match(C.lockScript(big, 1228800), /echo 1228800 > \$d\/scaling_setspeed/);
assert.throws(() => C.lockScript(big, 1234567), /not offered/);
assert.throws(() => C.lockScript(big, '1228800'), /bad speed/);
assert.throws(() => C.modeScript({ ...little, policy: '0; rm -rf /' }, 'schedutil'), /bad cluster/);
assert.match(C.coreScript(5, false), /cpu5\/online/);
assert.throws(() => C.coreScript(0, false), /core 0/);
assert.throws(() => C.coreScript(5.5, true), /bad core/);

// boot file: cores, then modes, then locked speed (only for a cluster in the locked mode)
const b = C.bootFile(p1);
assert(b.startsWith('#!/system/bin/sh'));
assert(b.indexOf('cpu5/online') < b.indexOf('scaling_governor'));
assert(b.indexOf('scaling_governor') < b.indexOf('scaling_setspeed'));
assert(/policy4\/scaling_setspeed/.test(b) && !/policy0\/scaling_setspeed/.test(b));
assert.match(C.saveBootScript(b), /MATCHI_CPU_EOF/);
assert.throws(() => C.saveBootScript('x\nMATCHI_CPU_EOF\nreboot'), /bad boot text/);
assert.match(C.removeBootScript(), /rm -f/);
assert.match(C.probeScript(), /related_cpus/);

console.log('cpu-core: all checks passed');

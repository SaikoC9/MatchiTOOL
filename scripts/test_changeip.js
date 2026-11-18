// changeip-core.js (Change IP logic). No device: the real file is run, and the shell scripts are run in a real sh with fake svc / ip / curl.
const fs = require('fs'), assert = require('assert'), os = require('os'), path = require('path'), cp = require('child_process');
const src = fs.readFileSync(__dirname + '/../app/src/main/web-src/changeip-core.js', 'utf8');
const win = {}; new Function('window', src)(win);
const C = win.MatchiChangeIp; assert(C, 'window.MatchiChangeIp is not defined');

assert.strictEqual(C.ipOf('203.0.113.7\n'), '203.0.113.7');
assert.strictEqual(C.ipOf('x\n  10.20.30.40  \ny'), '10.20.30.40');
for (const bad of ['', null, undefined, '<html>502 Bad Gateway</html>', '256.1.1.1', '1.2.3', '1.2.3.4.5', '1.2.3.4 extra', 'curl: (6) Could not resolve host']) assert.strictEqual(C.ipOf(bad), '', String(bad));
assert(C.cycleOk('x\nENABLED|1\n') && !C.cycleOk('ENABLED|0') && !C.cycleOk('') && !C.cycleOk('svc: not found'));
assert.strictEqual(C.verdict('1.1.1.1', '2.2.2.2').kind, 'changed');
assert.strictEqual(C.verdict('1.1.1.1', '1.1.1.1').kind, 'same');
assert.strictEqual(C.verdict('', '2.2.2.2').kind, 'new');
assert.strictEqual(C.verdict('1.1.1.1', '').kind, 'unknown');

// Run the scripts in a real sh with fake commands.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chip-'));
const write = (n, body) => { fs.writeFileSync(path.join(dir, n), '#!/bin/sh\n' + body + '\n', { mode: 0o755 }); };
const state = path.join(dir, 'state');
function run(script, env) {
  return cp.spawnSync('sh', ['-c', script], { env: Object.assign({ PATH: dir + ':' + process.env.PATH, STATE: state }, env), encoding: 'utf8', timeout: 30000 });
}
// fake `ip`: prints a route line only while data is "on"
write('ip', 'if [ "$(cat $STATE 2>/dev/null)" = off ]; then exit 0; fi; echo "1.1.1.1 via 10.64.1.1 dev rmnet0 src 10.64.1.2 uid 0"');
write('sleep', 'exit 0');    // keep the test fast
// 1. normal: data off -> link down at once -> enabled
write('svc', 'echo "$2" >> $STATE.log; [ "$2" = disable ] && echo off > $STATE; [ "$2" = enable ] && echo on > $STATE; exit 0');
fs.writeFileSync(state, 'on');
let r = run(C.cycleScript());
assert(C.cycleOk(r.stdout), r.stdout + r.stderr);
assert.deepStrictEqual(fs.readFileSync(state + '.log', 'utf8').trim().split('\n'), ['disable', 'enable']);
// 2. enable fails twice, works the third time: three tries, still ends on
fs.unlinkSync(state + '.log');
write('svc', 'echo "$2" >> $STATE.log; if [ "$2" = disable ]; then echo off > $STATE; exit 0; fi; n=$(grep -c enable $STATE.log); [ "$n" -ge 3 ] && echo on > $STATE && exit 0; exit 1');
r = run(C.cycleScript());
assert(C.cycleOk(r.stdout), r.stdout);
assert.strictEqual(fs.readFileSync(state + '.log', 'utf8').trim().split('\n').filter((x) => x === 'enable').length, 3);
// 3. enable never works: reported as not enabled (the page then retries and warns)
fs.unlinkSync(state + '.log');
write('svc', 'echo "$2" >> $STATE.log; [ "$2" = disable ] && echo off > $STATE; [ "$2" = enable ] && exit 1; exit 0');
r = run(C.cycleScript());
assert(!C.cycleOk(r.stdout) && /ENABLED\|0/.test(r.stdout), r.stdout);
// 4. a link that never goes down does not hang the script (8 checks at most), and it still turns data back on
fs.unlinkSync(state + '.log');
write('ip', 'echo "1.1.1.1 via 10.64.1.1 dev rmnet0 src 10.64.1.2 uid 0"');
write('svc', 'echo "$2" >> $STATE.log; exit 0');
r = run(C.cycleScript()); assert(C.cycleOk(r.stdout));

// localScript reads the source address; publicScript: first service answers, a bad answer falls through to the next service, nothing -> exit 1
write('ip', 'echo "1.1.1.1 via 10.64.1.1 dev rmnet0 src 10.64.1.2 uid 0"');
assert.strictEqual(C.ipOf(run(C.localScript()).stdout), '10.64.1.2');
const noCurl = { PATH: dir + ':/usr/bin:/bin' };
write('curl', 'for a; do case "$a" in https://checkip*) echo "<html>blocked</html>";; https://api.ipify*) echo 198.51.100.9;; esac; done');
r = run(C.publicScript(false), noCurl); assert.strictEqual(C.ipOf(r.stdout), '198.51.100.9', r.stdout + r.stderr);
write('curl', 'exit 7');
for (const w of ['wget', 'busybox', 'toybox']) write(w, 'exit 1');
r = run(C.publicScript(false), noCurl); assert.strictEqual(r.status, 1);
write('curl', 'for a; do case "$a" in https://checkip*) echo 203.0.113.5;; esac; done');
r = run(C.publicScript(true), noCurl); assert.strictEqual(C.ipOf(r.stdout), '203.0.113.5');
fs.rmSync(dir, { recursive: true, force: true });
console.log('changeip-core tests passed');

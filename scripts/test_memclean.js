// memclean-core.js (Memory Cleaner logic). No device: the real file is run on sample output of the scan script.
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../app/src/main/web-src/memclean-core.js', 'utf8');
const win = {}; new Function('window', src)(win);
const M = win.MatchiMemClean; assert(M, 'window.MatchiMemClean is not defined');

const sample = [
  'MEM|3801088|1203200|2097152|1500000',
  'TOP|  ACTIVITY com.example.browser/.Main 1a2b pid=4321',
  'FOCUS|  mCurrentFocus=Window{abc u0 com.example.browser/com.example.browser.Main}',
  'HOME|com.android.launcher3/.Launcher',
  'IME|com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME',
  'PS|120000|com.example.browser', 'PS|80000|com.example.browser:sandbox',
  'PS|90000|com.example.chat', 'PS|45000|com.example.chat:push',
  'PS|30000|com.matchi.tool', 'PS|70000|org.easytier.app', 'PS|65000|com.keyboard.fancy',
  'PS|20000|com.example.notrunning_but_listed_no', 'PS|5000|[kworker/0:1]', 'PS|9000|system_server', 'PS|15000|com.android.settings',
  'PS|50000|com.example.game', 'PS|4000|com.example.small',
  'USR|com.example.browser', 'USR|com.example.chat', 'USR|com.matchi.tool', 'USR|org.easytier.app',
  'USR|com.example.game', 'USR|com.example.small', 'USR|com.example.idle', 'USR|com.example.game',
].join('\n');

const s = M.parseScan(sample);
assert.deepStrictEqual(s.mem, { totalKb: 3801088, availKb: 1203200, swapTotalKb: 2097152, swapFreeKb: 1500000 });
assert.strictEqual(s.top, 'com.example.browser');
assert.strictEqual(s.home, 'com.android.launcher3');
assert.strictEqual(s.ime, 'com.google.android.inputmethod.latin');
assert.strictEqual(s.running.get('com.example.browser'), 200000, 'process ":sandbox" counts for its package');
assert.strictEqual(s.running.get('com.example.chat'), 135000);
assert(!s.running.has('[kworker/0:1]') && !s.running.has('system_server'), 'only package-shaped names');
assert.strictEqual(s.user.filter((p) => p === 'com.example.game').length, 1, 'no duplicates');

// What may be offered: user-installed AND running AND not protected; biggest first.
assert.deepStrictEqual(M.candidates(s), [
  { pkg: 'com.example.chat', kb: 135000 },
  { pkg: 'com.example.game', kb: 50000 },
  { pkg: 'com.example.small', kb: 4000 },
]);
// Never: the app on screen, this app, tunnel apps, a system package that is not user-installed, an app that is not running.
for (const p of ['com.example.browser', 'com.matchi.tool', 'org.easytier.app', 'com.android.settings', 'com.example.idle']) assert(!M.candidates(s).some((c) => c.pkg === p), p);
// The keyboard and launcher are skipped even when user-installed (a third-party launcher / keyboard).
const s2 = M.parseScan(sample + '\nUSR|com.android.launcher3\nPS|1000|com.android.launcher3\nUSR|com.google.android.inputmethod.latin\nPS|1000|com.google.android.inputmethod.latin');
assert(!M.candidates(s2).some((c) => /launcher3|inputmethod/.test(c.pkg)));
assert(M.isProtected('com.matchi.tool', s) && M.isProtected('com.wireguard.android', s) && M.isProtected('x', s), 'bad names count as protected');
assert(!M.isProtected('com.example.chat', s));

// Focus fallback when `dumpsys activity top` printed nothing.
assert.strictEqual(M.topPkg('', '  mCurrentFocus=Window{abc u0 com.foo.bar/com.foo.bar.Main}'), 'com.foo.bar');
assert.strictEqual(M.topPkg('', ''), '');
assert.strictEqual(M.pkgOf('null'), ''); assert.strictEqual(M.pkgOf(''), '');
assert.strictEqual(M.pkgOf('ComponentInfo{com.a.b/com.a.b.X}'), 'com.a.b');

// Broken or empty output: no memory numbers -> parseScan gives mem null (the tool shows an error, stops nothing).
assert.strictEqual(M.parseScan('').mem, null);
assert.strictEqual(M.parseScan('MEM|0|0|0|0').mem, null);
assert.strictEqual(M.parseScan('Permission denied').mem, null);

// stopScript: only valid package names, quoted; an injection attempt is dropped; this app is never in it.
const bad = ["com.x.y'; reboot; '", 'com.x y', '$(reboot)', 'nodots', '', 'com.matchi.tool'];
const sc = M.stopScript(['com.example.chat', 'com.example.chat', ...bad], { release: true });
assert.strictEqual((sc.match(/am force-stop/g) || []).length, 1);
assert(sc.includes("am force-stop 'com.example.chat'"));
assert(!/reboot|nodots|matchi/.test(sc));
assert(/drop_caches/.test(sc) && /compact_memory/.test(sc));
assert(!/swappiness|zram|writeback|kill-all/.test(sc), 'no lasting system setting is changed');
assert(!/drop_caches/.test(M.stopScript(['com.example.chat'], { release: false })));
assert(M.stopScript([], { release: false }).includes('AFTER|'));

const res = M.parseResult('BEFORE|1000000\nSTOPPED|3\nAFTER|1300000\n');
assert.deepStrictEqual(res, { beforeKb: 1000000, afterKb: 1300000, stopped: 3, ok: true });
assert.strictEqual(M.parseResult('BEFORE|1000000\nSTOPPED|3').ok, false, 'no AFTER line = not ok');
assert.strictEqual(M.parseResult('').ok, false);
assert.strictEqual(M.fmtKb(512), '512 KB'); assert.strictEqual(M.fmtKb(2048), '2 MB'); assert.strictEqual(M.fmtKb(1572864), '1.50 GB');
console.log('memclean-core tests passed');

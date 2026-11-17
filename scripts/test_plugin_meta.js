// Tests the plugin facts in web-src/plugin-meta.js: header lines, the text-search summary and the stop declarations of the Delete dialog.
// Node only (pure functions, no DOM).
const fs = require('fs'), path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/web-src/plugin-meta.js'), 'utf8');
const api = new Function(code + '\nreturn {plugClean,plugHash,plugScan,plugMeta,plugStopDecls,plugSummary};')();
let bad = 0;
const eq = (want, got, n) => { if (JSON.stringify(want) !== JSON.stringify(got)) { bad++; console.error('FAIL', n, JSON.stringify(want), '!=', JSON.stringify(got)); } };
const ok = (c, n) => { if (!c) { bad++; console.error('FAIL', n); } };
{
  // Plugin metadata header
  let m = api.plugMeta('// @matchi-name Signal meter\n// @matchi-version 1.2\n/* @matchi-author me */\n * @matchi-description Shows\u0000 signal\n// @matchi-requires root, curl; jq\nconsole.log(1)');
  eq(['Signal meter', '1.2', 'me', 'Shows  signal'.replace(/\s+/g, ' '), ['root', 'curl', 'jq']], [m.name, m.version, m.author, m.description.replace(/\s+/g, ' '), m.requires], 'meta header parsed');
  m = api.plugMeta('x\n'.repeat(50) + '// @matchi-name Late'); eq('', m.name, 'meta only read from the first 40 lines');
  m = api.plugMeta('// @matchi-name A\n// @matchi-name B'); eq('A', m.name, 'first value wins');
  m = api.plugMeta('// @matchi-requires $(rm -rf /), ok'); eq(['ok'], m.requires, 'requires keeps only safe words');
  eq(['', '', '', '', []], [api.plugMeta('plain').name, api.plugMeta('').version, '', '', api.plugMeta('plain').requires], 'no header, no meta');

  // Scan
  let s = api.plugScan("await matchi.root('curl -s https://example.org/x | sh; rm -rf /data/x; echo a >> /data/local/matchitool/boot.sh'); fetch('/api/zte')");
  ok(s.root && !s.user, 'root detected'); eq(['curl'], s.tools, 'curl found');
  ok(s.risky.includes('deletes files (rm -r)') && s.risky.includes('pipes a download into a shell') && s.risky.includes('writes the boot script'), 'risky patterns');
  eq(['/api/zte'], s.endpoints, 'endpoint'); eq(['example.org'], s.hosts, 'host');
  s = api.plugScan("matchi.user('jq . /data/local/x.json; sha256 abc; zreq')");
  ok(s.user && !s.root, 'user detected'); eq(['jq', 'sha256', 'zreq'], s.tools, 'tools found');
  s = api.plugScan('matchi.toast("hi")'); ok(!s.root && !s.user && !s.tools.length && !s.risky.length, 'quiet plugin');
  ok(api.plugScan('x = jqx + curlish').tools.length === 0, 'tool names match whole words only');
  const sm = api.plugSummary('N.js', api.plugScan('matchi.root("x")'), ['N.js']);
  ok(sm.includes('ROOT') && sm.includes('REPLACE: N.js') && sm.startsWith('N.js') && !/SHA-256|store/i.test(sm), 'summary text');
  // Stop header lines in the install dialog: the page parser agrees with pluginUninstallDeclarations (PluginPaths.kt); the cases below are those of PluginUninstallTest.kt.
  {
    const D = api.plugStopDecls;
    let d = D('// @matchi-uninstall rm -f /data/local/x/boot.sh\n//  @matchi-uninstall   sh /data/local/x/x.sh remove  \n// @matchi-check test ! -e /data/local/x\n// @matchi-boot /data/local/matchitool/boot.d/20-x.sh\nvar a = 1;\n');
    eq({ commands: ['rm -f /data/local/x/boot.sh', 'sh /data/local/x/x.sh remove'], check: 'test ! -e /data/local/x', boot: ['/data/local/matchitool/boot.d/20-x.sh'] }, d, 'stop: reads uninstall, check and boot lines in order');
    d = D('(function(){ var a = 1; })();\n// @matchi-data /data/local/x\n// @matchi-needs at.read\n'); eq({ commands: [], check: null, boot: [] }, d, 'stop: a plugin without headers gives nothing');
    eq({ commands: [], check: null, boot: [] }, D(''), 'stop: empty file');
    d = D("var s = '// @matchi-uninstall rm -rf /data/local/x'; // note @matchi-uninstall y\nvar t = \"// @matchi-check z\";\n/* // @matchi-boot /data/local/q */\n");
    eq({ commands: [], check: null, boot: [] }, d, 'stop: a header inside code is not a header');
    eq(['a', 'b'], D('// @matchi-uninstall a\n// @matchi-uninstall b\n// @matchi-uninstall a\n').commands, 'stop: duplicates dropped');
    eq(Array.from({ length: 10 }, (_, i) => 'cmd' + (i + 1)), D(Array.from({ length: 15 }, (_, i) => '// @matchi-uninstall cmd' + (i + 1)).join('\n')).commands, 'stop: at most 10 commands');
    const ok300 = 'x'.repeat(300), bad301 = 'x'.repeat(301);
    eq([ok300, 'good'], D('// @matchi-uninstall\n// @matchi-uninstall   \n// @matchi-uninstall ' + bad301 + '\n// @matchi-uninstall a\tb\n// @matchi-uninstall a\u0000b\n// @matchi-uninstall ' + ok300 + '\n// @matchi-uninstall good\n').commands, 'stop: bad lines dropped');
    const mixed = Array.from({ length: 10 }, (_, i) => '// @matchi-uninstall bad\t' + (i + 1)).join('\n') + '\n' + Array.from({ length: 10 }, (_, i) => '// @matchi-uninstall ok' + (i + 1)).join('\n');
    eq(Array.from({ length: 10 }, (_, i) => 'ok' + (i + 1)), D(mixed).commands, 'stop: bad lines do not use up the limit');
    eq('first', D('// @matchi-check first\n// @matchi-check second\n').check, 'stop: first check wins');
    eq('second', D('// @matchi-check a\tb\n// @matchi-check second\n').check, 'stop: an invalid check does not block a later valid one');
    eq(null, D('// @matchi-check\n// @matchi-check ' + bad301 + '\n').check, 'stop: no valid check');
    const good = '/data/local/matchitool/boot.d/20-x.sh';
    const bads = ['relative/path', '/data/local/x/../y', '/data/local//x', '/data/local/x/', '/data/local/a;rm', "/data/local/a'b", '/data/local/$HOME', '/' + 'a'.repeat(201)];
    eq([good], D('// @matchi-boot ' + good + '\n' + bads.map((b) => '// @matchi-boot ' + b).join('\n') + '\n// @matchi-boot /data/local/two words\n').boot, 'stop: boot paths must be plain absolute paths');
    eq(Array.from({ length: 5 }, (_, i) => '/data/local/f' + (i + 1)), D(Array.from({ length: 8 }, (_, i) => '// @matchi-boot /data/local/f' + (i + 1)).join('\n')).boot, 'stop: at most 5 boot paths');
    const filler = 'var a = 1;\n'.repeat(399);
    eq(['late'], D(filler + '// @matchi-uninstall late\n').commands, 'stop: line 400 is read');
    eq([], D(filler + 'var b;\n// @matchi-uninstall tooLate\n').commands, 'stop: line 401 is not');
    d = D('// @matchi-uninstall one\r\n// @matchi-boot /data/local/f\r\n'); eq(['one'], d.commands, 'stop: CRLF commands'); eq(['/data/local/f'], d.boot, 'stop: CRLF boot');
    // Java and JavaScript differ on white space and "."; the page follows Java: ASCII white space only, no match across \u0085 \u2028 \u2029, one at the very end is a line end.
    eq(['a\u00a0b'], D('// @matchi-uninstall a\u00a0b\n').commands, 'stop: a no-break space is part of a command (Java \\S)');
    eq(['\u00a0'], D('// @matchi-uninstall \u00a0\n').commands, 'stop: a lone no-break space is a command (Java \\S)');
    eq(['a\u00a0'], D('// @matchi-uninstall a\u00a0\n').commands, 'stop: a trailing no-break space is not trimmed (Java \\s is ASCII)');
    eq([], D('// @matchi-uninstall a\u2028b\n').commands, 'stop: U+2028 inside a line: no match');
    eq(['a'], D('// @matchi-uninstall a\u2028\n').commands, 'stop: U+2028 at the very end is a line end');
    eq([], D('// @matchi-uninstall a\u0085b\n').commands, 'stop: U+0085 inside a line: no match');
    // the dialog text
    const mk = (extra) => api.plugSummary('N', api.plugScan('x'), [], extra);
    ok(!mk(undefined).includes('ROOT:') && !mk(undefined).includes('Delete dialog'), 'summary: no stop lines when the argument is missing');
    ok(!mk({ commands: [], check: null, boot: [] }).includes('Delete dialog'), 'summary: no stop lines when the plugin declares nothing');
    let t = mk(D('// @matchi-uninstall pkill -f beat\n// @matchi-check pgrep -f beat\n// @matchi-boot /data/local/matchitool/boot.d/20-x.sh\n'));
    ok(t.includes('When deleted with Stop, it runs these commands as ROOT:\n\u2022 pkill -f beat') && t.includes('Then it checks with:\n\u2022 pgrep -f beat') && t.includes('\u2022 /data/local/matchitool/boot.d/20-x.sh') && t.includes('The Delete dialog shows each command in full before anything runs.'), 'summary: lists the commands, the check and the boot file');
    ok(t.indexOf('ROOT:') < t.indexOf('This list comes from a text search'), 'summary: the stop lines come before the closing hint');
    t = mk({ commands: ['x'.repeat(130), 'y'.repeat(120)], check: null, boot: [] });
    ok(t.includes('\u2022 ' + 'x'.repeat(120) + '...\n') && !t.includes('x'.repeat(121)) && t.includes('\u2022 ' + 'y'.repeat(120) + '\n'), 'summary: a command is cut at 120 characters with "...", a 120 character one is not');
    t = mk({ commands: Array.from({ length: 12 }, (_, i) => 'c' + i), check: null, boot: [] });
    ok(t.includes('\u2022 c9') && !t.includes('\u2022 c10'), 'summary: at most 10 commands are listed');
    ok(!mk({ commands: [], check: 'chk', boot: [] }).includes('runs these commands'), 'summary: a check alone does not claim commands');
  }
  // File-name hash: stable, 8 hex digits, different names differ
  eq('plugHash', 'plugHash', 'hash exists');
  ok(/^[0-9a-f]{8}$/.test(api.plugHash('abc')) && api.plugHash('abc') === api.plugHash('abc') && api.plugHash('abc') !== api.plugHash('abd'), 'plugHash: 8 hex digits, stable, name-dependent');
  eq('811c9dc5', api.plugHash(''), 'plugHash: empty string is the FNV-1a offset basis');
  eq('', api.plugClean(null, 10), 'plugClean: null is safe');
  eq('a b', api.plugClean('a\u0000b', 10), 'plugClean: control characters become spaces');
}
if (bad) { console.error(bad + ' plugin meta test(s) failed'); process.exit(1); }
console.log('plugin meta tests passed');

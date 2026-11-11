// Browser test for the "Add plugin (.js)" upload: a non-ASCII file name and HTML saved as .js (both failed on a real F50).
// usage: node test_plugin_upload_browser.js INDEX_HTML   (needs Playwright; not part of validate.sh)
const { chromium } = require('playwright'); const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('matchi_token', 'cookie'); } catch (_) {} });
  const page = await ctx.newPage(); const errors = [], posts = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (r) => {
    const req = r.request(), u = new URL(req.url()); if (u.hostname !== 'localhost') return r.abort();
    if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: html });
    const j = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/plugins' && req.method() === 'POST') { posts.push({ p: u.pathname, b: JSON.parse(req.postData()) }); return j({ ok: true }); }
    if (u.pathname.startsWith('/api/plugins/') && req.method() === 'POST') { posts.push({ p: u.pathname, b: JSON.parse(req.postData()) }); return j({ ok: true }); }
    if (u.pathname === '/api/plugins') return j([]);
    if (u.pathname === '/api/ping') return j({ ok: true });
    return j({});
  });
  await page.goto('http://localhost/'); await page.waitForTimeout(1500);
  const jsCode = 'window.__x1 = 1;';
  const htmlCode = '<style>.a{color:red}</style>\n<script>window.__x2 = 2;</script>\n';
  const confirmAll = async () => { for (let i = 0; i < 12; i++) { await page.waitForTimeout(250); try { const btn = await page.$('.modal-bg .cok'); if (btn) { await btn.click(); } } catch (_) { /* the page reloads itself after a successful upload */ } } };
  const up = page.setInputFiles('#plugfile', [
    { name: 'ADGuardHome插件2.4.js', mimeType: 'text/javascript', buffer: Buffer.from(jsCode) },
    { name: 'WiFi_v1.5.js', mimeType: 'text/javascript', buffer: Buffer.from(htmlCode) },
    { name: 'Plain_Name.js', mimeType: 'text/javascript', buffer: Buffer.from(jsCode) },
  ]);
  await up; await confirmAll();
  const saved = posts.filter((x) => x.p === '/api/plugins').map((x) => x.b);
  const nameRx = /^[A-Za-z0-9._-]{1,80}\.(js|html)$/;
  ok(saved.length === 3, 'three plugins were posted: ' + JSON.stringify(saved.map((x) => x.name)));
  const adg = saved.find((x) => x.title === 'ADGuardHome插件2.4');
  ok(adg && nameRx.test(adg.name) && adg.name.endsWith('.js') && adg.code === jsCode, 'non-ASCII .js is stored under a safe name with the original as title: ' + (adg && adg.name));
  const wifi = saved.find((x) => x.title === 'WiFi_v1.5');
  ok(wifi && wifi.name.endsWith('.html') && nameRx.test(wifi.name) && /<script>/.test(wifi.code), 'HTML saved as .js is stored as an .html plugin: ' + (wifi && wifi.name));
  const plain = saved.find((x) => x.name === 'Plain_Name.js');
  ok(plain && plain.code === jsCode, 'a normal ASCII .js keeps its name');
  ok(!errors.length, 'no page errors: ' + errors.join(' | '));
  await b.close(); console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
})();

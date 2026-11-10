// Browser smoke test for the plugin list metadata and the UFI-format store (mock host, no device). usage: node test_store_browser.js INDEX_HTML
// Needs Playwright; not part of validate.sh.
// Smoke test (mock host): plugin list shows @matchi-* metadata; the store loads a UFI-format index, hides archives, shows compat in the confirm.
const { chromium } = require('playwright'); const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('matchi_token', 'T'); } catch (_) {} });
  const page = await ctx.newPage(); const errors = [], dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const plug = '// @matchi-name Signal meter\n// @matchi-version 1.2\n// @matchi-author me\n// @matchi-description Shows signal\ncreateToast("x");';
  const ufiIndex = { download_url: 'https://raw.githubusercontent.com/o/r/c/p/', res: { data: { content: [
    { name: 'demo.txt', size: 100, is_dir: false, hash_info: { sha256: '' } }, { name: 'tool.zip', size: 5, is_dir: false }, { name: 'dir', is_dir: true } ] } } };
  const demo = '<!-- [KANO_PLUGIN_START] Demo -->\n<script>fetch("/api/get_custom_head")</script>\n<!-- [KANO_PLUGIN_END] Demo -->';
  await page.route('**/*', async (r) => {
    const req = r.request(), u = new URL(req.url()); const j = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o), headers: { 'access-control-allow-origin': '*' } });
    if (u.hostname === 'raw.githubusercontent.com') {
      if (u.pathname.endsWith('store.json')) return j(ufiIndex);
      if (u.pathname.endsWith('demo.txt')) return r.fulfill({ status: 200, contentType: 'text/plain', body: demo, headers: { 'access-control-allow-origin': '*' } });
    }
    if (u.hostname !== 'localhost') return r.abort();
    if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: html });
    if (u.pathname === '/api/plugins' && req.method() === 'GET') return j([{ name: 'Signal.js', enabled: true, kind: 'js', code: plug, title: 'Signal' }]);
    return j({ ok: true });
  });
  await page.goto('http://localhost/'); await page.waitForTimeout(1500);
  const row = await page.$eval('#pluglist', (e) => e.innerText);
  ok(/Signal meter/.test(row) && /v1\.2/.test(row) && /me/.test(row), 'plugin list shows name, version and author from the header: ' + JSON.stringify(row.slice(0, 80)));
  await page.evaluate(() => document.getElementById('plugin_store_open').click()); await page.waitForTimeout(300);
  await page.selectOption('#st_src', 'ufi'); await page.waitForTimeout(1200);
  const list = await page.$eval('#st_list', (e) => e.innerText), note = await page.$eval('#st_note', (e) => e.innerText);
  ok(/demo/.test(list) && !/tool/.test(list), 'only the installable entry is listed: ' + JSON.stringify(list.slice(0, 60)));
  ok(/2 archives\/folders hidden/.test(note), 'note counts hidden archives/folders: ' + note);
  ok((await page.$eval('#st_url', (e) => e.value)).endsWith('/BearHero520/UFI-TOOLS-PLUGINS/main/store.json'), 'preset fills the address');
  await page.click('#st_list button'); await page.waitForTimeout(1500);
  const dlg = await page.evaluate(() => (document.querySelector('.modal-bg.show:last-of-type .cmsg, .modal-bg.show .cmsg') || {}).innerText || document.body.innerText);
  ok(/Compatibility/.test(dlg) && /get_custom_head/.test(dlg), 'confirm dialog carries the compatibility warning');
  ok(!errors.length, 'no page errors: ' + errors.join(' | '));
  await b.close(); console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
})();

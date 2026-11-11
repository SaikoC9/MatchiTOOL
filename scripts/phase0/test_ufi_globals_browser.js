// Browser test for the Phase 5.1 globals. usage: node test_ufi_globals_browser.js INDEX_HTML PLUGIN_DIR
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const [, , INDEX, DIR] = process.argv; const html = fs.readFileSync(INDEX, 'utf8');
const feimao = fs.readFileSync(fs.readdirSync(DIR).map((f) => path.join(DIR, f)).find((f) => f.endsWith('v1.5.txt')), 'utf8');
const adb = fs.readFileSync(fs.readdirSync(DIR).map((f) => path.join(DIR, f)).find((f) => /ADB\.txt$/.test(f)), 'utf8');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('matchi_token', 'T'); } catch (_) {} });
  const page = await ctx.newPage(); const seen = [], dialogs = []; let acceptDialog = true;
  // The page asks with its own in-page dialog (askConfirm), not the browser's: answer it by clicking OK or Cancel.
  await page.exposeFunction('__asked', (m) => { dialogs.push(m.slice(0, 40)); return acceptDialog; });
  await ctx.addInitScript(() => { new MutationObserver(() => { const ok = document.querySelector('.modal-bg [role=alertdialog] .cok'); if (!ok || ok.dataset.seen) return; ok.dataset.seen = '1'; const m = ok.closest('[role=alertdialog]').querySelector('.mbody').textContent; window.__asked(m).then((a) => (a ? ok : ok.parentNode.querySelector('.ccancel')).click()); }).observe(document, { childList: true, subtree: true }); });
  await page.route('**/*', async (r) => {
    const req = r.request(), u = new URL(req.url()); if (u.hostname !== 'localhost') return r.abort();
    if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: html });
    const j = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/ping') return j({ ok: true });
    if (u.pathname === '/api/plugins' && req.method() === 'GET') return j([{ name: 'a.html', kind: 'html', title: 'adb', enabled: true, code: adb }, { name: 'f.html', kind: 'html', title: 'f', enabled: true, code: feimao }]);
    if (u.pathname === '/api/shell') return j({ success: true, content: /whoami/.test(JSON.parse(req.postData() || '{}').cmd) ? 'root' : '' });
    if (u.pathname.startsWith('/api/goform/')) { seen.push({ m: req.method(), p: u.pathname + u.search, b: req.postData(), t: req.headers()['x-token'], ct: req.headers()['content-type'] });
      return j(u.search.includes('queryWiFiModuleSwitch') ? { WiFiModuleSwitch: '1' } : { result: 'success' }); }
    return j({});
  });
  await page.goto('http://localhost/'); await page.waitForTimeout(2000);
  // menu
  const menu = await page.evaluate(() => { const b = document.getElementById('collapseBtn_menu'); return { shown: b.style.display !== 'none', btns: [...b.nextElementSibling.querySelectorAll('.collapse_box button')].map((x) => x.textContent), hidden: b.nextElementSibling.hidden }; });
  ok(menu.shown && menu.btns.includes('关闭无线ADB'), 'collapse menu button appears and holds the ADB-off button: ' + JSON.stringify(menu));
  ok(menu.hidden, 'menu starts folded');
  await page.click('#collapseBtn_menu'); ok(await page.evaluate(() => !document.querySelector('.collapse_wrap').hidden), 'menu button unfolds the menu');
  // helpers
  ok(await page.evaluate(() => checkAdvancedFunc()) === true, 'checkAdvancedFunc true when whoami says root');
  ok(await page.evaluate(() => encodeBase64('héllo 世界')) === Buffer.from('héllo 世界').toString('base64'), 'encodeBase64 is UTF-8 safe');
  ok(await page.evaluate(() => typeof login === 'function'), 'typeof login === "function" (page element id no longer shadows it)');
  const g = await page.evaluate(() => getData(new URLSearchParams({ cmd: 'queryWiFiModuleSwitch,queryAccessPointInfo' })));
  ok(g.WiFiModuleSwitch === '1', 'getData returns the router JSON');
  const gr = seen.find((x) => x.m === 'GET'); ok(gr && gr.p.includes('multi_data=1') && gr.t === 'T', 'getData adds multi_data=1 for a cmd list and sends the session token: ' + (gr && gr.p));
  // feimao switch: click card, confirm modal, host PIN confirm
  await page.click('.fmp-net-card[data-net="0200"]'); await page.click('.fmp-modal .danger'); await page.waitForTimeout(1500);
  const post = seen.find((x) => x.m === 'POST');
  ok(post && post.p === '/api/goform/goform_set_cmd_process' && /goformId=ENABLE_PIN/.test(post.b) && /OldPinNumber=0200/.test(post.b), 'postData sends ENABLE_PIN as a form body: ' + (post && post.b));
  ok(post && /x-www-form-urlencoded/.test(post.ct), 'postData content-type is form');
  ok(dialogs.some((d) => /SIM PIN/.test(d)), 'host asked before sending the SIM PIN command');
  ok(await page.evaluate(() => document.querySelector('.fmp-net-card[data-net="0200"]').classList.contains('active')), 'feimao card turns active after {result:"success"}');
  // refusal path
  acceptDialog = false; await page.evaluate(() => { postData._pinOk = false; }); const before = seen.length;
  const refused = await page.evaluate(() => postData(null, { goformId: 'ENABLE_PIN', OldPinNumber: '0100' }).then(() => 'sent', (e) => e.message));
  ok(/Cancelled/.test(refused) && seen.length === before, 'cancelling the PIN confirm sends nothing');
  const other = await page.evaluate(() => postData(null, { goformId: 'SOME_OTHER' }).then((r) => r.status)); ok(other === 200, 'other goformIds are not asked about');
  await b.close(); console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
})();

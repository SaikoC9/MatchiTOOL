// Browser smoke test, AT & Radio window on top of window.MatchiRadio: opens the window against a fake router and checks the bands it paints.
// usage: node test_at_radio_browser.js INDEX_HTML     (needs Playwright; not part of validate.sh)
const { chromium } = require('playwright'); const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext();
  await ctx.addInitScript(() => { try { sessionStorage.setItem('matchi_token', 'T'); localStorage.removeItem('matchi_band_orig'); } catch (_) {} });
  const page = await ctx.newPage(); const errors = [], sent = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (r) => {
    const req = r.request(), u = new URL(req.url()); if (u.hostname !== 'localhost') return r.abort();
    if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: html });
    const j = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const body = (() => { try { return JSON.parse(req.postData() || '{}'); } catch (_) { return {}; } })();
    if (u.pathname === '/api/zte') {
      sent.push(body);
      if (body.op === 'set') return j({ success: true, data: { result: 'success' } });
      const cmd = (body.params && body.params.cmd) || '', d = {};
      if (/lte_band_lock/.test(cmd)) { d.lte_band_lock = '1,3'; d.nr_band_lock = '78'; }
      if (/net_select/.test(cmd)) { d.net_select = 'WL_AND_5G'; d.performance_mode = '0'; }
      return j({ success: true, data: d });
    }
    if (u.pathname === '/api/at') {
      const c = body.command || '';
      if (/support_band/.test(c)) return j({ success: true, result: '5+SP5GCMDS: get nr support_band,6,41,78,1,8,28,5\nOK' });
      return j({ success: true, result: 'OK' });
    }
    if (u.pathname === '/api/ping') return j({ ok: true, version: '1.4.1' });
    if (u.pathname === '/api/plugins') return j([]);
    return j({});
  });
  await page.goto('http://localhost/'); await page.waitForTimeout(500);
  ok(await page.evaluate(() => typeof window.MatchiRadio === 'object' && typeof window.MatchiRadio.radioCycle === 'function'), 'MatchiRadio is defined in the page');
  await page.locator('#matchi_at_btn').first().click({ force: true }); await page.waitForTimeout(600);
  const nr = await page.locator('#matchi_band_nr .at-bd').allInnerTexts();
  ok(JSON.stringify(nr) === JSON.stringify(['n1', 'n5', 'n8', 'n28', 'n41', 'n78']), 'NR chips are the six real bands, no n6: ' + nr.join(' '));
  ok(/locked now: 1,3\)/.test(await page.locator('#matchi_band_lte .at-bl').innerText()), 'LTE header shows the router list');
  ok(/locked now: 78\)/.test(await page.locator('#matchi_band_nr .at-bl').innerText()), 'NR header shows the router list');
  const on = await page.locator('#matchi_band_lte .at-bd.on').allInnerTexts();
  ok(JSON.stringify(on) === JSON.stringify(['B1', 'B3']), 'highlighted LTE chips equal the router list: ' + on.join(' '));
  ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
  await b.close(); process.exit(fails ? 1 : 0);
})();

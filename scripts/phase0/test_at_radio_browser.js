// Browser smoke test: the AT & Radio window no longer has network mode / band lock / cell lock (they are on the dashboard), and the
// "Performance mode" button in the top row opens a window that shows and switches the router's setting. Fake router.
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
  ok(await page.locator('#matchi_at_modal #matchi_report').count() === 1, 'AT & Radio window opens with its quick buttons');
  for (const id of ['matchi_nm_row', 'matchi_band_row', 'matchi_cell_panel', 'matchi_cell_btn', 'matchi_pm_row']) ok(await page.locator('#matchi_at_modal #' + id).count() === 0, id + ' is gone from the AT & Radio window');
  await page.locator('#matchi_at_modal').getByText('Close').first().click({ force: true }).catch(() => {}); await page.waitForTimeout(200);
  ok(await page.locator('.actions-buttons #matchi_perf_btn').count() === 1, 'Performance mode button is in the top button row');
  await page.locator('#matchi_perf_btn').click({ force: true }); await page.waitForTimeout(600);
  ok(/Performance mode is OFF/.test(await page.locator('#matchi_perf_state').innerText()), 'window shows the router value (OFF)');
  ok((await page.locator('#matchi_perf_set').innerText()) === 'Turn on', 'button offers Turn on');
  ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
  await b.close(); process.exit(fails ? 1 : 0);
})();

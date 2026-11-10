// Browser test: the UFI_DATA poller must not start a root shell on every poll when the router never returns lan_ipaddr.
// usage: node test_ufi_poll_browser.js INDEX_HTML   (needs Playwright; not part of validate.sh)
const { chromium } = require('playwright'); const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext();
  await ctx.addInitScript(() => { try { sessionStorage.setItem('matchi_token', 'T'); } catch (_) {} });
  const page = await ctx.newPage(); let zte = 0, lanShell = 0; const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install();
  await page.route('**/*', async (r) => {
    const req = r.request(), u = new URL(req.url()); if (u.hostname !== 'localhost') return r.abort();
    if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: html });
    const j = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/plugins' && req.method() === 'GET') return j([{ name: 'sig.js', kind: 'js', title: 'sig', enabled: true, code: 'window.__s = () => UFI_DATA.signalbar;' }]);
    if (u.pathname === '/api/zte') { zte++; return j({ success: true, data: { signalbar: '4', network_type: 'LTE' } }); } // no lan_ipaddr, ever
    if (u.pathname === '/api/shell') { if (/ip -4 addr/.test(JSON.parse(req.postData() || '{}').cmd || '')) lanShell++; return j({ success: true, content: '' }); }
    if (u.pathname === '/api/ping') return j({ ok: true, version: '1.4.0' });
    return j({});
  });
  await page.goto('http://localhost/'); await page.clock.runFor(2000);
  for (let i = 0; i < 12; i++) await page.clock.runFor(10000);   // two minutes of page time
  ok(zte >= 3, 'the poller asked the router: ' + zte + ' calls');
  ok(zte <= 12 * 3 + 6, 'at most one round per 10 s (3 requests per round): ' + zte + ' calls in 2 min');
  ok(lanShell <= 3, 'the root-shell LAN fallback ran at most 3 times: ' + lanShell);
  ok(!errors.length, 'no page errors: ' + errors.join(' | '));
  await b.close(); console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
})();

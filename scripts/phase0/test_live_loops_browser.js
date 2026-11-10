// Browser test, Live status Phase 1: the router (fast) loop and the root-shell (slow) loop run on their own timers.
// usage: node test_live_loops_browser.js INDEX_HTML     (needs Playwright; not part of validate.sh)
const { chromium } = require('playwright'); const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const SHELL = 'BATTERY\nlevel: 50\ntemperature: 300\nstatus: 3\nTHERMAL\nZ:soc-thermal=45000\nSYS\ncpu0: cpu 100 0 100 800 0 0 0 0\ncpu: cpu 110 0 110 880 0 0 0 0\nload: 0.1 0.2 0.3\nup: 1000\nmem: 1000000 500000\n';

async function scenario(name, run) {
  const b = await chromium.launch(); const ctx = await b.newContext();
  await ctx.addInitScript(() => { try { sessionStorage.setItem('matchi_token', 'T'); localStorage.removeItem('liv_auto'); } catch (_) {} });
  const page = await ctx.newPage(); const st = { zte: 0, shell: 0, at: 0, rsrp: '-95', zteFail: false, extra: {} }, errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install();
  await page.route('**/*', async (r) => {
    const req = r.request(), u = new URL(req.url()); if (u.hostname !== 'localhost') return r.abort();
    if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: html });
    const j = (o, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/zte') { st.zte++; return st.zteFail ? j({ error: 'down' }, 500) : j({ success: true, data: { signalbar: '4', network_type: 'LTE', lte_rsrp: st.rsrp, ...st.extra } }); }
    if (u.pathname === '/api/shell') { st.shell++; return j({ success: true, content: SHELL }); }
    if (u.pathname === '/api/at/batch') { st.at++; return j({ results: ['', '', '', ''] }); }
    if (u.pathname === '/api/ping') return j({ ok: true, version: '1.4.0' });
    if (u.pathname === '/api/plugins') return j([]);
    return j({});
  });
  const run1 = async (sec) => { for (let i = 0; i < sec; i++) { await page.clock.runFor(1000); await page.waitForTimeout(15); } };
  await page.goto('http://localhost/'); await page.waitForTimeout(200);
  console.log('--- ' + name);
  await run({ page, st, run1, ok });
  ok(!errors.length, name + ': no page errors ' + errors.join(' | '));
  await b.close();
}

(async () => {
  await scenario('cadence and merge', async ({ page, st, run1 }) => {
    await run1(1);
    ok(st.zte >= 1 && st.shell >= 1, `first fast and slow reads happen at start (zte ${st.zte}, shell ${st.shell})`);
    ok(await page.locator('#liv_inline .liv-dbm').first().innerText().then((t) => /-95/.test(t)), 'card shows the router signal (-95 dBm)');
    await run1(1); // t ~2 s: no early second root read
    const shell2 = st.shell; ok(shell2 === 1, `no second root shell in the first 2 s (${shell2})`);
    await run1(58); // t ~60 s
    ok(st.zte >= 18 && st.zte <= 23, `fast loop about every 3 s: ${st.zte} router reads in 60 s`);
    ok(st.shell >= 3 && st.shell <= 5, `slow loop about every 15 s: ${st.shell} root reads in 60 s`);
    const shellBefore = st.shell; st.rsrp = '-71'; await run1(4);
    ok(await page.locator('#liv_inline .liv-dbm').first().innerText().then((t) => /-71/.test(t)), 'a new signal value reaches the card within ~4 s');
    ok(st.shell === shellBefore, 'signal update did not need a root shell call');
    ok(await page.locator('#liv_inline .liv-tv').allInnerTexts().then((a) => a.some((t) => /10 %|50 %/.test(t)) ), 'CPU / memory tiles come from the slow loop');
  });

  await scenario('switch off, other window, hidden tab', async ({ page, st, run1 }) => {
    await run1(5);
    await page.locator('#liv_inline .liv-sw').click(); await page.waitForTimeout(100);
    let z = st.zte, s = st.shell; await run1(60);
    ok(st.zte === z && st.shell === s, `Live refresh off stops both loops (router +${st.zte - z}, shell +${st.shell - s})`);
    await page.locator('#liv_inline .liv-sw').click(); await page.waitForTimeout(100); await run1(2);
    ok(st.zte > z, 'switching it on again polls again');
    // another tool window open
    await page.evaluate(() => { const d = document.createElement('div'); d.id = 'sms_fake'; d.className = 'modal-bg show'; document.body.appendChild(d); });
    z = st.zte; s = st.shell; await run1(60);
    ok(st.zte === z && st.shell === s, `another open window pauses both loops (router +${st.zte - z}, shell +${st.shell - s})`);
    await page.evaluate(() => document.getElementById('sms_fake').remove());
    await run1(20); ok(st.zte > z, 'loops resume after that window closes');
    // hidden tab
    await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
    z = st.zte; s = st.shell; await run1(60);
    ok(st.zte === z && st.shell === s, `a hidden tab does not poll (router +${st.zte - z}, shell +${st.shell - s})`);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await run1(2); ok(st.zte > z, 'coming back to the tab polls again');
  });

  // Phase 2: UFI rows (speed in bytes/s, monthly totals in bytes, device count); hidden when the router gives nothing.
  await scenario('UFI rows', async ({ page, st, run1 }) => {
    const tiles = async () => page.locator('#liv_inline .liv-tn .liv-tile').allInnerTexts().then((a) => a.map((t) => t.replace(/\s+/g, ' ').trim()));
    await run1(1);
    ok((await tiles()).length === 0, 'no speed / devices / month tiles while the router returns none of those keys');
    st.extra = { realtime_rx_thrpt: '1536000', realtime_tx_thrpt: '2048', wifi_access_sta_num: '3', monthly_rx_bytes: '5368709120', monthly_tx_bytes: '1073741824', ppp_status: 'ppp_connected' };
    await run1(4); let t = await tiles(), j = t.join(' | ');
    ok(/Download 1\.46 MB\/s/.test(j), 'download formatted: ' + j);
    ok(/Upload 2\.00 KB\/s/.test(j), 'upload formatted');
    ok(/Devices 3/.test(j), 'device count shown');
    ok(/This month 6\.00 GB ↓ 5\.00 GB · ↑ 1\.00 GB/.test(j), 'month total and split shown');
    ok(!(await page.locator('#liv_inline .liv-hero').innerText()).includes('Data off'), 'no "Data off" badge while ppp_connected');
    st.extra = { realtime_rx_thrpt: '0', realtime_tx_thrpt: '', wifi_access_sta_num: '', monthly_rx_bytes: '100', ppp_status: 'ppp_disconnected' };
    await run1(4); j = (await tiles()).join(' | ');
    ok(/Download 0 B\/s/.test(j), 'a real 0 speed still shows as 0 B/s: ' + j);
    ok(!/Upload/.test(j) && !/Devices/.test(j), 'empty keys hide their tile (no made-up 0)');
    ok(!/This month/.test(j), 'month tile hidden when one of its two keys is missing');
    ok((await page.locator('#liv_inline .liv-hero').innerText()).includes('Data off'), 'ppp_disconnected shows "Data off"');
    st.extra = { realtime_rx_thrpt: 'abc', wifi_access_sta_num: '-1' }; await run1(4);
    ok((await tiles()).length === 0, 'junk or negative values are hidden');
  });

  await scenario('router failing', async ({ page, st, run1 }) => {
    st.zteFail = true; await run1(1);
    const base = st.zte; await run1(180);
    const n = st.zte - base;
    ok(n <= 6, `fast loop backs off when the router fails: ${n} router calls in 180 s (3 s steady would be 60)`);
    ok(st.at >= 1, `slow loop falls back to the modem AT path (${st.at} AT batches)`);
    st.zteFail = false; await run1(70);
    await page.waitForTimeout(100);
    ok(await page.locator('#liv_inline .liv-dbm').first().innerText().then((t) => /-95/.test(t)), 'card recovers once the router answers again');
  });

  console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
})();

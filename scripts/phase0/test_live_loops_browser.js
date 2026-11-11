// Browser test, Live status Phase 1: the router (fast) loop and the root-shell (slow) loop run on their own timers.
// usage: node test_live_loops_browser.js INDEX_HTML     (needs Playwright; not part of validate.sh)
const { chromium } = require('playwright'); const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
// AOSP-style telephony.registry lines, as the F50 (Android) prints them: a 4G + 5G (NSA) link
const TELE = 'mSignalStrength=SignalStrength:{mNr=CellSignalStrengthNr:{csiRsrp = -104 csiRsrq = -12 csiSinr = 4 ssRsrp = -106 ssRsrq = -11 ssSinr = 7 level = 2}}\\n' +
  'mCellInfo=[CellInfoLte:{mRegistered=YES mCellConnectionStatus=1 CellIdentityLte:{mCi=123 mPci=45 mTac=1 mEarfcn=1850 mBands=[3] mBandwidth=20000} CellSignalStrengthLte:{rssi=-70 rsrp=-95 rsrq=-10 rssnr=8 level=3}}, ' +
  'CellInfoNr:{mRegistered=YES mCellConnectionStatus=1 CellIdentityNr:{mPci=321 mTac=2 mNrArfcn=632628 mBands=[78] mNci=99} CellSignalStrengthNr:{csiRsrp = -104 csiRsrq = -12 csiSinr = 4 ssRsrp = -106 ssRsrq = -11 ssSinr = 7}}]\\n';
const SHELL = 'BATTERY\nlevel: 50\ntemperature: 300\nstatus: 3\nTHERMAL\nZ:soc-thermal=45000\nSYS\ncpu0: cpu 100 0 100 800 0 0 0 0\ncpu: cpu 110 0 110 880 0 0 0 0\nload: 0.1 0.2 0.3\nup: 1000\nmem: 1000000 500000\n';

async function scenario(name, run, opts = {}) {
  const b = await chromium.launch(); const ctx = await b.newContext();
  // opts.seed = { ageMs, d } writes a Phase 4 sessionStorage cache entry (ageMs old) before the page starts
  await ctx.addInitScript((seed) => { try { sessionStorage.setItem('matchi_token', 'cookie'); localStorage.removeItem('liv_auto'); if (seed) sessionStorage.setItem('liv_cache_v1', JSON.stringify({ t: Date.now() - seed.ageMs, d: seed.d })); } catch (_) {} }, opts.seed || null);
  const page = await ctx.newPage(); const st = { extra0: opts.extra || {}, zteDelay: opts.zteDelay || 0, tele: 0, zte: 0, shell: 0, at: 0, rsrp: '-95', zteFail: false, extra: opts.extra || {}, zone: 45000 }, errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install();
  await page.route('**/*', async (r) => {
    const req = r.request(), u = new URL(req.url()); if (u.hostname !== 'localhost') return r.abort();
    if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: html });
    const j = (o, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/zte') { st.zte++; if (st.zteDelay) await new Promise((res) => setTimeout(res, st.zteDelay)); return st.zteFail ? j({ error: 'down' }, 500) : j({ success: true, data: { signalbar: '4', network_type: 'LTE', lte_rsrp: st.rsrp, ...st.extra } }); }
    if (u.pathname === '/api/shell') { st.shell++; const wantTele = /dumpsys telephony/.test(req.postData() || ''); if (wantTele) st.tele++; return j({ success: true, content: SHELL.replace('soc-thermal=45000', 'soc-thermal=' + st.zone).replace('level: 50', 'level: ' + (st.bat === undefined ? 50 : st.bat)).replace('status: 3', 'status: ' + (st.status || 3)) + (wantTele ? 'TELEPHONY\\n' + TELE : '') }); }
    if (u.pathname === '/api/at/batch') { st.at++; return j({ results: ['', '', '', ''] }); }
    if (u.pathname === '/api/ping') return j({ ok: true, version: require('../version.js').name });
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

  // Phase 3: heat-aware cadence. cool fast 3 s / slow 15 s; warm 6 s / 30 s; hot 15 s / 90 s. The mocked root shell reports the system temperature.
  await scenario('heat levels', async ({ page, st, run1 }) => {
    const rate = async (sec) => { const z = st.zte, s = st.shell; await run1(sec); return { f: st.zte - z, s: st.shell - s }; };
    const near = (v, want, tol) => Math.abs(v - want) <= tol;
    await run1(5);
    let r = await rate(60); ok(near(r.f, 20, 2) && near(r.s, 4, 1), `cool: router ${r.f} (want ~20), root ${r.s} (want ~4) in 60 s`);
    st.zone = 65000; await run1(25);                       // 65 C -> warm; the next root read notices
    r = await rate(60); ok(near(r.f, 10, 1) && near(r.s, 2, 1), `warm: router ${r.f} (want ~10), root ${r.s} (want ~2) in 60 s`);
    ok(await page.locator('#liv_inline .liv-heat.warm').count() === 1, 'warm banner shown');
    st.zone = 75000; await run1(45);                       // 75 C -> hot
    r = await rate(180); ok(near(r.f, 12, 2) && near(r.s, 2, 1), `hot: router ${r.f} (want ~12), root ${r.s} (want ~2) in 180 s`);
    ok(r.s >= 1, 'hot does not stop the root loop (it is the only source of the temperature)');
    st.zone = 85000; await run1(95);
    r = await rate(180); ok(near(r.f, 12, 2) && near(r.s, 2, 1), `critical uses the hot cadence: router ${r.f}, root ${r.s} in 180 s`);
    st.zone = 45000; await run1(100);                      // cooled: the next root read (<= 90 s) brings the fast cadence back
    r = await rate(60); ok(near(r.f, 20, 2) && near(r.s, 4, 1), `cool again: router ${r.f}, root ${r.s} in 60 s`);
    ok(await page.locator('#liv_inline .liv-heat').count() === 0, 'heat banner gone after cooling');
    // forced level for trying it on a cool phone
    await page.evaluate(() => localStorage.setItem('liv_thermal_test', '2')); await run1(20);
    r = await rate(180); ok(near(r.f, 12, 2) && near(r.s, 2, 1), `forced level 2 (liv_thermal_test): router ${r.f}, root ${r.s} in 180 s`);
    await page.evaluate(() => localStorage.removeItem('liv_thermal_test')); await run1(100);
    r = await rate(60); ok(near(r.f, 20, 2) && near(r.s, 4, 1), `override removed: router ${r.f}, root ${r.s} in 60 s`);
  });

  await scenario('hot and router failing', async ({ page, st, run1 }) => {
    await page.evaluate(() => localStorage.setItem('liv_thermal_test', '2')); await run1(20);
    st.zteFail = true; await run1(5); const z = st.zte; await run1(180);
    ok(st.zte - z <= 12, `a failing router is not polled faster than the hot delay: ${st.zte - z} calls in 180 s (hot = 15 s steady would be 12)`);
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

  // Phase 4: instant open. The router answer is held back 1.5 s (real time) so the card can only show what is cached.
  const SEED = { ageMs: 5000, d: { network_type: 'LTE', signalbar: '3', lte_rsrp: '-88', wan_active_band: 'B3' } };
  await scenario('cached values on open', async ({ page, st, run1 }) => {
    await page.waitForTimeout(100);
    const dbm = () => page.locator('#liv_inline .liv-dbm').first().innerText().catch(() => '');
    ok(/-88/.test(await dbm()), 'cached signal (-88 dBm) is on the card before the router has answered: ' + (await dbm()).trim());
    const when = () => page.locator('#liv_inline .liv-when').innerText();
    ok(/^Last reading/.test(await when()), 'header says it is the last reading, not live: ' + (await when()));
    ok(!/Live/.test(await when()), 'cached values are not labelled Live');
    ok(await page.locator('#liv_inline .liv-pulse.off').count() === 1, 'pulse is grey while only cached values are shown');
    await page.waitForTimeout(1800); await run1(1);
    ok(/-95/.test(await dbm()), 'the first live read replaces the cached value: ' + (await dbm()).trim());
    ok(/^Live/.test(await when()), 'header is Live after the first read: ' + (await when()));
    const c = await page.evaluate(() => JSON.parse(sessionStorage.getItem('liv_cache_v1')));
    ok(c && c.d.lte_rsrp === '-95', 'cache is refreshed with the new reading');
  }, { seed: SEED, zteDelay: 1500 });

  await scenario('no cache shows Connecting', async ({ page, st, run1 }) => {
    await page.waitForTimeout(100);
    ok(/Connecting/.test(await page.locator('#liv_inline .liv-when').innerText()), 'no cache: header says Connecting…');
    ok(/Reading modem/.test(await page.locator('#liv_inline .liv-body').innerText()), 'no cache: body says Reading modem…');
    await page.waitForTimeout(1800); await run1(1);
    const c = await page.evaluate(() => sessionStorage.getItem('liv_cache_v1'));
    ok(!!c, 'a cache entry is written after the first read');
    ok(!/provider|pci|ipaddr|imei|iccid|rx_thrpt|tx_thrpt|monthly|sta_num|ppp/i.test(c), 'cache holds signal numbers only: ' + c);
  }, { zteDelay: 1500 });

  await scenario('stale and invalid cache is ignored', async ({ page, st, run1 }) => {
    await page.waitForTimeout(100);
    ok(/Connecting/.test(await page.locator('#liv_inline .liv-when').innerText()), 'a cache older than 10 minutes is not used');
  }, { seed: { ageMs: 11 * 60 * 1000, d: SEED.d }, zteDelay: 1500 });
  await scenario('cache with junk is ignored', async ({ page }) => {
    await page.waitForTimeout(100);
    ok(/Connecting/.test(await page.locator('#liv_inline .liv-when').innerText()), 'cache without a network type or bars is not used');
  }, { seed: { ageMs: 1000, d: { lte_rsrp: '-80', rx: 'x' } }, zteDelay: 1500 });

  await scenario('router failing drops the cached values', async ({ page, st, run1 }) => {
    st.zteFail = true; await page.waitForTimeout(100); await run1(2); await page.waitForTimeout(100);
    const w = await page.locator('#liv_inline .liv-when').innerText();
    ok(!/Last reading/.test(w), 'after a failed first read the card no longer claims a last reading: ' + w);
    ok(!/-88/.test(await page.locator('#liv_inline .liv-body').innerText()), 'old cached signal is gone when the router fails');
  }, { seed: SEED });

  await scenario('card shown again reads at once', async ({ page, st, run1 }) => {
    await run1(5);
    await page.evaluate(() => { document.getElementById('home').style.display = 'none'; });   // as when the session is lost
    await run1(10); const z = st.zte, s = st.shell;
    await page.evaluate(() => { document.getElementById('home').style.display = 'block'; });
    await run1(2);
    ok(st.zte > z && st.shell > s, `showing the card again triggers both reads within 2 s (router +${st.zte - z}, shell +${st.shell - s})`);
  });

  // Radio detail gap (screenshot: 5G RSRP shown, RSRQ / SINR / PCI / Ch all "—"): the router answers only RSRP, the telephony read fills the rest.
  const box = async (page, title) => page.locator('#liv_inline .liv-box', { hasText: title }).first().innerText().then((x) => x.replace(/\s+/g, ' ').trim()).catch(() => '');
  await scenario('radio detail from telephony', async ({ page, st, run1 }) => {
    await run1(8);
    const n = await box(page, '5G'), l = await box(page, '4G');
    ok(/RSRQ\s*-11/.test(n) && /SINR\s*7/.test(n), '5G RSRQ -11 and SINR 7 come from telephony: ' + n);
    ok(/PCI 321/.test(n) && /Ch 632628/.test(n) && /n78/.test(n), '5G PCI 321, channel 632628 and band n78 come from the 5G cell block: ' + n);
    ok(/PCI 45/.test(l) && /Ch 1850/.test(l) && /B3/.test(l), '4G PCI 45, channel 1850, band B3 come from the 4G cell block (not mixed with 5G): ' + l);
    ok(/-106/.test(n), '5G RSRP from the router is kept: ' + n);
    ok(st.tele >= 1, `telephony was read (${st.tele}x)`);
    const t0 = st.tele; await run1(60);
    ok(st.tele - t0 <= 3, `telephony is re-read no faster than every ~30 s when cool: ${st.tele - t0} reads in 60 s`);
  }, { extra: { network_type: 'ENDC', Z5g_rsrp: '-106' } });
  await scenario('router complete: no telephony read', async ({ page, st, run1 }) => {
    await run1(65);
    ok(st.tele === 0, `no dumpsys when the router already gives every detail field (${st.tele} reads)`);
  }, { extra: { network_type: 'LTE', lte_rsrp: '-95', lte_rsrq: '-10', lte_snr: '8', lte_pci: '45', wan_active_channel: '1850' } });
  await scenario('hot: telephony slowed down', async ({ page, st, run1 }) => {
    await page.evaluate(() => localStorage.setItem('liv_thermal_test', '2')); await run1(100);
    const t0 = st.tele; await run1(360);
    ok(st.tele - t0 <= 3, `hot: telephony about every 3 minutes at most: ${st.tele - t0} reads in 360 s`);
  }, { extra: { network_type: 'ENDC', Z5g_rsrp: '-106' } });

  // ---- Phase 5: refresh speed, battery pause, speed graph -------------------------------------------------------
  await scenario('phase 5: Fast and Eco cadence, saved choice', async ({ page, st, run1 }) => {
    await run1(3);
    await page.locator('#liv_inline .liv-chip[data-mode="fast"]').click(); await page.waitForTimeout(100);
    let z = st.zte, s = st.shell; await run1(40);
    ok(st.zte - z >= 17 && st.zte - z <= 22, `Fast: router about every 2 s (${st.zte - z} reads in 40 s)`);
    ok(st.shell - s >= 3 && st.shell - s <= 5, `Fast: root about every 10 s (${st.shell - s} reads in 40 s)`);
    ok(await page.evaluate(() => localStorage.getItem('liv_mode')) === 'fast', 'the choice is saved in localStorage');
    await page.locator('#liv_inline .liv-chip[data-mode="eco"]').click(); await page.waitForTimeout(100);
    z = st.zte; s = st.shell; await run1(90);
    ok(st.zte - z >= 9 && st.zte - z <= 12, `Eco: router about every 9 s (${st.zte - z} reads in 90 s)`);
    ok(st.shell - s >= 1 && st.shell - s <= 3, `Eco: root about every 45 s (${st.shell - s} reads in 90 s)`);
    ok(await page.locator('#liv_inline .liv-chip[data-mode="eco"]').getAttribute('aria-pressed') === 'true', 'Eco chip is shown as selected');
  });
  await scenario('phase 5: Fast never speeds up a hot phone', async ({ page, st, run1 }) => {
    await page.evaluate(() => localStorage.setItem('liv_thermal_test', '2'));
    await page.locator('#liv_inline .liv-chip[data-mode="fast"]').click(); await page.waitForTimeout(100); await run1(20);
    const z = st.zte; await run1(60);
    ok(st.zte - z <= 5, `hot + Fast: router still about every 15 s (${st.zte - z} reads in 60 s)`);
  });
  await scenario('phase 5: pause below battery level, resume on charge', async ({ page, st, run1 }) => {
    st.bat = 10; await run1(20);
    await page.locator('#liv_inline .liv-bp').selectOption('15'); await page.waitForTimeout(100); await run1(20);
    const z = st.zte, s = st.shell; await run1(120);
    ok(st.zte === z, `below 15 % on battery: the router loop stops (+${st.zte - z})`);
    ok(st.shell - s >= 1 && st.shell - s <= 3, `the root loop only checks about once a minute (+${st.shell - s} in 120 s)`);
    ok(await page.locator('#liv_inline .liv-when').innerText().then((t) => /Paused/.test(t) && /10%/.test(t)), 'header says Paused with the battery level');
    st.status = 2; await run1(70);
    ok(st.zte > z, 'plugging in the charger resumes the router loop');
    ok(await page.locator('#liv_inline .liv-when').innerText().then((t) => !/Paused/.test(t)), 'the Paused label is gone');
    st.status = 3; st.bat = 40; await run1(70); const z2 = st.zte; await run1(10);
    ok(st.zte > z2, 'battery above the limit keeps polling');
  });
  await scenario('phase 5: pause is off by default', async ({ page, st, run1 }) => {
    st.bat = 5; await run1(30);
    const z = st.zte; await run1(30);
    ok(st.zte - z >= 8, `battery pause Off: low battery does not stop polling (+${st.zte - z})`);
    ok(await page.locator('#liv_inline .liv-bp').inputValue() === '0', 'select shows Off');
  });
  await scenario('phase 5: speed graph', async ({ page, st, run1 }) => {
    await run1(2);
    ok(await page.locator('#liv_inline .liv-spark').count() === 0, 'no graph until there are 2 readings');
    await run1(40);
    ok(await page.locator('#liv_inline .liv-spark polyline').count() === 2, 'graph has a download and an upload line');
    ok(await page.locator('#liv_inline .liv-spark').innerText().then((t) => /last \d+ reads/.test(t) && /peak 2\.00 KB\/s/.test(t)), 'caption shows the number of reads and the peak');
    await run1(300);
    ok(await page.locator('#liv_inline .liv-spark').innerText().then((t) => /last 60 reads/.test(t)), 'keeps the last 60 reads only');
  }, { extra: { realtime_rx_thrpt: '2048', realtime_tx_thrpt: '1024' } });
  await scenario('phase 5: no graph when the router has no speed keys', async ({ page, st, run1 }) => {
    await run1(30);
    ok(await page.locator('#liv_inline .liv-spark').count() === 0, 'no graph without realtime_rx_thrpt / realtime_tx_thrpt');
  });


  console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
})();

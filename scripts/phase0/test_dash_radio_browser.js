// Browser test, dashboard "Radio settings" card against a fake router: chips show the router state, ticks stay pending, Lock sends BOTH lists,
// Live Status stops polling during the restart and reads once afterwards, the host pill says "Radio restarting".
// usage: node test_dash_radio_browser.js INDEX_HTML     (needs Playwright; not part of validate.sh)
const { chromium } = require('playwright'); const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext();
  await ctx.addInitScript(() => { try { sessionStorage.setItem('matchi_token', 'T'); localStorage.removeItem('matchi_band_orig'); localStorage.setItem('liv_mode', 'eco'); } catch (_) {} });
  const page = await ctx.newPage(); const errors = [];
  const router = { lte_band_lock: '1,3', nr_band_lock: '78', net_select: 'WL_AND_5G' };
  const log = { sets: [], liveGets: 0, shell: 0, cycleAt: 0 };
  let cycling = false;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (r) => {
    const req = r.request(), u = new URL(req.url()); if (u.hostname !== 'localhost') return r.abort();
    if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: html });
    const j = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const body = (() => { try { return JSON.parse(req.postData() || '{}'); } catch (_) { return {}; } })();
    if (u.pathname === '/api/zte') {
      if (body.op === 'set') { log.sets.push(body.params); const p = body.params; if (p.lte_band_lock) router.lte_band_lock = p.lte_band_lock; if (p.nr_band_lock) router.nr_band_lock = p.nr_band_lock; return j({ success: true, data: { result: 'success' } }); }
      const cmd = (body.params && body.params.cmd) || '';
      if (/lte_band_lock/.test(cmd)) return j({ success: true, data: { lte_band_lock: router.lte_band_lock, nr_band_lock: router.nr_band_lock } });
      if (/net_select/.test(cmd)) return j({ success: true, data: { net_select: router.net_select, performance_mode: '0' } });
      log.liveGets++; return j({ success: true, data: { network_type: 'LTE', lte_rsrp: '-95', signalbar: '4' } });
    }
    if (u.pathname === '/api/shell') {
      if (/SFUN/.test(body.cmd || '')) { cycling = true; await sleep(5000); cycling = false; return j({ success: true, content: 'OFF0:OK\nOFF1:OK\nON0:1:OK\nON1:1:OK\n' }); }
      log.shell++; return j({ success: true, content: '' });
    }
    if (u.pathname === '/api/at') {
      const c = body.command || '';
      if (/support_band/.test(c)) return j({ success: true, result: '5+SP5GCMDS: get nr support_band,3,78,41,1\nOK' });
      if (/CEREG/.test(c)) return j({ success: true, result: '+CEREG: 2,1,"1","2",7\nOK' });
      return j({ success: true, result: 'OK' });
    }
    if (u.pathname === '/api/at/batch') return j({ results: ['', '', '', ''] });
    if (u.pathname === '/api/ping') return j({ ok: true, version: require('../version.js').name });
    if (u.pathname === '/api/plugins') return j([]);
    return j({});
  });
  await page.goto('http://localhost/'); await page.waitForTimeout(800);
  const t = (sel) => page.locator(sel).first().innerText();
  const cls = (type, band) => page.locator(`#dash_radio .dr-b[data-t="${type}"][data-b="${band}"]`).getAttribute('class');
  ok(await page.evaluate(() => { const c = document.getElementById('dash_radio'), l = document.getElementById('liv_inline'); return !!c && !!l && l.nextElementSibling === c; }), 'card sits right under Live device status');
  ok(/locked now: B1 B3/.test(await t('#dash_radio .dr-l')), 'LTE header = router list');
  ok(/on/.test(await cls('lte', 1)) && /on/.test(await cls('lte', 3)) && !/on|add|rm/.test((await cls('lte', 8)).replace('dr-b', '')), 'chips: B1 B3 on, B8 off');
  const nr = await page.locator('#dash_radio .dr-b[data-t="nr"]').allInnerTexts();
  ok(JSON.stringify(nr) === JSON.stringify(['n1', 'n41', 'n78']), 'NR chips from the modem (count dropped): ' + nr.join(' '));
  ok(await page.locator('#dash_radio [data-a=lock]').isDisabled(), 'Lock is disabled while nothing differs');
  await page.locator('#dash_radio .dr-b[data-t="lte"][data-b="8"]').click();
  await page.locator('#dash_radio .dr-b[data-t="lte"][data-b="3"]').click();
  ok(/add/.test(await cls('lte', 8)) && /rm/.test(await cls('lte', 3)), 'ticked B8 = pending add, unticked B3 = pending remove');
  ok(/locked now: B1 B3/.test(await t('#dash_radio .dr-l')), 'header still shows the router state, not the ticks');
  ok(await page.locator('#dash_radio [data-a=lock]').isEnabled(), 'Lock enabled once pending differs');
  await page.locator('#dash_radio [data-a=reset]').click();
  ok(await page.locator('#dash_radio [data-a=lock]').isDisabled(), 'Reset ticks goes back to the router state');
  await page.locator('#dash_radio .dr-b[data-t="lte"][data-b="8"]').click();
  await page.locator('#dash_radio [data-a=lock]').click();
  await page.locator('.cok').click();
  await page.waitForTimeout(600);
  ok(log.sets.length === 2 && log.sets[0].goformId === 'LTE_BAND_LOCK' && log.sets[0].lte_band_lock === '1,3,8' && log.sets[1].goformId === 'NR_BAND_LOCK' && log.sets[1].nr_band_lock === '78', 'Lock sent BOTH lists (NR unchanged): ' + JSON.stringify(log.sets));
  ok(cycling, 'radio restart is running');
  ok(/Radio restarting/.test(await t('#hostlabel')), 'host pill says Radio restarting, not Host disconnected');
  ok(/Radio restarting/.test(await t('#liv_inline .liv-when')), 'Live Status shows the restart banner');
  const g0 = log.liveGets; await sleep(2500); ok(cycling, "still restarting at the end of the window");
  ok(log.liveGets === g0, 'Live Status made no router reads during the restart (' + g0 + ' -> ' + log.liveGets + ')');
  ok(await page.locator('#dash_radio [data-a=lock]').isDisabled(), 'controls disabled during the restart');
  await page.waitForFunction(() => !window.MatchiRadio.isBusy(), null, { timeout: 20000 });
  await page.waitForTimeout(800);
  ok(log.liveGets > g0, 'one live read after the restart (' + log.liveGets + ')');
  ok(/Registered/.test(await t('#dash_radio .dr-s')), 'status: registered');
  ok(/locked now: B1 B3 B8/.test(await t('#dash_radio .dr-l')) && /on/.test(await cls('lte', 8)), 'card re-read: B8 is now on, from the router');
  ok(/Host connected/.test(await t('#hostlabel')), 'host pill back to connected');
  ok(!/Radio restarting/.test(await t('#liv_inline .liv-when')), 'banner gone');
  ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
  await b.close(); process.exit(fails ? 1 : 0);
})();

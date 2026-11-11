// Browser test, dashboard "Cell lock" card against a fake router: closed by default and no cell reads until opened, serving-cell shortcut,
// bare-number neighbour asks for the type, lock sends CELL_LOCK with no radio restart, auto-unlock fires when not registered,
// Lock buttons off while bands are pending, Unlock all always on.
// usage: node test_dash_cell_browser.js INDEX_HTML     (needs Playwright; not part of validate.sh)
const { chromium } = require('playwright'); const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext();
  await ctx.addInitScript(() => { try { sessionStorage.setItem('matchi_token', 'T'); localStorage.setItem('liv_mode', 'eco'); localStorage.removeItem('matchi_cell_auto'); localStorage.removeItem('matchi_cell_watch'); } catch (_) {} });
  const page = await ctx.newPage(); const errors = [];
  const router = { locked: [], registered: true };
  const log = { sets: [], cellReads: 0, sfun: 0 };
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (r) => {
    const req = r.request(), u = new URL(req.url()); if (u.hostname !== 'localhost') return r.abort();
    if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: html });
    const j = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const body = (() => { try { return JSON.parse(req.postData() || '{}'); } catch (_) { return {}; } })();
    if (u.pathname === '/api/zte') {
      const p = body.params || {};
      if (body.op === 'set') {
        log.sets.push(p);
        if (p.goformId === 'CELL_LOCK') router.locked = [{ pci: p.pci, earfcn: p.earfcn, rat: p.rat }];
        if (p.goformId === 'UNLOCK_ALL_CELL') router.locked = [];
        return j({ success: true, data: { result: 'success' } });
      }
      const cmd = p.cmd || '';
      if (/neighbor_cell_info/.test(cmd)) { log.cellReads++; return j({ success: true, data: { neighbor_cell_info: [{ band: 'n78', earfcn: '636666', pci: '120', rsrp: '-98', rsrq: '-11', sinr: '7' }, { band: '3', earfcn: '1850', pci: '301', rsrp: '-104', rsrq: '-12', sinr: '2' }], locked_cell_info: router.locked } }); }
      if (/nr5g_pci/.test(cmd)) return j({ success: true, data: { network_type: '5G', nr5g_pci: '120', nr5g_action_channel: '636666', nr5g_action_band: 'n78' } });
      if (/lte_band_lock/.test(cmd)) return j({ success: true, data: { lte_band_lock: '1,3', nr_band_lock: '78' } });
      if (/net_select/.test(cmd)) return j({ success: true, data: { net_select: 'WL_AND_5G', performance_mode: '0' } });
      return j({ success: true, data: { network_type: '5G', signalbar: '4' } });
    }
    if (u.pathname === '/api/shell') { if (/SFUN/.test(body.cmd || '')) log.sfun++; return j({ success: true, content: '' }); }
    if (u.pathname === '/api/at') { const c = body.command || ''; if (/support_band/.test(c)) return j({ success: true, result: '+SP5GCMDS: get nr support_band,2,78,41\nOK' }); if (/REG/.test(c)) return j({ success: true, result: router.registered ? '+CEREG: 2,1,"1","2",7\nOK' : '+CEREG: 2,0\nOK' }); return j({ success: true, result: 'OK' }); }
    if (u.pathname === '/api/ping') return j({ ok: true, version: require('../version.js').name });
    if (u.pathname === '/api/plugins') return j([]);
    return j({});
  });
  await page.goto('http://localhost/'); await page.waitForTimeout(800);
  const t = (sel) => page.locator(sel).first().innerText();
  ok(await page.evaluate(() => { const c = document.getElementById('dash_cell'), r = document.getElementById('dash_radio'); return !!c && !!r && r.nextElementSibling === c; }), 'card sits right under Radio settings');
  ok(!(await page.locator('#dash_cell .dc-body').isVisible()), 'closed by default');
  ok(log.cellReads === 0, 'no cell read before the card is opened');
  ok(await page.locator('#dash_cell [data-a=unlock]').isEnabled(), 'Unlock all cells is visible and enabled while closed');
  await page.locator('#dash_cell [data-a=toggle]').click(); await page.waitForTimeout(500);
  ok(log.cellReads === 1, 'opening reads the cells once');
  ok(/none/.test(await t('#dash_cell .dc-dyn')), 'locked now: none');
  ok(/5G · n78 · EARFCN 636666 · PCI 120/.test(await t('#dash_cell .dc-cell')), 'serving cell shown from the dashboard values');
  ok(await page.locator('#dash_cell .dc-cell select[data-a=nbrat]').count() === 1, 'only the bare-number neighbour (band "3") asks for 4G / 5G');
  await page.locator('#dash_cell [data-a=nb][data-i="1"]').click();
  ok(log.sets.length === 0, 'nothing sent for the untyped neighbour');
  // lock the serving cell
  await page.locator('#dash_cell [data-a=sv]').click(); await page.locator('.cok').click(); await page.waitForTimeout(600);
  ok(log.sets.length === 1 && log.sets[0].goformId === 'CELL_LOCK' && log.sets[0].pci === '120' && log.sets[0].earfcn === '636666' && log.sets[0].rat === '16', 'CELL_LOCK 120 / 636666 / 5G sent');
  ok(log.sfun === 0, 'no radio restart after a cell lock');
  ok(/5G · EARFCN 636666 · PCI 120/.test(await t('#dash_cell .dc-dyn')), 'locked now shows the cell from the router');
  ok(await page.evaluate(() => !!localStorage.getItem('matchi_cell_watch')), 'auto-unlock check is pending');
  // pending band ticks turn the Lock buttons off, Unlock all stays on
  await page.locator('#dash_radio .dr-b[data-t="lte"][data-b="8"]').click();
  ok(await page.locator('#dash_cell [data-a=sv]').isDisabled(), 'Lock buttons off while bands are ticked but not saved');
  ok(await page.locator('#dash_cell [data-a=unlock]').isEnabled(), 'Unlock all cells still enabled');
  await page.locator('#dash_radio [data-a=reset]').click();
  ok(await page.locator('#dash_cell [data-a=sv]').isEnabled(), 'Lock buttons back after Reset ticks');
  // unlock
  await page.locator('#dash_cell [data-a=unlock]').click(); await page.locator('.cok').click(); await page.waitForTimeout(600);
  ok(log.sets[log.sets.length - 1].goformId === 'UNLOCK_ALL_CELL' && /none/.test(await t('#dash_cell .dc-dyn')), 'Unlock all cells -> none');
  ok(await page.evaluate(() => !localStorage.getItem('matchi_cell_watch')), 'pending auto-unlock cleared');
  ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
  await b.close(); process.exit(fails ? 1 : 0);
})();

// Phase 0 harness: load MatchiTOOL index.html in Chromium with a stubbed /api, run each plugin alone, report what breaks.
// usage: node run_plugins.js INDEX_HTML PLUGIN_DIR [mode=js|html]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [, , INDEX, DIR, MODE = 'auto'] = process.argv;
const html = fs.readFileSync(INDEX, 'utf8');
const files = fs.readdirSync(DIR).filter((f) => /\.(js|txt)$/.test(f)).sort();

(async () => {
  const browser = await chromium.launch();
  const rows = [];
  const snap = () => { const ids = [...document.querySelectorAll('[id]')].map((e) => e.id); const btns = [...document.querySelectorAll('button')].map((b) => b.textContent.trim()); return { ids, btns }; };
  let base = null;
  for (const f of ['__baseline__', ...files]) {
    const code = f === '__baseline__' ? '' : fs.readFileSync(path.join(DIR, f), 'utf8');
    const isHtml = MODE === 'html' || (MODE === 'auto' && /^\s*</.test(code));
    const plugin = f === '__baseline__' ? { name: 'x.js', kind: 'js', enabled: true, code: '' } : (isHtml)
      ? { name: 'p.html', kind: 'html', title: f, enabled: true, code: /^\s*</.test(code) ? code : `<script>${code}</script>` }
      : { name: 'p.js', kind: 'js', enabled: true, code };
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('matchi_token', 'T'); } catch (_) {} });
    const page = await ctx.newPage();
    const rec = { api: [], shell: [], errors: [], consoleErr: [], ext: [] };
    page.on('pageerror', (e) => rec.errors.push(String(e.message).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error') rec.consoleErr.push(m.text().slice(0, 140)); });
    await page.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.hostname !== 'localhost') { rec.ext.push(u.hostname); return route.abort(); }
      if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: html });
      if (!u.pathname.startsWith('/api/')) return route.fulfill({ status: 404, body: '' });
      const req = route.request();
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch (_) {}
      const j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/api/ping') return j({ ok: true });
      if (u.pathname === '/api/plugins' && req.method() === 'GET') return j([plugin]);
      if (u.pathname === '/api/shell') {
        rec.shell.push(String(body.cmd).replace(/\s+/g, ' ').slice(0, 90));
        const c = String(body.cmd);
        return j({ content: /whoami/.test(c) ? 'root' : /\|\| echo 0|&& echo 1/.test(c) ? '0' : '', success: true });
      }
      rec.api.push(req.method() + ' ' + u.pathname);
      return j({});
    });
    await page.goto('http://localhost/');
    await page.waitForTimeout(2500);
    if (f === '__baseline__') { base = await page.evaluate(snap); await ctx.close(); continue; }
    const info = await page.evaluate((b0) => ({
      buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => t && !b0.btns.includes(t)),
      injected: !!document.querySelector('[data-plugin]') || !!document.querySelector('script[data-ufi]'),
      has: ['getData', 'postData', 'login', 'checkAdvancedFunc', 'encodeBase64', 'createModal', 'createFixedToast', 'formatBytes', 'requestInterval', 'uploadFileKano']
        .filter((n) => typeof window[n] !== 'function'),
      cbm: !!document.getElementById('collapseBtn_menu'), feimao: !!document.getElementById('FEIMAO_MANAGER'), udc: !!document.getElementById('IFRAME_UFI_DEVCTRL'),
      fc: !!document.querySelector('.functions-container'),
    }), base);
    // try the plugin's main button: click the last button in .actions-buttons / collapse_box if it exists
    let clickRes = 'no new button';
    const before = await page.evaluate(snap);
    const clicked = await page.evaluate((b0) => { const l = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() && !b0.btns.includes(b.textContent.trim())); if (!l.length) return null; l[0].click(); return l[0].textContent.trim(); }, base);
    if (clicked) {
      await page.waitForTimeout(2500);
      const after = await page.evaluate(snap);
      const newIds = after.ids.filter((i) => !before.ids.includes(i));
      clickRes = `clicked "${clicked}" -> new ids: ${newIds.slice(0, 8).join(',') || 'none'}`;
    }
    const safe = f.replace(/[^\x20-\x7e]/g, '').slice(0, 28) || f.slice(0, 8);
    await page.screenshot({ path: path.join(__dirname, `shot_${MODE}_${safe.replace(/[^A-Za-z0-9]/g, '_')}_${files.indexOf(f)}.png`) });
    rows.push({ file: files.indexOf(f) + ' ' + safe, ...rec, info, clickRes });
    await ctx.close();
  }
  await browser.close();
  for (const r of rows) {
    console.log(`\n### ${r.file}`);
    console.log('  page errors :', r.errors.length ? [...new Set(r.errors)].join(' | ') : 'none');
    console.log('  console err :', [...new Set(r.consoleErr)].slice(0, 3).join(' | ') || 'none');
    console.log('  not defined :', r.info.has.join(', ') || '-', '| #collapseBtn_menu:', r.info.cbm, '| .functions-container:', r.info.fc);
    console.log('  panels      : FEIMAO', r.info.feimao, '| UFI_DEVCTRL', r.info.udc);
    console.log('  buttons     :', JSON.stringify(r.info.buttons));
    console.log('  after click :', r.clickRes);
    console.log('  shell cmds  :', r.shell.length, r.shell.slice(0, 3).join(' ;; '));
    console.log('  api calls   :', [...new Set(r.api)].join(', ') || '-');
    if (r.ext.length) console.log('  external    :', [...new Set(r.ext)].join(', '));
  }
})();

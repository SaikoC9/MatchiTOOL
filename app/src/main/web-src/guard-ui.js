/* guard-ui.js: the "Plugin guard" card on the home page (matchi-guard, tools/guard). Pure text helpers (tested by scripts/test_guard_ui.js) and the card.
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
  function actionLine(a) {
    const t = a.ts ? new Date(a.ts * 1000).toTimeString().slice(0, 8) + '  ' : '';
    return t + a.what + (a.plugin ? ' ' + a.plugin : '') + (a.comm ? ' (' + a.comm + (a.pid ? ' ' + a.pid : '') + ')' : '') + (a.why ? ': ' + a.why : '');
  }
  const H = { norm, plugRows, actionList, fmtMem, fmtCpu, statusLine, actionLine, STATE, REFRESH_MS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = H; return; }
  if (typeof document === 'undefined') return;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const css = document.createElement('style');
  css.textContent = '#guardCard{margin-top:10px;border-top:1px solid var(--bd);padding-top:8px}' +
    '#guardCard .gd-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}#guardCard .gd-title{font-weight:700;font-size:13px}' +
    '#guardCard .gd-st{font-size:11px;color:var(--mut);flex:1;min-width:140px}#guardCard .gd-st.ok{color:var(--good)}' +
    '#guardCard table{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:6px}#guardCard th{font-weight:600;color:var(--mut);text-align:left;padding:2px 6px 2px 0}' +
    '#guardCard td{padding:2px 6px 2px 0;border-top:1px solid var(--bd)}#guardCard td.n,#guardCard th.n{text-align:right}' +
    '#guardCard .gd-bad{color:var(--danger);font-weight:650}#guardCard .gd-log{margin-top:6px;font-size:11px;color:var(--mut);white-space:pre-wrap;word-break:break-word}' +
    '#guardCard .gd-note{font-size:10.5px;color:var(--mut);margin-top:6px}';
  document.head.appendChild(css);

  let box = null, st = null, body = null, sw = null, timer = 0, busy = false, loaded = false;
  function draw(s) {
    st.textContent = statusLine(s); st.className = 'gd-st' + (s.running ? ' ok' : '');
    sw.hidden = !s.available && !s.on; sw.textContent = s.on ? 'Turn off' : 'Turn on'; sw.setAttribute('aria-pressed', String(s.on));
    body.textContent = '';
    if (!s.report) return;
    const tb = el('table'), hd = el('tr');
    for (const [h, n] of [['Plugin', 0], ['CPU', 1], ['Limit', 1], ['Memory', 1], ['Procs', 1], ['State', 0]]) hd.appendChild(el('th', n ? 'n' : '', h));
    tb.appendChild(hd);
    if (!s.rows.length) { const r = el('tr'), c = el('td', '', 'No plugin processes running'); c.colSpan = 6; r.appendChild(c); tb.appendChild(r); }
    for (const p of s.rows) {
      const r = el('tr');
      r.appendChild(el('td', '', p.name)); r.appendChild(el('td', 'n', fmtCpu(p.cpu))); r.appendChild(el('td', 'n', fmtCpu(p.budget)));
      r.appendChild(el('td', 'n', fmtMem(p.rss))); r.appendChild(el('td', 'n', String(p.procs)));
      r.appendChild(el('td', p.state === 'ok' ? '' : 'gd-bad', STATE[p.state]));
      tb.appendChild(r);
    }
    body.appendChild(tb);
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
    const head = el('div', 'gd-head'); st = el('span', 'gd-st', 'Loading'); sw = el('button', 'liv-chip', 'Turn on'); sw.type = 'button'; sw.hidden = true;
    const rf = el('button', 'liv-chip', 'Refresh'); rf.type = 'button';
    head.appendChild(el('span', 'gd-title', 'Plugin guard')); head.appendChild(st); head.appendChild(sw); head.appendChild(rf);
    body = el('div'); box.appendChild(head); box.appendChild(body); home.appendChild(box);
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

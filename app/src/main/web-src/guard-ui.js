/* guard-ui.js: the "Plugin guard" card on the home page (matchi-guard, tools/guard). Pure text helpers (tested by scripts/test_guard_ui.js) and the card: a box and buttons like the Radio settings card, the state with small info pills, and the plugin table.
   GET /api/guard/report is one small file read on the phone, so the card refreshes slowly (every 30 seconds while visible, or on demand).
   POST /api/guard/state {on, interval?} starts or ends the root process and needs the sign-in gate like every root action. The card never builds markup from text. */
(function () {
  'use strict';
  const REFRESH_MS = 30000, ROWS_MAX = 12, ACTIONS_MAX = 6;
  const STATE = { ok: 'OK', throttled: 'Limited', frozen: 'Frozen', killed: 'Stopped' };
  const WHAT = { throttle: 'Limited', release: 'Released', freeze: 'Frozen', thaw: 'Resumed', kill: 'Stopped', 'kill-helper': 'Ended stuck helper' };
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const str = (v, n) => (typeof v === 'string' ? v : '').slice(0, n || 80);

  /** Host answer -> a plain object; anything unexpected becomes "off, no report". */
  function norm(j) {
    const r = j && typeof j.report === 'object' && j.report && j.report.v === 1 ? j.report : null;
    return {
      interval: [1, 5, 10].includes(num(j && j.interval)) ? num(j && j.interval) : 10,
      on: !!(j && j.on), available: !!(j && j.available), running: !!(j && j.running && r),
      now: num(j && j.now), report: r,
      rows: r ? plugRows(r) : [], actions: r ? actionList(r) : [], others: r ? otherRows(r) : [],
    };
  }
  function plugRows(r) {
    const list = Array.isArray(r.plugins) ? r.plugins : [];
    return list.filter((p) => p && typeof p.name === 'string' && num(p.procs) > 0).map((p) => ({
      name: str(p.name, 48), cpu: Math.round(num(p.cpu_pct)), budget: Math.round(num(p.budget_pct)), rss: num(p.rss_kb), procs: num(p.procs),
      state: STATE[p.state] ? p.state : 'ok', strikes: num(p.strikes),
    })).sort((a, b) => b.cpu - a.cpu || a.name.localeCompare(b.name)).slice(0, ROWS_MAX);
  }
  /** Busy processes that carry no plugin tag (the guard cannot tell whose they are): shown so nothing hides from the table. */
  function otherRows(r) {
    const list = Array.isArray(r.others) ? r.others : [];
    return list.filter((o) => o && typeof o.comm === 'string').map((o) => ({ pid: num(o.pid), comm: str(o.comm, 24), cpu: Math.round(num(o.cpu_pct)), rss: num(o.rss_kb) })).sort((a, b) => b.cpu - a.cpu).slice(0, 5);
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
  const INTERVALS = [1, 5, 10];
  const H = { norm, INTERVALS, plugRows, otherRows, actionList, fmtMem, fmtCpu, statusLine, statusParts, actionLine, STATE, REFRESH_MS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = H; return; }
  if (typeof document === 'undefined') return;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const css = document.createElement('style');
  // Same box and same buttons as the Radio settings card (dash-radio.js): the page's own button style, only made smaller.
  css.textContent = '#guardCard{margin-top:12px;background:#0a1626;border:1px solid var(--bd);border-radius:12px;padding:10px 12px;font-size:12px}' +
    '#guardCard .gd-top{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
    '#guardCard .gd-title{font-weight:800;font-size:13px}' +
    '#guardCard .gd-btns{display:flex;gap:6px;flex-shrink:0}' +
    '#guardCard button{min-height:28px;padding:3px 10px;font-size:12px;border-radius:7px}' +
    '#guardCard .gd-stat{display:flex;align-items:center;flex-wrap:wrap;gap:4px 6px;margin-top:6px}' +
    '#guardCard .gd-state{display:flex;align-items:center;gap:6px;font-weight:700;font-size:12px;color:var(--mut)}' +
    '#guardCard .gd-dot{width:7px;height:7px;border-radius:50%;background:var(--mut);box-shadow:0 0 0 2px rgba(145,165,194,.2)}' +
    '#guardCard .gd-state.ok{color:var(--good)}#guardCard .gd-state.ok .gd-dot{background:var(--good);box-shadow:0 0 0 2px rgba(40,217,154,.22)}' +
    '#guardCard .gd-state.bad{color:var(--danger)}#guardCard .gd-state.bad .gd-dot{background:var(--danger);box-shadow:0 0 0 2px rgba(255,100,124,.22)}' +
    '#guardCard .gd-state.wait .gd-dot{background:var(--acc2);box-shadow:0 0 0 2px rgba(85,182,255,.22)}' +
    '#guardCard .gd-iv{display:flex;align-items:center;gap:4px;margin-top:6px;flex-wrap:wrap}#guardCard .gd-iv span{color:var(--mut);font-size:11px;margin-right:2px}' +
    '#guardCard .gd-iv[hidden]{display:none}' +
    '#guardCard .gd-iv select{min-height:26px;padding:2px 8px;font-size:12px;border-radius:7px}' +
    '#guardCard .gd-note1{font-weight:500;font-size:11px;color:var(--mut)}' +
    '#guardCard .gd-pill{font-size:10.5px;font-weight:600;color:var(--mut);border:1px solid var(--bd);border-radius:999px;padding:1px 7px;white-space:nowrap}' +
    '#guardCard .gd-tbl{overflow-x:auto;margin-top:6px}' +
    '#guardCard table{width:100%;border-collapse:collapse;font-size:11.5px}#guardCard th{font-weight:600;color:var(--mut);text-align:left;padding:2px 6px 3px 0;white-space:nowrap}' +
    '#guardCard td{padding:4px 6px 4px 0;border-top:1px solid var(--bd)}#guardCard td.gd-n,#guardCard th.gd-n{text-align:right;white-space:nowrap}#guardCard td:first-child{overflow-wrap:anywhere}#guardCard td:last-child,#guardCard th:last-child{padding-right:0}' +
    '#guardCard .gd-ok{color:var(--good);font-weight:700}#guardCard .gd-bad{color:var(--danger);font-weight:700}' +
    '#guardCard .gd-log{margin-top:6px;font-size:10.5px;color:var(--mut);white-space:pre-wrap;word-break:break-word}' +
    '#guardCard .gd-note{font-size:10.5px;color:var(--mut);margin-top:6px;line-height:1.4}';
  document.head.appendChild(css);

  let box = null, stBox = null, sw = null, ivBox = null, ivSel = null, body = null, timer = 0, busy = false, loaded = false;
  function draw(s) {
    const p = statusParts(s);
    stBox.textContent = '';
    const line = el('div', 'gd-state ' + p.tone); line.appendChild(el('span', 'gd-dot')); line.appendChild(el('span', '', p.word));
    stBox.appendChild(line);
    if (p.note) stBox.appendChild(el('span', 'gd-note1', p.note));
    for (const t of p.pills) stBox.appendChild(el('span', 'gd-pill', t));
    sw.hidden = !s.available && !s.on; sw.textContent = s.on ? 'Turn off' : 'Turn on'; sw.setAttribute('aria-pressed', String(s.on));
    ivSel.value = String(s.interval);
    ivBox.hidden = !s.available;
    body.textContent = '';
    if (!s.report) return;
    const wrap = el('div', 'gd-tbl'), tb = el('table'), hd = el('tr');
    for (const [h, n] of [['Plugin', 0], ['CPU', 1], ['Limit', 1], ['Memory', 1], ['Procs', 1], ['State', 0]]) hd.appendChild(el('th', n ? 'gd-n' : '', h));
    tb.appendChild(hd);
    if (!s.rows.length) { const r = el('tr'), c = el('td', '', 'No plugin processes running'); c.colSpan = 6; r.appendChild(c); tb.appendChild(r); }
    for (const p of s.rows) {
      const r = el('tr');
      r.appendChild(el('td', '', p.name.replace(/_/g, '_\u200b')));   // a long name can wrap after an underscore
      r.appendChild(el('td', 'gd-n', fmtCpu(p.cpu))); r.appendChild(el('td', 'gd-n', fmtCpu(p.budget)));
      r.appendChild(el('td', 'gd-n', fmtMem(p.rss))); r.appendChild(el('td', 'gd-n', String(p.procs)));
      r.appendChild(el('td', p.state === 'ok' ? 'gd-ok' : 'gd-bad', STATE[p.state]));
      tb.appendChild(r);
    }
    wrap.appendChild(tb); body.appendChild(wrap);
    if (s.others.length) body.appendChild(el('div', 'gd-log', 'Busy, no plugin tag (not limited):\n' + s.others.map((o) => o.comm + ' (' + o.pid + ')  ' + fmtCpu(o.cpu) + '  ' + fmtMem(o.rss)).join('\n')));
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
    const top = el('div', 'gd-top'), btns = el('div', 'gd-btns');
    stBox = el('div', 'gd-stat'); const st0 = el('div', 'gd-state wait'); st0.appendChild(el('span', 'gd-dot')); st0.appendChild(el('span', '', 'Loading')); stBox.appendChild(st0);
    sw = el('button', '', 'Turn on'); sw.type = 'button'; sw.hidden = true;
    const rf = el('button', '', 'Refresh'); rf.type = 'button';
    btns.appendChild(sw); btns.appendChild(rf); top.appendChild(el('span', 'gd-title', 'Plugin guard')); top.appendChild(btns);
    ivBox = el('div', 'gd-iv'); ivBox.hidden = true; ivBox.appendChild(el('span', '', 'Check every'));
    ivSel = el('select'); ivSel.setAttribute('aria-label', 'Check every');   // the page turns every select into its own popup (pick-ui.js)
    for (const n of INTERVALS) { const o = el('option', '', n + ' s'); o.value = String(n); ivSel.appendChild(o); }
    ivBox.appendChild(ivSel);
    ivBox.appendChild(el('span', '', '1 s uses about 2.5 % of one core'));
    body = el('div'); box.appendChild(top); box.appendChild(stBox); box.appendChild(ivBox); box.appendChild(body); home.appendChild(box);
    // Fixed place: right after the Radio settings card. That card is added by another script at its own time, so on a fresh sign-in this card used
    // to land above it and after a reload below it. Keep it after #dash_radio whenever that card appears (only moved when out of place).
    const place = () => { const rad = document.getElementById('dash_radio'); if (rad && rad.parentNode === home && rad.nextElementSibling !== box) rad.after(box); };
    place();
    try { new MutationObserver(place).observe(home, { childList: true }); } catch (e) { setTimeout(place, 1500); setTimeout(place, 5000); }
    rf.onclick = () => load(false);
    ivSel.onchange = async () => {
      if (busy) return; busy = true; ivSel.disabled = true;
      const n = Number(ivSel.value);
      try { draw(norm(await api('/api/guard/state', { method: 'POST', body: JSON.stringify({ on: sw.getAttribute('aria-pressed') === 'true', interval: n }) }))); createToast('Plugin guard checks every ' + n + ' s', 'green'); setTimeout(() => load(true), 3000); }
      catch (e) { createToast(String((e && e.message) || e).slice(0, 120), 'red'); load(true); }
      finally { busy = false; ivSel.disabled = false; }
    };
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

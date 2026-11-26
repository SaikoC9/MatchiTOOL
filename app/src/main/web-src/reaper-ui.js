/* reaper-ui.js: the "Wipe on uninstall" button in the home tool row and its popup (a .card.pop, like Terminal): the switch "Wipe everything when MatchiTOOL is uninstalled",
   a status line with what is really installed and running, and the read-only list of what the wipe removes and what it leaves.
   The host (WebRoutesReaper.kt) sends the texts and the list (built from Footprint.kt); this file only shows them and never builds markup from text.
   GET /api/reaper (saved switch, texts, list) needs no sign-in beyond the session; GET /api/reaper/status and POST /api/reaper need the fresh sign-in (root).
   Pure helpers (statusView, offAsk) are tested by scripts/test_reaper_ui.js. */
(function () {
  'use strict';

  /* What the status line says. [st] = answer of GET /api/reaper/status, [enabled] = the saved switch, [err] = a message when the state could not be read.
     Returns {text, level}: level is good (all in order), warn (needs attention), bad (cannot work) or mut (neutral). Nothing is claimed that the host did not report. */
  function statusView(st, enabled, err) {
    if (err) return { text: 'Can\'t read state: ' + String(err), level: 'warn' };
    if (!st) return { text: 'Checking…', level: 'mut' };
    if (st.ok === false) return { text: 'Can\'t read state: ' + String(st.error || 'root did not answer'), level: 'warn' };
    const ver = st.installedVersion != null ? ' (version ' + st.installedVersion + ')' : '';
    if (!enabled) {
      if (st.installed || st.running || st.stub) return { text: 'Off, but the watcher is still there. Turn on, then off, to remove it.', level: 'warn' };
      return { text: 'Off. Nothing is watching. The items below stay after uninstall.', level: 'warn' };
    }
    if (!st.installed) return { text: 'Not installed yet. It installs soon after the host starts. Press Check again.', level: 'warn' };
    if (!st.running) return { text: 'Installed' + ver + ', but not running. It restarts soon. Press Check again.', level: 'bad' };
    if (!st.stub || st.stubCurrent === false) return { text: 'Watching' + ver + ', but the boot script is missing or old. After a reboot nothing watches until the host starts.', level: 'warn' };
    if (st.outdated) return { text: 'Watching' + ver + '. Updates to version ' + st.bundledVersion + ' at the next host start.', level: 'good' };
    return { text: 'Watching' + ver + '. Boot script in place.', level: 'good' };
  }

  /* The confirmation before the switch is turned OFF (the person is about to leave root-side leftovers behind). */
  function offAsk(offText) {
    return String(offText || '') + '\n\nTurn it off anyway?';
  }

  const H = { statusView, offAsk };
  if (typeof module !== 'undefined' && module.exports) { module.exports = H; return; }
  if (typeof document === 'undefined') return;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const css = document.createElement('style');
  css.textContent = 'header .hd-tool{height:22px;min-height:0!important;padding:0 9px!important;font-size:10.5px!important;line-height:1!important;font-weight:600!important;border-radius:999px!important;color:var(--fg)!important;background:transparent!important;border:1px solid rgba(255,255,255,.22)!important;box-shadow:none!important;transform:none!important;flex:none;margin:0!important;width:auto!important;white-space:nowrap}header #hdTools{display:flex;flex:none;gap:6px;align-items:center;margin-right:6px}header .hd-tool:hover{background:rgba(255,255,255,.08)!important}' +
    '#reaperpop .rp-t{margin:0 0 2px;font-size:11.5px;font-weight:700;color:var(--fg)}' +
    '#reaperpop .rp-p{color:var(--mut);font-size:12px;line-height:1.4;margin:6px 0}' +
    '#reaperpop .rp-sw{display:flex;align-items:center;gap:10px;margin:10px 0 4px;font-size:13px;font-weight:700}' +
    '#reaperpop .rp-tog{position:relative;flex:0 0 auto;width:38px;min-width:38px;height:22px;min-height:0!important;padding:0!important;border:0!important;border-radius:999px!important;background:rgba(255,255,255,.22)!important;box-shadow:none!important;transform:none!important;transition:background-color .2s}' +
    /* The page's popup-button rule (html body .card.pop.open:not(#pluginmgr)... button) forces width:auto / height:26px / padding on every popup button and squashed the switch; this one outranks it. */
    'html body #reaperpop.card.pop.open:not(#_):not(#__):not(#___):not(#____) .rp-tog{box-sizing:border-box!important;width:38px!important;min-width:38px!important;max-width:38px!important;height:22px!important;min-height:22px!important;padding:0!important;border-radius:999px!important}' +
    '#reaperpop .rp-tog::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .2s}' +
    '#reaperpop .rp-tog[aria-checked=true]{background:rgba(100,230,164,.75)!important}#reaperpop .rp-tog[aria-checked=true]::after{transform:translateX(16px)}' +
    '#reaperpop .rp-tog:disabled{opacity:.5}' +
    '#reaperpop .rp-st{display:flex;gap:8px;align-items:flex-start;border:1px solid var(--bd);border-radius:10px;padding:8px 10px;margin:8px 0;font-size:12px;line-height:1.4}' +
    '#reaperpop .rp-dot{flex:0 0 auto;width:9px;height:9px;margin-top:4px;border-radius:50%;background:#64748b}' +
    '#reaperpop .rp-st.good .rp-dot{background:var(--good)}#reaperpop .rp-st.warn .rp-dot{background:#f5b942}#reaperpop .rp-st.bad .rp-dot{background:var(--danger)}' +
    '#reaperpop .rp-g{border-top:1px solid var(--bd);padding:6px 0}#reaperpop .rp-gt{font-weight:700;font-size:12px;margin-bottom:2px}' +
    '#reaperpop .rp-g ul{margin:0;padding-left:18px;color:var(--mut);font-size:11.5px;line-height:1.4;overflow-wrap:anywhere}' +
    '#reaperpop .rp-note{border-top:1px solid var(--bd);padding-top:8px;margin-top:4px;color:var(--fg);font-size:12px;line-height:1.4}';
  document.head.appendChild(css);

  let info = null, st = null, stErr = '', busy = false, ui = null;

  function paint() {
    if (!ui) return;
    const on = !!(info && info.enabled);
    ui.tog.setAttribute('aria-checked', String(on)); ui.tog.disabled = busy || !info;
    ui.state.textContent = info ? (on ? 'On' : 'Off') : '…';
    ui.warn.textContent = info ? (on ? info.onText : info.offText) : '';
    const v = statusView(st, on, stErr);
    ui.st.className = 'rp-st ' + v.level; ui.stText.textContent = v.text;
    ui.check.disabled = busy;
  }

  function fill() {
    if (!ui || !info) return;
    ui.list.textContent = '';
    for (const g of info.removed || []) {
      const box = el('div', 'rp-g'); box.appendChild(el('div', 'rp-gt', g.title));
      const ul = el('ul'); for (const l of g.lines || []) ul.appendChild(el('li', '', l));
      box.appendChild(ul); ui.list.appendChild(box);
    }
    ui.plugin.textContent = info.pluginNote || ''; ui.note.textContent = info.notRestored || '';
  }

  async function loadInfo() {
    try { info = await api('/api/reaper', { quiet: true }); fill(); } catch (e) { info = null; stErr = e.message; }
    paint();
  }
  async function check() {
    busy = true; stErr = ''; paint();
    try { st = await api('/api/reaper/status'); } catch (e) { st = null; stErr = e.message; }
    busy = false; paint();
  }
  async function flip() {
    if (!info || busy) return;
    const want = !info.enabled;
    if (!want && !(await askConfirm(offAsk(info.offText), 'Turn off', true))) return;
    busy = true; paint();
    try {
      const r = await api('/api/reaper', { method: 'POST', body: JSON.stringify({ enabled: want }) });
      void r;   // the switch and the list are read again below, so the page shows the saved state, not a guess
      try { createToast(want ? 'Wipe on uninstall: on' : 'Wipe on uninstall: off', want ? 'green' : 'blue'); } catch (_) { /* not fatal */ }
    } catch (e) {
      try { createToast('Not changed: ' + e.message, 'red', 6000); } catch (_) { /* not fatal */ }
    }
    busy = false; await loadInfo(); await check();
  }

  function build() {
    const c = el('div', 'card pop'); c.id = 'reaperpop';
    c.appendChild(el('div', 'rp-t', 'Wipe everything on uninstall'));
    const sw = el('div', 'rp-sw'), tog = el('button', 'rp-tog'); tog.type = 'button'; tog.setAttribute('role', 'switch'); tog.setAttribute('aria-label', 'Wipe everything on uninstall');
    const state = el('span', '', '…'); sw.appendChild(tog); sw.appendChild(state); c.appendChild(sw);
    const warn = el('p', 'rp-p'); c.appendChild(warn);
    const stBox = el('div', 'rp-st mut'), dot = el('span', 'rp-dot'), stText = el('span', '', 'Checking…'); stBox.appendChild(dot); stBox.appendChild(stText); c.appendChild(stBox);
    const check_ = el('button', '', 'Check again'); check_.type = 'button'; c.appendChild(check_);
    c.appendChild(el('div', 'rp-t', 'What gets removed')); c.lastChild.style.marginTop = '12px';
    const list = el('div'); c.appendChild(list);
    const plugin = el('p', 'rp-p'); c.appendChild(plugin);
    const note = el('div', 'rp-note'); c.appendChild(note);
    const foot = el('div', 'popfoot'), x = el('button', 'popx', 'Close'); x.type = 'button'; x.onclick = () => closePop();
    foot.appendChild(x); c.appendChild(foot);
    (document.querySelector('main') || document.body).appendChild(c);
    ui = { tog, state, warn, st: stBox, stText, check: check_, list, plugin, note };
    tog.onclick = flip; check_.onclick = check;
  }

  function mount() {
    const hd = document.querySelector('header'); if (!hd || document.getElementById('reaperBtn')) return;
    const btn = el('button', 'hd-tool', 'Wipe on uninstall'); btn.id = 'reaperBtn'; btn.type = 'button'; btn.title = 'Wipe everything on uninstall';
    btn.onclick = () => { if (!document.getElementById('reaperpop')) build(); openPop('reaperpop'); paint(); loadInfo().then(check); };
    let w = document.getElementById('hdTools');
    if (!w) { w = el('span'); w.id = 'hdTools'; hd.insertBefore(w, hd.querySelector('#langsel') || hd.querySelector('#logoutbtn')); }
    w.appendChild(btn);
  }
  window.addEventListener('load', () => setTimeout(mount, 1000));
})();

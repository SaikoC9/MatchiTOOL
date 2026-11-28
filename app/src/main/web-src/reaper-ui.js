/* reaper-ui.js: the "Wipe on uninstall" button in the home tool row and its popup (a .card.pop, like Terminal): the switch "Wipe everything when MatchiTOOL is uninstalled",
   a status line with what is really installed and running, and the read-only list of what the wipe removes and what it leaves.
   The host (WebRoutesReaper.kt) sends the texts and the list (built from Footprint.kt); this file only shows them and never builds markup from text.
   GET /api/reaper (saved switch, texts, list) needs no sign-in beyond the session; GET /api/reaper/status and POST /api/reaper need the fresh sign-in (root).
   Pure helper (statusView) is tested by scripts/test_reaper_ui.js. */
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

  const H = { statusView };
  if (typeof module !== 'undefined' && module.exports) { module.exports = H; return; }
  if (typeof document === 'undefined') return;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const css = document.createElement('style');
  css.textContent = 'header .hd-tool{height:22px;min-height:0!important;padding:0 9px!important;font-size:10.5px!important;line-height:1!important;font-weight:600!important;border-radius:999px!important;color:var(--fg)!important;background:transparent!important;border:1px solid rgba(255,255,255,.22)!important;box-shadow:none!important;transform:none!important;flex:none;margin:0!important;width:auto!important;white-space:nowrap}header #hdTools{display:flex;flex:none;gap:6px;align-items:center;margin-right:6px}header .hd-tool:hover{background:rgba(255,255,255,.08)!important}' +
    /* Popup look: only the page's own tokens (--panel2, --bd, --fg, --mut, --acc, --acc2, --good, --danger), so it matches the rest of the web page. */
    '#reaperpop .rp-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 6px}' +
    '#reaperpop h3.rp-title{margin:0!important;flex:1 1 auto;min-width:0;font-size:17px!important;line-height:1.25;font-weight:750;color:var(--fg);overflow-wrap:anywhere}' +
    '#reaperpop .rp-sw{flex:none;display:flex}' +
    /* One button: green "On", red "Off". The page's popup-button rule (html body .card.pop.open:not(#pluginmgr)... button) sets size and padding on every popup button; this one outranks it. */
    '#reaperpop .rp-tog{min-width:64px;font-weight:750;letter-spacing:.02em;box-shadow:none!important;transform:none!important;transition:background-color .2s,border-color .2s,color .2s}' +
    'html body #reaperpop.card.pop.open:not(#_):not(#__):not(#___):not(#____) .rp-tog{box-sizing:border-box!important;min-height:30px!important;height:30px!important;padding:0 16px!important;border-radius:999px!important;font-size:12.5px!important}' +
    '#reaperpop .rp-tog[aria-checked=true]{background:#28d99a24!important;border:1px solid #28d99a!important;color:var(--good)!important}' +
    '#reaperpop .rp-tog[aria-checked=false]{background:#ff647c24!important;border:1px solid var(--danger)!important;color:var(--danger)!important}' +
    '#reaperpop .rp-tog:disabled{opacity:.5}' +
    '#reaperpop .rp-tog:focus,#reaperpop .rp-tog:focus-visible{outline:none!important;outline-offset:0!important}' +
    '#reaperpop .rp-p{color:#8fa2bf;font-size:12.5px;line-height:1.5;margin:0 0 12px!important}' +
    '#reaperpop .rp-st{display:flex;gap:11px;align-items:center;border:1px solid #1e3050;border-radius:12px;padding:10px 12px;margin:0 0 14px;background:#0c1627}' +
    '#reaperpop .rp-ic{flex:0 0 auto;width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font-size:13px;font-weight:800;line-height:1;color:#8fa2bf;background:#08111f;border:1px solid #1e3050}' +
    '#reaperpop .rp-stx{flex:1 1 auto;min-width:0}#reaperpop .rp-sh{font-size:13px;font-weight:750;color:var(--fg)}#reaperpop .rp-sd{font-size:11.5px;line-height:1.4;color:#8fa2bf;overflow-wrap:anywhere}' +
    '#reaperpop .rp-st.good{border-color:#28d99a55;background:#28d99a14}#reaperpop .rp-st.good .rp-ic{color:var(--good);background:#28d99a22;border-color:#28d99a55}' +
    '#reaperpop .rp-st.warn{border-color:#f5b94255;background:#f5b94212}#reaperpop .rp-st.warn .rp-ic{color:#f5b942;background:#f5b94222;border-color:#f5b94255}' +
    '#reaperpop .rp-st.bad{border-color:#ff647c55;background:#ff647c12}#reaperpop .rp-st.bad .rp-ic{color:var(--danger);background:#ff647c22;border-color:#ff647c55}' +
    'html body #reaperpop.card.pop.open:not(#_):not(#__):not(#___):not(#____) .rp-chk,html body #reaperpop.card.pop.open:not(#_):not(#__):not(#___):not(#____) .rp-full,html body #reaperpop.card.pop.open:not(#_):not(#__):not(#___):not(#____) .popx{background:#08111f!important;border:1px solid #2d4469!important;color:#f2f7ff!important;box-shadow:none!important;transform:none!important}html body #reaperpop.card.pop.open:not(#_):not(#__):not(#___):not(#____) .rp-chk:hover,html body #reaperpop.card.pop.open:not(#_):not(#__):not(#___):not(#____) .rp-full:hover,html body #reaperpop.card.pop.open:not(#_):not(#__):not(#___):not(#____) .popx:hover{background:#14233c!important}' +
    '#reaperpop .rp-chk{flex:none}' +
    '#reaperpop .rp-lbl{margin:0 0 6px;font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#86adea}' +
    '#reaperpop .rp-list{border:1px solid #1e3050;border-radius:12px;overflow:hidden;background:#0c1627}' +
    '#reaperpop .rp-g{display:flex;gap:11px;align-items:flex-start;padding:9px 12px;border-top:1px solid #1e3050}#reaperpop .rp-g:first-child{border-top:0}' +
    '#reaperpop .rp-gi{flex:0 0 auto;width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font-size:9px;font-weight:850;letter-spacing:.02em;color:#86adea;background:#08111f;border:1px solid #1e3050}' +
    '#reaperpop .rp-gb{flex:1 1 auto;min-width:0}#reaperpop .rp-gt{font-weight:750;font-size:13px;color:var(--fg)}' +
    '#reaperpop .rp-gd{color:#8fa2bf;font-size:11.5px;line-height:1.4;overflow-wrap:anywhere}' +
    '#reaperpop .rp-g ul{margin:3px 0 0;padding-left:16px;color:#8fa2bf;font-size:11.5px;line-height:1.45;overflow-wrap:anywhere}' +
    '#reaperpop .rp-more{margin:10px 0 0;padding-top:8px;border-top:1px solid #1e3050;color:#8fa2bf;font-size:11.5px;line-height:1.45}#reaperpop .rp-more:empty{display:none}' +
    '#reaperpop .rp-note{margin-top:6px;color:var(--fg);font-size:12px;line-height:1.45}#reaperpop .rp-note:empty{display:none}' +
    '#reaperpop .popfoot{justify-content:space-between;align-items:center;gap:10px}' +
    '@media(max-width:420px){#reaperpop .rp-hd{flex-wrap:wrap}#reaperpop .rp-st{flex-wrap:wrap}}';
  document.head.appendChild(css);

  let info = null, st = null, stErr = '', busy = false, full = false, ui = null;

  /* One short line per group for the compact list. The full text from the host shows under "Show full list"; an unknown group falls back to its first line. */
  const SHORT = {
    'Start-up entries': 'Boot scripts and boot entries of MatchiTOOL and plugins',
    'Firewall': 'Port 2334 rules, AdGuard, plugin rules, OpenWrt VM network',
    'Speed limits': 'Only limits set by MatchiTOOL. Other limits stay.',
    'Running programs': 'MatchiTOOL helpers, AdGuard Home, OpenWrt VM, plugin programs',
    'Files': 'The MatchiTOOL folder and old temp files'
  };
  const ICON = { 'Start-up entries': 'BT', 'Firewall': 'FW', 'Speed limits': 'SP', 'Running programs': 'RUN', 'Files': 'FS' };
  const LEVEL_ICON = { good: '✓', warn: '!', bad: '✕', mut: '…' };

  /* "Watching (version 8). Boot script in place." -> head "Watching", detail "Version 8 · boot script in place". Other texts keep their whole sentence as the detail under a short head. */
  function splitStatus(v, on, s) {
    if (v.level === 'mut') return { head: 'Checking…', detail: '' };
    if (v.level === 'good' && on && s && s.ok !== false) {
      const ver = s.installedVersion != null ? 'Version ' + s.installedVersion : '';
      const rest = s.outdated ? 'updates to version ' + s.bundledVersion + ' at the next host start' : 'boot script in place';
      return { head: 'Watching', detail: ver ? ver + ' · ' + rest : rest.charAt(0).toUpperCase() + rest.slice(1) };
    }
    const head = !on ? 'Off' : v.level === 'bad' ? 'Not running' : 'Needs attention';
    return { head, detail: v.text };
  }

  function paint() {
    if (!ui) return;
    const on = !!(info && info.enabled);
    ui.tog.setAttribute('aria-checked', String(on)); ui.tog.disabled = busy || !info;
    ui.tog.textContent = info ? (on ? 'On' : 'Off') : '…';
    ui.warn.textContent = info ? (on ? info.onText : info.offText) : '';
    const v = statusView(st, on, stErr), sv = splitStatus(v, on, st);
    ui.st.className = 'rp-st ' + v.level; ui.stIcon.textContent = LEVEL_ICON[v.level] || '…';
    ui.stHead.textContent = sv.head; ui.stText.textContent = sv.detail; ui.stText.style.display = sv.detail ? '' : 'none';
    ui.check.disabled = busy;
    ui.full.textContent = full ? 'Hide full list' : 'Show full list'; ui.full.setAttribute('aria-expanded', String(full));
  }

  function fill() {
    if (!ui || !info) return;
    ui.list.textContent = '';
    for (const g of info.removed || []) {
      const row = el('div', 'rp-g'), body = el('div', 'rp-gb');
      row.appendChild(el('span', 'rp-gi', ICON[g.title] || '•'));
      body.appendChild(el('div', 'rp-gt', g.title));
      const lines = g.lines || [];
      if (full) { const ul = el('ul'); for (const l of lines) ul.appendChild(el('li', '', l)); body.appendChild(ul); }
      else body.appendChild(el('div', 'rp-gd', SHORT[g.title] || lines[0] || ''));
      row.appendChild(body); ui.list.appendChild(row);
    }
    ui.more.textContent = full ? (info.pluginNote || '') : ''; ui.note.textContent = full ? (info.notRestored || '') : '';
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
    const hd = el('div', 'rp-hd'); hd.appendChild(el('h3', 'rp-title', 'Wipe on uninstall'));
    const sw = el('div', 'rp-sw'), tog = el('button', 'rp-tog'); tog.type = 'button'; tog.setAttribute('role', 'switch'); tog.setAttribute('aria-checked', 'false'); tog.setAttribute('aria-label', 'Wipe everything on uninstall');
    tog.textContent = '…'; sw.appendChild(tog); hd.appendChild(sw); c.appendChild(hd);
    const warn = el('p', 'rp-p'); c.appendChild(warn);
    const stBox = el('div', 'rp-st mut'), stIcon = el('span', 'rp-ic', '…'), stBody = el('div', 'rp-stx'), stHead = el('div', 'rp-sh', 'Checking…'), stText = el('div', 'rp-sd');
    stBody.appendChild(stHead); stBody.appendChild(stText);
    const check_ = el('button', 'rp-chk', 'Check again'); check_.type = 'button';
    stBox.appendChild(stIcon); stBox.appendChild(stBody); stBox.appendChild(check_); c.appendChild(stBox);
    c.appendChild(el('div', 'rp-lbl', 'Removed on uninstall'));
    const list = el('div', 'rp-list'); c.appendChild(list);
    const more = el('div', 'rp-more'); c.appendChild(more);
    const note = el('div', 'rp-note'); c.appendChild(note);
    const foot = el('div', 'popfoot'), full_ = el('button', 'rp-full', 'Show full list'); full_.type = 'button';
    const x = el('button', 'popx', 'Close'); x.type = 'button'; x.onclick = () => closePop();
    foot.appendChild(full_); foot.appendChild(x); c.appendChild(foot);
    (document.querySelector('main') || document.body).appendChild(c);
    ui = { sw, tog, warn, st: stBox, stIcon, stHead, stText, check: check_, list, more, note, full: full_ };
    tog.onclick = flip; check_.onclick = check;
    full_.onclick = () => { full = !full; fill(); paint(); };
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

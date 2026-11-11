/*
 * Dashboard card "Cell lock" (under "Radio settings", closed by default). UI only; everything that talks to the router or modem is
 * window.MatchiRadio (web-src/radio-core.js).
 *  - Reads neighbor_cell_info / locked_cell_info only when the card is opened or Refresh is pressed. Never on the Live Status timer.
 *  - "Lock this cell" is built from the router's own serving-cell values (the phone is already on that cell), the safest lock.
 *    When the router leaves those values empty (the F50 does), the cell Android telephony reports is offered instead, marked as such, only from a fresh Live Status reading, and the confirm says it may differ from the router's cell.
 *  - The type of a neighbour (4G / 5G) comes from its band name (n78 / B3). A bare number asks you. Never guessed.
 *  - Auto-unlock is ON by default: 60 s after a lock, if the modem is not registered, UNLOCK_ALL_CELL is sent once. The pending check
 *    survives a page reload (the start time is kept in localStorage and the check resumes only if the router still lists a locked cell).
 *  - No radio restart after a cell lock or unlock (UFI-TOOLS does none). The router is read again 3 s later.
 *  - "Unlock all cells" is always on screen and also works while a band change is restarting the radio.
 */
function mountDashCell() {
  'use strict';
  const R = window.MatchiRadio, home = document.getElementById('home');
  if (!R || !home || document.getElementById('dash_cell')) return;
  const ratLabel = R.ratLabel;
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const css = document.createElement('style');
  css.textContent = `
#dash_cell{margin-top:12px;background:#0a1626;border:1px solid var(--bd);border-radius:12px;padding:10px 12px;font-size:12px}
#dash_cell .dc-h{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
#dash_cell .dc-t{font-weight:800;font-size:13px;background:none;border:0;padding:2px 0;color:inherit;cursor:pointer;min-height:0}
#dash_cell .dc-hb{display:flex;gap:6px;flex-wrap:wrap}
#dash_cell .dc-body{margin-top:8px}
#dash_cell .dc-l{font-size:11.5px;color:var(--mut);margin:8px 0 3px}
#dash_cell .dc-note{font-size:11px;color:var(--mut);margin:2px 0 6px}
#dash_cell .dc-warn{font-size:11px;color:#ff9a9a;margin:0 0 6px}
#dash_cell .dc-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:6px}
#dash_cell .dc-cell{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px;padding:4px 0;border-top:1px solid var(--bd)}
#dash_cell .dc-cell>span{flex:1 1 220px;min-width:0}
#dash_cell button,#dash_cell select,#dash_cell input[type=text]{min-height:28px;padding:3px 10px;font-size:12px;border-radius:7px}
#dash_cell input[type=text]{width:84px;min-width:0}
#dash_cell .dc-s{font-size:11.5px;min-height:15px;margin-top:4px}
#dash_cell .dc-log{display:none;margin:6px 0 0;padding:6px 8px;max-height:96px;overflow:auto;white-space:pre-wrap;font-size:10.5px;line-height:1.4;background:var(--bg);border:1px solid var(--bd);border-radius:8px}
#dash_cell .dc-c1,#dash_cell .dc-c2{min-width:0}
/* Wide screens: the card sits under Live device status (right column) in two columns. Narrow screens keep it under Radio settings, one column. */
@media(min-width:1000px){
.liv>#dash_cell{margin-top:12px}
.liv>#dash_cell .dc-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:auto auto auto 1fr auto auto;column-gap:22px;align-items:start}
.liv>#dash_cell .dc-body>*{grid-column:1}
.liv>#dash_cell .dc-body>label{justify-self:start}
.liv>#dash_cell .dc-dyn{display:contents}
.liv>#dash_cell .dc-c2{grid-column:2;grid-row:1/-1}
.liv>#dash_cell .dc-body>.dc-l{align-self:end}
}`;
  document.head.appendChild(css);

  const card = document.createElement('div'); card.id = 'dash_cell';
  card.innerHTML = '<div class="dc-h"><button type="button" class="dc-t" data-a="toggle" aria-expanded="false">▸ Cell lock</button>' +
    '<span class="dc-hb"><button type="button" data-a="refresh">Refresh</button><button type="button" data-a="unlock">Unlock all cells</button></span></div>' +
    '<div class="dc-s"></div>' +
    '<div class="dc-body" style="display:none">' +
    '<div class="dc-warn">Warning: locking the wrong cell can leave the phone with no signal or an unstable one. Read when this card is opened or on Refresh, never on the live timer.</div>' +
    '<label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" data-a="auto"> Auto-unlock if not registered after 60 s</label>' +
    '<div class="dc-dyn">reading…</div>' +
    '<div class="dc-l">Lock by hand</div>' +
    '<div class="dc-row"><input type="text" inputmode="numeric" data-f="pci" placeholder="PCI" aria-label="PCI"><input type="text" inputmode="numeric" data-f="earfcn" placeholder="EARFCN" aria-label="EARFCN">' +
    '<select data-f="rat" aria-label="Type"><option value="">Type…</option><option value="12">4G</option><option value="16">5G</option></select><button type="button" class="dc-lk" data-a="manual">Lock cell</button></div>' +
    '<pre class="dc-log"></pre></div>';
  // Wide screens (the two-column console): under Live device status. Narrow screens: under Radio settings, as before.
  const wide = window.matchMedia ? window.matchMedia('(min-width:1000px)') : null;
  function place() {
    const inl = document.getElementById('liv_inline'), rad = document.getElementById('dash_radio');
    if (wide && wide.matches && inl && inl.parentNode === home) { if (card.parentNode !== inl) inl.appendChild(card); return; }
    if (rad && rad.parentNode === home) { if (rad.nextSibling !== card) rad.after(card); } else if (card.parentNode !== home) home.appendChild(card);
  }
  place();
  if (wide) { if (wide.addEventListener) wide.addEventListener('change', place); else if (wide.addListener) wide.addListener(place); }
  const dyn = card.querySelector('.dc-dyn'), statusEl = card.querySelector('.dc-s'), logEl = card.querySelector('.dc-log'), bodyEl = card.querySelector('.dc-body');
  const autoBox = card.querySelector('[data-a=auto]'), tg = card.querySelector('[data-a=toggle]');
  autoBox.checked = R.cellAutoOn();

  // nb / locked = last router read. serving = cells built from the serving-cell values. working = a lock or unlock request is in flight.
  const st = { open: false, nb: [], locked: [], serving: [], err: '', loaded: false, working: false, unlocking: false, bandsDirty: false, rat: {} };
  const setStatus = (t) => { statusEl.textContent = t || ''; };
  const addLog = (line) => { logEl.style.display = 'block'; logEl.textContent += line + '\n'; logEl.scrollTop = logEl.scrollHeight; };
  const toast = (t, c) => { try { createToast(t, c); } catch (_) { /* not fatal */ } };
  const val = (c) => (c == null || c === '' ? '-' : esc(c));
  const bandName = (rat, b) => { b = String(b == null ? '' : b).trim(); if (!b) return ''; return /^[nb]/i.test(b) ? b : (rat === '16' ? 'n' : 'B') + b; };
  const cellText = (c, rat) => `${ratLabel(rat)} · ${c.band ? esc(bandName(rat, c.band)) + ' · ' : ''}EARFCN ${val(c.earfcn)} · PCI ${val(c.pci)}`;

  // Rule 7: Lock cell is off while a band change is pending (ticked, not saved) or running. Unlock all is never touched by this.
  const lockOff = () => R.isBusy() || st.working || st.bandsDirty;
  function sync() {
    card.querySelectorAll('.dc-lk').forEach((el) => { el.disabled = lockOff(); });
    const u = card.querySelector('[data-a=unlock]'); if (u) u.disabled = st.unlocking;
  }
  function paint() {
    if (st.err) { dyn.innerHTML = '<div class="dc-note">Cell info not available: ' + esc(st.err) + '. Unlock all cells still works.</div>'; sync(); return; }
    let h = '<div class="dc-c1"><div class="dc-l">Locked now</div>';
    h += st.locked.length ? st.locked.map((c) => `<div>${cellText(c, String(c.rat))}</div>`).join('') : '<div>none</div>';
    h += '<div class="dc-l">This phone is on</div>';
    h += st.serving.length ? st.serving.map((c, i) => `<div class="dc-cell"><span>${cellText(c, c.rat)}${c.tele ? ' <i title="The router left its serving cell empty. This is the cell Android telephony reports; it can differ from the router\'s.">(Android telephony)</i>' : ''}</span><button type="button" class="dc-lk" data-a="sv" data-i="${i}">Lock this cell</button></div>`).join('')
      : '<div class="dc-note">No serving cell with a valid PCI and channel was reported by the router or by Android telephony (Live Status must have a recent reading). Use a neighbour below or lock by hand.</div>';
    h += '</div><div class="dc-c2"><div class="dc-l">Neighbours</div>';
    h += st.nb.length ? st.nb.map((c, i) => {
      const rat = ['12', '16'].includes(String(c.rat)) ? String(c.rat) : R.guessRat(c.band) || st.rat[i] || '';
      const pick = R.guessRat(c.band) || ['12', '16'].includes(String(c.rat)) ? '' : `<select data-a="nbrat" data-i="${i}" aria-label="Type"><option value="">Type…</option><option value="12"${rat === '12' ? ' selected' : ''}>4G</option><option value="16"${rat === '16' ? ' selected' : ''}>5G</option></select>`;
      return `<div class="dc-cell"><span>${val(c.band)} · EARFCN ${val(c.earfcn)} · PCI ${val(c.pci)} · RSRP ${val(c.rsrp)} · RSRQ ${val(c.rsrq)} · SINR ${val(c.sinr)}</span>${pick}<button type="button" class="dc-lk" data-a="nb" data-i="${i}">Lock</button></div>`;
    }).join('') : '<div class="dc-note">No neighbour cells</div>';
    h += '</div>';
    dyn.innerHTML = h; sync();
  }

  // Item 22: the router's serving-cell keys are empty on the F50, so "This phone is on" was always empty. Fall back to the registered cell Android telephony reports,
  // taken from the last Live Status reading (read-only, no extra root call). Only when that reading is under 2 minutes old and the PCI / channel pass the same check as any lock.
  function teleServing() {
    try {
      const L = window.MatchiLive && window.MatchiLive.snapshot();
      if (!L || L.ageMs === null || L.ageMs > 120000) return [];
      const out = [], one = (v) => (v == null || v === '\u2014' ? '' : String(v).trim());
      const add = (rat, c) => { if (!c || c.src !== 'Android telephony') return; const pci = one(c.pci), earfcn = one(c.chan); if (R.cellOk(pci, earfcn, rat)) out.push({ rat, pci, earfcn, band: one(c.band), tele: true }); };
      if (L.hasNr) add('16', L.nr);
      if (L.hasLte) add('12', L.lte);
      return out;
    } catch (_) { return []; }
  }
  const take = (c) => { st.nb = c.nb; st.locked = c.locked; };
  let gen = 0;
  async function refresh() {
    const g = ++gen; st.err = '';
    try {
      const [c, s] = await Promise.all([R.readCells(), R.servingCells().catch(() => ({ cells: [] }))]);
      if (g !== gen) return;
      take(c); st.serving = s.cells.length ? s.cells : teleServing(); st.loaded = true; st.rat = {};
    } catch (e) { if (g !== gen) return; st.err = e.message; }
    paint();
  }
  function setOpen(on) {
    st.open = on; bodyEl.style.display = on ? '' : 'none'; tg.textContent = (on ? '▾ ' : '▸ ') + 'Cell lock'; tg.setAttribute('aria-expanded', String(on));
    if (on) { dyn.textContent = 'reading…'; refresh(); }
  }

  // ---- auto-unlock bookkeeping (survives a page reload) ----
  const MARK = 'matchi_cell_watch';
  const setMark = () => { try { localStorage.setItem(MARK, String(Date.now())); } catch (_) { /* not fatal */ } };
  const clearMark = () => { try { localStorage.removeItem(MARK); } catch (_) { /* not fatal */ } };
  async function watch(waitMs) {
    const res = await R.watchCell({ slot: 0, waitMs });
    if (res === 'cancelled') return;
    clearMark();
    if (res === 'off') { addLog('Auto-unlock is off: the cell lock stays.'); setStatus('Auto-unlock is off: the cell lock stays.'); return; }
    if (res === 'registered') { addLog('Modem is registered 60 s after the lock: the lock stays. Unlock all cells to remove it.'); setStatus('Registered. The cell lock stays; press Unlock all cells to remove it.'); return; }
    addLog('Not registered 60 s after the lock: removing the lock.'); setStatus('Not registered after the lock: removing it…');
    for (let i = 0; i < 10 && R.isBusy(); i++) await R.sleep(1000);
    await unlock(true);
  }

  async function lock(pci, earfcn, rat, tele) {
    if (lockOff()) return;
    if (!R.cellOk(pci, earfcn, rat)) { toast('PCI, EARFCN or type is not valid', 'red'); return; }
    const ok = await askConfirm('Lock to this cell?\n\n' + ratLabel(rat) + ' \u00b7 EARFCN ' + earfcn + ' \u00b7 PCI ' + pci +
      (tele ? '\n\nThis cell comes from Android telephony, because the router did not report its own serving cell. It can differ from the cell the router uses: if unsure, lock a neighbour row or Cancel.' : '') +
      '\n\nWARNING: a wrong cell can leave the phone with no signal or an unstable one. "Unlock all cells" stays on this card. ' +
      (R.cellAutoOn() ? 'If the modem is not registered 60 seconds after the lock, the lock is removed automatically.' : 'Automatic unlock is OFF: you must unlock by hand.'), 'Lock cell', true);
    if (!ok) return;
    st.working = true; sync(); logEl.textContent = '';
    let sent = false;
    try {
      setStatus('Locking the cell…'); addLog('> CELL_LOCK ' + ratLabel(rat) + ' earfcn=' + earfcn + ' pci=' + pci);
      let r = await R.cellLock(pci, earfcn, rat); sent = true;
      if (r.cells) take(r.cells);
      if (!r.hit) {   // the router can take a moment to list the lock: read once more after 3 s
        setStatus('Sent. Reading the router again in 3 s…'); await R.sleep(3000);
        try { const c = await R.readCells(); take(c); r = { cells: c, hit: R.cellListed(c, pci, earfcn, rat) }; } catch (_) { /* reported below */ }
      }
      paint();
      if (r.hit) { addLog('Router now reports the locked cell.'); setStatus('Cell locked.'); toast('Cell locked', 'green'); }
      else { addLog('Router accepted the lock but does not list it (yet). Check Live Status, and unlock if the signal is gone.'); setStatus('Sent, but the router does not list the lock yet.'); toast('Sent, but the router does not list the lock yet', 'red'); }
    } catch (e) { addLog('Cell lock failed: ' + e.message); setStatus('Cell lock failed: ' + e.message); toast(e.message, 'red'); }
    finally { st.working = false; sync(); }
    if (sent && R.cellAutoOn()) { setMark(); addLog('Auto-unlock check in 60 s (switch it off with the tick box if you do not want it).'); watch(60000); }
  }
  async function unlock(auto) {
    if (st.unlocking) return;
    if (!auto && !(await askConfirm('Unlock all cells?\n\nThe modem may re-register for a few seconds.', 'Unlock all'))) return;
    st.unlocking = true; clearMark(); sync();
    try {
      setStatus('Unlocking all cells…'); addLog('> UNLOCK_ALL_CELL' + (auto ? ' (automatic)' : ''));
      let r = await R.cellUnlock();   // also cancels a pending auto-unlock check
      if (r.cells) take(r.cells);
      if (!r.none) {
        setStatus('Sent. Reading the router again in 3 s…'); await R.sleep(3000);
        try { const c = await R.readCells(); take(c); r = { cells: c, none: !c.locked.length }; } catch (_) { /* reported below */ }
      }
      paint();
      if (r.none) { addLog('Router reports no locked cell.'); setStatus('No locked cell. Live values return once the modem re-registers.'); toast('Cells unlocked', 'green'); }
      else { addLog('Router accepted the unlock but still lists a locked cell, or could not be read. Press Refresh.'); setStatus('Unlock sent, but the router still lists a locked cell. Press Refresh.'); toast('Unlock sent, but a lock is still listed', 'red'); }
    } catch (e) { addLog('Unlock failed: ' + e.message + '. Try again, or restart the modem.'); setStatus('Unlock failed: ' + e.message); toast(e.message, 'red'); }
    finally { st.unlocking = false; sync(); }
  }

  card.onclick = (e) => {
    const a = e.target.closest && e.target.closest('[data-a]'); if (!a) return;
    const k = a.dataset.a, i = +a.dataset.i;
    if (k === 'toggle') setOpen(!st.open);
    else if (k === 'refresh') { if (!st.open) setOpen(true); else { setStatus(''); dyn.textContent = 'reading…'; refresh(); } }
    else if (k === 'unlock') unlock(false);
    else if (k === 'sv') { const c = st.serving[i]; if (c) lock(c.pci, c.earfcn, c.rat, !!c.tele); }
    else if (k === 'nb') {
      const c = st.nb[i]; if (!c) return;
      const rat = ['12', '16'].includes(String(c.rat)) ? String(c.rat) : R.guessRat(c.band) || st.rat[i] || '';
      if (!rat) { toast('Choose 4G or 5G for this cell first', 'red'); return; }   // never guess the type
      lock(String(c.pci == null ? '' : c.pci).trim(), String(c.earfcn == null ? '' : c.earfcn).trim(), rat);
    } else if (k === 'manual') {
      const f = (n) => card.querySelector('[data-f=' + n + ']').value.trim();
      lock(f('pci'), f('earfcn'), f('rat'));
    }
  };
  card.onchange = (e) => {
    const t = e.target, a = t && t.dataset && t.dataset.a;
    if (a === 'auto') R.setCellAuto(t.checked);
    else if (a === 'nbrat') st.rat[+t.dataset.i] = t.value;
  };

  // A band change that is ticked or running turns the Lock buttons off (and back on). Unlock all stays available.
  document.addEventListener('matchi:bands-dirty', (e) => { st.bandsDirty = !!(e.detail && e.detail.dirty); sync(); });
  R.onBusy(() => sync());

  // Page reloaded after a lock: resume the auto-unlock check, but only when the router still lists a locked cell.
  (async () => {
    let t = 0; try { t = +localStorage.getItem(MARK) || 0; } catch (_) { /* none */ }
    if (!t) return;
    const age = Date.now() - t;
    if (age > 600000 || age < 0 || !R.cellAutoOn()) { clearMark(); return; }
    try {
      const c = await R.readCells();
      if (!c.locked.length) { clearMark(); return; }
      take(c); addLog('Page reloaded after a cell lock: auto-unlock check resumed.'); setStatus('Cell lock active, auto-unlock check resumed.');
      watch(Math.max(0, 60000 - age));
    } catch (_) { clearMark(); }
  })();
  sync();
}

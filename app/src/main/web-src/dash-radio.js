/*
 * Dashboard card "Radio settings": network mode and LTE / 5G band lock under Live device status. UI only; everything that talks to the
 * modem or router is window.MatchiRadio (web-src/radio-core.js).
 *  - Reads the router once when the dashboard opens, after a change, and on Refresh. Never on the Live Status timer.
 *  - Chips show the ROUTER state. What you tick is kept separately ("pending") and only becomes real when you press Lock.
 *  - Lock sends BOTH lists: the type you did not touch is sent again unchanged. Nothing is ever sent empty.
 *  - During the radio restart Live Status stops polling and keeps its last values (MatchiRadio.beginBusy / onBusy).
 */
function mountDashRadio() {
  'use strict';
  const R = window.MatchiRadio, home = document.getElementById('home');
  if (!R || !home || document.getElementById('dash_radio')) return;
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const css = document.createElement('style');
  css.textContent = `
#dash_radio{margin-top:12px;background:#0a1626;border:1px solid var(--bd);border-radius:12px;padding:10px 12px;font-size:12px}
#dash_radio .dr-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
#dash_radio .dr-t{font-weight:800;font-size:13px}
#dash_radio .dr-note{font-size:11px;color:var(--mut);margin:2px 0 8px}
#dash_radio .dr-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:8px}
#dash_radio .dr-l{font-size:11.5px;color:var(--mut);margin-top:4px}
#dash_radio .dr-c{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 8px}
#dash_radio button,#dash_radio select{min-height:28px;padding:3px 10px;font-size:12px;border-radius:7px}
#dash_radio .dr-b{min-height:24px;padding:2px 8px;font-size:11.5px;opacity:.55}
#dash_radio .dr-b.on{opacity:1;background:rgba(100,230,164,.35)}
#dash_radio .dr-b.add{opacity:1;background:rgba(255,200,87,.35);outline:1px dashed #ffc857}
#dash_radio .dr-b.rm{opacity:.9;text-decoration:line-through;outline:1px dashed #ff9a9a}
#dash_radio .dr-s{font-size:11.5px;min-height:15px;margin-top:2px}
#dash_radio .dr-log{display:none;margin:6px 0 0;padding:6px 8px;max-height:96px;overflow:auto;white-space:pre-wrap;font-size:10.5px;line-height:1.4;background:var(--bg);border:1px solid var(--bd);border-radius:8px}`;
  document.head.appendChild(css);
  const card = document.createElement('div'); card.id = 'dash_radio';
  card.innerHTML = '<div class="dr-h"><span class="dr-t">Radio settings</span><button type="button" data-a="refresh">Refresh</button></div>' +
    '<div class="dr-note" data-tip="info">Network mode and bands apply to the whole router, not to one SIM slot. Read when this page opens and after a change, never on the live timer.</div>' +
    '<div class="dr-body">reading…</div><div class="dr-s"></div><pre class="dr-log"></pre>';
  const inl = document.getElementById('liv_inline');
  if (inl && inl.parentNode === home) inl.after(card); else home.appendChild(card);
  if (window.MatchiTip) window.MatchiTip.enhance(card);
  const body = card.querySelector('.dr-body'), statusEl = card.querySelector('.dr-s'), logEl = card.querySelector('.dr-log');

  // routerLte / routerNr = what the router reported at the last read. pendLte / pendNr = what is ticked now.
  const st = { routerLte: [], routerNr: [], pendLte: new Set(), pendNr: new Set(), lteSup: [], nrSup: [], haveLte: false, haveNr: false, lteRaw: '', nrRaw: '', net: null, err: '' };
  const sameSet = (arr, set) => arr.length === set.size && arr.every((x) => set.has(x));
  const dirty = () => (st.haveLte && !sameSet(st.routerLte, st.pendLte)) || (st.haveNr && !sameSet(st.routerNr, st.pendNr));
  const sorted = (set) => [...set].sort((a, b) => a - b);
  const setStatus = (t) => { statusEl.textContent = t || ''; };
  const addLog = (line) => { logEl.style.display = 'block'; logEl.textContent += line + '\n'; logEl.scrollTop = logEl.scrollHeight; };
  const toast = (t, c) => { try { createToast(t, c); } catch (_) { /* not fatal */ } };

  const lockedText = (router, sup, raw, prefix) => {
    if (router.length && sup.length && sup.every((b) => router.includes(b))) return 'none (all bands allowed)';
    return router.length ? router.map((b) => prefix + b).join(' ') : (raw.trim() || 'none reported');
  };
  const chips = (type, sup, router, pend) => sup.map((b) => {
    const inR = router.includes(b), inP = pend.has(b), cls = inR && inP ? 'on' : inP ? 'add' : inR ? 'rm' : '';
    return `<button type="button" class="dr-b ${cls}" data-t="${type}" data-b="${b}" aria-pressed="${inP}">${type === 'nr' ? 'n' : 'B'}${b}</button>`;
  }).join('');
  // Tells the Cell lock card whether bands are ticked but not saved (it turns its Lock buttons off while they are).
  const announce = () => { try { document.dispatchEvent(new CustomEvent('matchi:bands-dirty', { detail: { dirty: dirty() } })); } catch (_) { /* not fatal */ } };
  // Item 24: a band lock left on (or a wrong one) looks like "no service". Show a warning on this card when a lock is active AND the last fresh Live reading has no service.
  // The lock counts as active when the router lists fewer bands than the modem supports. Nothing is changed by the warning; Unlock all is the way out.
  const lockActive = () => (st.haveLte && st.routerLte.length > 0 && st.lteSup.length > 0 && !st.lteSup.every((b) => st.routerLte.includes(b))) || (st.haveNr && st.routerNr.length > 0 && st.nrSup.length > 0 && !st.nrSup.every((b) => st.routerNr.includes(b)));
  const liveNoService = () => { try { const s = window.MatchiLive && window.MatchiLive.snapshot(); return !!(s && s.noService); } catch (_) { return false; } };
  const lockWarnHtml = () => (lockActive() && liveNoService() && !R.isBusy()
    ? '<div class="dr-warn" role="alert" style="margin:0 0 8px;padding:6px 8px;border:1px solid #ff9a9a;border-radius:8px;color:#ff9a9a;font-size:11.5px">A band lock is active and Live Status shows no service. If the signal went away after a band change, the lock may be the cause: press <b>Unlock all</b>.</div>' : '');
  // A band tick only changes colours and two buttons. Painting the whole card again re-created the Network mode drop-down on every click
  // (a visible jump / flash), so the chips and buttons are updated where they stand and nothing else is touched.
  function tickInPlace() {
    if (st.err || !body.querySelector('.dr-b[data-t]')) { paint(); return; }
    body.querySelectorAll('.dr-b[data-t]').forEach((el) => {
      const lte = el.dataset.t === 'lte', b = +el.dataset.b, router = lte ? st.routerLte : st.routerNr, pend = lte ? st.pendLte : st.pendNr;
      const inR = router.includes(b), inP = pend.has(b);
      el.className = 'dr-b ' + (inR && inP ? 'on' : inP ? 'add' : inR ? 'rm' : '');
      el.setAttribute('aria-pressed', String(inP));
    });
    const off = R.isBusy() || !dirty();
    ['lock', 'reset'].forEach((a) => { const el = body.querySelector('[data-a="' + a + '"]'); if (el) el.disabled = off; });
    announce();
  }
  function paint() {
    announce();
    if (st.err) { body.textContent = 'Radio settings not available: ' + st.err; return; }
    const busy = R.isBusy(), dis = busy ? ' disabled' : '';
    let h = '';
    if (st.net) {
      const opts = R.NET_MODES.slice(); if (!opts.some((m) => m[0] === st.net)) opts.push([st.net, 'Current: ' + st.net]);
      h += `<div class="dr-row"><label for="dr_nm">Network mode</label><select id="dr_nm" data-a="net"${dis}>${opts.map((m) => `<option value="${esc(m[0])}"${m[0] === st.net ? ' selected' : ''}>${esc(m[1])}</option>`).join('')}</select></div>`;
    }
    if (st.haveLte) h += `<div class="dr-l">LTE bands · locked now: ${esc(lockedText(st.routerLte, st.lteSup, st.lteRaw, 'B'))}</div><div class="dr-c">${chips('lte', st.lteSup, st.routerLte, st.pendLte)}</div>`;
    if (st.haveNr) h += `<div class="dr-l">5G NR bands · locked now: ${esc(lockedText(st.routerNr, st.nrSup, st.nrRaw, 'n'))}</div><div class="dr-c">${chips('nr', st.nrSup, st.routerNr, st.pendNr)}</div>`;
    if (st.haveLte || st.haveNr) {
      h += `<div class="dr-row"><button type="button" data-a="lock"${dis || (dirty() ? '' : ' disabled')}>Lock ticked bands</button><button type="button" data-a="unlock"${dis}>Unlock all</button>` +
        `<button type="button" data-a="reset"${dis || (dirty() ? '' : ' disabled')}>Reset ticks</button></div>` +
        '<div class="dr-note" data-tip="info" style="margin:0">Green = locked on the router. Yellow = ticked, not saved yet. Struck through = locked now, will be removed.</div>';
    }
    warnShown = !!lockWarnHtml();
    body.innerHTML = h ? lockWarnHtml() + h : 'The router reports neither a network mode nor band locks.';
    if (window.MatchiTip) window.MatchiTip.enhance(body);
  }
  // Live Status painted again: show or clear the warning without reading the router. Ticks are kept (they live in st), only the warning line changes.
  let warnShown = false;
  document.addEventListener('matchi:live', () => {
    if (st.err || !(st.haveLte || st.haveNr)) return;
    const want = lockActive() && liveNoService() && !R.isBusy();
    if (want !== warnShown) { warnShown = want; paint(); }
  });

  let gen = 0;
  async function refresh() {
    const g = ++gen;
    try {
      const [b, r] = await Promise.all([R.readBands().catch((e) => ({ err: e.message })), R.readRadio().catch(() => ({ net: null }))]);
      if (g !== gen) return;
      st.net = r.net || null;
      if (b.err || (b.lte === null && b.nr === null)) { st.haveLte = st.haveNr = false; st.err = b.err || ''; paint(); return; }
      st.err = '';
      st.haveLte = b.lte !== null; st.haveNr = b.nr !== null;
      st.routerLte = b.lte || []; st.routerNr = b.nr || [];
      st.lteRaw = b.lteRaw == null ? '' : String(b.lteRaw); st.nrRaw = b.nrRaw == null ? '' : String(b.nrRaw);
      st.lteSup = st.haveLte ? [...new Set([...R.LTE_BANDS, ...st.routerLte])].sort((x, y) => x - y) : [];
      if (st.haveNr) {
        const sup = st.nrSup.length ? st.nrSup : await R.readNrSupported(0);
        if (g !== gen) return;
        st.nrSup = [...new Set([...sup, ...st.routerNr])].sort((x, y) => x - y);
      } else st.nrSup = [];
      st.pendLte = new Set(st.routerLte); st.pendNr = new Set(st.routerNr);   // ticks start from the router state after every read
      paint();
    } catch (e) { if (g === gen) { st.err = e.message; paint(); } }
  }

  // One band change: send, read back, restart the radio, wait for registration. Live Status is frozen for the whole time.
  async function apply(parts, expect) {
    const done = R.beginBusy('Radio restarting, ~30 s');
    logEl.textContent = '';
    try {
      setStatus('Saving the band lock…');
      const r = await R.setBands(parts, expect);
      addLog('> ' + parts.map((p) => p[0] + ' ' + p[2]).join(' + ')); addLog('Router answered success: ' + r.sent.join(', '));
      if (r.notes.length) addLog('Note: ' + r.notes.join('; ') + '.');
      if (!r.read) { setStatus('Saved, but the router could not be read back. Press Refresh.'); toast('Sent, but the router could not be read back', 'red'); return; }
      if (r.bad.length) { setStatus('Router accepted the change but ' + r.bad.join('; ') + '. Press Refresh.'); toast('Sent, but the router does not report the new bands yet', 'red'); return; }
      setStatus('Band lock saved. Restarting the radio (about 30 s)…');
      const ok = await R.radioCycle({ log: addLog, toast: () => {} });
      if (!ok) { setStatus('The radio restart did not confirm. Open AT & Radio and run AT+SFUN=4, or reboot the device.'); toast('Radio may still be off: run AT+SFUN=4', 'red'); return; }
      const reg = await R.waitRegistered(0, { everyMs: 3000, timeoutMs: 90000, onTick: (s) => setStatus('Waiting for the modem to register… ' + s + ' s') });
      setStatus(reg ? 'Registered. Live values resume.' : 'Not registered after 90 s. Check Live Status, or press Unlock all.');
      toast(reg ? 'Band lock applied' : 'Not registered yet', reg ? 'green' : 'red');
    } catch (e) { setStatus('Band lock failed: ' + e.message); toast(e.message, 'red'); }
    finally { done(); }   // listeners run: this card re-reads, Live Status reads once
  }
  const listText = (parts) => parts.map((p) => (p[0] === 'LTE_BAND_LOCK' ? 'LTE: ' + p[2].split(',').map((b) => 'B' + b).join(' ') : '5G NR: ' + p[2].split(',').map((b) => 'n' + b).join(' '))).join('\n');
  async function lock() {
    if (R.isBusy() || !dirty()) return;
    const l = st.haveLte ? (st.pendLte.size ? sorted(st.pendLte) : st.routerLte) : [], n = st.haveNr ? (st.pendNr.size ? sorted(st.pendNr) : st.routerNr) : [];
    const parts = [], expect = {};
    if (l.length) { parts.push(['LTE_BAND_LOCK', 'lte_band_lock', R.bandText(l)]); expect.lte = l; }
    if (n.length) { parts.push(['NR_BAND_LOCK', 'nr_band_lock', R.bandText(n)]); expect.nr = n; }
    if (!parts.length) { toast('Tick at least one band first', 'red'); return; }
    const note = (!st.pendLte.size && st.haveLte) || (!st.pendNr.size && st.haveNr) ? '\n(A type with nothing ticked is sent again unchanged.)' : '';
    if (!(await askConfirm('Lock these bands?\n\n' + listText(parts) + note + '\n\nWrong bands can leave the phone without signal. After saving, the modem radio is restarted (signal drops for about 30 s). To go back use "Unlock all".', 'Lock', true))) return;
    await apply(parts, expect);
  }
  async function unlock() {
    if (R.isBusy()) return;
    const parts = [], expect = {};
    if (st.haveLte && st.lteSup.length) { parts.push(['LTE_BAND_LOCK', 'lte_band_lock', R.bandText(st.lteSup)]); expect.lte = st.lteSup; }
    if (st.haveNr && st.nrSup.length) { parts.push(['NR_BAND_LOCK', 'nr_band_lock', R.bandText(st.nrSup)]); expect.nr = st.nrSup; }
    if (!parts.length) { toast('No band list to unlock with', 'red'); return; }
    if (!(await askConfirm('Unlock all: allow every listed band?\n\n' + listText(parts) + '\n\nThe modem radio is restarted afterwards (signal drops for about 30 s).', 'Unlock all'))) return;
    await apply(parts, expect);
  }
  async function changeNet(sel) {
    const next = sel.value, prev = st.net;
    if (R.isBusy() || !next || next === prev) return;
    const hard = next === 'Only_5G' || next === 'Only_LTE';
    if (!(await askConfirm('Change network mode from "' + R.netLabel(prev) + '" to "' + R.netLabel(next) + '"?\n\n' + (hard ? 'The phone may lose signal if this network is not available here. ' : '') + 'To go back, choose "Auto 5G/4G/3G".', 'Change'))) { sel.value = prev; return; }
    const done = R.beginBusy('Network mode changing…');
    try {
      setStatus('Changing network mode…');
      const sr = await R.setNetMode(next);   // no radio restart here; an empty reply with no change is repeated after a fresh router sign-in
      const r = sr.read;
      if (sr.ok) { setStatus('Router now reports: ' + R.netLabel(next)); toast('Network mode: ' + R.netLabel(next), 'green'); }
      else if (sr.reply === 'empty') { const why = await R.emptyHint(); setStatus('Network mode not changed: the router answered with an empty reply ' + sr.attempts + ' times. ' + why); toast('Router ignored the network mode change', 'red'); }
      else { setStatus('Router accepted the change but reports ' + (r && r.net ? R.netLabel(r.net) : 'nothing') + '. It may need a moment: press Refresh.'); toast('Sent, but the router does not report the new mode yet', 'red'); }
    } catch (e) { setStatus('Network mode failed: ' + e.message); toast(e.message, 'red'); }
    finally { done(); }
  }

  card.onclick = (e) => {
    const chip = e.target.closest && e.target.closest('.dr-b[data-t]');
    if (chip) {
      if (R.isBusy()) return;
      const set = chip.dataset.t === 'lte' ? st.pendLte : st.pendNr, b = +chip.dataset.b;
      if (set.has(b)) set.delete(b); else set.add(b);
      tickInPlace(); return;
    }
    const a = e.target.closest && e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'refresh') { if (!R.isBusy()) { setStatus(''); refresh(); } }
    else if (a.dataset.a === 'lock') lock();
    else if (a.dataset.a === 'unlock') unlock();
    else if (a.dataset.a === 'reset') { st.pendLte = new Set(st.routerLte); st.pendNr = new Set(st.routerNr); paint(); }
  };
  card.onchange = (e) => { if (e.target && e.target.dataset && e.target.dataset.a === 'net') changeNet(e.target); };

  // Busy period: show the host as restarting (not red) and disable the controls. When it ends the router is read again
  // (also covers a restart started from the AT & Radio window).
  R.onBusy((busy, reason) => {
    if (busy) { try { setHostStatus(true, 'Radio restarting'); } catch (_) { /* not fatal */ } paint(); }
    else { try { hostPing(); } catch (_) { /* not fatal */ } refresh(); }
  });
  refresh();
}

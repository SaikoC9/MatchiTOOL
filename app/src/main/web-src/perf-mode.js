/*
 * Button "Performance mode" in the top button row (next to Change IP). Opens a small window that shows the router's performance mode
 * and turns it on or off. UI only; reading goes through window.MatchiRadio.readRadio, writing through setRouter.
 *  - The router saves the setting at once but applies it only after a reboot. There is no radio restart.
 *  - Read when the window opens and after a change, never on a timer. No answer from the router = nothing to switch.
 */
function mountPerfMode() {
  'use strict';
  const R = window.MatchiRadio, host = document.querySelector('.actions-buttons');
  if (!R || !host || document.getElementById('matchi_perf_btn')) return;
  const MODAL = 'matchi_perf_modal', $ = (id) => document.getElementById(id);
  const st = { perf: null, busy: false };
  const toast = (t, c) => { try { createToast(t, c); } catch (_) { /* not fatal */ } };
  const say = (t) => { const m = $('matchi_perf_msg'); if (m) m.textContent = t || ''; };

  function paint() {
    const s = $('matchi_perf_state'), b = $('matchi_perf_set'); if (!s || !b) return;
    if (st.perf === '0' || st.perf === '1') {
      s.textContent = 'Performance mode is ' + (st.perf === '1' ? 'ON' : 'OFF');
      b.textContent = st.perf === '1' ? 'Turn off' : 'Turn on';
      b.style.display = ''; b.disabled = st.busy;
    } else {
      s.textContent = st.perf === null ? 'Reading…' : 'This router does not report performance mode.';
      b.style.display = 'none';
    }
  }
  async function read() {
    try { const r = await R.readRadio(); st.perf = (r.perf === '0' || r.perf === '1') ? r.perf : ''; }
    catch (e) { st.perf = ''; say('Router settings not available: ' + e.message); }
    paint();
  }
  async function apply() {
    if (st.busy || R.isBusy() || (st.perf !== '0' && st.perf !== '1')) return;
    const next = st.perf === '1' ? '0' : '1';
    if (!(await askConfirm((next === '1' ? 'Turn performance mode ON?' : 'Turn performance mode OFF?') + '\n\nThe router saves it now, but it only takes effect after the router is rebooted. Nothing changes until then.', next === '1' ? 'Turn on' : 'Turn off'))) return;
    st.busy = true; paint();
    try {
      say('Saving…');
      await R.setRouter({ goformId: 'PERFORMANCE_MODE_SETTING', performance_mode: next });
      let r = null; try { r = await R.readRadio(); } catch (_) { /* shown below */ }
      if (r && (r.perf === '0' || r.perf === '1')) st.perf = r.perf;
      if (r && r.perf === next) { say('Router now reports performance mode ' + (next === '1' ? 'on' : 'off') + '. Reboot the router to apply it.'); toast('Saved. Effective after reboot', 'green'); }
      else { say('Router accepted the change but reports ' + (r && r.perf ? r.perf : 'nothing') + '. Reboot the router, then open this window again to check.'); toast('Sent, but the router does not report it yet', 'red'); }
    } catch (e) { say('Performance mode failed: ' + e.message); toast(e.message, 'red'); }
    st.busy = false; paint();
  }
  function open() {
    st.perf = null; st.busy = false;
    createModal({
      name: MODAL, title: 'Performance mode', maxWidth: '420px', showConfirm: false, onClose: () => true,
      content:
        '<div id="matchi_perf_state" style="font-weight:700;margin:0 0 8px">Reading…</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:8px"><button type="button" id="matchi_perf_set" style="display:none"></button></div>' +
        '<div class="mut" style="font-size:11.5px;margin:0 0 6px">Applies to the whole router. It is saved at once and takes effect after the router is rebooted (Reboot, top right).</div>' +
        '<div id="matchi_perf_msg" style="font-size:11.5px;min-height:15px"></div>',
    });
    showModal(MODAL);
    $('matchi_perf_set').onclick = apply;
    paint(); read();
  }
  const b = document.createElement('button');
  b.id = 'matchi_perf_btn'; b.type = 'button'; b.textContent = 'Performance mode'; b.onclick = open;
  const ref = document.getElementById('matchi_changeip_btn');
  if (ref && ref.parentNode === host) ref.after(b); else host.appendChild(b);
}

/*
 * Button "Performance mode" in the top button row (next to Change IP). One click flips the router's performance mode and shows a toast
 * (ON / OFF). No window, no confirm. UI only; reading goes through window.MatchiRadio.readRadio, writing through setRouter.
 *  - The router saves the setting at once but applies it only after a reboot. There is no radio restart.
 *  - Read on click and after the change, never on a timer. No answer from the router = nothing is switched.
 */
function mountPerfMode() {
  'use strict';
  const R = window.MatchiRadio, host = document.querySelector('.actions-buttons');
  if (!R || !host || document.getElementById('matchi_perf_btn')) return;
  let busy = false;
  const toast = (t, c) => { try { createToast(t, c); } catch (_) { /* not fatal */ } };
  const word = (v) => (v === '1' ? 'ON' : 'OFF');
  // One tap: read the router's setting, send the opposite, read it back, and say ON or OFF in a toast. No window, no confirm.
  async function toggle() {
    if (busy || R.isBusy()) return;
    busy = true; b.disabled = true;
    try {
      const cur = (await R.readRadio()).perf;
      if (cur !== '0' && cur !== '1') { toast('This router does not report performance mode', 'red'); return; }
      const next = cur === '1' ? '0' : '1';
      await R.setRouter({ goformId: 'PERFORMANCE_MODE_SETTING', performance_mode: next }, true);
      let r = null; try { r = await R.readRadio(); } catch (_) { /* shown below */ }
      if (r && r.perf === next) toast('Performance mode ' + word(next) + '. Effective after reboot', 'green');
      else toast('Performance mode sent: ' + word(next) + ', but the router reports ' + (r && r.perf ? word(r.perf) : 'nothing') + '. Reboot to check', 'red');
    } catch (e) { toast('Performance mode failed: ' + e.message, 'red'); }
    finally { busy = false; b.disabled = false; }
  }
  const b = document.createElement('button');
  b.id = 'matchi_perf_btn'; b.type = 'button'; b.textContent = 'Performance mode'; b.onclick = toggle;
  const ref = document.getElementById('matchi_changeip_btn');
  if (ref && ref.parentNode === host) ref.after(b); else host.appendChild(b);
}

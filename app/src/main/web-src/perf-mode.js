/*
 * Button "Performance mode" in the top button row (next to Change IP). One click flips the router's performance mode and shows a toast
 * (ON / OFF). No window, no confirm. UI only; reading goes through window.MatchiRadio.readRadio, writing through setRouter.
 *  - The router saves the setting at once but applies it only after a reboot. There is no radio restart.
 *  - Live apply (no reboot): right after the flag is saved, a root script switches cores 4-7 on (ON) or off (OFF), the same sysfs files the CPU Governor uses.
 *    It lasts until the next restart; the router's own setting then takes over, so both agree. It changes nothing else (no governor, no speed lock).
 *  - Read on click and after the change, never on a timer. No answer from the router = nothing is switched.
 */
function mountPerfMode() {
  'use strict';
  const R = window.MatchiRadio, host = document.querySelector('.actions-buttons');
  if (!R || !host || document.getElementById('matchi_perf_btn')) return;
  let busy = false;
  const toast = (t, c) => { try { createToast(t, c); } catch (_) { /* not fatal */ } };
  const word = (v) => (v === '1' ? 'ON' : 'OFF');
  // Cores 4-7 on or off right now. Prints how many of them ended in the wanted state; core 0-3 are never touched.
  async function applyLive(on) {
    const v = on ? 1 : 0;
    const cmd = 'ok=0; for n in 4 5 6 7; do f=/sys/devices/system/cpu/cpu$n/online; [ -w $f ] || continue; echo ' + v + ' > $f 2>/dev/null; read -r x < $f 2>/dev/null; [ "$x" = "' + v + '" ] && ok=$((ok+1)); done; echo "MATCHI_CORES=$ok"';
    try {
      const r = await runShellWithRoot(cmd, 15000);
      const t = typeof r === 'string' ? r : (r && (r.content || r.text)) || '';
      const m = /MATCHI_CORES=(\d+)/.exec(t);
      return m ? Number(m[1]) : 0;
    } catch (_) { return 0; }
  }
  // One tap: read the router's setting, send the opposite, read it back, and say ON or OFF in a toast. No window, no confirm.
  async function toggle() {
    if (busy || R.isBusy()) return;
    busy = true; b.disabled = true;
    try {
      const cur = (await R.readRadio()).perf;
      if (cur !== '0' && cur !== '1') { toast('Not supported', 'red'); return; }
      const next = cur === '1' ? '0' : '1';
      await R.setRouter({ goformId: 'PERFORMANCE_MODE_SETTING', performance_mode: next }, true);
      let r = null; try { r = await R.readRadio(); } catch (_) { /* shown below */ }
      if (r && r.perf === next) {
        const n = await applyLive(next === '1');
        if (n === 4) toast('Performance ' + word(next), 'green');
        else toast('Performance ' + word(next) + ' saved. Reboot to finish.', 'green');
      }
      else toast('Router rejected the change', 'red');
    } catch (e) { toast('Failed: ' + e.message, 'red'); }
    finally { busy = false; b.disabled = false; }
  }
  const b = document.createElement('button');
  b.id = 'matchi_perf_btn'; b.type = 'button'; b.textContent = 'Performance mode'; b.onclick = toggle;
  const ref = document.getElementById('matchi_changeip_btn');
  if (ref && ref.parentNode === host) ref.after(b); else host.appendChild(b);
}

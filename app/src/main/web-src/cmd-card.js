/* cmd-card.js: the "Device commands" card on the home page. A list of read-only shell commands, in closed groups, each with a Copy button.
   Nothing here runs a command or talks to the host: the person pastes the command into a root shell (the AT console or adb). The card never builds markup from text. */
(function () {
  'use strict';
  const F = '/data/user/0/com.matchi.tool/files';
  const GROUPS = [
    ['Guard', [
      ['Show copies', 'pgrep -fa matchi-guard'],
      ['Count copies (should be 1)', 'pgrep -fc matchi-guard'],
      ['Kill all copies', 'pkill -f "matchi-guard watch"'],
      ['Read the live report', 'cat ' + F + '/guard/report.json'],
      ['Guard version', F + '/matchi-guard version'],
    ]],
    ['Binaries', [
      ['Set the folder once', 'F=' + F],
      ['Health check of the device', '$F/matchi-doctor -pretty'],
      ['Health check with TLS', '$F/matchi-doctor -pretty -tls example.com:443'],
      ['One sample line', '$F/matchi-sampler -rounds 1'],
      ['Check the modem answers', '$F/sendat -n 0 -c AT'],
      ['Router API, no sign-in', "$F/zreq -v -params 'cmd=LD'"],
    ]],
    ['CPU, heat, memory', [
      ['Load', 'cat /proc/loadavg'],
      ['Memory', "grep -E 'MemTotal|MemAvailable|SwapFree' /proc/meminfo"],
      ['Temperatures', 'for z in /sys/class/thermal/thermal_zone*; do echo "$(cat $z/type) $(cat $z/temp)"; done'],
      ['CPU speeds', 'cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq'],
      ['Top 10 processes', 'top -b -n 1 -m 10'],
      ['Number of processes', 'ps -A | wc -l'],
      ['Everything MatchiTOOL runs', 'ps -A -o PID,ARGS | grep -i matchi'],
    ]],
    ['Network', [
      ['Addresses and routes', 'ip addr; ip route'],
      ['Internet check', 'ping -c 3 8.8.8.8'],
      ['Signal and registration', 'dumpsys telephony.registry | head -60'],
    ]],
    ['Logs', [
      ['Last 200 lines', 'logcat -d -t 200'],
      ['Only MatchiTOOL', 'logcat -d | grep -i matchi'],
    ]],
    ['MatchiTOOL files', [
      ['All its files', 'ls -l /data/local/matchitool'],
      ['Start-on-boot scripts', 'ls /data/local/matchitool/boot.d'],
      ['Boot script', 'cat /data/local/matchitool/boot.sh'],
      ['Wi-Fi auto log', 'cat /data/local/matchitool/wifi_auto.log'],
    ]],
  ];
  const H = { GROUPS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = H; return; }
  if (typeof document === 'undefined') return;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) { /* no HTTPS: try the old way */ }
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) { /* not fatal */ }
    ta.remove(); return ok;
  }
  const css = document.createElement('style');
  css.textContent = '#cmdCard{margin-top:10px;background:#0a1626;border:1px solid var(--bd);border-radius:10px;padding:7px 10px;font-size:11px}' +
    '#cmdCard .cc-title{display:block;width:100%;text-align:left;font-weight:800;font-size:12px;background:none;border:0;padding:2px 0;min-height:0;color:inherit;cursor:pointer}#cmdCard .cc-note{color:var(--mut);font-size:10px;margin:1px 0 4px}' +
    '#cmdCard details{border-top:1px solid var(--bd)}' +
    '#cmdCard summary{display:flex;align-items:center;min-height:26px;cursor:pointer;font-weight:700;font-size:12px;list-style:none}#cmdCard summary::-webkit-details-marker{display:none}' +
    '#cmdCard summary::after{content:"+";color:var(--mut);font-size:14px}#cmdCard details[open]>summary::after{content:"\\2013"}' +
    '#cmdCard .cc-n{margin-left:auto;margin-right:8px;color:var(--mut);font-weight:500;font-size:10px}' +
    '#cmdCard .cc-r{display:flex;align-items:center;gap:6px;padding:2px 0 4px}#cmdCard .cc-m{flex:1 1 auto;min-width:0}' +
    '#cmdCard .cc-l{color:var(--mut);font-size:10px;margin-bottom:1px}' +
    '#cmdCard .cc-c{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;line-height:1.3;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:2px 6px;overflow-wrap:anywhere;user-select:all}' +
    '#cmdCard button{min-height:22px;padding:1px 8px;font-size:11px;border-radius:6px;flex:none}';
  document.head.appendChild(css);

  function mount() {
    const home = document.getElementById('home'); if (!home || document.getElementById('cmdCard')) return;
    const box = el('div'); box.id = 'cmdCard';
    const tg = el('button', 'cc-title'); tg.type = 'button';
    const body = el('div');
    box.appendChild(tg); box.appendChild(body);
    // Closed by default, like the Cell lock card. The choice is kept in this browser (storage can be blocked, so it is only a convenience).
    const KEY = 'matchi_cmdcard_open';
    const setOpen = (on, save) => {
      body.hidden = !on; tg.textContent = (on ? '\u25BE ' : '\u25B8 ') + 'Device commands'; tg.setAttribute('aria-expanded', String(on));
      if (save) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) { /* not fatal */ } }
    };
    tg.onclick = () => setOpen(body.hidden, true);
    body.appendChild(el('div', 'cc-note', 'Run as root (AT console or adb). They only read, except Kill all copies.'));
    for (const [name, rows] of GROUPS) {
      const d = el('details'), s = el('summary');
      s.appendChild(el('span', '', name)); s.appendChild(el('span', 'cc-n', String(rows.length))); d.appendChild(s);
      for (const [label, cmd] of rows) {
        const r = el('div', 'cc-r'), m = el('div', 'cc-m'), b = el('button', '', 'Copy'); b.type = 'button';
        m.appendChild(el('div', 'cc-l', label)); m.appendChild(el('div', 'cc-c', cmd));
        b.onclick = async () => { const ok = await copy(cmd); try { createToast(ok ? 'Copied' : 'Select the command and copy it by hand', ok ? 'green' : 'red'); } catch (_) { /* not fatal */ } };
        r.appendChild(m); r.appendChild(b); d.appendChild(r);
      }
      body.appendChild(d);
    }
    let was = false; try { was = localStorage.getItem(KEY) === '1'; } catch (_) { /* closed */ }
    setOpen(was, false);
    home.appendChild(box);
    // Fixed place: right after the Plugin guard card, which another script adds at its own time.
    const place = () => { const g = document.getElementById('guardCard'); if (g && g.parentNode === home && g.nextElementSibling !== box) g.after(box); };
    place();
    try { new MutationObserver(place).observe(home, { childList: true }); } catch (e) { setTimeout(place, 1500); setTimeout(place, 5000); }
  }
  window.addEventListener('load', () => setTimeout(mount, 1000));
})();

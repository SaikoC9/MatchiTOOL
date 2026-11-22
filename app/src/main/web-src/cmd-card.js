/* cmd-card.js: the "Device commands" button in the Plugin actions folder, which opens a popup. A list of read-only shell commands, in closed groups, each with a Copy button.
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
  css.textContent = '#cmdPop .modal{max-width:520px}#cmdPop .cc-head{display:flex;align-items:center;gap:8px;margin:0 0 6px}#cmdPop .cc-head h3{margin:0;flex:1 1 auto}' +
    '#cmdPop .cc-note{color:var(--mut);font-size:10px;margin:1px 0 4px}' +
    '#cmdPop details{border-top:1px solid var(--bd)}' +
    '#cmdPop summary{display:flex;align-items:center;min-height:30px;cursor:pointer;font-weight:700;font-size:12px;list-style:none}#cmdPop summary::-webkit-details-marker{display:none}' +
    '#cmdPop summary::after{content:"+";color:var(--mut);font-size:14px}#cmdPop details[open]>summary::after{content:"\\2013"}' +
    '#cmdPop .cc-n{margin-left:auto;margin-right:8px;color:var(--mut);font-weight:500;font-size:10px}' +
    '#cmdPop .cc-r{display:grid;grid-template-columns:minmax(0,1fr) 58px;grid-template-rows:auto auto;column-gap:6px;padding:2px 0 6px}' +
    '#cmdPop .cc-l{grid-column:1/-1;color:var(--mut);font-size:10px;margin-bottom:2px}' +
    '#cmdPop .cc-c{grid-column:1;min-width:0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;line-height:1.3;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:3px 6px;overflow-wrap:anywhere;user-select:all}' +
    '#cmdPop .cc-b{grid-column:2;align-self:stretch;width:58px;min-height:0!important;padding:0!important;display:flex;align-items:center;justify-content:center}';
  document.head.appendChild(css);

  function build() {
    const bg = el('div', 'modal-bg'); bg.id = 'cmdPop';
    const m = el('div', 'modal');
    const head = el('div', 'cc-head'), x = el('button', '', 'Close'); x.type = 'button';
    head.appendChild(el('h3', '', 'Device commands')); head.appendChild(x);
    m.appendChild(head);
    m.appendChild(el('div', 'cc-note', 'Run as root (AT console or adb). They only read, except Kill all copies.'));
    for (const [name, rows] of GROUPS) {
      const d = el('details'), s = el('summary');
      s.appendChild(el('span', '', name)); s.appendChild(el('span', 'cc-n', String(rows.length))); d.appendChild(s);
      for (const [label, cmd] of rows) {
        const r = el('div', 'cc-r'), b = el('button', 'cc-b', 'Copy'); b.type = 'button';
        r.appendChild(el('div', 'cc-l', label)); r.appendChild(el('div', 'cc-c', cmd)); r.appendChild(b);
        b.onclick = async () => { const ok = await copy(cmd); try { createToast(ok ? 'Copied' : 'Select the command and copy it by hand', ok ? 'green' : 'red'); } catch (_) { /* not fatal */ } };
        d.appendChild(r);
      }
      m.appendChild(d);
    }
    bg.appendChild(m);
    const close = () => bg.classList.remove('show');
    x.onclick = close;
    bg.onclick = (e) => { if (e.target === bg) close(); };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    document.body.appendChild(bg);
    return bg;
  }

  function mount() {
    const box = document.querySelector('.matchi-menu-box'); if (!box || document.getElementById('cmdBtn')) return;
    // A button in the "Plugin actions" folder, next to SMS and the others. The list opens in a popup.
    const btn = el('button', '', 'Device commands'); btn.id = 'cmdBtn'; btn.type = 'button';
    let pop = null;
    btn.onclick = () => { if (!pop) pop = build(); pop.classList.add('show'); };
    box.appendChild(btn);
  }
  window.addEventListener('load', () => setTimeout(mount, 1000));
})();

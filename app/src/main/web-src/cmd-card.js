/* cmd-card.js: the "Device commands" button in the home tool row, which opens a popup (a .card.pop, like Terminal). A list of read-only shell commands, in closed groups, each with a Copy button.
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
  // The stock look of the old home card (closed groups with + / -, small labels, mono command box, Copy on the right), now inside a popup.
  css.textContent = '#cmdpop .cc-title{margin:0 0 2px;font-size:11.5px;font-weight:700;color:var(--fg)}#cmdpop .cc-note{color:var(--mut);font-size:11px;line-height:1.35;margin:0 0 9px}' +
    '#cmdpop .cc-grp{border-top:1px solid var(--bd)}' +
    '#cmdpop .cc-sum{display:flex;align-items:center;min-height:26px;font-weight:700;font-size:12px;cursor:pointer;user-select:none}'+
    '#cmdpop .cc-sum::after{content:"+";color:var(--mut);font-size:14px}#cmdpop .cc-grp.open>.cc-sum::after{content:"\\2013"}' +
    '#cmdpop .cc-n{margin-left:auto!important;margin-right:8px;color:var(--mut);font-weight:500;font-size:10px}' +
    '#cmdpop .cc-r{display:grid;grid-template-columns:minmax(0,1fr) 52px;column-gap:6px;padding:2px 0 4px}' +
    '#cmdpop .cc-l{grid-column:1/-1;color:var(--mut);font-size:10px;margin-bottom:1px}' +
    '#cmdpop .cc-c{grid-column:1;min-width:0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;line-height:1.3;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:2px 6px;overflow-wrap:anywhere;user-select:all;display:flex;align-items:center}' +
    '#cmdpop .cc-b{grid-column:2;align-self:stretch;width:52px;min-height:0!important;padding:0!important;font-size:11px!important;border-radius:6px!important;display:flex;align-items:center;justify-content:center}';
  document.head.appendChild(css);

  // Built in like the other tools: a .card.pop opened with openPop(), and a button in the home tool row.
  function build() {
    const c = el('div', 'card pop'); c.id = 'cmdpop';
    const t = el('div', 'cc-title', 'Device commands'); c.appendChild(t);
    c.appendChild(el('div', 'cc-note', 'Run as root (AT console or adb). They only read, except Kill all copies.'));
    for (const [name, rows] of GROUPS) {
      const g = el('div', 'cc-grp'), s = el('div', 'cc-sum'), body = el('div'); s.setAttribute('role', 'button'); s.tabIndex = 0; body.hidden = true;   // a div, so the page's button rules do not restyle it
      s.appendChild(el('span', '', name)); s.appendChild(el('span', 'cc-n', String(rows.length)));
      const flip = () => { body.hidden = !body.hidden; g.classList.toggle('open', !body.hidden); s.setAttribute('aria-expanded', String(!body.hidden)); };
      s.onclick = flip; s.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };
      g.appendChild(s);
      for (const [label, cmd] of rows) {
        const r = el('div', 'cc-r'), b = el('button', 'cc-b', 'Copy'); b.type = 'button';
        r.appendChild(el('div', 'cc-l', label)); r.appendChild(el('div', 'cc-c', cmd)); r.appendChild(b);
        b.onclick = async () => { const ok = await copy(cmd); try { createToast(ok ? 'Copied' : 'Select the command and copy it by hand', ok ? 'green' : 'red'); } catch (_) { /* not fatal */ } };
        body.appendChild(r);
      }
      g.appendChild(body); c.appendChild(g);
    }
    const foot = el('div', 'popfoot'), x = el('button', 'popx', 'Close'); x.type = 'button'; x.onclick = () => closePop();
    foot.appendChild(x); c.appendChild(foot);
    (document.querySelector('main') || document.body).appendChild(c);
  }

  function mount() {
    const row = document.querySelector('#home .actions-buttons'); if (!row || document.getElementById('cmdBtn')) return;
    const btn = el('button', '', 'Commands'); btn.id = 'cmdBtn'; btn.type = 'button';
    btn.onclick = () => { if (!document.getElementById('cmdpop')) build(); openPop('cmdpop'); };
    row.appendChild(btn);
  }
  window.addEventListener('load', () => setTimeout(mount, 1000));
})();

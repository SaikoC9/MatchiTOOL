/*
 * Device Status - MatchiTOOL plugin
 * Shows battery, temperature, CPU load, memory, uptime and network addresses; includes a reboot button.
 */
(() => {
  'use strict';
  const MODAL = 'matchi_status_modal';
  const BTN_ID = 'matchi_status_btn';
  if (document.getElementById(BTN_ID)) return;

  const SCRIPT = String.raw`
b=/sys/class/power_supply/battery
echo "bat_cap=$(cat $b/capacity 2>/dev/null)"
echo "bat_status=$(cat $b/status 2>/dev/null)"
echo "bat_temp=$(cat $b/temp 2>/dev/null)"
echo "bat_volt=$(cat $b/voltage_now 2>/dev/null)"
for z in /sys/class/thermal/thermal_zone*; do
  [ -r "$z/temp" ] && echo "zone=$(cat $z/type 2>/dev/null)|$(cat $z/temp 2>/dev/null)"
done
echo "load=$(cut -d' ' -f1-3 /proc/loadavg)"
echo "up=$(cut -d' ' -f1 /proc/uptime)"
echo "memt=$(grep '^MemTotal' /proc/meminfo | tr -s ' ' | cut -d' ' -f2)"
echo "mema=$(grep '^MemAvailable' /proc/meminfo | tr -s ' ' | cut -d' ' -f2)"
ip -4 -o addr show 2>/dev/null | while read -r _ ifn _ addr _; do echo "ip=$ifn|$addr"; done
`;

  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtUp = (sec) => {
    sec = Math.floor(parseFloat(sec) || 0);
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return (d ? d + 'd ' : '') + h + 'h ' + m + 'm';
  };
  // Kernels report temperature in 0.1 C (battery) or milli-C (thermal zones); normalise to C.
  const toC = (v) => { v = parseFloat(v); if (isNaN(v)) return null; return Math.abs(v) >= 1000 ? v / 1000 : Math.abs(v) >= 100 ? v / 10 : v; };

  function parse(text) {
    const o = { zones: [], ips: [] };
    text.split('\n').forEach((line) => {
      const i = line.indexOf('='); if (i < 0) return;
      const k = line.slice(0, i), v = line.slice(i + 1).trim();
      if (k === 'zone') { const [n, t] = v.split('|'); const c = toC(t); if (c !== null) o.zones.push([n, c]); }
      else if (k === 'ip') o.ips.push(v.split('|'));
      else o[k] = v;
    });
    return o;
  }

  function render(o) {
    const memT = parseInt(o.memt) || 0, memA = parseInt(o.mema) || 0;
    const used = memT ? Math.round(((memT - memA) / memT) * 100) : '?';
    const bt = toC(o.bat_temp);
    const rows = [
      ['Battery', (o.bat_cap || '?') + '% ' + esc(o.bat_status || '')],
      ['Battery temp', bt === null ? '?' : bt.toFixed(1) + ' °C'],
      ['Load (1/5/15m)', esc(o.load || '?')],
      ['Memory used', used + '% of ' + Math.round(memT / 1024) + ' MB'],
      ['Uptime', fmtUp(o.up)],
    ];
    o.zones.slice(0, 8).forEach(([n, c]) => rows.push(['Temp ' + esc(n), c.toFixed(1) + ' °C']));
    o.ips.forEach(([n, a]) => rows.push(['IP ' + esc(n), esc(a)]));
    return '<table style="width:100%;border-collapse:collapse">' +
      rows.map((r) => `<tr><td style="padding:5px 8px 5px 0;opacity:.7">${r[0]}</td><td style="padding:5px 0;text-align:right">${r[1]}</td></tr>`).join('') +
      '</table>';
  }

  async function refresh() {
    const box = document.getElementById('matchi_status_body');
    if (!box) return;
    box.textContent = 'Loading…';
    try {
      const r = await runShellWithRoot(SCRIPT, 15000);
      box.innerHTML = r.success || r.content ? render(parse(r.content)) : esc('Failed: ' + r.content);
    } catch (e) { box.textContent = 'Error: ' + e.message; }
  }

  function open() {
    createModal({
      name: MODAL, title: 'Device status', maxWidth: '440px', showConfirm: false, onClose: () => true,
      content: '<div id="matchi_status_body"></div>' +
        '<div style="display:flex;gap:8px;margin-top:12px">' +
        '<button type="button" id="matchi_status_refresh">Refresh</button>' +
        '<button type="button" id="matchi_status_reboot" style="color:#e03131">Reboot device</button></div>',
    });
    showModal(MODAL);
    document.getElementById('matchi_status_refresh').onclick = refresh;
    document.getElementById('matchi_status_reboot').onclick = async () => {
      if (!window.confirm('Reboot the device now?')) return;
      createToast('Rebooting…', 'orange');
      try { await runShellWithRoot('reboot', 5000); } catch (_) {}
    };
    refresh();
  }

  const host = document.querySelector('.actions-buttons');
  if (!host) return;
  const b = document.createElement('button');
  b.id = BTN_ID; b.textContent = 'Device status'; b.onclick = open;
  host.appendChild(b);
})();

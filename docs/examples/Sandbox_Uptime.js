// Sandbox example: shows the device uptime and the signal bars, and remembers the last value.
// @matchi-needs shell: cat /proc/uptime
// @matchi-needs router: signalbar
document.body.innerHTML = '<button id="go">Refresh</button><pre id="out">Press Refresh</pre>';
document.getElementById('go').onclick = async () => {
  const out = document.getElementById('out');
  try {
    const up = await matchi.shell('cat /proc/uptime');        // exactly the command declared above, nothing added
    const rt = await matchi.router.get(['signalbar']);          // only the field declared above
    const text = 'uptime: ' + up.content.trim() + '\nsignal bars: ' + rt.signalbar;
    out.textContent = text;
    await matchi.storage.set('last', text);
  } catch (e) { out.textContent = 'Not possible: ' + e.message; }
};
matchi.storage.get('last').then((v) => { if (v) document.getElementById('out').textContent = v; });

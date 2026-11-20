// Stop example: a plugin that starts a background job and a boot entry, and says how to stop both when it is deleted.
// Author guide: docs/PLUGIN_STOP.md. Header lines must stay in the first 400 lines of the file, one per line, starting with "//".
// @matchi-uninstall rm -f /data/local/matchitool/boot.d/30-stop-example.sh
// @matchi-uninstall [ ! -f /data/local/stop_example/beat.sh ] || sh /data/local/stop_example/beat.sh stop
// @matchi-uninstall rm -rf /data/local/stop_example
// @matchi-check ! ps -A -o ARGS 2>/dev/null | grep -v grep | grep -q 'stop_example/beat.sh' && [ ! -e /data/local/stop_example ]
// @matchi-boot /data/local/matchitool/boot.d/30-stop-example.sh
(async () => {
  const DIR = '/data/local/stop_example';
  const BOOT = '/data/local/matchitool/boot.d/30-stop-example.sh';
  // The helper writes the time into beat.txt every 30 s. "stop" ends it and is safe to run twice.
  const HELPER = [
    'D=' + DIR,
    'case "$1" in',
    '  start) [ -f $D/beat.pid ] && kill -0 "$(cat $D/beat.pid)" 2>/dev/null && exit 0',
    '         ( while :; do date > $D/beat.txt; sleep 30; done ) & echo $! > $D/beat.pid ;;',
    '  stop) [ -f $D/beat.pid ] && kill -9 "$(cat $D/beat.pid)" 2>/dev/null; rm -f $D/beat.pid; exit 0 ;;',
    'esac',
  ].join('\n');
  const run = async (cmd) => { const r = await runShellWithRoot(cmd, 20000); return r && r.success; };
  const install = () => run(`mkdir -p ${DIR} && cat > ${DIR}/beat.sh <<'EOT'\n${HELPER}\nEOT\n` +
    `mkdir -p /data/local/matchitool/boot.d && echo 'sh ${DIR}/beat.sh start >/dev/null 2>&1 &' > ${BOOT} && sh ${DIR}/beat.sh start`);
  const btn = document.createElement('button');
  btn.textContent = 'Start the heartbeat job';
  btn.onclick = async () => { btn.disabled = true; createToast((await install()) ? 'Started' : 'Could not start', 'orange'); btn.disabled = false; };
  document.body.appendChild(btn);
})();

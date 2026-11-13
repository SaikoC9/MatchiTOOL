// No-headers example: starts a small background job and declares NOTHING (no @matchi-uninstall, no @matchi-check, no @matchi-boot).
// It shows what the process sweep is for. Author guide: docs/PLUGIN_STOP.md (section "Plugins without headers: the process sweep").
//
// To try it (trusted plugin, root needed):
//   1. Install it and press "Start the heartbeat job". beat.txt gets the time every 30 s.
//   2. Delete the plugin. The dialog should list the job under "Running now", found by tag, and offer "Delete and stop".
//   3. After the delete: ps -A -o ARGS | grep nohdr_example  (nothing but the grep itself), and /data/local/nohdr_example/beat.txt stops changing.
// Not yet tried on a device. A real plugin should still declare its stop commands: the sweep is best effort.
(async () => {
  const DIR = '/data/local/nohdr_example';
  // runShellWithRoot goes through MatchiTOOL, which tags the command with this plugin's name. The job inherits the tag.
  const start = () => runShellWithRoot(
    `mkdir -p ${DIR} && (nohup sh -c 'while :; do date > ${DIR}/beat.txt; sleep 30; done' >/dev/null 2>&1 &)`, 20000);
  const btn = document.createElement('button');
  btn.textContent = 'Start the heartbeat job';
  btn.onclick = async () => {
    btn.disabled = true;
    const r = await start();
    createToast(r && r.success ? 'Started' : 'Could not start', 'orange');
    btn.disabled = false;
  };
  document.body.appendChild(btn);
})();

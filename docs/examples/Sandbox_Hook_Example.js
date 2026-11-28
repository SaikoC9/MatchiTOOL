// Sandbox hook example: a SANDBOXED plugin that starts a small background job and registers its own stop code.
// Author guide: docs/PLUGIN_STOP.md (section "The stop hook").
// Both commands are granted with exactly the text the plugin sends; a hook can only run what was approved.
// @matchi-needs shell: mkdir -p /data/local/hook_example && (nohup sh -c 'while :; do date > /data/local/hook_example/beat.txt; sleep 30; done' >/dev/null 2>&1 &)
// @matchi-needs shell: pkill -f 'hook_exampl[e]/beat.txt'; true
//
// To try it: install, press its shield button (sandbox) and approve, press "Start", then Delete the plugin.
// The dialog should say it also runs its own stop code (15 s at most) and offer "Delete and stop".
// The scan afterwards decides: if the job is still there, the plugin is kept.
// The [e] in the pkill pattern keeps pkill from matching the shell that runs it.
//
if (typeof matchi === 'undefined') {
  if (typeof createToast === 'function') createToast('Sandbox_Hook_Example.js is NOT sandboxed. Press its shield button to run it sandboxed.', 'orange');
} else {
  document.body.innerHTML = '<button id="go">Start the heartbeat job</button><pre id="out"></pre>';
  document.getElementById('go').onclick = async () => {
    const out = document.getElementById('out');
    try {
      await matchi.shell("mkdir -p /data/local/hook_example && (nohup sh -c 'while :; do date > /data/local/hook_example/beat.txt; sleep 30; done' >/dev/null 2>&1 &)");
      out.textContent = 'Started';
    } catch (e) { out.textContent = 'Not possible: ' + e.message; }
  };
  // Runs when the person chooses "Delete and stop". Only commands granted above can be used.
  matchi.onUninstall(async () => {
    await matchi.shell("pkill -f 'hook_exampl[e]/beat.txt'; true");
  });
}

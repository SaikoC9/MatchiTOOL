// Runs the Log basket page script (index.html) against a fake DOM and a fake api(): redaction on copy, the delete list,
// the confirm text and the search box in View. The real page redaction function is used, not a copy.
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/assets/web/index.html'), 'utf8');
const ra = html.indexOf('/* REDACT-BEGIN'), rb = html.indexOf('/* REDACT-END */');
const { redactText } = new Function(html.slice(ra, rb) + '\nreturn {redactText};')();
const i = html.indexOf('/* Log basket (step 2)'); if (i < 0) { console.error('basket script missing'); process.exit(1); }
const code = html.slice(html.lastIndexOf('<script>', i) + 8, html.indexOf('</script>', i));
let bad = 0;
const ok = (c, n) => { if (!c) { bad++; console.error('FAIL', n); } };

const rows = [
  { id: 'session:done.log', type: 'session', name: 'done.log', size: 10, modified: 5, canDelete: true },
  { id: 'session:live.log', type: 'session', name: 'live.log', size: 10, modified: 9, active: true, canDelete: false },
  { id: 'audit:shell_audit.log', type: 'audit', name: 'shell_audit.log', size: 5, modified: 3, canDelete: true },
  { id: 'boot:logcat.log', type: 'boot', name: 'logcat.log', size: 5, modified: 0, rootOnly: true, canDelete: false },
  { id: 'boot:logcat.log.1', type: 'boot', name: 'logcat.log.1', size: 5, modified: 0, rootOnly: true, canDelete: true },
];
function env() {
  const els = {}; let ticked = []; const calls = [], toasts = []; const st = { clip: null, confirm: null };
  const chipBtns = ['all','errors','plugins','shell'].map(c => ({ dataset: { chip: c }, classList: { toggle() {} } }));
  const el = id => els[id] || (els[id] = { id, style: {}, value: '', checked: id === 'lbredact', textContent: '', innerHTML: '' });
  const win = { __lcRedact: redactText };
  const api = async (p, o) => {
    calls.push([p, o]);
    if (p === '/api/logs/basket') return { rows, running: true, bootNote: '' };
    if (p.startsWith('/api/logs/basket/read')) return { lines: ['start ok', 'error: x failed', 'password=hunter2', '1 [ERROR] [plugin/js] [E5.js] JS error: boom', '2 [INFO] [plugin/shell] POST /api/root_shell 200 5ms', '3 [INFO] [plugin/at] POST /api/AT 200 9ms'], shown: 6, truncated: false };
    if (p.startsWith('/api/logs/boot/read')) return p.includes('limit=1&') || p.endsWith('limit=1') ? { total: 3, lines: ['a'] } : { total: 3, lines: ['11-08 10:00:00.1 1 1 I A: ok', '11-08 10:00:01.1 1 1 E B: bad', '11-08 10:00:02.1 1 1 I C: ok'], rows: [{ lv: 'INFO' }, { lv: 'ERROR' }, { lv: 'INFO' }] };
    if (p === '/api/logs/snapshot') return { ok: true, name: 'matchitool_snapshot_' + JSON.parse(o.body).label + '.txt', lines: 7 };
    if (p === '/api/logs/basket/delete') return { results: JSON.parse(o.body).ids.map(id => ({ id, ok: true })) };
    return {};
  };
  const ctx = { document: { getElementById: el, querySelectorAll: sel => sel.includes('lbchips') ? chipBtns : ticked.map(id => ({ dataset: { id } })) }, window: win,
    navigator: { clipboard: { writeText: async t => { st.clip = t; } } }, createToast: m => toasts.push(m),
    askConfirm: async t => { st.confirm = t; return true; }, api, console };
  vm.runInNewContext(code, ctx);
  return { el, win, calls, toasts, st, chipBtns, tick: ids => { ticked = ids; } };
}
(async () => {
  const e = env(); await e.win.lbOpen();

  e.tick(['session:done.log']); await e.el('lbcopy').onclick();
  ok(e.st.clip && e.st.clip.includes('password=[REDACTED]') && !e.st.clip.includes('hunter2'), 'copy hides the password by default');
  e.el('lbredact').checked = false; await e.el('lbcopy').onclick();
  ok(e.st.clip.includes('hunter2'), 'copy keeps the text when the box is unticked');
  e.el('lbredact').checked = true;

  e.tick(['session:done.log', 'session:live.log']); await e.el('lbcopy').onclick();
  ok(e.st.clip.includes('===== done.log') && e.st.clip.includes('===== live.log'), 'several rows get a header each');

  e.tick(rows.map(r => r.id)); e.calls.length = 0; await e.el('lbdelete').onclick();
  const del = e.calls.find(c => c[0] === '/api/logs/basket/delete');
  const sent = del ? JSON.parse(del[1].body).ids : [];
  ok(JSON.stringify(sent) === JSON.stringify(['session:done.log', 'audit:shell_audit.log', 'boot:logcat.log.1']), 'delete sends only deletable rows: ' + JSON.stringify(sent));
  ok(!sent.includes('session:live.log') && !sent.includes('boot:logcat.log'), 'active session and live boot file are never sent');
  ok(/audit log/.test(e.st.confirm) && /root sign-in/i.test(e.st.confirm) && /boot capture/i.test(e.st.confirm), 'confirm explains audit and boot rows');
  ok(/2 selected row\(s\) cannot be deleted/.test(e.st.confirm), 'confirm counts the rows that stay');

  e.tick(['session:live.log', 'boot:logcat.log']); e.calls.length = 0; await e.el('lbdelete').onclick();
  ok(!e.calls.some(c => c[0] === '/api/logs/basket/delete'), 'nothing is sent when no selected row can be deleted');

  e.tick(['session:done.log']); await e.el('lbview').onclick();
  ok(e.el('lbout').textContent.includes('password=[REDACTED]') && !e.el('lbout').textContent.includes('hunter2'), 'view hides private data');
  e.el('lbsearch').value = 'FAILED'; e.el('lbsearch').oninput();
  ok(e.el('lbout').textContent === 'error: x failed' && e.el('lbmatch').textContent === '1 of 6 lines match', 'search keeps matching lines (case-insensitive)');
  e.el('lbsearch').value = 'zzz'; e.el('lbsearch').oninput();
  ok(e.el('lbout').textContent === 'No line matches.', 'search with no match says so');

  e.el('lbsearch').value = ''; e.el('lbsearch').oninput();
  const chip = n => e.chipBtns.find(b => b.dataset.chip === n).onclick();
  chip('errors'); ok(e.el('lbout').textContent === '1 [ERROR] [plugin/js] [E5.js] JS error: boom', 'Errors chip keeps only ERROR lines');
  chip('plugins'); ok(e.el('lbout').textContent.split('\n').length === 3 && !e.el('lbout').textContent.includes('start ok'), 'Plugins chip keeps plugin/... lines');
  chip('shell'); ok(e.el('lbout').textContent === '2 [INFO] [plugin/shell] POST /api/root_shell 200 5ms' && e.el('lbmatch').textContent === '1 of 6 lines match', 'Root shell chip keeps plugin/shell lines');
  e.el('lbsearch').value = 'at'; e.el('lbsearch').oninput(); chip('plugins'); ok(e.el('lbout').textContent.includes('/api/AT') && !e.el('lbout').textContent.includes('root_shell'), 'chip and search work together');
  e.el('lbsearch').value = ''; chip('all'); e.tick(['session:done.log']); chip('plugins'); await e.el('lbview').onclick();
  ok(e.el('lbout').textContent.split('\n').length === 3, 'View opens already filtered by the chosen chip');
  // Audit rows: every line is a root command. Boot rows: Errors uses the parsed level.
  e.el('lbsearch').value = ''; chip('all');
  e.tick(['audit:shell_audit.log']); await e.el('lbview').onclick(); chip('shell');
  ok(e.el('lbout').textContent.split('\n').length === 6, 'Root shell chip keeps every audit line');
  chip('errors'); ok(/no levels or plugin tags/.test(e.el('lbmatch').textContent), 'audit rows explain why Errors/Plugins show nothing useful');
  chip('all'); e.tick(['boot:logcat.log']); await e.el('lbview').onclick(); chip('errors');
  ok(e.el('lbout').textContent === '11-08 10:00:01.1 1 1 E B: bad', 'Errors chip on a boot row uses the parsed level');
  chip('plugins'); ok(/only in session logs/.test(e.el('lbmatch').textContent), 'boot rows explain that plugin tags are session-only');
  chip('all');
  e.calls.length = 0; await e.el('lbsnapb').onclick(); await e.el('lbsnapa').onclick();
  const sn = e.calls.filter(c => c[0] === '/api/logs/snapshot').map(c => JSON.parse(c[1].body).label);
  ok(JSON.stringify(sn) === JSON.stringify(['before', 'after']), 'snapshot buttons send before and after: ' + JSON.stringify(sn));
  ok(e.calls.some(c => c[0] === '/api/logs/basket'), 'list reloads after a snapshot so the new export row shows');
  ok(e.toasts.some(m => /Snapshot saved: matchitool_snapshot_before/.test(m)), 'snapshot toast names the file');

  // The live panel is reached from inside the basket, not from the main screen.
  const mainBar = html.slice(html.indexOf('class="actions-buttons"'), html.indexOf('</div>', html.indexOf('class="actions-buttons"')));
  ok(!/openPop\('logcatcher'\)/.test(mainBar) && /openPop\('logbasket'\)/.test(mainBar), 'main screen has the Log Basket button and no direct Log Catcher button');
  ok(/id="lblive" onclick="openPop\('logcatcher'\)"/.test(html), 'basket has the Live view button');
  ok(/setInterval\(\(\)=>\{if\(panelOpen\(\)\|\|alertsOn\(\)\|\|stream\)syncStream\(\)\},2000\)/.test(html) && !/setInterval\(syncStream,2000\)/.test(html), 'stream check no longer runs on its own timer when nothing needs it');
  // Redaction must fail closed: with the page redactor missing and the box ticked, nothing is shown or copied.
  {
    const f = env(); await f.win.lbOpen(); f.win.__lcRedact = undefined; f.st.clip = null;
    f.tick(['session:done.log']); await f.el('lbcopy').onclick();
    ok(f.st.clip === null, 'copy puts nothing on the clipboard when redaction is unavailable');
    f.el('lbout').textContent = ''; await f.el('lbview').onclick();
    ok(!f.el('lbout').textContent.includes('hunter2'), 'view shows nothing when redaction is unavailable');
    f.el('lbredact').checked = false; await f.el('lbcopy').onclick();
    ok(f.st.clip && f.st.clip.includes('hunter2'), 'unticking the box still copies the original on purpose');
  }
  if (bad) { console.error(bad + ' log basket check(s) failed'); process.exit(1); }
  console.log('log basket page tests passed');
})();

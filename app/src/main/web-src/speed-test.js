/* speed-test.js: Speed test and Band test (opened from Network Diagnostics > Speed test). window.MatchiSpeed.
 * Core (no DOM, scripts/test_speed_test.js runs it as it is):
 *   validHost / validPort / validSecs   input checks (the values go into a shell line, so only plain characters pass)
 *   script(host, port, secs, download)  root script: runs the bundled iperf3 as a client, JSON output; prints NOIPERF3 when it is not installed
 *   parse(text)                         { ok, mbps, retrans } or { ok:false, error }
 *   rank(results)                       fastest first; results with an error go last
 *   bandTest(o)                         lock each band in turn, wait for registration, read the signal, run the speed test, then ALWAYS put the old lock back
 * UI: MatchiSpeed.open(). iperf3 runs only as a client (the carrier address cannot be reached from outside). */
(() => {
  'use strict';

  // ---- core ---------------------------------------------------------------------------------------------------
  const validHost = (h) => typeof h === 'string' && h.length <= 253 && (/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(h) || /^[0-9A-Fa-f:]{2,45}$/.test(h) && h.includes(':'));
  const validPort = (p) => /^\d{1,5}$/.test(String(p)) && +p >= 1 && +p <= 65535;
  const validSecs = (s) => /^\d{1,2}$/.test(String(s)) && +s >= 3 && +s <= 30;

  const FIND = [
    'B=""',
    'for c in /data/data/com.matchi.tool/files/iperf3 /data/user/0/com.matchi.tool/files/iperf3 /data/local/matchitool/bin/iperf3; do [ -x "$c" ] && B=$c && break; done',
    '[ -n "$B" ] || { echo NOIPERF3; exit 0; }',
  ];
  // download = true: the server sends (-R), the number is what the F50 receives. false: the F50 sends.
  function script(host, port, secs, download) {
    if (!validHost(host) || !validPort(port) || !validSecs(secs)) throw new Error('Invalid server, port or time');
    return FIND.concat([
      'T=""; command -v timeout >/dev/null 2>&1 && T="timeout ' + (+secs + 20) + '"',
      '$T "$B" -c ' + host + ' -p ' + +port + ' -t ' + +secs + ' -J --connect-timeout 6000' + (download ? ' -R' : '') + ' 2>&1',
    ]).join('\n');
  }
  function parse(text) {
    const s = String(text == null ? '' : text);
    if (/NOIPERF3/.test(s)) return { ok: false, error: 'iperf3 is not installed in this app version yet' };
    const i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i < 0 || j <= i) return { ok: false, error: (s.trim().split('\n').pop() || 'No answer').slice(0, 160) };
    let d; try { d = JSON.parse(s.slice(i, j + 1)); } catch (_) { return { ok: false, error: 'Unreadable iperf3 answer' }; }
    if (d.error) return { ok: false, error: String(d.error).slice(0, 160) };
    const e = d.end || {}, r = e.sum_received || e.sum_sent;
    if (!r || !(r.bits_per_second >= 0)) return { ok: false, error: 'No result in the iperf3 answer' };
    return { ok: true, mbps: Math.round(r.bits_per_second / 1e4) / 100, retrans: e.sum_sent && Number.isFinite(e.sum_sent.retransmits) ? e.sum_sent.retransmits : null };
  }
  const rank = (results) => results.slice().sort((a, b) => (a.mbps == null) - (b.mbps == null) || (b.mbps || 0) - (a.mbps || 0));

  // o: { R (window.MatchiRadio), type 'lte'|'nr', bands [n], full [n] (all supported, used when the old lock reads empty),
  //      speed() -> {ok,mbps,error}, signal() -> {rsrp,sinr,band}, log(line), stop() -> bool, progress(i, n) }
  async function bandTest(o) {
    const R = o.R, lte = o.type === 'lte', gf = lte ? 'LTE_BAND_LOCK' : 'NR_BAND_LOCK', param = lte ? 'lte_band_lock' : 'nr_band_lock';
    const name = (b) => (lte ? 'B' : 'n') + b, log = o.log || (() => {});
    const before = await R.readBands();
    let orig = (lte ? before.lte : before.nr) || [];
    if (!orig.length) orig = (o.full || []).slice();
    if (!orig.length) throw new Error('No band list to restore, so the test was not started');
    const apply = async (list) => {
      const r = await R.setBands([[gf, param, R.bandText(list)]], lte ? { lte: list } : { nr: list });
      if (!r.ok) throw new Error('the router did not report the new lock' + (r.bad && r.bad.length ? ' (' + r.bad.join('; ') + ')' : ''));
      if (!(await R.radioCycle({ log: () => {}, toast: () => {} }))) throw new Error('radio restart not confirmed');
      return R.waitRegistered(0, { everyMs: 3000, timeoutMs: 90000 });
    };
    const results = []; let aborted = '', restored = false;
    const done = R.beginBusy('Band test running');
    try {
      for (let i = 0; i < o.bands.length; i++) {
        if (o.stop && o.stop()) { aborted = 'stopped'; break; }
        const b = o.bands[i], row = { band: b, label: name(b), mbps: null, rsrp: null, sinr: null, active: '', error: '' };
        results.push(row); if (o.progress) o.progress(i, o.bands.length);
        try {
          log('Locking ' + name(b) + '…');
          if (!(await apply([b]))) { row.error = 'no registration in 90 s'; log(name(b) + ': no registration'); continue; }
          await R.sleep(4000);
          try { const s = await o.signal(); row.rsrp = s.rsrp; row.sinr = s.sinr; row.active = s.band || ''; } catch (_) { /* signal is a bonus */ }
          log('Testing speed on ' + name(b) + '…');
          const t = await o.speed();
          if (t.ok) { row.mbps = t.mbps; log(name(b) + ': ' + t.mbps + ' Mbps'); } else { row.error = t.error || 'speed test failed'; log(name(b) + ': ' + row.error); }
        } catch (e) { row.error = e.message; log(name(b) + ': ' + e.message); if (/radio restart/.test(e.message)) { aborted = e.message; break; } }
      }
    } finally {
      try { log('Putting the old lock back: ' + orig.map(name).join(' ')); const reg = await apply(orig); restored = true; log(reg ? 'Old lock restored.' : 'Old lock restored, not registered yet.'); } catch (e) { log('COULD NOT RESTORE the old lock: ' + e.message + '. Use Unlock all in Radio settings.'); }
      done();
    }
    return { results, ranked: rank(results), restored, aborted, orig };
  }

  // ---- UI (only runs when the person opens it) ------------------------------------------------------------------
  const MODAL = 'matchi_speed_modal';
  const store = {
    get(k, d) { try { const v = localStorage.getItem('matchi_speed_' + k); return v == null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem('matchi_speed_' + k, v); } catch (_) { /* not fatal */ } },
  };
  const el = (tag, props, kids) => { const n = document.createElement(tag); Object.assign(n, props || {}); (kids || []).forEach((k) => n.append(k)); return n; };
  const toast = (t, c) => { try { createToast(t, c); } catch (_) { /* not fatal */ } };

  function open() {
    const R = window.MatchiRadio;
    createModal({
      name: MODAL, title: 'Speed test', maxWidth: '560px', showConfirm: false, onClose: () => { st.stop = true; return true; },
      content: '<div style="display:grid;grid-template-columns:1fr 90px 80px;gap:6px"><input id="sp_host" list="sp_hosts" placeholder="iperf3 server (host)" autocomplete="off" spellcheck="false"><input id="sp_port" inputmode="numeric" placeholder="port"><select id="sp_secs"><option value="5">5 s</option><option value="10">10 s</option></select></div>' +
        '<datalist id="sp_hosts"><option value="iperf.biznetnetworks.com"><option value="ping.online.net"><option value="speedtest.sin1.sg.leaseweb.net"></datalist>' +
        '<div class="mut" style="font-size:11px;margin:4px 0 8px">Public iperf3 servers are often busy: try another port or server. The test uses mobile data (about 5 s of full speed each way). Suggested hosts are not checked.</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" id="sp_run">Run speed test</button><button type="button" id="sp_stop" disabled>Stop</button></div>' +
        '<div id="sp_out" style="margin:8px 0;min-height:18px;white-space:pre-wrap;overflow-wrap:anywhere"></div>' +
        '<hr style="border:0;border-top:1px solid var(--bd);margin:10px 0"><b>Band test</b>' +
        '<div class="mut" style="font-size:11px;margin:4px 0">Locks each ticked band in turn (radio restart about 30 s each), runs a download test and reads the signal, then puts your old lock back. Internet is off during the test. Needs the server above.</div>' +
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><select id="sp_type"><option value="lte">LTE bands</option><option value="nr">5G NR bands</option></select><span class="mut" id="sp_bmsg" style="font-size:11px"></span></div>' +
        '<div id="sp_chips" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px"></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" id="sp_btest" disabled>Test ticked bands</button><button type="button" id="sp_lockbest" disabled>Lock best</button></div>' +
        '<div id="sp_table" style="margin-top:8px"></div><pre id="sp_log" style="display:none;margin:8px 0 0;padding:6px 8px;max-height:110px;overflow:auto;white-space:pre-wrap;font-size:10.5px;background:var(--bg);border:1px solid var(--bd);border-radius:8px"></pre>',
    });
    showModal(MODAL);
    const $ = (id) => document.getElementById(id);
    const st = { stop: false, busy: false, sup: { lte: [], nr: [] }, tick: new Set(), best: null, type: 'lte' };
    $('sp_host').value = store.get('host', ''); $('sp_port').value = store.get('port', '5201'); $('sp_secs').value = store.get('secs', '5');
    const setOut = (t, c) => { const o = $('sp_out'); o.textContent = t; o.style.color = c || ''; };
    const log = (l) => { const p = $('sp_log'); p.style.display = 'block'; p.textContent += l + '\n'; p.scrollTop = p.scrollHeight; };
    const inputs = () => {
      const host = $('sp_host').value.trim(), port = $('sp_port').value.trim(), secs = $('sp_secs').value;
      if (!validHost(host)) throw new Error('Enter a valid server name or address');
      if (!validPort(port)) throw new Error('Enter a port from 1 to 65535');
      store.set('host', host); store.set('port', port); store.set('secs', secs);
      return { host, port: +port, secs: +secs };
    };
    const busy = (on) => { st.busy = on; $('sp_run').disabled = on; $('sp_stop').disabled = !on; $('sp_btest').disabled = on || !st.tick.size; $('sp_lockbest').disabled = on || !st.best; $('sp_type').disabled = on; };
    const one = async (i, download) => {
      const r = parse((await runShellWithRoot(script(i.host, i.port, i.secs, download), (i.secs + 30) * 1000)).content);
      return r;
    };
    const fmt = (r) => (r.ok ? r.mbps + ' Mbps' + (r.retrans != null && r.retrans > 0 ? ' (' + r.retrans + ' retransmits)' : '') : r.error);

    $('sp_run').onclick = async () => {
      if (st.busy) return;
      let i; try { i = inputs(); } catch (e) { setOut(e.message, '#ff9a9a'); return; }
      st.stop = false; busy(true);
      try {
        setOut('Download test… ' + i.secs + ' s');
        const d = await one(i, true); if (!d.ok) { setOut('Download: ' + fmt(d), '#ff9a9a'); return; }
        setOut('Download: ' + fmt(d) + '\nUpload test… ' + i.secs + ' s');
        const u = await one(i, false);
        setOut('Download: ' + fmt(d) + '\nUpload: ' + fmt(u) + '\n' + new Date().toLocaleTimeString(), u.ok ? '' : '#ff9a9a');
      } catch (e) { setOut('Speed test failed: ' + e.message, '#ff9a9a'); } finally { busy(false); }
    };
    $('sp_stop').onclick = () => { st.stop = true; $('sp_stop').disabled = true; setOut('Stopping after this step…'); };

    function drawChips() {
      const box = $('sp_chips'); box.textContent = '';
      for (const b of st.sup[st.type]) {
        const on = st.tick.has(b), n = (st.type === 'nr' ? 'n' : 'B') + b;
        const btn = el('button', { type: 'button', textContent: n, className: 'dr-b' }); btn.style.cssText = 'min-height:24px;padding:2px 8px;font-size:11.5px;opacity:' + (on ? 1 : .55) + (on ? ';background:rgba(100,230,164,.35)' : '');
        btn.setAttribute('aria-pressed', String(on));
        btn.onclick = () => { if (st.busy) return; if (st.tick.has(b)) st.tick.delete(b); else if (st.tick.size < 6) st.tick.add(b); else toast('Test at most 6 bands at a time', 'red'); drawChips(); $('sp_btest').disabled = st.busy || !st.tick.size; };
        box.append(btn);
      }
    }
    async function loadBands() {
      if (!R) { $('sp_bmsg').textContent = 'Radio tools not available'; return; }
      try {
        const b = await R.readBands();
        st.sup.lte = b.lte !== null ? [...new Set([...R.LTE_BANDS, ...(b.lte || [])])].sort((x, y) => x - y) : [];
        let nr = []; if (b.nr !== null) { try { nr = await R.readNrSupported(0); } catch (_) { nr = []; } st.sup.nr = [...new Set([...(nr || []), ...(b.nr || [])])].sort((x, y) => x - y); } else st.sup.nr = [];
        $('sp_bmsg').textContent = ''; drawChips();
      } catch (e) { $('sp_bmsg').textContent = 'Could not read bands: ' + e.message; }
    }
    $('sp_type').onchange = () => { st.type = $('sp_type').value; st.tick.clear(); st.best = null; drawChips(); busy(false); };

    function drawTable(res) {
      const box = $('sp_table'); box.textContent = '';
      const t = el('table'); t.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
      const head = el('tr'); ['Band', 'Mbps', 'RSRP', 'SINR', 'Note'].forEach((h) => { const c = el('th', { textContent: h }); c.style.cssText = 'text-align:left;padding:3px 6px 3px 0;opacity:.7'; head.append(c); }); t.append(head);
      for (const r of res) {
        const tr = el('tr'); [r.label, r.mbps == null ? '-' : r.mbps, r.rsrp == null || r.rsrp === '' ? '-' : r.rsrp, r.sinr == null || r.sinr === '' ? '-' : r.sinr, r.error || (r.active ? 'in use: ' + r.active : '')].forEach((v) => { const c = el('td', { textContent: String(v) }); c.style.cssText = 'padding:3px 6px 3px 0;border-top:1px solid var(--bd)'; tr.append(c); }); t.append(tr);
      }
      box.append(t);
    }
    $('sp_btest').onclick = async () => {
      if (st.busy || !st.tick.size) return;
      let i; try { i = inputs(); } catch (e) { setOut(e.message, '#ff9a9a'); return; }
      const bands = [...st.tick].sort((a, b) => a - b), n = bands.length;
      if (!(await askConfirm('Test ' + bands.map((b) => (st.type === 'nr' ? 'n' : 'B') + b).join(' ') + '?\n\nAbout ' + Math.ceil(n * 1.7) + ' minutes. The internet is off during each radio restart. Your old band lock is put back at the end. If anything fails, use Unlock all in Radio settings.', 'Start test', true))) return;
      st.stop = false; st.best = null; $('sp_log').textContent = ''; $('sp_table').textContent = ''; busy(true); setOut('Band test running… do not close this window');
      try {
        const out = await bandTest({
          R, type: st.type, bands, full: st.sup[st.type], log,
          speed: () => one(i, true), stop: () => st.stop,
          progress: (k, m) => setOut('Band test ' + (k + 1) + ' of ' + m + '… do not close this window'),
          signal: async () => {
            const d = (await R.zte('get', { multi_data: '1', cmd: 'lte_rsrp,lte_snr,Z5g_rsrp,Z5g_SINR,wan_active_band,nr5g_action_band' })) || {};
            return st.type === 'nr' ? { rsrp: d.Z5g_rsrp, sinr: d.Z5g_SINR, band: d.nr5g_action_band } : { rsrp: d.lte_rsrp, sinr: d.lte_snr, band: d.wan_active_band };
          },
        });
        drawTable(out.ranked);
        const top = out.ranked.find((r) => r.mbps != null);
        st.best = top ? top.band : null;
        setOut((out.aborted ? 'Test ' + out.aborted + '. ' : 'Done. ') + (top ? 'Fastest: ' + top.label + ' at ' + top.mbps + ' Mbps. ' : 'No band gave a result. ') + (out.restored ? 'Old lock restored.' : 'OLD LOCK NOT RESTORED: use Unlock all in Radio settings.'), out.restored ? '' : '#ff9a9a');
      } catch (e) { setOut('Band test failed: ' + e.message, '#ff9a9a'); } finally { busy(false); }
    };
    $('sp_lockbest').onclick = async () => {
      if (st.busy || st.best == null) return;
      const b = st.best, lte = st.type === 'lte', n = (lte ? 'B' : 'n') + b;
      if (!(await askConfirm('Lock ' + n + ' only?\n\nRadio restarts (~30 s). Undo with Unlock all in Radio settings.', 'Lock', true))) return;
      busy(true); const done = R.beginBusy('Locking best band');
      try {
        setOut('Locking ' + n + '…');
        const r = await R.setBands([[lte ? 'LTE_BAND_LOCK' : 'NR_BAND_LOCK', lte ? 'lte_band_lock' : 'nr_band_lock', String(b)]], lte ? { lte: [b] } : { nr: [b] });
        if (!r.ok) throw new Error('the router did not report the new lock');
        if (!(await R.radioCycle({ log: () => {}, toast: () => {} }))) throw new Error('radio restart not confirmed');
        const reg = await R.waitRegistered(0, { everyMs: 3000, timeoutMs: 90000 });
        setOut(reg ? n + ' locked.' : n + ' locked, not registered yet. Check Live Status or Unlock all.', reg ? '' : '#ff9a9a');
      } catch (e) { setOut('Lock failed: ' + e.message, '#ff9a9a'); } finally { done(); busy(false); }
    };
    busy(false); loadBands();
  }

  window.MatchiSpeed = { validHost, validPort, validSecs, script, parse, rank, bandTest, open };
})();

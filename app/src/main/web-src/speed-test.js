/* speed-test.js: Speed test and Band test (opened from Network Diagnostics > Speed test). window.MatchiSpeed.
 * Core (no DOM, scripts/test_speed_test.js runs it as it is):
 *   validHost / validPort / validSecs   input checks (the values go into a shell line, so only plain characters pass)
 *   script(host, port, secs, download, opt)  root script: runs the bundled iperf3 as a client, JSON output; prints NOIPERF3 when it is not installed.
 *                                       opt.streams (default 4: one stream under-reports a fast mobile link), opt.omit (default 1 s: TCP slow start is not counted), opt.ping (3 pings first, "PING:" lines)
 *   parse(text)                         { ok, mbps, retrans } or { ok:false, error }
 *   parsePing(text)                     { ms, jitter, loss } from the "PING:" lines, or null
 *   measure(run, i, download, opt)      one leg; when the server says it is busy, the next port is tried (twice at most); result also holds port and ping
 *   rank(results)                       fastest first; results with an error go last
 *   bandTest(o)                         lock each band in turn, wait for registration, read the signal, run the speed test, then ALWAYS put the old lock back
 * UI: MatchiSpeed.open(). iperf3 runs only as a client (the carrier address cannot be reached from outside). */
(() => {
  'use strict';

  // ---- core ---------------------------------------------------------------------------------------------------
  const validHost = (h) => typeof h === 'string' && h.length <= 253 && (/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(h) || /^[0-9A-Fa-f:]{2,45}$/.test(h) && h.includes(':'));
  const validPort = (p) => /^\d{1,5}$/.test(String(p)) && +p >= 1 && +p <= 65535;
  const validSecs = (s) => /^\d{1,2}$/.test(String(s)) && +s >= 3 && +s <= 30;
  const validStreams = (n) => /^\d$/.test(String(n)) && +n >= 1 && +n <= 8;
  const OMIT = 1, STREAMS = 4;

  const FIND = [
    'B=""',
    'for c in /data/data/com.matchi.tool/files/iperf3 /data/user/0/com.matchi.tool/files/iperf3 /data/local/matchitool/bin/iperf3; do [ -x "$c" ] && B=$c && break; done',
    '[ -n "$B" ] || { echo NOIPERF3; exit 0; }',
  ];
  // download = true: the server sends (-R), the number is what the F50 receives. false: the F50 sends.
  function script(host, port, secs, download, opt) {
    const o = opt || {}, streams = o.streams == null ? STREAMS : o.streams, omit = o.omit == null ? OMIT : +o.omit;
    if (!validHost(host) || !validPort(port) || !validSecs(secs) || !validStreams(streams) || !(omit >= 0 && omit <= 5)) throw new Error('Invalid server, port, time or streams');
    // ping first (about 2 s, only for a name or IPv4 address: Android ping has no IPv6 mode here); its lines start with PING: so parse() does not see them
    const ping = o.ping && !host.includes(':') ? ['command -v ping >/dev/null 2>&1 && ping -c 3 -W 2 ' + host + ' 2>&1 | tail -n 2 | sed "s/^/PING:/"'] : [];
    return FIND.concat(ping, [
      'T=""; command -v timeout >/dev/null 2>&1 && T="timeout ' + (+secs + omit + 20) + '"',
      '$T "$B" -c ' + host + ' -p ' + +port + ' -t ' + +secs + ' -J' + (omit ? ' -O ' + omit : '') + ' -P ' + +streams + ' --connect-timeout 6000' + (download ? ' -R' : '') + ' 2>&1',
    ]).join('\n');
  }
  function parsePing(text) {
    const l = String(text == null ? '' : text).split('\n').filter((x) => x.startsWith('PING:')).join(' ');
    if (!l) return null;
    const loss = /(\d+(?:\.\d+)?)% packet loss/.exec(l), rtt = /=\s*([\d.]+)\/([\d.]+)\/([\d.]+)(?:\/([\d.]+))?/.exec(l);
    if (!rtt && !loss) return null;
    return { ms: rtt ? +rtt[2] : null, jitter: rtt && rtt[4] != null ? +rtt[4] : null, loss: loss ? +loss[1] : null };
  }
  function parse(text) {
    const s = String(text == null ? '' : text);
    if (/NOIPERF3/.test(s)) return { ok: false, error: 'iperf3 not installed' };
    const i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i < 0 || j <= i) return { ok: false, error: (s.trim().split('\n').pop() || 'No answer').slice(0, 160) };
    let d; try { d = JSON.parse(s.slice(i, j + 1)); } catch (_) { return { ok: false, error: 'Bad iperf3 reply' }; }
    if (d.error) return { ok: false, error: String(d.error).slice(0, 160) };
    const e = d.end || {}, r = e.sum_received || e.sum_sent;
    if (!r || !(r.bits_per_second >= 0)) return { ok: false, error: 'No result' };
    return { ok: true, mbps: Math.round(r.bits_per_second / 1e4) / 100, retrans: e.sum_sent && Number.isFinite(e.sum_sent.retransmits) ? e.sum_sent.retransmits : null };
  }
  // run(scriptText, timeoutMs) -> output text. i: { host, port, secs, streams }. A busy public server is the usual failure, so the next port is tried.
  async function measure(run, i, download, opt) {
    const o = opt || {}; let port = +i.port, r, ping = null;
    for (let k = 0; k < 3; k++) {
      const text = await run(script(i.host, port, i.secs, download, { streams: i.streams, ping: !!o.ping && k === 0 }), (i.secs + OMIT + 30) * 1000);
      if (k === 0) ping = parsePing(text);
      r = parse(text); r.port = port;
      if (r.ok || !/busy/i.test(r.error || '') || port >= 65535) break;
      port += 1;
    }
    r.ping = ping; return r;
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
      try { log('Restoring lock: ' + orig.map(name).join(' ')); const reg = await apply(orig); restored = true; log(reg ? 'Old lock restored.' : 'Old lock restored, not registered.'); } catch (e) { log('Restore FAILED: ' + e.message + '. Use Unlock all in Radio settings.'); }
      done();
    }
    return { results, ranked: rank(results), restored, aborted, orig };
  }

  // ---- UI (only runs when the person opens it) ------------------------------------------------------------------
  const MODAL = 'matchi_speed_modal', ERR = '#ff9a9a';
  const store = {
    get(k, d) { try { const v = localStorage.getItem('matchi_speed_' + k); return v == null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem('matchi_speed_' + k, v); } catch (_) { /* not fatal */ } },
  };
  const el = (tag, props, kids) => { const n = document.createElement(tag); Object.assign(n, props || {}); (kids || []).forEach((k) => n.append(k)); return n; };
  const toast = (t, c) => { try { createToast(t, c); } catch (_) { /* not fatal */ } };
  const num = (m) => (m >= 1000 ? (m / 1000).toFixed(2) : m >= 100 ? String(Math.round(m)) : m.toFixed(1));
  const unitOf = (m) => (m >= 1000 ? 'Gbps' : 'Mbps');
  const CSS = '.sp-root{padding:4px}.sp-in{display:grid;grid-template-columns:62px 72px 108px auto auto;justify-content:start;gap:4.5px;align-items:center}.sp-in .h{grid-column:1/-1}' +
    '.sp-in input,.sp-in select,.sp-in button{min-height:30px;padding:2px 8px;font-size:13px}' +
    '.sp-sg{display:flex;flex-wrap:wrap;gap:4.5px;margin-top:4.5px}.sp-sg button{min-height:25.5px;padding:1px 9px;font-size:12.5px;opacity:.7}.sp-sg button.on{opacity:1;background:rgba(100,230,164,.35)}' +
    '.sp-res{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:9px 0 7px}' +
    '.sp-t{background:var(--panel2);border:1px solid var(--bd);border-radius:9px;padding:4.5px 9px;min-width:0;transition:border-color .2s}' +
    '.sp-t .l{display:block;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--acc2)}' +
    '.sp-t .v{display:inline;font-size:20.5px;font-weight:700;line-height:1.2;font-variant-numeric:tabular-nums}' +
    '.sp-t .u{font-size:12px;color:var(--mut);margin-left:3px}.sp-t .s{display:block;font-size:11px;color:var(--mut);overflow-wrap:anywhere}' +
    '.sp-t.run{border-color:var(--acc)}.sp-t.run .v{animation:sp-p 1.1s ease-in-out infinite}.sp-t.err .v{color:var(--danger)}.sp-t.ok .v{color:var(--fg)}' +
    '@keyframes sp-p{50%{opacity:.35}}@media(prefers-reduced-motion:reduce){.sp-t.run .v{animation:none}}' +
    '.sp-bar{height:3px;border-radius:3px;background:var(--bd);overflow:hidden}.sp-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--acc),var(--acc2));transition:width 1s linear}' +
    '.sp-msg{margin:4.5px 0;min-height:16px;font-size:12.5px;white-space:pre-wrap;overflow-wrap:anywhere}' +
    '.sp-band{margin-top:7px;border-top:1px solid var(--bd);padding-top:6px}.sp-band>.t{font-size:14px;font-weight:750;margin-bottom:2px}' +
    '.sp-band select,.sp-band button{min-height:27.5px;padding:2px 9px;font-size:13px}' +
    '.sp-tb{width:100%;border-collapse:collapse;font-size:12.5px}.sp-tb th{text-align:left;padding:2px 7px 2px 0;font-size:11.5px;opacity:.7}.sp-tb td{padding:2px 7px 2px 0;border-top:1px solid var(--bd)}.sp-tb tr.best td{color:var(--good);font-weight:700}';
  const TILE = (k, label, u) => '<div class="sp-t" id="sp_t_' + k + '"><span class="l">' + label + '</span><b class="v">-</b><span class="u">' + u + '</span><span class="s"></span></div>';

  function open() {
    const R = window.MatchiRadio;
    let tick = null;
    const stopBar = () => { if (tick) { clearInterval(tick); tick = null; } };
    createModal({
      name: MODAL, title: 'Speed test', maxWidth: '552px', showConfirm: false, onClose: () => { st.stop = true; stopBar(); return true; },
      content: '<style>' + CSS + '</style><div class="sp-root">' +
        '<div class="sp-in"><div class="h"><input id="sp_host" placeholder="iperf3 server (host)" autocomplete="off" spellcheck="false" aria-label="iperf3 server" style="width:100%"><div class="sp-sg" id="sp_sg"></div></div>' +
        '<input id="sp_port" inputmode="numeric" placeholder="port" aria-label="Port"><select id="sp_secs" aria-label="Test time"><option value="5">5 s</option><option value="10">10 s</option></select>' +
        '<select id="sp_par" aria-label="Streams"><option value="4">4 streams</option><option value="1">1 stream</option></select>' +
        '<button type="button" id="sp_run">Run</button><button type="button" id="sp_stop" disabled>Stop</button></div>' +
        '<div class="mut" style="font-size:11.5px;margin:4.5px 0 0">Uses mobile data (~6 s each way). A busy server is retried on the next port.</div>' +
        '<div class="sp-res">' + TILE('dl', 'Download', 'Mbps') + TILE('ul', 'Upload', 'Mbps') + TILE('ping', 'Ping', 'ms') + '</div>' +
        '<div class="sp-bar" aria-hidden="true"><i id="sp_bar"></i></div><div id="sp_out" class="sp-msg" role="status"></div>' +
        '<div class="sp-band" id="sp_band"><div class="t">Band test</div>' +
        '<div class="mut" style="font-size:11.5px;margin:0 0 4.5px">Locks each ticked band, tests download, reads signal, then restores your old lock. Internet is off during radio restarts.</div>' +
        '<div style="display:flex;gap:7px;align-items:center;margin-bottom:4.5px"><select id="sp_type"><option value="lte">LTE bands</option><option value="nr">5G NR bands</option></select><span class="mut" id="sp_bmsg" style="font-size:11.5px"></span></div>' +
        '<div id="sp_chips" style="display:flex;flex-wrap:wrap;gap:4.5px;margin-bottom:7px"></div>' +
        '<div style="display:flex;gap:7px;flex-wrap:wrap"><button type="button" id="sp_btest" disabled>Test ticked bands</button><button type="button" id="sp_lockbest" disabled>Lock best</button></div>' +
        '<div id="sp_table" style="margin-top:7px"></div><pre id="sp_log" style="display:none;margin:7px 0 0;padding:6px 8px;max-height:92px;overflow:auto;white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:10.5px;line-height:1.35;background:var(--bg);border:1px solid var(--bd);border-radius:9px"></pre></div></div>',
    });
    showModal(MODAL);
    const $ = (id) => document.getElementById(id);
    const st = { stop: false, busy: false, sup: { lte: [], nr: [] }, tick: new Set(), best: null, type: 'lte', loaded: false };
    $('sp_host').value = store.get('host', ''); $('sp_port').value = store.get('port', '5201'); $('sp_secs').value = store.get('secs', '5'); $('sp_par').value = store.get('par', '4');
    if ($('sp_par').value === '') $('sp_par').value = '4';
    // server suggestions: buttons in the page's own style (a native list only shows entries that match the text, so the host could not be changed without clearing it)
    const SERVERS = [['Biznet', 'iperf.biznetnetworks.com'], ['Online.net', 'ping.online.net'], ['Leaseweb SG', 'speedtest.sin1.sg.leaseweb.net']];
    const markSrv = () => { for (const b of $('sp_sg').children) { const on = b.dataset.host === $('sp_host').value.trim(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); } };
    for (const [n, h] of SERVERS) { const b = el('button', { type: 'button', textContent: n, title: h }); b.dataset.host = h; b.onclick = () => { if (st.busy) return; $('sp_host').value = h; markSrv(); }; $('sp_sg').append(b); }
    $('sp_host').addEventListener('input', markSrv); markSrv();
    const setOut = (t, c) => { const o = $('sp_out'); if (!o) return; o.textContent = t; o.style.color = c || ''; };
    const log = (l) => { const p = $('sp_log'); if (!p) return; p.style.display = 'block'; p.textContent += l + '\n'; p.scrollTop = p.scrollHeight; };
    const tile = (k, o) => {
      const t = $('sp_t_' + k); if (!t) return; const v = o || {};
      t.className = 'sp-t' + (v.state ? ' ' + v.state : '');
      t.querySelector('.v').textContent = v.v == null ? '-' : v.v; t.querySelector('.u').textContent = v.u || ''; t.querySelector('.s').textContent = v.s || '';
    };
    // the bar only shows that time is passing (the shell call returns when the test ends)
    const bar = (secs) => {
      stopBar(); const f = $('sp_bar'); if (!f) return; f.style.width = '0'; const t0 = Date.now();
      tick = setInterval(() => { const b = $('sp_bar'); if (!b) { stopBar(); return; } b.style.width = Math.min(96, (Date.now() - t0 + 1000) / (secs * 10)) + '%'; }, 1000);
    };
    const barDone = () => { stopBar(); const b = $('sp_bar'); if (b) b.style.width = '100%'; };
    const inputs = () => {
      const host = $('sp_host').value.trim(), port = $('sp_port').value.trim(), secs = $('sp_secs').value, streams = $('sp_par').value;
      if (!validHost(host)) throw new Error('Invalid server');
      if (!validPort(port)) throw new Error('Port must be 1-65535');
      store.set('host', host); store.set('port', port); store.set('secs', secs); store.set('par', streams);
      return { host, port: +port, secs: +secs, streams: +streams };
    };
    const busy = (on) => { st.busy = on; $('sp_run').disabled = on; $('sp_stop').disabled = !on; $('sp_btest').disabled = on || !st.tick.size; $('sp_lockbest').disabled = on || !st.best; $('sp_type').disabled = on; };
    const run = async (sc, ms) => ((await runShellWithRoot(sc, ms)) || {}).content;
    const speedTile = (k, r, i) => {
      if (!r.ok) { tile(k, { state: 'err', v: '-', u: 'Mbps', s: 'failed' }); return; }
      tile(k, { state: 'ok', v: num(r.mbps), u: unitOf(r.mbps), s: [i.streams + (i.streams > 1 ? ' streams' : ' stream'), 'port ' + r.port, r.retrans > 0 ? r.retrans + ' retransmits' : ''].filter(Boolean).join(' · ') });
    };

    $('sp_run').onclick = async () => {
      if (st.busy) return;
      let i; try { i = inputs(); } catch (e) { setOut(e.message, ERR); return; }
      st.stop = false; busy(true); setOut('');
      tile('dl', { state: 'run', v: '...', u: 'Mbps' }); tile('ul', { u: 'Mbps' }); tile('ping', { u: 'ms' });
      try {
        setOut('Download…'); bar(i.secs + 8);
        const d = await measure(run, i, true, { ping: true }); barDone();
        const p = d.ping;
        tile('ping', p && p.ms != null ? { state: 'ok', v: p.ms < 10 ? p.ms.toFixed(1) : String(Math.round(p.ms)), u: 'ms', s: [p.jitter != null ? 'jitter ' + p.jitter.toFixed(1) + ' ms' : '', p.loss ? p.loss + '% lost' : ''].filter(Boolean).join(' · ') } : { u: 'ms', s: p ? 'no reply' : '' });
        speedTile('dl', d, i);
        if (!d.ok) { setOut('Download: ' + d.error, ERR); return; }
        if (st.stop) { setOut('Stopped.'); return; }
        tile('ul', { state: 'run', v: '...', u: 'Mbps' }); setOut('Upload…'); bar(i.secs + 6);
        const u = await measure(run, i, false); barDone();
        speedTile('ul', u, i);
        setOut(u.ok ? 'Done at ' + new Date().toLocaleTimeString() : 'Upload: ' + u.error, u.ok ? '' : ERR);
      } catch (e) { stopBar(); tile('dl', { state: 'err', u: 'Mbps' }); setOut('Speed test failed: ' + e.message, ERR); } finally { busy(false); }
    };
    $('sp_stop').onclick = () => { st.stop = true; $('sp_stop').disabled = true; setOut('Stopping…'); };

    function drawChips() {
      const box = $('sp_chips'); box.textContent = '';
      for (const b of st.sup[st.type]) {
        const on = st.tick.has(b), n = (st.type === 'nr' ? 'n' : 'B') + b;
        const btn = el('button', { type: 'button', textContent: n, className: 'dr-b' }); btn.style.cssText = 'min-height:25.5px;padding:1px 9px;font-size:12.5px;opacity:' + (on ? 1 : .55) + (on ? ';background:rgba(100,230,164,.35)' : '');
        btn.setAttribute('aria-pressed', String(on));
        btn.onclick = () => { if (st.busy) return; if (st.tick.has(b)) st.tick.delete(b); else if (st.tick.size < 6) st.tick.add(b); else toast('Max 6 bands', 'red'); drawChips(); $('sp_btest').disabled = st.busy || !st.tick.size; };
        box.append(btn);
      }
    }
    async function loadBands() {
      if (!R) { $('sp_bmsg').textContent = 'Radio tools not available'; return; }
      $('sp_bmsg').textContent = 'Reading bands…';
      try {
        const b = await R.readBands();
        st.sup.lte = b.lte !== null ? [...new Set([...R.LTE_BANDS, ...(b.lte || [])])].sort((x, y) => x - y) : [];
        let nr = []; if (b.nr !== null) { try { nr = await R.readNrSupported(0); } catch (_) { nr = []; } st.sup.nr = [...new Set([...(nr || []), ...(b.nr || [])])].sort((x, y) => x - y); } else st.sup.nr = [];
        $('sp_bmsg').textContent = ''; drawChips();
      } catch (e) { st.loaded = false; $('sp_bmsg').textContent = 'Band read failed: ' + e.message; }
    }
    // the Band test section is always shown, so the band list is read from the router when the window opens
    st.loaded = true; loadBands();
    $('sp_type').onchange = () => { st.type = $('sp_type').value; st.tick.clear(); st.best = null; drawChips(); busy(false); };

    function drawTable(res) {
      const box = $('sp_table'); box.textContent = '';
      const t = el('table', { className: 'sp-tb' }), top = res.find((r) => r.mbps != null);
      const head = el('tr'); ['Band', 'Mbps', 'RSRP', 'SINR', 'Note'].forEach((h) => head.append(el('th', { textContent: h }))); t.append(head);
      for (const r of res) {
        const tr = el('tr', { className: r === top ? 'best' : '' });
        [r.label, r.mbps == null ? '-' : r.mbps, r.rsrp == null || r.rsrp === '' ? '-' : r.rsrp, r.sinr == null || r.sinr === '' ? '-' : r.sinr, r.error || (r.active ? 'in use: ' + r.active : '')].forEach((v) => tr.append(el('td', { textContent: String(v) }))); t.append(tr);
      }
      box.append(t);
    }
    $('sp_btest').onclick = async () => {
      if (st.busy || !st.tick.size) return;
      let i; try { i = inputs(); } catch (e) { setOut(e.message, ERR); return; }
      const bands = [...st.tick].sort((a, b) => a - b), n = bands.length;
      if (!(await askConfirm('Test ' + bands.map((b) => (st.type === 'nr' ? 'n' : 'B') + b).join(' ') + '?\n\n~' + Math.ceil(n * 1.7) + ' min. Internet is off during radio restarts. Old lock is restored at the end. If it fails: Unlock all in Radio settings.', 'Start test', true))) return;
      st.stop = false; st.best = null; $('sp_log').textContent = ''; $('sp_table').textContent = ''; busy(true); setOut('Band test running. Keep this open.');
      try {
        const out = await bandTest({
          R, type: st.type, bands, full: st.sup[st.type], log,
          speed: () => measure(run, i, true), stop: () => st.stop,
          progress: (k, m) => setOut('Band test ' + (k + 1) + ' of ' + m + '… keep this open'),
          signal: async () => {
            const d = (await R.zte('get', { multi_data: '1', cmd: 'lte_rsrp,lte_snr,Z5g_rsrp,Z5g_SINR,wan_active_band,nr5g_action_band' })) || {};
            return st.type === 'nr' ? { rsrp: d.Z5g_rsrp, sinr: d.Z5g_SINR, band: d.nr5g_action_band } : { rsrp: d.lte_rsrp, sinr: d.lte_snr, band: d.wan_active_band };
          },
        });
        drawTable(out.ranked);
        const top = out.ranked.find((r) => r.mbps != null);
        st.best = top ? top.band : null;
        setOut((out.aborted ? 'Stopped: ' + out.aborted + '. ' : 'Done. ') + (top ? 'Fastest: ' + top.label + ' at ' + top.mbps + ' Mbps. ' : 'No band gave a result. ') + (out.restored ? 'Old lock restored.' : 'OLD LOCK NOT RESTORED. Use Unlock all in Radio settings.'), out.restored ? '' : ERR);
      } catch (e) { setOut('Band test failed: ' + e.message, ERR); } finally { busy(false); }
    };
    $('sp_lockbest').onclick = async () => {
      if (st.busy || st.best == null) return;
      const b = st.best, lte = st.type === 'lte', n = (lte ? 'B' : 'n') + b;
      if (!(await askConfirm('Lock ' + n + ' only?\n\nRadio restarts (~30 s). Undo: Unlock all in Radio settings.', 'Lock', true))) return;
      busy(true); const done = R.beginBusy('Locking best band');
      try {
        setOut('Locking ' + n + '…');
        const r = await R.setBands([[lte ? 'LTE_BAND_LOCK' : 'NR_BAND_LOCK', lte ? 'lte_band_lock' : 'nr_band_lock', String(b)]], lte ? { lte: [b] } : { nr: [b] });
        if (!r.ok) throw new Error('the router did not report the new lock');
        if (!(await R.radioCycle({ log: () => {}, toast: () => {} }))) throw new Error('radio restart not confirmed');
        const reg = await R.waitRegistered(0, { everyMs: 3000, timeoutMs: 90000 });
        setOut(reg ? n + ' locked.' : n + ' locked, not registered yet.', reg ? '' : ERR);
      } catch (e) { setOut('Lock failed: ' + e.message, ERR); } finally { done(); busy(false); }
    };
    busy(false);
  }

  window.MatchiSpeed = { validHost, validPort, validSecs, validStreams, script, parse, parsePing, measure, rank, bandTest, open };
})();
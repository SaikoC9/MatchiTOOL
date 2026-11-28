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
  // Signal values from the router: a missing, empty or placeholder value (0, junk) is "no value", never a number to show.
  const numIn = (v, lo, hi) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
  const cleanRsrp = (v) => numIn(v, -140, -40);
  const cleanSinr = (v) => numIn(v, -30, 50);
  // AT+CESQ (LTE): last field is the RSRP index, dBm = index - 141. 0 and 97 are out-of-range ends, 255 is unknown.
  const cesqRsrp = (text) => { const m = /\+CESQ:\s*(?:\d+\s*,\s*){5}(\d+)/.exec(String(text || '')); const i = m ? +m[1] : 0; return i >= 1 && i <= 96 ? i - 141 : null; };
  // Android telephony (dumpsys telephony.registry): the F50 router leaves its own signal fields empty, so this is the main source there.
  // type 'nr' reads the 5G values, anything else the LTE values; 2147483647 and other out-of-range numbers read as "no value".
  const teleSignal = (text, type) => {
    const t = String(text || ''), first = (re, clean) => { let m; const g = new RegExp(re.source, 'g'); while ((m = g.exec(t))) { const v = clean(m[1]); if (v != null) return v; } return null; };
    return type === 'nr'
      ? { rsrp: first(/\b(?:ssRsrp|csiRsrp)\s*=\s*(-?\d+)/, cleanRsrp), sinr: first(/\b(?:ssSinr|csiSinr)\s*=\s*(-?\d+)/, cleanSinr) }
      : { rsrp: first(/\brsrp\s*=\s*(-?\d+)/, cleanRsrp), sinr: first(/\brssnr\s*=\s*(-?\d+)/, cleanSinr) };
  };
  // AT+CESQ with 5G (3GPP Rel-15): <rxlev>,<ber>,<rscp>,<ecno>,<rsrq>,<rsrp>[,<ss_rsrq>,<ss_rsrp>,<ss_sinr>]. The F50 answers "+CESQ: 99,99,255,255,255,255,73,54,67":
  // the LTE fields are 255 (unknown) and the 5G ones carry the signal. ss_rsrp n -> n-156 dBm (1..126); ss_sinr n -> -23+(n-1)/2 dB (1..126); 0, 127 and 255 are "no value".
  const cesqAll = (text) => {
    const m = /\+CESQ:\s*(\d+(?:\s*,\s*\d+){5,8})/.exec(String(text || '')), f = m ? m[1].split(',').map((x) => +x) : [];
    const ok = (i) => Number.isFinite(i) && i >= 1 && i <= 126;
    return { lteRsrp: f.length >= 6 && f[5] >= 1 && f[5] <= 96 ? f[5] - 141 : null, nrRsrp: f.length >= 9 && ok(f[7]) ? f[7] - 156 : null, nrSinr: f.length >= 9 && ok(f[8]) ? -23 + (f[8] - 1) / 2 : null };
  };
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
          // The router can answer empty right after a radio restart: ask up to 3 times, 2 s apart. Signal is a bonus, never a failure.
          let sg = {};
          for (let k = 0; k < 3; k++) {
            try { sg = (await o.signal()) || {}; } catch (_) { sg = {}; }
            if (cleanRsrp(sg.rsrp) != null || cleanSinr(sg.sinr) != null) break;
            if (k < 2) await R.sleep(2000);
          }
          row.rsrp = cleanRsrp(sg.rsrp); row.sinr = cleanSinr(sg.sinr); row.nr5g = !!sg.nr && (row.rsrp != null || row.sinr != null); row.active = sg.band || '';
          log(name(b) + ' signal: ' + (row.rsrp == null && row.sinr == null ? 'not available' + (sg.dbg ? ' (' + sg.dbg + ')' : '') : (row.rsrp == null ? '-' : row.rsrp + ' dBm') + ' / ' + (row.sinr == null ? '-' : row.sinr + ' dB') + (row.nr5g ? ' (5G signal, the modem reports no LTE value)' : '')));
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
  const CSS = '.sp-root{padding:4px}.sp-in{display:grid;grid-template-columns:64px 84px 120px auto auto;justify-content:start;gap:4.5px;align-items:center}.sp-in .h{grid-column:1/-1}' +
    '.sp-in input,.sp-in select{min-width:0;width:100%;box-sizing:border-box}.sp-in input,.sp-in select,.sp-in button{min-height:30px;padding:2px 8px;font-size:13px}' +
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
    '.sp-r{display:flex;align-items:center;gap:8px;padding:5px 10px;border:1px solid var(--bd);border-radius:9px;background:var(--panel2)}.sp-r b{font-size:13px}.sp-r .m{font-weight:700}.sp-r .s{margin-left:auto;color:var(--mut);white-space:nowrap}' +
    '.sp-r.ok{border-color:#28d99a55}.sp-r.ok b{color:var(--good)}.sp-r.warn{border-color:#ffc85755}.sp-r.warn b{color:#ffc857}.sp-r.bad{border-color:#ff647c55}.sp-r.bad b{color:var(--danger)}' +
    '.sp-band{margin-top:7px;border-top:1px solid var(--bd);padding-top:6px}.sp-band>.t{font-size:14px;font-weight:750;margin-bottom:2px}' +
    '.sp-band select,.sp-band button{min-height:27.5px;padding:2px 9px;font-size:13px}' +
    '.sp-tb{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12.5px}.sp-tb th{text-align:left;padding:2px 6px 2px 0;font-size:11.5px;opacity:.7;white-space:nowrap}.sp-tb td{padding:3px 6px 3px 0;border-top:1px solid var(--bd);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.sp-tb .cb{width:15%}.sp-tb .cm{width:19%}.sp-tb .cr{width:24%}.sp-tb .cs{width:20%}.sp-tb .cn{width:22%}' +
    '.sp-tb tr.best td{color:var(--good);font-weight:700}.sp-tb tr.sp-nt td{border-top:0;padding:0 0 4px;white-space:normal;overflow:visible;font-size:11.5px;line-height:1.35;color:var(--mut);font-weight:400}';
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
    const setOut = (t, c) => { const o = $('sp_out'); if (!o) return; o.className = 'sp-msg'; o.textContent = t; o.style.color = c || ''; };
    // One compact result line: icon, main text, and a short status on the right. kind: ok | warn | bad.
    const showResult = (kind, main, sub) => {
      const o = $('sp_out'); if (!o) return;
      o.className = 'sp-msg sp-r ' + kind; o.style.color = ''; o.textContent = '';
      o.append(el('b', { textContent: kind === 'ok' ? '\u2713' : kind === 'warn' ? '\u25A0' : '!' }), el('span', { className: 'm', textContent: main }));
      if (sub) o.append(el('span', { className: 's', textContent: sub }));
    };
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
        bar(i.secs + 8);
        const d = await measure(run, i, true, { ping: true }); barDone();
        const p = d.ping;
        tile('ping', p && p.ms != null ? { state: 'ok', v: p.ms < 10 ? p.ms.toFixed(1) : String(Math.round(p.ms)), u: 'ms', s: [p.jitter != null ? 'jitter ' + p.jitter.toFixed(1) + ' ms' : '', p.loss ? p.loss + '% lost' : ''].filter(Boolean).join(' · ') } : { u: 'ms', s: p ? 'no reply' : '' });
        speedTile('dl', d, i);
        if (!d.ok) { setOut('Download: ' + d.error, ERR); return; }
        if (st.stop) { setOut('Stopped.'); return; }
        tile('ul', { state: 'run', v: '...', u: 'Mbps' }); bar(i.secs + 6);
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
      const cols = ['cb', 'cm', 'cr', 'cs', 'cn']; ['Band', 'Mbps', 'RSRP', 'SINR', 'Note'].forEach((h, k) => t.append(el('col', { className: cols[k] })));
      const head = el('tr'); ['Band', 'Mbps', 'RSRP', 'SINR', 'Note'].forEach((h) => head.append(el('th', { textContent: h }))); t.append(head);
      for (const r of res) {
        const tr = el('tr', { className: r === top ? 'best' : '' });
        const act = String(r.active || '').match(/\d+/), lteT = st.type !== 'nr';
        const note = r.error || [r === top ? 'Best' : '', act && Number(act[0]) !== r.band ? 'on ' + (lteT ? 'B' : 'n') + act[0] : '', r.nr5g ? '5G signal' : ''].filter(Boolean).join(' \u00B7 ');
        const long = note.length > 12;   // a long note (an error) gets its own line under the row, so the number columns keep their width
        [r.label, r.mbps == null ? '-' : r.mbps, r.rsrp == null ? '-' : r.rsrp + ' dBm', r.sinr == null ? '-' : r.sinr + ' dB', long ? '' : note].forEach((v) => tr.append(el('td', { textContent: String(v) }))); t.append(tr);
        if (long) { const nt = el('tr', { className: 'sp-nt' }), td = el('td', { textContent: note }); td.colSpan = 5; nt.append(td); t.append(nt); }
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
            let d = {}; try { d = (await R.zte('get', { multi_data: '1', cmd: 'lte_rsrp,lte_snr,Z5g_rsrp,Z5g_SINR,wan_active_band,nr5g_action_band' })) || {}; } catch (_) { /* try the modem below */ }
            const g = st.type === 'nr' ? { rsrp: d.Z5g_rsrp, sinr: d.Z5g_SINR, band: d.nr5g_action_band } : { rsrp: d.lte_rsrp, sinr: d.lte_snr, band: d.wan_active_band };
            // The router often answers nothing for these (the F50 does). Fill the gaps from Android telephony (RSRP and SINR), then the modem (RSRP).
            // First choice: the Live panel's own reading (router, Android telephony, modem), taken fresh after the lock.
            const dbg = [];
            try {
              const L = window.MatchiLive;
              if (L && L.fresh) {
                const x = await L.fresh(), c = (st.type === 'nr' ? x.nr : x.lte) || {}, n = x.nr || {};
                if (cleanRsrp(c.rsrp) != null) g.rsrp = c.rsrp; if (cleanSinr(c.sinr) != null) g.sinr = c.sinr;
                // LTE band on a 5G NSA link: the modem reports no LTE value, the Live panel shows the 5G one. Use that and mark it.
                if (st.type !== 'nr') { if (cleanRsrp(g.rsrp) == null && cleanRsrp(n.rsrp) != null) { g.rsrp = n.rsrp; g.nr = true; } if (cleanSinr(g.sinr) == null && cleanSinr(n.sinr) != null) { g.sinr = n.sinr; g.nr = true; } }
                dbg.push('live ' + (cleanRsrp(g.rsrp) == null ? 'empty' : 'ok'));
              }
              else dbg.push('live panel not loaded');
            } catch (e) { dbg.push('live failed: ' + String(e && e.message || e).slice(0, 60)); }
            dbg.push('router ' + (cleanRsrp(g.rsrp) == null ? 'empty' : 'ok'));
            if (cleanRsrp(g.rsrp) == null || cleanSinr(g.sinr) == null) {
              try {
                const txt = String(await R.sh("dumpsys telephony.registry 2>/dev/null | grep -E 'mSignalStrength|CellSignalStrength' | head -40", 15000));
                const tv = teleSignal(txt, st.type), tok = (txt.match(/\b(?:rsrp|rssnr|ssRsrp|ssSinr|csiRsrp|csiSinr)\s*=\s*-?\d+/g) || []).slice(0, 6).join(' '); dbg.push('telephony ' + (txt.trim() ? txt.length + ' chars: ' + (tok || 'no rsrp/sinr field') : 'no output'));
                if (cleanRsrp(g.rsrp) == null && tv.rsrp != null) g.rsrp = tv.rsrp;
                if (cleanSinr(g.sinr) == null && tv.sinr != null) g.sinr = tv.sinr;
              } catch (e) { dbg.push('telephony failed: ' + String(e && e.message || e).slice(0, 60)); }
            }
            if (cleanRsrp(g.rsrp) == null || cleanSinr(g.sinr) == null) {
              try {
                const raw = await R.at('AT+CESQ'), c = cesqAll(raw);
                const rs = st.type === 'nr' ? c.nrRsrp : (c.lteRsrp != null ? c.lteRsrp : c.nrRsrp);
                if (cleanRsrp(g.rsrp) == null && rs != null) { g.rsrp = rs; if (st.type !== 'nr' && c.lteRsrp == null) g.nr = true; }
                if (cleanSinr(g.sinr) == null && c.nrSinr != null) { g.sinr = c.nrSinr; if (st.type !== 'nr') g.nr = true; }
                dbg.push('AT+CESQ ' + (c.lteRsrp == null && c.nrRsrp == null ? 'no value' : 'ok'));
              } catch (e) { dbg.push('AT+CESQ failed: ' + String(e && e.message || e).slice(0, 60)); }
            }
            g.dbg = dbg.join(', ');
            return g;
          },
        });
        drawTable(out.ranked);
        const top = out.ranked.find((r) => r.mbps != null);
        st.best = top ? top.band : null;
        const bestTxt = top ? top.label + ' \u00B7 ' + top.mbps + ' Mbps' : '';
        if (!out.restored) showResult('bad', 'Lock not restored. Use Unlock all in Radio settings.', '');
        else if (out.aborted) showResult('warn', 'Stopped' + (out.aborted !== 'stopped' ? ': ' + out.aborted : '') + (top ? ' \u00B7 best ' + bestTxt : ''), 'Lock restored');
        else if (top) showResult('ok', 'Fastest: ' + bestTxt, 'Lock restored');
        else showResult('warn', 'No band gave a result', 'Lock restored');
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

  window.MatchiSpeed = { validHost, validPort, validSecs, validStreams, script, parse, parsePing, measure, rank, bandTest, cleanRsrp, cleanSinr, cesqRsrp, cesqAll, teleSignal, open };
})();
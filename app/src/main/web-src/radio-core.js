/*
 * MatchiRadio - the one place that talks to the modem and the router for radio settings.
 * Used by the AT & Radio window (web-src/at-radio-ui.js) and, later, by the dashboard cards.
 * No document, no toast, no confirm dialog in here: callers pass in what they need (SIM slot, log function).
 * Router and AT formats: docs/AT_RADIO_FORMATS.md. Needs the page's global api().
 */
window.MatchiRadio = (() => {
  'use strict';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- AT commands -------------------------------------------------------------------------------------------
  async function at(command, slot) {
    const r = await api('/api/at', { method: 'POST', body: JSON.stringify({ command, slot: slot || 0 }) });
    if (r.error) throw new Error(r.error);
    return r.result || '';
  }
  async function sh(cmd, timeout) {
    const r = await api('/api/shell', { method: 'POST', body: JSON.stringify({ cmd, timeout: timeout || 15000 }) });
    if (r.error) throw new Error(r.error);
    return String(r.content || '');
  }
  // Parsing: take the text between the first ":" and "OK", split on ",". Text before the "+CMD:" (the bridge can
  // print a stray first character such as "(" or "6") is ignored because only what follows the first ":" is used.
  const fields = (raw) => String(raw).split('OK')[0].split(':').slice(1).join(':').replace(/["\r\n]/g, ' ').split(',').map((x) => x.trim());
  // sendat prints the closing OK/ERROR with no line break after the data ("+CSQ: 99,99OK"). Put it on its own line and drop blank lines.
  const tidy = (t) => String(t || '').replace(/\r/g, '').replace(/([^\n])(OK|ERROR|\+CME ERROR:[^\n]*|\+CMS ERROR:[^\n]*)\s*$/, '$1\n$2').replace(/\n{2,}/g, '\n').trim();
  // "AT+SP5GCMDS=\"get nr support_band\"" answers "...get nr support_band,6,41,78,1,8,28,5": the first number is a COUNT of the bands after it
  // (seen on the F50). It is dropped when it equals the number of values after it, so it never shows up as band "n6".
  const parseNrSupported = (raw) => {
    const f = fields(raw);
    const nums = f.slice(1).map((x) => parseInt(x.replace(/\\/g, ''), 10)).filter((x) => !isNaN(x));
    if (nums.length > 1 && nums[0] === nums.length - 1) nums.shift();
    return nums;
  };
  async function readNrSupported(slot) {
    try { return parseNrSupported(await at('AT+SP5GCMDS="get nr support_band"', slot)); } catch (_) { return []; }
  }
  // Registered = the modem reports status 1 (home) or 5 (roaming) on LTE or 5G. When nothing answers, it counts as not registered (unlocking is the safe side).
  async function isRegistered(slot) {
    for (const c of ['AT+CEREG?', 'AT+C5GREG?']) {
      try { const m = tidy(await at(c, slot)).match(/\+C(?:5G|E)REG:\s*\d+\s*,\s*(\d+)/); if (m && (m[1] === '1' || m[1] === '5')) return true; } catch (_) { /* try the next */ }
    }
    return false;
  }

  // ---- Router (goform through the /api/zte proxy) -------------------------------------------------------------
  // retry: 0 = send as is; 1 = drop the cached router session and sign in again first; 2 = the same plus the older AD token form (ZteClient.callLocked).
  async function zte(op, params, retry) {
    const r = await api('/api/zte', { method: 'POST', body: JSON.stringify({ op, params, retry: retry || 0 }) });
    if (r.error) throw new Error(r.error);
    return r.data;
  }
  // allowEmpty: the F50 answers some set commands (PERFORMANCE_MODE_SETTING, like CELL_LOCK) with HTTP 200 and an EMPTY reply instead of "success".
  // With allowEmpty an empty reply is accepted and the caller's read-back decides; anything else that is not "success" is still refused.
  // Returns 'success' or 'empty'. retry: see zte().
  async function setRouter(params, allowEmpty, retry) {
    const d = await zte('set', params, retry);
    const res = d && typeof d === 'object' ? d.result : d;
    const t = res === undefined || res === null ? '' : String(res).trim();
    if (t === 'success') return 'success';
    if (allowEmpty && t === '') return 'empty';
    throw new Error('Router refused the change (' + (res === undefined ? 'no answer' : t.slice(0, 80)) + ')');
  }
  // Radio set calls (band lock, network mode, cell lock, unlock) are idempotent: sending the same one twice changes nothing more.
  // A router that lost our sign-in, or got no valid AD token, answers a set with an EMPTY reply and does NOTHING, which looks exactly like
  // the F50's real "accepted" reply to CELL_LOCK. So an empty reply is judged by the read-back (verify), and when the change is not there
  // the call is sent again with a fresh sign-in (retry 1) and then with the older AD token form (retry 2). A reply of "success" is
  // never repeated. Text other than "success" / "" is refused at once (setRouter throws).
  // verify() must return true when the router now shows the change; it may keep what it read for the caller.
  // Returns { reply: 'success'|'empty' (of the last send), attempts, ok }.
  let settleMs = 1200;                       // how long the router gets to apply a change before it is read back (tests set 0)
  const setSettle = (ms) => { settleMs = ms; };
  const pause = (ms) => (settleMs === 0 ? Promise.resolve() : sleep(ms));
  async function setConfirmed(params, verify, afterSuccessMs) {
    const judge = async () => { try { return !!(await verify()); } catch (_) { return false; } };
    let reply = 'empty', ok = false, attempts = 0;
    for (let level = 0; level <= 2; level++) {
      attempts++;
      reply = await setRouter(params, true, level);
      if (reply === 'success') { if (afterSuccessMs) await pause(afterSuccessMs); ok = await judge(); break; }
      await pause(settleMs);
      ok = await judge();
      if (ok) break;
    }
    return { reply, attempts, ok };
  }
  // Why an empty reply that changed nothing happened, in words. Without the saved router admin password the host never signs in, and
  // the router then ignores every change.
  async function emptyHint() {
    let set = null; try { const c = await api('/api/zte/config'); set = !!(c && c.passwordSet); } catch (_) { /* unknown */ }
    return set === false
      ? 'No router password saved. Sign in once with it, then retry.'
      : 'Router ignored the command. Reboot and retry.';
  }
  const NET_MODES = [
    ['WL_AND_5G', 'Auto 5G/4G/3G'], ['LTE_AND_5G', '5G NSA'], ['Only_5G', '5G SA'], ['Only_LTE', '4G only'],
  ];
  const netLabel = (v) => (NET_MODES.find((m) => m[0] === v) || [v, v])[1];
  const clean = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
  // A key the firmware does not know comes back empty: that means "hide the control", never "show 0".
  async function readRadio() {
    const d = (await zte('get', { multi_data: '1', cmd: 'net_select,BearerPreference,performance_mode' })) || {};
    if (typeof d !== 'object') throw new Error('Unexpected router answer');
    return { net: clean(d.net_select) || clean(d.BearerPreference), perf: clean(d.performance_mode) };
  }

  // Network mode: send, give the router 2 s, read it back. An empty reply with the old mode still showing is repeated with a fresh sign-in.
  // Returns { reply, attempts, ok, read } (read = last readRadio() result or null).
  async function setNetMode(next) {
    let read = null;
    const s = await setConfirmed({ goformId: 'SET_BEARER_PREFERENCE', BearerPreference: next }, async () => {
      read = null; try { read = await readRadio(); } catch (_) { /* reported by the caller */ }
      return !!read && read.net === next;
    }, 2000);
    return { ...s, read };
  }

  // ---- Band lock ----------------------------------------------------------------------------------------------
  // LTE_BAND_LOCK / lte_band_lock and NR_BAND_LOCK / nr_band_lock take bare integers joined by ",". The F50 reports plain comma lists and
  // reports the FULL list when nothing is locked (checked on the device).
  const LTE_BANDS = [1, 2, 3, 4, 5, 7, 8, 12, 13, 17, 18, 19, 20, 25, 26, 28, 34, 38, 39, 40, 41, 42, 43];
  // "1,3,n28" -> [1,3,28]. null = key not reported at all (hide); '' / "all" / junk -> [] (nothing parsed; raw text is kept for display).
  const parseBands = (v) => {
    if (v === undefined || v === null) return null;
    const out = String(v).split(',').map((x) => parseInt(String(x).trim().replace(/^n/i, ''), 10)).filter((n) => n > 0 && n < 1000);
    return [...new Set(out)].sort((a, b) => a - b);
  };
  const bandText = (l) => l.join(',');
  const bandsMsg = (l, n) => (l.length ? l.map((x) => (n ? 'n' : 'B') + x).join(' ') : 'none');
  const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  // The router may drop bands the modem does not support, so a read-back that is a non-empty subset of what was sent counts as applied.
  // ok = applied; dropped = bands that were sent but not reported back.
  const bandsCheck = (read, want) => {
    const r = read || [], dropped = want.filter((x) => !r.includes(x));
    return { ok: r.length > 0 && r.every((x) => want.includes(x)), dropped };
  };
  async function readBands() {
    const d = (await zte('get', { multi_data: '1', cmd: 'lte_band_lock,nr_band_lock' })) || {};
    if (typeof d !== 'object') throw new Error('Unexpected router answer');
    return { lteRaw: d.lte_band_lock, nrRaw: d.nr_band_lock, lte: parseBands(d.lte_band_lock), nr: parseBands(d.nr_band_lock) };
  }
  // Sends only the parts that are given: [goformId, param, value]. Every one must be accepted; the first failure stops the rest.
  // With `expect` ({lte?, nr?}) a part whose reply is EMPTY is judged by a read-back and repeated with a fresh sign-in when nothing changed
  // (setConfirmed); if it still did not change, that is an error with the reason, not a silent "sent".
  async function sendBands(parts, expect) {
    const sent = [];
    for (const [goformId, param, value] of parts) {
      const want = expect ? (goformId === 'LTE_BAND_LOCK' ? expect.lte : goformId === 'NR_BAND_LOCK' ? expect.nr : undefined) : undefined;
      if (want === undefined) { await setRouter({ goformId, [param]: value }); sent.push(goformId); continue; }
      const s = await setConfirmed({ goformId, [param]: value }, async () => {
        const r = await readBands();
        return bandsCheck(goformId === 'LTE_BAND_LOCK' ? r.lte : r.nr, want).ok;
      });
      if (s.reply === 'empty' && !s.ok) throw new Error('The router answered ' + goformId + ' with an empty reply ' + s.attempts + ' times and the bands did not change. ' + (await emptyHint()));
      sent.push(goformId);
    }
    return sent;
  }
  // Send, then read back and compare with `expect` ({lte?: [..], nr?: [..]}). Throws when the router refuses. Never restarts the radio.
  // Returns { sent, read (null when the read-back failed), bad[] (types that do not match), notes[] (dropped bands), ok }.
  async function setBands(parts, expect) {
    const sent = await sendBands(parts, expect);
    let read = null; try { read = await readBands(); } catch (_) { /* reported as ok:false below */ }
    const bad = [], notes = [];
    if (read && expect.lte !== undefined) { const c = bandsCheck(read.lte, expect.lte); if (!c.ok) bad.push('LTE reports ' + bandsMsg(read.lte || [], false)); else if (c.dropped.length) notes.push('LTE ' + bandsMsg(c.dropped, false) + ' not supported, dropped by the router'); }
    if (read && expect.nr !== undefined) { const c = bandsCheck(read.nr, expect.nr); if (!c.ok) bad.push('5G NR reports ' + bandsMsg(read.nr || [], true)); else if (c.dropped.length) notes.push('5G NR ' + bandsMsg(c.dropped, true) + ' not supported, dropped by the router'); }
    return { sent, read, bad, notes, ok: !!read && !bad.length };
  }

  // ---- Cell lock ----------------------------------------------------------------------------------------------
  // CELL_LOCK takes pci, earfcn, rat (12 = 4G, 16 = 5G); UNLOCK_ALL_CELL takes nothing. neighbor_cell_info / locked_cell_info are lists.
  const toList = (v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.trim()) { try { const j = JSON.parse(v); return Array.isArray(j) ? j : []; } catch (_) { return []; } }
    return [];
  };
  const ratLabel = (r) => (String(r) === '12' ? '4G' : '5G');   // 12 is 4G, anything else is shown as 5G
  // The neighbour list has no rat field. Only a band written as "n78" / "B3" decides it; a bare number does not, and then the user picks.
  const guessRat = (band) => { const b = String(band == null ? '' : band).trim(); return /^n/i.test(b) ? '16' : /^b/i.test(b) ? '12' : ''; };
  const cellOk = (pci, earfcn, rat) => /^\d{1,4}$/.test(pci) && +pci <= 1007 && /^\d{1,7}$/.test(earfcn) && +earfcn <= 3279165 && (rat === '12' || rat === '16');
  async function readCells() {
    const d = (await zte('get', { multi_data: '1', cmd: 'neighbor_cell_info,locked_cell_info' })) || {};
    if (typeof d !== 'object') throw new Error('Unexpected router answer');
    if (d.neighbor_cell_info === undefined && d.locked_cell_info === undefined) throw new Error('this firmware reports neither neighbor_cell_info nor locked_cell_info');
    return { nb: toList(d.neighbor_cell_info), locked: toList(d.locked_cell_info) };
  }
  // CELL_LOCK / UNLOCK_ALL_CELL on the F50 answer HTTP 200 with an EMPTY reply (seen on the device: success:true, data "", "reply empty"),
  // not with the word "success". An empty reply is therefore accepted, and the read-back (locked_cell_info) decides whether it worked;
  // when it did not, setConfirmed repeats the call with a fresh sign-in. A reply that says something else (failure, error text) is refused.
  // Is exactly this lock listed by the router?
  const cellListed = (cells, pci, earfcn, rat) => !!cells && cells.locked.some((x) => String(x.pci) === pci && String(x.earfcn) === earfcn && String(x.rat) === rat);
  // Every lock, unlock and auto-unlock watch takes a new epoch. A watch that sees the epoch change was replaced (newer lock) or made
  // pointless (unlock) and stops, no matter which window started it. This is what keeps two windows from fighting over one modem.
  let cellEpoch = 0;
  // Auto-unlock is ON unless the person switched it off (one setting for the AT & Radio window and the dashboard card).
  const cellAutoOn = () => { try { return localStorage.getItem('matchi_cell_auto') !== '0'; } catch (_) { return true; } };
  const setCellAuto = (on) => { try { localStorage.setItem('matchi_cell_auto', on ? '1' : '0'); } catch (_) { /* not fatal */ } };
  // Send CELL_LOCK, then read the cells back. cells = null when the read failed. hit = the router lists exactly this lock.
  // reply = 'empty' with hit false after `attempts` sends means the router ignored the command (see emptyHint).
  async function cellLock(pci, earfcn, rat) {
    cellEpoch++;
    let cells = null;
    const s = await setConfirmed({ goformId: 'CELL_LOCK', pci, earfcn, rat }, async () => {
      cells = null; try { cells = await readCells(); } catch (_) { /* reported as hit:false */ }
      return cellListed(cells, pci, earfcn, rat);
    });
    return { cells, hit: s.ok, reply: s.reply, attempts: s.attempts };
  }
  async function cellUnlock() {
    cellEpoch++;
    let cells = null;
    const s = await setConfirmed({ goformId: 'UNLOCK_ALL_CELL' }, async () => {
      cells = null; try { cells = await readCells(); } catch (_) { /* reported as none:false */ }
      return !!cells && !cells.locked.length;
    });
    return { cells, none: s.ok, reply: s.reply, attempts: s.attempts };
  }
  // Wait, then look once at the registration. Resolves 'cancelled' (a newer lock or an unlock happened meanwhile), 'off' (auto-unlock was
  // switched off while waiting), 'registered' (the lock stays) or 'unregistered' (the caller should unlock). Never repeats, never unlocks by itself.
  async function watchCell(opt) {
    const o = opt || {}, step = o.stepMs || 5000, total = o.waitMs == null ? 60000 : o.waitMs, epoch = ++cellEpoch;
    for (let t = 0; t < total; t += step) { await sleep(Math.min(step, total - t)); if (epoch !== cellEpoch) return 'cancelled'; }
    if (!cellAutoOn()) return 'off';
    let reg = false; try { reg = await isRegistered(o.slot || 0); } catch (_) { /* counts as not registered */ }
    if (epoch !== cellEpoch) return 'cancelled';
    return reg ? 'registered' : 'unregistered';
  }
  // The cell the phone is on right now, built from the router's own serving-cell values: the safest lock, because nothing changes.
  // A cell is offered only when the network type says that radio is in use AND its PCI / channel are valid. 5G NSA lists both. Never guessed.
  async function servingCells() {
    const d = (await zte('get', { multi_data: '1', cmd: 'network_type,nr5g_pci,nr5g_action_band,nr5g_action_channel,lte_pci,wan_active_band,wan_active_channel' })) || {};
    if (typeof d !== 'object') throw new Error('Unexpected router answer');
    const nt = String(d.network_type || '').trim(), cells = [];
    const add = (rat, pci, earfcn, band) => { const p = clean(pci) || '', e = clean(earfcn) || ''; if (cellOk(p, e, rat)) cells.push({ rat, pci: p, earfcn: e, band: clean(band) || '' }); };
    if (/5G|NR|ENDC|^SA$/i.test(nt)) add('16', d.nr5g_pci, d.nr5g_action_channel, d.nr5g_action_band);
    if (/LTE|4G|ENDC|NSA/i.test(nt)) add('12', d.lte_pci, d.wan_active_channel, d.wan_active_band);
    return { networkType: nt, cells };
  }

  // ---- Radio restart ------------------------------------------------------------------------------------------
  // Order of the sequence:
  //   AT+SFUN=5 on SIM slot 0, then slot 1 (radio OFF), then AT+SFUN=4 on slot 0, then slot 1 (radio ON), 100 ms apart.
  // 5 = off and 4 = on (Unisoc). An earlier version here had them the other way round, so the "restart" turned the radio OFF and left it there.
  // On the F50 AT+SFUN? is not supported (+CME ERROR: 3), so this meaning is confirmed only indirectly: registration returns after the sequence.
  // The whole sequence runs ON the device in ONE root call. Found on the F50: while the radio is off the browser loses the host for a few
  // seconds, so a step sent from the page ("slot 0 on") never arrived and the radio stayed off. On the device nothing depends on the page.
  // A slot that did not switch off is sent the "on" command once (once, no retry); a slot that did is retried for about 16 s.
  const CYCLE_SH = [
    'SA=/data/data/com.matchi.tool/files/sendat',
    '[ -x "$SA" ] || { echo NOSENDAT; exit 0; }',
    'tx() { "$SA" -n "$1" -c "$2" 2>&1 | tr "\\n\\r" "  "; }',
    'p0=$(tx 0 AT); p1=$(tx 1 AT)',
    'case "$p0$p1" in *OK*) ;; *) echo "NOAT:$p0$p1"; exit 0;; esac',
    // The F50 has one SIM slot: when sendat finds no device for slot 1 it is skipped (nothing is written to the RIL's port).
    'has1=1; case "$p1" in *"no modem AT device"*) has1=0;; esac',
    'o0=$(tx 0 AT+SFUN=5); echo "OFF0:$o0"',
    'o1=NOSLOT; [ $has1 = 1 ] && o1=$(tx 1 AT+SFUN=5); echo "OFF1:$o1"',
    'sleep 0.1',
    'anyon=0',
    'for s in 0 1; do',
    '  if [ $s = 1 ] && [ $has1 = 0 ]; then echo "ON1:0:NOSLOT"; continue; fi',
    '  eval "o=\\$o$s"; n=1; case "$o" in *OK*) n=8;; esac',
    '  i=0; ok=0; r=',
    '  while [ $i -lt $n ]; do r=$(tx $s AT+SFUN=4); case "$r" in *OK*) ok=1; break;; esac; i=$((i+1)); [ $i -lt $n ] && sleep 2; done',
    '  [ $ok = 1 ] && anyon=1',
    '  echo "ON$s:$ok:$r"',
    'done',
    // Mobile data after the restart. Found on the F50: the modem data call stayed up (AT+CGACT? 1,1) but Android never brought sipa_eth0 back,
    // so there was no internet until "svc data disable; sleep 3; svc data enable". So: when the radio is on again, wait up to ~36 s for the
    // internet to work (a ping, root, to 1.1.1.1 or 8.8.8.8); if it does not, and mobile data is switched ON in Android, do that toggle. A phone
    // whose owner turned mobile data off is left alone. NOT a default-route check: on the F50 "ip -4 route show default" is EMPTY even while the
    // internet works (Android keeps its routes in per-interface tables; seen on the device, 17 Nov 2026), so that test always said "down".
    // Prints DATA:ok (internet works by itself), DATA:toggled (works after the toggle), DATA:none (still no internet), DATA:off (mobile data is
    // off in Android, nothing done) or DATA:skip (the radio did not come back, nothing done). NET: is only a diagnostic line (sipa_eth0 addresses).
    'hasnet() { ping -c 1 -W 2 1.1.1.1 >/dev/null 2>&1 || ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1; }',
    'if [ "$anyon" != 1 ]; then echo DATA:skip',
    'else',
    '  w=0; while [ $w -lt 6 ] && ! hasnet; do sleep 2; w=$((w+1)); done',
    '  if hasnet; then echo DATA:ok',
    '  else',
    '    echo "NET:$(ip -4 addr show sipa_eth0 2>&1 | grep -c inet) inet on sipa_eth0"',
    '    md=$(settings get global mobile_data 2>/dev/null)',
    '    case "$md" in 0) echo DATA:off;;',
    '    *)',
    '      svc data disable; sleep 3; svc data enable',
    '      w=0; while [ $w -lt 4 ] && ! hasnet; do sleep 2; w=$((w+1)); done',
    '      if hasnet; then echo DATA:toggled; else echo DATA:none; fi;;',
    '    esac',
    '  fi',
    'fi',
  ].join('\n');
  // ui = { log(line), toast(text, colour) }, both optional. Returns true when the radio is confirmed back on.
  async function radioCycle(ui) {
    const log = (ui && ui.log) || (() => {}), toast = (ui && ui.toast) || (() => {});
    log('> Radio restart (AT+SFUN=5 radio off, then AT+SFUN=4 radio on, SIM slots 0 and 1; a slot the modem does not have is skipped; runs on the device)');
    let text = '', lost = false;
    try { text = await sh(CYCLE_SH, 110000); }   // radio off/on (up to ~35 s) + mobile data recovery (up to ~65 s); /api/shell caps a call at 120 s
    catch (e) { lost = true; log('The page lost the host while the radio was off (' + e.message + '). The restart keeps going on the device; waiting for the host to come back...'); }
    const get = (k) => { const m = text.match(new RegExp('^' + k + ':(.*)$', 'm')); return m ? m[1].trim() : ''; };
    if (!lost) {
      if (/NOSENDAT/.test(text)) { log('The AT tool (sendat) was not found on the device. Nothing was changed.'); toast('Radio restart failed, nothing changed', 'red'); return false; }
      if (/^NOAT:/m.test(text)) { log('Modem didn\'t answer AT. Radio unchanged. Run Full diagnose.'); toast('Modem does not answer AT, nothing changed', 'red'); return false; }
      for (const sl of [0, 1]) { if (/NOSLOT/.test(get('OFF' + sl))) { log('slot ' + sl + ': not present on this device, skipped'); continue; } log('slot ' + sl + ' off: ' + (get('OFF' + sl) || '(no output)')); const o = get('ON' + sl); log('slot ' + sl + ' on: ' + (o ? o.replace(/^[01]:/, '') : '(no output)')); }
      const dataMsg = { ok: 'Mobile data: the internet works (ping answered).', toggled: 'Mobile data: no internet after the restart, so mobile data was switched off and on (svc data). The internet works again.', none: 'Mobile data: no internet (ping failed) after switching mobile data off and on. Check Live Status; run "svc data disable; sleep 3; svc data enable" by hand if there is still no internet.', off: 'Mobile data is switched off in Android, so it was left alone.' }[get('DATA')];
      if (dataMsg) log(dataMsg);
      const off = [/OK/.test(get('OFF0')), /OK/.test(get('OFF1'))];
      if (!off[0] && !off[1]) { log('Radio-off step failed on both slots. Nothing was changed.'); toast('Radio restart failed, nothing changed', 'red'); return false; }
      const bad = [0, 1].filter((sl) => off[sl] && !/^1:/.test(get('ON' + sl)));
      if (!bad.length) { log('Radio is back on. Registration can take about 30 s, then check Live Status.'); toast('Radio restarted', 'green'); return true; }
      lost = true;   // an "on" step did not get OK: fall through to the check below
      log('Slot ' + bad.join(', ') + ' did not confirm "on". Checking again...');
    }
    // The host (or the modem) is away for a short while. Wait until an AT read answers, then send "on" once more: it is harmless when the radio is already on.
    let up = false;
    for (let i = 0; i < 30 && !up; i++) {
      await sleep(3000);
      try { await at('AT+CSQ', 0); up = true; } catch (_) { /* still away */ }
    }
    if (!up) { log('WARNING: the host or the modem did not answer for 90 s. The radio may still be OFF. When this window works again run AT+SFUN=4 (slot 0, then slot 1), or reboot the device.'); toast('Radio may still be off: run AT+SFUN=4', 'red'); return false; }
    let ok0 = false;
    for (const sl of [0, 1]) {
      let last = '';
      for (let i = 0; i < 3; i++) { try { last = tidy(await at('AT+SFUN=4', sl)); if (last.includes('OK')) break; } catch (e) { last = e.message; } await sleep(2000); }
      log('slot ' + sl + ' on (again): ' + (last || '(no output)'));
      if (sl === 0) ok0 = last.includes('OK');
    }
    if (ok0) { log('Radio is on. Registration can take about 30 s, then check Live Status.'); toast('Radio restarted', 'green'); return true; }
    log('WARNING: the radio may still be OFF on slot 0. Run AT+SFUN=4 here now, or reboot the device.'); toast('Radio may still be off: run AT+SFUN=4', 'red'); return false;
  }

  // ---- Busy state ---------------------------------------------------------------------------------------------
  // While the radio restarts the modem (and sometimes the host) is away for ~30 s. Whoever starts a radio change calls beginBusy(reason) and
  // the returned function when finished. Live Status listens (onBusy): it stops polling, keeps the last values on screen and shows the reason,
  // then reads once when the last busy period ends. Nested periods count; the state ends when all are released.
  const busyReasons = [], busyListeners = new Set();
  const isBusy = () => busyReasons.length > 0;
  const busyReason = () => (busyReasons.length ? busyReasons[busyReasons.length - 1] : '');
  const notifyBusy = () => { for (const fn of [...busyListeners]) { try { fn(isBusy(), busyReason()); } catch (_) { /* a listener must not break a radio change */ } } };
  function beginBusy(reason) {
    const tag = { r: reason || 'Radio busy' }; busyReasons.push(tag.r); notifyBusy();
    let done = false;
    return () => { if (done) return; done = true; const i = busyReasons.lastIndexOf(tag.r); if (i >= 0) busyReasons.splice(i, 1); notifyBusy(); };
  }
  const onBusy = (fn) => { busyListeners.add(fn); return () => busyListeners.delete(fn); };
  // Ask the registration every everyMs until the modem is registered (LTE or 5G, stat 1 or 5) or timeoutMs has passed. onTick(secondsWaited) is optional.
  async function waitRegistered(slot, opt) {
    const o = opt || {}, every = o.everyMs || 3000, limit = o.timeoutMs || 90000, t0 = Date.now();
    for (;;) {
      if (await isRegistered(slot)) return true;
      const waited = Date.now() - t0; if (waited >= limit) return false;
      if (o.onTick) { try { o.onTick(Math.round(waited / 1000)); } catch (_) { /* ignore */ } }
      await sleep(Math.min(every, limit - waited));
    }
  }

  return {
    sleep, at, sh, fields, tidy, parseNrSupported, readNrSupported, isRegistered, waitRegistered,
    isBusy, busyReason, beginBusy, onBusy,
    zte, setRouter, setConfirmed, setSettle, emptyHint, setNetMode, NET_MODES, netLabel, clean, readRadio,
    LTE_BANDS, parseBands, bandText, bandsMsg, sameList, bandsCheck, readBands, sendBands, setBands,
    toList, ratLabel, guessRat, cellOk, readCells, cellListed, cellLock, cellUnlock, cellAutoOn, setCellAuto, watchCell, servingCells,
    CYCLE_SH, radioCycle,
  };
})();

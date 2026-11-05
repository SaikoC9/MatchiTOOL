//<script>
/*
 * Bypass (F50) for UFI-TOOLS - TTL manager + Anti-DPI (plugin version v65.13)
 * Copyright (c) 2026 saiko (GitHub: SaikoC9). MIT License. A plugin for UFI-TOOLS; the nfqws program is not included.
 * BPF_TAG below is the cache key of the embedded eBPF program, not the plugin version.
 */
(async () => {
  'use strict';

  const TITLE = 'Bypass (F50)';
  const MODAL_NAME = 'kano_bypass_modal';
  const STYLE_ID = 'kano_bypass_style';
  const BTN_ID = 'kano_bypass_btn';
  const BOOT_FILE = '/sdcard/ufi_tools_boot.sh';
  const APP_CURL = '/data/data/com.minikano.f50_sms/files/curl';
  const PING_IP = '8.8.8.8';
  const PING_HOST = 'google.com';
  const LAN_IFS = 'br0 usb0 wlan0';
  const LAN_SH = String.raw`LANALL="${LAN_IFS}"
uplink_ifs() {
  { ip route show default 2>/dev/null | grep '^default'; ip route show table all 2>/dev/null | grep '^default'; ip route get 8.8.8.8 2>/dev/null; } | grep -o 'dev [^ ]*' | cut -d' ' -f2 | sort -u
}
calc_lan() {
  UP=" $(uplink_ifs | tr '\n' ' ')"
  LANIFS=""
  for cli in $LANALL; do case "$UP" in *" $cli "*) ;; *) LANIFS="$LANIFS $cli" ;; esac; done
  LANIFS=$(echo $LANIFS)
}
calc_lan`;
  const QUICK_TTL = 64;
  const WATCH_INTERVAL = 30;
  const BPF_TAG = 'v29';
  const LOCK_SH = String.raw`LOCK=/data/local/ufi_lock/apply.lock
BOOTID=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)
lock_owner() { cat "$LOCK/pid" 2>/dev/null; }
lock_boot() { cat "$LOCK/boot" 2>/dev/null; }
lock_sweep() {
  for lks in "$LOCK".stale.*; do
    [ -d "$lks" ] || continue
    lksp=$(echo "$lks" | sed 's/.*\.stale\.\([0-9]*\)\..*/\1/')
    case "$lksp" in ''|*[!0-9]*) continue ;; esac
    kill -0 "$lksp" 2>/dev/null || rm -rf "$lks"
  done
}
lock_foreign() {
  # True when PID $1 is a live process that is clearly not a Bypass helper (a reused PID). Unknown or unreadable is "not foreign".
  lfc=$(2>/dev/null tr '\0' ' ' < "/proc/$1/cmdline")
  [ -n "$lfc" ] || return 1
  case "$lfc" in *ttl.sh*|*dpi.sh*) return 1 ;; esac
  return 0
}
lock_guard_take() {
  # Publish the boot ID before the PID, so a guard with a PID always has its boot ID (when the device has one).
  if mkdir "$LOCK.rec" 2>/dev/null; then
    [ -n "$BOOTID" ] && printf '%s\n' "$BOOTID" > "$LOCK.rec/boot" 2>/dev/null
    printf '%s\n' "$$" > "$LOCK.rec/pid" 2>/dev/null
    return 0
  fi
  lkgp=$(cat "$LOCK.rec/pid" 2>/dev/null)
  case "$lkgp" in
    ''|*[!0-9]*) lkgn=$((lkgn+1)); [ "$lkgn" -ge 5 ] && rm -rf "$LOCK.rec" ;;
    *)
      lkgb=$(cat "$LOCK.rec/boot" 2>/dev/null)
      if ! kill -0 "$lkgp" 2>/dev/null; then
        rm -rf "$LOCK.rec"
      elif [ -n "$lkgb" ] && [ -n "$BOOTID" ] && [ "$lkgb" != "$BOOTID" ]; then
        # Guard left over from before a reboot: its PID may now belong to an unrelated process.
        rm -rf "$LOCK.rec"
      elif [ -z "$lkgb" ] && [ -n "$BOOTID" ] && lock_foreign "$lkgp"; then
        # Guard written by v65.7 (no boot ID) whose PID now belongs to a process that is not a Bypass helper.
        rm -rf "$LOCK.rec"
      fi ;;
  esac
  return 1
}
lock_still_stale() {
  [ "$(lock_owner)" = "$1" ] || return 1
  case "$2" in
    dead) ! kill -0 "$1" 2>/dev/null ;;
    reboot) lksb=$(lock_boot); [ -n "$lksb" ] && [ -n "$BOOTID" ] && [ "$lksb" != "$BOOTID" ] ;;
    foreign) [ -n "$BOOTID" ] && [ -z "$(lock_boot)" ] && lock_foreign "$1" ;;
    *) return 0 ;;
  esac
}
lock_recover() {
  lkr_owner=$1; lkr_why=$2; lkr_rc=1
  lock_guard_take || return 1
  lkr_path="$LOCK.stale.$$.$lkt"
  if lock_still_stale "$lkr_owner" "$lkr_why" && mv "$LOCK" "$lkr_path" 2>/dev/null; then
    if [ "$(cat "$lkr_path/pid" 2>/dev/null)" = "$lkr_owner" ]; then
      rm -rf "$lkr_path"; lkr_rc=0
    elif [ ! -e "$LOCK" ] && mv "$lkr_path" "$LOCK" 2>/dev/null; then
      :
    else
      rm -rf "$lkr_path"
    fi
  fi
  rm -rf "$LOCK.rec"
  return $lkr_rc
}
lock_take() {
  mkdir -p "$(dirname "$LOCK")" 2>/dev/null || return 1
  lkt=0; lknp=0; lknd=0; lkgn=0
  lock_sweep
  while :; do
    if mkdir "$LOCK" 2>/dev/null; then
      # Publish the boot ID first, then the PID with an exclusive create (noclobber). If recovery moved our directory away while
      # we were stalled and another process has since created the lock, we cannot overwrite its PID: the write fails and we retry.
      [ -n "$BOOTID" ] && printf '%s\n' "$BOOTID" > "$LOCK/boot" 2>/dev/null
      if ( set -C; printf '%s\n' "$$" > "$LOCK/pid" ) 2>/dev/null; then
        [ "$(lock_owner)" = "$$" ] && return 0
        lock_free
      else
        rmdir "$LOCK" 2>/dev/null
      fi
    fi
    lkt=$((lkt+1)); [ "$lkt" -gt 90 ] && return 1
    if [ ! -d "$LOCK" ]; then lknd=$((lknd+1)); [ "$lknd" -gt 5 ] && return 1; sleep 1; continue; fi
    lklp=$(lock_owner)
    if [ -z "$lklp" ] || case "$lklp" in *[!0-9]*) true ;; *) false ;; esac; then
      # Empty or malformed PID. A live creator publishes its PID within microseconds, so 10 consecutive sightings
      # (about 10 s) mean the creator died or is stalled. Reclaim only through the guarded atomic rename; a stalled
      # creator then fails its exclusive PID write (or, if the lock was retaken, cannot overwrite it) and retries.
      lknp=$((lknp+1))
      if [ "$lknp" -ge 10 ]; then lock_recover "$lklp" ambiguous && lknp=0; fi
    else
      lknp=0
      lklb=$(lock_boot)
      if [ -n "$lklb" ] && [ -n "$BOOTID" ] && [ "$lklb" != "$BOOTID" ]; then
        # The lock was taken before the last reboot: its PID may now belong to an unrelated process.
        lock_recover "$lklp" reboot && continue
      elif [ -z "$lklb" ] && [ -n "$BOOTID" ] && kill -0 "$lklp" 2>/dev/null && lock_foreign "$lklp"; then
        # Lock written by an older version (no boot ID) whose PID now belongs to a process that is not a Bypass helper.
        lock_recover "$lklp" foreign && continue
      elif ! kill -0 "$lklp" 2>/dev/null; then
        sleep 1
        [ "$(lock_owner)" = "$lklp" ] && lock_recover "$lklp" dead
        continue
      fi
    fi
    sleep 1
  done
}
lock_free() { [ "$(lock_owner)" = "$$" ] && rm -rf "$LOCK"; return 0; }`;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (test, timeout = 30000, step = 150) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = test();
      if (v) return v;
      await sleep(step);
    }
    return null;
  };

  try { window.__kano_bypass_cleanup?.(); } catch (_) {  }
  document.getElementById(BTN_ID)?.remove();
  document.getElementById(MODAL_NAME)?.remove();

  const toast = (msg, color, ms) => { try { createToast(msg, color, ms); } catch (_) {  } };

  const ROOT_QUEUE_KEY = '__kano_bypass_root_queue_v1';
  let sharedRootQueue = window[ROOT_QUEUE_KEY];
  if (!sharedRootQueue || typeof sharedRootQueue !== 'object' || typeof sharedRootQueue.then === 'function' || typeof sharedRootQueue.tail?.then !== 'function') {
    sharedRootQueue = { tail: Promise.resolve() };
    window[ROOT_QUEUE_KEY] = sharedRootQueue;
  }
  const runRoot = (command, timeout = 20000) => {
    const limit = timeout || 20000;
    let resolveResult;
    const result = new Promise((resolve) => { resolveResult = resolve; });
    sharedRootQueue.tail = sharedRootQueue.tail.then(async () => {
      let timer = null;
      const call = Promise.resolve().then(() => { if (typeof runShellWithRoot !== 'function') throw new Error('UFI-TOOLS root-shell function is unavailable'); return runShellWithRoot(command, limit); });
      const settled = call.then(
        (res) => ({ kind: 'success', res }),
        (err) => ({ kind: 'error', err }),
      );
      const timed = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), limit + 8000);
      });
      const outcome = await Promise.race([settled, timed]);
      clearTimeout(timer);
      if (outcome.kind === 'timeout') {
        resolveResult({ ok: false, text: `Root command exceeded ${limit} ms; queue remains safely locked until the host shell settles. If it never settles, restart UFI-TOOLS rather than running overlapping root commands.` });
        await settled;
      } else if (outcome.kind === 'error') {
        resolveResult({ ok: false, text: String(outcome.err?.message || outcome.err) });
      } else {
        const res = outcome.res;
        resolveResult({ ok: Boolean(res?.success), text: String(res?.content ?? '').replace(/\r/g, '').trim() });
      }
    }).catch((err) => {
      resolveResult({ ok: false, text: `Root queue task failed safely: ${String(err?.message || err)}` });
    });
    return result;
  };

  const PRELUDE = [
    'W=""',
    'if iptables -w 5 -S >/dev/null 2>&1; then W="-w 5"; elif iptables -w -S >/dev/null 2>&1; then W="-w"; fi',
    'ipt() { b=$1; shift; "$b" $W "$@"; }',
    '',
  ].join('\n');

  const b64utf8 = (text) => {
    let bin = '';
    new TextEncoder().encode(text).forEach((byte) => { bin += String.fromCharCode(byte); });
    return btoa(bin);
  };
  const writeFile = (path, content) => {
    const dir = path.replace(/\/[^/]*$/, '');
    const tmp = `${path}.new.$$`;
    return `mkdir -p ${dir} && (umask 077; echo ${b64utf8(content)} | base64 -d > ${tmp}) && test -s ${tmp} && mv -f ${tmp} ${path} || { rm -f ${tmp}; echo FILE_WRITE_FAILED; exit 1; }`;
  };

  const scriptId = (text) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  };
  const stampScript = (text) => {
    const nl = text.indexOf('\n');
    return `${text.slice(0, nl + 1)}# script-id: ${scriptId(text)}\n${text.slice(nl + 1)}`;
  };
  const installHelper = async (path, raw) => {
    const id = scriptId(raw);
    const w = await runRoot(`${writeFile(path, stampScript(raw))} && chmod 755 ${path} && test -x ${path} && sh -n ${path} && grep -q '^# script-id: ${id}$' ${path} && echo WROTE`);
    if (!w.text.includes('WROTE')) throw new Error(`Could not write the helper script, or the file on the device does not match what was written. ${w.text.slice(0, 120)}`);
  };
  const restartIfStale = async (p) => {
    const pid = p.replace(/[^/]*$/, 'watch.pid');
    const marker = '__BYPASS_WATCH_RESTART_OK__';
    const command = `if [ "$(sh ${p} status 2>/dev/null)" = running ] && [ ${p} -nt ${pid} ]; then ` +
      `(sh ${p} stop && sh ${p} start && sleep 1 && [ "$(sh ${p} status 2>/dev/null)" = running ]) ` +
      `|| { echo __BYPASS_WATCH_RESTART_FAILED__; exit 1; }; echo ${marker}; ` +
      `else echo __BYPASS_WATCH_UNCHANGED__; fi`;
    const result = await runRoot(command, 30000);
    if (!result.ok || result.text.includes('__BYPASS_WATCH_RESTART_FAILED__')) {
      throw new Error(`Could not restart or verify watcher for ${p}: ${result.text || 'root command failed'}`);
    }
    return result.text.includes(marker) || result.text.includes('__BYPASS_WATCH_UNCHANGED__');
  };
  const ensureHelper = async (path, raw) => {
    const id = scriptId(raw);
    const c = await runRoot(`grep -q '^# script-id: ${id}$' ${path} 2>/dev/null && echo CURRENT || echo STALE`);
    const rewritten = !c.text.includes('CURRENT');
    if (rewritten) await installHelper(path, raw);
    await restartIfStale(path);
    return rewritten;
  };

  const bootLineRe = (marker) => `^[[:space:]]*sh ${marker.replace(/[.[\]*+?^${}()|\\]/g, '\\$&')} start([[:space:]]+>/dev/null 2>&1)?([[:space:]]*&)?[[:space:]]*$`;
  const bootCheckCmd = (marker) => `grep -qE '${bootLineRe(marker)}' ${BOOT_FILE} 2>/dev/null && echo YES || echo NO`;
  const BOOT_DIR = '/data/local/ufi_boot';
  const BOOT_HASH = `${BOOT_DIR}/boot.sha256`;
  const BOOT_FN = String.raw`bsum() { ( sha256sum "$1" || busybox sha256sum "$1" || toybox sha256sum "$1" || openssl dgst -sha256 "$1" ) 2>/dev/null | grep -oE '[0-9a-f]{64}' | head -n 1; }`;
  const bootPreCmd = () => [
    BOOT_FN,
    'PRE=bad',
    `if [ ! -f ${BOOT_FILE} ]; then PRE=ok`,
    `elif [ -f ${BOOT_HASH} ]; then [ "$(cat ${BOOT_HASH})" = "$(bsum ${BOOT_FILE})" ] && PRE=ok`,
    `elif [ -z "$(${foreignPipeline()})" ]; then PRE=ok`,
    'fi',
  ].join('\n');
  const bootSealCmd = () => [
    `if [ "$PRE" = ok ]; then S=$(bsum ${BOOT_FILE}); if [ -n "$S" ]; then mkdir -p ${BOOT_DIR}; chmod 700 ${BOOT_DIR}; echo "$S" > ${BOOT_HASH}.new.$$ && chmod 600 ${BOOT_HASH}.new.$$ && mv -f ${BOOT_HASH}.new.$$ ${BOOT_HASH} && echo BOOT_SEALED; else echo BOOT_NOHASHTOOL; fi; else echo BOOT_UNSEALED; fi`,
  ].join('\n');
  const bootDelRaw = (marker) => String.raw`if [ "$PRE" != ok ]; then echo BOOT_UNTRUSTED; exit 1; fi; if [ -f ${BOOT_FILE} ]; then BT=${BOOT_FILE}.tmp.$$; grep -vE '${bootLineRe(marker)}' ${BOOT_FILE} > "$BT"; BR=$?; if [ "$BR" -le 1 ] && mv -f "$BT" ${BOOT_FILE}; then :; else rm -f "$BT"; echo BOOT_EDIT_FAILED; exit 1; fi; fi`;
  const bootDelCmd = (marker) => [bootPreCmd(), bootDelRaw(marker), bootSealCmd()].join('\n');
  const bootAddCmd = (marker, line) => [
    bootPreCmd(),
    String.raw`[ -f ${BOOT_FILE} ] || printf '#!/system/bin/sh\n' > ${BOOT_FILE}`,
    bootDelRaw(marker),
    String.raw`[ -s ${BOOT_FILE} ] && [ -n "$(tail -c1 ${BOOT_FILE})" ] && echo >> ${BOOT_FILE}`,
    `echo '${line}' >> ${BOOT_FILE}`,
    bootSealCmd(),
    `grep -qE '${bootLineRe(marker)}' ${BOOT_FILE} && echo BOOT_OK`,
  ].join('\n');
  const BOOT_UNTRUSTED_MSG = 'The boot file was changed by something else, so the boot entry was not touched. Open Quick setup > Info, read the file, press "Trust current boot file" if every line is yours, then try again';
  const bootDel = async (marker) => {
    const r = await runRoot(bootDelCmd(marker));
    if (/BOOT_UNTRUSTED/.test(r.text)) throw new Error(BOOT_UNTRUSTED_MSG);
    if (/BOOT_EDIT_FAILED/.test(r.text) || !r.ok) throw new Error(`Could not remove the boot entry. ${r.text.slice(0, 120)}`);
    const c = await runRoot(bootCheckCmd(marker));
    if (c.text.includes('YES')) throw new Error('The boot entry is still in the boot file after removing it');
  };
  const bootAdd = async (marker, line) => {
    const r = await runRoot(bootAddCmd(marker, line));
    if (/BOOT_UNTRUSTED/.test(r.text)) throw new Error(BOOT_UNTRUSTED_MSG);
    if (!r.text.includes('BOOT_OK')) throw new Error('Could not edit the boot script');
  };
  const runRemove = async (script) => {
    const r = await runRoot(`sh ${script} remove 2>&1; echo RC=$?`, 40000);
    if (!/RC=0\s*$/.test(r.text)) {
      let why = r.text.replace(/RC=\d+\s*$/, '').trim().slice(0, 160);
      if (!why || /abort|timed? ?out|exceeded/i.test(why)) why = 'the device did not finish in time (the firewall lock may be busy with another Bypass command). Wait a minute and try again';
      throw new Error(`Could not remove the rules: ${why}`);
    }
  };
  const stopHelper = async (script) => {
    let bootErr = null;
    let rmErr = null;
    try { await bootDel(script); } catch (e) { bootErr = e; }
    try { await runRemove(script); } catch (e) { rmErr = e; }
    if (bootErr && rmErr) throw new Error(`${rmErr.message}. Also: ${bootErr.message}`);
    if (rmErr || bootErr) throw (rmErr || bootErr);
  };
  const bootIntegrityCmd = [
    BOOT_FN,
    `if [ ! -f ${BOOT_FILE} ]; then echo BI_NOFILE`,
    `elif [ ! -f ${BOOT_HASH} ]; then echo BI_NOSEAL`,
    `elif [ -z "$(bsum ${BOOT_FILE})" ]; then echo BI_NOTOOL`,
    `elif [ "$(cat ${BOOT_HASH})" = "$(bsum ${BOOT_FILE})" ]; then echo BI_OK`,
    'else echo BI_CHANGED; fi',
  ].join('\n');

  const OWN_BOOT_LINES = [
    'sh /data/local/ufi_ttl/ttl.sh start >/dev/null 2>&1 &',
    'sh /data/local/ufi_dpi/dpi.sh start >/dev/null 2>&1 &',
  ];
  const foreignPipeline = () => {
    const own = OWN_BOOT_LINES.map((l) => `-e '${l}'`).join(' ');
    return `[ -f ${BOOT_FILE} ] && { tr -d '\\r' < ${BOOT_FILE} | head -n 1 | grep '^#!' | grep -vxF -e '#!/system/bin/sh'; tr -d '\\r' < ${BOOT_FILE} | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$' | grep -vxF ${own}; } | head -n 5`;
  };
  const foreignBootLines = async () => {
    const r = await runRoot(foreignPipeline());
    return r.ok ? r.text.split('\n').filter(Boolean) : [];
  };
  const bootIntegrity = async () => {
    const r = await runRoot(bootIntegrityCmd);
    const m = r.text.match(/BI_(\w+)/);
    return r.ok && m ? m[1] : 'UNKNOWN';
  };
  const refreshBootInt = async (st, lines) => {
    const el = q('#boot_int');
    if (!el) return;
    st = st || await bootIntegrity();
    lines = lines || await foreignBootLines();
    const base = {
      OK: 'The boot file is unchanged since the plugin last wrote it.',
      CHANGED: 'WARNING: the boot file changed since the plugin last wrote it. Read it, and press the button only if every line is yours.',
      NOSEAL: lines.length ? 'No saved check value yet, and the file has lines the plugin did not add. Read them, then press the button if they are yours.' : 'No saved check value yet. It is saved the next time the plugin changes the boot file, or when you press the button.',
      NOFILE: 'There is no boot file.',
      NOTOOL: 'This device has no SHA-256 tool, so the file cannot be checked.',
      UNKNOWN: 'Could not check the boot file.',
    }[st] || '';
    el.textContent = base + (lines.length ? ` Lines not added by the plugin: ${lines.join(' | ')}` : '');
  };
  const trustBoot = async () => {
    const r = await runRoot(`${BOOT_FN}\nif [ ! -f ${BOOT_FILE} ]; then echo BT_NOFILE\nelse S=$(bsum ${BOOT_FILE}); if [ -z "$S" ]; then echo BT_NOTOOL; else mkdir -p ${BOOT_DIR}; chmod 700 ${BOOT_DIR}; echo "$S" > ${BOOT_HASH}.new.$$ && chmod 600 ${BOOT_HASH}.new.$$ && mv -f ${BOOT_HASH}.new.$$ ${BOOT_HASH} && echo BT_OK; fi; fi`);
    if (r.text.includes('BT_OK')) toast('Boot file trusted. Later changes will be reported', 'green', 4000);
    else if (r.text.includes('BT_NOFILE')) toast('There is no boot file to trust', 'orange', 4000);
    else toast('Could not save the check value (no SHA-256 tool on this device)', 'orange', 5000);
    await refreshBootInt();
  };
  let bootWarnedOnOpen = false;
  const warnForeignBoot = async (onlyOnce = false) => {
    if (onlyOnce && bootWarnedOnOpen) return;
    const lines = await foreignBootLines();
    const st = await bootIntegrity();
    if ((lines.length || st === 'CHANGED') && onlyOnce) bootWarnedOnOpen = true;
    refreshBootInt(st, lines).catch(() => {  });
    if (st === 'CHANGED') toast(`The boot file changed since this plugin last wrote it, and everything in ${BOOT_FILE} runs as root. Open Quick setup > Info to review it`, 'red', 12000);
    else if (lines.length) toast(`The boot file has ${lines.length >= 5 ? '5 or more' : lines.length} line(s) this plugin did not add. Everything in ${BOOT_FILE} runs as root, so check it`, 'orange', 10000);
  };

  const parseStatus = (text) => {
    const out = { sections: {}, kv: {} };
    let cur = null;
    for (const line of text.split('\n')) {
      if (!line.startsWith('@@')) { if (cur) out.sections[cur].push(line); continue; }
      const body = line.slice(2);
      const eq = body.indexOf('=');
      if (eq > 0) { out.kv[body.slice(0, eq)] = body.slice(eq + 1).trim(); continue; }
      if (body === 'iptables' || body === 'ip6tables') { cur = body; out.sections[cur] = []; continue; }
      if (cur) out.sections[cur].push('@@' + body);
    }
    return out;
  };

  let modalEl = null;
  const q = (sel) => (document.getElementById(MODAL_NAME) || modalEl)?.querySelector(sel) || null;
  const put = (sel, cls, text) => {
    const el = q(sel);
    if (!el) return;
    const c = `bp-value ${cls}`;
    if (el.className !== c) el.className = c;
    if (el.textContent !== text) el.textContent = text;
  };
  const swapIn = (real, tmp) => { if (real.innerHTML !== tmp.innerHTML) real.replaceChildren(...tmp.childNodes); };

  const CHIP_GROUPS = [['#ttl_presets', '#ttl_input'], ['#dpi_mss_presets', '#dpi_mss'], ['#dpi_dns_presets', '#dpi_dns']];
  const syncChips = () => {
    CHIP_GROUPS.forEach(([box, input]) => {
      const v = String(q(input)?.value ?? '').trim();
      q(box)?.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.v === v));
    });
  };

  const markSw = (grp, id) => document.querySelectorAll(`#${MODAL_NAME} .bp-sw[data-grp="${grp}"]`).forEach((b) => b.classList.toggle('sel', b.id === id));

  let session = 0;
  let busy = 0;
  const setBusy = (on, s = session) => {
    if (s !== session) return;
    busy = Math.max(0, busy + (on ? 1 : -1));
    document.querySelectorAll(`#${MODAL_NAME} button.bp-act`).forEach((b) => { b.disabled = busy > 0; });
  };
  const guarded = (fn, busyText = 'Working…') => async (ev) => {
    if (busy > 0) return;
    const s = session;
    const btn = ev?.currentTarget instanceof HTMLElement ? ev.currentTarget : null;
    const label = btn?.textContent;
    setBusy(true, s);
    if (btn && busyText) btn.textContent = busyText;
    try { await fn(); } catch (e) {
      toast(`Failed: ${e?.message || e}`, 'red', 7000);
      try { await ttlModule.refresh(); await dpiModule.refresh(); } catch (_) {  }
    } finally {
      if (btn && label != null) btn.textContent = label;
      setBusy(false, s);
      try { btn?.blur?.(); } catch (_) {  }
    }
  };
  const initGuard = (fn) => async () => {
    const s = session;
    setBusy(true, s);
    try { await fn(); } finally { setBusy(false, s); }
  };

  const copyPre = async (sel) => {
    const text = q(sel)?.textContent?.trim() || '';
    if (!text || text === '—' || text === 'Checking…') { toast('Press Run first, then press Copy', 'orange', 3000); return; }
    await copyText(text);
  };
  const copyText = async (text, okMsg = 'Diagnose output copied') => {
    let done = false;
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) { await navigator.clipboard.writeText(text); done = true; }
    } catch (_) {  }
    if (!done) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      try { done = document.execCommand('copy'); } catch (_) { done = false; }
      ta.remove();
    }
    toast(done ? okMsg : 'The browser blocked copying. Select the text and copy it manually', done ? 'green' : 'orange', done ? 2500 : 5000);
  };

  const sha256Js = (u8) => {
    const K = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const len = u8.length;
    const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    padded.set(u8);
    padded[len] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, Math.floor(len / 0x20000000), false);
    dv.setUint32(padded.length - 4, (len << 3) >>> 0, false);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return Array.from(H).map((x) => x.toString(16).padStart(8, '0')).join('');
  };
  const ttlModule = (() => {
    const DIR = '/data/local/ufi_ttl';
    const SCRIPT = `${DIR}/ttl.sh`;
    const CONF = `${DIR}/ttl.conf`;
    const BOOT_LINE = `sh ${SCRIPT} start >/dev/null 2>&1 &`;
    const DEFAULT_TTL = 64;
    const validTtl = (n) => Number.isInteger(n) && n >= 1 && n <= 255;

    const BPF_INSNS_B64 = 'twIAAKUAAABzKv//AAAAAGESEAAAAAAAFQIcAIbdAABVAiEACAAAAL+jAAAAAAAABwMAAP3///+/FgAAAAAAALcCAAAWAAAAtwQAAAIAAACFAAAAGgAAALcBAAAAAAAAbQEZAAAAAABxof//AAAAAHGi/f8AAAAAHRIWAAAAAABxpP7/AAAAAGcEAAAIAAAAv0MAAAAAAABPIwAAAAAAAE8UAAAAAAAAv2EAAAAAAAC3AgAAGAAAALcFAAACAAAAhQAAAAoAAAC3AQAAAAAAAG0BCwAAAAAAv6MAAAAAAAAHAwAA/////79hAAAAAAAAtwIAABYAAAAFAAMAAAAAAL+jAAAAAAAABwMAAP////+3AgAAFQAAALcEAAABAAAAtwUAAAAAAACFAAAACQAAABgAAAD/////AAAAAAAAAACVAAAAAAAAAA==';
    const BPF_LOADER_B64 = 'f0VMRgIBAQAAAAAAAAAAAAIAtwABAAAAsABAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAEAAOAACAAAAAAAAAAEAAAAFAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAAAGAIAAAAAAAAYAgAAAAAAAAAQAAAAAAAAAQAAAAYAAAAAAAAAAAAAAAAAQQAAAAAAAABBAAAAAAAAAAAAAAAAAAAAAQAAAAAAABAAAAAAAAD0C0D59Q9A+TQJALQVCQC0Mwig0gAAgJJgggD5YIYA+QABgNJhAgSRiBSA0gEAANRgDICS4QMUqgIAgNIIB4DSAQAA1B8AAPErBwBU9gMAquADFqphBkCRAgCC0ugHgNIBAADUHwAA8SsGAFT3AwCq4AMWqigHgNIBAADUlwUAtGAAgFJgAgC54P5D02AGALlgBkCRYAYA+eAIilKACaByYAICuWACCJFgCgD5IACAUmAaALkAAIRSYB4AuWASQJFgEgD5oACA0uEDE6oCEIDSCCOA0gEAANT5AwCqHwAA8csCAFT4AwCqYQIMkTUAAPk4CAC5wACA0gIQgNIII4DSAQAA1PkDAKofAADxiwAAVAAAgNKoC4DSAQAA1OADGcsAkAGRqAuA0gEAANRAC4DSqAuA0gEAANRhEkCRAgCA0iNoYjhjAAA0QgQAkf3//xdAAIDSCAiA0gEAANTgAxnLqAuA0gEAANQ=';
    const BPF_PATCH_OFFSET = 4;
    const BLOB_SHA256 = [
      ['BPF_INSNS_B64', BPF_INSNS_B64, '2c184a15e2983d1a6321cb3f2d390767ae1077100cbb18e662adc134f10450b8'],
      ['BPF_LOADER_B64', BPF_LOADER_B64, '2ba11584a65f9c386fb26efdb7ec5c31291bcb15b0b655c5a7ebb65f4ce692bb'],
    ];
    let blobsChecked = false;
    const verifyBlobs = () => {
      if (blobsChecked) return;
      BLOB_SHA256.forEach(([name, b64, want]) => {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        if (sha256Js(u8) !== want) throw new Error(`Safety check failed: ${name} does not match its expected SHA-256, so nothing was written to the device. Reinstall the plugin from a copy you trust`);
      });
      blobsChecked = true;
    };

    const bpfInsnsB64 = (value) => {
      const bin = atob(BPF_INSNS_B64);
      if (bin.charCodeAt(BPF_PATCH_OFFSET) !== 0xA5) throw new Error('Internal error: eBPF program layout changed');
      return btoa(bin.slice(0, BPF_PATCH_OFFSET) + String.fromCharCode(value) + bin.slice(BPF_PATCH_OFFSET + 1));
    };

    const TTL_SCRIPT = String.raw`#!/system/bin/sh
# UFI TTL helper: apply | remove | start | stop | status | watch
D=/data/local/ufi_ttl
CH=UFI_TTL
CONF=$D/ttl.conf
PIDF=$D/watch.pid
IV=${WATCH_INTERVAL}; case "$IV" in ''|*[!0-9]*|0) IV=30 ;; esac
V6=0
W=""
if iptables -w 5 -S >/dev/null 2>&1; then W="-w 5"; elif iptables -w -S >/dev/null 2>&1; then W="-w"; fi
ipt() { b=$1; shift; "$b" $W "$@"; }
load() {
  TTL=64
  [ -f "$CONF" ] && . "$CONF"
  case "$TTL" in ''|*[!0-9]*) TTL=64 ;; esac
  if [ "$TTL" -lt 1 ] || [ "$TTL" -gt 255 ]; then TTL=64; fi
  calc_lan
}
rule_for() { if [ "$1" = iptables ]; then echo "-j TTL --ttl-set $TTL"; else echo "-j HL --hl-set $TTL"; fi; }
# ---- eBPF fallback (firmware without the iptables TTL target) ----
# A tc ingress filter on the client-facing interfaces sets the TTL to (wanted + 1) as packets arrive;
# the router then lowers it by 1 when forwarding, so traffic leaves with exactly the wanted TTL.
BIN=$D/ttl_bpf.bin
LOADER=$D/bpfload
PIN=/sys/fs/bpf/ttl_bpf
METHF=$D/method
IFSF=$D/bpfifs
${LAN_SH}
BPFV="${BPF_TAG}"
${LOCK_SH}
BPFPRIO=1
TCB=$(command -v tc 2>/dev/null)
have_target() {
  ipt iptables -t mangle -F UFI_PROBE_$$ 2>/dev/null; ipt iptables -t mangle -X UFI_PROBE_$$ 2>/dev/null
  ipt iptables -t mangle -N UFI_PROBE_$$ 2>/dev/null || return 1
  ipt iptables -t mangle -A UFI_PROBE_$$ -j TTL --ttl-set 64 >/dev/null 2>&1; hr=$?
  ipt iptables -t mangle -F UFI_PROBE_$$ 2>/dev/null; ipt iptables -t mangle -X UFI_PROBE_$$ 2>/dev/null
  return $hr
}
bpf_ifaces() { for bfi in $LANIFS; do [ -d "/sys/class/net/$bfi" ] && echo "$bfi"; done; }
# Every configured interface that exists, including one that is the uplink right now (its old filter must be removed).
bpf_all_ifaces() { for bai in $LANALL; do [ -d "/sys/class/net/$bai" ] && echo "$bai"; done; }
# "ingress" works on both plain ingress and clsact qdiscs (br0 here uses clsact); "parent ffff:" is the fallback.
tc_show() { "$TCB" filter show dev "$1" ingress 2>/dev/null; "$TCB" filter show dev "$1" parent ffff: 2>/dev/null; }
bpf_ok_if() { tc_show "$1" | grep -q ttl_bpf; }
# Preference (priority) of our filter, and the lowest preference used by any other filter on the interface.
# Lower number runs first, so we install ours below every other one and they still run after it.
bpf_pref_ours() { tc_show "$1" | grep ttl_bpf | sed -n 's/.* pref \([0-9][0-9]*\).*/\1/p' | head -n 1; }
# tc also prints a header line without the program name for every filter, so "grep -v ttl_bpf" is not enough:
# drop every line that carries our own pref number instead.
bpf_pref_other_min() { o=$(bpf_pref_ours "$1"); [ -n "$o" ] || o=x; tc_show "$1" | sed -n 's/.* pref \([0-9][0-9]*\).*/\1/p' | grep -vx "$o" | sort -n | head -n 1; }
bpf_handle_ours() { tc_show "$1" | sed -n 's/.* handle \(0x[0-9a-fA-F][0-9a-fA-F]*\) ttl_bpf.*/\1/p' | head -n 1; }
bpf_del_ours() {
  bdn=0
  p=$(bpf_pref_ours "$1")
  while [ -n "$p" ] && [ "$bdn" -lt 5 ]; do
    h=$(bpf_handle_ours "$1")
    if [ -n "$h" ] && { "$TCB" filter del dev "$1" ingress protocol all prio "$p" handle "$h" bpf 2>/dev/null || "$TCB" filter del dev "$1" parent ffff: protocol all prio "$p" handle "$h" bpf 2>/dev/null; }; then
      :
    else
      "$TCB" filter del dev "$1" ingress prio "$p" 2>/dev/null || "$TCB" filter del dev "$1" parent ffff: prio "$p" 2>/dev/null || break
    fi
    bdn=$((bdn+1))
    p=$(bpf_pref_ours "$1")
  done
  return 0
}
bpf_clear() {
  [ -n "$TCB" ] || return 0
  for bci in $(bpf_all_ifaces); do bpf_del_ours "$bci"; done
  rm -f "$IFSF" "$PIN" "$D/bpfttl"
  return 0
}
# Self-test: a loader started without arguments must exit 90 and do nothing else.
# The older single-segment (RWX) copy is no longer used; a leftover file from an earlier version is deleted here.
loader_pick() {
  rm -f "$D/bpfload.rwx" "$D/allow_rwx"
  "$LOADER" >/dev/null 2>&1; [ $? -eq 90 ] && { echo "$LOADER"; return 0; }
  return 1
}
bpf_apply() {
  [ -n "$TCB" ] || { echo "tc not found"; return 1; }
  [ -f "$BIN" ] || { echo "eBPF program missing"; return 1; }
  [ -x "$LOADER" ] || { echo "eBPF loader missing"; return 1; }
  [ "$TTL" -le 254 ] || { echo "TTL max is 254 with the eBPF method"; return 1; }
  # Nothing to attach to yet (right after boot br0 / usb0 / wlan0 may not exist): stop before loading anything.
  [ -n "$(bpf_ifaces)" ] || { echo "no hotspot interface found yet ($LANIFS); will retry"; return 1; }
  # Same value and everything still attached: nothing to do (no gap in the filter, no reload churn).
  if [ "$(cat "$D/bpfttl" 2>/dev/null)" = "$TTL:$BPFV" ] && bpf_healthy; then echo "BPFIFS=$(cat "$IFSF" 2>/dev/null)"; return 0; fi
  # Detach any old copy first, then load the (new value) program into the kernel and pin it.
  for bpi in $(bpf_all_ifaces); do bpf_del_ours "$bpi"; done
  rm -f "$PIN"
  [ -d /sys/fs/bpf ] || mkdir -p /sys/fs/bpf 2>/dev/null
  mount | grep -q " /sys/fs/bpf " || mount -t bpf bpf /sys/fs/bpf 2>/dev/null
  LD=$(loader_pick) || { echo "the eBPF loader cannot run on this system"; return 1; }
  lout=$("$LD" "$BIN" "$PIN" 2>&1); lrc=$?
  if [ "$lrc" -ne 0 ]; then
    echo "bpf load failed (code $lrc; 1=EPERM 13=EACCES 22=EINVAL 90=bad file, 100+n=pin errno n): $lout"
    return 1
  fi
  ok=""
  for bpi in $(bpf_ifaces); do
    "$TCB" qdisc show dev "$bpi" 2>/dev/null | grep -q -E "ingress|clsact" || "$TCB" qdisc add dev "$bpi" ingress 2>/dev/null
    m=$(bpf_pref_other_min "$bpi")
    case "$m" in
      ''|*[!0-9]*) prio=$BPFPRIO ;;
      *) if [ "$m" -gt 1 ]; then prio=$((m-1)); else prio=1; fi ;;
    esac
    if out=$("$TCB" filter add dev "$bpi" ingress protocol all prio $prio bpf object-pinned "$PIN" da 2>&1) \
      || out=$("$TCB" filter add dev "$bpi" parent ffff: protocol all prio $prio bpf object-pinned "$PIN" da 2>&1) \
      || out=$("$TCB" filter add dev "$bpi" ingress protocol all prio $prio bpf pinned "$PIN" da 2>&1); then
      ok="$ok $bpi"
    else
      echo "tc failed on $bpi: $out"
    fi
  done
  [ -n "$ok" ] || return 1
  echo "$ok" > "$IFSF"
  echo "$TTL:$BPFV" > "$D/bpfttl"
  echo "BPFIFS=$ok"
  return 0
}
bpf_healthy() {
  [ -f "$IFSF" ] || return 1
  [ -e "$PIN" ] || return 1
  # Every client-facing interface that exists now must carry our filter (an interface such as usb0 can
  # appear after boot or after a USB reconnect), and ours must still run before every other filter.
  # An interface that became the uplink must no longer carry our filter.
  for bhi in $(bpf_all_ifaces); do
    case " $LANIFS " in *" $bhi "*) continue ;; esac
    bpf_ok_if "$bhi" && return 1
  done
  for bhi in $(bpf_ifaces); do
    bpf_ok_if "$bhi" || return 1
    o=$(bpf_pref_ours "$bhi"); m=$(bpf_pref_other_min "$bhi")
    [ -n "$o" ] || o=0
    case "$m" in ''|*[!0-9]*) ;; *) [ "$o" -le "$m" ] || return 1 ;; esac
  done
  return 0
}
# Packets injected by nfqws carry this fwmark. They must keep the (low) TTL nfqws gave them, so the first
# rule of the chain lets them through untouched. If the mark match is unavailable the rule is skipped
# (a per-binary "nomark_*" flag file remembers that).
# Packets leaving through a hotspot interface (downlink to clients) are returned untouched as well, so only
# traffic going out to the mobile network gets the TTL. Unlike the eBPF method (client packets only), this also covers
# traffic made by the router itself that leaves through a non-hotspot interface.
MARKR="-m mark --mark 0x40000000/0x40000000 -j RETURN"
# Chain layout: [mark RETURN] [one "-o <hotspot if> -j RETURN" per interface] [TTL / HL rule]
prefix_ok() {
  b=$1
  if [ ! -f "$D/nomark_$b" ]; then ipt "$b" -t mangle -C $CH $MARKR 2>/dev/null || return 1; fi
  for pki in $LANIFS; do ipt "$b" -t mangle -C $CH -o "$pki" -j RETURN 2>/dev/null || return 1; done
  return 0
}
prefix_len() {
  k=0
  [ -f "$D/nomark_$1" ] || k=1
  for pli in $LANIFS; do k=$((k+1)); done
  echo "$k"
}
# The TTL chain must run before the anti-DPI chain: a packet accepted back from NFQUEUE continues with the next
# table, so any rule placed after the queue rule would be skipped for the queued packets.
order_ok() {
  [ "$1" = iptables ] || return 0
  ipt iptables -t mangle -C POSTROUTING -j UFI_DPI 2>/dev/null || return 0
  f=$(ipt iptables -t mangle -S POSTROUTING 2>/dev/null | grep -E -e '-j UFI_(TTL|DPI)$' | head -n 1)
  case "$f" in *UFI_TTL) return 0 ;; *) return 1 ;; esac
}
fix_order() {
  ipt "$1" -t mangle -D POSTROUTING -j $CH 2>/dev/null
  ipt "$1" -t mangle -I POSTROUTING 1 -j $CH
}
ok_one() {
  b=$1
  ipt "$b" -t mangle -C POSTROUTING -j $CH 2>/dev/null || return 1
  ipt "$b" -t mangle -C $CH $(rule_for "$b") 2>/dev/null || return 1
  prefix_ok "$b" || return 1
  order_ok "$b"
}
apply_one() {
  b=$1
  command -v "$b" >/dev/null 2>&1 || return 3
  ok_one "$b" && return 0
  ipt "$b" -t mangle -N $CH 2>/dev/null
  # Value-only change: replace the TTL rule in place so there is never a moment without a rule.
  if ipt "$b" -t mangle -C POSTROUTING -j $CH 2>/dev/null; then
    aon=$(ipt "$b" -t mangle -S $CH 2>/dev/null | grep -c '^-A')
    pl=$(prefix_len "$b")
    if [ "$aon" = "$((pl+1))" ] && prefix_ok "$b"; then
      if ipt "$b" -t mangle -R $CH "$((pl+1))" $(rule_for "$b") 2>/dev/null; then
        order_ok "$b" || fix_order "$b"
        return 0
      fi
    fi
  fi
  ipt "$b" -t mangle -F $CH 2>/dev/null || return 1
  rm -f "$D/nomark_$b"
  ipt "$b" -t mangle -A $CH $MARKR 2>/dev/null || { mkdir -p "$D"; : > "$D/nomark_$b"; }
  for aoi in $LANIFS; do
    if ! ipt "$b" -t mangle -A $CH -o "$aoi" -j RETURN 2>/dev/null; then
      ipt "$b" -t mangle -F $CH 2>/dev/null
      ipt "$b" -t mangle -X $CH 2>/dev/null
      return 1
    fi
  done
  if ! ipt "$b" -t mangle -A $CH $(rule_for "$b"); then
    ipt "$b" -t mangle -F $CH 2>/dev/null
    ipt "$b" -t mangle -X $CH 2>/dev/null
    return 1
  fi
  if ipt "$b" -t mangle -C POSTROUTING -j $CH 2>/dev/null; then
    order_ok "$b" || fix_order "$b"
  else
    ipt "$b" -t mangle -I POSTROUTING 1 -j $CH || return 1
  fi
  return 0
}
apply_inner() {
  load
  if have_target; then
    bpf_clear
    apply_one iptables; r4=$?
    apply_one ip6tables; r6=$?
    V6=0; [ "$r6" -eq 0 ] && V6=1
    echo ipt > "$METHF"
    echo "V4=$r4 V6=$r6 TTL=$TTL METHOD=ipt"
    [ "$r4" -eq 0 ]
  else
    bpf_out=$(bpf_apply); br=$?
    if [ "$br" -eq 0 ]; then echo bpf > "$METHF"; else rm -f "$METHF"; fi
    [ -n "$bpf_out" ] && echo "$bpf_out"
    if [ "$br" -eq 0 ]; then echo "V4=0 V6=0 TTL=$TTL METHOD=bpf"; else echo "V4=1 V6=1 TTL=$TTL METHOD=bpf"; fi
    [ "$br" -eq 0 ]
  fi
}
apply() {
  if ! lock_take; then
    echo "could not acquire the shared firewall lock; TTL apply was not run"
    return 1
  fi
  apply_inner; rc=$?
  lock_free
  return $rc
}
clear_one() {
  b=$1
  command -v "$b" >/dev/null 2>&1 || return 0
  con=0
  while ipt "$b" -t mangle -C POSTROUTING -j $CH 2>/dev/null; do
    ipt "$b" -t mangle -D POSTROUTING -j $CH 2>/dev/null || break
    con=$((con+1)); [ "$con" -gt 20 ] && break
  done
  ipt "$b" -t mangle -F $CH 2>/dev/null
  ipt "$b" -t mangle -X $CH 2>/dev/null
  return 0
}
is_ours() { [ -n "$1" ] && kill -0 "$1" 2>/dev/null && tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null | grep -qF "ttl.sh watch"; }
running() { [ -f "$PIDF" ] && is_ours "$(cat "$PIDF" 2>/dev/null)"; }
stop() {
  if [ -f "$PIDF" ]; then
    p=$(cat "$PIDF" 2>/dev/null)
    if is_ours "$p"; then
      kill "$p" 2>/dev/null || :
      sw=0
      while [ "$sw" -lt 30 ] && kill -0 "$p" 2>/dev/null; do sleep 0.1 2>/dev/null || sleep 1; sw=$((sw+1)); done
      if kill -0 "$p" 2>/dev/null; then echo "watcher did not stop (pid $p)"; return 1; fi
    fi
    [ "$(cat "$PIDF" 2>/dev/null)" = "$p" ] && rm -f "$PIDF"
  fi
  return 0
}
start() {
  running && return 0
  if [ -f "$PIDF" ]; then
    oldp=$(cat "$PIDF" 2>/dev/null)
    is_ours "$oldp" && { echo "watcher already running but status check failed"; return 1; }
    rm -f "$PIDF"
  fi
  if command -v setsid >/dev/null 2>&1; then
    setsid sh "$0" watch </dev/null >/dev/null 2>&1 &
  else
    sh "$0" watch </dev/null >/dev/null 2>&1 &
  fi
  sw=0
  while [ "$sw" -lt 30 ]; do
    running && return 0
    sleep 0.1 2>/dev/null || sleep 1
    sw=$((sw+1))
  done
  echo "watcher did not become healthy within startup window"
  return 1
}
healthy() {
  if [ "$(cat "$METHF" 2>/dev/null)" = bpf ]; then bpf_healthy; return $?; fi
  ok_one iptables || return 1
  if [ "$V6" = 1 ]; then ok_one ip6tables || return 1; fi
  return 0
}
wself() {
  wsp=$(cat "$PIDF" 2>/dev/null)
  if [ -z "$wsp" ]; then echo $$ > "$PIDF" 2>/dev/null
  elif [ "$wsp" != "$$" ]; then
    if is_ours "$wsp"; then exit 0; fi
    echo $$ > "$PIDF" 2>/dev/null
  fi
  return 0
}
watch() {
  running && exit 0
  # Exclusive create (noclobber): two simultaneous starts cannot both publish a PID file.
  if ! ( set -C; echo $$ > "$PIDF" ) 2>/dev/null; then
    running && exit 0
    rm -f "$PIDF"
    ( set -C; echo $$ > "$PIDF" ) 2>/dev/null || exit 1
  fi
  SP=""
  trap '[ -n "$SP" ] && kill "$SP" 2>/dev/null; [ "$(cat "$PIDF" 2>/dev/null)" = "$$" ] && rm -f "$PIDF"; exit 0' TERM INT HUP
  apply >/dev/null 2>&1
  # First minute: look every 3 s (a cheap check) so an interface that appears late after boot is covered quickly.
  # v65.1: the loop counter is WN, not n. Helper functions (drop_chain, clear6, restart_nfq ...) also use n and run inside this loop.
  WN=0
  while [ "$WN" -lt 20 ]; do
    sleep 3 & SP=$!
    wait $SP
    SP=""
    wself
    load
    healthy || apply >/dev/null 2>&1
    WN=$((WN+1))
  done
  FAIL=0; SKIP=0
  while :; do
    sleep "$IV" & SP=$!
    wait $SP
    SP=""
    wself
    load
    # Back off (up to 4 cycles) while apply keeps failing, so an unsupported method is not retried every cycle.
    if [ "$SKIP" -gt 0 ]; then
      SKIP=$((SKIP-1))
    elif healthy; then
      FAIL=0
    elif apply >/dev/null 2>&1; then
      FAIL=0
    else
      FAIL=$((FAIL+1)); SKIP=$FAIL; [ "$SKIP" -gt 4 ] && SKIP=4
    fi
  done
}
remove_all() {
  stop
  if ! lock_take; then
    echo "could not acquire the shared firewall lock; TTL remove was not run"
    return 1
  fi
  clear_one iptables; clear_one ip6tables; bpf_clear; rm -f "$METHF" "$D"/nomark_*
  lock_free
  return 0
}
case "$1" in
  apply) apply ;;
  remove) remove_all; exit $? ;;
  start) start ;;
  stop) stop ;;
  status) if running; then echo running; else echo stopped; fi ;;
  watch) watch ;;
  *) echo "usage: $0 apply|remove|start|stop|status|watch"; exit 2 ;;
esac
`;

    const parseStatusInfo = (sec, text) => {
      const lines = sec || [];
      if (lines.includes('@@MISSING')) return { state: 'missing' };
      const m = lines.join('\n').match(/(?:ttl|hl)-set\s+(\d+)/);
      if (!m) return { state: 'off' };
      return { state: lines.includes('@@LINKED') ? 'on' : 'unlinked', value: m[1] };
    };
    const describe = (info) => {
      if (info.state === 'on') return ['bp-good', `Active (${info.value})`];
      if (info.state === 'unlinked') return ['bp-warn', `Rule exists but is not linked (${info.value}); press Apply`];
      if (info.state === 'missing') return ['bp-warn', 'Not available on this device'];
      return ['bp-bad', 'Not active'];
    };

    let ttlSupported = null;
    let ttlState = { on: false, ebpf: false, value: '', boot: false, watching: false, text: '' };
    const refresh = async (syncForm = false) => {
      const sess = session;
      const r = await runRoot(PRELUDE + String.raw`
for B in iptables ip6tables; do
  echo "@@$B"
  if command -v $B >/dev/null 2>&1; then
    ipt $B -t mangle -S UFI_TTL 2>&1
    if ipt $B -t mangle -C POSTROUTING -j UFI_TTL 2>/dev/null; then echo "@@LINKED"; else echo "@@UNLINKED"; fi
  else
    echo "@@MISSING"
  fi
done
T=0
ipt iptables -t mangle -F UFI_PROBE_$$ 2>/dev/null; ipt iptables -t mangle -X UFI_PROBE_$$ 2>/dev/null
if ipt iptables -t mangle -N UFI_PROBE_$$ 2>/dev/null; then
  ipt iptables -t mangle -A UFI_PROBE_$$ -j TTL --ttl-set 64 2>/dev/null && T=1
  ipt iptables -t mangle -F UFI_PROBE_$$ 2>/dev/null; ipt iptables -t mangle -X UFI_PROBE_$$ 2>/dev/null
fi
echo "@@TTL_T=$T"
${LAN_SH}
B=""
for i in $LANIFS; do
  [ -d /sys/class/net/$i ] && { tc filter show dev $i ingress 2>/dev/null; tc filter show dev $i parent ffff: 2>/dev/null; } | grep -q ttl_bpf && B="$B $i"
done
echo "@@BPF=$B"
echo "@@METHOD=$(cat ${DIR}/method 2>/dev/null)"
if grep -qE '${bootLineRe(SCRIPT)}' ${BOOT_FILE} 2>/dev/null; then BOOTON=1; else BOOTON=0; fi
echo "@@BOOT=$BOOTON"
echo "@@WATCH=$([ -f ${SCRIPT} ] && sh ${SCRIPT} status 2>/dev/null || echo stopped)"
echo "@@SAVED=$(sed -n 's/^TTL=//p' ${CONF} 2>/dev/null | head -n 1)"
`);
      if (sess !== session) return;
      const st = parseStatus(r.text);
      const info4 = parseStatusInfo(st.sections.iptables);
      let [c4, t4] = describe(info4);
      let [c6, t6] = describe(parseStatusInfo(st.sections.ip6tables));
      ttlSupported = st.kv.TTL_T === '1' ? true : st.kv.TTL_T === '0' ? false : null;
      if (ttlSupported === false) {
        if (c4 === 'bp-bad') { c4 = 'bp-warn'; t4 = 'Not active (eBPF)'; }
        if (c6 === 'bp-bad') { c6 = 'bp-warn'; t6 = 'Not active (eBPF)'; }
      }
      const bpfIfs = String(st.kv.BPF || '').trim();
      if (bpfIfs) {
        const sv = Number(st.kv.SAVED);
        c4 = c6 = 'bp-good';
        t4 = t6 = `Active via eBPF (${validTtl(sv) ? sv : '?'}) on ${bpfIfs}`;
      }
      const hero = q('#ttl_hero');
      if (hero) {
        const on = c4 === 'bp-good';
        const warn = !on && c4 === 'bp-warn' && ttlSupported !== false;
        hero.className = `bp-hero ${on ? 'on' : warn ? 'warn' : 'off'}`;
        hero.textContent = on ? `● TTL rule ${t4.replace(/^Active\s*/, 'active ')}` : (ttlSupported === false ? '● Not active. Press Apply' : `● ${t4}`);
      }
      const hint = q('#ttl_hint');
      if (hint) hint.style.display = ttlSupported === false ? '' : 'none';
      markSw('ttl', c4 === 'bp-good' ? 'ttl_apply' : 'ttl_remove');
      put('#ttl_v4', c4, t4);
      put('#ttl_v6', c6, t6);
      const boot = st.kv.BOOT === '1';
      put('#ttl_boot', boot ? 'bp-good' : 'bp-warn', boot ? 'Enabled' : 'Disabled');
      q('#ttl_boot_toggle')?.classList.toggle('bp-on', boot);
      const watching = st.kv.WATCH === 'running';
      put('#ttl_watch', watching ? 'bp-good' : 'bp-warn', watching ? 'Running' : (boot ? 'Stopped' : 'Off'));
      const saved = Number(st.kv.SAVED);
      ttlState = { on: c4 === 'bp-good', ebpf: Boolean(bpfIfs), value: bpfIfs ? (validTtl(saved) ? saved : '') : (info4.value || ''), boot, watching,
        text: r.ok ? t4 : `no answer from the device (${String(r.text).slice(0, 80)})` };
      const input = q('#ttl_input');
      if (syncForm && input && validTtl(saved)) input.value = saved;
      syncChips();
    };

    const readTtl = () => {
      const n = Number(q('#ttl_input')?.value);
      if (!validTtl(n)) throw new Error('TTL must be a whole number from 1 to 255');
      return n;
    };

    const installScript = async () => {
      await installHelper(SCRIPT, TTL_SCRIPT);
    };
    const isBootOn = async () => (await runRoot(bootCheckCmd(SCRIPT))).text.includes('YES');

    const applyRule = async () => {
      const ttl = readTtl();
      markSw('ttl', 'ttl_apply');
      if (ttlSupported === false && ttl > 254) throw new Error('With the eBPF method the TTL can be 1 to 254');
      await installScript();
      const c = await runRoot(`${writeFile(CONF, `TTL=${ttl}\n`)} && echo SAVED`);
      if (!c.text.includes('SAVED')) throw new Error('Could not save the TTL value');
      if (ttlSupported !== true && ttl <= 254) {
        verifyBlobs();
        const o = await runRoot(`mkdir -p ${DIR} && echo ${bpfInsnsB64(ttl + 1)} | base64 -d > ${DIR}/ttl_bpf.bin.new && mv -f ${DIR}/ttl_bpf.bin.new ${DIR}/ttl_bpf.bin && echo ${BPF_LOADER_B64} | base64 -d > ${DIR}/bpfload.new && chmod 755 ${DIR}/bpfload.new && mv -f ${DIR}/bpfload.new ${DIR}/bpfload && echo OBJ_OK`);
        if (!o.text.includes('OBJ_OK')) throw new Error('Could not write the eBPF files');
      }
      const r = await runRoot(`sh ${SCRIPT} apply 2>&1; echo RC=$?`, 30000);
      const method = (r.text.match(/METHOD=(\w+)/) || [])[1] || 'ipt';
      const m = r.text.match(/V4=(\d+) V6=(\d+)/);
      const v4 = m ? Number(m[1]) : 1;
      const v6 = m ? Number(m[2]) : 1;
      if (await isBootOn()) {
        try { await bootAdd(SCRIPT, BOOT_LINE); } catch (e) { toast(`Auto-apply at boot: ${e.message}`, 'orange', 9000); }
        await runRoot(`sh ${SCRIPT} stop; sh ${SCRIPT} start`);
      }
      await refresh(true);
      if (v4 !== 0 && method === 'bpf') {
        const out = r.text.replace(/V4=.*$/m, '').replace(/RC=\d+\s*$/, '').trim();
        toast(`eBPF TTL method failed. ${out.slice(0, 200)}`, 'red', 12000);
      } else if (v4 === 0 && method === 'bpf') {
      } else if (v4 !== 0) {
        const out = r.text.replace(/RC=\d+\s*$/, '').trim();
        if (/unknown option|No chain\/target\/match|Couldn't load target/i.test(out)) {
          toast('No TTL target in this firmware\'s iptables. TTL can\'t be set this way. Nothing changed.', 'red', 9000);
        } else {
          toast(`IPv4 TTL rule failed. Output: ${out.slice(0, 160)}`, 'red', 9000);
        }
      } else if (v6 === 0) {
        toast(`TTL ${ttl} applied (IPv4 + IPv6)`, 'green', 4000);
      } else if (v6 === 3) {
        toast(`TTL ${ttl} applied (IPv4). ip6tables is not available`, 'green', 4500);
      } else {
        toast(`TTL ${ttl} applied for IPv4. The IPv6 hop-limit rule is not supported by this kernel`, 'orange', 6000);
      }
    };

    const removeRule = async () => {
      markSw('ttl', 'ttl_remove');
      await installScript();
      await runRemove(SCRIPT);
      const bootOn = await isBootOn();
      await refresh(true);
      toast(bootOn ? 'TTL rule removed. Auto-apply at boot is still enabled and will restore it' : 'TTL rule removed', bootOn ? 'orange' : 'green', bootOn ? 6000 : 4000);
    };

    const toggleBoot = async () => {
      const enabled = await isBootOn();
      if (enabled) {
        await bootDel(SCRIPT);
        await runRoot(`[ -f ${SCRIPT} ] && sh ${SCRIPT} stop`);
      } else {
        const has = await runRoot(`[ -f ${SCRIPT} ] && [ -f ${CONF} ] && echo YES`);
        if (!has.text.includes('YES')) throw new Error('Apply a TTL first so there is something to run at boot');
        await bootAdd(SCRIPT, BOOT_LINE);
        await runRoot(`sh ${SCRIPT} start`);
        await sleep(600);
      }
      await refresh();
      toast(enabled ? 'Auto-apply at boot disabled' : 'Auto-apply at boot enabled', 'green', 3500);
      if (!enabled) await warnForeignBoot();
    };

    const checkIp = async () => {
      const sess = session;
      put('#ttl_ip', 'bp-value', 'Checking…');
      const url = 'https://api.ipify.org';
      const r = await runRoot(String.raw`C=${APP_CURL}; [ -x "$C" ] || C=$(command -v curl)
if [ -n "$C" ]; then "$C" -s --connect-timeout 4 --max-time 8 ${url}
elif command -v wget >/dev/null 2>&1; then wget -qO- -T 8 ${url}
fi`, 18000);
      if (sess !== session) return;
      const ip = r.text;
      put('#ttl_ip', 'bp-value', /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : 'Unavailable (no internet or blocked)');
    };

    const copyDiag = () => copyPre('#ttl_diag');

    const diagnose = async () => {
      const sess = session;
      const out = q('#ttl_diag');
      if (out) out.textContent = 'Checking…';
      const r = await runRoot(String.raw`echo "== iptables"; iptables -V 2>&1
echo "== TTL target"; iptables -t mangle -j TTL --help 2>&1 | head -3
echo "== xtables libs"; ls /system/lib64/xtables /vendor/lib64/xtables /system/lib/xtables 2>&1 | head -40
echo "== kernel config"; (zcat /proc/config.gz 2>/dev/null | grep -Ei "XT_TARGET_(HL|TTL)|NET_ACT_PEDIT|NET_CLS_U32|NET_SCH_INGRESS") || echo "no /proc/config.gz or no matches"
echo "== loaded"; grep -Ei "xt_HL|xt_TTL|act_pedit" /proc/modules /proc/net/ip_tables_targets 2>/dev/null || echo "none listed"
echo "== tools"; for t in tc nft ip; do p=$(command -v $t 2>/dev/null); if [ -n "$p" ]; then echo "$t: $p"; else echo "$t: not found"; fi; done
echo "== default ttl"; cat /proc/sys/net/ipv4/ip_default_ttl 2>&1
echo "== bpf kernel config"; (zcat /proc/config.gz 2>/dev/null | grep -E "^CONFIG_(BPF|BPF_SYSCALL|BPF_JIT|NET_CLS_BPF|NET_ACT_BPF|NET_CLS_ACT|NET_SCH_CLSACT|CGROUP_BPF)=") || echo "none"
echo "== tc bpf support"; tc -V 2>&1 | head -1; tc filter add dev lo parent ffff: bpf help 2>&1 | head -3
echo "== bpffs / selinux"; ls /sys/fs/bpf 2>&1 | head -5; getenforce 2>&1
echo "== interfaces"; ls /sys/class/net 2>&1
echo "== bridge ports"; ls /sys/class/net/br0/brif 2>&1
echo "== possible hardware fast path"; ls /proc/net 2>/dev/null | grep -i -E "sfp|ipa" ; grep -i -E "sfp|sipa" /proc/modules 2>/dev/null | head -5; ls /sys/module 2>/dev/null | grep -i -E "sfp|ipa"; ls /sys/fs/bpf 2>/dev/null | grep -i prog | head -20
echo "== tc ingress state"; for i in br0 usb0 wlan0 sipa_eth0 sipa_eth1 sipa_eth2 sipa_usb0; do echo "-- $i"; tc qdisc show dev $i 2>&1 | head -3; tc filter show dev $i ingress 2>&1 | head -6; echo "(egress)"; tc filter show dev $i egress 2>&1 | head -4; done`, 30000);
      const el = q('#ttl_diag');
      if (el && sess === session) el.textContent = r.text || '(no output)';
    };

    return {
      html: `
        <div class="bp-section">
          <div id="ttl_hero" class="bp-hero off">● Checking…</div>
          <div class="bp-card">
            <div class="bp-head"><span class="bp-title">Status</span><button class="bp-act" id="ttl_refresh">Refresh</button></div>
            <div class="bp-grid">
              <div class="bp-stat"><div class="bp-label">IPv4 TTL</div><div id="ttl_v4" class="bp-value">Checking…</div></div>
              <div class="bp-stat"><div class="bp-label">IPv6 hop limit</div><div id="ttl_v6" class="bp-value">Checking…</div></div>
              <div class="bp-stat"><div class="bp-label">Auto-apply at boot</div><div id="ttl_boot" class="bp-value">Checking…</div></div>
              <div class="bp-stat"><div class="bp-label">Keep-alive</div><div id="ttl_watch" class="bp-value">Checking…</div></div>
            </div>
          </div>
          <div class="bp-card">
            <div class="bp-row" style="margin-top:0">
              <label>TTL <input id="ttl_input" type="number" min="1" max="255" step="1" value="${DEFAULT_TTL}"></label>
              <span id="ttl_presets" class="bp-chips"><button class="bp-act bp-chip" data-v="64">64</button><button class="bp-act bp-chip" data-v="65">65</button><button class="bp-act bp-chip" data-v="128">128</button></span>
            </div>
            <div class="bp-row">
              <button class="bp-act bp-sm bp-sw" data-grp="ttl" id="ttl_apply">Apply</button>
              <button class="bp-act bp-sm bp-danger bp-sw" data-grp="ttl" id="ttl_remove">Remove</button>
              <button class="bp-act bp-sm bp-toggle" id="ttl_boot_toggle">At boot</button>
            </div>
          </div>
          <details class="bp-card bp-more">
            <summary>How it works and how to test</summary>
            <div id="ttl_hint" class="bp-note bp-warn" style="display:none;opacity:1">This firmware has no iptables TTL target, so Apply uses an <b>eBPF method</b>: the TTL is changed on packets arriving from hotspot clients (br0 / usb0 / wlan0) and the router lowers it by 1 when forwarding, so traffic leaves with exactly your TTL (1 to 254). To test, run this on a connected Windows PC: <b>ping -i 1 -n 1 8.8.8.8</b>. A normal reply means it works; "TTL expired in transit" from 192.168.0.1 means it does not (<b>tracert -d 8.8.8.8</b> should show 8.8.8.8 as hop 1). If it fails, set the TTL on the PC instead (Command Prompt as administrator, then restart): <b>netsh int ipv4 set glob defaultcurhoplimit=65</b>.</div>
            <div class="bp-note">The rule sits in its own chain (UFI_TTL), so it can be removed cleanly. The value you set is the TTL of packets leaving the router toward the mobile network; traffic going to hotspot devices is not changed. 64 is the usual phone value; 65 is an alternative some carriers need. Auto-apply at boot also starts a keep-alive that restores the rule if the mobile connection resets it. Carriers can detect hotspot use in other ways, and this may break your plan's terms. Use at your own risk.</div>
          </details>
        </div>
      `,
      tools: `
        <details class="bp-card bp-more">
          <summary>Diagnose TTL support</summary>
          <div class="bp-note">Shows which TTL methods this device supports. If TTL does not work, copy this text and send it for support.</div>
          <div class="bp-row"><button class="bp-act" id="ttl_diag_btn">Run</button><button class="bp-act" id="ttl_diag_copy">Copy</button></div>
          <pre id="ttl_diag" class="bp-pre">—</pre>
        </details>
        <div class="bp-card">
          <div class="bp-head"><span class="bp-title">Public IP</span><button class="bp-act" id="ttl_ip_btn">Check</button></div>
          <div id="ttl_ip" class="bp-value">—</div>
          <div class="bp-note">Contacts api.ipify.org only when you press Check.</div>
        </div>
      `,
      bind: () => {
        const apply = guarded(applyRule, 'Applying…');
        q('#ttl_apply').onclick = apply;
        q('#ttl_remove').onclick = guarded(removeRule, 'Removing…');
        q('#ttl_boot_toggle').onclick = guarded(toggleBoot);
        q('#ttl_ip_btn').onclick = guarded(checkIp, 'Checking…');
        q('#ttl_diag_btn').onclick = guarded(diagnose, 'Checking…');
        q('#ttl_diag_copy').onclick = guarded(copyDiag, '');
        q('#ttl_refresh').onclick = guarded(() => refresh(false), 'Refreshing…');
        q('#ttl_presets')?.querySelectorAll('button').forEach((b) => { b.onclick = () => { const i = q('#ttl_input'); if (i && busy === 0) { i.value = b.dataset.v; syncChips(); } }; });
        q('#ttl_input').oninput = syncChips;
        q('#ttl_input').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } };
      },
      init: initGuard(() => refresh(true)),
      ensureScript: () => ensureHelper(SCRIPT, TTL_SCRIPT),
      refresh: () => refresh(false),
      state: () => ttlState,
      reapply: async (ttl) => {
        if (!validTtl(Number(ttl))) throw new Error('No valid saved TTL to re-apply. Apply a TTL first');
        await runRoot(`rm -f ${DIR}/bpfttl`);
        const i = q('#ttl_input');
        if (i) i.value = ttl;
        await applyRule();
      },
      diagnose,
      setBoot: async (want) => { if ((await isBootOn()) !== want) await toggleBoot(); },
      stopAll: async () => {
        await installScript();
        await stopHelper(SCRIPT);
      },
      setup: async (fallbackTtl) => {
        const sv = await runRoot(`sed -n 's/^TTL=//p' ${CONF} 2>/dev/null | head -n 1`);
        const saved = Number(sv.text);
        const i = q('#ttl_input');
        if (i) i.value = validTtl(saved) ? saved : fallbackTtl;
        await applyRule();
        for (let k = 0; k < 3 && !ttlState.on; k++) { await sleep(800); await refresh(true); }
        if (!ttlState.on) throw new Error(`The TTL rule did not apply (status: ${ttlState.text || 'unknown'}). The rest was skipped`);
        if (!(await isBootOn())) await toggleBoot();
      },
    };
  })();

  const dpiModule = (() => {
    const DIR = '/data/local/ufi_dpi';
    const SCRIPT = `${DIR}/dpi.sh`;
    const CONF = `${DIR}/dpi.conf`;
    const BOOT_LINE = `sh ${SCRIPT} start >/dev/null 2>&1 &`;

    let lastState = { active: false, any: false, quic: false, mss: 0, boot: false, dns: '', nfq: false, working: false };
    const validIPv4 = (v) => {
      const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
      if (!m) return false;
      const parts = m.slice(1);
      if (parts.some((x) => x.length > 1 && x[0] === '0')) return false;
      const o = parts.map(Number);
      return o.every((n) => n <= 255) && o[0] !== 0 && o[0] !== 127 && o[0] < 224;
    };
    const validMss = (n) => Number.isInteger(n) && (n === 0 || (n >= 536 && n <= 1460));
    const NFQ_RESERVED = ['qnum', 'daemon', 'pidfile', 'debug'];
    const nfqArgsReserved = (v) => String(v).split(/\s+/).some((t) => {
      const m = t.match(/^--([A-Za-z0-9-]*)/);
      const n = m ? m[1] : '';
      if (!n) return false;
      return NFQ_RESERVED.some((r) => r.startsWith(n)) || (n.length >= 13 && 'dpi-desync-fwmark'.startsWith(n));
    });
    const validNfqArgs = (v) => /^[A-Za-z0-9=,._:\/\- ]{0,300}$/.test(v) && !nfqArgsReserved(v);
    const NFQ_REPLY_NOTE = 'an autottl option in the arguments has no effect here: it needs the server\'s replies, but this plugin only queues outgoing packets to nfqws. Use a fixed value such as --dpi-desync-ttl=3 instead';
    const nfqNeedsReplies = (v) => /autottl/i.test(String(v));
    const confGet = (text, k) => (text.match(new RegExp(`^${k}='?([^'\\n]*)'?\\s*$`, 'm')) || [])[1] ?? '';

    const NFQWS_MAX_BYTES = 8 * 1024 * 1024;
    const NFQWS_CHUNK = 45000;

    const DPI_SCRIPT = String.raw`#!/system/bin/sh
# UFI anti-DPI helper: apply | remove | start | stop | status | watch
D=/data/local/ufi_dpi
CONF=$D/dpi.conf
PIDF=$D/watch.pid
NPID=$D/nfqws.pid
NSIG=$D/nfqws.sig
CH=UFI_DPI
NATCH=UFI_DPI_NAT
CH6=UFI_DPI6
V6F=$D/dpi6.built
QN=200
B=iptables
IV=${WATCH_INTERVAL}; case "$IV" in ''|*[!0-9]*|0) IV=30 ;; esac
W=""
if $B -w 5 -S >/dev/null 2>&1; then W="-w 5"; elif $B -w -S >/dev/null 2>&1; then W="-w"; fi
ipt() { $B $W "$@"; }
# IPv6 (best effort): same rules in ip6tables. HAVE6=0 when ip6tables is missing.
B6=ip6tables
HAVE6=0; command -v $B6 >/dev/null 2>&1 && HAVE6=1
W6=""
if [ "$HAVE6" = 1 ]; then
  if $B6 -w 5 -S >/dev/null 2>&1; then W6="-w 5"; elif $B6 -w -S >/dev/null 2>&1; then W6="-w"; fi
fi
ipt6() { $B6 $W6 "$@"; }
${LAN_SH}
BPFV="${BPF_TAG}"
${LOCK_SH}
lan_ifs() { for lfi in $LANIFS; do [ -d "/sys/class/net/$lfi" ] && echo "$lfi"; done; }
# True when every hotspot interface that exists right now has its DNS redirect rules (usb0 can appear later).
dns_ok() {
  for dki in $(lan_ifs); do
    ipt -t nat -C $NATCH -i "$dki" -p udp --dport 53 -j DNAT --to-destination "$DNSIP:53" 2>/dev/null || return 1
    ipt -t nat -C $NATCH -i "$dki" -p tcp --dport 53 -j DNAT --to-destination "$DNSIP:53" 2>/dev/null || return 1
  done
  return 0
}
load() {
  MSS=0; DNSIP=""; QUIC=0; NFQ=0; NFQARGS=""
  [ -f "$CONF" ] && . "$CONF"
  case "$MSS" in ''|*[!0-9]*) MSS=0 ;; esac
  case "$DNSIP" in *[!0-9.]*) DNSIP="" ;; esac
  calc_lan
}
# is_ours <text> <pid>: true only if the pid is alive AND its command line contains <text> (fixed string, not a pattern).
# The callers pass the full path of our nfqws ("$D/nfqws ", the trailing space ends the program name) or "dpi.sh watch",
# so an unrelated process that merely mentions "nfqws" or "dpi.sh" is never mistaken for ours (and never killed).
# Pid files survive reboots, so never trust a pid blindly.
is_ours() { [ -n "$2" ] && kill -0 "$2" 2>/dev/null && tr '\0' ' ' < "/proc/$2/cmdline" 2>/dev/null | grep -qF "$1"; }
nfq_running() { [ -f "$NPID" ] && is_ours "$D/nfqws " "$(cat "$NPID" 2>/dev/null)"; }
stop_nfq() {
  if [ -f "$NPID" ]; then
    p=$(cat "$NPID" 2>/dev/null)
    if is_ours "$D/nfqws " "$p"; then
      kill "$p" 2>/dev/null
      # Wait for the process to really exit (queue 200 must be free before a new nfqws binds it), then force it.
      snn=0
      while kill -0 "$p" 2>/dev/null && [ "$snn" -lt 20 ]; do
        sleep 0.1 2>/dev/null || sleep 1
        snn=$((snn+1))
      done
      kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null
    fi
    rm -f "$NPID"
  fi
  rm -f "$NSIG"
  return 0
}
# What the running nfqws was started with: queue, arguments and binary size. Apply keeps a running nfqws whose value still matches.
nfq_sig() { echo "$QN $NFQARGS $(wc -c < "$D/nfqws" 2>/dev/null)"; }
start_nfq() {
  [ -x "$D/nfqws" ] || { echo "nfqws binary missing at $D/nfqws"; return 1; }
  rm -f "$NPID"
  "$D/nfqws" --qnum=$QN --daemon --pidfile="$NPID" $NFQARGS || { echo "nfqws failed to start"; return 1; }
  # --daemon returns as soon as the process forks. Wait for the pid file, then make sure the process is still alive a moment later.
  stn=0
  while [ "$stn" -lt 20 ] && ! nfq_running; do
    sleep 0.1 2>/dev/null || sleep 1
    stn=$((stn+1))
  done
  if nfq_running; then
    sleep 0.4 2>/dev/null || sleep 1
    nfq_running && { nfq_sig > "$NSIG"; return 0; }
  fi
  echo "nfqws started but exited at once (wrong arguments, or queue $QN is already in use). Run Diagnose nfqws"
  return 1
}
# Used by Apply: leave nfqws alone when it already runs with the same settings, so the queue is never empty during an apply.
ensure_nfq() {
  if nfq_running && [ "$(cat "$NSIG" 2>/dev/null)" = "$(nfq_sig)" ]; then return 0; fi
  stop_nfq
  start_nfq
}
# Restart used by the keep-alive: under the apply lock, and only if nfqws is still not running (a button Apply may have started it).
restart_nfq() {
  if ! lock_take; then
    echo "could not acquire the shared firewall lock; nfqws restart was not run"
    return 1
  fi
  nfq_running || start_nfq
  rc=$?
  lock_free
  return $rc
}
clear_nat() {
  cnn=0
  while ipt -t nat -C PREROUTING -j $NATCH 2>/dev/null; do
    ipt -t nat -D PREROUTING -j $NATCH 2>/dev/null || break
    cnn=$((cnn+1)); [ "$cnn" -gt 20 ] && break
  done
  ipt -t nat -F $NATCH 2>/dev/null; ipt -t nat -X $NATCH 2>/dev/null
}
clear_rules() {
  crn=0
  while ipt -t mangle -C POSTROUTING -j $CH 2>/dev/null; do
    ipt -t mangle -D POSTROUTING -j $CH 2>/dev/null || break
    crn=$((crn+1)); [ "$crn" -gt 20 ] && break
  done
  ipt -t mangle -F $CH 2>/dev/null; ipt -t mangle -X $CH 2>/dev/null
  clear_nat
  clear6
  drop_new
  stop_nfq
  rm -f "$SIGF" "$SIGF.new"
  return 0
}
build_dns() {
  [ -n "$DNSIP" ] || return 0
  DRC=0
  ipt -t nat -N $NATCH
  # Queries addressed to the router itself (its own resolver, local names) are left alone: only DNS sent on to other
  # servers is redirected. Preferred: one addrtype rule. Fallback: one rule per router address of each hotspot interface.
  if ! ipt -t nat -A $NATCH -m addrtype --dst-type LOCAL -j RETURN 2>/dev/null; then
    got=0
    for bdi in $(lan_ifs); do
      for a in $(ip -4 -o addr show dev "$bdi" 2>/dev/null | sed -n 's/.* inet \([0-9.]*\).*/\1/p'); do
        ipt -t nat -A $NATCH -i "$bdi" -d "$a" -j RETURN 2>/dev/null && got=1
      done
    done
    [ "$got" = 1 ] || echo "note: the router's own address could not be excluded from the DNS redirect, so queries to the router's resolver are redirected too"
  fi
  ifs=$(lan_ifs)
  if [ -z "$ifs" ]; then echo "no hotspot interface found for the DNS redirect"; DRC=1; fi
  for bdi in $ifs; do
    ipt -t nat -A $NATCH -i "$bdi" -p udp --dport 53 -j DNAT --to-destination "$DNSIP:53" || { echo "DNS udp rule failed on $bdi"; DRC=1; }
    ipt -t nat -A $NATCH -i "$bdi" -p tcp --dport 53 -j DNAT --to-destination "$DNSIP:53" || { echo "DNS tcp rule failed on $bdi"; DRC=1; }
  done
  ipt -t nat -I PREROUTING 1 -j $NATCH || DRC=1
  return $DRC
}
# add_nfq <ipt|ipt6> <chain>: queue the first packets of outgoing HTTPS to nfqws. The exclusion of nfqws's own packets (fwmark
# 0x40000000) is mandatory: without it the packets nfqws injects would be queued again. The connbytes match is optional.
add_nfq() {
  A=$1; C=$2
  NM="-m mark ! --mark 0x40000000/0x40000000"
  $A -t mangle -A $C -p tcp --dport 443 $NM -m connbytes --connbytes 1:6 --connbytes-mode packets --connbytes-dir original -j NFQUEUE --queue-num $QN --queue-bypass 2>/dev/null && return 0
  if $A -t mangle -A $C -p tcp --dport 443 $NM -j NFQUEUE --queue-num $QN --queue-bypass 2>/dev/null; then
    echo "note: the connbytes match is missing on this kernel ($C), so ALL outgoing HTTPS packets go to nfqws (slower, but works)"
    return 0
  fi
  return 1
}
clear6() {
  rm -f "$V6F"
  [ "$HAVE6" = 1 ] || return 0
  c6n=0
  while ipt6 -t mangle -C POSTROUTING -j $CH6 2>/dev/null; do
    ipt6 -t mangle -D POSTROUTING -j $CH6 2>/dev/null || break
    c6n=$((c6n+1)); [ "$c6n" -gt 20 ] && break
  done
  ipt6 -t mangle -F $CH6 2>/dev/null; ipt6 -t mangle -X $CH6 2>/dev/null
  return 0
}
# IPv6 counterpart of the MSS / QUIC / NFQUEUE rules. Best effort: it never fails the apply, because many mobile kernels have no
# (or only a partial) ip6tables. The marker file holds the rule count, then (v65) the features that were really built ("mss", "quic",
# "nfq"), e.g. "5 mss quic". The keep-alive uses the count to tell when the chain was flushed and the words to know which rules it may demand.
build6() {
  B6FAIL=0
  rm -f "$V6F"
  [ "$HAVE6" = 1 ] || return 0
  [ "$MSS" -gt 0 ] || [ "$QUIC" = 1 ] || [ "$NFQ" = 1 ] || return 0
  ipt6 -t mangle -N $CH6 2>/dev/null || { echo "note: IPv6 rules skipped (ip6tables mangle table is not usable)"; B6FAIL=1; return 0; }
  ok6=1; any6=0; f6=""
  for b6i in $LANIFS; do ipt6 -t mangle -A $CH6 -o "$b6i" -j RETURN 2>/dev/null || ok6=0; done
  if [ "$ok6" = 0 ]; then
    B6FAIL=1
    echo "note: IPv6 rules skipped (could not add the hotspot-interface rules)"
    ipt6 -t mangle -F $CH6 2>/dev/null; ipt6 -t mangle -X $CH6 2>/dev/null
    return 0
  fi
  if [ "$MSS" -gt 0 ]; then
    # IPv6 headers are 20 bytes longer than IPv4 ones, so the same packet size means an MSS 20 lower.
    M6=$((MSS-20)); [ "$M6" -lt 516 ] && M6=516
    if ipt6 -t mangle -A $CH6 -p tcp --tcp-flags SYN,RST SYN -m tcpmss --mss "$((M6+1)):65535" -j TCPMSS --set-mss "$M6" 2>/dev/null \
      || ipt6 -t mangle -A $CH6 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss "$M6" 2>/dev/null; then any6=1; f6="$f6 mss"
    else echo "note: IPv6 TCP MSS rule failed (IPv4 is not affected)"; B6FAIL=1; fi
  fi
  if [ "$QUIC" = 1 ]; then
    if ipt6 -t mangle -A $CH6 -p udp --dport 443 -j DROP 2>/dev/null; then any6=1; f6="$f6 quic"
    else echo "note: IPv6 QUIC rule failed (IPv4 is not affected)"; B6FAIL=1; fi
  fi
  # Only when the IPv4 queue rule exists (so nfqws is really running and wanted).
  if [ "$NFQ" = 1 ] && chain_has NFQUEUE; then
    if add_nfq ipt6 $CH6; then any6=1; f6="$f6 nfq"
    else echo "note: IPv6 HTTPS is not sent to nfqws (the IPv6 NFQUEUE rule failed). IPv4 is not affected"; B6FAIL=1; fi
  fi
  if [ "$any6" = 0 ]; then
    ipt6 -t mangle -F $CH6 2>/dev/null; ipt6 -t mangle -X $CH6 2>/dev/null
    return 0
  fi
  pos=1
  tn=$(ipt6 -t mangle -S POSTROUTING 2>/dev/null | grep '^-A' | grep -n -e '-j UFI_TTL$' | head -n 1 | cut -d: -f1)
  [ -n "$tn" ] && pos=$((tn+1))
  if ipt6 -t mangle -I POSTROUTING "$pos" -j $CH6 2>/dev/null; then
    echo "$(ipt6 -t mangle -S $CH6 2>/dev/null | grep -c '^-A')$f6" > "$V6F"
  else
    B6FAIL=1
    echo "note: IPv6 rules could not be linked (IPv4 is not affected)"
    ipt6 -t mangle -F $CH6 2>/dev/null; ipt6 -t mangle -X $CH6 2>/dev/null
  fi
  return 0
}
# Apply builds the new rules next to the running ones and swaps them in, so traffic is never left unshaped.
# <ipt|ipt6> <table> <hook> <chain>: unlink the chain, empty it and delete it.
drop_chain() {
  A=$1; dcn=0
  while $A -t $2 -C $3 -j $4 2>/dev/null; do
    $A -t $2 -D $3 -j $4 2>/dev/null || break
    dcn=$((dcn+1)); [ "$dcn" -gt 20 ] && break
  done
  $A -t $2 -F $4 2>/dev/null; $A -t $2 -X $4 2>/dev/null
  return 0
}
# Leftovers of an apply that was interrupted halfway (the new chains carry the suffix _N).
drop_new() {
  drop_chain ipt mangle POSTROUTING $CH"_N"
  drop_chain ipt nat PREROUTING $NATCH"_N"
  [ "$HAVE6" = 1 ] && drop_chain ipt6 mangle POSTROUTING $CH6"_N"
  rm -f "$V6F.new"
  return 0
}
# True when this kernel can rename a chain (iptables -E), which the swap needs. Tested with a throw-away chain.
# Optional argument: ipt (default) or ipt6.
can_swap() {
  A=$1; [ -n "$A" ] || A=ipt
  T1=$CH"_T"; T2=$CH"_U"
  $A -t mangle -F $T1 2>/dev/null; $A -t mangle -X $T1 2>/dev/null
  $A -t mangle -F $T2 2>/dev/null; $A -t mangle -X $T2 2>/dev/null
  $A -t mangle -N $T1 2>/dev/null || return 1
  $A -t mangle -E $T1 $T2 2>/dev/null; r=$?
  $A -t mangle -F $T1 2>/dev/null; $A -t mangle -X $T1 2>/dev/null
  $A -t mangle -F $T2 2>/dev/null; $A -t mangle -X $T2 2>/dev/null
  return $r
}
# <ipt|ipt6> <table> <hook> <old> <new>: the new chain is already linked in front of the old one. Remove the old chain, then give the new one its name.
swap_chain() {
  drop_chain $1 $2 $3 $4
  if $1 -t $2 -S $5 >/dev/null 2>&1; then $1 -t $2 -E $5 $4 2>/dev/null || echo "note: could not rename $5 to $4"; fi
  return 0
}
# Builds every rule with the chain names currently in CH, NATCH and CH6.
build_all() {
  RC=0; MFAIL=0; NFAIL=0
  ipt -t mangle -N $CH || return 1
  # Only traffic leaving towards the mobile network is shaped; packets going out to hotspot clients are skipped.
  for bli in $LANIFS; do ipt -t mangle -A $CH -o "$bli" -j RETURN || { RC=1; MFAIL=1; }; done
  if [ "$MSS" -gt 0 ]; then
    # Only lower the MSS (match values above the target), never raise it above what the endpoints negotiated.
    ipt -t mangle -A $CH -p tcp --tcp-flags SYN,RST SYN -m tcpmss --mss "$((MSS+1)):65535" -j TCPMSS --set-mss "$MSS" 2>/dev/null \
      || { echo "note: the tcpmss match is missing on this kernel, so the MSS is forced to $MSS and may also be raised"
           ipt -t mangle -A $CH -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss "$MSS" || { echo "TCPMSS failed"; RC=1; MFAIL=1; }; }
  fi
  if [ "$QUIC" = 1 ]; then
    ipt -t mangle -A $CH -p udp --dport 443 -j DROP || { echo "QUIC rule failed"; RC=1; MFAIL=1; }
  fi
  if [ "$NFQ" = 1 ]; then
    ensure_nfq || { RC=1; MFAIL=1; }
    if ! add_nfq ipt $CH; then
      echo "NFQUEUE rule failed: this kernel needs the NFQUEUE target and the mark match (nfqws's own packets must not be queued again), so nfqws is not used"
      RC=1; MFAIL=1
      stop_nfq
    fi
  fi
  # Link after the TTL chain (when present): packets accepted back from NFQUEUE skip the rest of this table.
  pos=1
  tn=$(ipt -t mangle -S POSTROUTING 2>/dev/null | grep '^-A' | grep -n -e '-j UFI_TTL$' | head -n 1 | cut -d: -f1)
  [ -n "$tn" ] && pos=$((tn+1))
  ipt -t mangle -I POSTROUTING "$pos" -j $CH || RC=1
  build6
  build_dns || { RC=1; NFAIL=1; }
  return $RC
}
# v61: a new chain that was built with a failed rule must not replace a running chain that has more rules, or a one-off failure
# (for example a busy iptables lock) would swap a complete set for an incomplete one. rule_count <ipt|ipt6> <table> <chain>: rules in a
# chain (0 if it does not exist). keep_old <failed 0|1> <ipt|ipt6> <table> <hook> <old> <new>: true when the new chain had a failure and
# the running chain is still linked and holds more rules. A first apply, or a new chain that is as complete as the old one, still swaps.
rule_count() { $1 -t $2 -S $3 2>/dev/null | grep -c '^-A'; }
# v62: the running chain is only kept when it was built from the SAME settings that are saved now. Otherwise a changed value (for example
# MSS 1360 -> 1400) plus one unrelated failed rule left the old value running, and nothing noticed. sig_now is the settings that decide
# what the chains contain; write_sig stores it after every build that replaced the chains (dpi.sig). No dpi.sig (an older version built the
# chain) means "unknown", so nothing is kept and the new chain is swapped in, as before v61.
SIGF=$D/dpi.sig
sig_now() { echo "$MSS|$QUIC|$NFQ|$NFQARGS|$DNSIP|$LANIFS"; }
write_sig() { sig_now > "$SIGF.new" 2>/dev/null && mv -f "$SIGF.new" "$SIGF"; return 0; }
keep_old() {
  [ "$1" = 1 ] || return 1
  [ "$(cat "$SIGF" 2>/dev/null)" = "$(sig_now)" ] || return 1
  $2 -t $3 -C $4 -j $5 2>/dev/null || return 1
  [ "$(rule_count $2 $3 $5)" -gt "$(rule_count $2 $3 $6)" ]
}
apply_swap() {
  drop_new
  OCH=$CH; ONAT=$NATCH; OCH6=$CH6; OV6F=$V6F
  CH=$OCH"_N"; NATCH=$ONAT"_N"; CH6=$OCH6"_N"; V6F=$OV6F".new"
  build_all; rc=$?
  NCH=$CH; NNAT=$NATCH; NCH6=$CH6
  CH=$OCH; NATCH=$ONAT; CH6=$OCH6; V6F=$OV6F
  # The new chain must exist and be linked. If not, the rules that are running stay exactly as they are.
  if ! ipt -t mangle -C POSTROUTING -j $NCH 2>/dev/null; then
    echo "the new rules could not be linked, so the current rules were kept"
    drop_new
    return 1
  fi
  if keep_old "$MFAIL" ipt mangle POSTROUTING $CH $NCH; then
    echo "the new firewall rules were incomplete, so the running firewall rules were kept"
    drop_chain ipt mangle POSTROUTING $NCH
  else
    swap_chain ipt mangle POSTROUTING $CH $NCH
  fi
  if [ -z "$DNSIP" ]; then
    swap_chain ipt nat PREROUTING $NATCH $NNAT
  elif ipt -t nat -C PREROUTING -j $NNAT 2>/dev/null; then
    if keep_old "$NFAIL" ipt nat PREROUTING $NATCH $NNAT; then
      echo "the new DNS redirect was incomplete, so the running DNS redirect was kept"
      drop_chain ipt nat PREROUTING $NNAT
    else
      swap_chain ipt nat PREROUTING $NATCH $NNAT
    fi
  else
    drop_chain ipt nat PREROUTING $NNAT
  fi
  if [ "$HAVE6" = 1 ]; then
    if can_swap ipt6; then
      if [ -f "$V6F" ] && keep_old "$B6FAIL" ipt6 mangle POSTROUTING $CH6 $NCH6; then
        echo "note: the new IPv6 rules were incomplete, so the running IPv6 rules were kept"
        drop_chain ipt6 mangle POSTROUTING $NCH6
        rm -f "$V6F.new"
      else
        swap_chain ipt6 mangle POSTROUTING $CH6 $NCH6
        if [ -f "$V6F.new" ]; then mv -f "$V6F.new" "$V6F"; else rm -f "$V6F"; fi
      fi
    else
      # ip6tables cannot rename chains (the check above only covered iptables): rebuild IPv6 under its normal name instead.
      drop_chain ipt6 mangle POSTROUTING $NCH6
      rm -f "$V6F.new"
      clear6; build6
    fi
  fi
  [ "$NFQ" = 1 ] || stop_nfq
  # Every part either was swapped to the new chain or (same settings only) kept, so the stored settings are now the live ones.
  write_sig
  return $rc
}
apply_inner() {
  load
  if can_swap; then
    apply_swap
  else
    clear_rules
    build_all; rc=$?
    write_sig
    return $rc
  fi
}
apply() {
  if ! lock_take; then
    echo "could not acquire the shared firewall lock; Anti-DPI apply was not run"
    return 1
  fi
  apply_inner; rc=$?
  lock_free
  return $rc
}
# Repairs for the keep-alive use the same build-then-swap method, so a repair never removes a rule that still works.
swap_dns() {
  can_swap || { clear_nat; build_dns; return $?; }
  ONAT=$NATCH
  drop_chain ipt nat PREROUTING $ONAT"_N"
  NATCH=$ONAT"_N"
  build_dns; rc=$?
  NNAT=$NATCH; NATCH=$ONAT
  nf=0; [ "$rc" -eq 0 ] || nf=1
  if [ -z "$DNSIP" ]; then
    swap_chain ipt nat PREROUTING $NATCH $NNAT
  elif ipt -t nat -C PREROUTING -j $NNAT 2>/dev/null; then
    if keep_old "$nf" ipt nat PREROUTING $NATCH $NNAT; then
      # The new redirect is missing a rule that the running one has: keep what is running.
      drop_chain ipt nat PREROUTING $NNAT
    else
      swap_chain ipt nat PREROUTING $NATCH $NNAT
    fi
  else
    # The new redirect could not be linked: keep what is running.
    drop_chain ipt nat PREROUTING $NNAT
  fi
  return $rc
}
swap6() {
  [ "$HAVE6" = 1 ] || return 0
  can_swap ipt6 || { clear6; build6; return 0; }
  OCH6=$CH6; OV6F=$V6F
  drop_chain ipt6 mangle POSTROUTING $OCH6"_N"
  rm -f "$OV6F.new"
  CH6=$OCH6"_N"; V6F=$OV6F".new"
  build6
  NCH6=$CH6; CH6=$OCH6; V6F=$OV6F
  # The new chain could not be built or linked while IPv6 rules are wanted and the running chain is still linked: keep what is running
  # (it is only dropped when nothing is linked, or when no IPv6 rules are wanted any more).
  if ! ipt6 -t mangle -C POSTROUTING -j $NCH6 2>/dev/null && { [ "$MSS" -gt 0 ] || [ "$QUIC" = 1 ] || [ "$NFQ" = 1 ]; } \
    && [ -f "$V6F" ] && ipt6 -t mangle -C POSTROUTING -j $CH6 2>/dev/null; then
    drop_chain ipt6 mangle POSTROUTING $NCH6
    rm -f "$V6F.new"
    return 0
  fi
  # The new chain is linked but a rule could not be built and the running chain has more rules: keep what is running.
  if [ -f "$V6F" ] && keep_old "$B6FAIL" ipt6 mangle POSTROUTING $CH6 $NCH6; then
    drop_chain ipt6 mangle POSTROUTING $NCH6
    rm -f "$V6F.new"
    return 0
  fi
  # No linked new chain here means build6 decided there should be none, as clear6 + build6 would have left it.
  swap_chain ipt6 mangle POSTROUTING $CH6 $NCH6
  if [ -f "$V6F.new" ]; then mv -f "$V6F.new" "$V6F"; else rm -f "$V6F"; fi
  return 0
}
running() { [ -f "$PIDF" ] && is_ours "dpi.sh watch" "$(cat "$PIDF" 2>/dev/null)"; }
stop() {
  if [ -f "$PIDF" ]; then
    p=$(cat "$PIDF" 2>/dev/null)
    if is_ours "dpi.sh watch" "$p"; then
      kill "$p" 2>/dev/null || :
      sw=0
      while [ "$sw" -lt 30 ] && kill -0 "$p" 2>/dev/null; do sleep 0.1 2>/dev/null || sleep 1; sw=$((sw+1)); done
      if kill -0 "$p" 2>/dev/null; then echo "watcher did not stop (pid $p)"; return 1; fi
    fi
    [ "$(cat "$PIDF" 2>/dev/null)" = "$p" ] && rm -f "$PIDF"
  fi
  return 0
}
start() {
  running && return 0
  if [ -f "$PIDF" ]; then
    oldp=$(cat "$PIDF" 2>/dev/null)
    is_ours "dpi.sh watch" "$oldp" && { echo "watcher process exists but status check failed"; return 1; }
    rm -f "$PIDF"
  fi
  if command -v setsid >/dev/null 2>&1; then
    setsid sh "$0" watch </dev/null >/dev/null 2>&1 &
  else
    sh "$0" watch </dev/null >/dev/null 2>&1 &
  fi
  sw=0
  while [ "$sw" -lt 30 ]; do
    running && return 0
    sleep 0.1 2>/dev/null || sleep 1
    sw=$((sw+1))
  done
  echo "watcher did not become healthy within startup window"
  return 1
}
chain_has() { ipt -t mangle -S $CH 2>/dev/null | grep -q -e "$1"; }
mangle_ok() {
  ipt -t mangle -C POSTROUTING -j $CH 2>/dev/null || return 1
  # v57: every hotspot interface needs its "-o <if> -j RETURN" skip rule (a chain built by an older version can lack br0, which an
  # older version wrongly counted as the uplink). Without this check the keep-alive called such a chain healthy and never rebuilt it.
  for mgi in $LANIFS; do ipt -t mangle -C $CH -o "$mgi" -j RETURN 2>/dev/null || return 1; done
  # The jump can survive while the rules inside the chain were flushed: check that each enabled feature still has its rule.
  # v62: compare the VALUE, not only that a rule exists, and treat a rule that should be off but is still there as unhealthy. A chain
  # that was kept after a failed Apply (see keep_old) can otherwise run MSS 1360 while 1400 is saved, or keep blocking QUIC after it was
  # switched off, and the keep-alive would call it healthy. Both the tcpmss-match and the forced-value forms end in "--set-mss <value>".
  if [ "$MSS" -gt 0 ]; then chain_has "--set-mss $MSS\$" || return 1; else chain_has TCPMSS && return 1; fi
  if [ "$QUIC" = 1 ]; then chain_has '--dport 443 -j DROP' || return 1; else chain_has '--dport 443 -j DROP' && return 1; fi
  if [ "$NFQ" = 1 ]; then chain_has NFQUEUE || return 1; else chain_has NFQUEUE && return 1; fi
  return 0
}
dns_healthy() {
  [ -n "$DNSIP" ] || return 0
  ipt -t nat -C PREROUTING -j $NATCH 2>/dev/null || return 1
  dns_ok
}
# IPv6 chain: checked only when it was built (marker file), so a kernel without working ip6tables never causes endless rebuilds.
# has6 <feature>: true when the marker lists the feature as built (FL6 is set by mangle6_ok).
has6() { case " $FL6 " in *" $1 "*) return 0 ;; esac; return 1; }
mangle6_ok() {
  [ -f "$V6F" ] || return 0
  [ "$HAVE6" = 1 ] || return 0
  ipt6 -t mangle -C POSTROUTING -j $CH6 2>/dev/null || return 1
  c6=$(ipt6 -t mangle -S $CH6 2>/dev/null); have6=$(echo "$c6" | grep -c '^-A')
  # The marker is the rule count followed by the features build6 really built, e.g. "5 mss quic" (v65).
  set -- $(cat "$V6F" 2>/dev/null)
  # v65.1: an empty marker file (a write cut short) has nothing to shift, and a shell that exits on a failed shift (dash, busybox ash)
  # would stop the keep-alive. With no words the count is empty, so the chain is called unhealthy and rebuilt.
  want6=$1; [ $# -gt 0 ] && shift
  if [ $# -gt 0 ]; then
    FL6="$*"
  else
    # A marker written by v64 or earlier holds only the count. Work out what it meant the way v64 did: MSS was always demanded,
    # QUIC and NFQUEUE only when the count equals a complete chain. The next Apply or repair writes the new form.
    full=0; for m6i in $LANIFS; do full=$((full+1)); done
    FL6=""
    if [ "$MSS" -gt 0 ]; then full=$((full+1)); FL6="mss"; fi
    [ "$QUIC" = 1 ] && full=$((full+1))
    [ "$NFQ" = 1 ] && full=$((full+1))
    if [ "$want6" = "$full" ]; then
      [ "$QUIC" = 1 ] && FL6="$FL6 quic"
      [ "$NFQ" = 1 ] && FL6="$FL6 nfq"
    fi
  fi
  [ "$want6" = "$have6" ] || return 1
  # A rule that should be off but is there is always unhealthy. A rule that should be on is required only when build6 built it: if the
  # kernel could not build it (for example no IPv6 TCPMSS or NFQUEUE target) the chain is as complete as it can be, and demanding the
  # rule would only repeat a repair that cannot succeed. v63 and v64 did this for QUIC and NFQUEUE but always demanded the MSS rule.
  # The values are compared, not only the presence: a chain with the right number of rules but the wrong MSS is repaired.
  if [ "$MSS" -gt 0 ]; then
    if has6 mss; then
      M6=$((MSS-20)); [ "$M6" -lt 516 ] && M6=516
      echo "$c6" | grep -q -e "--set-mss $M6\$" || return 1
    fi
  else
    echo "$c6" | grep -q TCPMSS && return 1
  fi
  if [ "$QUIC" = 1 ]; then
    if has6 quic; then echo "$c6" | grep -q -e '--dport 443 -j DROP' || return 1; fi
  else
    echo "$c6" | grep -q -e '--dport 443 -j DROP' && return 1
  fi
  if [ "$NFQ" = 1 ]; then
    if has6 nfq; then echo "$c6" | grep -q NFQUEUE || return 1; fi
  else
    echo "$c6" | grep -q NFQUEUE && return 1
  fi
  return 0
}
heal6() {
  if ! lock_take; then
    echo "could not acquire the shared firewall lock; IPv6 repair was not run"
    return 1
  fi
  swap6; rc=$?
  lock_free
  return $rc
}
healthy() { mangle_ok && dns_healthy && mangle6_ok; }
heal_dns() {
  if ! lock_take; then
    echo "could not acquire the shared firewall lock; DNS repair was not run"
    return 1
  fi
  swap_dns; rc=$?
  lock_free
  return $rc
}
# Only what is broken gets rebuilt: a missing DNS redirect (for example usb0 appearing late) must not flush the MSS / QUIC / NFQUEUE rules or restart nfqws.
heal() {
  healthy && return 0
  if mangle_ok; then
    dns_healthy || heal_dns
    mangle6_ok || heal6
  else apply; fi
}
# One keep-alive step for the rules. A repair that keeps failing (for example a kernel without the NFQUEUE or TCPMSS target) is
# not repeated every cycle: after each failed repair wait 1, 2, 3, then 4 cycles, like the TTL script. A healthy setup resets it.
heal_step() {
  if healthy; then HF=0; HS=0; return 0; fi
  if [ "$HS" -gt 0 ]; then HS=$((HS-1)); return 0; fi
  heal
  if healthy; then HF=0; HS=0; else HF=$((HF+1)); HS=$HF; [ "$HS" -gt 4 ] && HS=4; fi
  return 0
}
# One keep-alive step for nfqws: restart it when it should run but does not, with a growing wait after failed starts.
nfq_step() {
  if [ "$NFQ" = 1 ] && ! nfq_running; then
    if [ "$NS" -gt 0 ]; then
      NS=$((NS-1))
    elif restart_nfq >/dev/null 2>&1; then
      NF=0
    else
      NF=$((NF+1)); NS=$NF; [ "$NS" -gt 4 ] && NS=4
    fi
  else
    NF=0; NS=0
  fi
}
wself() {
  wsp=$(cat "$PIDF" 2>/dev/null)
  if [ -z "$wsp" ]; then echo $$ > "$PIDF" 2>/dev/null
  elif [ "$wsp" != "$$" ]; then
    if is_ours "dpi.sh watch" "$wsp"; then exit 0; fi
    echo $$ > "$PIDF" 2>/dev/null
  fi
  return 0
}
watch() {
  running && exit 0
  # Exclusive create (noclobber): two simultaneous starts cannot both publish a PID file.
  if ! ( set -C; echo $$ > "$PIDF" ) 2>/dev/null; then
    running && exit 0
    rm -f "$PIDF"
    ( set -C; echo $$ > "$PIDF" ) 2>/dev/null || exit 1
  fi
  SP=""
  trap '[ -n "$SP" ] && kill "$SP" 2>/dev/null; [ "$(cat "$PIDF" 2>/dev/null)" = "$$" ] && rm -f "$PIDF"; exit 0' TERM INT HUP
  # Start-up: only rebuild when the rules are missing (a restart right after Apply must not flush them again).
  load
  heal >/dev/null 2>&1
  # NF = failed starts in a row, NS = cycles still to skip. After a failed start wait 1, 2, 3, then 4 cycles (about 2 minutes at most).
  NF=0; NS=0; HF=0; HS=0
  if [ "$NFQ" = 1 ] && ! nfq_running; then restart_nfq >/dev/null 2>&1 || { NF=1; NS=1; }; fi
  # First minute: look every 3 s (a cheap check, same as the TTL script), so an interface such as usb0 that appears late
  # after boot gets its DNS redirect within seconds instead of after a full interval. nfqws is checked in the same cycle.
  # v65.1: the loop counter is WN, not n. Helper functions (drop_chain, clear6, restart_nfq ...) also use n and run inside this loop.
  WN=0
  while [ "$WN" -lt 20 ]; do
    sleep 3 & SP=$!
    wait $SP
    SP=""
    wself
    load
    heal_step >/dev/null 2>&1
    nfq_step
    WN=$((WN+1))
  done
  while :; do
    sleep "$IV" & SP=$!
    wait $SP
    SP=""
    wself
    load
    heal_step >/dev/null 2>&1
    # Only the nfqws process is restarted on its own; the firewall rules stay untouched.
    nfq_step
  done
}
remove_all() {
  stop
  if ! lock_take; then
    echo "could not acquire the shared firewall lock; Anti-DPI remove was not run"
    return 1
  fi
  clear_rules
  lock_free
  return 0
}
case "$1" in
  apply) apply ;;
  remove) remove_all; exit $? ;;
  start) start ;;
  stop) stop ;;
  status) if running; then echo running; else echo stopped; fi ;;
  watch) watch ;;
  *) echo "usage: $0 apply|remove|start|stop|status|watch"; exit 2 ;;
esac
`;

    const refresh = async (syncForm = false) => {
      const sess = session;
      const r = await runRoot(PRELUDE + String.raw`
# Real support probe: try each rule in a throw-away chain that nothing links to, then delete it.
probe() {
  ipt iptables -t mangle -F UFI_PROBE_$$ 2>/dev/null; ipt iptables -t mangle -X UFI_PROBE_$$ 2>/dev/null
  ipt iptables -t mangle -N UFI_PROBE_$$ 2>/dev/null || { echo 0; return; }
  if ipt iptables -t mangle -A UFI_PROBE_$$ "$@" 2>/dev/null; then echo 1; else echo 0; fi
  ipt iptables -t mangle -F UFI_PROBE_$$ 2>/dev/null; ipt iptables -t mangle -X UFI_PROBE_$$ 2>/dev/null
}
echo "@@NFQ_T=$(probe -p tcp --dport 443 -j NFQUEUE --queue-num 250 --queue-bypass)"
echo "@@MSS_T=$(probe -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1360)"
echo "@@CONN_T=$(probe -p tcp --dport 443 -m connbytes --connbytes 1:6 --connbytes-mode packets --connbytes-dir original -j RETURN)"
echo "@@NFQ_BIN=$([ -x ${DIR}/nfqws ] && echo 1 || echo 0)"
p=$(cat ${DIR}/nfqws.pid 2>/dev/null)
if [ -n "$p" ] && kill -0 "$p" 2>/dev/null && tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -qF "${DIR}/nfqws "; then echo "@@NFQ_RUN=1"; else echo "@@NFQ_RUN=0"; fi
echo "@@CH=$(ipt iptables -t mangle -C POSTROUTING -j UFI_DPI 2>/dev/null && echo 1 || echo 0)"
echo "@@NATCH=$(ipt iptables -t nat -C PREROUTING -j UFI_DPI_NAT 2>/dev/null && echo 1 || echo 0)"
if grep -qE '${bootLineRe(SCRIPT)}' ${BOOT_FILE} 2>/dev/null; then BOOTON=1; else BOOTON=0; fi
echo "@@BOOT=$BOOTON"
echo "@@WATCH=$([ -f ${SCRIPT} ] && sh ${SCRIPT} status 2>/dev/null || echo stopped)"
echo "@@CONF_BEGIN=1"
cat ${CONF} 2>/dev/null
`);
      if (sess !== session) return;
      const confStart = r.text.indexOf('@@CONF_BEGIN=1');
      const head = confStart >= 0 ? r.text.slice(0, confStart) : r.text;
      const conf = confStart >= 0 ? r.text.slice(confStart + '@@CONF_BEGIN=1'.length) : '';
      const st = parseStatus(head);
      const cv = (k) => confGet(conf, k);
      const get = (k) => st.kv[k];
      lastState = { active: get('CH') === '1', quic: cv('QUIC') === '1', mss: Number(cv('MSS') || 0), dns: get('NATCH') === '1' ? String(cv('DNSIP') || '') : '', nfq: get('NFQ_RUN') === '1' };
      lastState.working = (lastState.active && (lastState.mss > 0 || lastState.quic || lastState.nfq)) || get('NATCH') === '1';
      syncNfqBtn(true);

      put('#dpi_sup_mss', get('MSS_T') === '1' ? 'bp-good' : 'bp-bad', get('MSS_T') === '1' ? 'Supported' : 'Not supported');
      put('#dpi_sup_nfq', get('NFQ_T') === '1' ? 'bp-good' : 'bp-bad', get('NFQ_T') === '1' ? 'Supported' : 'Not supported');
      const connNote = q('#dpi_conn_note');
      if (connNote) connNote.style.display = get('NFQ_T') === '1' && get('CONN_T') === '0' ? '' : 'none';
      put('#dpi_bin', get('NFQ_BIN') === '1' ? 'bp-good' : 'bp-warn', get('NFQ_BIN') === '1' ? 'Found' : 'Not found');
      put('#dpi_run', get('NFQ_RUN') === '1' ? 'bp-good' : 'bp-warn', get('NFQ_RUN') === '1' ? 'Running' : 'Stopped');
      put('#dpi_active', get('CH') === '1' ? 'bp-good' : 'bp-bad', get('CH') === '1' ? 'Active' : 'Not active');
      put('#dpi_dns_active', get('NATCH') === '1' ? 'bp-good' : 'bp-warn', get('NATCH') === '1' ? 'Active' : 'Off');
      const boot = get('BOOT') === '1';
      lastState.boot = boot;
      put('#dpi_boot', boot ? 'bp-good' : 'bp-warn', boot ? 'Enabled' : 'Disabled');
      q('#dpi_boot_toggle')?.classList.toggle('bp-on', boot);
      const parts = [];
      if (get('CH') === '1') parts.push('firewall rules');
      if (get('NATCH') === '1') parts.push('DNS redirect');
      if (get('NFQ_RUN') === '1') parts.push('nfqws');
      lastState.any = parts.length > 0;
      const heroEl = q('#dpi_hero');
      if (heroEl) {
        heroEl.className = `bp-hero ${parts.length ? 'on' : 'off'}`;
        heroEl.textContent = parts.length ? `● Anti-DPI active: ${parts.join(', ')}` : '● Anti-DPI not active';
      }
      markSw('dpi', parts.length ? 'dpi_apply' : 'dpi_remove');
      const watching = get('WATCH') === 'running';
      put('#dpi_watch', watching ? 'bp-good' : 'bp-warn', watching ? 'Running' : (boot ? 'Stopped' : 'Off'));

      if (syncForm) {
        const set = (sel, fn) => { const el = q(sel); if (el) fn(el); };
        const sv = parseConf(conf).saved;
        set('#dpi_mss', (el) => { el.value = sv.mss || 0; });
        set('#dpi_dns', (el) => { el.value = sv.dns; });
        set('#dpi_quic', (el) => { el.checked = sv.quic === 1; });
        set('#dpi_nfq', (el) => { el.checked = sv.nfq === 1; });
        set('#dpi_adv', (el) => { if (sv.nfq === 1) el.open = true; });
        set('#dpi_args', (el) => { el.value = sv.args; });
        syncChips();
      }
    };

    const readSettings = () => {
      const mss = Number(q('#dpi_mss')?.value || 0);
      if (!validMss(mss)) throw new Error('TCP MSS must be 0 (off) or between 536 and 1460');
      const dns = String(q('#dpi_dns')?.value || '').trim();
      if (dns && !validIPv4(dns)) throw new Error('DNS must be a normal IPv4 address (no leading zeros; not 0.x, 127.x or 224 and up), or empty to turn it off');
      const args = String(q('#dpi_args')?.value || '').replace(/\s+/g, ' ').trim();
      if (!validNfqArgs(args)) throw new Error('nfqws arguments may only contain letters, numbers and = , . _ : / - and spaces (--qnum, --daemon and --pidfile are set by the plugin; --debug and --dpi-desync-fwmark are not allowed)');
      return { mss, dns, quic: q('#dpi_quic')?.checked ? 1 : 0, nfq: q('#dpi_nfq')?.checked ? 1 : 0, args };
    };

    const installScript = async () => {
      await installHelper(SCRIPT, DPI_SCRIPT);
    };
    const isBootOn = async () => (await runRoot(bootCheckCmd(SCRIPT))).text.includes('YES');
    const confText = (s, stash = null) => `MSS='${s.mss}'\nDNSIP='${s.dns}'\nQUIC='${s.quic}'\nNFQ='${s.nfq}'\nNFQARGS='${s.args}'\n`
      + (stash ? [['SMSS', stash.mss], ['SDNS', stash.dns], ['SQUIC', stash.quic], ['SNFQ', stash.nfq]]
        .filter(([, v]) => v !== undefined).map(([k, v]) => `${k}='${v}'\n`).join('') : '');
    const isEmpty = (s) => !s.mss && !s.dns && !s.quic && !s.nfq;

    const parseConf = (text) => {
      const has = (k) => new RegExp(`^${k}=`, 'm').test(text);
      const num = (v) => { const n = Number(v || 0); return validMss(n) ? n : 0; };
      const ip = (v) => (validIPv4(v) ? v : '');
      const flag = (v) => (v === '1' ? 1 : 0);
      const args = confGet(text, 'NFQARGS');
      const active = { mss: num(confGet(text, 'MSS')), dns: ip(confGet(text, 'DNSIP')), quic: flag(confGet(text, 'QUIC')), nfq: flag(confGet(text, 'NFQ')), args: validNfqArgs(args) ? args : '' };
      const stash = {};
      if (has('SMSS')) stash.mss = num(confGet(text, 'SMSS'));
      if (has('SDNS')) stash.dns = ip(confGet(text, 'SDNS'));
      if (has('SQUIC')) stash.quic = flag(confGet(text, 'SQUIC'));
      if (has('SNFQ')) stash.nfq = flag(confGet(text, 'SNFQ'));
      return { active, saved: { ...active, ...stash }, stash: Object.keys(stash).length ? stash : null };
    };
    const readConf = async () => parseConf((await runRoot(`cat ${CONF} 2>/dev/null`)).text);
    const loadSaved = async () => (await readConf()).saved;
    const stashOf = (saved, live) => {
      const o = {};
      for (const k of ['mss', 'dns', 'quic', 'nfq']) if (saved[k] !== live[k]) o[k] = saved[k];
      return Object.keys(o).length ? o : null;
    };
    const stashWithout = (st, k) => {
      if (!st) return null;
      const o = { ...st }; delete o[k];
      return Object.keys(o).length ? o : null;
    };

    let nfqRolledBack = false;
    const setNfqMsg = (text, kind = '') => {
      const el = q('#dpi_nfq_msg');
      if (!el) return;
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      el.textContent = `${t}  ${text}`;
      el.style.color = kind === 'good' ? '#64e6a4' : kind === 'bad' ? '#ff8a8a' : kind === 'warn' ? '#ffd479' : '';
      el.style.opacity = '1';
    };
    const netTest = async () => {
      const r = await runRoot(`ok=0; m=ping
if command -v curl >/dev/null 2>&1; then m=https; curl -s -m 8 -o /dev/null https://www.cloudflare.com/cdn-cgi/trace && ok=1
else ping -c 2 -W 3 ${PING_IP} >/dev/null 2>&1 && ok=1; fi
echo NET=$ok M=$m`, 25000);
      const mm = r.text.match(/NET=(\d) M=(\w+)/);
      return { ok: Boolean(mm && mm[1] === '1'), method: mm ? mm[2] : 'ping' };
    };
    const disableNfq = async (settings, stash = null, inactive = false) => {
      const keep = { ...settings, nfq: 0 };
      const c = await runRoot(`${writeFile(CONF, confText(keep, stash))} && echo SAVED`);
      if (!c.text.includes('SAVED')) throw new Error('Could not save settings');
      if (inactive || isEmpty(keep)) await runRemove(SCRIPT);
      else await runRoot(`sh ${SCRIPT} apply 2>&1`, 40000);
      if (await isBootOn()) await runRoot(`sh ${SCRIPT} stop; sh ${SCRIPT} start`);
    };
    const turnNfqOff = async () => {
      await refresh(false);
      const c = await readConf();
      const stash = stashWithout(c.stash, 'nfq');
      if (lastState.working) await disableNfq(c.active, stash);
      else await disableNfq(c.active, stash, true);
    };
    const stopNfqNow = async () => {
      await installScript();
      await turnNfqOff();
      await refresh(true);
      toast('nfqws turned off', 'green', 4000);
    };

    const applyRules = async (override = null, stash = null) => {
      const s = override || readSettings();
      markSw('dpi', 'dpi_apply');
      await installScript();
      const c = await runRoot(`${writeFile(CONF, confText(s, stash))} && echo SAVED`);
      if (!c.text.includes('SAVED')) throw new Error('Could not save settings');
      if (isEmpty(s)) return removeAll(!override);
      const base = s.nfq ? await netTest() : null;
      const r = await runRoot(`sh ${SCRIPT} apply 2>&1; echo RC=$?`, 40000);
      if (await isBootOn()) {
        try { await bootAdd(SCRIPT, BOOT_LINE); } catch (e) { toast(`Auto-apply at boot: ${e.message}`, 'orange', 9000); }
        await runRoot(`sh ${SCRIPT} stop; sh ${SCRIPT} start`);
      }
      await refresh(!override);
      if (s.nfq && base?.ok) {
        await sleep(3000);
        let t = await netTest();
        if (!t.ok) { await sleep(2500); t = await netTest(); }
        if (!t.ok) {
          await disableNfq(s, stash);
          await refresh(true);
          nfqRolledBack = true;
          setNfqMsg('The internet stopped working with these arguments, so nfqws was switched off again. Try other arguments.', 'bad');
          toast('Internet stopped working with these nfqws arguments, so nfqws was switched off again. Try different arguments.', 'red', 10000);
          return;
        }
        const rw = nfqNeedsReplies(s.args) ? ` Note: ${NFQ_REPLY_NOTE}.` : '';
        setNfqMsg((t.method === 'https' ? 'nfqws is on and HTTPS still works.' : 'nfqws is on. Only a ping was checked, so test your sites yourself.') + rw, t.method === 'https' && !rw ? 'good' : 'warn');
        toast(t.method === 'https' ? 'nfqws is on and HTTPS still works' : 'nfqws is on. Only a ping was checked here, so test your sites yourself', t.method === 'https' && !rw ? 'green' : 'orange', 6000);
      } else if (s.nfq && nfqNeedsReplies(s.args)) {
        setNfqMsg(`nfqws started. Note: ${NFQ_REPLY_NOTE}.`, 'warn');
      }
      if (/RC=0\s*$/.test(r.text)) toast('Anti-DPI rules applied', 'green', 4000);
      else toast(`Some rules failed: ${r.text.replace(/RC=\d+\s*$/, '').trim().slice(0, 200)}`, 'red', 9000);
    };

    let nfqKnown = false, nfqPending = '';
    function syncNfqBtn(fromStatus = false) {
      const b = q('#dpi_nfq_btn'); if (!b) return;
      if (fromStatus) nfqKnown = true;
      if (nfqPending) { b.textContent = nfqPending; b.classList.toggle('bp-danger', nfqPending === 'Stopping…'); return; }
      if (!nfqKnown) { b.textContent = '…'; return; }
      const on = !!lastState.nfq;
      b.textContent = on ? 'Stop' : 'Start';
      b.classList.toggle('bp-danger', on);
    }

    const nfqToggle = async (want) => {
      const box = q('#dpi_nfq');
      nfqRolledBack = false;
      try {
        if (!want) {
          setNfqMsg('Turning nfqws off…', 'warn');
          await stopNfqNow();
          setNfqMsg('nfqws is off.', 'good');
          return;
        }
        let args = String(q('#dpi_args')?.value || '').replace(/\s+/g, ' ').trim();
        if (!args) { args = (await loadSaved()).args; const ai = q('#dpi_args'); if (args && ai) ai.value = args; }
        if (!args) throw new Error('Type the nfqws arguments first, for example --dpi-desync=fake --dpi-desync-ttl=3');
        if (!validNfqArgs(args)) throw new Error('Arguments may only contain letters, numbers and = , . _ : / - and spaces, and may not use --qnum, --daemon, --pidfile, --debug or --dpi-desync-fwmark (not even shortened)');
        setNfqMsg('Checking the nfqws file…', 'warn');
        const b = await runRoot(`[ -x ${DIR}/nfqws ] && echo YES || echo NO`);
        if (!b.ok) throw new Error(`Cannot reach the device (${b.text || 'no answer'}). Reload the page and try again`);
        if (!b.text.includes('YES')) throw new Error('nfqws is not installed. Press "Import nfqws file" and choose your nfqws build first');
        await refresh(false);
        const cf = await readConf();
        let baseSettings, baseStash;
        if (lastState.working) { baseSettings = { ...cf.active }; baseStash = cf.stash; }
        else { baseSettings = { ...cf.saved, mss: 0, dns: '', quic: 0 }; baseStash = stashOf(cf.saved, baseSettings); }
        baseSettings.nfq = 1;
        baseSettings.args = args;
        baseStash = stashWithout(baseStash, 'nfq');
        setNfqMsg('Starting nfqws and testing the internet…', 'warn');
        await applyRules(baseSettings, baseStash);
        if (nfqRolledBack) return;
        if (lastState.nfq) { if (!/is on|Note:/.test(q('#dpi_nfq_msg')?.textContent || '')) setNfqMsg('nfqws is running.', 'good'); }
        else { setNfqMsg('nfqws did not start. Press "Diagnose nfqws" and send me the result.', 'bad'); if (box) box.checked = false; }
      } catch (e) {
        setNfqMsg(`Failed: ${e?.message || e}`, 'bad');
        if (box) box.checked = !want;
      } finally {
        syncNfqBtn();
      }
    };

    const removeAll = async (sync = true) => {
      markSw('dpi', 'dpi_remove');
      await installScript();
      await runRemove(SCRIPT);
      const bootOn = await isBootOn();
      await refresh(sync);
      toast(bootOn ? 'Anti-DPI rules removed. Auto-apply at boot is still enabled and will restore them' : 'Anti-DPI rules removed', bootOn ? 'orange' : 'green', bootOn ? 6000 : 4000);
    };

    const ELF_MACH = { 183: 'arm64 (aarch64)', 40: 'arm 32-bit' };
    const sha256Hex = async (buf) => {
      try {
        if (window.crypto?.subtle) {
          const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
          return Array.from(h).map((x) => x.toString(16).padStart(2, '0')).join('');
        }
      } catch (_) {  }
      try { return sha256Js(new Uint8Array(buf)); } catch (_) { return ''; }
    };
    const installNfqws = async (file) => {
      if (!file) throw new Error('No file chosen');
      if (!file.size || file.size > NFQWS_MAX_BYTES) throw new Error(`File size ${file.size} is not usable (1 byte to ${NFQWS_MAX_BYTES / 1048576} MB)`);
      const buf = await file.arrayBuffer();
      const u8 = new Uint8Array(buf);
      if (u8.length < 64 || u8[0] !== 0x7f || u8[1] !== 0x45 || u8[2] !== 0x4c || u8[3] !== 0x46) throw new Error('This is not a Linux program (no ELF header). Choose the nfqws file itself, not a zip or tar');
      const mach = u8[18] | (u8[19] << 8);
      if (!ELF_MACH[mach]) throw new Error(`This build is for another CPU (code ${mach}). The device needs arm64 or arm`);
      const hash = await sha256Hex(buf);
      const f = `${DIR}/nfqws`;
      let r = await runRoot(`mkdir -p ${DIR} && rm -f ${f}.b64 ${f}.new`);
      if (!r.ok) throw new Error(r.text || 'Cannot create folder');
      let bin = '';
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      const b64 = btoa(bin);
      const total = Math.ceil(b64.length / NFQWS_CHUNK);
      for (let i = 0, n = 1; i < b64.length; i += NFQWS_CHUNK, n++) {
        setNfqMsg(`Copying to the device… ${n} of ${total}`, 'warn');
        r = await runRoot(`printf %s ${b64.slice(i, i + NFQWS_CHUNK)} >> ${f}.b64`, 30000);
        if (!r.ok) { await runRoot(`rm -f ${f}.b64`); throw new Error(r.text || 'Write failed'); }
      }
      r = await runRoot(`base64 -d < ${f}.b64 > ${f}.new; rm -f ${f}.b64; chmod 755 ${f}.new; echo SIZE=$(wc -c < ${f}.new); echo SUM=$( (sha256sum ${f}.new || busybox sha256sum ${f}.new || toybox sha256sum ${f}.new || openssl dgst -sha256 ${f}.new) 2>/dev/null | head -n 1 | grep -oE '[0-9a-f]{64}' | head -n 1)`, 30000);
      const size = Number((r.text.match(/SIZE=(\d+)/) || [])[1] || 0);
      const sum = (r.text.match(/SUM=([0-9a-f]{64})/) || [])[1] || '';
      if (size !== u8.length) { await runRoot(`rm -f ${f}.new`); throw new Error(`The copy is ${size} bytes instead of ${u8.length}; import cancelled`); }
      if (hash && sum && hash !== sum) { await runRoot(`rm -f ${f}.new`); throw new Error('The copy on the device does not match the file you chose (SHA-256 differs); import cancelled'); }
      const verified = Boolean(hash && sum);
      if (!verified) toast('Could not compare SHA-256 on this device. Only the file size was checked', 'orange', 6000);
      r = await runRoot(`${f}.new --version >${f}.out 2>&1; rc=$?; head -2 ${f}.out; rm -f ${f}.out; echo RC=$rc`, 15000);
      const vrc = Number((r.text.match(/RC=(\d+)\s*$/) || [])[1] ?? 255);
      const vout = r.text.replace(/RC=\d+\s*$/, '').trim();
      if (vrc !== 0) {
        await runRoot(`rm -f ${f}.new`);
        const hint = vrc === 126 ? ' - not executable here, usually the wrong CPU build' : vrc === 127 ? ' - the program or a library it needs was not found' : '';
        throw new Error(`The program does not start on this device (exit code ${vrc}${hint}): ${vout.slice(0, 120) || 'no output'}`);
      }
      await refresh(false);
      const wasLive = lastState.nfq && (await loadSaved()).nfq === 1;
      const base = wasLive ? await netTest() : null;
      r = await runRoot(`rm -f ${f}.prev; [ -f ${f} ] && cp -p ${f} ${f}.prev; mv -f ${f}.new ${f} && chmod 755 ${f} && echo DONE`);
      if (!/DONE/.test(r.text)) throw new Error(r.text || 'Could not finish install');
      if (wasLive) {
        setNfqMsg('Restarting nfqws with the new file and testing the internet…', 'warn');
        await runRoot(`sh ${SCRIPT} apply 2>&1`, 40000);
        await refresh(false);
        let healthy = lastState.nfq;
        if (healthy && base?.ok) {
          await sleep(3000);
          let t = await netTest();
          if (!t.ok) { await sleep(2500); t = await netTest(); }
          healthy = t.ok;
        }
        if (!healthy) {
          const why = lastState.nfq ? 'the internet stopped working with it' : 'it did not start';
          const had = await runRoot(`[ -f ${f}.prev ] && mv -f ${f}.prev ${f} && echo RESTORED || echo NOPREV`);
          if (had.text.includes('RESTORED')) {
            await runRoot(`sh ${SCRIPT} apply 2>&1`, 40000);
            await refresh(false);
            throw new Error(`The new nfqws build was rejected (${why}). The previous build was restored and restarted`);
          }
          await turnNfqOff();
          await refresh(true);
          throw new Error(`The new nfqws build was rejected (${why}) and there was no previous build to restore, so nfqws was switched off`);
        }
      }
      await runRoot(`rm -f ${f}.prev`);
      await refresh(false);
      toast(`nfqws imported (${ELF_MACH[mach]}, ${size} bytes)`, 'green', 4000);
      return { size, mach: ELF_MACH[mach], sum: verified ? sum : '' };
    };

    const uninstallNfqws = async () => {
      const have = await runRoot(`[ -f ${DIR}/nfqws ] && echo YES || echo NO`);
      if (!have.ok) throw new Error(`Cannot reach the device (${have.text || 'no answer'}). Reload the page and try again`);
      if (!have.text.includes('YES')) { setNfqMsg('nfqws is not installed, nothing to remove.', 'warn'); return; }
      if (typeof window.confirm === 'function' && !window.confirm('Remove nfqws from the device? You can import it again later.')) { setNfqMsg('Uninstall cancelled.', 'warn'); return; }
      setNfqMsg('Turning nfqws off and removing it…', 'warn');
      await installScript();
      await turnNfqOff();
      const r = await runRoot(`rm -f ${DIR}/nfqws ${DIR}/nfqws.new ${DIR}/nfqws.prev ${DIR}/nfqws.b64 ${DIR}/nfqws.pid; [ -e ${DIR}/nfqws ] && echo LEFT || echo GONE`);
      if (!r.text.includes('GONE')) throw new Error(`Could not delete the file. ${r.text.slice(0, 120)}`);
      await refresh(true);
      const box = q('#dpi_nfq'); if (box) box.checked = false;
      setNfqMsg('nfqws uninstalled. Import a file again to use it.', 'good');
      toast('nfqws uninstalled', 'green', 4000);
    };

    const diagnoseNfq = async () => {
      const sess = session;
      const out = q('#dpi_nfq_diag');
      if (out) out.textContent = 'Checking…';
      const r = await runRoot(PRELUDE + String.raw`
D=${DIR}
F=$D/nfqws
echo "@@EXISTS=$([ -f $F ] && echo 1 || echo 0)"
echo "@@EXEC=$([ -x $F ] && echo 1 || echo 0)"
echo "@@SIZE=$(wc -c < $F 2>/dev/null || echo 0)"
echo "@@UNAME=$(uname -m 2>&1)"
h=$(head -c 20 $F 2>/dev/null | od -An -tx1 2>/dev/null | tr -d ' \n')
echo "@@ELFMAGIC=$(echo "$h" | cut -c1-8)"
echo "@@ELFCLASS=$(echo "$h" | cut -c9-10)"
echo "@@ELFMACH=$(echo "$h" | cut -c37-40)"
if [ -x $F ]; then
  V=$($F --version 2>&1); VRC=$?
  echo "@@VERRC=$VRC"
  echo "@@VER=$(echo "$V" | head -2 | tr '\n' ' ')"
fi
NFQ=0; NFQARGS=""
[ -f ${CONF} ] && . ${CONF}
echo "@@NFQ=$NFQ"
echo "@@ARGS=$NFQARGS"
case "$NFQARGS" in
  *[!A-Za-z0-9=,._:/\ -]*) echo "@@DRY=badchars" ;;
  *) if [ -x $F ]; then B=$($F --qnum=251 --dry-run 2>&1); BR=$?; echo "@@DRYBASE=$BR"; O=$($F --qnum=251 --dry-run $NFQARGS 2>&1); R=$?; echo "@@DRY=$R"; echo "@@DRYOUT=$(echo "$O" | head -3 | tr '\n' ' ')"; fi ;;
esac
P=$(cat $D/nfqws.pid 2>/dev/null)
if [ -n "$P" ] && kill -0 "$P" 2>/dev/null && tr '\0' ' ' < /proc/$P/cmdline 2>/dev/null | grep -qF "$D/nfqws "; then
  echo "@@RUN=1"; echo "@@CMD=$(tr '\0' ' ' < /proc/$P/cmdline)"
else
  echo "@@RUN=0"
fi
echo "@@RULE=$(ipt iptables -t mangle -S UFI_DPI 2>/dev/null | grep -c NFQUEUE)"
echo "@@CONNB=$(ipt iptables -t mangle -S UFI_DPI 2>/dev/null | grep NFQUEUE | grep -c connbytes)"
echo "@@HAVE6=$(command -v ip6tables >/dev/null 2>&1 && echo 1 || echo 0)"
echo "@@LINK6=$(ipt ip6tables -t mangle -C POSTROUTING -j UFI_DPI6 2>/dev/null && echo 1 || echo 0)"
echo "@@RULE6=$(ipt ip6tables -t mangle -S UFI_DPI6 2>/dev/null | grep -c NFQUEUE)"
echo "@@CNT=$(ipt iptables -t mangle -L UFI_DPI -v -n -x 2>/dev/null | grep NFQUEUE | head -1 | sed 's/^ *//' | cut -d' ' -f1)"
echo "@@QUEUE=$(grep -E '^ *200 ' /proc/net/netfilter/nfnetlink_queue 2>/dev/null | head -1)"
ok=0; m=ping
if command -v curl >/dev/null 2>&1; then m=https; curl -s -m 8 -o /dev/null https://www.cloudflare.com/cdn-cgi/trace && ok=1
else ping -c 2 -W 3 ${PING_IP} >/dev/null 2>&1 && ok=1; fi
echo "@@NET=$ok"
echo "@@NETM=$m"
echo "== mangle chain"
ipt iptables -t mangle -S UFI_DPI 2>&1 | head -20
echo "== kernel config"
(zcat /proc/config.gz 2>/dev/null | grep -E "^(# )?CONFIG_(NETFILTER_XT_TARGET_NFQUEUE|NETFILTER_NETLINK_QUEUE|NETFILTER_XT_MATCH_CONNBYTES)[ =]") || echo "no /proc/config.gz"
echo "== queue table"
cat /proc/net/netfilter/nfnetlink_queue 2>&1 | head -5
echo "== file"
ls -l $F 2>&1
`, 60000);
      if (sess !== session) return;
      if (!r.ok && !/@@EXISTS=/.test(r.text)) {
        if (out) out.textContent = `Cannot reach the device (${r.text || 'no answer'}).\nThis is not a problem with nfqws. Reload the page, check that the PC is still connected to the F50, then run this again.`;
        setNfqMsg('Cannot reach the device. Reload the page and try again.', 'bad');
        return;
      }
      const kv = {};
      const rest = [];
      r.text.split('\n').forEach((l) => { const m = l.match(/^@@(\w+)=(.*)$/); if (m) kv[m[1]] = m[2].trim(); else rest.push(l); });
      const L = [];
      const good = (t) => L.push(`✓ ${t}`);
      const bad = (t) => L.push(`✕ ${t}`);
      const warn = (t) => L.push(`! ${t}`);
      let todo = '';
      const need = (t) => { if (!todo) todo = t; };
      const exists = kv.EXISTS === '1';
      const execOk = kv.EXEC === '1';
      const size = Number(kv.SIZE || 0);
      if (!exists) { bad('nfqws file is not installed'); need('Press "Import nfqws file" and choose your nfqws build.'); }
      else if (!execOk) { bad('nfqws file is there but not executable'); need('Press "Import nfqws file" again; it sets the permissions.'); }
      else good(`nfqws file found (${size} bytes)`);
      if (exists) {
        const mach = { b700: 'arm64 (aarch64)', 2800: 'arm 32-bit' }[kv.ELFMACH] || `unknown CPU code ${kv.ELFMACH || '?'}`;
        if (kv.ELFMAGIC !== '7f454c46') { bad('the file is not a valid program (damaged or wrong file)'); need('Press "Import nfqws file" to replace it.'); }
        else good(`file is built for ${mach}; this device reports ${kv.UNAME || 'unknown'}`);
      }
      if (execOk) {
        if (kv.VERRC === '0') good(`starts normally${kv.VER ? ` (${kv.VER.slice(0, 80)})` : ''}`);
        else { bad(`does not start (exit code ${kv.VERRC || '?'}): ${(kv.VER || 'no output').slice(0, 100)}`); need('This build does not run on the device. Exit code 126 or 127 usually means the wrong CPU build or a missing library.'); }
        if (kv.DRY === 'badchars') { bad('saved arguments contain characters that are not allowed'); need('Fix the arguments and press Apply.'); }
        else if (kv.DRY === '0') good(kv.ARGS ? 'saved arguments are accepted by nfqws' : 'no arguments saved (nfqws would do nothing useful)');
        else if (kv.DRY !== undefined && kv.DRYBASE !== '0') {
          warn(`this nfqws build cannot pre-check arguments with --dry-run${kv.RUN === '1' ? ' (it is running with the saved arguments, so they were accepted)' : '; they are checked when nfqws starts'}`);
        }
        else if (kv.DRY !== undefined) { bad(`nfqws rejects the saved arguments: ${(kv.DRYOUT || '').slice(0, 120)}`); need('Fix the arguments and press Apply.'); }
      }
      if (/autottl/i.test(kv.ARGS || '')) warn(NFQ_REPLY_NOTE);
      const want = kv.NFQ === '1';
      if (want) good('turned on in the saved settings'); else { warn('turned off in the saved settings (nfqws is stopped), so nothing is sent to it'); need('To use it: type the arguments on the nfqws tab and press Start.'); }
      if (want && !kv.ARGS) warn('the arguments box is empty');
      if (want) {
        if (kv.RUN === '1') good('nfqws process is running');
        else { bad('nfqws should be running but is not'); need('Press Apply again. If it stops again, check the lines above.'); }
        if (Number(kv.RULE) > 0) good(`firewall rule sending HTTPS to nfqws exists${Number(kv.CONNB) > 0 ? ' (first packets only)' : ' (all HTTPS packets)'}`);
        else { bad('firewall rule for nfqws is missing'); need('Press Apply to rebuild the rules.'); }
        if (Number(kv.RULE) > 0) {
          if (kv.HAVE6 !== '1') warn('ip6tables is not available, so IPv6 HTTPS is not sent to nfqws (IPv6 connections are not changed)');
          else if (kv.LINK6 === '1' && Number(kv.RULE6) > 0) good('IPv6 HTTPS is also sent to nfqws');
          else warn('IPv6 HTTPS is not sent to nfqws (the IPv6 firewall rule could not be added on this kernel, see the Anti-DPI diagnose). IPv6 connections are not changed');
        }
        if (Number(kv.RULE) > 0) {
          const cnt = Number(kv.CNT || 0);
          if (cnt > 0) good(`${cnt} packets have been sent to nfqws`);
          else warn('no packets sent to nfqws yet; open an HTTPS site on a connected device, then run this again');
        }
        const qf = (kv.QUEUE || '').split(/\s+/);
        if (kv.QUEUE) {
          if (qf[1] && qf[1] !== '0') good(`nfqws is attached to queue 200 (${qf[2] || 0} waiting, ${qf[5] || 0} dropped)`);
          else { bad('queue 200 exists but nfqws is not attached to it'); need('Press Apply to restart nfqws.'); }
          if (Number(qf[5] || 0) > 0 || Number(qf[6] || 0) > 0) warn('the queue has dropped packets (nfqws may be too slow for this traffic)');
        } else if (kv.RUN === '1') warn('queue 200 is not listed by the kernel (some kernels do not show it)');
      } else if (kv.RUN === '1') warn('nfqws is still running although the saved setting is off');
      if (kv.NET === '1') good(`internet works (${kv.NETM === 'https' ? 'HTTPS fetch' : 'ping only, so HTTPS was not tested'})`);
      else { bad('internet test failed'); if (want) need('Internet fails while nfqws is on: switch nfqws off and try other arguments.'); }
      if (!todo) todo = 'Everything checked looks fine.';
      const text = `Summary\n${L.join('\n')}\n\nWhat to do: ${todo}\n\nDetails\n${kv.CMD ? `command line: ${kv.CMD}\n` : ''}${kv.ARGS ? `saved arguments: ${kv.ARGS}\n` : ''}${rest.join('\n').trim()}`;
      if (out) out.textContent = text;
    };

    const diagnose = async () => {
      const sess = session;
      const out = q('#dpi_diag');
      if (out) out.textContent = 'Checking…';
      const r = await runRoot(PRELUDE + String.raw`
probe() {
  t=$1; shift
  ipt iptables -t $t -F UFI_PROBE_$$ 2>/dev/null; ipt iptables -t $t -X UFI_PROBE_$$ 2>/dev/null
  ipt iptables -t $t -N UFI_PROBE_$$ 2>/dev/null || { echo "unknown (cannot create test chain)"; return; }
  if ipt iptables -t $t -A UFI_PROBE_$$ "$@" 2>/dev/null; then echo OK; else echo MISSING; fi
  ipt iptables -t $t -F UFI_PROBE_$$ 2>/dev/null; ipt iptables -t $t -X UFI_PROBE_$$ 2>/dev/null
}
echo "== iptables"; iptables -V 2>&1
echo "== rule support"
echo "NFQUEUE target:   $(probe mangle -p tcp --dport 443 -j NFQUEUE --queue-num 250 --queue-bypass)"
echo "TCPMSS target:    $(probe mangle -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1360)"
echo "DROP udp 443:     $(probe mangle -p udp --dport 443 -j DROP)"
echo "connbytes match:  $(probe mangle -p tcp --dport 443 -m connbytes --connbytes 1:6 --connbytes-mode packets --connbytes-dir original -j RETURN)"
echo "mark match:       $(probe mangle -m mark ! --mark 0x40000000/0x40000000 -j RETURN)"
echo "DNAT (nat table): $(probe nat -i br0 -p udp --dport 53 -j DNAT --to-destination 1.1.1.1:53)"
echo "== our chains"
if ipt iptables -t mangle -C POSTROUTING -j UFI_DPI 2>/dev/null; then echo "mangle POSTROUTING -> UFI_DPI: linked"; else echo "mangle POSTROUTING -> UFI_DPI: not linked"; fi
ipt iptables -t mangle -S UFI_DPI 2>&1
if ipt iptables -t nat -C PREROUTING -j UFI_DPI_NAT 2>/dev/null; then echo "nat PREROUTING -> UFI_DPI_NAT: linked"; else echo "nat PREROUTING -> UFI_DPI_NAT: not linked"; fi
ipt iptables -t nat -S UFI_DPI_NAT 2>&1
echo "== IPv6 (ip6tables)"
if command -v ip6tables >/dev/null 2>&1; then
  if ipt ip6tables -t mangle -C POSTROUTING -j UFI_DPI6 2>/dev/null; then echo "mangle POSTROUTING -> UFI_DPI6: linked"; else echo "mangle POSTROUTING -> UFI_DPI6: not linked"; fi
  ipt ip6tables -t mangle -S UFI_DPI6 2>&1
else
  echo "ip6tables is not available: IPv6 traffic is not changed by Anti-DPI"
fi
echo "== counters (packets bytes)"
ipt iptables -t mangle -L UFI_DPI -v -n -x 2>&1
ipt iptables -t nat -L UFI_DPI_NAT -v -n -x 2>&1
echo "== saved config"; cat ${CONF} 2>/dev/null || echo "(none)"
echo "== helper / boot / keep-alive"
ls -l ${SCRIPT} 2>&1
echo "keep-alive: $([ -f ${SCRIPT} ] && sh ${SCRIPT} status 2>/dev/null || echo stopped)"
echo "boot line: $(grep -F ${SCRIPT} ${BOOT_FILE} 2>/dev/null || echo none)"
echo "== nfqws"
ls -l ${DIR}/nfqws 2>&1
echo "pid file: $(cat ${DIR}/nfqws.pid 2>/dev/null || echo none)"
(ps -A 2>/dev/null || ps 2>/dev/null) | grep -i nfqws | grep -v grep || echo "process: not running"
[ -x ${DIR}/nfqws ] && ${DIR}/nfqws --version 2>&1 | head -2
echo "queue state:"; cat /proc/net/netfilter/nfnetlink_queue 2>&1 | head -5
echo "== kernel config"
(zcat /proc/config.gz 2>/dev/null | grep -E "^(# )?CONFIG_(NETFILTER_XT_TARGET_(NFQUEUE|TCPMSS)|NETFILTER_XT_MATCH_(CONNBYTES|MARK)|NETFILTER_NETLINK_QUEUE|NF_NAT|NF_CONNTRACK)[ =]") || echo "no /proc/config.gz or no matches"
echo "== hotspot interfaces (an interface that carries the default route is the uplink and is skipped)"
${LAN_SH}
for i in $LANALL; do if [ -d /sys/class/net/$i ]; then case " $LANIFS " in *" $i "*) echo "$i: present" ;; *) echo "$i: uplink, skipped" ;; esac; else echo "$i: missing"; fi; done
echo "== connectivity"
if ping -c 1 -W 3 ${PING_IP} >/dev/null 2>&1 || ping -c 1 -w 4 ${PING_IP} >/dev/null 2>&1; then echo "internet (${PING_IP}): reachable"; else echo "internet (${PING_IP}): FAILED"; fi
if ping -c 1 -W 3 ${PING_HOST} >/dev/null 2>&1 || ping -c 1 -w 4 ${PING_HOST} >/dev/null 2>&1; then echo "dns (${PING_HOST}): working"; else echo "dns (${PING_HOST}): FAILED"; fi
echo "== possible hardware fast path"
grep -i -E "sfp|sipa" /proc/modules 2>/dev/null | head -3 || echo none
`, 45000);
      const el = q('#dpi_diag');
      if (el && sess === session) el.textContent = r.text || '(no output)';
    };

    const showCounters = async () => {
      const sess = session;
      const r = await runRoot(PRELUDE + String.raw`
ipt iptables -t mangle -L UFI_DPI -v -n -x 2>&1
echo "@@NAT"
ipt iptables -t nat -L UFI_DPI_NAT -v -n -x 2>&1
echo "@@V6"
ipt ip6tables -t mangle -L UFI_DPI6 -v -n -x 2>&1
`);
      if (sess !== session) return;
      const [mangle, rest = ''] = r.text.split('@@NAT');
      const [nat, v6 = ''] = rest.split('@@V6');
      const out = [];
      let any = false;
      const num = (l) => Number((l.trim().split(/\s+/)[0]) || 0);
      for (const line of mangle.split('\n')) {
        if (!/^\s*\d+\s+\d+\s/.test(line)) continue;
        any = true;
        if (/\bDROP\b/.test(line)) out.push(`QUIC blocked: ${num(line)} packets`);
        else if (/TCPMSS/.test(line)) out.push(`TCP MSS set on: ${num(line)} connection starts`);
        else if (/NFQUEUE/.test(line)) out.push(`Sent to nfqws: ${num(line)} packets`);
      }
      for (const line of nat.split('\n')) {
        if (!/^\s*\d+\s+\d+\s/.test(line)) continue;
        any = true;
        if (/DNAT/.test(line)) out.push(`DNS redirected (${/\budp\b/.test(line) ? 'UDP' : 'TCP'}): ${num(line)} packets`);
      }
      for (const line of v6.split('\n')) {
        if (!/^\s*\d+\s+\d+\s/.test(line)) continue;
        any = true;
        if (/\bDROP\b/.test(line)) out.push(`QUIC blocked (IPv6): ${num(line)} packets`);
        else if (/TCPMSS/.test(line)) out.push(`TCP MSS set on (IPv6): ${num(line)} connection starts`);
        else if (/NFQUEUE/.test(line)) out.push(`Sent to nfqws (IPv6): ${num(line)} packets`);
      }
      const el = q('#dpi_cnt');
      if (el) el.textContent = any ? out.join('\n') : 'No Anti-DPI rules are active. Press Strong on Quick setup, or Save and apply on the Anti-DPI tab, first.';
    };
    const resetCounters = async () => {
      const sess = session;
      await runRoot(PRELUDE + 'ipt iptables -t mangle -Z UFI_DPI 2>/dev/null; ipt iptables -t nat -Z UFI_DPI_NAT 2>/dev/null; ipt ip6tables -t mangle -Z UFI_DPI6 2>/dev/null; echo done');
      const el = q('#dpi_cnt');
      if (el && sess === session) el.textContent = 'Counters reset. Browse for a bit, then press Show.';
    };

    const stopAll = async () => {
      await installScript();
      await stopHelper(SCRIPT);
    };

    const toggleBoot = async () => {
      const enabled = await isBootOn();
      if (enabled) {
        await bootDel(SCRIPT);
        await runRoot(`[ -f ${SCRIPT} ] && sh ${SCRIPT} stop`);
      } else {
        const has = await runRoot(`[ -f ${SCRIPT} ] && [ -f ${CONF} ] && echo YES`);
        if (!has.text.includes('YES')) throw new Error('Apply settings first so there is something to run at boot');
        await bootAdd(SCRIPT, BOOT_LINE);
        await runRoot(`sh ${SCRIPT} start`);
        await sleep(600);
      }
      await refresh();
      toast(enabled ? 'Auto-apply at boot disabled' : 'Auto-apply at boot enabled', 'green', 3500);
      if (!enabled) await warnForeignBoot();
    };

    return {
      html: `
        <div class="bp-section">
          <div id="dpi_hero" class="bp-hero off">● Checking…</div>
          <div class="bp-card">
            <div class="bp-head"><span class="bp-title">Status</span><button class="bp-act" id="dpi_refresh">Refresh</button></div>
            <div class="bp-grid">
              <div class="bp-stat"><div class="bp-label">Firewall rules</div><div id="dpi_active" class="bp-value">Checking…</div></div>
              <div class="bp-stat"><div class="bp-label">DNS redirect</div><div id="dpi_dns_active" class="bp-value">Checking…</div></div>
              <div class="bp-stat"><div class="bp-label">Auto-apply at boot</div><div id="dpi_boot" class="bp-value">Checking…</div></div>
              <div class="bp-stat"><div class="bp-label">Keep-alive</div><div id="dpi_watch" class="bp-value">Checking…</div></div>
            </div>
          </div>
          <div class="bp-card">
            <div class="bp-row" style="margin-top:0">
              <label>TCP MSS <input id="dpi_mss" type="number" min="0" max="1460" step="1" value="0"></label>
              <span id="dpi_mss_presets" class="bp-chips"><button class="bp-act bp-chip" data-v="0">Off</button><button class="bp-act bp-chip" data-v="1360">1360</button><button class="bp-act bp-chip" data-v="1400">1400</button><button class="bp-act bp-chip" data-v="1460">1460</button></span>
            </div>
            <div class="bp-row"><label><input id="dpi_quic" type="checkbox"> Block QUIC (UDP 443)</label></div>
            <div class="bp-row">
              <label style="flex:1 1 150px;flex-wrap:nowrap">DNS <input id="dpi_dns" type="text" placeholder="1.1.1.1 (empty = off)" style="flex:1;min-width:0;width:auto"></label>
              <span id="dpi_dns_presets" class="bp-chips"><button class="bp-act bp-chip" data-v="">Off</button><button class="bp-act bp-chip" data-v="1.1.1.1">1.1.1.1</button><button class="bp-act bp-chip" data-v="8.8.8.8">8.8.8.8</button><button class="bp-act bp-chip" data-v="9.9.9.9">9.9.9.9</button></span>
            </div>
            <div class="bp-row bp-split">
              <button class="bp-act bp-sm bp-sw" data-grp="dpi" id="dpi_apply">Save and apply</button>
              <button class="bp-act bp-sm bp-danger bp-sw" data-grp="dpi" id="dpi_remove">Remove all</button>
              <button class="bp-act bp-sm bp-toggle" id="dpi_boot_toggle">At boot</button>
            </div>
          </div>
          <details class="bp-card bp-more">
            <summary>Notes</summary>
            <div class="bp-note"><b>TCP MSS</b> limits the packet size of TCP connections so hotspot traffic looks like the phone's own traffic (1360 is common; 0 = off). <b>Block QUIC</b> makes apps fall back to TCP; some apps may feel slower, and VPNs that use UDP 443 (some WireGuard / OpenVPN setups) stop working while it is on. <b>DNS</b> redirects normal IPv4 DNS that hotspot devices send to other servers: encrypted DNS (DoH / DoT) and IPv6 are not changed, and queries sent to the router itself (192.168.0.1) are not redirected, so devices that use the router as their DNS are unchanged. Names that only the router can answer stop resolving for devices that send their DNS elsewhere.</div>
            <div class="bp-note">This only helps against detection based on packet details (MSS, QUIC, DNS, TLS handshake). It cannot get around blocking based on account data or traffic volume, and it may break your plan's terms. Use at your own risk. Auto-apply at boot also starts a keep-alive that restores the rules if the connection resets them.</div>
          </details>
        </div>
      `,
      nfq: `
        <div class="bp-section">
          <div class="bp-card">
            <div class="bp-grid">
              <div class="bp-stat"><div class="bp-label">NFQUEUE kernel support</div><div id="dpi_sup_nfq" class="bp-value">Checking…</div></div>
              <div class="bp-stat"><div class="bp-label">TCP MSS kernel support</div><div id="dpi_sup_mss" class="bp-value">Checking…</div></div>
              <div class="bp-stat"><div class="bp-label">nfqws binary</div><div id="dpi_bin" class="bp-value">Checking…</div></div>
              <div class="bp-stat"><div class="bp-label">nfqws process</div><div id="dpi_run" class="bp-value">Checking…</div></div>
            </div>
            <div id="dpi_conn_note" class="bp-note" style="display:none">This kernel has no connbytes match, so all outgoing HTTPS packets go to nfqws, not only the first few. That is normal here and usually has no visible effect. If downloads feel slow, press Stop.</div>
          </div>
          <div class="bp-card">
            <div class="bp-row" style="margin-top:0"><div class="bp-nfqt"><span class="bp-nfqh"><span class="bp-rt">Run nfqws</span><span class="bp-nfqs">Outgoing HTTPS (TCP 443)</span></span><input id="dpi_nfq" type="checkbox" style="display:none"><button class="bp-act bp-sm" id="dpi_nfq_btn" type="button" disabled>…</button></div></div>
            <div id="dpi_nfq_msg" class="bp-note">Import an nfqws file, type the arguments, then press Start. It starts immediately.</div>
            <div class="bp-row bp-split"><label class="bp-nfqa">Arguments<input id="dpi_args" type="text" placeholder="--dpi-desync=fake --dpi-desync-ttl=3"></label></div>
            <div class="bp-row">
              <button class="bp-act bp-sm bp-nfqi" id="dpi_nfq_install">Import file</button>
              <input type="file" id="dpi_nfq_file" style="display:none">
              <button class="bp-act bp-sm bp-danger" id="dpi_nfq_uninstall">Uninstall</button>
            </div>
          </div>
          <details class="bp-card bp-more">
            <summary>Diagnose nfqws</summary>
            <div class="bp-row"><button class="bp-act" id="dpi_nfq_diag_btn">Run</button><button class="bp-act" id="dpi_nfq_diag_copy">Copy</button></div>
            <pre id="dpi_nfq_diag" class="bp-pre">—</pre>
          </details>
          <details class="bp-card bp-more">
            <summary>About nfqws</summary>
            <div class="bp-note">nfqws is not included. Download a build that matches your device (for example zapret, linux-arm64, static), tap Import file and choose it. The plugin checks it (ELF header, CPU type, size, SHA-256, test run) and installs it to ${DIR}/nfqws; no adb needed. The plugin starts it as root (the build itself may drop privileges), so only import a build you trust. Uninstall turns nfqws off and deletes the file; your other settings are kept. nfqws needs NFQUEUE support in the kernel (shown above).</div>
            <div class="bp-note">Safety: when you apply with nfqws on, the plugin tests the internet and turns nfqws off automatically if the connection stops working. If nfqws crashes, traffic keeps flowing without it. Only outgoing packets are sent to nfqws, so options that need the server's replies (the autottl options) do nothing; use a fixed value such as --dpi-desync-ttl=3. TCP MSS (20 lower for IPv6), Block QUIC and nfqws also apply to IPv6 when the kernel supports ip6tables; the DNS redirect is IPv4 only.</div>
            <div class="bp-note">Arguments may only contain letters, numbers and = , . _ : / - (paths such as --hostlist=${DIR}/list.txt work). The plugin sets --qnum, --daemon and --pidfile itself, so do not add them. --debug and --dpi-desync-fwmark are not allowed because the firewall rules depend on the default mark.</div>
          </details>
        </div>
      `,
      tools: `
        <details class="bp-card bp-more">
          <summary>Rule counters</summary>
          <div class="bp-row"><button class="bp-act" id="dpi_cnt_btn">Show</button><button class="bp-act" id="dpi_cnt_reset">Reset to 0</button></div>
          <pre id="dpi_cnt" class="bp-pre">Press Show while you browse.</pre>
          <div class="bp-note">A counter that stays at 0 means no matching traffic has passed yet. For QUIC this usually means your browser or carrier is not using QUIC.</div>
        </details>
        <details class="bp-card bp-more">
          <summary>Diagnose Anti-DPI</summary>
          <div class="bp-note">Checks kernel support, active rules and counters, nfqws, boot / keep-alive and connectivity. If something fails, copy this text and send it for support.</div>
          <div class="bp-row"><button class="bp-act" id="dpi_diag_btn">Run</button><button class="bp-act" id="dpi_diag_copy">Copy</button></div>
          <pre id="dpi_diag" class="bp-pre">—</pre>
        </details>
      `,
      bind: () => {
        const chips = (box, input) => q(box)?.querySelectorAll('button').forEach((bt) => { bt.onclick = () => { const i = q(input); if (i && busy === 0) { i.value = bt.dataset.v; syncChips(); } }; });
        q('#dpi_mss').oninput = syncChips;
        q('#dpi_dns').oninput = syncChips;
        chips('#dpi_mss_presets', '#dpi_mss');
        chips('#dpi_dns_presets', '#dpi_dns');
        q('#dpi_cnt_btn').onclick = guarded(showCounters, 'Reading…');
        q('#dpi_cnt_reset').onclick = guarded(resetCounters, 'Resetting…');
        q('#dpi_diag_btn').onclick = guarded(diagnose, 'Checking…');
        q('#dpi_diag_copy').onclick = guarded(() => copyPre('#dpi_diag'), '');
        q('#dpi_nfq_btn').onclick = (ev) => {
          if (busy > 0 || !nfqKnown) return;
          const want = !lastState.nfq;
          const box = q('#dpi_nfq'); if (box) box.checked = want;
          nfqPending = want ? 'Starting…' : 'Stopping…';
          syncNfqBtn();
          guarded(async () => { try { await nfqToggle(want); } finally { nfqPending = ''; syncNfqBtn(); } }, '')();
        };
        syncNfqBtn();
        q('#dpi_nfq_install').onclick = () => { if (busy === 0) q('#dpi_nfq_file')?.click(); };
        q('#dpi_nfq_file').onchange = (ev) => {
          const inp = ev.target;
          const file = inp.files && inp.files[0];
          inp.value = '';
          if (!file) return;
          guarded(async () => {
            try {
              const res = await installNfqws(file);
              setNfqMsg(`nfqws imported (${res.mach}, ${res.size} bytes${res.sum ? `, SHA-256 ${res.sum.slice(0, 12)}… verified` : ', size checked only'}). Now type the arguments and press Start.`, 'good');
            } catch (e) { setNfqMsg(`Import failed: ${e?.message || e}`, 'bad'); throw e; }
          }, '')(ev);
        };
        q('#dpi_nfq_uninstall').onclick = guarded(async () => {
          try { await uninstallNfqws(); }
          catch (e) { setNfqMsg(`Uninstall failed: ${e?.message || e}`, 'bad'); throw e; }
        }, 'Removing…');
        q('#dpi_nfq_diag_btn').onclick = guarded(diagnoseNfq, 'Checking…');
        q('#dpi_nfq_diag_copy').onclick = guarded(() => copyPre('#dpi_nfq_diag'), '');
        q('#dpi_apply').onclick = guarded(applyRules, 'Applying…');
        q('#dpi_remove').onclick = guarded(removeAll, 'Removing…');
        q('#dpi_boot_toggle').onclick = guarded(toggleBoot);
        q('#dpi_refresh').onclick = guarded(() => refresh(false), 'Refreshing…');
      },
      init: initGuard(() => refresh(true)),
      ensureScript: () => ensureHelper(SCRIPT, DPI_SCRIPT),
      refresh: () => refresh(false),
      state: () => lastState,
      diagnose,
      setBoot: async (want) => { if ((await isBootOn()) !== want) await toggleBoot(); },
      setQuic: async (on) => {
        await refresh(false);
        const cf = await readConf();
        let s, st;
        if (lastState.working) { s = { ...cf.active }; st = cf.stash; }
        else { s = { ...cf.saved, mss: 0, dns: '', nfq: 0 }; st = stashOf(cf.saved, s); }
        s.quic = on ? 1 : 0;
        st = stashWithout(st, 'quic');
        await applyRules(s, st);
        const qc = q('#dpi_quic'); if (qc) qc.checked = on;
      },
      stopAll,
      setup: async () => {
        const s = await loadSaved();
        s.mss = 1360;
        await applyRules(s);
        const saved = await loadSaved();
        const rule = await runRoot(PRELUDE + 'ipt iptables -t mangle -S UFI_DPI 2>/dev/null | grep -c -e "--set-mss 1360\\$"');
        if (saved.mss !== 1360 || !/^\s*[1-9]/.test(rule.text.trim())) {
          throw new Error(`Strong did not apply the TCP MSS (saved MSS ${saved.mss}, MSS rule ${/^\s*[1-9]/.test(rule.text.trim()) ? 'present' : 'missing'}). Open the Anti-DPI tab and press Copy report`);
        }
        const m = q('#dpi_mss'); if (m) m.value = 1360;
        if (!(await isBootOn())) await toggleBoot();
      },
    };
  })();

  const ensureStyle = () => {
    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${MODAL_NAME} { width:94vw !important; }
      #${MODAL_NAME},#${MODAL_NAME} *{word-break:normal !important;overflow-wrap:break-word;hyphens:manual}
      #${MODAL_NAME} .bp-wrap{display:flex;flex-direction:column;gap:14px;max-height:76vh;max-height:72svh;overflow-y:auto;overflow-x:hidden;padding-bottom:28px;-webkit-overflow-scrolling:touch;touch-action:pan-y;line-height:1.35}
      #${MODAL_NAME} .bp-wrap > *,#${MODAL_NAME} .bp-section > *,#${MODAL_NAME} .bp-card > *{flex:0 0 auto;min-height:auto}
      #${MODAL_NAME} .bp-section{display:flex;flex-direction:column;gap:12px}
      #${MODAL_NAME} .bp-h{font-weight:900;font-size:.95rem;padding:2px 2px 0;opacity:.95}
      #${MODAL_NAME} .bp-card{padding:13px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.045)}
      #${MODAL_NAME} .bp-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:9px}
      #${MODAL_NAME} .bp-title{font-weight:800;font-size:.85rem;display:block;margin-bottom:6px}
      #${MODAL_NAME} .bp-head .bp-title{margin-bottom:0}
      #${MODAL_NAME} .bp-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}
      #${MODAL_NAME} .bp-stat{padding:8px 11px;border-radius:11px;background:rgba(255,255,255,.05);margin-top:7px}
      #${MODAL_NAME} .bp-label{opacity:.62;font-size:.7rem}
      #${MODAL_NAME} .bp-value{font-weight:750;font-size:.95rem}
      #${MODAL_NAME} .bp-note{opacity:.78;font-size:.72rem;margin-top:8px;line-height:1.4}
      #${MODAL_NAME} .bp-card{overflow:hidden}
      #${MODAL_NAME} .bp-row label{display:flex;flex-wrap:wrap;align-items:center;gap:6px;position:static;float:none;margin:0}
      #${MODAL_NAME} .bp-row label input[type=checkbox]{flex:0 0 auto;margin:0;position:static}
      #${MODAL_NAME} .bp-label,#${MODAL_NAME} .bp-value{line-height:1.35}
      #${MODAL_NAME} .bp-good{color:#64e6a4}
      #${MODAL_NAME} .bp-warn{color:#ffd76a}
      #${MODAL_NAME} .bp-bad{color:#ff8a8a}
      #${MODAL_NAME} input[type=number]{width:90px;padding:7px 9px;border-radius:9px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.25);color:inherit}
      #${MODAL_NAME} input[type=text]{padding:7px 9px;border-radius:9px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.25);color:inherit;max-width:100%;width:100%;box-sizing:border-box}
      #${MODAL_NAME} .bp-pre{margin:8px 0 0;padding:9px 11px;border-radius:10px;background:rgba(0,0,0,.3);font:.6rem/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;user-select:text}
      #${MODAL_NAME} .bp-btns{display:flex;gap:8px}
      #${MODAL_NAME} button{padding:5px 10px;border-radius:8px;font-size:.78rem}
      #${MODAL_NAME} button:disabled{opacity:.5}
      #${MODAL_NAME} button{-webkit-tap-highlight-color:transparent;touch-action:manipulation}
      #${MODAL_NAME} button:not(.bp-on):focus:not(:focus-visible){outline:none;box-shadow:none}
      #${MODAL_NAME} .bp-tabs{position:sticky;top:0;z-index:3;display:flex;gap:6px;padding:4px;border-radius:12px;background:rgba(12,22,40,.95);border:1px solid rgba(255,255,255,.1)}
      #${MODAL_NAME} .bp-tab{flex:1;text-align:center;padding:5px 8px;font-size:.8rem;font-weight:800;opacity:.45;background:transparent !important;border:0;transition:opacity .15s,background .15s}
      #${MODAL_NAME} .bp-tab.on{opacity:1;background:rgba(80,160,255,.2) !important}
      #${MODAL_NAME} .bp-hero{padding:11px 14px;border-radius:12px;font-weight:800;font-size:.95rem;border:1px solid;overflow-wrap:anywhere}
      #${MODAL_NAME} .bp-hero.on{color:#64e6a4;background:rgba(100,230,164,.1);border-color:rgba(100,230,164,.35)}
      #${MODAL_NAME} .bp-hero.warn{color:#ffd76a;background:rgba(255,215,106,.1);border-color:rgba(255,215,106,.35)}
      #${MODAL_NAME} .bp-hero.off{color:#ff8a8a;background:rgba(255,138,138,.1);border-color:rgba(255,138,138,.35)}
      #${MODAL_NAME} .bp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      #${MODAL_NAME} .bp-grid .bp-stat{margin-top:0}
      @media (max-width:380px){#${MODAL_NAME} .bp-grid{grid-template-columns:1fr}}
      #${MODAL_NAME} .bp-chips{display:inline-flex;gap:6px}
      #${MODAL_NAME} .bp-chip{padding:4px 9px !important;font-size:.72rem;opacity:.45;transition:opacity .15s,background .15s}
      #${MODAL_NAME} .bp-chip.sel{opacity:1;font-weight:800;background:rgba(80,160,255,.2) !important}
      #${MODAL_NAME} .bp-qs{opacity:.45;transition:opacity .15s,background .15s}
      #${MODAL_NAME} .bp-qs.sel,#${MODAL_NAME} .bp-qs.sel:disabled{opacity:1;font-weight:800;background:rgba(80,160,255,.2) !important}
      #${MODAL_NAME} .bp-qs.bp-danger.sel,#${MODAL_NAME} .bp-qs.bp-danger.sel:disabled{background:rgba(255,100,100,.2) !important}
      #${MODAL_NAME} .bp-toggle{opacity:.8;transition:opacity .15s}
      #${MODAL_NAME} .bp-toggle.bp-on{opacity:1}
      #${MODAL_NAME} .bp-primary{background:rgba(80,160,255,.2) !important;font-weight:800}
      #${MODAL_NAME} .bp-danger{background:rgba(255,100,100,.2) !important}
      #${MODAL_NAME} .bp-on{box-shadow:none;color:#64e6a4}
      #${MODAL_NAME} .bp-on::before{content:none}
      #${MODAL_NAME} .bp-toggle::after{content:'';display:inline-block;width:28px;height:16px;margin-left:8px;vertical-align:-3px;border-radius:8px;background-color:rgba(255,255,255,.25);background-image:radial-gradient(circle,#fff 6px,transparent 6.5px);background-size:16px 16px;background-repeat:no-repeat;background-position:0 50%;transition:background-position .15s,background-color .15s}
      #${MODAL_NAME} .bp-toggle.bp-on::after{background-color:rgba(100,230,164,.75);background-position:100% 50%}
      #${MODAL_NAME} input[type=checkbox]{-webkit-appearance:none;appearance:none;width:32px;height:18px;border:0;border-radius:9px;background-color:rgba(255,255,255,.25);background-image:radial-gradient(circle,#fff 7px,transparent 7.5px);background-size:18px 18px;background-repeat:no-repeat;background-position:0 50%;transition:background-position .15s,background-color .15s;cursor:pointer}
      #${MODAL_NAME} input[type=checkbox]:checked{background-color:rgba(100,230,164,.75);background-position:100% 50%}
      #${MODAL_NAME} .bp-switch{width:36px;height:20px;padding:0 !important;border:0;border-radius:10px;flex:0 0 auto;background-color:rgba(255,255,255,.22);background-image:radial-gradient(circle,#fff 7px,transparent 7.5px);background-size:20px 20px;background-repeat:no-repeat;background-position:0 50%;transition:background-position .15s,background-color .15s}
      #${MODAL_NAME} .bp-switch.on{background-color:rgba(100,230,164,.75);background-position:100% 50%}
      #${MODAL_NAME} .bp-srow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0}
      #${MODAL_NAME} .bp-srow+.bp-srow{border-top:1px solid rgba(255,255,255,.08)}
      #${MODAL_NAME} .bp-rt{font-weight:750;font-size:.88rem}
      #${MODAL_NAME} .bp-tag{margin-left:6px;padding:2px 7px;border-radius:6px;font-size:.66rem;font-weight:700;color:#ffd76a;background:rgba(255,215,106,.12)}
      #${MODAL_NAME} .bp-pills{display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:8px}
      #${MODAL_NAME} .bp-pill{padding:7px 10px;border-radius:10px;background:rgba(255,255,255,.05)}
      #${MODAL_NAME} .bp-pill .bp-value{font-size:.85rem}
      #${MODAL_NAME} .bp-seg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;padding:4px;border-radius:12px;background:rgba(0,0,0,.28)}
      #${MODAL_NAME} .bp-seg .bp-qs{background:transparent !important;border:0;border-radius:9px;padding:8px 4px;opacity:.55;font-size:.85rem}
      #${MODAL_NAME} .bp-seg .bp-qs.sel,#${MODAL_NAME} .bp-seg .bp-qs.sel:disabled{opacity:1;font-weight:800;background:rgba(255,255,255,.14) !important}
      #${MODAL_NAME} details.bp-more>summary{cursor:pointer;font-weight:700;font-size:.78rem;opacity:.85;margin-top:10px}
      #${MODAL_NAME} details.bp-card>summary{margin-top:0}
      #${MODAL_NAME} .bp-pills{grid-template-columns:repeat(2,minmax(0,1fr))}
      #${MODAL_NAME} .bp-pill{padding:10px 12px;border:1px solid rgba(255,255,255,.08)}
      #${MODAL_NAME} .bp-pill .bp-value::before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:currentColor;margin-right:6px;vertical-align:1px}
      #${MODAL_NAME} .bp-tags{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
      #${MODAL_NAME} .bp-ptag{padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.09);font-size:.72rem;font-weight:700}
      #${MODAL_NAME} .bp-bar{display:flex;gap:8px;padding:10px 0 0;margin-top:2px;border-top:1px solid rgba(255,255,255,.08)}
      #${MODAL_NAME} .bp-wrap{max-height:calc(76vh - 64px);max-height:calc(72svh - 64px)}
      #${MODAL_NAME} .bp-bar{align-items:center}
      #${MODAL_NAME} .bp-bar .bp-close{margin-left:auto}
      #${MODAL_NAME} .bp-switch{position:relative}
      #${MODAL_NAME} .bp-switch::before{content:'';position:absolute;top:-12px;bottom:-12px;left:-8px;right:-8px}
      #${MODAL_NAME} .bp-wrap{gap:12px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}
      #${MODAL_NAME} .bp-card{border-radius:16px;padding:14px;border-color:rgba(255,255,255,.09);background:rgba(255,255,255,.04);box-shadow:0 1px 2px rgba(0,0,0,.18)}
      #${MODAL_NAME} .bp-title{font-size:.88rem;letter-spacing:.2px}
      #${MODAL_NAME} .bp-h{font-size:.72rem;font-weight:800;letter-spacing:.9px;text-transform:uppercase;opacity:.6;padding:6px 2px 0}
      #${MODAL_NAME} .bp-hero{padding:13px 16px;border-radius:14px;font-size:1rem}
      #${MODAL_NAME} .bp-stat{border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.04)}
      #${MODAL_NAME} .bp-label{font-size:.68rem;letter-spacing:.2px}
      #${MODAL_NAME} .bp-pill{border-radius:12px}
      #${MODAL_NAME} .bp-note{opacity:.7}
      #${MODAL_NAME} .bp-tabs{padding:5px;border-radius:14px}
      #${MODAL_NAME} .bp-tab{border-radius:10px;padding:8px 10px}
      #${MODAL_NAME} .bp-seg{border-radius:14px;padding:5px}
      #${MODAL_NAME} .bp-seg .bp-qs{border-radius:10px;padding:10px 4px}
      #${MODAL_NAME} button:not(.bp-switch):not(.bp-tab):not(.bp-qs):not(.bp-chip){border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);border-radius:10px;padding:7px 13px;font-weight:650;transition:background .15s,transform .1s,opacity .15s}
      @media (hover:hover){#${MODAL_NAME} button:not(.bp-switch):not(.bp-tab):not(.bp-qs):not(:disabled):hover{background:rgba(255,255,255,.14)}}
      #${MODAL_NAME} button:not(.bp-switch):not(:disabled):active{transform:scale(.97)}
      #${MODAL_NAME} .bp-primary{border-color:rgba(80,160,255,.55) !important}
      #${MODAL_NAME} .bp-danger{border-color:rgba(255,100,100,.4) !important}
      #${MODAL_NAME} .bp-chip{border:1px solid rgba(255,255,255,.12);border-radius:999px}
      #${MODAL_NAME} button:disabled{cursor:not-allowed}
      #${MODAL_NAME} input[type=number],#${MODAL_NAME} input[type=text]{border-radius:10px;padding:9px 11px;transition:border-color .15s,box-shadow .15s}
      #${MODAL_NAME} input[type=number]:focus,#${MODAL_NAME} input[type=text]:focus{outline:none;border-color:rgba(80,160,255,.7);box-shadow:0 0 0 3px rgba(80,160,255,.18)}
      #${MODAL_NAME} .bp-pre{border-radius:12px;border:1px solid rgba(255,255,255,.06)}
      #${MODAL_NAME} details.bp-more>summary{padding:2px 0;list-style-position:inside}
      #${MODAL_NAME} .bp-bar{padding-top:8px;gap:8px}
      #${MODAL_NAME} .bp-wrap{gap:8px;padding-bottom:12px;line-height:1.25;scrollbar-width:none;-ms-overflow-style:none}
      #${MODAL_NAME} .bp-wrap::-webkit-scrollbar,#${MODAL_NAME} .bp-pre::-webkit-scrollbar{display:none;width:0;height:0}
      #${MODAL_NAME} .bp-pre{scrollbar-width:none}
      #${MODAL_NAME} .bp-section{gap:8px}
      #${MODAL_NAME} .bp-card{padding:10px;border-radius:13px}
      #${MODAL_NAME} .bp-head{margin-bottom:5px}
      #${MODAL_NAME} .bp-row{gap:6px;margin-top:6px}
      #${MODAL_NAME} .bp-stat{padding:6px 9px;margin-top:5px}
      #${MODAL_NAME} .bp-grid,#${MODAL_NAME} .bp-pills{gap:6px}
      #${MODAL_NAME} .bp-pill{padding:7px 10px}
      #${MODAL_NAME} .bp-hero{padding:9px 12px;font-size:.9rem;border-radius:12px}
      #${MODAL_NAME} .bp-value{font-size:.88rem}
      #${MODAL_NAME} .bp-note{font-size:.68rem;margin-top:5px;line-height:1.3}
      #${MODAL_NAME} .bp-h{padding:2px 2px 0}
      #${MODAL_NAME} .bp-srow{padding:5px 0;gap:10px}
      #${MODAL_NAME} .bp-tabs{padding:3px;gap:4px}
      #${MODAL_NAME} .bp-tab{padding:6px 8px}
      #${MODAL_NAME} .bp-seg{padding:3px;gap:3px}
      #${MODAL_NAME} .bp-seg .bp-qs{padding:7px 4px}
      #${MODAL_NAME} button:not(.bp-switch):not(.bp-tab):not(.bp-qs):not(.bp-chip){padding:5px 11px}
      #${MODAL_NAME} input[type=number],#${MODAL_NAME} input[type=text]{padding:6px 9px}
      #${MODAL_NAME} .bp-pre{padding:7px 9px;max-height:180px}
      #${MODAL_NAME} .bp-card:has(>.bp-srow){padding:2px 12px;border-radius:12px}
      #${MODAL_NAME} #qs_tip{font-size:.66rem;line-height:1.25;margin:0;padding:0 2px}
      #${MODAL_NAME} .bp-tags{gap:4px}
      #${MODAL_NAME} .bp-ptag{padding:2px 7px;font-size:.66rem}
      #${MODAL_NAME} .bp-tags .bp-label{font-size:.64rem}
      #${MODAL_NAME} #qs_hero{font-size:.84rem;line-height:1.25}
      #${MODAL_NAME} .bp-srow{padding:3px 0;gap:8px;min-height:0}
      #${MODAL_NAME} .bp-srow .bp-rt{font-size:.82rem;line-height:1.2}
      #${MODAL_NAME} .bp-srow .bp-tag{padding:1px 6px;font-size:.6rem;margin-left:4px}
      #${MODAL_NAME} .bp-srow .bp-switch{width:34px;height:19px;background-size:19px 19px}
      #${MODAL_NAME} .bp-grid .bp-stat{padding:5px 9px;border-radius:10px}
      #${MODAL_NAME} .bp-grid .bp-label{font-size:.64rem}
      #${MODAL_NAME} .bp-grid .bp-value{font-size:.8rem;font-weight:700;white-space:normal;line-height:1.25}
      #${MODAL_NAME} .bp-grid{gap:5px}
      #${MODAL_NAME} .bp-head .bp-act{padding:3px 11px !important}
      #${MODAL_NAME} .bp-st-row{border-top:1px solid rgba(255,255,255,.08)}
      #${MODAL_NAME} .bp-st-row>summary{list-style:none;display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;margin:0;opacity:1}
      #${MODAL_NAME} .bp-st-row>summary::-webkit-details-marker{display:none}
      #${MODAL_NAME} .bp-st-ic{width:14px;text-align:center;flex:none;font-weight:800}
      #${MODAL_NAME} .bp-st-lb{flex:1;font-size:.74rem}
      #${MODAL_NAME} .bp-st-vl{font-size:.68rem;text-align:right;opacity:.9}
      #${MODAL_NAME} .bp-st-ch{opacity:.5;font-size:.7rem;transition:transform .15s}
      #${MODAL_NAME} .bp-st-row[open] .bp-st-ch{transform:rotate(90deg)}
      #${MODAL_NAME} .bp-st-dt{font-family:monospace;font-size:.58rem;opacity:.75;padding:0 0 4px 20px;line-height:1.35;word-break:break-all;white-space:pre-wrap}
      #${MODAL_NAME} .bp-st-bar{height:3px;background:rgba(255,255,255,.1);border-radius:2px;margin:0 0 5px 20px;overflow:hidden}
      #${MODAL_NAME} .bp-st-bar i{display:block;height:100%;width:0;background:#7db8ff;transition:width 1s linear}
      #${MODAL_NAME} #st_card{padding:6px 10px}
      #${MODAL_NAME} #st_card .bp-head{margin-bottom:2px}
      #${MODAL_NAME} .bp-st-meta{display:flex;justify-content:space-between;gap:8px;font-size:.6rem;line-height:1.3;opacity:.7;margin:0 0 3px}
      #${MODAL_NAME} .bp-st-meta #st_when{opacity:.8;white-space:nowrap}
      #${MODAL_NAME} .bp-st-spin{display:inline-block;animation:bpstspin .9s linear infinite}
      @keyframes bpstspin{to{transform:rotate(360deg)}}
      #${MODAL_NAME} .bp-pt{color:#64e6a4;font-weight:800;font-size:.84rem;letter-spacing:.2px;margin:8px 0 0}
      #${MODAL_NAME} .bp-pc{padding:7px 10px}
      #${MODAL_NAME} .bp-pc .bp-pt{font-size:.68rem;letter-spacing:.1px;margin:6px 0 0}
      #${MODAL_NAME} .bp-pc-sum{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;margin:0;padding:2px 0}
      #${MODAL_NAME} .bp-pc-sum::-webkit-details-marker{display:none}
      #${MODAL_NAME} .bp-pc-sum .bp-title{margin:0}
      #${MODAL_NAME} .bp-pc-ar{opacity:.6;font-size:.8rem;transition:transform .15s}
      #${MODAL_NAME} .bp-pc[open] .bp-pc-ar{transform:rotate(180deg)}
      #${MODAL_NAME} .bp-pc .bp-note,#${MODAL_NAME} .bp-pc .bp-note *,#${MODAL_NAME} .bp-pc .bp-st-cmd code,#${MODAL_NAME} .bp-pc .bp-st-cmd button{font-size:.6rem !important;line-height:1.3}
      #${MODAL_NAME} .bp-pc .bp-note{margin:2px 0 0;opacity:.8}
      #${MODAL_NAME} .bp-pc .bp-note:has(.bp-ck){display:flex;align-items:center;gap:6px}
      #${MODAL_NAME} .bp-ck{flex:0 0 auto;width:10px;text-align:center;color:#64e6a4;font-weight:900;font-style:normal;line-height:1}
      #${MODAL_NAME} .bp-ck.bp-xk{color:#ff8a8a}
      #${MODAL_NAME} .bp-pc .bp-st-cmd{gap:6px;padding:2px 4px 2px 7px;margin-top:2px;border-radius:7px}
      #${MODAL_NAME} .bp-pc .bp-st-cmd button{min-height:26px;padding:1px 9px !important;border-radius:7px}
      #${MODAL_NAME} .bp-st-cmd{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.06);border-radius:8px;padding:5px 8px;margin-top:4px}
      #${MODAL_NAME} .bp-st-cmd code{flex:1;font-family:monospace;font-size:.74rem;word-break:break-all}
      #${MODAL_NAME} .bp-wrap{overscroll-behavior:contain;will-change:scroll-position;scrollbar-gutter:stable}
      #${MODAL_NAME} .bp-pane{animation:bpfade .22s ease-out}
      @keyframes bpfade{from{opacity:0}to{opacity:1}}
      #${MODAL_NAME} .bp-value,#${MODAL_NAME} .bp-st-vl,#${MODAL_NAME} .bp-st-ic,#${MODAL_NAME} .bp-ptag,#${MODAL_NAME} .bp-pill{transition:color .25s,background-color .25s,border-color .25s}
      #${MODAL_NAME} .bp-hero{transition:color .3s,background-color .3s,border-color .3s}
      #${MODAL_NAME} details>summary{transition:opacity .15s}
      #${MODAL_NAME} .bp-pc-ar,#${MODAL_NAME} .bp-st-ch{transition:transform .2s ease}
      #${MODAL_NAME} .bp-st-bar i{transition:width 1s linear}
      #${MODAL_NAME} button,#${MODAL_NAME} .bp-switch{transition:background-color .2s,opacity .2s,transform .12s,border-color .2s,box-shadow .2s}
      #${MODAL_NAME} .bp-switch{transition:background-position .2s cubic-bezier(.4,0,.2,1),background-color .2s}
      #${MODAL_NAME} input[type=checkbox]{transition:background-position .2s cubic-bezier(.4,0,.2,1),background-color .2s}
      #${MODAL_NAME} .bp-pre{scroll-behavior:smooth;overscroll-behavior:contain}
      #${MODAL_NAME} .bp-sub{display:flex;gap:3px;padding:3px;border-radius:12px;background:rgba(0,0,0,.28)}
      #${MODAL_NAME} .bp-subt{flex:1;min-height:34px !important;padding:5px 2px !important;font-size:.74rem;font-weight:750;opacity:.5;background:transparent !important;border:0 !important;border-radius:9px !important}
      #${MODAL_NAME} .bp-subt.on{opacity:1;background:rgba(255,255,255,.14) !important}
      #${MODAL_NAME} .bp-sp{display:flex;flex-direction:column;gap:8px;animation:bpfade .2s ease-out}
      #${MODAL_NAME} .bp-sp>.bp-section{gap:8px}
      #${MODAL_NAME} .bp-split{padding-top:8px;border-top:1px solid rgba(255,255,255,.08)}
      #${MODAL_NAME} .bp-row label{font-size:.8rem}
      #${MODAL_NAME} .bp-chips{flex-wrap:wrap}
      #${MODAL_NAME} button.bp-sm{min-height:30px !important;padding:3px 10px !important;font-size:.72rem !important;border-radius:9px}
      #${MODAL_NAME} .bp-sm.bp-toggle::after{width:24px;height:14px;margin-left:6px;vertical-align:-3px;background-size:14px 14px;border-radius:7px}
      #${MODAL_NAME} .bp-row:has(>.bp-sm){gap:5px}
      #${MODAL_NAME} .bp-row .bp-nfqt{width:100%;display:flex;align-items:center;flex-wrap:nowrap;justify-content:space-between;gap:12px}
      #${MODAL_NAME} button#dpi_nfq_btn{min-width:60px !important;min-height:24px !important;padding:2px 8px !important;font-size:.66rem !important;border-radius:8px !important;flex:0 0 auto;width:84px !important;text-align:center;white-space:nowrap;transition:background-color .2s,opacity .2s}
      #${MODAL_NAME} #dpi_nfq_msg{min-height:2.6em;transition:background-color .2s}
      #${MODAL_NAME} #dpi_nfq_btn.bp-danger{background:rgba(255,100,100,.2) !important}
      #${MODAL_NAME} .bp-nfqh{display:flex;flex-direction:column;gap:1px;min-width:0}
      #${MODAL_NAME} .bp-nfqs{font-size:.66rem;opacity:.65}
      #${MODAL_NAME} .bp-row label.bp-nfqa{width:100%;flex-direction:column;align-items:stretch;gap:4px;font-size:.7rem;opacity:.9}
      #${MODAL_NAME} #dpi_nfq_msg{margin-top:0;padding:6px 9px;border-radius:9px;background:rgba(255,255,255,.05)}
      #${MODAL_NAME} .bp-nfqi{flex:1 1 auto}
      #${MODAL_NAME} *{-webkit-tap-highlight-color:transparent}
      #${MODAL_NAME} button,#${MODAL_NAME} summary,#${MODAL_NAME} .bp-switch{touch-action:manipulation;-webkit-user-select:none;user-select:none}
      #${MODAL_NAME} .bp-wrap{overflow-anchor:auto;-webkit-overflow-scrolling:touch}
      #${MODAL_NAME} .bp-value,#${MODAL_NAME} .bp-note{font-variant-numeric:tabular-nums}
      #${MODAL_NAME} .bp-grid .bp-stat{min-height:3.2em}
      #${MODAL_NAME} button:disabled{transition:opacity .2s}
      @media (prefers-reduced-motion:reduce){#${MODAL_NAME} *{animation:none !important;transition:none !important;scroll-behavior:auto !important}}
      @media (pointer:coarse){#${MODAL_NAME} button{min-height:40px}#${MODAL_NAME} .bp-chip{min-height:36px}#${MODAL_NAME} .bp-switch{min-height:0}}
      @media (max-width:700px){
        #${MODAL_NAME} .bp-wrap{height:calc(100vh - 360px - var(--bp-bar,48px));height:calc(100svh - 320px - var(--bp-bar,48px));min-height:240px;max-height:none;padding-bottom:16px}
      }
      @media (min-width:701px){
        #${MODAL_NAME} .bp-wrap{height:calc(80vh - 76px - var(--bp-bar,48px));height:calc(80svh - 76px - var(--bp-bar,48px));min-height:240px;max-height:none;padding-bottom:16px}
      }
      #${MODAL_NAME} .bp-grid .bp-stat{min-height:2.5em;padding:4px 9px}
      #${MODAL_NAME} .bp-tabs{position:static;margin-bottom:8px}
    `;
    document.head.appendChild(style);
  };

  const setPill = (box, label, cls, text) => {
    const row = document.createElement('div');
    row.className = 'bp-pill';
    const l = document.createElement('div'); l.className = 'bp-label'; l.textContent = label;
    const v = document.createElement('div'); v.className = `bp-value ${cls}`; v.textContent = text;
    row.append(l, v);
    box.appendChild(row);
  };
  const setSwitch = (id, on) => {
    const b = q(id);
    if (!b) return;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  };
  const showQs = (id) => {
    document.querySelectorAll(`#${MODAL_NAME} .bp-qs`).forEach((b) => b.classList.toggle('sel', b.id === id));
    const d = q('#qs_desc'); const b = q(`#${id}`);
    if (d && b?.dataset.d) d.textContent = b.dataset.d;
  };
  let qsPicked = false;
  const markQs = (id) => { qsPicked = true; showQs(id); };
  const PING_QUICK = [
    'if ping -c 1 -W 2 ' + PING_IP + ' >/dev/null 2>&1 || ping -c 1 -w 3 ' + PING_IP + ' >/dev/null 2>&1; then',
    '  echo "@@NET=1"',
    '  if ping -c 1 -W 2 ' + PING_HOST + ' >/dev/null 2>&1 || ping -c 1 -w 3 ' + PING_HOST + ' >/dev/null 2>&1; then echo "@@DNS=1"; else echo "@@DNS=0"; fi',
    'else',
    '  echo "@@NET=0"; echo "@@DNS=0"',
    'fi',
  ].join('\n');
  let lastCheckAt = 0;
  let ageTimer = null;
  const paintAge = () => {
    const e = q('#qs_age');
    if (!e) return;
    if (!lastCheckAt) { e.textContent = 'Checking…'; return; }
    const sec = Math.max(0, Math.round((Date.now() - lastCheckAt) / 1000));
    e.textContent = `Live · checked ${sec < 5 ? 'just now' : sec < 90 ? `${sec} s ago` : `${Math.round(sec / 60)} min ago`}`;
  };
  const paintTags = (ttl, dpi) => {
    const real = q('#qs_tags');
    if (!real) return;
    const box = real.cloneNode(false);
    const items = [];
    if (ttl.on) items.push(`TTL ${ttl.value || ''}`.trim());
    if (dpi.active && dpi.mss > 0) items.push(`TCP MSS ${dpi.mss}`);
    if (dpi.active && dpi.quic) items.push('QUIC blocked');
    if (dpi.nfq) items.push('nfqws');
    if (dpi.dns) items.push(`DNS ${dpi.dns}`);
    if (!items.length) items.push('Nothing applied');
    const l = document.createElement('span'); l.className = 'bp-label'; l.textContent = 'Applied now';
    box.appendChild(l);
    items.forEach((t) => { const x = document.createElement('span'); x.className = 'bp-ptag'; x.textContent = t; box.appendChild(x); });
    swapIn(real, box);
  };
  let autoTimer = null;
  let visFn = null;
  const stopAutoCheck = () => {
    if (visFn) { document.removeEventListener('visibilitychange', visFn); visFn = null; }
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    if (ageTimer) { clearInterval(ageTimer); ageTimer = null; }
  };
  const startAutoCheck = (sess) => {
    stopAutoCheck();
    let running = false;
    const tick = async () => {
      const el = document.getElementById(MODAL_NAME);
      if (sess !== session || !el || el.style.display === 'none') { stopAutoCheck(); return; }
      if (document.hidden) return;
      if (running || busy > 0) return;
      running = true;
      try { await runCheck(true, true); } catch (_) {  } finally { running = false; }
    };
    tick();
    autoTimer = setInterval(tick, 30000);
    visFn = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', visFn);
    ageTimer = setInterval(paintAge, 5000);
  };
  let lastNet = null;
  let lastDns = null;
  const runCheck = async (withPing = true, quick = false) => {
    const sess = session;
    const r = !withPing ? { text: '' } : await runRoot(quick ? PING_QUICK : '(ping -c 1 -W 3 ' + PING_IP + ' >/dev/null 2>&1 || ping -c 1 -w 4 ' + PING_IP + ' >/dev/null 2>&1) && echo "@@NET=1" || echo "@@NET=0"\n(ping -c 1 -W 3 ' + PING_HOST + ' >/dev/null 2>&1 || ping -c 1 -w 4 ' + PING_HOST + ' >/dev/null 2>&1) && echo "@@DNS=1" || echo "@@DNS=0"', 25000);
    if (quick && (sess !== session || busy > 0)) return;
    await ttlModule.refresh();
    await dpiModule.refresh();
    if (sess !== session) return;
    const kv = parseStatus(r.text).kv;
    if (withPing) { lastNet = kv.NET === '1'; lastDns = kv.DNS === '1'; lastCheckAt = Date.now(); }
    const net = lastNet;
    const dns = lastDns;
    const ttl = ttlModule.state();
    const ttlOn = ttl.on;
    const ttlBoot = ttl.boot;
    const dpi = dpiModule.state();
    const dpiBoot = dpi.boot;
    const ttlVal = String(ttl.value || '');
    const ttlEbpf = ttl.ebpf;
    const realBox = q('#qs_report');
    if (realBox) {
      const box = realBox.cloneNode(false);
      setPill(box, 'Internet', net === null ? 'bp-warn' : net ? 'bp-good' : 'bp-bad', net === null ? 'Not tested' : net ? 'Reachable' : 'No connection');
      setPill(box, 'DNS', dns === null ? 'bp-warn' : dns ? 'bp-good' : (net ? 'bp-warn' : 'bp-bad'), dns === null ? 'Not tested' : dns ? 'Working' : 'Not working');
      setPill(box, 'TTL', ttlOn ? 'bp-good' : 'bp-bad', ttlOn ? `${ttlVal || 'On'}${ttlEbpf ? ' · eBPF' : ''}` : 'Not active');
      const dpiParts = [];
      if (dpi.active && dpi.mss > 0) dpiParts.push(`MSS ${dpi.mss}`);
      if (dpi.active && dpi.quic) dpiParts.push('QUIC');
      if (dpi.nfq) dpiParts.push('nfqws');
      if (dpi.dns) dpiParts.push('DNS');
      setPill(box, 'Anti-DPI', dpi.working ? 'bp-good' : '', dpi.working ? (dpiParts.join(' · ') || 'Active') : 'Off');
      swapIn(realBox, box);
    }
    const quicOn = dpi.active && dpi.quic;
    const bootOn = ttlBoot && (!dpi.active || dpiBoot);
    setSwitch('#qs_quic', quicOn);
    setSwitch('#qs_boot', bootOn);
    paintTags(ttl, dpi);
    paintAge();
    let tip;
    if (net === false) tip = 'The router has no internet. Turn mobile data on, or check the SIM balance, signal and APN. This plugin cannot fix that. Your rules stay applied in the meantime.';
    else if (!ttlOn) tip = 'TTL is not active. Tap Standard above to turn it on.';
    else if (!bootOn) tip = 'Turn on Auto-apply at boot so the rules come back after a restart.';
    else if (dns === false) tip = 'The internet works but the router cannot look up names. A DNS redirect (Advanced tab, Anti-DPI) can help hotspot devices that send DNS to another server, but it does not change the router\'s own lookups, and devices that use the router itself (192.168.0.1) as DNS are not redirected.';
    else if (quicOn) tip = 'Everything looks good. If apps or pages feel slow, turn Block QUIC off.';
    else {
      const strongOn = dpi.active && dpi.mss > 0;
      const otherTtl = ttlVal === '65' ? 64 : 65;
      tip = `Everything looks good. If your carrier still limits the hotspot, ${strongOn ? '' : 'try Strong, or '}change the TTL to ${otherTtl}.` + (net === null ? ' Press Run check to test the internet.' : '');
    }
    const tipEl = q('#qs_tip'); if (tipEl) tipEl.textContent = tip;
    if (!qsPicked) showQs(ttlOn && dpi.active && dpi.mss > 0 ? 'qs_strong' : ttlOn ? 'qs_std' : 'qs_stop');
    const hero = q('#qs_hero');
    if (hero) {
      const ready = net !== false && ttlOn && bootOn;
      hero.className = `bp-hero ${ready ? 'on' : (net !== false ? 'warn' : 'off')}`;
      const dpiBits = [];
      if (dpi.active && dpi.mss > 0) dpiBits.push(`MSS ${dpi.mss}`);
      if (dpi.active && dpi.quic) dpiBits.push('QUIC block');
      if (dpi.nfq) dpiBits.push('nfqws');
      if (dpi.dns) dpiBits.push(`DNS ${dpi.dns}`);
      const what = `TTL ${ttlVal}`.trim() + (dpi.working ? ` + Anti-DPI${dpiBits.length ? ` (${dpiBits.join(', ')})` : ''}` : '');
      hero.textContent = ready ? `● Protected: ${what} active` : (net !== false ? '● Almost ready: see the tip below' : (ttlOn ? '● No internet from the router. Your rules stay applied' : '● No internet from the router'));
    }
  };

  const quickStep = async (label, fn) => {
    try { return await fn(); } catch (e) { throw new Error(`${label}: ${e?.message || e}`); }
  };
  const ensureScripts = async () => {
    const a = await ttlModule.ensureScript();
    const b = await dpiModule.ensureScript();
    return a || b;
  };
  const refreshAfter = (fn) => async () => {
    let err = null;
    try { await fn(); } catch (e) { err = e; qsPicked = false; }
    try { await runCheck(); } catch (e) { err = err || e; }
    if (err) throw err;
  };

  const ST_READ = String.raw`D=/data/local/ufi_ttl
P=/data/local/ufi_dpi
echo "@@METH=$(cat $D/method 2>/dev/null)"
echo "@@SAVED=$(sed -n 's/^TTL=\([0-9][0-9]*\).*/\1/p' $D/ttl.conf 2>/dev/null | head -n 1)"
echo "@@BINVAL=$(dd if=$D/ttl_bpf.bin bs=1 skip=4 count=1 2>/dev/null | od -An -tu1 | tr -d ' ')"
echo "@@EXP=$( ( sha1sum $D/ttl_bpf.bin || busybox sha1sum $D/ttl_bpf.bin || toybox sha1sum $D/ttl_bpf.bin || openssl dgst -sha1 $D/ttl_bpf.bin ) 2>/dev/null | grep -oE '[0-9a-f]{40}' | head -n 1 | cut -c1-16)"
${LAN_SH}
TCB=$(command -v tc 2>/dev/null)
for i in $LANIFS; do
  [ -d /sys/class/net/$i ] || continue
  t=$( { "$TCB" filter show dev $i ingress; "$TCB" filter show dev $i parent ffff:; } 2>/dev/null )
  tag=$(echo "$t" | grep ttl_bpf | sed -n 's/.* tag \([0-9a-f][0-9a-f]*\).*/\1/p' | head -n 1)
  ours=$(echo "$t" | grep ttl_bpf | sed -n 's/.* pref \([0-9][0-9]*\).*/\1/p' | head -n 1)
  [ -n "$ours" ] || ours=x
  oth=$(echo "$t" | sed -n 's/.* pref \([0-9][0-9]*\).*/\1/p' | grep -vx "$ours" | sort -n | head -n 1)
  [ "$ours" = x ] && ours=
  echo "@@IF=$i|$tag|$ours|$oth"
done
echo "@@IPT=$(ipt iptables -t mangle -S UFI_TTL 2>/dev/null | sed -n 's/.*--ttl-set \([0-9][0-9]*\).*/\1/p' | head -n 1)"
echo "@@MSSCONF=$(sed -n "s/^MSS='\([0-9]*\)'.*/\1/p" $P/dpi.conf 2>/dev/null | head -n 1)"
echo "@@MSSRULE=$(ipt iptables -t mangle -S UFI_DPI 2>/dev/null | sed -n 's/.*--set-mss \([0-9][0-9]*\).*/\1/p' | head -n 1)"
if ipt iptables -t mangle -C POSTROUTING -j UFI_DPI 2>/dev/null; then echo "@@MSSLINK=1"; else echo "@@MSSLINK=0"; fi
echo "@@QUICCONF=$(sed -n "s/^QUIC='\([01]\)'.*/\1/p" $P/dpi.conf 2>/dev/null | head -n 1)"
echo "@@QUICRULE=$(ipt iptables -t mangle -S UFI_DPI 2>/dev/null | grep -c -E 'udp.*--dport 443 -j DROP')"
`;
  const ST_COUNT = PRELUDE + 'ipt iptables -t mangle -L UFI_DPI -v -n -x 2>/dev/null';
  const stCounts = async () => {
    const r = await runRoot(ST_COUNT);
    const out = { mss: null, quic: null };
    for (const line of r.text.split('\n')) {
      let m = line.match(/^\s*(\d+)\s+\d+\s+TCPMSS\b/);
      if (m) out.mss = Number(m[1]);
      m = line.match(/^\s*(\d+)\s+\d+\s+DROP\b/);
      if (m) out.quic = Number(m[1]);
    }
    return out;
  };
  const stRows = (kv, ifs, ttlOn, dpiOn) => {
    const rows = [];
    const saved = Number(kv.SAVED);
    const savedOk = Number.isInteger(saved) && saved >= 1 && saved <= 255;
    if (!ttlOn) {
      rows.push({ state: 'off', value: 'Off', detail: 'The TTL rule is not active. Press Standard to turn it on.' });
      rows.push({ state: 'off', value: 'Off', detail: 'The TTL rule is not active.' });
    } else if (kv.METH === 'bpf') {
      const tags = ifs.filter((x) => x.tag).map((x) => x.tag);
      const exp = kv.EXP || '';
      const binTtl = Number(kv.BINVAL) - 1;
      let r1;
      if (!tags.length) r1 = { state: 'bad', value: 'Not attached', detail: 'No hotspot interface carries the TTL filter.' };
      else if (!exp || tags.some((t) => t !== exp)) r1 = { state: 'warn', value: 'Tag differs', detail: `Kernel tag ${tags[0]}\nExpected    ${exp || 'unknown'}\nThe filter is attached. If TTL works in the PC test, ignore this.` };
      else if (savedOk && binTtl !== saved) r1 = { state: 'bad', value: `${binTtl}, not ${saved}`, detail: `The loaded program sets ${binTtl}.\nThe saved value is ${saved}.` };
      else r1 = { state: 'ok', value: savedOk ? String(saved) : String(binTtl), detail: `Kernel tag ${tags[0]}\nExpected    ${exp}` };
      rows.push(r1);
      const present = ifs.length;
      const have = ifs.filter((x) => x.tag).length;
      const first = ifs.filter((x) => x.tag && x.other && Number(x.pref) >= Number(x.other)).map((x) => x.name);
      let r2;
      if (!present) r2 = { state: 'bad', value: 'No interface', detail: `None of the hotspot interfaces exists right now (looked for ${LAN_IFS}, leaving out any that carry the default route).` };
      else if (have < present) r2 = { state: 'bad', value: `${have} of ${present}`, detail: `Missing on: ${ifs.filter((x) => !x.tag).map((x) => x.name).join(', ')}` };
      else if (first.length) r2 = { state: 'bad', value: 'Runs late', detail: `Another filter runs first on: ${first.join(', ')}` };
      else {
        const pr = ifs[0].pref;
        const oth = ifs.map((x) => x.other).filter(Boolean).sort((a, b) => a - b)[0];
        r2 = { state: 'ok', value: `${have} of ${present}`, detail: `${ifs.map((x) => x.name).join(' · ')}\nPriority ${pr}${oth ? `, ahead of ${oth}` : ''}` };
      }
      rows.push(r2);
    } else {
      const got = Number(kv.IPT);
      if (kv.IPT && got === saved) rows.push({ state: 'ok', value: String(saved), detail: `The firewall rule sets TTL ${got}.` });
      else rows.push({ state: 'bad', value: kv.IPT ? `${got}, not ${saved}` : 'No rule', detail: `Firewall rule: ${kv.IPT || 'none'}\nSaved value: ${kv.SAVED || 'none'}` });
      rows.push({ state: 'off', value: 'Not used', detail: 'The firewall method has no interface list to check.' });
    }
    const mss = Number(kv.MSSCONF) || 0;
    if (!dpiOn) {
      rows.push({ state: 'off', value: 'Off', detail: 'Anti-DPI is off. Press Strong to use the TCP MSS.' });
    } else if (!mss) {
      rows.push({ state: 'off', value: 'Not used', detail: 'The saved TCP MSS is 0.' });
    } else if (kv.MSSLINK !== '1') {
      rows.push({ state: 'bad', value: 'Not linked', detail: 'The Anti-DPI chain is not linked to the firewall. Press Strong to re-apply.' });
    } else if (!kv.MSSRULE) {
      rows.push({ state: 'bad', value: 'Rule missing', detail: `Saved value ${mss} but no TCPMSS rule exists. Press Strong to re-apply.` });
    } else if (Number(kv.MSSRULE) !== mss) {
      rows.push({ state: 'bad', value: `${kv.MSSRULE}, not ${mss}`, detail: `The rule sets ${kv.MSSRULE}. The saved value is ${mss}.` });
    } else {
      rows.push({ state: 'ok', value: String(mss), detail: `TCPMSS rule present\nSaved value ${mss}` });
    }
    rows.push(rows[2].state === 'ok'
      ? { state: 'wait', value: 'Browse now', detail: 'Counter read twice, 10 s apart.\nIdle is not a failure.' }
      : { state: 'off', value: rows[2].state === 'off' ? 'Off' : 'Skipped', detail: 'Needs a working TCP MSS rule.' });
    const quicSaved = kv.QUICCONF === '1';
    const quicRule = Number(kv.QUICRULE) > 0;
    if (!dpiOn) {
      rows.push({ state: 'off', value: 'Off', detail: 'Anti-DPI is off. Turn on Block QUIC to use this.' });
    } else if (!quicSaved) {
      rows.push(quicRule
        ? { state: 'warn', value: 'Still on', detail: 'Block QUIC is saved as off, but the UDP 443 DROP rule still exists. Press Apply on the Advanced tab.' }
        : { state: 'off', value: 'Off', detail: 'Block QUIC is off.' });
    } else if (kv.MSSLINK !== '1') {
      rows.push({ state: 'bad', value: 'Not linked', detail: 'The Anti-DPI chain is not linked to the firewall. Press Strong to re-apply.' });
    } else if (!quicRule) {
      rows.push({ state: 'bad', value: 'Rule missing', detail: 'Block QUIC is saved as on but no UDP 443 DROP rule exists. Switch Block QUIC off and on again.' });
    } else {
      rows.push({ state: 'ok', value: 'Blocking', detail: 'UDP 443 DROP rule present\nSaved Block QUIC: on' });
    }
    rows.push(rows[4].state === 'ok'
      ? { state: 'wait', value: 'Browse now', detail: 'Counter read twice, 10 s apart.\nIdle is not a failure.' }
      : { state: 'off', value: rows[4].state === 'off' ? 'Off' : 'Skipped', detail: 'Needs a working QUIC rule.' });
    return rows;
  };
  const ST_GLYPH = { ok: '●', bad: '●', warn: '●', wait: '…', off: '–', run: '◌' };
  const ST_DOT = { ok: 1, bad: 1, warn: 1 };
  const ST_CLS = { ok: 'bp-good', bad: 'bp-bad', warn: 'bp-warn', wait: 'bp-warn', off: '', run: '' };
  const stPaint = (n, row) => {
    const ic = q(`#st_i${n}`); if (ic) { ic.textContent = ST_GLYPH[row.state]; ic.style.fontSize = ST_DOT[row.state] ? '10px' : ''; ic.className = `bp-st-ic ${ST_CLS[row.state]}${row.state === 'run' ? ' bp-st-spin' : ''}`; }
    const v = q(`#st_v${n}`); if (v) { v.textContent = row.value; v.className = `bp-st-vl ${ST_CLS[row.state]}`; }
    const d = q(`#st_d${n}`); if (d && row.detail !== undefined) d.textContent = row.detail;
  };
  const stSummary = (rows) => {
    const live = rows.filter((r) => r.state !== 'off');
    if (!live.length) return 'Nothing to test. Press Standard or Strong first.';
    const c = (st) => live.filter((r) => r.state === st).length;
    const parts = [];
    if (c('ok')) parts.push(`${c('ok')} passed`);
    if (c('bad')) parts.push(`${c('bad')} failed`);
    if (c('warn')) parts.push(`${c('warn')} to check`);
    if (c('wait')) parts.push(`${c('wait')} waiting`);
    return parts.join(' · ');
  };
  let stSaved = null;
  const runSelfTest = async () => {
    const sess = session;
    const fix = q('#st_fix'); if (fix) fix.style.display = 'none';
    const bar = q('#st_bar'); if (bar) bar.style.display = 'none';
    const bar2 = q('#st_bar2'); if (bar2) bar2.style.display = 'none';
    for (let n = 1; n <= 6; n++) stPaint(n, { state: 'run', value: '…' });
    const sum = q('#st_sum'); if (sum) sum.textContent = 'Running…';
    await ttlModule.refresh();
    await dpiModule.refresh();
    const r = await runRoot(PRELUDE + ST_READ, 25000);
    if (sess !== session) return;
    const kv = parseStatus(r.text).kv;
    const ifs = r.text.split('\n').filter((l) => l.startsWith('@@IF=')).map((l) => {
      const [name, tag, pref, other] = l.slice(5).split('|');
      return { name, tag, pref, other };
    });
    const ttlS = ttlModule.state();
    const dpiS = dpiModule.state();
    const rows = stRows(kv, ifs, Boolean(ttlS.on || ttlS.boot || ttlS.watching), Boolean(dpiS.active || dpiS.boot));
    for (let n = 1; n <= 3; n++) stPaint(n, rows[n - 1]);
    stPaint(5, rows[4]);
    const wMss = rows[3].state === 'wait';
    const wQuic = rows[5].state === 'wait';
    if (!wMss) stPaint(4, rows[3]);
    if (!wQuic) stPaint(6, rows[5]);
    if (wMss || wQuic) {
      const before = await stCounts();
      if (wMss) stPaint(4, { state: 'wait', value: 'Browse now' });
      if (wQuic) stPaint(6, { state: 'wait', value: 'Browse now' });
      if (wMss && bar) bar.style.display = 'block';
      if (wQuic && bar2) bar2.style.display = 'block';
      const bi = q('#st_bi');
      const bi2 = q('#st_bi2');
      if (bi) bi.style.width = '0';
      if (bi2) bi2.style.width = '0';
      for (let t = 1; t <= 10; t++) {
        await sleep(1000);
        if (sess !== session) return;
        if (bi) bi.style.width = `${t * 10}%`;
        if (bi2) bi2.style.width = `${t * 10}%`;
        if (t < 10) [[wMss, 4], [wQuic, 6]].forEach(([on, n]) => { const v = on && q(`#st_v${n}`); if (v) v.textContent = `${10 - t} s`; });
      }
      const after = await stCounts();
      if (sess !== session) return;
      if (wMss) {
        if (before.mss === null || after.mss === null) rows[3] = { state: 'wait', value: 'No counter', detail: 'The TCPMSS counter could not be read.' };
        else if (after.mss > before.mss) rows[3] = { state: 'ok', value: `+${after.mss - before.mss} starts`, detail: `Counter ${before.mss} → ${after.mss} in 10 s` };
        else rows[3] = { state: 'wait', value: 'No new connections', detail: `Counter stayed at ${after.mss}. Open a few pages while it counts down.` };
      }
      if (wQuic) {
        if (before.quic === null || after.quic === null) rows[5] = { state: 'wait', value: 'No counter', detail: 'The QUIC DROP counter could not be read.' };
        else if (after.quic > before.quic) rows[5] = { state: 'ok', value: `+${after.quic - before.quic} dropped`, detail: `Counter ${before.quic} → ${after.quic} in 10 s` };
        else rows[5] = { state: 'wait', value: 'Nothing dropped', detail: `Counter stayed at ${after.quic}. The browser or carrier may not be using QUIC, or it already fell back to TCP. Idle is not a failure.` };
      }
      if (bar) bar.style.display = 'none';
      if (bar2) bar2.style.display = 'none';
    }
    stPaint(4, rows[3]);
    stPaint(6, rows[5]);
    if (sum) sum.textContent = stSummary(rows);
    const when = q('#st_when'); if (when) when.textContent = `Last run ${new Date().toTimeString().slice(0, 5)}`;
    stSaved = Number(kv.SAVED);
    const ttlBad = rows[0].state === 'bad' || rows[1].state === 'bad';
    if (fix && ttlBad && Number.isInteger(stSaved) && stSaved >= 1 && stSaved <= 255) {
      const fb = q('#st_fixb'); if (fb) fb.textContent = `Re-apply TTL ${stSaved}`;
      fix.style.display = 'block';
    }
  };

  const openModal = async () => {
    ensureStyle();
    document.getElementById(MODAL_NAME)?.remove();
    session += 1;
    busy = 0;
    qsPicked = false;
    lastCheckAt = 0;
    const created = createModal({
      name: MODAL_NAME,
      title: TITLE,
      maxWidth: '640px',
      contentStyle: 'max-height:80vh;',
      showConfirm: false,
      onClose: () => true,
      content: `
        <div class="bp-wrap">
          <div class="bp-tabs"><button type="button" class="bp-tab on" data-tab="qs">Quick setup</button><button type="button" class="bp-tab" data-tab="adv">Advanced</button></div>
          <div class="bp-pane" data-pane="qs">
            <div class="bp-section">
              <div id="qs_hero" class="bp-hero warn">● Checking…</div>
              <div id="qs_report" class="bp-pills"></div>
              <div class="bp-seg">
                <button class="bp-act bp-qs" id="qs_stop" data-d="All bypass rules are removed. Hotspot traffic is sent unchanged. Your saved settings are kept.">Off</button>
                <button class="bp-act bp-qs" id="qs_std" data-d="Sets TTL only (your saved value, or ${QUICK_TTL} if none). No speed loss. Best place to start. Anti-DPI is turned off, so the result is the same whatever mode you used before. Your saved Anti-DPI settings are kept; Block QUIC from here applies QUIC only.">Standard</button>
                <button class="bp-act bp-qs" id="qs_strong" data-d="Sets TTL (your saved value, or ${QUICK_TTL} if none), plus TCP MSS 1360 and ALL your saved Advanced settings (DNS redirect, Block QUIC, nfqws), which are switched on too. Use it if your carrier still detects hotspot use.">Strong</button>
              </div>
              <div id="qs_tags" class="bp-tags"></div>
              <div class="bp-card">
                <div class="bp-srow">
                  <div><div class="bp-rt">Block QUIC <span class="bp-tag">May slow some apps</span></div></div>
                  <button type="button" class="bp-act bp-switch" id="qs_quic" role="switch" aria-checked="false" aria-label="Block QUIC"></button>
                </div>
                <div class="bp-srow">
                  <div><div class="bp-rt">Auto-apply at boot</div></div>
                  <button type="button" class="bp-act bp-switch" id="qs_boot" role="switch" aria-checked="false" aria-label="Auto-apply at boot"></button>
                </div>
              </div>
              <div id="qs_tip" class="bp-note" style="margin-top:0"></div>
              <div class="bp-card" id="st_card">
                <div class="bp-head"><span class="bp-title">Self-test</span><button class="bp-act" id="st_run">Run</button></div>
                <div class="bp-st-meta"><span id="st_sum">Press Run to test the TTL, MSS and QUIC rules.</span><span id="st_when">Not run yet</span></div>
                <details class="bp-st-row"><summary><span class="bp-st-ic" id="st_i1">–</span><span class="bp-st-lb">TTL value</span><span class="bp-st-vl" id="st_v1">—</span><span class="bp-st-ch">›</span></summary><div class="bp-st-dt" id="st_d1">Run the self-test to compare the loaded TTL filter with the expected one.</div></details>
                <details class="bp-st-row"><summary><span class="bp-st-ic" id="st_i2">–</span><span class="bp-st-lb">TTL coverage</span><span class="bp-st-vl" id="st_v2">—</span><span class="bp-st-ch">›</span></summary><div class="bp-st-dt" id="st_d2">Shows which hotspot interfaces have the TTL filter.</div></details>
                <div id="st_fix" style="display:none;padding:0 0 4px 22px"><button class="bp-act" id="st_fixb">Re-apply TTL</button></div>
                <details class="bp-st-row"><summary><span class="bp-st-ic" id="st_i3">–</span><span class="bp-st-lb">MSS rule</span><span class="bp-st-vl" id="st_v3">—</span><span class="bp-st-ch">›</span></summary><div class="bp-st-dt" id="st_d3">Checks that the TCP MSS firewall rule exists and matches your saved value.</div></details>
                <details class="bp-st-row"><summary><span class="bp-st-ic" id="st_i4">–</span><span class="bp-st-lb">MSS traffic</span><span class="bp-st-vl" id="st_v4">—</span><span class="bp-st-ch">›</span></summary><div class="bp-st-dt" id="st_d4">Reads the counter twice, 10 s apart, to see whether connections are being adjusted.</div></details>
                <div class="bp-st-bar" id="st_bar" style="display:none"><i id="st_bi"></i></div>
                <details class="bp-st-row"><summary><span class="bp-st-ic" id="st_i5">–</span><span class="bp-st-lb">QUIC rule</span><span class="bp-st-vl" id="st_v5">—</span><span class="bp-st-ch">›</span></summary><div class="bp-st-dt" id="st_d5">Checks the firewall rule that blocks UDP port 443 (QUIC).</div></details>
                <details class="bp-st-row"><summary><span class="bp-st-ic" id="st_i6">–</span><span class="bp-st-lb">QUIC traffic</span><span class="bp-st-vl" id="st_v6">—</span><span class="bp-st-ch">›</span></summary><div class="bp-st-dt" id="st_d6">Reads the blocked-packet counter twice, 10 s apart.</div></details>
                <div class="bp-st-bar" id="st_bar2" style="display:none"><i id="st_bi2"></i></div>
              </div>
              <details class="bp-card bp-pc">
                <summary class="bp-pc-sum"><span class="bp-title">Test from your PC</span><span class="bp-pc-ar">▾</span></summary>
                <div class="bp-pt">TTL</div>
                <div class="bp-st-cmd"><code>ping -i 1 -n 1 8.8.8.8</code><button class="bp-act" id="st_c1">Copy</button></div>
                <div class="bp-note"><span class="bp-ck">✓</span>Reply from 8.8.8.8</div>
                <div class="bp-note"><span class="bp-ck bp-xk">✕</span>"TTL expired in transit" from 192.168.0.1</div>
                <div class="bp-pt">Path</div>
                <div class="bp-st-cmd"><code>tracert -d 8.8.8.8</code><button class="bp-act" id="st_c2">Copy</button></div>
                <div class="bp-note"><span class="bp-ck">✓</span> Hop 1 is 8.8.8.8</div>
                <div class="bp-pt">QUIC</div>
                <div class="bp-note">Normal Chrome shows http/2, so open it in a special test mode. Close Chrome completely (also from the system tray), press Win+R and run:</div>
                <div class="bp-st-cmd"><code>chrome.exe --enable-quic --origin-to-force-quic-on=www.cloudflare.com:443</code><button class="bp-act" id="st_c3">Copy</button></div>
                <div class="bp-note">Then open <b>https://www.cloudflare.com/cdn-cgi/trace</b></div>
                <div class="bp-note"><span class="bp-ck">✓</span> Block QUIC off: the page opens and shows http/3</div>
                <div class="bp-note"><span class="bp-ck">✓</span> Block QUIC on: the page does not open</div>
                <div class="bp-note"><span class="bp-ck bp-xk">✕</span> Block QUIC on: the page opens and shows http/3</div>
              </details>
              <details class="bp-card bp-pc">
                <summary class="bp-pc-sum"><span class="bp-title">Info</span><span class="bp-pc-ar">▾</span></summary>
                <div class="bp-pt">Mode</div>
                <div id="qs_desc" class="bp-note">Pick a mode above. Turn on Auto-apply at boot to keep it after a restart.</div>
                <div class="bp-pt">Block QUIC</div>
                <div class="bp-note">Makes apps that use HTTP/3 (QUIC) fall back to normal TCP, which can be adjusted by the other rules. VPNs that use UDP port 443 stop working while this is on.</div>
                <div class="bp-pt">Auto-apply at boot</div>
                <div class="bp-note">Applies the rules again after every restart. A keep-alive also restores them if the mobile connection resets them. The boot entry is stored in /sdcard/ufi_tools_boot.sh and runs as root. If you save that file in the UFI-TOOLS boot script editor, the entry is overwritten, so turn this switch on again afterwards. Other apps with storage access can also edit that file, and everything in it runs as root, so the plugin warns you if it finds commands it did not add.</div>
                <div class="bp-pt">Boot file check</div>
                <div class="bp-note">The plugin keeps a SHA-256 of the boot file in /data/local/ufi_boot, where apps cannot write, and warns when the file no longer matches. It can warn but cannot stop the file from running at boot.</div>
                <div id="boot_int" class="bp-note">Checking…</div>
                <button class="bp-act bp-sm" id="boot_trust">Trust current boot file</button>
              </details>
            </div>
          </div>
          <div class="bp-pane" data-pane="adv" style="display:none">
            <div class="bp-section">
              <div class="bp-sub"><button type="button" class="bp-subt on" data-sub="ttl">TTL</button><button type="button" class="bp-subt" data-sub="dpi">Anti-DPI</button><button type="button" class="bp-subt" data-sub="nfq">nfqws</button><button type="button" class="bp-subt" data-sub="tools">Tools</button></div>
              <div class="bp-sp" data-sp="ttl">${ttlModule.html}</div>
              <div class="bp-sp" data-sp="dpi" style="display:none">${dpiModule.html}</div>
              <div class="bp-sp" data-sp="nfq" style="display:none">${dpiModule.nfq}</div>
              <div class="bp-sp" data-sp="tools" style="display:none">${ttlModule.tools}${dpiModule.tools}</div>
            </div>
          </div>
        </div>
        <div class="bp-bar">
          <button class="bp-act bp-primary" id="qs_check">Run check</button>
          <button class="bp-act" id="qs_report_copy">Copy report</button>
        </div>`,
    });
    if (!created?.id) throw new Error('createModal did not return a dialog (is the page fully loaded?)');
    modalEl = created.el;
    ttlModule.bind();
    dpiModule.bind();
    q('#qs_check').onclick = guarded(runCheck, 'Checking…');
    q('#st_run').onclick = guarded(runSelfTest, 'Testing…');
    q('#st_fixb').onclick = guarded(async () => { await ttlModule.reapply(stSaved); await runSelfTest(); }, 'Fixing…');
    q('#st_c1').onclick = () => copyText('ping -i 1 -n 1 8.8.8.8', 'Command copied');
    q('#st_c2').onclick = () => copyText('tracert -d 8.8.8.8', 'Command copied');
    q('#st_c3').onclick = () => copyText('chrome.exe --enable-quic --origin-to-force-quic-on=www.cloudflare.com:443', 'Command copied');
    q('#qs_std').onclick = guarded(refreshAfter(async () => { markQs('qs_std'); await quickStep('Helper scripts', ensureScripts); await quickStep('TTL step (Anti-DPI was not changed)', () => ttlModule.setup(QUICK_TTL)); await quickStep('Turning Anti-DPI off (TTL is already on)', () => dpiModule.stopAll()); }), 'Setting up…');
    q('#qs_quic').onclick = guarded(refreshAfter(async () => { await dpiModule.setQuic(q('#qs_quic').getAttribute('aria-checked') !== 'true'); }), '');
    q('#qs_boot').onclick = guarded(refreshAfter(async () => {
      const want = q('#qs_boot').getAttribute('aria-checked') !== 'true';
      await ttlModule.setBoot(want);
      if (!want || dpiModule.state().active) await dpiModule.setBoot(want);
    }), '');
    q('#qs_report_copy').onclick = guarded(async () => {
      await ttlModule.diagnose();
      await dpiModule.diagnose();
      const get = (sel) => (q(sel)?.textContent || '').trim();
      const yn = (v, a, b) => (v === null ? 'not tested' : v ? a : b);
      const text = [
        `Bypass report ${new Date().toISOString()}`,
        `Status: ${get('#qs_hero').replace(/^●\s*/, '')}`,
        `Internet: ${yn(lastNet, 'reachable', 'no connection')} | DNS: ${yn(lastDns, 'working', 'not working')}`,
        '',
        '===== TTL =====',
        get('#ttl_diag'),
        '',
        '===== ANTI-DPI =====',
        get('#dpi_diag'),
      ].join('\n');
      await copyText(text, 'Full report copied');
    }, 'Collecting…');
    q('#qs_strong').onclick = guarded(refreshAfter(async () => { markQs('qs_strong'); await quickStep('Helper scripts', ensureScripts); await quickStep('TTL step (Anti-DPI was not applied)', () => ttlModule.setup(QUICK_TTL)); await quickStep('Anti-DPI step (TTL is already on)', () => dpiModule.setup()); }), 'Setting up…');
    q('#qs_stop').onclick = guarded(async () => {
      markQs('qs_stop');
      const errs = [];
      for (const m of [ttlModule, dpiModule]) { try { await m.stopAll(); } catch (e) { errs.push(e); } }
      try { await runCheck(); } catch (e) { errs.push(e); }
      if (errs.length) throw errs[0];
      const still = ttlModule.state().on || dpiModule.state().any;
      if (still) toast('Some rules are still active. Check the status above, or use Remove on the Advanced tab', 'orange', 7000);
      else toast('Everything stopped: rules removed, auto-apply at boot off, keep-alive stopped', 'green', 5000);
    }, 'Stopping…');
    const tabs = modalEl.querySelectorAll('.bp-tab');
    tabs.forEach((t) => {
      t.onclick = () => {
        tabs.forEach((x) => x.classList.toggle('on', x === t));
        modalEl.querySelectorAll('.bp-pane').forEach((pn) => { pn.style.display = pn.dataset.pane === t.dataset.tab ? '' : 'none'; });
        modalEl.querySelector('.bp-wrap')?.scrollTo?.({ top: 0, behavior: 'instant' });
      };
    });
    const subs = modalEl.querySelectorAll('.bp-subt');
    subs.forEach((t) => {
      t.onclick = () => {
        subs.forEach((x) => x.classList.toggle('on', x === t));
        modalEl.querySelectorAll('.bp-sp').forEach((p) => { p.style.display = p.dataset.sp === t.dataset.sub ? '' : 'none'; });
      };
    });
    showModal(created.id);
    const moveTabs = () => {
      try {
        const wrap = q('.bp-wrap');
        if (!wrap) return;
        const first = wrap.firstElementChild;
        if (first?.classList.contains('bp-tabs')) wrap.parentElement.insertBefore(first, wrap);
        const h = q('.bp-tabs')?.offsetHeight || 0;
        const v = `${h + 8}px`;
        if (h && wrap.style.getPropertyValue('--bp-bar') !== v) wrap.style.setProperty('--bp-bar', v);
      } catch (_) {  }
    };
    moveTabs();
    sleep(450).then(moveTabs);
    const moveClose = () => {
      try {
        const bar = q('.bp-bar');
        if (!bar || bar.querySelector('.bp-close')) return;
        const btn = [...modalEl.querySelectorAll('button')].find((b) => !b.closest('.bp-wrap') && !b.closest('.bp-bar') && /^\s*close\s*$/i.test(b.textContent || ''));
        if (!btn) return;
        const old = btn.parentElement;
        btn.classList.add('bp-close');
        bar.appendChild(btn);
        if (old && old !== modalEl && !old.querySelector('button, input, select, textarea') && !(old.textContent || '').trim()) old.style.display = 'none';
      } catch (_) {  }
    };
    moveClose();
    sleep(450).then(moveClose);
    const trustBtn = q('#boot_trust');
    if (trustBtn) trustBtn.onclick = guarded(trustBoot);
    await Promise.all([ttlModule.init(), dpiModule.init()]);
    try {
      if (await ensureScripts()) toast('Helper scripts updated (a running keep-alive was restarted). Press Strong, or Save and apply on the Anti-DPI tab, once to rebuild the rules.', 'orange', 8000);
    } catch (_) {  }
    try { await runCheck(false); } catch (_) {  }
    startAutoCheck(session);
    warnForeignBoot(true).catch(() => {  });
  };

  let cancelled = false;
  let keepTimer = null;
  const mainButton = document.createElement('button');
  mainButton.id = BTN_ID;
  mainButton.textContent = TITLE;
  window.__kano_bypass_cleanup = () => {
    cancelled = true;
    session += 1;
    if (keepTimer) clearInterval(keepTimer);
    stopAutoCheck();
    mainButton.remove();
    document.getElementById(MODAL_NAME)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    delete window.__kano_bypass_cleanup;
  };

  const container = await waitFor(() => cancelled || document.querySelector('.actions-buttons'), 30000);
  if (cancelled) return;
  if (!container) { console.error('Bypass: .actions-buttons not found, button not added'); return; }

  mainButton.onclick = async () => {
    if (mainButton.dataset.opening === '1') return;
    mainButton.dataset.opening = '1';
    try {
      if (typeof createModal !== 'function' || typeof showModal !== 'function' || typeof runShellWithRoot !== 'function') {
        return toast('Bypass: this UFI-TOOLS version does not expose createModal / showModal / runShellWithRoot', 'red', 8000);
      }
      const root = await runRoot('whoami');
      if (!root.ok || !root.text.includes('root')) {
        return toast('Root access is not available. In UFI-TOOLS, turn on Advanced Features (root shell) first, then open this plugin again', 'red', 7000);
      }
      await openModal();
    } catch (error) {
      console.error('Bypass failed to open', error);
      toast('Bypass failed to open: ' + (error?.message || error), 'red', 9000);
    } finally {
      delete mainButton.dataset.opening;
    }
  };
  container.appendChild(mainButton);

  keepTimer = setInterval(() => {
    if (mainButton.isConnected) return;
    const c = document.querySelector('.actions-buttons');
    if (c) c.appendChild(mainButton);
  }, 1500);
})();

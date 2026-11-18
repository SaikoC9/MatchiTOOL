/* cpu-core.js: MatchiTOOL's own CPU logic (usage, speed, mode per cluster). No DOM, no network: scripts/test_cpu.js runs this file as it is.
 * Written from the Linux kernel interfaces only (/proc/stat and /sys/devices/system/cpu/cpufreq/policyN), not from any other tool.
 *   probeScript()              one read-only root script: online flags, one line per cpufreq policy (= cluster), the /proc/stat counters, the boot file flag.
 *   parseProbe(text)           its output -> {cores: [{id, online, cluster, curKhz, maxKhz, ticks}], clusters: [...], all: ticks, boot}
 *   makeMeter()                keeps the last counters; meter.feed(probe, nowMs) -> {all, cores: {id: percent}} (percent of busy time, one decimal)
 *   clusterName(cl, list)      "Little" / "Mid" / "Big" by top speed (or "All cores", "Cluster N")
 *   modeName(gov)              the label shown for a kernel governor name
 *   modeScript / lockScript / coreScript   root scripts that write one thing and print MATCHI_OK only when the value reads back
 *   bootFile(probe) / saveBootScript(text) / removeBootScript()   the optional "keep after restart" file
 * Every value that goes into a shell line is built from numbers or checked against the lists the kernel itself reported. */
(() => {
  'use strict';

  const SYS = '/sys/devices/system/cpu';
  const BOOT_DIR = '/data/local/matchitool/boot.d';
  const BOOT_FILE = BOOT_DIR + '/10-cpu.sh';
  const MAX_CPUS = 32;

  const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const GOV_RX = /^[a-z][a-z0-9_]{1,23}$/;
  const num = (s) => (/^\d+$/.test(String(s).trim()) ? Number(s) : 0);

  // "0-3,6" or "0 1 2 3" -> [0,1,2,3,6]
  function cpuList(s) {
    const out = new Set();
    for (const part of String(s || '').split(/[\s,]+/)) {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      const a = Number(m[1]), b = m[2] === undefined ? a : Number(m[2]);
      if (b < a || b - a > MAX_CPUS) continue;
      for (let i = a; i <= b && i < MAX_CPUS; i++) out.add(i);
    }
    return [...out].sort((x, y) => x - y);
  }

  function probeScript() {
    return [
      `S=${SYS}`,
      'rd() { v=; [ -r "$1" ] && read -r v < "$1"; return 0; }',
      'rd $S/possible; echo "N|$v"',
      'for d in $S/cpu[0-9]*; do',
      '  [ -d "$d" ] || continue',
      '  rd $d/online; o=$v; [ -n "$o" ] || o=1',
      '  echo "O|${d##*cpu}|$o"',
      'done',
      'for d in $S/cpufreq/policy[0-9]*; do',
      '  [ -d "$d" ] || continue',
      '  rd $d/related_cpus; r=$v',
      '  rd $d/scaling_cur_freq; c=$v',
      '  rd $d/cpuinfo_min_freq; lo=$v',
      '  rd $d/cpuinfo_max_freq; hi=$v',
      '  rd $d/scaling_governor; g=$v',
      '  rd $d/scaling_setspeed; s=$v',
      '  rd $d/scaling_available_governors; ag=$v',
      '  rd $d/scaling_available_frequencies; af=$v',
      '  echo "P|${d##*policy}|$r|$c|$lo|$hi|$g|$s|$ag|$af"',
      'done',
      'while read l; do case "$l" in',
      '  "cpu "*) set -- $l; echo "T|all|$2 $3 $4 $5 $6 $7 $8 $9";;',
      '  cpu[0-9]*) set -- $l; echo "T|${1#cpu}|$2 $3 $4 $5 $6 $7 $8 $9";;',
      '  *) break;; esac; done < /proc/stat',
      `[ -f ${BOOT_FILE} ] && echo "B|1" || echo "B|0"`,
    ].join('\n');
  }

  // user nice system idle iowait irq softirq steal -> {total, idle}; idle counts iowait too (the CPU is not working while it waits).
  function ticks(str) {
    const a = String(str || '').trim().split(/\s+/).map(Number);
    if (a.length < 5 || !a.every(Number.isFinite)) return null;
    return { total: a.reduce((x, y) => x + y, 0), idle: a[3] + a[4] };
  }

  function parseProbe(text) {
    const online = new Map(), tk = new Map(), policies = [];
    let all = null, boot = false, possible = [];
    for (const raw of String(text || '').split('\n')) {
      const p = raw.trim().split('|'), tag = p[0];
      if (tag === 'N') possible = cpuList(p[1]);
      else if (tag === 'O' && /^\d+$/.test(p[1] || '') && isInt(Number(p[1]), 0, MAX_CPUS - 1)) online.set(Number(p[1]), p[2] !== '0');
      else if (tag === 'T') {
        const t = ticks(p[2]);
        if (!t) continue;
        if (p[1] === 'all') all = t; else if (/^\d+$/.test(p[1] || '') && isInt(Number(p[1]), 0, MAX_CPUS - 1)) tk.set(Number(p[1]), t);
      } else if (tag === 'B') boot = p[1] === '1';
      else if (tag === 'P' && /^\d+$/.test(p[1] || '') && isInt(Number(p[1]), 0, MAX_CPUS - 1)) {
        const govs = String(p[8] || '').split(/\s+/).filter((g) => GOV_RX.test(g));
        const freqs = String(p[9] || '').split(/\s+/).filter((f) => /^\d{4,8}$/.test(f)).map(Number).sort((a, b) => a - b);
        policies.push({
          policy: Number(p[1]), cpus: cpuList(p[2]), curKhz: num(p[3]), minKhz: num(p[4]), maxKhz: num(p[5]),
          gov: GOV_RX.test(p[6] || '') ? p[6] : '', setKhz: num(p[7]), govs, freqs,
        });
      }
    }
    policies.sort((a, b) => a.policy - b.policy);
    const ids = new Set([...possible, ...online.keys(), ...tk.keys()]);
    for (const pl of policies) for (const c of pl.cpus) ids.add(c);
    const cores = [...ids].sort((a, b) => a - b).map((id) => {
      const pl = policies.find((x) => x.cpus.includes(id));
      const on = online.has(id) ? online.get(id) : tk.has(id);   // a core with no online file counts as on when /proc/stat lists it
      return { id, online: on, policy: pl ? pl.policy : -1, curKhz: on && pl ? pl.curKhz : 0, maxKhz: pl ? pl.maxKhz : 0, ticks: on ? tk.get(id) || null : null };
    });
    return { cores, clusters: policies, all, boot };
  }

  // Percent of busy time between two reads. Short windows keep the last number; a counter that went backwards (reboot, core replugged) starts again.
  function makeMeter(opts) {
    const minTicks = (opts && opts.minTicks) || 50, minMs = (opts && opts.minMs) || 800;
    const prev = new Map(), last = new Map();
    const step = (key, t, now) => {
      if (!t) { prev.delete(key); last.delete(key); return undefined; }
      const o = prev.get(key);
      if (!o || t.total < o.total || t.idle < o.idle) { prev.set(key, { ...t, at: now }); return last.get(key); }
      const dt = t.total - o.total;
      if (dt < minTicks || now - o.at < minMs) return last.get(key);
      const busy = dt - (t.idle - o.idle);
      const pct = Math.max(0, Math.min(100, Math.round((1000 * busy) / dt) / 10));
      prev.set(key, { ...t, at: now }); last.set(key, pct);
      return pct;
    };
    return {
      feed(probe, now) {
        const at = Number.isFinite(now) ? now : Date.now(), cores = {};
        const all = step('all', probe.all, at);
        for (const c of probe.cores) { const v = step(c.id, c.online ? c.ticks : null, at); if (v !== undefined) cores[c.id] = v; }
        return { all, cores };
      },
      reset() { prev.clear(); last.clear(); },
    };
  }

  function clusterName(cl, list) {
    const order = [...list].sort((a, b) => a.maxKhz - b.maxKhz || a.policy - b.policy);
    const i = order.findIndex((x) => x.policy === cl.policy);
    if (order.length === 1) return 'All cores';
    if (order.length === 2) return i === 0 ? 'Little' : 'Big';
    if (order.length === 3) return ['Little', 'Mid', 'Big'][i];
    return 'Cluster ' + (i + 1);
  }

  const MODE = {
    schedutil: 'Auto', ondemand: 'On demand', interactive: 'Interactive', conservative: 'Gentle',
    powersave: 'Low power', performance: 'Max speed', userspace: 'Locked speed',
  };
  const modeName = (g) => MODE[g] || String(g || '').replace(/_/g, ' ');

  // ---- root scripts ---------------------------------------------------------------------------------------
  const policyDir = (cl) => {
    if (!cl || !isInt(cl.policy, 0, MAX_CPUS - 1)) throw new Error('bad cluster');
    return `${SYS}/cpufreq/policy${cl.policy}`;
  };

  function modeScript(cl, gov) {
    if (!GOV_RX.test(String(gov)) || !cl.govs.includes(gov)) throw new Error('mode not offered by this cluster');
    const f = `${policyDir(cl)}/scaling_governor`;
    return [`f=${f}`, `[ -w $f ] && echo ${gov} > $f`, `read -r v < $f; [ "$v" = "${gov}" ] && echo MATCHI_OK || echo MATCHI_FAIL`].join('\n');
  }

  function lockScript(cl, khz) {
    if (!isInt(khz, 1000, 99999999)) throw new Error('bad speed');
    if (cl.freqs.length ? !cl.freqs.includes(khz) : (khz < cl.minKhz || khz > cl.maxKhz)) throw new Error('speed not offered by this cluster');
    const d = policyDir(cl);
    return [`d=${d}`, '[ -w $d/scaling_setspeed ] || { echo MATCHI_FAIL; exit 0; }', `echo ${khz} > $d/scaling_setspeed && echo MATCHI_OK || echo MATCHI_FAIL`].join('\n');
  }

  function coreScript(id, on) {
    if (!isInt(id, 0, MAX_CPUS - 1)) throw new Error('bad core');
    if (id === 0) throw new Error('core 0 stays on');
    const v = on ? 1 : 0;
    return [`f=${SYS}/cpu${id}/online`, `[ -w $f ] && echo ${v} > $f`, `read -r x < $f; [ "$x" = "${v}" ] && echo MATCHI_OK || echo MATCHI_FAIL`].join('\n');
  }

  // The file that re-applies the chosen state after a restart: cores, then modes, then locked speeds (a policy only exists while one of its cores is on).
  function bootFile(probe) {
    const L = ['#!/system/bin/sh', '# MatchiTOOL CPU settings. Press "Remove from boot" in the CPU window to delete this file.'];
    for (const c of probe.cores) if (c.id !== 0) L.push(`[ -w ${SYS}/cpu${c.id}/online ] && echo ${c.online ? 1 : 0} > ${SYS}/cpu${c.id}/online`);
    L.push('sleep 2');
    for (const cl of probe.clusters) if (GOV_RX.test(cl.gov) && cl.govs.includes(cl.gov)) L.push(`[ -w ${policyDir(cl)}/scaling_governor ] && echo ${cl.gov} > ${policyDir(cl)}/scaling_governor`);
    L.push('sleep 2');
    for (const cl of probe.clusters) {
      if (cl.gov !== 'userspace' || !cl.setKhz) continue;
      if (cl.freqs.length ? !cl.freqs.includes(cl.setKhz) : (cl.setKhz < cl.minKhz || cl.setKhz > cl.maxKhz)) continue;
      L.push(`[ -w ${policyDir(cl)}/scaling_setspeed ] && echo ${cl.setKhz} > ${policyDir(cl)}/scaling_setspeed`);
    }
    return L.join('\n') + '\n';
  }

  function saveBootScript(text) {
    if (/MATCHI_CPU_EOF/.test(text)) throw new Error('bad boot text');
    return [`mkdir -p ${BOOT_DIR} && chmod 700 ${BOOT_DIR}`, `cat > ${BOOT_FILE} <<'MATCHI_CPU_EOF'`, String(text).replace(/\n+$/, ''), 'MATCHI_CPU_EOF',
      `chmod 700 ${BOOT_FILE}`, `[ -s ${BOOT_FILE} ] && echo MATCHI_OK || echo MATCHI_FAIL`].join('\n');
  }
  const removeBootScript = () => `rm -f ${BOOT_FILE}; [ -f ${BOOT_FILE} ] && echo MATCHI_FAIL || echo MATCHI_OK`;

  window.MatchiCpu = { SYS, BOOT_FILE, cpuList, probeScript, parseProbe, makeMeter, clusterName, modeName, modeScript, lockScript, coreScript, bootFile, saveBootScript, removeBootScript };
})();

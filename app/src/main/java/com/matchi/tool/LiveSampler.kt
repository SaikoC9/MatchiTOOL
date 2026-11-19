package com.matchi.tool

import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.util.concurrent.CopyOnWriteArrayList

/** CPU time counters of one /proc/stat row, in ticks. [idle] already includes iowait. */
data class CpuTimes(val total: Long, val idle: Long)

/** Speed of one core in kHz, as the kernel reports it. An offline core has [curKhz] 0. */
data class CoreFreq(val id: Int, val online: Boolean, val curKhz: Long, val maxKhz: Long)

/** One kernel thermal zone in degrees Celsius. Zones with an unusable value are left out. */
data class ThermalZone(val name: String, val celsius: Double)

/** Load, uptime and memory. Read only every [LiveScript.SYS_EVERY] rounds. */
data class SysInfo(val load1: Double, val load5: Double, val load15: Double, val uptimeSec: Double, val memTotalKb: Long, val memAvailKb: Long)

data class CorePct(val id: Int, val pct: Double)

/** One parsed output line of the root reader: raw counters, not yet turned into percentages. */
data class LiveLine(
    val cpu: CpuTimes?,
    val cores: Map<Int, CpuTimes>,
    val freqs: List<CoreFreq>,
    val zones: List<ThermalZone>,
    val sys: SysInfo?
)

/**
 * What the Live panel needs, once per round. [cpuPct] and [cores] are null / empty until two rounds exist (a percentage is a
 * difference between two readings). [sys] is the last one read (it changes every [LiveScript.SYS_EVERY] rounds), [sysAt] says when.
 */
data class LiveSnapshot(
    val at: Long,
    val cpuPct: Double?,
    val cores: List<CorePct>,
    val freqs: List<CoreFreq>,
    val zones: List<ThermalZone>,
    val sys: SysInfo?,
    val sysAt: Long?
)

/**
 * The fixed script of the persistent root reader, and the parser for the lines it prints. The script is constant text (only the two
 * numbers below are filled in, by the app), never user input.
 *
 * One line per round:
 *   @L1|c:cpu 1 2 3 4 5 6 7 8;cpu0 ...|f:0 1 936000 1800000;1 0 0 1800000|z:soc-thermal=45000;mdm-q6=51000|s:0.1 0.2 0.3 100.5 4000000 2000000
 * Sections are `|`-separated, entries `;`-separated (a leading `;` is normal). `s:` is empty on rounds that skip it.
 */
object LiveScript {
    const val TAG = "@L1"
    const val SYS_EVERY = 5
    const val MAX_ROUNDS = 3600          // a reader ends by itself after this many rounds (about an hour); the sampler starts a new one
    const val MAX_LINE = 8192            // a longer line is not ours
    internal const val DELIM = "MATCHI_LIVE_EOF"

    /** The loop only. No `su`, no here-document: see [launch]. A section sign stands for a dollar sign so Kotlin does not read templates. */
    internal fun body(rounds: Int = MAX_ROUNDS, sleepSec: Int = 1): String = """
S=/sys/devices/system/cpu
p=7; [ -r §S/possible ] && read p < §S/possible
mx=§{p##*[-,]}
case §mx in ""|*[!0-9]*) mx=7;; esac
[ §mx -gt 15 ] && mx=15
r=0
while [ §r -lt @ROUNDS@ ]; do
  c=; while read l; do case "§l" in cpu*) c="§c;§l";; *) break;; esac; done < /proc/stat
  f=; n=0
  while [ §n -le §mx ]; do
    d=§S/cpu§n; o=1; q=0; m=0
    if [ ! -d §d ]; then o=0; else
      [ -r §d/online ] && read o < §d/online
      [ -r §d/cpufreq/cpuinfo_max_freq ] && read m < §d/cpufreq/cpuinfo_max_freq
      if [ "§o" = 1 ] && [ -r §d/cpufreq/scaling_cur_freq ]; then read q < §d/cpufreq/scaling_cur_freq; fi
    fi
    f="§f;§n §o §{q:-0} §{m:-0}"; n=§((n+1))
  done
  z=; i=0
  for t in /sys/class/thermal/thermal_zone*; do
    [ §i -ge 16 ] && break
    read v 2>/dev/null < §t/temp || continue
    read k 2>/dev/null < §t/type || k=
    case "§k" in ""|*[!A-Za-z0-9_.-]*) k=zone§i;; esac
    z="§z;§k=§v"; i=§((i+1))
  done
  s=
  if [ §((r % @SYS@)) -eq 0 ]; then
    read a b e x < /proc/loadavg
    read u x < /proc/uptime
    mt=0; ma=0
    while read k v w; do case §k in MemTotal:) mt=§v;; MemAvailable:) ma=§v; break;; esac; done < /proc/meminfo
    s="§a §b §e §u §mt §ma"
  fi
  echo "@L1|c:§c|f:§f|z:§z|s:§s" || exit 0
  r=§((r+1)); sleep @SLEEP@
done
""".trimStart('\n').replace("@ROUNDS@", rounds.toString()).replace("@SYS@", SYS_EVERY.toString()).replace("@SLEEP@", sleepSec.toString()).replace('§', '$')

    /**
     * What is typed into `su -c sh`. As elsewhere in the app (see SECURITY.md) the script goes to the inner `sh` over file descriptor 3
     * and its stdin is /dev/null, so nothing in it can read the pipe. When the app goes away the pipe breaks and the next `echo` fails,
     * which ends the loop (`|| exit 0`), so no root loop is left behind; [MAX_ROUNDS] is the second limit.
     */
    fun launch(rounds: Int = MAX_ROUNDS, sleepSec: Int = 1): String =
        "exec sh /dev/fd/3 </dev/null 3<<'$DELIM'\n" + body(rounds, sleepSec) + "$DELIM\n"

    private val ws = Regex("\\s+")

    private fun nums(s: String, min: Int): LongArray? {
        val p = s.trim().split(ws)
        if (p.size < min) return null
        val out = LongArray(p.size)
        for (i in p.indices) out[i] = p[i].toLongOrNull()?.takeIf { it >= 0 } ?: return null
        return out
    }

    /** Same method as the page (parseSys): total = the first 8 columns (guest columns are already inside user), idle = idle + iowait. */
    internal fun cpuTimes(row: String): CpuTimes? {
        val a = nums(row, 4) ?: return null
        var total = 0L
        for (i in 0 until minOf(8, a.size)) total += a[i]
        return CpuTimes(total, a[3] + (if (a.size > 4) a[4] else 0L))
    }

    /** Parses one output line. Null for anything that is not a valid line of this script (su's own messages, a cut line, a line with nothing readable). */
    fun parse(line: String): LiveLine? {
        if (line.length > MAX_LINE || !line.startsWith("$TAG|")) return null
        var cpu: CpuTimes? = null
        val cores = HashMap<Int, CpuTimes>()
        val freqs = ArrayList<CoreFreq>()
        val zones = ArrayList<ThermalZone>()
        var sys: SysInfo? = null
        for (sec in line.substring(TAG.length + 1).split('|')) {
            if (sec.length < 2 || sec[1] != ':') continue
            val items = sec.substring(2).split(';').filter { it.isNotBlank() }
            when (sec[0]) {
                'c' -> for (item in items) {
                    val t = item.trim()
                    val sp = t.indexOf(' ')
                    if (sp < 0 || !t.startsWith("cpu")) continue
                    val label = t.substring(0, sp)
                    val times = cpuTimes(t.substring(sp + 1)) ?: continue
                    if (label == "cpu") cpu = times else label.substring(3).toIntOrNull()?.let { id -> cores[id] = times }
                }
                'f' -> for (item in items) {
                    val a = nums(item, 4) ?: continue
                    if (a.size != 4 || a[0] > 255 || (a[1] != 0L && a[1] != 1L)) continue
                    freqs.add(CoreFreq(a[0].toInt(), a[1] == 1L, a[2], a[3]))
                }
                'z' -> for (item in items) {
                    val eq = item.lastIndexOf('=')
                    if (eq <= 0) continue
                    val raw = item.substring(eq + 1).trim().toLongOrNull() ?: continue
                    // Same rule as the page: the kernel reports milli-degrees; some builds report whole degrees. Anything outside 0..150 C is not a reading.
                    val c = if (raw > 1000) raw / 1000.0 else raw.toDouble()
                    if (c > 0.0 && c < 150.0) zones.add(ThermalZone(item.substring(0, eq).trim(), c))
                }
                's' -> sys = parseSys(sec.substring(2))
            }
        }
        if (cpu == null && cores.isEmpty() && freqs.isEmpty() && zones.isEmpty() && sys == null) return null
        return LiveLine(cpu, cores, freqs.sortedBy { it.id }, zones, sys)
    }

    private fun parseSys(s: String): SysInfo? {
        val p = s.trim().split(ws)
        if (p.size != 6) return null
        val l1 = p[0].toDoubleOrNull() ?: return null
        val l5 = p[1].toDoubleOrNull() ?: return null
        val l15 = p[2].toDoubleOrNull() ?: return null
        val up = p[3].toDoubleOrNull() ?: return null
        val mt = p[4].toLongOrNull() ?: return null
        val ma = p[5].toLongOrNull() ?: return null
        if (mt <= 0 || ma < 0 || up < 0 || l1 < 0 || l5 < 0 || l15 < 0) return null
        return SysInfo(l1, l5, l15, up, mt, ma)
    }

    /** Busy share between two readings, one decimal, 0..100. Null when the counters did not move forward (a reset, or no time passed). */
    fun pct(prev: CpuTimes?, cur: CpuTimes?): Double? {
        if (prev == null || cur == null || cur.total <= prev.total) return null
        val busy = (cur.total - prev.total) - (cur.idle - prev.idle)
        val v = Math.round(1000.0 * busy / (cur.total - prev.total)) / 10.0
        return v.coerceIn(0.0, 100.0)
    }

    /** Turns a line into a snapshot using the previous line (for percentages) and the last system values (carried forward between the slower reads). */
    internal fun snapshot(prev: LiveLine?, cur: LiveLine, lastSys: SysInfo?, lastSysAt: Long?, now: Long): LiveSnapshot {
        val sys = cur.sys ?: lastSys
        val sysAt = if (cur.sys != null) now else lastSysAt
        val cores = cur.cores.keys.sorted().mapNotNull { id -> pct(prev?.cores?.get(id), cur.cores[id])?.let { CorePct(id, it) } }
        return LiveSnapshot(now, pct(prev?.cpu, cur.cpu), cores, cur.freqs, cur.zones, sys, if (sys == null) null else sysAt)
    }
}

/** One running root reader: the lines it prints, and a way to stop it. */
interface LiveShell {
    /** Next output line, or null when the reader has ended. Blocks. */
    fun readLine(): String?
    /** Stops the reader. Safe to call more than once, from any thread. Must make a blocked [readLine] return. */
    fun close()
    /** Which program feeds this reader: [LiveEngine.ENGINE_SHELL] (the loop in [LiveScript]) or [LiveEngine.ENGINE_BINARY] (matchi-sampler). */
    val engine: String get() = LiveEngine.ENGINE_SHELL
}

/**
 * ONE long-lived root shell that prints a line per second, instead of a new `su` for every read.
 *
 * This class only produces snapshots ([latest], [listen]). LiveHub (LiveStream.kt) starts and stops it and pushes the snapshots to the
 * page. It uses no Android classes so it is unit tested.
 *
 * If the shell ends or fails it is started again, after 1, 2, 4, 8, 16 and then at most 30 seconds when it keeps failing ([backoff]);
 * a shell that delivered readings starts again after 1 s. It never restarts in a tight loop. When root was refused it does not ask again
 * until [isDenied] says the shared cool-down is over. [stop] ends the shell and the worker thread.
 *
 * [safeLaunch] is the way back for the optional matchi-sampler program: when [launch] gave a reader that ran the program
 * ([LiveShell.engine] is "binary") and it ended without a single reading [LiveEngine.BINARY_TRIES] times in a row, the next starts use
 * [safeLaunch] (the shell loop) until [stop] / [start]. [onFallback] is told once, with the reason, for the log.
 */
class LiveSampler(
    private val launch: () -> LiveShell,
    private val isDenied: () -> Boolean = { false },
    private val onDenied: () -> Unit = {},
    private val now: () -> Long = System::currentTimeMillis,
    private val delayMs: (Int) -> Long = { backoff(it) },
    private val safeLaunch: (() -> LiveShell)? = null,
    private val onFallback: (String) -> Unit = {}
) {
    companion object {
        /** Wait before the next start after [failures] failures in a row (1 -> 1 s, 2 -> 2 s, 3 -> 4 s ... capped at 30 s). */
        fun backoff(failures: Int): Long = minOf(30_000L, 1_000L shl (failures.coerceIn(1, 6) - 1))

        /**
         * The real reader: `su -c sh` with [LiveScript.launch] on its stdin. Pass RootShell.isDenied / RootShell.noteDenied so that a refused
         * su is remembered once for the whole app.
         */
        fun forRoot(
            isDenied: () -> Boolean,
            onDenied: () -> Unit,
            binaryPath: () -> String? = { null },   // the verified matchi-sampler to run, or null for the shell loop; asked at every reader start
            onFallback: (String) -> Unit = {}
        ): LiveSampler = LiveSampler(
            launch = { RootLiveShell.start(binaryPath()) },
            isDenied = isDenied,
            onDenied = onDenied,
            safeLaunch = { RootLiveShell.start(null) },
            onFallback = onFallback
        )
    }

    private val monitor = Object()
    private var generation = 0          // guarded by monitor; changes on every start() and stop()
    private var worker: Thread? = null  // guarded by monitor
    private var active: LiveShell? = null // guarded by monitor
    @Volatile private var latest: LiveSnapshot? = null
    @Volatile private var note: String = ""
    @Volatile private var engineName: String = LiveEngine.ENGINE_SHELL
    private val listeners = CopyOnWriteArrayList<(LiveSnapshot) -> Unit>()

    /** The newest snapshot, or null before the first one (and after [stop] it is the last one that was read). */
    fun latest(): LiveSnapshot? = latest

    /** The program behind the reader that was started last ([LiveEngine.ENGINE_SHELL] before the first start). */
    fun engine(): String = engineName

    /** The last line the reader printed that was not a reading (su's own message, for example), for the log. Empty if none. */
    fun lastNote(): String = note

    /** Calls [l] on the sampler's thread for every snapshot. Returns a function that removes it again. Keep [l] short. */
    fun listen(l: (LiveSnapshot) -> Unit): () -> Unit { listeners.add(l); return { listeners.remove(l) } }

    fun isRunning(): Boolean = synchronized(monitor) { worker != null }

    /** Starts the reader. Does nothing if it is already running. */
    fun start() {
        synchronized(monitor) {
            if (worker != null) return
            val g = ++generation
            worker = Thread({ run(g) }, "MatchiLiveSampler").apply { isDaemon = true; priority = Thread.MIN_PRIORITY; start() }
        }
    }

    /** Stops the reader and ends the thread. Does nothing if it is not running. */
    fun stop() {
        val t: Thread?
        val shell: LiveShell?
        synchronized(monitor) {
            generation++
            t = worker; worker = null
            shell = active; active = null
            monitor.notifyAll()
        }
        try { shell?.close() } catch (e: Exception) { Quiet.note("LiveSampler.stop", e) }
        if (t != null && t !== Thread.currentThread()) try { t.join(2_000) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
    }

    private fun current(g: Int) = synchronized(monitor) { generation == g }

    /** Waits [ms], or less if [stop] / a new start happens. Returns false when this worker must end. */
    private fun pause(g: Int, ms: Long): Boolean {
        val end = System.nanoTime() + ms * 1_000_000L
        synchronized(monitor) {
            while (generation == g) {
                val left = (end - System.nanoTime()) / 1_000_000L
                if (left <= 0) return true
                try { monitor.wait(left) } catch (_: InterruptedException) { return false }
            }
        }
        return false
    }

    private fun run(g: Int) {
        var failures = 0
        var binaryBad = 0   // readers in a row that ran matchi-sampler and ended without a reading
        try {
            while (current(g)) {
                if (isDenied()) { failures++; if (!pause(g, delayMs(failures))) return; continue }
                val safe = safeLaunch
                val shell = try {
                    if (safe != null && binaryBad >= LiveEngine.BINARY_TRIES) safe() else launch()
                } catch (e: Exception) {
                    // su could not be started at all: share that with the rest of the app instead of retrying alone.
                    if (e is IOException || e is SecurityException) onDenied()
                    note = "start failed: " + (e.message ?: e.javaClass.simpleName).take(160)
                    failures++
                    if (!pause(g, delayMs(failures))) return
                    continue
                }
                val ok = synchronized(monitor) { if (generation == g) { active = shell; true } else false }
                if (!ok) { shell.close(); return }
                engineName = shell.engine
                val delivered = try { readLoop(shell, g) } finally {
                    synchronized(monitor) { if (active === shell) active = null }
                    try { shell.close() } catch (e: Exception) { Quiet.note("LiveSampler.close", e) }
                }
                if (delivered > 0) failures = 0 else failures++
                if (shell.engine == LiveEngine.ENGINE_BINARY) {
                    if (delivered > 0) binaryBad = 0
                    else if (++binaryBad == LiveEngine.BINARY_TRIES && safeLaunch != null) {
                        note = "matchi-sampler gave no readings " + LiveEngine.BINARY_TRIES + " times, using the shell loop"
                        onFallback(note + (lastOutput.let { if (it.isEmpty()) "" else " (last output: $it)" }))
                    }
                }
                if (!pause(g, delayMs(maxOf(failures, 1)))) return
            }
        } finally {
            synchronized(monitor) { if (generation == g) worker = null }   // ended on its own (not through stop()): allow start() again
        }
    }

    private var lastOutput = ""   // the last line of the latest reader that was not a reading (before [note] is replaced), only used for the log

    /** Reads until the reader ends or this worker is replaced. Returns how many valid lines it delivered. */
    private fun readLoop(shell: LiveShell, g: Int): Int {
        var prev: LiveLine? = null
        var sys: SysInfo? = null
        var sysAt: Long? = null
        var count = 0
        lastOutput = ""
        while (current(g)) {
            val line = (try { shell.readLine() } catch (e: IOException) { null }) ?: break
            val cur = LiveScript.parse(line)
            if (cur == null) {
                if (line.isNotBlank()) { note = line.take(200); lastOutput = note }
                continue
            }
            val snap = LiveScript.snapshot(prev, cur, sys, sysAt, now())
            prev = cur
            sys = snap.sys; sysAt = snap.sysAt
            count++
            if (!current(g)) break
            latest = snap
            for (l in listeners) try { l(snap) } catch (e: Exception) { Quiet.note("LiveSampler.listener", e) }
        }
        return count
    }
}

/** `su -c sh` running [LiveScript.launch]. Starting it can throw (no su); the caller treats that as a refusal. */
private class RootLiveShell(private val p: Process, override val engine: String = LiveEngine.ENGINE_SHELL) : LiveShell {
    private val reader = BufferedReader(InputStreamReader(p.inputStream, Charsets.UTF_8))
    @Volatile private var closed = false

    companion object {
        /** [binary] is the full path of the verified matchi-sampler, or null for the shell loop (also when the path is not a plain absolute path). */
        fun start(binary: String? = null): LiveShell {
            val run = binary?.let { LiveEngine.command(it) }
            if (run != null) {
                // The program is one fixed command line. Nothing is sent to it: stdin is closed at once. It ends when its next write fails
                // (the app closed the pipe), so no root process is left behind; -rounds is the second limit, as for the loop.
                val p = ProcessBuilder("su", "-c", run).redirectErrorStream(true).start()
                try { p.outputStream.close() } catch (e: IOException) {
                    try { p.destroy() } catch (x: Exception) { Quiet.note("LiveSampler.start", x) }
                    throw e
                }
                return RootLiveShell(p, LiveEngine.ENGINE_BINARY)
            }
            val p = ProcessBuilder("su", "-c", "sh").redirectErrorStream(true).start()
            try {
                // The script is written once, then stdin is closed: nothing else is ever sent to the shell.
                p.outputStream.bufferedWriter(Charsets.UTF_8).use { it.write(LiveScript.launch()) }
            } catch (e: IOException) {
                try { p.destroy() } catch (x: Exception) { Quiet.note("LiveSampler.start", x) }
                throw e
            }
            return RootLiveShell(p)
        }
    }

    override fun readLine(): String? = if (closed) null else reader.readLine()

    override fun close() {
        if (closed) return
        closed = true
        // Closing the pipe is what stops the loop in the inner shell (its next echo fails); destroy() ends su itself.
        try { p.inputStream.close() } catch (e: Exception) { Quiet.note("LiveSampler.close", e) }
        try { p.destroy() } catch (e: Exception) { Quiet.note("LiveSampler.close", e) }
    }
}

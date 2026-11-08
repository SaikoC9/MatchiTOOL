package com.matchi.tool

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Process as AndroidProcess
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.regex.Pattern
import java.util.regex.PatternSyntaxException
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** One log entry as the web page and the live stream see it. */
fun entryJson(e: CatchLog): JSONObject = JSONObject()
    .put("id", e.id).put("timestamp", e.timestamp).put("level", e.level)
    .put("function", e.function).put("message", e.message).put("session", e.session)
    .put("source", e.source)

/**
 * Stops floods: the same line (same tag and text once digits are ignored) is let through [perWindow] times per
 * [windowMs]; the rest are dropped and, when the window ends, one summary says how many were hidden. Android
 * emits thousands of identical lines such as "tagSocket(85) with statsTag=..." that would otherwise bury real
 * events and fill the bounded write queue. One instance per capture thread (not thread-safe on purpose).
 */
class NoiseGate(private val perWindow: Int = 3, private val windowMs: Long = 2000L,
                private val emit: (String, String, String) -> Unit) {
    private class Slot(val level: String, val tag: String, val sample: String, var n: Int)

    companion object {
        /**
         * Global switch ("Keep every line" on the Log Catcher page). When true, [allow] lets every line through: nothing is
         * dropped or collapsed at capture time and the noise rules only apply when the page filters for display.
         * [levelFor] (benign ERROR shown as INFO) is not affected: it changes the label, never removes a line.
         */
        @Volatile var keepEverything = false

        private val SILENT_TAGS = setOf("TrafficStats", "mali_gralloc")

        /** Unisoc/ZTE kernel driver heartbeat and per-packet tracing (seen at ~18 lines/s on the F50); never actionable. Kernel lines arrive with their "[ 5284.5] [c0] " prefix, which is skipped before matching. */
        private val KERNEL_CHATTER = Regex(
            """^(?:\[\s*\d+\.\d+\]\s*)?(?:\[c\d+\]\s*)?(?:""" +
            // Wi-Fi driver (tx/rx bookkeeping, flow control, DNS/packet filter tracing): everything except lines that report a problem.
            """(?:sprd-wlan: |sc2355_\w+[:,])(?!.*(?i:disconn|fail|error|\berr\b|timeout))""" +
            """|\[SPRD_PDBG\]|sprd-mpm:|sprd-cpufreq|sprd_cpufreq_cooling:|sprd_wdt_fiq:|WCN (BASE|PCIE)|sipa_rm:|sipa_dele:|sipa \d+\.sipa:|sipa resume|sipa_eth: (dev |stop queue|wakeup queue)""" +
            """|sc27xx-fgu|charger-manager|healthd:|wlan0: sprd_cfg80211_get_station|bq2560x: set watchdog|systemserver cmd\d)""")

        /** ZTE service modules that poll the modem every second; their INFO/DEBUG lines are dropped (WARNING and ERROR are kept). */
        private val POLLING_TAGS = setOf("PinModule", "PinApi", "EmptyModule", "PollingCommandProcessor", "DispatchModule",
            "MobilePhoneStateCache", "ThermalManager", "BatteryService", "ZteBatteryService", "ThermalHalWrapper", "UnisocWatchdog",
            "DeviceCommandProcesser", "DataUsageStats", "DataUsageManager", "keystore2")

        /** Lines the platform prints as ERROR/WARNING although they are expected on this hardware. Shown as INFO. */
        private val BENIGN = Regex(
            """sprd_wdt_fiq: sprd wdt load value|UnisocWatchdog|WDT_Monitor|UNISOCWATCHDOG_MESSAGE|can't find this type sensor|Failed to getCurrentTemperaturesWithType""" +
            """|No SAE PMK found|sipa_eth: fail to send, ret -115|succeeded to send cmd|Getting response size|Bluetooth service is null|Unable to start service Intent \{ act=EVENT_WIFI_STATION_CONNECTED|Calling a method in the system process without a qualified user""")

        /** Level to record: known-benign platform ERROR/WARNING lines are demoted to INFO so real faults stand out. */
        fun levelFor(level: String, msg: String): String =
            if ((level == "ERROR" || level == "WARNING") && BENIGN.containsMatchIn(msg)) "INFO" else level

        /** Kernel level from the text; watchdog "timeout =40" heartbeats and similar are not warnings. */
        fun kernelLevel(line: String, err: Regex, warn: Regex): String = when {
            BENIGN.containsMatchIn(line) -> "INFO"
            err.containsMatchIn(line) -> "ERROR"
            warn.containsMatchIn(line) -> "WARNING"
            else -> "INFO"
        }
    }

    private val slots = HashMap<String, Slot>()
    private val digits = Regex("\\d+")
    private var windowStart = 0L

    /** Optional counters: lines removed outright, lines let through, and lines collapsed into a repeat summary. */
    var stats: SourceCounters? = null

    fun allow(level: String, tag: String, msg: String): Boolean {
        if (keepEverything) { stats?.passed(); return true }
        // Pure platform chatter that never needs action: dropped outright instead of 3-per-window.
        val bare = tag.removePrefix("device/")   // device-wide capture prefixes the tag; the same noise must be dropped there too
        if (bare in SILENT_TAGS && level != "ERROR") { stats?.dropped(); return false }
        if (bare in POLLING_TAGS && (level == "INFO" || level == "DEBUG")) { stats?.dropped(); return false }   // ZTE polling chatter, see POLLING_TAGS
        if (bare == "kernel" && level == "INFO" && KERNEL_CHATTER.containsMatchIn(msg)) { stats?.dropped(); return false }   // driver heartbeat spam
        if (bare == "tool" && msg.startsWith("type=1400 audit(") && "permissive=1" in msg) { stats?.dropped(); return false }   // permissive SELinux audit lines
        val now = System.currentTimeMillis()
        if (now - windowStart >= windowMs || slots.size > 500) { flush(); windowStart = now }
        val key = tag + "|" + digits.replace(msg, "#").take(160)
        val slot = slots.getOrPut(key) { Slot(level, tag, msg.take(160), 0) }
        slot.n++
        val allowed = slot.n <= perWindow
        if (allowed) stats?.passed() else stats?.collapsed()
        return allowed
    }

    /** Report what was hidden in the window that just ended, then start a fresh one. */
    fun flush() {
        for (slot in slots.values) {
            if (slot.n > perWindow) emit(slot.level, slot.tag, "(repeated ${slot.n - perWindow} more times, hidden) ${slot.sample}")
        }
        slots.clear()
    }
}

/**
 * Optional root capture of the WHOLE device (not just this app): `logcat` for every process and the kernel ring
 * buffer (`dmesg`). It only runs while a Log Catcher session is active, only when the owner switched it on, and
 * it is stopped with the session. Lines go through [LogCatcher.log], so they share the ring buffer, the session
 * files, the size limits and the write-queue limit. Device logcat is filtered by priority (default W and above)
 * because an unfiltered system log would overflow the bounded queue within seconds.
 */
object DeviceLogs {
    private const val TAG = "MatchiDeviceLogs"
    private const val PREFS = "matchi_log_catcher"

    data class Settings(val logcat: Boolean, val dmesg: Boolean, val level: String, val keepAll: Boolean = false)

    private val gen = AtomicInteger()
    private val procs = CopyOnWriteArrayList<Process>()
    @Volatile private var running = false

    // threadtime: "MM-DD HH:MM:SS.mmm  PID  TID L Tag     : message"
    private val KERN_ERR = Regex("""(?i)\b(error|fail(ed|ure)?|panic|oops|fatal|segfault)\b""")
    private val KERN_WARN = Regex("""(?i)\b(warn(ing)?|timeout|timed out|retry)\b""")

    fun settings(ctx: Context): Settings {
        val p = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val level = (p.getString("device_level", "W") ?: "W").take(1).uppercase(Locale.US)
        val keep = p.getBoolean("keep_all", false)
        NoiseGate.keepEverything = keep      // the in-app capture loops read this switch line by line
        return Settings(p.getBoolean("device_logcat", false), p.getBoolean("device_dmesg", false),
            if (level in listOf("V", "D", "I", "W", "E")) level else "W", keep)
    }

    fun isActive(): Boolean = running

    /** [keepAll] null leaves the "keep every line" switch as it is (an older page that does not send it). */
    fun configure(ctx: Context, logcat: Boolean, dmesg: Boolean, level: String, keepAll: Boolean? = null) {
        val lvl = level.take(1).uppercase(Locale.US).let { if (it in listOf("V", "D", "I", "W", "E")) it else "W" }
        val ed = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("device_logcat", logcat).putBoolean("device_dmesg", dmesg).putString("device_level", lvl)
        if (keepAll != null) ed.putBoolean("keep_all", keepAll)
        ed.apply()
        NoiseGate.keepEverything = keepAll ?: NoiseGate.keepEverything
        if (LogCatcher.isRunning()) start(ctx) else stop()
    }

    @Synchronized fun start(ctx: Context) {
        stop()
        val st = settings(ctx)
        if (!st.logcat && !st.dmesg) return
        if (RootShell.isDenied()) {
            LogCatcher.log("WARNING", "DeviceLogs", "Root was refused recently; device capture not started")
            return
        }
        val g = gen.incrementAndGet()
        running = true
        if (st.logcat) Thread({ runLogcat(g, st.level) }, "MatchiTOOL-DevLogcat").apply { isDaemon = true; priority = Thread.MIN_PRIORITY; start() }
        if (st.dmesg) Thread({ runDmesg(g) }, "MatchiTOOL-DevDmesg").apply { isDaemon = true; priority = Thread.MIN_PRIORITY; start() }
        LogCatcher.log("INFO", "DeviceLogs", "Device capture started (logcat=${st.logcat}, dmesg=${st.dmesg}, level=${st.level})")
    }

    @Synchronized fun stop() {
        gen.incrementAndGet()
        running = false
        procs.forEach { try { it.destroy() } catch (e: Exception) { Quiet.note("LogTools.stop", e) } }
        procs.clear()
    }

    private fun runLogcat(g: Int, level: String) {
        var p: Process? = null
        val started = System.currentTimeMillis()
        var lines = 0
        try {
            val proc = ProcessBuilder("su", "-c", "logcat -v threadtime -T 1 '*:$level'").redirectErrorStream(true).start()
            p = proc
            procs.add(proc)
            if (gen.get() == g) {
                val myPid = AndroidProcess.myPid().toString()
                val gate = NoiseGate { l, t, m -> LogCatcher.log(l, t, m) }.also { it.stats = SourceStats.device }
                proc.inputStream.bufferedReader().useLines { seq ->
                    for (line in seq) {
                        if (gen.get() != g || !LogCatcher.isRunning()) break
                        lines++
                        SourceStats.device.seen()
                        val parsed = CaptureLines.parseDevice(line, myPid)
                        if (parsed == null) { SourceStats.device.dropped(); continue }
                        val tag = parsed.tag; val lvl = parsed.level; val msg = parsed.message
                        val shown = NoiseGate.levelFor(lvl, msg)
                        if (gate.allow(shown, "device/$tag", msg)) LogCatcher.log(shown, "device/$tag", msg)
                    }
                }
            }
        } catch (e: Exception) {
            if (gen.get() == g) Log.w(TAG, "Device logcat stopped: ${e.message}")
        } finally {
            try { p?.destroy() } catch (e: Exception) { Quiet.note("LogTools.runLogcat", e) }
            if (p != null) procs.remove(p)
            if (gen.get() == g) SourceStats.device.gap()   // ended without stop(): lines may be missing from here
            if (gen.get() == g && System.currentTimeMillis() - started < 3000 && lines <= 1)
                LogCatcher.log("WARNING", "DeviceLogs", "Device logcat ended immediately: root access refused or logcat unavailable")
        }
    }

    /**
     * dmesg is polled by one long-lived root shell instead of one su per poll. The shell runs a command only when it
     * receives a line on stdin, so when this app dies its stdin closes and the shell exits by itself (no root loop is
     * left behind). The first reply is only a baseline; afterwards only lines not seen before are logged.
     */
    private fun runDmesg(g: Int) {
        var p: Process? = null
        try {
            val proc = ProcessBuilder("su", "-c", "while read x; do dmesg | tail -n 200; echo __MATCHI_TICK__; done")
                .redirectErrorStream(true).start()
            p = proc
            procs.add(proc)
            val stdin = proc.outputStream
            val ticker = Thread({
                try { while (gen.get() == g) { stdin.write(10); stdin.flush(); Thread.sleep(4000) } } catch (e: Exception) { Quiet.note("LogTools.runDmesg", e) }
            }, "MatchiTOOL-DevDmesgTick").apply { isDaemon = true; start() }
            val kgate = NoiseGate { l, t, m -> LogCatcher.log(l, t, m) }.also { it.stats = SourceStats.kernel }
            val seen = LinkedHashSet<String>()
            val batch = ArrayList<String>()
            var baseline = true
            proc.inputStream.bufferedReader().useLines { seq ->
                for (line in seq) {
                    if (gen.get() != g || !LogCatcher.isRunning()) break
                    if (line == "__MATCHI_TICK__") {
                        for (l in batch) if (seen.add(l) && !baseline) { SourceStats.kernel.seen(); emitKernel(l, kgate) }
                        kgate.flush()
                        while (seen.size > 1000) { val iter = seen.iterator(); iter.next(); iter.remove() }
                        batch.clear()
                        baseline = false
                    } else if (line.isNotBlank()) batch.add(line)
                }
            }
            ticker.interrupt()
        } catch (e: Exception) {
            if (gen.get() == g) Log.w(TAG, "Kernel log capture stopped: ${e.message}")
        } finally {
            try { p?.destroy() } catch (e: Exception) { Quiet.note("LogTools.runDmesg", e) }
            if (p != null) procs.remove(p)
            if (gen.get() == g) SourceStats.kernel.gap()
        }
    }

    private fun emitKernel(line: String, gate: NoiseGate) {
        val l = line.trim()
        val level = NoiseGate.kernelLevel(l, KERN_ERR, KERN_WARN)
        if (gate.allow(level, "kernel", l)) LogCatcher.log(level, "kernel", l)
    }
}

/**
 * Server-sent-events source for the web page: new entries are pushed as they happen instead of the page asking
 * every few seconds. At most [MAX_STREAMS] run at once and each one ends by itself after [MAX_LIFETIME_MS], so a
 * browser that vanished can never keep a thread forever. If the page cannot keep up, entries are dropped and a
 * `lagged` event tells it to fetch the gap with a normal request.
 */
class LogStream private constructor() : InputStream() {
    companion object {
        private const val MAX_STREAMS = 3
        private const val MAX_LIFETIME_MS = 20L * 60L * 1000L
        private val openCount = AtomicInteger()

        fun acquire(since: Long): LogStream? {
            if (openCount.incrementAndGet() > MAX_STREAMS) { openCount.decrementAndGet(); return null }
            return LogStream().also { it.begin(since) }
        }
    }

    private val queue = LinkedBlockingQueue<ByteArray>(1500)
    private val born = System.currentTimeMillis()
    @Volatile private var closed = false
    @Volatile private var overflow = false
    private var cur = ByteArray(0)
    private var pos = 0
    private val listener: (CatchLog) -> Unit = { e -> if (!closed && !queue.offer(frame(e))) overflow = true }

    private fun frame(e: CatchLog): ByteArray = ("data: " + entryJson(e).toString() + "\n\n").toByteArray(Charsets.UTF_8)

    private fun begin(since: Long) {
        queue.offer(": connected\n\n".toByteArray(Charsets.UTF_8))
        LogCatcher.subscribe(listener)
        val snap = LogCatcher.snapshot()
        // The page's id is ahead of ours: the host restarted and ids began again. Tell the page to drop its old rows and
        // resend everything, otherwise it would ignore every new entry until the ids caught up with the old number.
        val from = if (since > (snap.lastOrNull()?.id ?: 0L)) {
            queue.offer("event: reset\ndata: 1\n\n".toByteArray(Charsets.UTF_8)); 0L
        } else since
        snap.filter { it.id > from }.forEach { if (!queue.offer(frame(it))) overflow = true }
    }

    override fun read(): Int {
        val one = ByteArray(1)
        return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
        if (len == 0) return 0
        while (true) {
            if (closed || System.currentTimeMillis() - born > MAX_LIFETIME_MS) return -1
            if (pos < cur.size) {
                val n = minOf(len, cur.size - pos)
                System.arraycopy(cur, pos, b, off, n)
                pos += n
                return n
            }
            val next = try { queue.poll(15, TimeUnit.SECONDS) } catch (_: InterruptedException) { closed = true; return -1 }
            cur = when {
                next != null -> next
                overflow -> { overflow = false; "event: lagged\ndata: 1\n\n".toByteArray(Charsets.UTF_8) }
                else -> ": ping\n\n".toByteArray(Charsets.UTF_8)   // keeps proxies open and lets a dead client be noticed
            }
            pos = 0
        }
    }

    override fun available(): Int = if (pos < cur.size) cur.size - pos else 0

    override fun close() {
        if (closed) return
        closed = true
        LogCatcher.unsubscribe(listener)
        openCount.decrementAndGet()
    }
}

/** Search every saved session file for a keyword or regular expression, optionally within a time range. */
object LogSearch {
    class Hit(val session: String, val line: Int, val text: String)

    class Result(val hits: List<Hit>, val scanned: Int, val truncated: Boolean, val error: String?, val busy: Boolean = false) {
        fun toJson(): JSONObject {
            val arr = JSONArray()
            hits.forEach { arr.put(JSONObject().put("session", it.session).put("line", it.line).put("text", it.text)) }
            return JSONObject().put("hits", arr).put("scanned", scanned).put("truncated", truncated)
                .put("error", error ?: JSONObject.NULL)
        }
    }

    private val gate = Semaphore(1)
    private const val BUDGET_NS = 8_000_000_000L

    private class Timeout : RuntimeException()

    private class Deadline(val until: Long) {
        var n = 0
        fun check() { if ((++n and 0x3ff) == 0 && System.nanoTime() > until) throw Timeout() }
    }

    /** A regex runs on this view of the line so a pathological pattern is cut off instead of freezing the device. */
    private class Guarded(private val s: CharSequence, private val d: Deadline) : CharSequence {
        override val length: Int get() = s.length
        override fun get(index: Int): Char { d.check(); return s[index] }
        override fun subSequence(startIndex: Int, endIndex: Int): CharSequence = Guarded(s.subSequence(startIndex, endIndex), d)
        override fun toString(): String = s.toString()
    }

    private fun levelOf(line: String): String? {
        val a = line.indexOf(" [")
        if (a < 0) return null
        val b = line.indexOf(']', a + 2)
        return if (b > a + 2) line.substring(a + 2, b) else null
    }

    private fun matches(p: Pattern, line: String, d: Deadline): Boolean =
        try { p.matcher(Guarded(line, d)).find() } catch (_: StackOverflowError) { false }

    fun run(ctx: Context, q: String, regex: Boolean, level: String, from: String, until: String, limit: Int): Result {
        if (q.length > 200) return Result(emptyList(), 0, false, "Search text is limited to 200 characters")
        if (!gate.tryAcquire()) return Result(emptyList(), 0, false, "A search is already running; try again in a moment", busy = true)
        try {
            val pattern: Pattern? = if (regex && q.isNotEmpty()) {
                try { Pattern.compile(q, Pattern.CASE_INSENSITIVE) }
                catch (e: PatternSyntaxException) { return Result(emptyList(), 0, false, "Invalid regular expression: ${e.description}") }
            } else null
            val lv = level.uppercase(Locale.US).takeIf { it in listOf("ERROR", "WARNING", "INFO", "DEBUG") }
            val d = Deadline(System.nanoTime() + BUDGET_NS)
            val hits = ArrayList<Hit>()
            var scanned = 0
            var truncated = false
            outer@ for (file in LogCatcher.sessions(ctx)) {
                if (System.nanoTime() > d.until) { truncated = true; break }
                scanned++
                val reader = try { file.bufferedReader() } catch (_: IOException) { continue }
                try {
                    var n = 0
                    while (true) {
                        val line = reader.readLine() ?: break
                        n++
                        if (line.startsWith("#")) continue
                        if (lv != null && levelOf(line) != lv) continue
                        if (from.isNotEmpty() && line.take(from.length) < from) continue
                        if (until.isNotEmpty() && line.take(until.length) > until) continue
                        if (q.isNotEmpty()) {
                            val ok = if (pattern != null) matches(pattern, line, d) else line.contains(q, true)
                            if (!ok) continue
                        }
                        hits.add(Hit(file.name, n, line.take(600)))
                        if (hits.size >= limit) { truncated = true; break@outer }
                    }
                } catch (_: Timeout) {
                    truncated = true; break@outer
                } catch (_: IOException) {
                    // unreadable file: skip it
                } finally {
                    try { reader.close() } catch (e: IOException) { Quiet.note("LogTools.run", e) }
                }
            }
            return Result(hits, scanned, truncated, null)
        } finally {
            gate.release()
        }
    }
}

/**
 * Zip archives for the web page: every saved session, or a problem-report bundle that also carries device info
 * and (when root and a recent sign-in allow it) the kernel log. No password, token or router credential is ever
 * written into an archive.
 */
object LogExport {
    private val busy = Semaphore(1)
    private const val MAX_BYTES = 64L * 1024L * 1024L

    /** Deletes the archive as soon as the HTTP response has been sent (or abandoned). */
    class DeleteOnClose(private val file: File) : FilterInputStream(FileInputStream(file)) {
        override fun close() { try { super.close() } finally { file.delete() } }
    }

    /**
     * Builds the export archive. [report] adds device info and dmesg; [bundle] (needs root) also adds everything the boot capture
     * holds (logcat, kernel log, context, Magisk log, modules, app files). With [redact] every text entry goes through [Redactor]
     * line by line (SMS text, phone numbers, IMEI/ICCID, passwords, tokens) and REDACTION.txt says what was hidden.
     * The files on the device are never changed. Entries are deflate-compressed by the zip.
     */
    fun build(ctx: Context, report: Boolean, rootOk: Boolean, bundle: Boolean = false, redact: Boolean = true): File? {
        if (!busy.tryAcquire()) return null
        var out: File? = null
        var tmp: File? = null
        try {
            val dir = File(ctx.cacheDir, "log_exports").apply { mkdirs() }
            dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 3_600_000L }?.forEach { it.delete() }
            val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
            val prefix = if (bundle) "matchitool_bundle_" else if (report) "matchitool_report_" else "matchitool_sessions_"
            val zipFile = File(dir, prefix + stamp + ".zip")
            out = zipFile
            val red = if (redact) Redactor() else null
            ZipOutputStream(BufferedOutputStream(FileOutputStream(zipFile))).use { z ->
                fun put(name: String, text: String) {
                    z.putNextEntry(ZipEntry(name)); z.write((red?.text(text) ?: text).toByteArray(Charsets.UTF_8)); z.closeEntry()
                }
                /** One file into the archive: copied as it is, or line by line through the redactor. Returns the bytes read. */
                fun putFile(name: String, file: File): Long {
                    z.putNextEntry(ZipEntry(name))
                    if (red == null) file.inputStream().use { it.copyTo(z) }
                    else file.bufferedReader(Charsets.UTF_8).use { r ->
                        val w = z.bufferedWriter(Charsets.UTF_8)
                        while (true) { val l = r.readLine() ?: break; w.write(red.line(l)); w.write("\n") }
                        w.flush()   // not closed: that would close the zip
                    }
                    z.closeEntry()
                    return file.length()
                }
                if (report || bundle) put("device.txt", deviceInfo(ctx, rootOk))
                put("recent_buffer.txt", LogCatcher.snapshot().joinToString("\n") { it.line() })
                if ((report || bundle) && rootOk) {
                    val r = RootShell.run(ctx, "dmesg 2>&1 | tail -n 500", 15_000)
                    put("dmesg.txt", r.content)
                }
                var total = 0L
                if (bundle && rootOk) {
                    // The capture folder is root-only: a root call copies it into the app's cache (owned by the app), then it is read normally.
                    val t = File(ctx.cacheDir, "boot_export").also { tmp = it }
                    val uid = android.os.Process.myUid()
                    val cp = RootShell.run(ctx, "T='${t.absolutePath}'; rm -rf \"\$T\"; mkdir -p \"\$T\" && cp ${BootLogdModel.LOG_DIR}/* \"\$T\"/ 2>/dev/null; " +
                        "chown -R $uid:$uid \"\$T\" 2>/dev/null; chmod -R u+rwX,go-rwx \"\$T\" 2>/dev/null; restorecon -R \"\$T\" 2>/dev/null; echo COPIED", 60_000)
                    val files = t.listFiles()?.filter { it.isFile && BootLogdModel.isSafeFileName(it.name) }.orEmpty()
                        .sortedWith(compareBy({ BootLogdModel.bundleOrder(it.name) }, { BootLogdModel.rotationIndex(it.name) }))
                    if (!cp.content.contains("COPIED") || files.isEmpty())
                        put("BOOT_CAPTURE_MISSING.txt", "No boot capture files could be read (is boot capture turned on, and did root allow the copy?). ${cp.content.take(200)}")
                    var cut = false
                    for (f in files) {
                        if (total + f.length() > MAX_BYTES) { cut = true; break }
                        total += putFile("bootcapture/" + f.name, f)
                    }
                    if (cut) put("TRUNCATED_BOOTCAPTURE.txt", "Older boot capture parts were left out: the archive is limited to ${MAX_BYTES / (1024 * 1024)} MB.")
                }
                for (file in LogCatcher.sessions(ctx)) {
                    if (total + file.length() > MAX_BYTES) {
                        put("TRUNCATED.txt", "Older sessions were left out: the archive is limited to ${MAX_BYTES / (1024 * 1024)} MB.")
                        break
                    }
                    total += putFile("sessions/" + file.name, file)
                }
                // Written last so the counts are complete (the note itself is never redacted).
                z.putNextEntry(ZipEntry("REDACTION.txt"))
                z.write((if (red != null) "Private data was hidden in this archive (SMS text, phone numbers, IMEI/ICCID, passwords, tokens).\n" +
                    "The files on the device are unchanged. Rules lean towards hiding too much.\n\n" + red.summary() + "\n"
                else "NOT redacted: this archive holds the original text and can contain private data. Do not share it publicly.\n").toByteArray(Charsets.UTF_8))
                z.closeEntry()
            }
            return zipFile
        } catch (e: Exception) {
            Log.e("MatchiLogExport", "Archive failed", e)
            try { out?.delete() } catch (e: Exception) { Quiet.note("LogTools.put", e) }
            return null
        } finally {
            try { tmp?.deleteRecursively() } catch (e: Exception) { Quiet.note("LogExport.tmp", e) }
            busy.release()
        }
    }

    private fun deviceInfo(ctx: Context, rootOk: Boolean): String {
        val sb = StringBuilder()
        fun line(k: String, v: Any?) { sb.append(k).append(": ").append(v).append('\n') }
        line("generated", SimpleDateFormat("yyyy-MM-dd HH:mm:ss Z", Locale.US).format(Date()))
        @Suppress("DEPRECATION")
        val pi = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0) } catch (_: Exception) { null }
        line("app version", pi?.versionName ?: "?")
        line("manufacturer / model", "${Build.MANUFACTURER} / ${Build.MODEL}")
        line("android", "${Build.VERSION.RELEASE} (sdk ${Build.VERSION.SDK_INT})")
        line("build", Build.DISPLAY)
        line("abi", Build.SUPPORTED_ABIS.joinToString(","))
        try {
            val mi = ActivityManager.MemoryInfo()
            (ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(mi)
            line("memory", "${mi.availMem / (1024 * 1024)} MB free of ${mi.totalMem / (1024 * 1024)} MB, low=${mi.lowMemory}")
        } catch (e: Exception) { Quiet.note("LogTools.line", e) }
        line("app storage free", "${ctx.filesDir.usableSpace / (1024 * 1024)} MB")
        line("log session running", LogCatcher.isRunning())
        line("log disk writes dropped", LogCatcher.droppedWriteCount())
        val dev = DeviceLogs.settings(ctx)
        line("device capture", "logcat=${dev.logcat}, dmesg=${dev.dmesg}, level=${dev.level}, active=${DeviceLogs.isActive()}")
        if (rootOk) {
            try { val st = RootShell.status(ctx); line("root", "granted=${st.granted}, uid=${st.uid}, manager=${st.managerHint}") }
            catch (_: Exception) { line("root", "status check failed") }
        } else line("root", "not queried (HTTP needs confirmation, or the sign-in is too old); dmesg left out")
        return sb.toString()
    }
}

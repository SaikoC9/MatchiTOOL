package com.matchi.tool

import java.io.InputStream
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/*
 * Live panel real-time plan, Phase 2: the push side. Plain Kotlin (no Android classes, no org.json) so it is unit tested.
 *
 * LiveSampler (Phase 1) produces one snapshot a second. This file turns snapshots into server-sent events for the page:
 *   - [LiveFrameEncoder]  snapshot -> one JSON line, only what changed since the last frame this viewer got
 *   - [LiveStream]        the InputStream the web server sends as a chunked "text/event-stream" answer (one per browser)
 *   - [LiveHub]           counts viewers; the first one starts the sampler, the last one to leave stops it
 *
 * Nothing in the page uses the route yet (Phase 4). Phase 3 (run only while watched) is in here too:
 *   - the last viewer leaving does not stop the root reader at once but after [LiveTiming.graceMs] (a page reload or a quick tab switch
 *     does not restart `su`);
 *   - a viewer can say its tab is hidden ([LiveHub.setVisible]); with no visible viewer left the reader stops after the same grace time;
 *   - a new (or visible again) viewer gets the last reading at once ([LiveStream.replay]), as long as it is younger than [LiveTiming.cacheMaxMs] (5 s).
 */

/** Quotes [s] as one JSON string on one line (a raw line break would end a server-sent event early). */
internal fun liveJsonString(s: String): String {
    val sb = StringBuilder(s.length + 2)
    sb.append('"')
    for (c in s) {
        if (c == '"') sb.append("\\\"")
        else if (c == '\\') sb.append("\\\\")
        else if (c < ' ' || c == '\u2028' || c == '\u2029') sb.append("\\u").append(c.code.toString(16).padStart(4, '0'))
        else sb.append(c)
    }
    return sb.append('"').toString()
}

/**
 * Turns [LiveSnapshot]s into JSON frames for ONE viewer and remembers what that viewer already has, so a frame carries only what changed.
 *
 * Frame: {"v":1,"seq":N,"t":<sample time, ms>,"full":bool, ...fields}. Fields, each left out when unchanged:
 *   "cpu": 12.3                               total CPU busy %, left out while unknown (the first round)
 *   "pc":  {"0":10.0,"1":20.5}                busy % per core
 *   "fq":  {"0":[1,936000,1800000]}           per core [online 1/0, current kHz, max kHz]
 *   "tz":  {"soc-thermal":45.0}               kernel thermal zones in degrees C
 *   "sys": {"l":[a,b,c],"up":s,"mt":kB,"ma":kB,"at":ms}   load, uptime, memory, and when they were read (changes every 5th round)
 * A frame with "full":true is the whole picture: the page replaces what it has (a field that is missing there has no value) and
 * "pc", "fq" and "tz" are always present in it. The first frame, every [fullEvery]th frame after that, and the frame after a dropped
 * one are full. A delta never says that a zone or core went away; the next full frame does.
 *
 * Not thread safe on purpose: it is used only from the sampler's thread.
 */
class LiveFrameEncoder(private val fullEvery: Int = FULL_EVERY) {
    companion object {
        const val VERSION = 1
        const val FULL_EVERY = 30
    }

    private val sent = HashMap<String, String>()
    private var seq = 0L
    private var sinceFull = 0
    @Volatile private var needFull = true

    /** The next frame will be a full one (a frame was dropped, or the viewer says it lost track). */
    fun forceFull() { needFull = true }

    private fun num(d: Double): String = if (d.isNaN() || d.isInfinite()) "null" else d.toString()

    fun encode(snap: LiveSnapshot): String {
        // One entry per value, keyed by group letter + id: c (cpu), p<core>, f<core>, z<zone name>, s (sys).
        val cur = LinkedHashMap<String, String>()
        val cpu = snap.cpuPct
        if (cpu != null) cur["c"] = num(cpu)
        for (c in snap.cores) cur["p" + c.id] = num(c.pct)
        for (f in snap.freqs) cur["f" + f.id] = "[" + (if (f.online) 1 else 0) + "," + f.curKhz + "," + f.maxKhz + "]"
        for (z in snap.zones) cur["z" + z.name] = num(z.celsius)
        val sys = snap.sys
        if (sys != null) {
            cur["s"] = "{\"l\":[" + num(sys.load1) + "," + num(sys.load5) + "," + num(sys.load15) + "],\"up\":" + num(sys.uptimeSec) +
                ",\"mt\":" + sys.memTotalKb + ",\"ma\":" + sys.memAvailKb + ",\"at\":" + (snap.sysAt ?: snap.at) + "}"
        }

        var full = needFull
        if (!full) { sinceFull++; if (sinceFull >= fullEvery) full = true }
        if (full) { needFull = false; sinceFull = 0; sent.clear() }

        var cpuJson: String? = null
        var sysJson: String? = null
        val pc = ArrayList<String>()
        val fq = ArrayList<String>()
        val tz = ArrayList<String>()
        for ((k, v) in cur) {
            if (!full && sent[k] == v) continue
            val id = k.substring(1)
            when (k[0]) {
                'c' -> cpuJson = v
                'p' -> pc.add("\"" + id + "\":" + v)
                'f' -> fq.add("\"" + id + "\":" + v)
                'z' -> tz.add(liveJsonString(id) + ":" + v)
                's' -> sysJson = v
            }
        }
        sent.putAll(cur)

        val sb = StringBuilder(320)
        sb.append("{\"v\":").append(VERSION).append(",\"seq\":").append(++seq).append(",\"t\":").append(snap.at).append(",\"full\":").append(full)
        if (cpuJson != null) sb.append(",\"cpu\":").append(cpuJson)
        if (full || pc.isNotEmpty()) sb.append(",\"pc\":{").append(pc.joinToString(",")).append('}')
        if (full || fq.isNotEmpty()) sb.append(",\"fq\":{").append(fq.joinToString(",")).append('}')
        if (full || tz.isNotEmpty()) sb.append(",\"tz\":{").append(tz.joinToString(",")).append('}')
        if (sysJson != null) sb.append(",\"sys\":").append(sysJson)
        return sb.append('}').toString()
    }
}

/** Timing of one stream. The defaults are the real ones; tests use small values. */
data class LiveTiming(
    val tickMs: Long = 1_000,                       // how often a quiet stream looks at the clock
    val pingMs: Long = 15_000,                      // a comment line when nothing was written for this long (lets a dead client be noticed)
    val stallMs: Long = 10_000,                     // no snapshot for this long: tell the page (event: stale), once per stall
    val maxLifeMs: Long = 20L * 60L * 1000L,        // every stream ends by itself; the page opens a new one (same gate check again)
    val allowedEveryMs: Long = 5_000,               // how often the session is looked at again while streaming
    val graceMs: Long = 10_000,                     // the root reader keeps running this long after the last visible viewer left (0 = stop at once)
    val cacheMaxMs: Long = 5_000                    // the last reading is sent to a new / visible-again viewer only when it is younger than this (the page shows it as live, and the reader stops 10 s after the last viewer, so an older one is only ever stale)
)

/**
 * What one browser receives, as a server-sent-events body. It blocks in [read] until the next frame (the web server sends each as one chunk).
 *
 * Events: `data:` frames (see [LiveFrameEncoder]); `event: stale` with {"note":...} when the sampler has gone quiet; `event: end` with
 * {"reason":"session"|"lifetime"} right before the stream closes. [allowed] says whether the session may still run root things (logged
 * out, password changed or sign-in older than 4 h: no); it is asked every [LiveTiming.allowedEveryMs], so a sign-out stops the root
 * reader instead of only blocking new streams. At most [QUEUE] frames wait for a slow browser; the rest are dropped and the next frame
 * is a full one.
 */
class LiveStream internal constructor(
    private val hub: LiveHub,
    private val allowed: () -> Boolean,
    private val note: () -> String,
    private val timing: LiveTiming,
    private val clock: () -> Long,
    /** Random name of this stream; the page gets it in the `X-Live-Id` header and uses it to say "my tab is hidden / visible". */
    internal val id: String = "",
    /** The session token that opened the stream: only that session may change [visible]. Kept in memory only. */
    private val owner: String = ""
) : InputStream() {
    companion object {
        const val QUEUE = 8
        private val PING = ": ping\n\n".toByteArray(Charsets.UTF_8)
    }

    private val queue = LinkedBlockingQueue<ByteArray>(QUEUE)
    private val born = clock()
    private val released = AtomicBoolean(false)
    private val encoder = LiveFrameEncoder()
    private val encodeLock = Any()          // the sampler thread and a thread that replays the cached reading both encode
    private var lastPushedAt = Long.MIN_VALUE   // guarded by encodeLock: an older reading never goes out after a newer one
    @Volatile internal var visible = true
    @Volatile private var done = false
    @Volatile private var lastFrameAt = born
    private var unlisten: (() -> Unit)? = null
    // The fields below belong to the thread that reads (the web server's), nobody else touches them.
    private var cur = ByteArray(0)
    private var pos = 0
    private var ending = false
    @Volatile private var stale = false
    private var lastWriteAt = born
    private var lastAllowedAt = born

    init { queue.offer(": connected\n\n".toByteArray(Charsets.UTF_8)) }

    /** Listens to [sampler] (called by [LiveHub.open] under its lock, before the sampler is started). */
    internal fun attach(sampler: LiveSampler) { unlisten = sampler.listen { snap -> onSnapshot(snap) } }

    /** Runs on the sampler's thread: short, never blocks. */
    private fun onSnapshot(snap: LiveSnapshot) = push(snap)

    private fun push(snap: LiveSnapshot) {
        if (done) return
        synchronized(encodeLock) {
            if (snap.at < lastPushedAt) return
            lastPushedAt = snap.at
            val bytes = ("data: " + encoder.encode(snap) + "\n\n").toByteArray(Charsets.UTF_8)
            lastFrameAt = clock()
            if (!queue.offer(bytes)) encoder.forceFull()   // the browser is behind: this frame is lost, so the next one repeats everything
        }
    }

    /**
     * Phase 3: sends the sampler's last reading right away, as a full frame with its real sample time, so a page that opens (or comes back)
     * shows values at once instead of waiting for the next round. Nothing is sent when there is none or it is older than [LiveTiming.cacheMaxMs].
     */
    internal fun replay(last: LiveSnapshot?, forceFull: Boolean = false) {
        if (last == null || clock() - last.at > timing.cacheMaxMs) return
        if (forceFull) encoder.forceFull()
        push(last)
    }

    /** Phase 3: the page says its tab is hidden or visible again. Only while visible does a silent reader count as "stale". */
    internal fun setVisible(v: Boolean, last: LiveSnapshot?) {
        val was = visible
        visible = v
        if (v && !was) { lastFrameAt = clock(); stale = false; replay(last, true) }
    }

    internal fun ownedBy(token: String): Boolean =
        owner.isNotEmpty() && MessageDigest.isEqual(owner.toByteArray(Charsets.UTF_8), token.toByteArray(Charsets.UTF_8))

    private fun load(b: ByteArray) { cur = b; pos = 0; lastWriteAt = clock() }

    private fun endReason(now: Long): String? {
        if (now - born > timing.maxLifeMs) return "lifetime"
        if (now - lastAllowedAt >= timing.allowedEveryMs) {
            lastAllowedAt = now
            if (!allowed()) return "session"
        }
        return null
    }

    override fun read(): Int {
        val one = ByteArray(1)
        return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
        if (len == 0) return 0
        while (true) {
            if (pos < cur.size) {
                val n = minOf(len, cur.size - pos)
                System.arraycopy(cur, pos, b, off, n)
                pos += n
                return n
            }
            if (ending || done) return -1
            val why = endReason(clock())
            if (why != null) {
                ending = true
                load(("event: end\ndata: {\"reason\":\"" + why + "\"}\n\n").toByteArray(Charsets.UTF_8))
                continue
            }
            val next = try { queue.poll(timing.tickMs, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) {
                done = true; Thread.currentThread().interrupt(); return -1
            }
            if (next != null) { stale = false; load(next); continue }
            val now = clock()
            if (!stale && visible && now - lastFrameAt > timing.stallMs) {
                stale = true
                load(("event: stale\ndata: {\"note\":" + liveJsonString(note().take(120)) + "}\n\n").toByteArray(Charsets.UTF_8))
            } else if (now - lastWriteAt >= timing.pingMs) load(PING)
        }
    }

    override fun available(): Int = if (pos < cur.size) cur.size - pos else 0

    /** Called by the web server when the answer ends or the browser is gone. Safe to call more than once. */
    override fun close() {
        done = true
        if (!released.compareAndSet(false, true)) return
        try { unlisten?.invoke() } catch (e: Exception) { Quiet.note("LiveStream.close", e) }
        hub.release(this)
    }
}

private val graceTimer: ScheduledExecutorService by lazy {
    Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "MatchiLiveGrace").apply { isDaemon = true } }
}

/** The real timer of the grace time: runs [task] once after [ms]; the returned function cancels it. */
internal fun liveHubSchedule(ms: Long, task: () -> Unit): () -> Unit {
    val f = graceTimer.schedule(Runnable { task() }, ms, TimeUnit.MILLISECONDS)
    return { f.cancel(false) }
}

/**
 * Shares ONE [LiveSampler] between all browsers. It runs only while at least one open stream is visible (Phase 3): the first viewer starts
 * it, and when the last visible viewer leaves or hides its tab it keeps running for [LiveTiming.graceMs] and then stops, unless someone
 * came back in between. At most [maxViewers] streams at once. Every change happens under one lock, so a viewer who arrives while the
 * last one is leaving can never be left with a stopped sampler.
 */
class LiveHub(
    private val sampler: LiveSampler,
    private val maxViewers: Int = MAX_VIEWERS,
    private val timing: LiveTiming = LiveTiming(),
    private val clock: () -> Long = System::currentTimeMillis,
    private val schedule: (Long, () -> Unit) -> (() -> Unit) = ::liveHubSchedule
) {
    companion object { const val MAX_VIEWERS = 4 }

    private val lock = Any()
    private val streams = LinkedHashMap<String, LiveStream>()   // guarded by lock
    private val rnd = SecureRandom()
    private var cancelStop: (() -> Unit)? = null                 // guarded by lock: the pending "stop after the grace time"
    private var stopGen = 0                                      // guarded by lock: a timer that fires late sees a newer number and does nothing

    fun viewers(): Int = synchronized(lock) { streams.size }

    /** How many open streams are visible (a hidden tab does not count). */
    fun watching(): Int = synchronized(lock) { streams.values.count { it.visible } }

    private fun newId(): String { val b = ByteArray(12); rnd.nextBytes(b); return b.joinToString("") { "%02x".format(it) } }

    /**
     * A new stream, or null when [maxViewers] are already open. [owner] is the session token (only that session may hide / show the stream).
     * The caller must close the stream (the web server does when the answer ends). The stream starts visible and, when the sampler has a
     * recent reading, its first frame is that reading.
     */
    fun open(allowed: () -> Boolean, owner: String = ""): LiveStream? {
        synchronized(lock) {
            if (streams.size >= maxViewers) return null
            var id = newId()
            while (streams.containsKey(id)) id = newId()
            val st = LiveStream(this, allowed, { sampler.lastNote() }, timing, clock, id, owner)
            st.replay(sampler.latest())     // before it listens: nothing else is encoding for this stream yet
            st.attach(sampler)
            streams[id] = st
            refresh()
            return st
        }
    }

    /** The page says the tab of stream [id] is hidden or visible. False when there is no such stream or it belongs to another session. */
    fun setVisible(id: String, owner: String, visible: Boolean): Boolean {
        synchronized(lock) {
            val st = streams[id] ?: return false
            if (!st.ownedBy(owner)) return false
            st.setVisible(visible, sampler.latest())
            refresh()
            return true
        }
    }

    internal fun release(st: LiveStream) {
        synchronized(lock) {
            if (streams.remove(st.id) != null) refresh()
        }
    }

    /** Ends every stream and the root reader (the service is going away). Safe to call more than once. */
    fun shutdown() {
        val all: List<LiveStream>
        synchronized(lock) { all = streams.values.toList(); cancelPendingStop() }
        for (st in all) st.close()
        synchronized(lock) { cancelPendingStop(); sampler.stop() }
    }

    /** Called with the lock held after every change: run the sampler while somebody is looking, otherwise count the grace time down. */
    private fun refresh() {
        if (streams.values.any { it.visible }) {
            cancelPendingStop()
            sampler.start()                 // does nothing when it already runs; starts it again if its thread had ended
        } else if (sampler.isRunning()) {
            if (timing.graceMs <= 0) { cancelPendingStop(); sampler.stop() }
            else if (cancelStop == null) {
                val gen = ++stopGen
                cancelStop = schedule(timing.graceMs) { graceOver(gen) }
            }
        }
    }

    private fun cancelPendingStop() {
        stopGen++
        val c = cancelStop; cancelStop = null
        try { c?.invoke() } catch (e: Exception) { Quiet.note("LiveHub.cancelStop", e) }
    }

    private fun graceOver(gen: Int) {
        synchronized(lock) {
            if (gen != stopGen || cancelStop == null) return
            cancelStop = null
            if (streams.values.none { it.visible }) sampler.stop()
        }
    }
}

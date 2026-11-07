package com.matchi.tool

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Smooth screen streaming. While at least one browser is watching, a background thread keeps capturing the screen
 * and always holds the newest JPEG, so a request is answered the moment a new frame exists instead of starting a
 * capture. Capture is fast: one long-lived root `sh` is asked for `screencap` (raw pixels, no PNG), the frame is
 * read straight from its pipe, shrunk and JPEG-encoded. A screen that did not change is not re-encoded or re-sent.
 * If the raw path is unavailable or fails, it falls back to the slower PNG capture in [ScreenCapture].
 * The thread stops by itself a few seconds after the last viewer goes away.
 */
object ScreenStreamer {
    class Shot(val seq: Long, val frame: ScreenCapture.Frame)

    private const val VIEWER_TTL_MS = 6_000L
    private const val MIN_FRAME_MS = 50L      // at most ~20 captures per second
    private const val IDLE_FRAME_MS = 250L    // screen unchanged: look 4 times a second, send nothing
    private const val ERROR_RETRY_MS = 700L
    private const val BURST_MS = 1_800L       // after a tap / swipe / key: keep capturing at full speed so the result shows at once
    private const val RAW_TIMEOUT_S = 8L

    private const val RAW_UNKNOWN = 0
    private const val RAW_OK = 1
    private const val RAW_OFF = 2

    private val lock = ReentrantLock()
    private val cond = lock.newCondition()
    private val wakeCond = lock.newCondition()
    private var thread: Thread? = null
    private var seq = 0L
    private var latest: ScreenCapture.Frame? = null
    private var error: String? = null

    @Volatile private var lastViewer = 0L
    @Volatile private var burstUntil = 0L
    @Volatile private var scale = 50
    @Volatile private var quality = 60
    @Volatile private var dirty = true
    @Volatile private var rawMode = RAW_UNKNOWN
    @Volatile private var hdrSize = 0

    /**
     * Called right after an input event: wakes the capture thread and keeps it at full speed for a moment, so the
     * reaction on screen (a scroll, a menu opening) is sent immediately instead of up to 250 ms later.
     */
    fun kick() {
        burstUntil = System.currentTimeMillis() + BURST_MS
        try { lock.withLock { wakeCond.signalAll() } } catch (_: Exception) { }
    }

    fun modeName(): String = if (rawMode == RAW_OK) "raw" else "png"

    /**
     * The next frame newer than [since], waiting up to [waitMs] for it. null = nothing new (screen unchanged).
     * Throws with a readable message when the capture is failing (display off, root missing, ...).
     */
    fun next(ctx: Context, since: Long, scalePct: Int, q: Int, waitMs: Long): Shot? {
        val s = scalePct.coerceIn(15, 100)
        val qq = q.coerceIn(20, 90)
        if (s != scale || qq != quality) { scale = s; quality = qq; dirty = true }
        lastViewer = System.currentTimeMillis()
        ensureRunning(ctx.applicationContext)
        var remainNs = TimeUnit.MILLISECONDS.toNanos(waitMs)
        try {
            return lock.withLock {
                var result: Shot? = null
                var done = false
                while (!done) {
                    if (seq > since) {
                        val e = error
                        val f = latest
                        if (e != null) throw IllegalStateException(e)
                        if (f != null) { result = Shot(seq, f); done = true }
                    }
                    if (!done) {
                        if (remainNs <= 0L) done = true else remainNs = cond.awaitNanos(remainNs)
                    }
                }
                result
            }
        } finally {
            lastViewer = System.currentTimeMillis()
        }
    }

    private fun ensureRunning(ctx: Context) {
        lock.withLock {
            if (thread?.isAlive == true) return
            val t = Thread({ Worker(ctx).loop() }, "MatchiScreen")
            t.isDaemon = true
            thread = t
            dirty = true
            t.start()
        }
    }

    private class Grabbed(val frame: ScreenCapture.Frame?, val unchanged: Boolean)

    private class Proc(val p: Process) {
        val out = p.outputStream
        val inp = DataInputStream(BufferedInputStream(p.inputStream, 1 shl 16))
        private val errThread = Thread({
            try { val b = ByteArray(1024); val e = p.errorStream; while (e.read(b) >= 0) { /* drain */ } } catch (_: Exception) { }
        }, "MatchiScreenErr").apply { isDaemon = true; start() }
        fun close() {
            try { out.close() } catch (_: Exception) { }
            try { p.destroy() } catch (_: Exception) { }
            try { if (!p.waitFor(250, TimeUnit.MILLISECONDS) && p.isAlive) p.destroyForcibly() } catch (_: Exception) {
                try { if (p.isAlive) p.destroyForcibly() } catch (_: Exception) { }
            }
            try { p.inputStream.close() } catch (_: Exception) { }
            try { p.errorStream.close() } catch (_: Exception) { }
            try { errThread.join(150) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
        }
    }

    /** All per-thread state (process, buffers) lives here, so a stopping thread can never touch a new thread's data. */
    private class Worker(val ctx: Context) {
        private var proc: Proc? = null
        private var buf: ByteArray? = null
        private var bmp: Bitmap? = null
        private var sbmp: Bitmap? = null
        private val scaler = Canvas()
        private val scalePaint = Paint(Paint.FILTER_BITMAP_FLAG)
        private val jpegOut = ByteArrayOutputStream(48 * 1024)
        private var lastHash = 0
        private var lastW = 0
        private var lastH = 0
        private var rawFailures = 0
        private val exec = Executors.newSingleThreadExecutor { r -> Thread(r, "MatchiScreenRead").apply { isDaemon = true } }

        fun loop() {
            try {
                while (true) {
                    val t0 = System.currentTimeMillis()
                    val stop = lock.withLock {
                        if (t0 - lastViewer >= VIEWER_TTL_MS) { thread = null; latest = null; error = null; true } else false
                    }
                    if (stop) break
                    var pause = MIN_FRAME_MS
                    try {
                        val g = grab()
                        if (g.unchanged) {
                            pause = if (System.currentTimeMillis() < burstUntil) MIN_FRAME_MS else IDLE_FRAME_MS
                        } else {
                            lock.withLock { latest = g.frame; error = null; seq++; cond.signalAll() }
                        }
                    } catch (e: Exception) {
                        dirty = true   // after an error the next good frame must be sent even if it looks like the old one
                        lock.withLock { error = e.message ?: "screen capture failed"; seq++; cond.signalAll() }
                        pause = ERROR_RETRY_MS
                    }
                    val spent = System.currentTimeMillis() - t0
                    if (spent < pause) {
                        // interruptible wait: kick() ends it early
                        try { lock.withLock { wakeCond.awaitNanos(TimeUnit.MILLISECONDS.toNanos(pause - spent)) } } catch (_: InterruptedException) { }
                    }
                }
            } finally {
                closeProc()
                exec.shutdownNow()
                bmp?.recycle(); bmp = null; sbmp?.recycle(); sbmp = null; buf = null
            }
        }

        private fun closeProc() { proc?.close(); proc = null }

        private fun grab(): Grabbed {
            if (rawMode == RAW_UNKNOWN) return calibrate()
            if (rawMode == RAW_OK) {
                try { val g = rawGrab(); rawFailures = 0; return g } catch (e: Exception) {
                    closeProc()
                    rawFailures++
                    if (rawFailures >= 3) rawMode = RAW_OFF
                    // this frame comes from the slower PNG path; if that fails too its error is what the page shows
                }
            }
            return Grabbed(ScreenCapture.frame(ctx, scale, quality), false)
        }

        /** First frame: take it the slow, certain way (gives the screen size) and measure the raw header size. */
        private fun calibrate(): Grabbed {
            val png = ScreenCapture.frame(ctx, scale, quality)
            var mode = RAW_OFF
            try {
                val r = RootShell.run(ctx, "screencap | wc -c", 15_000)
                val total = r.content.trim().lines().lastOrNull()?.trim()?.toLongOrNull()
                if (r.success && total != null) {
                    val hdr = total - png.width.toLong() * png.height.toLong() * 4L
                    if (hdr == 12L || hdr == 16L || hdr == 20L) { hdrSize = hdr.toInt(); mode = RAW_OK }
                }
            } catch (_: Exception) { }
            rawMode = mode
            return Grabbed(png, false)
        }

        private fun rawGrab(): Grabbed {
            val pr = proc ?: Proc(ProcessBuilder("su", "-c", "sh").redirectErrorStream(false).start()).also { proc = it }
            val hs = hdrSize
            val call = Callable<IntArray> {
                pr.out.write("screencap\n".toByteArray())
                pr.out.flush()
                val head = ByteArray(hs)
                pr.inp.readFully(head)
                val bb = ByteBuffer.wrap(head).order(ByteOrder.LITTLE_ENDIAN)
                val w = bb.getInt(0)
                val h = bb.getInt(4)
                val f = bb.getInt(8)
                if (w < 1 || w > 4096 || h < 1 || h > 4096 || (f != 1 && f != 2)) {
                    throw IllegalStateException("unexpected screencap header ${w}x$h format $f")
                }
                val n = w * h * 4
                val cb = buf
                val b: ByteArray = if (cb != null && cb.size == n) cb else ByteArray(n).also { buf = it }
                pr.inp.readFully(b, 0, n)
                intArrayOf(w, h)
            }
            val wh: IntArray = try {
                exec.submit(call).get(RAW_TIMEOUT_S, TimeUnit.SECONDS)
            } catch (e: TimeoutException) {
                closeProc()
                throw IllegalStateException("screencap did not answer (is the display off? press Wake)")
            } catch (e: ExecutionException) {
                closeProc()
                throw IllegalStateException(e.cause?.message ?: "raw capture failed")
            }
            val w = wh[0]
            val h = wh[1]
            val b = buf ?: throw IllegalStateException("capture buffer missing")

            var hash = 17 + w * 7 + h
            var i = 0
            while (i < b.size) { hash = hash * 31 + b[i]; i += 61 }
            val wasDirty = dirty
            dirty = false
            if (hash == lastHash && !wasDirty && w == lastW && h == lastH) return Grabbed(null, true)
            lastHash = hash; lastW = w; lastH = h

            val cur = bmp
            val bm: Bitmap = if (cur != null && cur.width == w && cur.height == h) cur else {
                cur?.recycle()
                Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also { it.setHasAlpha(false); bmp = it }
            }
            bm.copyPixelsFromBuffer(ByteBuffer.wrap(b))
            val s = scale
            val tw = (w * s / 100).coerceAtLeast(1)
            val th = (h * s / 100).coerceAtLeast(1)
            // The shrunk copy reuses one bitmap (no new allocation and no garbage collection per frame).
            val shown: Bitmap = if (tw == w && th == h) bm else {
                val c = sbmp
                val sb = if (c != null && c.width == tw && c.height == th) c else {
                    c?.recycle()
                    Bitmap.createBitmap(tw, th, Bitmap.Config.ARGB_8888).also { it.setHasAlpha(false); sbmp = it }
                }
                scaler.setBitmap(sb)
                scaler.drawBitmap(bm, Rect(0, 0, w, h), Rect(0, 0, tw, th), scalePaint)
                scaler.setBitmap(null)
                sb
            }
            val out = jpegOut
            out.reset()
            shown.compress(Bitmap.CompressFormat.JPEG, quality, out)
            return Grabbed(ScreenCapture.Frame(out.toByteArray(), w, h), false)
        }
    }
}

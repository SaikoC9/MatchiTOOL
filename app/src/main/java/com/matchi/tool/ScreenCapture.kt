package com.matchi.tool

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Screen mirroring + remote input for the web UI (a small "scrcpy" for the F50's own Android).
 * Frames come from root `screencap`, are shrunk and re-encoded as JPEG here, and are served one per
 * request. Touch and key events are injected with root `input`. Nothing is installed on the device and
 * no extra binary is bundled; it uses the same root shell as every other tool.
 */
object ScreenCapture {
    /** [srcHash] is the CRC32 of the PNG the frame was made from (0 when not known); used to skip identical captures. */
    class Frame(val jpeg: ByteArray, val width: Int, val height: Int, val srcHash: Long = 0L)

    private val lock = Any()
    private fun q(s: String) = "'" + s.replace("'", "'\\''") + "'"

    /** One frame: [scalePct] 15..100 of the real resolution, JPEG [quality] 20..90. */
    fun frame(ctx: Context, scalePct: Int, quality: Int): Frame =
        frameIfChanged(ctx, scalePct, quality, null) ?: throw IllegalStateException("screenshot unchanged")

    /** Like [frame], but returns null (without decoding or JPEG-encoding) when the screenshot's CRC32 equals [previousHash]. */
    fun frameIfChanged(ctx: Context, scalePct: Int, quality: Int, previousHash: Long?): Frame? {
        val scale = scalePct.coerceIn(15, 100)
        val qual = quality.coerceIn(20, 90)
        // One capture at a time: they share one temp file and a second parallel screencap only slows both down.
        return synchronized(lock) {
            val dir = ctx.cacheDir
            val file = File(dir, "screen.png")
            val uid = ctx.applicationInfo.uid
            val script = """
                F=${q(file.absolutePath)}
                D=${q(dir.absolutePath)}
                rm -f "§F"
                screencap -p "§F" 2>&1 || exit 1
                chown $uid:$uid "§F" 2>/dev/null
                chmod 600 "§F" 2>/dev/null
                chcon --reference="§D" "§F" 2>/dev/null
                exit 0
            """.trimIndent().replace('§', '$')
            val r = RootShell.run(ctx, script, 15_000)
            if (!r.success) {
                throw IllegalStateException("screencap failed (is the display off? press Wake): " + r.content.take(200))
            }
            val png = readPng(ctx, file)
            try { file.delete() } catch (_: Exception) {}
            val crc = java.util.zip.CRC32().also { it.update(png, 0, png.size) }.value
            if (previousHash != null && previousHash == crc) null
            else encode(png, scale, qual, crc)
        }
    }

    /** The app normally reads the file directly after chown/chmod; if SELinux blocks that, read it through root as base64. */
    private fun readPng(ctx: Context, file: File): ByteArray {
        try {
            val b = file.readBytes()
            if (b.isNotEmpty()) return b
        } catch (_: Exception) { }
        val path = file.absolutePath
        val size = RootShell.run(ctx, "stat -c %s ${q(path)}", 5_000).content.trim().toLongOrNull()
            ?: throw IllegalStateException("screenshot file missing")
        if (size <= 0L || size > 40_000_000L) throw IllegalStateException("screenshot has an odd size ($size bytes)")
        val chunk = 393_216L   // 384 KB per root call -> 512 KB of base64, safely under the shell output limit
        val out = ByteArrayOutputStream(size.toInt())
        var i = 0L
        while (i * chunk < size) {
            val r = RootShell.run(ctx, "dd if=${q(path)} bs=$chunk skip=$i count=1 2>/dev/null | base64 -w 0", 15_000)
            if (!r.success || r.content.isBlank()) throw IllegalStateException("cannot read the screenshot through root")
            out.write(Base64.decode(r.content.trim(), Base64.DEFAULT))
            i++
        }
        return out.toByteArray()
    }

    private fun encode(png: ByteArray, scalePct: Int, quality: Int, srcHash: Long): Frame {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(png, 0, png.size, bounds)
        val w = bounds.outWidth
        val h = bounds.outHeight
        if (w <= 0 || h <= 0) throw IllegalStateException("screenshot could not be decoded")

        val target = scalePct / 100.0
        var sample = 1
        while (1.0 / (sample * 2) >= target) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        val decoded = BitmapFactory.decodeByteArray(png, 0, png.size, opts)
            ?: throw IllegalStateException("screenshot could not be decoded")
        val tw = (w * target).toInt().coerceAtLeast(1)
        val th = (h * target).toInt().coerceAtLeast(1)
        val bmp = if (decoded.width == tw && decoded.height == th) decoded
                  else Bitmap.createScaledBitmap(decoded, tw, th, true)
        if (bmp !== decoded) decoded.recycle()
        val out = ByteArrayOutputStream(64 * 1024)
        bmp.compress(Bitmap.CompressFormat.JPEG, quality, out)
        bmp.recycle()
        return Frame(out.toByteArray(), w, h, srcHash)
    }

    // ---- input ------------------------------------------------------------------------------------------

    private fun coord(o: JSONObject, k: String): Int {
        val v = o.optInt(k, -1)
        if (v < 0 || v > 10_000) throw IllegalArgumentException("$k must be 0..10000")
        return v
    }

    /**
     * Printable ASCII only. Space becomes %s (what `input text` expects). The result is passed through q() (single quotes),
     * so characters like " ' & ; ( ) $ are typed as they are and never reach the shell. % and \ are refused because
     * `input text` itself treats them specially. Everything else is refused, not guessed.
     */
    private fun safeText(raw: String): String {
        if (raw.isEmpty() || raw.length > 200) throw IllegalArgumentException("text must be 1 to 200 characters")
        val sb = StringBuilder()
        for (c in raw) {
            when {
                c == ' ' -> sb.append("%s")
                c == '%' || c == '\\' -> throw IllegalArgumentException("character not supported by remote typing: $c")
                c.code in 33..126 -> sb.append(c)
                else -> throw IllegalArgumentException("character not supported by remote typing: $c")
            }
        }
        return sb.toString()
    }

    /** {"type":"tap","x":..,"y":..} | swipe (x,y,x2,y2,dur) | long (x,y) | key (code) | text (text) | wake */
    fun input(ctx: Context, req: JSONObject): ShellResult {
        val script = when (val type = req.optString("type")) {
            "tap" -> "input tap ${coord(req, "x")} ${coord(req, "y")}"
            "long" -> { val x = coord(req, "x"); val y = coord(req, "y"); "input swipe $x $y $x $y 700" }
            "swipe" -> {
                val dur = req.optInt("dur", 250).coerceIn(50, 3_000)
                "input swipe ${coord(req, "x")} ${coord(req, "y")} ${coord(req, "x2")} ${coord(req, "y2")} $dur"
            }
            "key" -> {
                val code = req.optInt("code", -1)
                if (code !in 1..350) throw IllegalArgumentException("key code must be 1..350")
                "input keyevent $code"
            }
            "text" -> "input text ${q(safeText(req.optString("text")))}"
            "wake" -> "input keyevent 224; wm dismiss-keyguard 2>/dev/null; true"
            else -> throw IllegalArgumentException("unsupported input type: $type")
        }
        val r = RootShell.run(ctx, script, 10_000)
        ScreenStreamer.kick()   // the screen is about to change: capture at full speed for a moment
        return r
    }
}

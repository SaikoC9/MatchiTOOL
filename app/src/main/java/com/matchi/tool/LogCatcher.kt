package com.matchi.tool

import android.content.Context
import android.util.Log
import android.os.Process as AndroidProcess
import java.io.BufferedWriter
import java.io.File
import java.io.FileWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.UUID
import android.os.Handler
import android.os.Looper

 data class CatchLog(
    val id: Long, val timestamp: String, val level: String,
    val function: String, val message: String, val session: String
) {
    fun line(): String = "$timestamp [$level] [$function] $message"
    /** app = this process, device = system-wide logcat (root), kernel = dmesg (root). */
    val source: String get() = when {
        function.startsWith("device/") -> "device"
        function == "kernel" -> "kernel"
        else -> "app"
    }
}

/**
 * Process-wide, non-blocking diagnostic collector. Disk writes are serialized on a
 * dedicated worker so shell/network/UI threads never wait for filesystem I/O.
 * A session is a distinct file and is closed in queue order when Stop is pressed.
 */
object LogCatcher {
    private const val TAG = "MatchiLogCatcher"
    private const val MAX_RECENT = 3000
    private const val MAX_PENDING_WRITES = 4096
    private const val MAX_SESSION_BYTES = 8L * 1024L * 1024L
    private const val MAX_SESSIONS = 30

    private val ids = AtomicLong()
    private val captureGen = AtomicInteger()
    private val pendingWrites = AtomicInteger()
    private val listeners = CopyOnWriteArrayList<(CatchLog) -> Unit>()
    private val writer = Executors.newSingleThreadExecutor { task ->
        Thread(task, "MatchiTOOL-LogWriter").apply { isDaemon = true; priority = Thread.MIN_PRIORITY }
    }
    private val lock = Any()
    @Volatile private var app: Context? = null
    @Volatile private var crashHandlerInstalled = false
    @Volatile private var active = false
    @Volatile private var sessionId: String? = null
    @Volatile private var sessionFile: File? = null
    private val recent = ArrayDeque<CatchLog>()
    private var droppedWrites = 0L
    @Volatile private var logcatProcess: Process? = null
    @Volatile private var logcatThread: Thread? = null

    @Synchronized fun initialize(context: Context) {
        app = context.applicationContext
        if (!crashHandlerInstalled) {
            val previous = Thread.getDefaultUncaughtExceptionHandler()
            Thread.setDefaultUncaughtExceptionHandler { thread, error ->
                log("ERROR", "UncaughtException", "${thread.name}: ${error.javaClass.simpleName}: ${error.message}")
                flush(1500L)   // the writer is a daemon thread: give it a moment before the process dies
                try { previous?.uncaughtException(thread, error) } catch (handlerError: Throwable) {
                    Log.e(TAG, "Previous crash handler failed", handlerError)
                }
            }
            crashHandlerInstalled = true
        }
        recoverInterruptedSession()
    }

    /**
     * A session is deliberately persisted as active until Stop has durably queued its footer.
     * If Android kills the process or the device reboots, the next service/activity initialization
     * reopens the same pair of files and records the interruption instead of losing the session.
     */
    private fun recoverInterruptedSession() {
        val context = app ?: return
        synchronized(lock) {
            if (active) return
            val prefs = context.getSharedPreferences("matchi_log_catcher", Context.MODE_PRIVATE)
            if (!prefs.getBoolean("session_active", false)) return
            val id = prefs.getString("session_id", null) ?: run {
                prefs.edit().putBoolean("session_active", false).apply()
                return
            }
            val dir = File(context.filesDir, "logs/sessions")
            val file = File(dir, "$id.log")
            val textFile = File(dir, "$id.txt")
            if (!file.isFile || !textFile.isFile) {
                prefs.edit().putBoolean("session_active", false).apply()
                return
            }
            sessionId = id
            sessionFile = file
            active = true
            val recovered = CatchLog(ids.incrementAndGet(), now(), "WARNING", "LogCatcher",
                "Recovered interrupted logging session after process restart", id)
            recent.add(recovered)
            enqueueWrite(critical = true) {
                val line = recovered.line() + "\n"
                try {
                    BufferedWriter(FileWriter(file, true)).use { it.append(line) }
                    BufferedWriter(FileWriter(textFile, true)).use { it.append(line) }
                } catch (e: Exception) { Log.e(TAG, "Unable to append session recovery marker", e) }
            }
        }
        startLogcatCapture()
        DeviceLogs.start(context)
    }

    /** Wait (bounded) until every write queued so far has reached disk. Never call with a long timeout on the UI thread. */
    fun flush(timeoutMs: Long) {
        val latch = java.util.concurrent.CountDownLatch(1)
        if (!enqueueWrite(critical = true) { latch.countDown() }) return
        try { latch.await(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS) } catch (_: InterruptedException) { }
    }

    fun isRunning(): Boolean = active
    fun currentSession(): String? = sessionId
    fun subscribe(listener: (CatchLog) -> Unit) { listeners.addIfAbsent(listener) }
    fun unsubscribe(listener: (CatchLog) -> Unit) { listeners.remove(listener) }

    fun start(context: Context) {
        initialize(context)
        val id: String
        val file: File
        synchronized(lock) {
            if (active) return
            val dir = File(app!!.filesDir, "logs/sessions")
            if (!dir.exists() && !dir.mkdirs()) {
                Log.e(TAG, "Cannot create log session directory: ${dir.absolutePath}")
                return
            }
            val stamp = SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())
            id = "session_${stamp}_${UUID.randomUUID().toString().take(8)}"
            file = File(dir, "$id.log")
            val textFile = File(dir, "$id.txt")
            // Initialize both durable formats before advertising an active session.
            try {
                val header = "# MatchiTOOL Log Catcher\n# Session: $id\n# Started: ${now()}\n"
                BufferedWriter(FileWriter(file, false)).use { it.append(header) }
                BufferedWriter(FileWriter(textFile, false)).use { it.append(header) }
                pruneSessions(dir, file)
            } catch (e: Exception) {
                Log.e(TAG, "Unable to initialize log session ${file.name}", e)
                try { file.delete() } catch (_: Exception) { }
                return
            }
            sessionId = id
            sessionFile = file
            active = true
            app!!.getSharedPreferences("matchi_log_catcher", Context.MODE_PRIVATE).edit()
                .putString("session_id", id).putBoolean("session_active", true).commit()
        }
        // Start capture only after the session file is ready.
        startLogcatCapture()
        DeviceLogs.start(app!!)
        log("INFO", "LogCatcher", "Logging session started")
    }

    fun stop() {
        val id: String
        val file: File
        synchronized(lock) {
            if (!active) return
            id = sessionId ?: return
            file = sessionFile ?: return
            active = false
            sessionId = null
            sessionFile = null
            // Clear the persisted flag now (in-process reads see it at once); the queued write below makes it durable.
            // Otherwise a quick Stop -> Start runs recovery against the stale flag and reopens the old session.
            app?.getSharedPreferences("matchi_log_catcher", Context.MODE_PRIVATE)?.edit()
                ?.putBoolean("session_active", false)?.apply()
        }
        stopLogcatCapture()
        DeviceLogs.stop()
        enqueueWrite(critical = true) {
            try {
                val ending = "${now()} [INFO] [LogCatcher] Logging session stopped ($id)\n# Stopped: ${now()}\n"
                listOf(file, File(file.parentFile, file.nameWithoutExtension + ".txt")).forEach { target ->
                    BufferedWriter(FileWriter(target, true)).use { it.append(ending) }
                }
            } catch (e: Exception) { Log.e(TAG, "Unable to finalize log session ${file.name}", e) }
            finally {
                app?.getSharedPreferences("matchi_log_catcher", Context.MODE_PRIVATE)?.edit()
                    ?.putBoolean("session_active", false)?.commit()
            }
        }
    }

    fun log(level: String, function: String, message: String) {
        val normalized = when (level.uppercase(Locale.US)) {
            "E", "ERROR", "ASSERT" -> "ERROR"
            "W", "WARN", "WARNING" -> "WARNING"
            "D", "DEBUG", "VERBOSE" -> "DEBUG"
            else -> "INFO"
        }
        val safeFunction = function.substringAfterLast('.').ifBlank { "MatchiTOOL" }.take(100)
        val safeMessage = message.replace('\u0000', ' ').replace('\r', ' ').replace('\n', ' ').take(4000)
        val entry: CatchLog
        val target: File?
        synchronized(lock) {
            entry = CatchLog(ids.incrementAndGet(), now(), normalized, safeFunction, safeMessage, sessionId ?: "untracked")
            recent.add(entry)
            while (recent.size > MAX_RECENT) recent.removeFirst()
            target = if (active) sessionFile else null
        }
        if (target != null) {
            enqueueWrite {
                try {
                    if (target.length() >= MAX_SESSION_BYTES) {
                        val rotated = File(target.parentFile, target.nameWithoutExtension + "_part" + now().replace(Regex("[^0-9]"), "") + ".log")
                        if (!target.renameTo(rotated)) Log.w(TAG, "Log rotation failed for ${target.name}; continuing current file")
                        else {
                            val textTarget = File(target.parentFile, target.nameWithoutExtension + ".txt")
                            val rotatedText = File(rotated.parentFile, rotated.nameWithoutExtension + ".txt")
                            if (textTarget.exists() && !textTarget.renameTo(rotatedText)) {
                                Log.w(TAG, "Text log rotation failed for ${textTarget.name}; continuing current text file")
                            }
                            val header = "# MatchiTOOL Log Catcher (continued)\n# Session: ${entry.session}\n"
                            target.writeText(header)
                            if (!textTarget.exists()) textTarget.writeText(header)
                            pruneSessions(target.parentFile ?: return@enqueueWrite, target)
                        }
                    }
                    val line = entry.line() + "\n"
                    BufferedWriter(FileWriter(target, true)).use { out -> out.append(line) }
                    val textTarget = File(target.parentFile, target.nameWithoutExtension + ".txt")
                    BufferedWriter(FileWriter(textTarget, true)).use { out -> out.append(line) }
                } catch (e: Exception) { Log.e(TAG, "Log write failed (${target.name})", e) }
            }
        }
        listeners.forEach { listener -> try { listener(entry) } catch (e: Exception) { Log.w(TAG, "Log listener failed", e) } }
    }

    fun snapshot(): List<CatchLog> = synchronized(lock) { recent.toList() }
    fun droppedWriteCount(): Long = synchronized(lock) { droppedWrites }

    fun sessions(context: Context): List<File> {
        val dir = File(context.applicationContext.filesDir, "logs/sessions")
        // .log is the canonical session index; its same-named .txt companion is saved automatically.
        return dir.listFiles()?.filter { it.isFile && it.extension == "log" }
            ?.sortedByDescending { it.lastModified() } ?: emptyList()
    }

    /**
     * Delete one finished session (.log plus its .txt companion). The active session is refused.
     * The delete runs on the log writer so it is ordered after any footer still queued for that file.
     */
    fun deleteSession(context: Context, name: String): Boolean {
        val file = sessions(context).firstOrNull { it.name == name } ?: return false
        synchronized(lock) { if (sessionFile?.name == file.name) return false }
        return enqueueWrite(critical = true) {
            val companion = File(file.parentFile, file.nameWithoutExtension + ".txt")
            if (!file.delete()) Log.w(TAG, "Could not delete ${file.name}")
            if (companion.exists() && !companion.delete()) Log.w(TAG, "Could not delete ${companion.name}")
        }
    }

    fun readSession(file: File): List<String> = try {
        if (!file.isFile || file.length() > MAX_SESSION_BYTES * 2) emptyList() else file.readLines().takeLast(MAX_RECENT)
    } catch (_: Exception) { emptyList() }

    /** Export on the log writer, never on the UI thread. Completion is delivered on main. */
    fun exportText(context: Context, onComplete: (File?) -> Unit): Boolean {
        val appContext = context.applicationContext
        val lines = snapshot().joinToString("\n") { it.line() }
        return enqueueWrite(critical = true) {
            val result = try {
                val dir = File(appContext.filesDir, "logs/exports").apply { if (!exists()) mkdirs() }
                if (!dir.isDirectory) throw java.io.IOException("Cannot create export directory")
                val file = File(dir, "matchitool_${SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())}_${UUID.randomUUID().toString().take(6)}.txt")
                file.writeText(lines)
                file
            } catch (e: Exception) {
                Log.e(TAG, "Log export failed", e)
                null
            }
            Handler(Looper.getMainLooper()).post { onComplete(result) }
        }
    }

    /**
     * Captures Android logcat entries emitted by the entire MatchiTOOL process while a
     * session is active. This complements explicit LogCatcher.log() events, so existing
     * Android Log calls from any class/function are collected without editing each callsite.
     * Functions that emit no diagnostic/log event cannot be inferred automatically.
     */
    private fun startLogcatCapture() {
        stopLogcatCapture()
        val gen = captureGen.get()
        val thread = Thread({
            var process: Process? = null
            val gate = NoiseGate { l, t, m -> log(l, t, m) }
            try {
                process = ProcessBuilder("logcat", "--pid=${AndroidProcess.myPid()}", "-v", "threadtime", "-T", "1")
                    .redirectErrorStream(true).start()
                logcatProcess = process
                // If stopped/restarted while starting, skip reading; finally destroys the process.
                if (captureGen.get() == gen) process.inputStream.bufferedReader().useLines { lines ->
                    lines.forEach { line ->
                        if (!active || captureGen.get() != gen) return@forEach
                        val match = LOGCAT_LINE.matchEntire(line.trim()) ?: return@forEach
                        val priority = match.groupValues[1]
                        val tag = match.groupValues[2].substringBefore(':').trim().ifBlank { "Android" }
                        val message = match.groupValues[3]
                        if (tag == TAG || tag == "System.out" || message.isBlank()) return@forEach
                        val level = when (priority) { "E", "A" -> "ERROR"; "W" -> "WARNING"; "D", "V" -> "DEBUG"; else -> "INFO" }
                        if (gate.allow(level, tag, message)) log(level, tag, message)
                    }
                }
            } catch (e: Exception) {
                if (active) Log.w(TAG, "Process logcat capture unavailable: ${e.message}")
            } finally {
                try { process?.destroy() } catch (_: Exception) { }
                if (process != null && logcatProcess === process) logcatProcess = null
            }
        }, "MatchiTOOL-LogcatCapture").apply { isDaemon = true; priority = Thread.MIN_PRIORITY }
        logcatThread = thread
        thread.start()
    }

    private fun stopLogcatCapture() {
        captureGen.incrementAndGet()
        try { logcatProcess?.destroy() } catch (_: Exception) { }
        logcatProcess = null
        logcatThread?.interrupt()
        logcatThread = null
    }

    private val LOGCAT_LINE = Regex("\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3} +\\d+ +\\d+ ([VDIWEAF]) +(.+?) *:(?: |$)(.*)")

    private fun enqueueWrite(critical: Boolean = false, task: () -> Unit): Boolean {
        val count = pendingWrites.incrementAndGet()
        if (!critical && count > MAX_PENDING_WRITES) {
            pendingWrites.decrementAndGet()
            synchronized(lock) { droppedWrites++ }
            return false
        }
        return try {
            writer.execute {
                try { task() }
                finally { pendingWrites.decrementAndGet() }
            }
            true
        } catch (e: Exception) {
            pendingWrites.decrementAndGet()
            synchronized(lock) { droppedWrites++ }
            Log.e(TAG, "Log writer unavailable", e)
            false
        }
    }

    private fun pruneSessions(dir: File, current: File) {
        val files = dir.listFiles()?.filter { it.isFile && it.extension == "log" }
            ?.sortedByDescending { it.lastModified() } ?: return
        files.drop(MAX_SESSIONS).forEach { old ->
            if (!old.delete()) Log.w(TAG, "Could not prune ${old.name}")
            val companion = File(dir, old.nameWithoutExtension + ".txt")
            if (companion.exists() && !companion.delete()) Log.w(TAG, "Could not prune ${companion.name}")
        }
    }

    private fun now(): String = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(Date())
}

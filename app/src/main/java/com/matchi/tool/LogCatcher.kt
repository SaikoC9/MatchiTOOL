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

 data class CatchLog(
    val id: Long, val timestamp: String, val level: String,
    val function: String, val message: String, val session: String
) {
    fun line(): String = "$timestamp [$level] [$function] $message"
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
                try { previous?.uncaughtException(thread, error) } catch (handlerError: Throwable) {
                    Log.e(TAG, "Previous crash handler failed", handlerError)
                }
            }
            crashHandlerInstalled = true
        }
    }

    fun isRunning(): Boolean = active
    fun currentSession(): String? = sessionId
    fun subscribe(listener: (CatchLog) -> Unit) { listeners.addIfAbsent(listener) }
    fun unsubscribe(listener: (CatchLog) -> Unit) { listeners.remove(listener) }

    fun start(context: Context) {
        initialize(context)
        synchronized(lock) {
            if (active) return
            val dir = File(app!!.filesDir, "logs/sessions")
            if (!dir.exists() && !dir.mkdirs()) {
                Log.e(TAG, "Cannot create log session directory: ${dir.absolutePath}")
                return
            }
            val stamp = SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())
            val id = "session_$stamp"
            val file = File(dir, "$id.log")
            sessionId = id
            sessionFile = file
            active = true
            val accepted = enqueueWrite {
                try {
                    BufferedWriter(FileWriter(file, false)).use { out ->
                        out.append("# MatchiTOOL Log Catcher\n# Session: $id\n# Started: ${now()}\n")
                    }
                    pruneSessions(dir, file)
                } catch (e: Exception) {
                    Log.e(TAG, "Unable to initialize log session ${file.name}", e)
                    synchronized(lock) {
                        if (sessionId == id) { active = false; sessionId = null; sessionFile = null }
                    }
                }
            }
            if (!accepted) {
                active = false
                sessionId = null
                sessionFile = null
                Log.e(TAG, "Unable to start log session: writer queue is full")
                return
            }
        }
        log("INFO", "LogCatcher", "Logging session started")
        startLogcatCapture()
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
        }
        stopLogcatCapture()
        enqueueWrite {
            try { BufferedWriter(FileWriter(file, true)).use { out ->
                out.append("${now()} [INFO] [LogCatcher] Logging session stopped ($id)\n")
                out.append("# Stopped: ${now()}\n")
            } } catch (e: Exception) { Log.e(TAG, "Unable to finalize log session ${file.name}", e) }
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
                        val rotated = File(target.parentFile, target.nameWithoutExtension + "_part" + now().replace(":", "").replace(".", "") + ".log")
                        if (!target.renameTo(rotated)) Log.w(TAG, "Log rotation failed for ${target.name}; continuing current file")
                        else {
                            target.writeText("# MatchiTOOL Log Catcher (continued)\n# Session: ${entry.session}\n")
                            pruneSessions(target.parentFile ?: return@enqueueWrite, target)
                        }
                    }
                    BufferedWriter(FileWriter(target, true)).use { out -> out.append(entry.line()).append('\n') }
                } catch (e: Exception) { Log.e(TAG, "Log write failed (${target.name})", e) }
            }
        }
        listeners.forEach { listener -> try { listener(entry) } catch (e: Exception) { Log.w(TAG, "Log listener failed", e) } }
    }

    fun snapshot(): List<CatchLog> = synchronized(lock) { recent.toList() }
    fun droppedWriteCount(): Long = synchronized(lock) { droppedWrites }

    fun sessions(context: Context): List<File> {
        val dir = File(context.applicationContext.filesDir, "logs/sessions")
        return dir.listFiles()?.filter { it.isFile && (it.extension == "log" || it.extension == "txt") }
            ?.sortedByDescending { it.lastModified() } ?: emptyList()
    }

    fun readSession(file: File): List<String> = try {
        if (!file.isFile || file.length() > MAX_SESSION_BYTES * 2) emptyList() else file.readLines().takeLast(MAX_RECENT)
    } catch (_: Exception) { emptyList() }

    fun exportText(context: Context): File {
        val dir = File(context.applicationContext.filesDir, "logs/exports").apply { mkdirs() }
        val file = File(dir, "matchitool_${SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())}.txt")
        file.writeText(snapshot().joinToString("\n") { it.line() })
        return file
    }

    /** Captures Android logcat entries emitted by this process while a session is active. */
    private fun startLogcatCapture() {
        stopLogcatCapture()
        val thread = Thread({
            var process: Process? = null
            try {
                process = ProcessBuilder("logcat", "--pid=${AndroidProcess.myPid()}", "-v", "threadtime")
                    .redirectErrorStream(true).start()
                logcatProcess = process
                process.inputStream.bufferedReader().useLines { lines ->
                    lines.forEach { line ->
                        if (!active) return@forEach
                        val match = LOGCAT_LINE.matchEntire(line.trim()) ?: return@forEach
                        val priority = match.groupValues[1]
                        val tag = match.groupValues[2].ifBlank { "Android" }
                        val message = match.groupValues[3]
                        if (tag == TAG || tag == "System.out" || message.isBlank()) return@forEach
                        val level = when (priority) { "E", "A" -> "ERROR"; "W" -> "WARNING"; "D", "V" -> "DEBUG"; else -> "INFO" }
                        log(level, tag, message)
                    }
                }
            } catch (e: Exception) {
                if (active) Log.w(TAG, "Process logcat capture unavailable: ${e.message}")
            } finally {
                try { process?.destroy() } catch (_: Exception) { }
                if (logcatProcess === process) logcatProcess = null
            }
        }, "MatchiTOOL-LogcatCapture").apply { isDaemon = true; priority = Thread.MIN_PRIORITY }
        logcatThread = thread
        thread.start()
    }

    private fun stopLogcatCapture() {
        try { logcatProcess?.destroy() } catch (_: Exception) { }
        logcatProcess = null
        logcatThread?.interrupt()
        logcatThread = null
    }

    private val LOGCAT_LINE = Regex("\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3} +\\d+ +\\d+ ([VDIWEAF]) +([^:]+): ?(.*)")

    private fun enqueueWrite(task: () -> Unit): Boolean {
        val count = pendingWrites.incrementAndGet()
        if (count > MAX_PENDING_WRITES) {
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
        val files = dir.listFiles()?.filter { it.isFile && it != current && it.extension == "log" }
            ?.sortedByDescending { it.lastModified() } ?: return
        files.drop(MAX_SESSIONS - 1).forEach { old -> if (!old.delete()) Log.w(TAG, "Could not prune ${old.name}") }
    }

    private fun now(): String = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(Date())
}

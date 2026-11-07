package com.matchi.tool

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class HostService : Service() {
    @Volatile private var server: WebServer? = null
    private val initialized = AtomicBoolean(false)
    private val bootTasksRunning = AtomicBoolean(false)
    private val workers: ScheduledExecutorService by lazy { Executors.newScheduledThreadPool(2) }

    override fun onStartCommand(i: Intent?, f: Int, id: Int): Int {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel("matchi", "MatchiTOOL", NotificationManager.IMPORTANCE_MIN))
        val n = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "matchi") else Notification.Builder(this))
            .setContentTitle("MatchiTOOL running").setContentText("LAN · port ${Prefs.PORT}")
            .setSmallIcon(R.drawable.ic_stat_matchi).build()
        startForeground(1, n)

        if (initialized.compareAndSet(false, true)) {
            workers.execute { startWebHost() }
            workers.schedule({
                try { ZteClient.autoDetect(applicationContext) }
                catch (e: Exception) { Log.w("MatchiTOOL", "Router auto-detect failed: ${e.message}") }
            }, 4, TimeUnit.SECONDS)
            // Recheck the firewall after boot/network bring-up without spawning duplicate thread sets.
            for (delay in longArrayOf(3, 30, 90)) {
                workers.schedule({
                    try { HostControl.openLanFirewall(applicationContext) }
                    catch (e: Exception) { Log.w("MatchiTOOL", "LAN firewall check failed: ${e.message}") }
                }, delay, TimeUnit.SECONDS)
            }
        }
        if (i?.action == ACTION_RUN_BOOT_TASKS) runBootTasks()
        return START_STICKY
    }

    private fun startWebHost() {
        if (server != null) return
        val srv = WebServer(this, Prefs.PORT, "0.0.0.0")
        server = srv
        for (attempt in 1..8) {
            try { srv.start(); Log.i("MatchiTOOL", "Web host listening on port ${Prefs.PORT}"); return }
            catch (e: java.io.IOException) {
                Log.w("MatchiTOOL", "Web host start failed (attempt $attempt): ${e.message}")
                try { Thread.sleep(700) } catch (_: InterruptedException) { Thread.currentThread().interrupt(); break }
            }
        }
        try { srv.stop() } catch (_: Exception) {}
        if (server === srv) server = null
        Log.e("MatchiTOOL", "Web host did not start after retries")
        if (!workers.isShutdown) workers.schedule({ if (server == null) startWebHost() }, 15, TimeUnit.SECONDS)
    }

    private fun runBootTasks() {
        if (!bootTasksRunning.compareAndSet(false, true)) return
        workers.execute {
            try {
                val result = RootShell.run(this,
                    "if [ -f /data/local/matchitool/boot.sh ]; then /system/bin/sh /data/local/matchitool/boot.sh; else echo 'No MatchiTOOL boot tasks registered'; fi",
                    60_000)
                Log.i("MatchiTOOL", "Boot tasks: ${if (result.success) "completed" else "not completed"}: ${result.content.take(1200)}")
            } catch (e: Exception) { Log.e("MatchiTOOL", "Boot tasks failed: ${e.message}") }
            finally { bootTasksRunning.set(false) }
        }
    }

    override fun onDestroy() {
        try { workers.shutdownNow() } catch (_: Exception) {}
        try { server?.stop() } catch (_: Exception) {}
        server = null
        RootShell.closeAll()
        initialized.set(false)
        super.onDestroy()
    }

    override fun onBind(i: Intent?): IBinder? = null

    companion object { const val ACTION_RUN_BOOT_TASKS = "com.matchi.tool.RUN_BOOT_TASKS" }
}

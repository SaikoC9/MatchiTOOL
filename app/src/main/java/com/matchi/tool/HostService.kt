package com.matchi.tool

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

class HostService : Service() {
    private var server: WebServer? = null

    override fun onStartCommand(i: Intent?, f: Int, id: Int): Int {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel("matchi", "MatchiTOOL", NotificationManager.IMPORTANCE_MIN))
        val n = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "matchi") else Notification.Builder(this))
            .setContentTitle("MatchiTOOL running").setContentText(if (Prefs.lanAccess(this)) "LAN enabled · port ${Prefs.PORT}" else "Local-only · port ${Prefs.PORT}")
            .setSmallIcon(R.drawable.ic_stat_matchi).build()
        startForeground(1, n)
        if (server == null) server = WebServer(this, Prefs.PORT, if (Prefs.lanAccess(this)) "0.0.0.0" else "127.0.0.1").also { it.start() }
        if (i?.action == ACTION_RUN_BOOT_TASKS) runBootTasks()
        return START_STICKY
    }
    private fun runBootTasks() {
        Thread {
            val result = RootShell.run(
                this,
                "if [ -f /data/local/matchitool/boot.sh ]; then /system/bin/sh /data/local/matchitool/boot.sh; else echo 'No MatchiTOOL boot tasks registered'; fi",
                60_000
            )
            android.util.Log.i("MatchiTOOL", "Boot tasks: ${if (result.success) "completed" else "not completed"}: ${result.content.take(1200)}")
        }.start()
    }

    override fun onDestroy() { server?.stop(); server = null }
    override fun onBind(i: Intent?): IBinder? = null

    companion object { const val ACTION_RUN_BOOT_TASKS = "com.matchi.tool.RUN_BOOT_TASKS" }
}

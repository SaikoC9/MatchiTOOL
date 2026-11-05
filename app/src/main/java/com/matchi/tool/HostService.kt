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
            .setContentTitle("MatchiTOOL running").setContentText("Port ${Prefs.PORT}")
            .setSmallIcon(android.R.drawable.ic_menu_manage).build()
        startForeground(1, n)
        if (server == null) server = WebServer(this, Prefs.PORT).also { it.start() }
        return START_STICKY
    }
    override fun onDestroy() { server?.stop(); server = null }
    override fun onBind(i: Intent?): IBinder? = null
}

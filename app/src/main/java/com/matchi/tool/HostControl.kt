package com.matchi.tool

import android.content.Context
import android.content.Intent
import android.os.Build
import java.net.InetSocketAddress
import java.net.Socket

/** Host-level actions shared by the native screens (LAN switch, addresses, host health). */
object HostControl {
    /** Address of the web console as shown to the user (host:port). */
    fun webAddress(ctx: Context): String {
        if (!Prefs.lanAccess(ctx)) return "127.0.0.1:${Prefs.PORT}"
        return try {
            @Suppress("DEPRECATION")
            val ip = (ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager)
                .connectionInfo.ipAddress
            val host = if (ip == 0) "" else listOf(
                ip and 0xff, ip shr 8 and 0xff, ip shr 16 and 0xff, ip shr 24 and 0xff
            ).joinToString(".")
            if (host.isBlank()) "${Prefs.zteHost(ctx)}:${Prefs.PORT}" else "$host:${Prefs.PORT}"
        } catch (_: Exception) {
            "${Prefs.zteHost(ctx)}:${Prefs.PORT}"
        }
    }

    /** Turns LAN access on/off and restarts the host so it rebinds. [done] runs on the main thread. */
    fun applyLan(ctx: android.app.Activity, enabled: Boolean, done: () -> Unit) {
        Prefs.setLanAccess(ctx, enabled)
        Thread {
            val svc = Intent(ctx, HostService::class.java)
            ctx.stopService(svc)          // stops the old server so it can rebind with the new address
            Thread.sleep(600)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(svc) else ctx.startService(svc)
            ctx.runOnUiThread { done() }
        }.start()
    }

    /** True when the web host is accepting connections on its port. */
    fun isHostUp(): Boolean = try {
        Socket().use { it.connect(InetSocketAddress("127.0.0.1", Prefs.PORT), 500) }
        true
    } catch (_: Exception) { false }
}

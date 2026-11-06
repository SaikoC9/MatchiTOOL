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

    /**
     * Let devices on the ZTE's own network (hotspot Wi-Fi bridge / USB tethering) reach the web console even if the
     * firmware's INPUT firewall drops unknown ports. Only those LAN-side interfaces are opened (never mobile data),
     * the rule is added once (checked with -C), and the server still refuses non-private source addresses.
     * Best effort: silently does nothing without root or iptables.
     */
    fun openLanFirewall(ctx: Context) {
        val p = Prefs.PORT
        val script = "for t in iptables ip6tables; do command -v \$t >/dev/null 2>&1 || continue; " +
            "for i in br0 usb0 rndis0 ecm0; do " +
            "\$t -C INPUT -i \$i -p tcp --dport $p -j ACCEPT 2>/dev/null || \$t -I INPUT 1 -i \$i -p tcp --dport $p -j ACCEPT 2>/dev/null; " +
            "done; done; echo done"
        RootShell.run(ctx, script, 15_000)
    }

    /** True when the web host is accepting connections on its port. */
    fun isHostUp(): Boolean = try {
        Socket().use { it.connect(InetSocketAddress("127.0.0.1", Prefs.PORT), 500) }
        true
    } catch (_: Exception) { false }
}

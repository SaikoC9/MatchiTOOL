package com.matchi.tool

import android.content.Context
import android.content.Intent
import android.os.Build
import java.net.InetSocketAddress
import java.net.Socket

/** Host-level actions shared by the native screens (addresses, LAN firewall, host health). */
object HostControl {

    private val hotspotIf = Regex("^(br|ap|swlan|usb|rndis|ecm)[0-9a-z_]*$")
    private class Net(val addr: Int, val mask: Int)
    @Volatile private var cachedNets: List<Net> = emptyList()
    @Volatile private var cachedAt = 0L

    private fun v4(s: String): Int? {
        val o = s.split(".").mapNotNull { it.toIntOrNull() }
        if (o.size != 4 || o.any { it !in 0..255 }) return null
        return (o[0] shl 24) or (o[1] shl 16) or (o[2] shl 8) or o[3]
    }

    /**
     * Subnets of the ZTE's own hotspot / USB-tether side (br*, ap*, swlan*, usb*, rndis*, ecm*) - NOT wlan* client Wi-Fi and not
     * mobile data. If no such interface is found, the /24 of the configured router address is used instead.
     * Refreshed every 5 s because the hotspot can come and go.
     */
    private fun hotspotNets(ctx: Context): List<Net> {
        val now = System.currentTimeMillis()
        if (now - cachedAt < 5_000) return cachedNets
        val out = ArrayList<Net>()
        try {
            for (nif in java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces() ?: return cachedNets)) {
                if (!nif.isUp || nif.isLoopback || !hotspotIf.matches(nif.name.lowercase())) continue
                for (ia in nif.interfaceAddresses) {
                    val a = ia.address as? java.net.Inet4Address ?: continue
                    val prefix = ia.networkPrefixLength.toInt()
                    if (!a.isSiteLocalAddress || prefix < 16 || prefix > 30) continue
                    val mask = (-1) shl (32 - prefix)
                    out.add(Net(v4(a.hostAddress ?: continue) ?: continue, mask))
                }
            }
        } catch (_: Exception) {}
        if (out.isEmpty()) v4(Prefs.zteHost(ctx).substringBefore(':'))?.let { out.add(Net(it, (-1) shl 8)) }
        cachedNets = out; cachedAt = now
        return out
    }

    /** True for this device itself, or a client inside the ZTE hotspot network. Anything else (other Wi-Fi, mobile data, internet) is refused. */
    fun isHotspotClient(ctx: Context, raw: String): Boolean {
        var ip = raw.substringBefore('%').lowercase()
        if (ip.startsWith("::ffff:")) ip = ip.removePrefix("::ffff:")
        if (ip == "::1" || ip == "0:0:0:0:0:0:0:1" || ip == "localhost") return true
        val v = v4(ip) ?: return false
        if ((v ushr 24) == 127) return true
        return hotspotNets(ctx).any { (v and it.mask) == (it.addr and it.mask) }
    }

    /** Always works on the device that runs MatchiTOOL itself, with or without any network. */
    fun localAddress(): String = "127.0.0.1:${Prefs.PORT}"

    /**
     * Address other devices on the ZTE network (e.g. your phone) should use: the private IPv4 of this device's hotspot
     * interface, read from the network interfaces.
     * Falls back to the router address if no private address is found.
     */
    fun webAddress(ctx: Context): String {
        val ip = try {
            val found = ArrayList<Pair<Int, String>>()
            for (nif in java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces() ?: return "${Prefs.zteHost(ctx)}:${Prefs.PORT}")) {
                if (!nif.isUp || nif.isLoopback) continue
                val n = nif.name.lowercase()
                // Hotspot / bridge / USB-tether interfaces only; never another Wi-Fi or mobile data.
                val rank = when {
                    n.startsWith("br") || n.startsWith("ap") || n.startsWith("swlan") -> 0
                    n.startsWith("usb") || n.startsWith("rndis") || n.startsWith("ecm") || n.startsWith("eth") -> 2
                    else -> continue
                }
                for (a in java.util.Collections.list(nif.inetAddresses)) {
                    if (a is java.net.Inet4Address && a.isSiteLocalAddress) found.add(rank to (a.hostAddress ?: continue))
                }
            }
            found.minByOrNull { it.first }?.second
        } catch (_: Exception) { null }
        return "${ip ?: Prefs.zteHost(ctx)}:${Prefs.PORT}"
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

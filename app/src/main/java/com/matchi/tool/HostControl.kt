package com.matchi.tool

import android.content.Context
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Host-level actions shared by the native screens (addresses, LAN firewall, host health). */
object HostControl {

    private val hotspotIf = Regex("^(br|ap|swlan|usb|rndis|ecm)[0-9a-z_-]*$")   // one list for the client check AND the shown address
    private class Net(val addr: Int, val mask: Int)
    @Volatile private var cachedNets: List<Net> = emptyList()
    @Volatile private var cachedV6Nets: List<Pair<ByteArray, Int>> = emptyList()
    @Volatile private var cachedAt = 0L

    private fun v4(s: String): Int? {
        val o = s.split(".").mapNotNull { it.toIntOrNull() }
        if (o.size != 4 || o.any { it !in 0..255 }) return null
        return (o[0] shl 24) or (o[1] shl 16) or (o[2] shl 8) or o[3]
    }

    /**
     * Subnets of the ZTE's own hotspot / USB-tether side (br*, ap*, swlan*, usb*, rndis*, ecm*) - NOT wlan* client Wi-Fi and not
     * mobile data. If no such interface is found, NO network is trusted (only loopback passes): guessing the router's /24 let
     * every host on a home LAN that happens to use the same range reach the login.
     * Refreshed every 5 s because the hotspot can come and go.
     */
    private fun hotspotNets(ctx: Context): List<Net> {
        val now = System.currentTimeMillis()
        if (now - cachedAt < 5_000) return cachedNets
        val out = ArrayList<Net>()
        val out6 = ArrayList<Pair<ByteArray, Int>>()
        try {
            for (nif in java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces() ?: return cachedNets)) {
                if (!nif.isUp || nif.isLoopback || !hotspotIf.matches(nif.name.lowercase())) continue
                for (ia in nif.interfaceAddresses) {
                    val prefix = ia.networkPrefixLength.toInt()
                    val a = ia.address
                    if (a is java.net.Inet4Address) {
                        if (!a.isSiteLocalAddress || prefix < 8 || prefix > 30) continue
                        val mask = (-1) shl (32 - prefix)
                        out.add(Net(v4(a.hostAddress ?: continue) ?: continue, mask))
                    } else if (a is java.net.Inet6Address && !a.isLinkLocalAddress && !a.isMulticastAddress && prefix in 1..128) {
                        out6.add(a.address to prefix)
                    }
                }
            }
        } catch (e: Exception) { Quiet.note("HostControl.hotspotNets", e) }
        cachedNets = out
        cachedV6Nets = out6
        cachedAt = now
        return out
    }

    /** True for this device itself, or a client inside the ZTE hotspot network. Anything else (other Wi-Fi, mobile data, internet) is refused. */
    fun isHotspotClient(ctx: Context, raw: String): Boolean {
        var ip = raw.substringBefore('%').lowercase()
        if (ip.startsWith("::ffff:")) ip = ip.removePrefix("::ffff:")
        if (ip == "::1" || ip == "0:0:0:0:0:0:0:1" || ip == "localhost") return true
        if (ip.contains(':')) {
            hotspotNets(ctx) // refresh both address-family caches
            val address = try { java.net.InetAddress.getByName(ip) as? java.net.Inet6Address } catch (_: Exception) { null } ?: return false
            val bytes = address.address
            return cachedV6Nets.any { (network, prefix) ->
                val full = prefix / 8
                val rem = prefix % 8
                var matches = true
                for (i in 0 until full) if (bytes[i] != network[i]) { matches = false; break }
                if (matches && rem > 0) {
                    val mask = (0xff shl (8 - rem)) and 0xff
                    matches = (bytes[full].toInt() and mask) == (network[full].toInt() and mask)
                }
                matches
            }
        }
        val v = v4(ip) ?: return false
        if ((v ushr 24) == 127) return true
        return hotspotNets(ctx).any { (v and it.mask) == (it.addr and it.mask) }
    }

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
                // Same interfaces isHotspotClient() accepts (so the shown address always works); never another Wi-Fi or mobile data.
                if (!hotspotIf.matches(n)) continue
                val rank = if (n.startsWith("br") || n.startsWith("ap") || n.startsWith("swlan")) 0 else 2
                for (a in java.util.Collections.list(nif.inetAddresses)) {
                    if (a is java.net.Inet4Address && a.isSiteLocalAddress) found.add(rank to (a.hostAddress ?: continue))
                }
            }
            found.minByOrNull { it.first }?.second
        } catch (_: Exception) { null }
        return "${ip ?: Prefs.zteHost(ctx)}:${Prefs.PORT}"
    }

    /** Names of the hotspot / tether interfaces that are up right now (sorted, comma separated; "" when none). Needs no root. */
    fun lanInterfaceNames(): String {
        return try {
            val all = java.net.NetworkInterface.getNetworkInterfaces() ?: return ""
            java.util.Collections.list(all)
                .filter { it.isUp && !it.isLoopback && hotspotIf.matches(it.name.lowercase()) }
                .map { it.name.lowercase() }.sorted().joinToString(",")
        } catch (_: Exception) { "" }
    }

    /**
     * Let devices on the ZTE's own network (hotspot Wi-Fi bridge / USB tethering) reach the web console even if the
     * firmware's INPUT firewall drops unknown ports. Only those LAN-side interfaces are opened (never mobile data),
     * the rule is added once (checked with -C), and the server still refuses non-private source addresses.
     * Best effort: silently does nothing without root or iptables.
     */
    fun openLanFirewall(ctx: Context) {
        RootShell.run(ctx, lanFirewallScript(Prefs.PORT), 15_000)
    }

    private val burstPool by lazy { Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "fw-burst").apply { isDaemon = true } } }
    private val burstGen = AtomicInteger(0)

    /**
     * A router restart (LAN IP, pool / lease, MTU / MSS) rebuilds the firewall and drops the rule for the console port, while the
     * interface names stay the same, so the interface watcher sees nothing new. This opens the firewall again at 5, 15, 30, 60 and
     * 120 s. A newer call replaces an older one (the older timers do nothing), and the script checks with -C first, so a repeat is harmless.
     */
    fun reopenFirewallSoon(ctx: Context, reason: String) {
        val app = ctx.applicationContext
        val gen = burstGen.incrementAndGet()
        LogCatcher.log("INFO", "HostControl", "LAN firewall will be opened again after: $reason")
        for (d in longArrayOf(5, 15, 30, 60, 120)) burstPool.schedule({
            if (burstGen.get() == gen) try { openLanFirewall(app) } catch (e: Exception) { LogCatcher.log("WARNING", "HostControl", "LAN firewall re-open failed: ${e.message}") }
        }, d, TimeUnit.SECONDS)
    }

    /**
     * Root script for [openLanFirewall]. It is a raw string with one level of escaping only (the sed group `\(...\)` and the
     * tr `\n` reach the shell exactly as written; doubling them made sed match nothing, so the upstream interfaces were never
     * skipped). `§` stands for the shell's dollar sign so Kotlin does not treat shell variables as templates.
     */
    internal fun lanFirewallScript(port: Int): String = """
        UP=" §( { ip route show default 2>/dev/null; ip route show table all 2>/dev/null | grep '^default'; ip route get 8.8.8.8 2>/dev/null; } | sed -n 's/.* dev \([^ ]*\).*/\1/p' | sort -u | tr '\n' ' ')"
        for t in iptables ip6tables; do
          command -v §t >/dev/null 2>&1 || continue
          for path in /sys/class/net/*; do
            [ -e "§path" ] || continue
            i=§{path##*/}
            case "§i" in
              br*|ap*|swlan*|usb*|rndis*|ecm*)
                case "§UP" in *" §i "*) continue;; esac
                §t -C INPUT -i "§i" -p tcp --dport $port -j ACCEPT 2>/dev/null || §t -I INPUT 1 -i "§i" -p tcp --dport $port -j ACCEPT 2>/dev/null
                ;;
            esac
          done
        done
        echo done
    """.trimIndent().replace('§', '$')

    /** Takes the rule added by [openLanFirewall] away again (called when the host service stops). Best effort, bounded. */
    fun closeLanFirewall(ctx: Context) {
        RootShell.run(ctx, lanFirewallCloseScript(Prefs.PORT), 4_000)
    }

    /** Root script for [closeLanFirewall]: deletes the ACCEPT rule on every hotspot-side interface (a few passes, in case it was added twice). */
    internal fun lanFirewallCloseScript(port: Int): String = """
        for t in iptables ip6tables; do
          command -v §t >/dev/null 2>&1 || continue
          for path in /sys/class/net/*; do
            [ -e "§path" ] || continue
            i=§{path##*/}
            case "§i" in
              br*|ap*|swlan*|usb*|rndis*|ecm*)
                n=0
                while [ §n -lt 5 ] && §t -D INPUT -i "§i" -p tcp --dport $port -j ACCEPT 2>/dev/null; do n=§((n+1)); done
                ;;
            esac
          done
        done
        echo done
    """.trimIndent().replace('§', '$')

    /** True when the web host is accepting connections on its port. */
    fun isHostUp(): Boolean = try {
        Socket().use { it.connect(InetSocketAddress("127.0.0.1", Prefs.PORT), 500) }
        true
    } catch (_: Exception) { false }
}

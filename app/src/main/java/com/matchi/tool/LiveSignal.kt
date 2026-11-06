package com.matchi.tool

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import java.io.File

/** One snapshot for the home screen's Live signal card. Null numbers mean "not available". */
data class SignalInfo(
    val rootOk: Boolean,
    val bars: Int,
    val primary: Int?,          // dBm shown big
    val primaryLabel: String,   // "5G RSRP", "LTE RSRP" or "RSSI"
    val quality: String,        // Excellent / Good / Fair / Poor / ""
    val network: String,        // "5G NSA", "4G LTE", ...
    val operator: String,
    val registration: String,
    val rsrq: Int?,
    val sinr: Int?,
    val battery: Int?,
    val note: String            // short explanation when data is missing
)

/**
 * Reads the same sources the web "Live Status" tool uses, in ONE root call: modem AT commands
 * (sendat) and Android telephony. The router web API is not needed. Battery comes from Android directly.
 */
object LiveSignal {
    private val ACT = mapOf(
        "0" to "2G", "1" to "2G", "2" to "3G", "3" to "2G EDGE", "4" to "3G HSDPA", "5" to "3G HSUPA",
        "6" to "3G HSPA", "7" to "4G LTE", "10" to "4G (5GC)", "11" to "5G SA", "12" to "5G (NG-RAN)", "13" to "5G NSA"
    )
    private val PLMN = mapOf("51502" to "Globe", "51503" to "Smart", "51566" to "DITO")
    private val REG = mapOf(
        "0" to "Not registered", "1" to "Registered (home)", "2" to "Searching",
        "3" to "Denied", "4" to "Unknown", "5" to "Registered (roaming)"
    )

    fun batteryPercent(ctx: Context): Int? {
        val i: Intent = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return null
        val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        return if (level < 0 || scale <= 0) null else level * 100 / scale
    }

    private fun num(re: String, text: String, lo: Int, hi: Int): Int? {
        val v = Regex(re).find(text)?.groupValues?.getOrNull(1)?.toIntOrNull() ?: return null
        return if (v in lo..hi) v else null
    }

    private fun section(text: String, name: String): String {
        val start = text.indexOf("##$name")
        if (start < 0) return ""
        val from = text.indexOf('\n', start).let { if (it < 0) text.length else it + 1 }
        val next = text.indexOf("##", from)
        return text.substring(from, if (next < 0) text.length else next)
    }

    fun read(ctx: Context): SignalInfo {
        val battery = batteryPercent(ctx)
        val sendat = File(ctx.filesDir, "sendat").absolutePath
        val script = listOf(
            "echo '##ID'; id -u",
            "echo '##COPS'; \"$sendat\" -n 0 -c 'AT+COPS?' 2>/dev/null",
            "echo '##CESQ'; \"$sendat\" -n 0 -c 'AT+CESQ' 2>/dev/null",
            "echo '##CEREG'; \"$sendat\" -n 0 -c 'AT+CEREG?' 2>/dev/null",
            "echo '##TELE'; dumpsys telephony.registry 2>/dev/null | grep -E 'mSignalStrength|mServiceState|mCellIdentity|mCellInfo' | head -30",
            "echo '##END'"
        ).joinToString("\n")

        val r = RootShell.run(ctx, script, 14_000)
        val out = r.content
        val rootOk = section(out, "ID").trim().lines().firstOrNull()?.trim() == "0"
        if (!rootOk) {
            return SignalInfo(false, 0, null, "", "", "", "", "", null, null, battery,
                "Root access is needed to read the modem")
        }

        val cops = section(out, "COPS")
        val cesq = section(out, "CESQ")
        val cereg = section(out, "CEREG")
        val tele = section(out, "TELE")

        val copsM = Regex("""\+COPS:\s*\d+,\d+,"([^"]*)",(\d+)""").find(cops)
        val plmn = copsM?.groupValues?.get(1)
        val act = copsM?.groupValues?.get(2)?.let { ACT[it] }
        val regStat = Regex("""\+CEREG:\s*\d+,(\d)""").find(cereg)?.groupValues?.get(1)

        val cesqM = Regex("""\+CESQ:\s*(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)""").find(cesq)
        val cesqRsrq = cesqM?.groupValues?.get(5)?.toIntOrNull()?.takeIf { it <= 34 }?.let { Math.round(-19.5 + 0.5 * it).toInt() }
        val cesqRsrp = cesqM?.groupValues?.get(6)?.toIntOrNull()?.takeIf { it <= 97 }?.let { -140 + it }

        // Android telephony (out-of-range values such as 2147483647 mean "unavailable")
        val lteRsrp = num("""CellSignalStrengthLte[^\n]*?\brsrp\s*=\s*(-?\d+)""", tele, -140, -40)
        val lteRsrq = num("""CellSignalStrengthLte[^\n]*?\brsrq\s*=\s*(-?\d+)""", tele, -34, 3)
        val lteSnr = num("""CellSignalStrengthLte[^\n]*?\brssnr\s*=\s*(-?\d+)""", tele, -23, 40)
        val nrRsrp = num("""\bssRsrp\s*=\s*(-?\d+)""", tele, -140, -40)
        val nrRsrq = num("""\bssRsrq\s*=\s*(-?\d+)""", tele, -43, 20)
        val nrSinr = num("""\bssSinr\s*=\s*(-?\d+)""", tele, -23, 40)
        val level = num("""CellSignalStrength(?:Nr|Lte)[^\n]*?\blevel\s*=\s*(\d)""", tele, 0, 4)

        val hasNr = nrRsrp != null || nrSinr != null
        val lteP = lteRsrp ?: cesqRsrp
        val primary = nrRsrp ?: lteP
        val label = if (nrRsrp != null) "5G RSRP" else if (lteP != null) "LTE RSRP" else ""
        val rsrq = if (hasNr && nrRsrq != null) nrRsrq else (lteRsrq ?: cesqRsrq ?: nrRsrq)
        val sinr = if (hasNr && nrSinr != null) nrSinr else (lteSnr ?: nrSinr)

        val bars = when {
            primary != null -> when {
                primary >= -80 -> 5
                primary >= -90 -> 4
                primary >= -100 -> 3
                primary >= -110 -> 2
                primary >= -120 -> 1
                else -> 0
            }
            level != null -> Math.round(level * 1.25f)
            else -> 0
        }
        val quality = when {
            primary == null -> ""
            primary >= -80 -> "Excellent"
            primary >= -90 -> "Good"
            primary >= -100 -> "Fair"
            else -> "Poor"
        }

        var net = act ?: ""
        if (hasNr && !net.contains("5G")) net = "5G NSA"
        val op = PLMN[plmn ?: ""] ?: plmn?.takeIf { it.isNotBlank() } ?: ""

        val note = if (primary == null && op.isEmpty()) "No modem data yet" else ""
        return SignalInfo(true, bars, primary, label, quality, net, op, REG[regStat ?: ""] ?: "",
            rsrq, sinr, battery, note)
    }
}

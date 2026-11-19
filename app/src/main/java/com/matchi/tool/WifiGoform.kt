package com.matchi.tool

import org.json.JSONArray
import org.json.JSONObject

/**
 * The stock router calls for the hotspot Wi-Fi, and how their reply is read. No Android classes (org.json only), so it is unit tested
 * (WifiGoformTest). The calls are the ones the Network window already sends (web-src/net-core.js, captured on the F50 stock page):
 *
 *  - off:  goformId=switchWiFiModule&SwitchOption=0
 *  - on:   goformId=switchWiFiChip&ChipEnum=chip1 (2.4 GHz only) or chip2 (5 GHz only)&GuestEnable=0   (also turns Wi-Fi on from Off)
 *  - read: multi_data=1&cmd=queryWiFiModuleSwitch,queryAccessPointInfo
 *
 * Bands are told apart by ChipIndex in the reply: 0 = 2.4 GHz, 1 = 5 GHz. The reply's passwords are never read or kept.
 */
object WifiGoform {
    const val READ_CMD = "queryWiFiModuleSwitch,queryAccessPointInfo"
    const val BAND_24 = "2g"
    const val BAND_5 = "5g"
    const val OFF = "off"

    /** What the reply says. [moduleOn] null = not reported. [onChips] = ChipIndex of every band that reports "on". */
    data class Seen(val moduleOn: Boolean?, val onChips: List<Int>, val entries: Int)

    fun readParams(): Map<String, String> = linkedMapOf("multi_data" to "1", "cmd" to READ_CMD)

    fun offParams(): Map<String, String> = linkedMapOf("goformId" to "switchWiFiModule", "SwitchOption" to "0")

    /** [band] is [BAND_24] or [BAND_5]; anything else is null (nothing is sent for a band that is not known). */
    fun onParams(band: String?): Map<String, String>? = when (band) {
        BAND_24 -> linkedMapOf("goformId" to "switchWiFiChip", "ChipEnum" to "chip1", "GuestEnable" to "0")
        BAND_5 -> linkedMapOf("goformId" to "switchWiFiChip", "ChipEnum" to "chip2", "GuestEnable" to "0")
        else -> null
    }

    private fun clean(v: Any?): String? {
        if (v == null || v == JSONObject.NULL) return null
        val t = v.toString().trim()
        return t.ifEmpty { null }
    }

    /** Top level first, then one level down (a multi-key read may nest a query's answer under the query's name; the nested part may be a JSON string). */
    private fun pick(root: JSONObject, name: String): Any? {
        if (root.has(name)) return root.opt(name)
        val keys = root.keys()
        while (keys.hasNext()) {
            var v = root.opt(keys.next())
            if (v is String && v.trim().startsWith("{")) v = try { JSONObject(v) } catch (_: Exception) { continue }
            if (v is JSONObject && v.has(name)) return v.opt(name)
        }
        return null
    }

    private fun list(v: Any?): JSONArray? = when (v) {
        is JSONArray -> v
        is String -> if (v.isBlank()) null else try { JSONArray(v) } catch (_: Exception) { null }
        else -> null
    }

    /** The router's reply to a get of [READ_CMD]. Null when it is not a JSON object. */
    fun seenFrom(body: String?): Seen? {
        val root = try { JSONObject((body ?: "").trim()) } catch (_: Exception) { return null }
        val sw = clean(pick(root, "WiFiModuleSwitch"))
        val arr = list(pick(root, "ResponseList"))
        val on = ArrayList<Int>()
        var n = 0
        if (arr != null) for (i in 0 until arr.length()) {
            val e = arr.opt(i) as? JSONObject ?: continue
            n++
            if (clean(e.opt("AccessPointSwitchStatus")) == "1") clean(e.opt("ChipIndex"))?.toIntOrNull()?.let { on.add(it) } ?: on.add(-1)
        }
        return Seen(sw?.let { it == "1" }, on, n)
    }

    /** Which band is on: [OFF], [BAND_24], [BAND_5], "both" (more than one is on), "other" (an unknown chip), or null when it cannot be told. */
    fun mode(s: Seen?): String? {
        s ?: return null
        val m = s.moduleOn ?: return null
        if (!m) return OFF
        if (s.entries == 0) return null   // module says on but the reply lists no band: cannot tell (not "off", that would send a needless turn-on)
        if (s.onChips.isEmpty()) return OFF
        if (s.onChips.size > 1) return "both"
        return when (s.onChips[0]) { 0 -> BAND_24; 1 -> BAND_5; else -> "other" }
    }

    /** True / false, or null when the reply does not tell. */
    fun isOn(s: Seen?): Boolean? = mode(s)?.let { it != OFF }

    /** The band to remember before turning Wi-Fi off: only when exactly one single band is on (that is all the stock call can put back). */
    fun bandOf(s: Seen?): String? = mode(s)?.takeIf { it == BAND_24 || it == BAND_5 }

    /** Did the read-back show what was wanted? [want] is [OFF], [BAND_24] or [BAND_5]. */
    fun reached(s: Seen?, want: String): Boolean = (want == OFF || want == BAND_24 || want == BAND_5) && mode(s) == want

    /** The text of the "we turned it off" file: it names the band to turn back on. */
    fun stateText(band: String): String = "band=$band\n"

    /** The band named in the state file, or null for an empty or damaged file. */
    fun parseState(text: String?): String? {
        val b = Regex("^band=(2g|5g)\\s*$", RegexOption.MULTILINE).find(text ?: "")?.groupValues?.get(1)
        return b
    }
}

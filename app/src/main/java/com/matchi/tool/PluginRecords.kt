package com.matchi.tool

import org.json.JSONArray
import org.json.JSONObject

/** Reads the saved plugin records (JSON object: file name to {sha, caps}). Bad input gives an empty map; a bad entry is skipped. */
internal fun parsePluginRecords(raw: String?): Map<String, PluginRecord> = try {
    val o = JSONObject(raw ?: "{}")
    val m = LinkedHashMap<String, PluginRecord>()
    for (k in o.keys().asSequence().toList()) {
        val e = o.optJSONObject(k) ?: continue
        val sha = e.optString("sha")
        if (!Regex("^[0-9a-f]{64}$").matches(sha)) continue
        val a = e.optJSONArray("caps") ?: JSONArray()
        m[k] = PluginRecord(sha, (0 until a.length()).map { a.optString(it) }.filter { it.isNotEmpty() })
    }
    m
} catch (_: Exception) { emptyMap() }

internal fun encodePluginRecords(m: Map<String, PluginRecord>): String {
    val o = JSONObject()
    for ((k, v) in m) o.put(k, JSONObject().put("sha", v.sha).put("caps", JSONArray(v.caps)))
    return o.toString()
}

/** Reads the saved plugin modes (JSON object: file name to "sandbox"). Bad input gives an empty map; any other value is ignored, so a plugin is trusted unless it says "sandbox". */
internal fun parsePluginModes(raw: String?): Map<String, String> = try {
    val o = JSONObject(raw ?: "{}")
    val m = LinkedHashMap<String, String>()
    for (k in o.keys().asSequence().toList()) if (o.optString(k) == "sandbox") m[k] = "sandbox"
    m
} catch (_: Exception) { emptyMap() }

internal fun encodePluginModes(m: Map<String, String>): String {
    val o = JSONObject()
    for ((k, v) in m) if (v == "sandbox") o.put(k, v)
    return o.toString()
}

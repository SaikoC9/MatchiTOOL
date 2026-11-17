package com.matchi.tool

import org.json.JSONArray
import org.json.JSONObject

/** Plugin file kinds. ".js" is injected as a script; ".html" is a legacy HTML block (script, style and meta tags), listed but not loaded. */
internal fun pluginKind(name: String): String = if (name.endsWith(".html")) "html" else "js"

/**
 * The order plugins load in: names in [saved] first (in that order, ignoring names that no longer exist and
 * repeats), then every other plugin sorted by name. A plugin that was never ordered therefore keeps the old
 * alphabetical behaviour.
 */
internal fun orderPlugins(names: Collection<String>, saved: List<String>): List<String> {
    val have = names.toHashSet()
    val out = LinkedHashSet<String>()
    for (n in saved) if (n in have) out.add(n)
    for (n in names.sorted()) out.add(n)
    return out.toList()
}

/** Reads the saved order (a JSON array of file names). Bad or empty input gives an empty list. */
internal fun parsePluginOrder(raw: String?): List<String> = try {
    val a = JSONArray(raw ?: "[]")
    (0 until a.length()).mapNotNull { a.optString(it).takeIf { s -> s.isNotEmpty() } }
} catch (_: Exception) { emptyList() }

/** Reads the saved titles (a JSON object, file name to display name). Bad input gives an empty map. */
internal fun parsePluginTitles(raw: String?): Map<String, String> = try {
    val o = JSONObject(raw ?: "{}")
    o.keys().asSequence().associateWith { o.optString(it) }.filterValues { it.isNotBlank() }
} catch (_: Exception) { emptyMap() }

/** A title is shown in the plugin list and written back into exports, so it must not break out of the marker comment. */
internal fun cleanPluginTitle(raw: String): String =
    raw.replace(Regex("[\\r\\n]+"), " ").replace("-->", "- ->").trim().take(120)

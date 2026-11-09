package com.matchi.tool

/**
 * Pure helpers (no Android classes, unit tested) that let the Log Catcher show what UFI-style plugins do.
 * Plugin calls reach the server through a fixed set of routes; each one gets a short function tag
 * ("plugin/shell", "plugin/at", ...) so the existing function filter finds them with "plugin".
 * Nothing here ever returns a command text, query value, cookie or body: only the route kind, the HTTP status,
 * the time taken and a read/write flag for AT commands.
 */
internal object PluginLog {
    /** The function tag for a plugin-facing route, or null when the route is not one a plugin uses. */
    fun kindOf(method: String, uri: String): String? = when {
        uri == "/api/root_shell" || uri == "/api/one_click_shell" || uri == "/api/user_shell" -> "plugin/shell"
        uri == "/api/AT" -> "plugin/at"
        uri.startsWith("/api/goform/") -> "plugin/goform"
        uri.startsWith("/api/proxy/") -> "plugin/proxy"
        uri == "/api/get_custom_head" || uri == "/api/set_custom_head" -> "plugin/head"
        uri == "/api/get_cookie" || uri == "/api/set_cookie" -> "plugin/cookie"
        uri == "/api/upload_img" || (uri == "/api/upload" && method == "POST") -> "plugin/upload"
        else -> null
    }

    /** Level by outcome: server errors ERROR, refusals and slow calls WARNING, everything else DEBUG (polling stays quiet). */
    fun level(status: Int, ms: Long): String = when {
        status >= 500 -> "ERROR"
        status >= 400 || ms >= SLOW_MS -> "WARNING"
        else -> "DEBUG"
    }

    /** A plain-text reason for a failing status, so the log line says why without quoting any request data. */
    fun reason(status: Int): String = when (status) {
        400 -> "bad request"
        401 -> "session expired"
        403 -> "refused (root gate or network)"
        404 -> "unknown route"
        413 -> "too large"
        429 -> "rate limited"
        else -> if (status >= 500) "server error" else ""
    }

    /** One log line: route kind is in the function tag, so the message holds method, path (no query), status and time. */
    fun message(method: String, uri: String, status: Int, ms: Long): String {
        val path = uri.substringBefore('?').take(60)
        val why = reason(status)
        return "$method $path -> $status" + (if (why.isNotEmpty()) " ($why)" else "") + " in ${ms} ms"
    }

    /** Marks a plugin script so browser errors and stack traces name it: "//# sourceURL=matchi-plugin/NAME". */
    fun sourceUrlLine(name: String): String = "\n//# sourceURL=matchi-plugin/" + safeName(name)

    /** Plugin name reduced to characters that are safe inside a sourceURL and a log line. */
    fun safeName(name: String): String = name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80).ifEmpty { "plugin" }

    /** The plugin named by a script source such as "matchi-plugin/E5.js", or null when it is not a plugin source. */
    fun pluginFromSource(src: String): String? {
        val i = src.indexOf(PREFIX)
        if (i < 0) return null
        val rest = src.substring(i + PREFIX.length)
        val end = rest.indexOfFirst { it == ':' || it == ')' || it == ' ' || it == '\n' }
        return (if (end < 0) rest else rest.substring(0, end)).takeIf { it.isNotEmpty() }
    }

    private const val PREFIX = "matchi-plugin/"
    private const val SLOW_MS = 5000L
}

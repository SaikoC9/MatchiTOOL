package com.matchi.tool

/**
 * Rules for the UFI-TOOLS style router routes (the /api/goform/ and /api/proxy/ routes). A plugin never names the router: the target
 * host is always the saved gateway, and only a path on that host can come from the request. This file holds the checks
 * that keep it so; it has no Android classes and is unit tested.
 */
object GatewayProxy {
    /** The only goform endpoints /api/goform/ forwards (the two the router's own page uses). */
    val GOFORM = setOf("goform_get_cmd_process", "goform_set_cmd_process")
    const val MAX_PARAMS = 64
    const val MAX_VALUE = 8192

    private val pathRx = Regex("^/[A-Za-z0-9._/-]{1,200}$")

    /**
     * Returns [raw] when it is a plain path on the gateway (one leading slash, safe characters, no "..", no "//", no
     * encoded separators), otherwise null. A value such as "//evil.com/x" or "http://evil/" is never a path here.
     */
    fun safePath(raw: String): String? {
        if (!pathRx.matches(raw)) return null
        if (raw.contains("..") || raw.contains("//")) return null
        return raw
    }

    /** The router path for an /api/goform/NAME request, or null when NAME is not one of [GOFORM]. */
    fun goformPath(name: String): String? = if (name in GOFORM) "/goform/$name" else null

    /**
     * True when [path] can reach the router's set endpoint. A substring match, not endsWith: safePath allows a trailing slash and other
     * suffixes ("/goform/goform_set_cmd_process/"), and a router web server may route those to the same handler.
     */
    fun isSetPath(path: String): Boolean = path.contains("goform_set_cmd_process", ignoreCase = true)

    /** The router path for an /api/proxy/REST request ("REST" is everything after /api/proxy/), or null when it is unsafe. */
    fun proxyPath(rest: String): String? = safePath("/$rest")

    /** True when a cookie value may be stored as the router session cookie: printable ASCII, no line breaks, at most 2 KB. */
    fun cookieOk(c: String): Boolean = c.length <= 2048 && c.all { it.code in 0x20..0x7e }

    /** The parameters of one forwarded request, or null when there are too many or one is too long. Names are limited to [A-Za-z0-9_.-]. */
    fun params(raw: Map<String, String>): Map<String, String>? {
        if (raw.size > MAX_PARAMS) return null
        for ((k, v) in raw) if (!Regex("^[A-Za-z0-9_.-]{1,64}$").matches(k) || v.length > MAX_VALUE) return null
        return raw
    }

    /** Decodes an application/x-www-form-urlencoded body into name/value pairs (a name repeated keeps its last value). */
    fun parseForm(text: String): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for (part in text.split('&')) {
            if (part.isEmpty()) continue
            val k = part.substringBefore('=')
            val v = if (part.contains('=')) part.substringAfter('=') else ""
            out[java.net.URLDecoder.decode(k, "UTF-8")] = java.net.URLDecoder.decode(v, "UTF-8")
        }
        return out
    }
}

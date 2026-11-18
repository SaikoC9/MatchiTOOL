package com.matchi.tool

/*
 * Session cookie. Plain Kotlin, no Android classes, so it is unit tested.
 *
 * The sign-in token is no longer handed to the page. The host sets it in an HttpOnly cookie: script in the page, plugins included,
 * cannot read or copy it, and the browser attaches it to requests by itself.
 *
 * What this does NOT do: a plugin runs in the page and its fetch() carries the cookie like any page request, so it can still call every
 * route the page can. This stops the token being copied and reused somewhere else. It does not stop a plugin using the session while the page is open.
 *
 * CSRF. A cookie is sent by the browser even when another site causes the request, so a cookie alone is not enough. Three rules together:
 *   1. SameSite=Strict (cookies are not sent on cross-site requests; note that "site" ignores the port, see 3).
 *   2. The existing Origin check in WebServer.serve (a request with a foreign Origin is refused).
 *   3. The page's marker header x-token must be present as well ([requestToken]). A cross-origin page cannot add a custom header without a CORS
 *      preflight, which this host never answers, so a plain link, image or form cannot use the cookie. This closes the gap in 1 and 2: a page
 *      served by another service on the same IP address but another port is "same site", and a GET link has no Origin header.
 * The value of the marker header is not checked and carries no secret (the page sends the word "cookie"). The name x-token is kept from earlier versions.
 *
 * Cookies are not scoped by port: any other web server on this device's IP address receives the cookie when the browser requests a path
 * under [SESSION_COOKIE_PATH] from it. Path=/api keeps it away from pages and from the router's own web interface, which use other paths.
 */

internal const val SESSION_COOKIE = "matchi_sid"
internal const val SESSION_COOKIE_PATH = "/api"

private val COOKIE_VALUE_RX = Regex("^[A-Za-z0-9._~-]{1,128}$")
private const val MAX_COOKIE_HEADER = 8192

/** The value of cookie [name] in a Cookie request header, or null when it is absent or not a plain token. Only the first cookie of that name is read. */
internal fun cookieValue(header: String?, name: String = SESSION_COOKIE): String? {
    if (header.isNullOrEmpty() || header.length > MAX_COOKIE_HEADER) return null
    for (part in header.split(';')) {
        val p = part.trim()
        val eq = p.indexOf('=')
        if (eq <= 0 || p.substring(0, eq) != name) continue
        val v = p.substring(eq + 1).trim()
        return if (COOKIE_VALUE_RX.matches(v)) v else null
    }
    return null
}

/**
 * The session token a request carries, or null. Only the cookie counts, and only when the marker header (x-token) is there too and not empty;
 * its value is ignored. A token sent in the header alone is NOT accepted: tokens are never given to the page any more, so
 * a token found there can only be an old one.
 */
internal fun requestToken(cookieHeader: String?, markerHeader: String?): String? {
    if (markerHeader.isNullOrEmpty()) return null
    return cookieValue(cookieHeader)
}

/** Set-Cookie value for a new session. A session cookie (no Max-Age): the host decides when a session ends (2 h idle, 12 h at most). [secure] when the console runs over HTTPS. */
internal fun sessionCookieHeader(token: String, secure: Boolean): String =
    "$SESSION_COOKIE=$token; Path=$SESSION_COOKIE_PATH; HttpOnly; SameSite=Strict" + if (secure) "; Secure" else ""

/** Set-Cookie value that removes the cookie (sign-out). */
internal fun clearSessionCookieHeader(secure: Boolean): String =
    "$SESSION_COOKIE=; Path=$SESSION_COOKIE_PATH; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict" + if (secure) "; Secure" else ""

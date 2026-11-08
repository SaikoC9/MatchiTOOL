package com.matchi.tool

/** Pure helpers for the OTA updater (no Android classes, unit-tested). */
internal object UpdateLinks {
    /** Hosts the updater may contact: GitHub's release pages, API and the CDNs GitHub redirects release assets to. */
    private val HOSTS = setOf(
        "github.com", "api.github.com", "objects.githubusercontent.com",
        "release-assets.githubusercontent.com", "github-releases.githubusercontent.com",
    )

    fun hostAllowed(host: String?): Boolean = host != null && host.lowercase() in HOSTS

    private val CORE = Regex("(\\d+(?:\\.\\d+)*)(.*)$", RegexOption.DOT_MATCHES_ALL)   // first number in the name: "v1.2.9", "release-1.2.27"

    private fun isPre(rest: String) = Regex("^[-_.]?[A-Za-z]").containsMatchIn(rest.trim()) && !rest.trim().startsWith(".")

    /**
     * Compares version names such as "v1.2.13", "1.2.9" or "1.2.26-rc1". A pre-release suffix ("-rc1", "-beta") makes a name
     * OLDER than the same number without it. Null when either side does not start with a number.
     */
    fun compareNames(a: String, b: String): Int? {
        val ma = CORE.find(a.trim()) ?: return null
        val mb = CORE.find(b.trim()) ?: return null
        val pa = ma.groupValues[1].split('.').map { it.toLongOrNull() ?: 0L }
        val pb = mb.groupValues[1].split('.').map { it.toLongOrNull() ?: 0L }
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val d = pa.getOrElse(i) { 0L }.compareTo(pb.getOrElse(i) { 0L })
            if (d != 0) return d
        }
        val prA = isPre(ma.groupValues[2])
        val prB = isPre(mb.groupValues[2])
        return if (prA == prB) 0 else if (prA) -1 else 1
    }

    /** Message for a failed GitHub release lookup; explains the unauthenticated rate limit (60 requests/hour). */
    fun releaseFailure(code: Int, rateRemaining: String?): String =
        if ((code == 403 || code == 429) && (rateRemaining == "0" || code == 429))
            "GitHub rate limit reached (60 checks per hour without signing in). Try again later."
        else "Release check failed (HTTP $code)."
}

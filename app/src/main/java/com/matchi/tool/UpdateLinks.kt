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
        if (isBuildCounter(a) || isBuildCounter(b)) return null   // "build-115" is a CI counter, not a version: 115 must not beat 1.3.7
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

    private val BUILD_TAG = Regex("^build[-_ ]?\\d+$", RegexOption.IGNORE_CASE)
    /** True for release tags that only count builds ("build-115"); their number says nothing about the app version. */
    fun isBuildCounter(name: String): Boolean = BUILD_TAG.matches(name.trim())

    /**
     * Which release file to use: the wanted name when present; otherwise the only .apk in the release; otherwise the only
     * .apk whose name contains "matchitool". Null when it cannot be decided (the person must give the exact file name).
     */
    fun pickApk(names: List<String>, wanted: String): String? {
        if (wanted in names) return wanted
        val apks = names.filter { it.endsWith(".apk", ignoreCase = true) }
        if (apks.size == 1) return apks[0]
        return apks.filter { it.contains("matchitool", ignoreCase = true) }.singleOrNull()
    }

    private val TAG_PAGE = Regex("^(https://github\\.com/[^/]+/[^/]+)/releases/tag/([^/?#]+)/?(?:[?#].*)?$", RegexOption.IGNORE_CASE)
    /**
     * A pasted release PAGE ("https://github.com/OWNER/REPO/releases/tag/build-115") becomes the matching download link for
     * [asset]; the real file name is then chosen from the release by [pickApk]. Any other link is returned unchanged.
     */
    fun normalizeReleaseLink(link: String, asset: String = "MatchiTOOL.apk"): String {
        val m = TAG_PAGE.find(link.trim()) ?: return link.trim()
        return m.groupValues[1] + "/releases/download/" + m.groupValues[2] + "/" + asset
    }

    /** Message for a failed GitHub release lookup; explains the unauthenticated rate limit (60 requests/hour). */
    fun releaseFailure(code: Int, rateRemaining: String?): String =
        if ((code == 403 || code == 429) && (rateRemaining == "0" || code == 429))
            "GitHub rate limit reached (60 checks per hour without signing in). Try again later."
        else "Release check failed (HTTP $code)."
}

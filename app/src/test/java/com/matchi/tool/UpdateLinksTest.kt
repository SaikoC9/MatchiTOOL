package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateLinksTest {
    @Test fun onlyGithubHostsAreAllowed() {
        for (h in listOf("github.com", "API.github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"))
            assertTrue(h, UpdateLinks.hostAllowed(h))
        for (h in listOf("192.168.0.1", "localhost", "evil.com", "github.com.evil.com", "githubusercontent.com", "", null))
            assertFalse(h.toString(), UpdateLinks.hostAllowed(h))
    }

    @Test fun comparesVersionNames() {
        assertEquals(1, UpdateLinks.compareNames("v1.2.13", "1.2.9"))
        assertEquals(0, UpdateLinks.compareNames("v1.2.26", "1.2.26"))
        assertEquals(-1, UpdateLinks.compareNames("1.2.9", "1.2.13"))
        assertEquals(0, UpdateLinks.compareNames("1.2", "1.2.0"))
        assertNull(UpdateLinks.compareNames("latest", "1.2.26"))
    }

    @Test fun findsTheNumberInsideTagNames() {
        assertEquals(1, UpdateLinks.compareNames("release-1.2.27", "1.2.26"))
        assertEquals(0, UpdateLinks.compareNames("MatchiTOOL-v1.2.27", "1.2.27"))
        assertEquals(0, UpdateLinks.compareNames("1.2.27-2", "1.2.27"))   // a build number is not a pre-release
    }

    @Test fun preReleaseIsOlderThanTheRelease() {
        assertEquals(-1, UpdateLinks.compareNames("1.2.26-rc1", "1.2.26"))
        assertEquals(1, UpdateLinks.compareNames("1.2.26", "1.2.26-rc1"))
        assertEquals(1, UpdateLinks.compareNames("1.2.27-rc1", "1.2.26"))
    }

    @Test fun explainsTheRateLimit() {
        assertTrue(UpdateLinks.releaseFailure(403, "0").contains("rate limit"))
        assertTrue(UpdateLinks.releaseFailure(429, null).contains("rate limit"))
        assertEquals("Release check failed (HTTP 403).", UpdateLinks.releaseFailure(403, "12"))
        assertEquals("Release check failed (HTTP 500).", UpdateLinks.releaseFailure(500, null))
    }

    @Test fun buildCounterTagsAreNotVersions() {
        assertTrue(UpdateLinks.isBuildCounter("build-115"))
        assertFalse(UpdateLinks.isBuildCounter("v1.3.7"))
        assertNull(UpdateLinks.compareNames("build-115", "1.3.7"))
        assertNull(UpdateLinks.compareNames("1.3.7", "Build_9"))
    }

    @Test fun picksTheRightReleaseFile() {
        assertEquals("MatchiTOOL.apk", UpdateLinks.pickApk(listOf("MatchiTOOL.apk", "x.apk"), "MatchiTOOL.apk"))
        assertEquals("app-115.apk", UpdateLinks.pickApk(listOf("app-115.apk", "notes.txt", "sha.txt"), "MatchiTOOL.apk"))
        assertEquals("MatchiTOOL-115.apk", UpdateLinks.pickApk(listOf("MatchiTOOL-115.apk", "other.apk"), "MatchiTOOL.apk"))
        assertNull(UpdateLinks.pickApk(listOf("a.apk", "b.apk"), "MatchiTOOL.apk"))
        assertNull(UpdateLinks.pickApk(listOf("notes.txt"), "MatchiTOOL.apk"))
    }

    @Test fun releasePageLinkBecomesDownloadLink() {
        assertEquals("https://github.com/SaikoC9/MatchiTOOL-releases/releases/download/build-115/MatchiTOOL.apk",
            UpdateLinks.normalizeReleaseLink("https://github.com/SaikoC9/MatchiTOOL-releases/releases/tag/build-115"))
        val dl = "https://github.com/a/b/releases/latest/download/MatchiTOOL.apk"
        assertEquals(dl, UpdateLinks.normalizeReleaseLink(dl))
    }
}

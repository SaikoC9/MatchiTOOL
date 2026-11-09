package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LogSnapshotTest {
    private val lines = listOf(
        "10:00:01 [ERROR] [plugin/js] [E5.js] JS error: boom",
        "10:00:02 [ERROR] [plugin/js] [E5.js] JS error: again",
        "10:00:03 [WARNING] [plugin/js] [Zed.js] JS error: slow",
        "10:00:04 [INFO] [plugin/js] [Zed.js] loaded",
        "10:00:05 [DEBUG] [plugin/at] POST /api/AT -> 200 in 9 ms",
        "10:00:06 [WARNING] [plugin/at] POST /api/AT -> 403 (forbidden) in 5 ms",
        "10:00:07 [ERROR] [plugin/shell] POST /api/root_shell -> 500 (server error) in 5 ms",
        "10:00:08 [INFO] [app] something else"
    )

    @Test fun countsProblemsPerPlugin() {
        val c = LogSnapshot.count(lines)
        assertEquals(mapOf("E5.js" to 2, "Zed.js" to 1), c.problems)
    }

    @Test fun countsRoutesByTag() {
        val c = LogSnapshot.count(lines)
        assertEquals(LogSnapshot.Route(2, 1, 0), c.routes["plugin/at"])
        assertEquals(LogSnapshot.Route(1, 0, 1), c.routes["plugin/shell"])
        assertFalse(c.routes.containsKey("plugin/js"))
    }

    @Test fun renderHasFixedSectionsAndTail() {
        val t = LogSnapshot.render("1.4.0", "20261109_101500", "before", "running session", lines)
        assertTrue(t.contains("App version: 1.4.0"))
        assertTrue(t.contains("Label: before"))
        assertTrue(t.contains("  E5.js: 2\n"))
        assertTrue(t.contains("  plugin/at: 2 lines, 1 warnings, 0 errors\n"))
        assertTrue(t.contains("LAST 8 LINES"))
        assertTrue(t.trimEnd().endsWith("[app] something else"))
    }

    @Test fun tailIsLimited() {
        val many = (1..500).map { "t [INFO] [app] line $it" }
        val t = LogSnapshot.render("1", "s", "", "x", many)
        assertTrue(t.contains("LAST ${LogSnapshot.TAIL_LINES} LINES"))
        assertTrue(t.contains("line 500") && !t.contains("line 300\n"))
    }

    @Test fun emptyInputSaysNone() {
        val t = LogSnapshot.render("", "s", "", "x", emptyList())
        assertTrue(t.contains("App version: unknown"))
        assertEquals(2, Regex("  none\n").findAll(t).count())
    }

    @Test fun fileNameIsSafe() {
        assertEquals("matchitool_snapshot_before_20261109_101500.txt", LogSnapshot.fileName("before", "20261109_101500"))
        assertEquals("matchitool_snapshot_20261109_101500.txt", LogSnapshot.fileName("../x", "20261109_101500"))
        assertTrue(LogBasket.isSafeName(LogSnapshot.fileName("after", "20261109_101500")))
    }

    @Test fun counterAddsUpAcrossFilesAndKeepsCountsBeyondTheTail() {
        val c = LogSnapshot.Counter()
        // two "files": the counts keep growing even though the tail shows only the last lines
        (1..300).forEach { c.add("t [ERROR] [plugin/js] [E5.js] JS error: $it") }
        (1..250).forEach { c.add("t [INFO] [plugin/at] POST /api/AT -> 200 in 5 ms") }
        c.add("")
        assertEquals(550, c.examined)
        val t = LogSnapshot.render("1", "s", "", "x", c.counts(), c.examined, listOf("last line"))
        assertTrue(t.contains("  E5.js: 300\n"))
        assertTrue(t.contains("  plugin/at: 250 lines, 0 warnings, 0 errors\n"))
        assertTrue(t.contains("Lines examined: 550"))
        assertTrue(t.contains("LAST 1 LINES"))
    }
}

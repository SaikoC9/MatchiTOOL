package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The shipped reaper (assets/bin/matchi_reaper.sh) as text: it parses, carries a version line, and uses none of the commands it must never use.
 * Behaviour in a fake root folder is scripts/test_reaper.sh, test_reaper_install.sh and test_reaper_snapshot.sh; path-rule parity with
 * PluginPaths is checked in the last one (and PluginSnapshotTest.PATH_CASES).
 */
class ReaperScriptTest {
    private fun scriptFile(): File {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            for (rel in listOf("app/src/main/assets/bin/matchi_reaper.sh", "src/main/assets/bin/matchi_reaper.sh")) {
                val f = File(dir, rel)
                if (f.isFile) return f
            }
            dir = dir.parentFile
        }
        throw AssertionError("matchi_reaper.sh not found from ${System.getProperty("user.dir")}")
    }
    private val text by lazy { scriptFile().readText() }
    /** The code lines: no blank lines, no comment-only lines. */
    private val code by lazy { text.lines().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") } }

    @Test fun firstLineIsAnAndroidShellShebangAndTheVersionLineIsRead() {
        assertEquals("#!/system/bin/sh", text.lines().first())
        val v = ReaperModel.scriptVersion(text)
        assertNotNull(v)
        assertTrue(v!! >= 3)   // v3 = Phase 5 (plugin snapshot); never ship an older number than the one the installed copies carry
    }

    @Test fun usesNoToolThatLivesInTheAppSandbox() {
        // The app is gone when this runs: no jq, curl, no file of the app, no router call (D6). (zreq / sendat appear only as process NAMES to stop.)
        val joined = code.joinToString("\n")
        for (w in listOf("jq ", "curl ", "wget ", "/data/data/com.matchi.tool/files")) assertFalse("uses $w", joined.contains(w))
    }

    @Test fun neverKillsByPatternAndNeverReadsProcCmdline() {
        val joined = code.joinToString("\n")
        assertFalse(joined.contains("pkill")); assertFalse(joined.contains("killall"))
        assertFalse(Regex("""kill[^\n]*-f""").containsMatchIn(joined))
        assertFalse(joined.contains("/cmdline"))   // hangs on the F50 kernel (docs/PLUGIN_RULES.md rule 2, review R6)
    }

    @Test fun neverDeletesABroadFolder() {
        // every rm goes through safe_rm / an explicit path under the fake-root prefix; none names a shared folder as its target
        for (l in code.filter { it.contains("rm -") }) {
            for (bad in listOf("/data/local\"", "/data/local ", "/data/local/tmp\"", "/data/local/tmp ", "/sdcard", " /data ", "\"/data\"", " / ")) assertFalse("$l ($bad)", l.contains(bad))
        }
        assertFalse(code.any { it.contains("rm -rf /") })
    }

    @Test fun deletesTheStubLastAndOnlyAfterACleanVerify() {
        val i = text.indexOf("# clean: delete the reaper itself")
        assertTrue(i > 0)
        val tail = text.substring(i, text.indexOf("# ---------------------------------------------------------------- watch loop"))
        assertTrue(tail.indexOf("rm -rf \"\$R\$RD\"") < tail.indexOf("safe_rm \"\$STUB\""))
        assertTrue(tail.indexOf("safe_rm \"\$STUB\"") < tail.indexOf("rm -f \"\$R\$LOGF\""))
        // the failure path returns before that block
        val before = text.substring(0, i)
        assertTrue(before.contains("return 1") && before.contains("retry=\$((tries + 1))"))
    }

    @Test fun runsOnlyTheTwoDocumentedModes() {
        assertTrue(text.contains("watch) watch_loop") && text.contains("wipe) run_wipe"))
    }
}

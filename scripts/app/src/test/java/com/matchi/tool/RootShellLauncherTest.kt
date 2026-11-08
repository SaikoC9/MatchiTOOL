package com.matchi.tool

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Behaviour of the generated root launcher text (no Android classes needed). */
class RootShellLauncherTest {
    private val text = RootShell.launcher("/data/local/matchitool/tmp/.matchi_pid_x", "MATCHI_EOF_x", ">/data/local/matchitool/tmp/.matchi_out_x 2>&1")

    @Test fun tempFilesLiveInTheRootOnlyFolder() {
        assertTrue(text, text.contains("/data/local/matchitool/tmp"))
        assertFalse(text, text.contains("/data/local/tmp"))
    }

    @Test fun folderIsCheckedAndPidFileIsCreatedWithNoclobber() {
        assertTrue(text, text.contains("[ ! -L /data/local/matchitool/tmp ]"))
        assertTrue(text, text.contains("stat -c %u /data/local/matchitool/tmp"))
        assertTrue(text, text.contains("set -C; echo "))
        assertTrue(text, text.contains("|| exit 1"))
    }

    @Test fun scriptIsOnlyStartedWhenTheFolderIsSafe() {
        assertTrue(text, text.contains("[ -n \"\$MT_OK\" ] && "))
        assertTrue(text, text.contains("3<<'MATCHI_EOF_x'"))
    }
}

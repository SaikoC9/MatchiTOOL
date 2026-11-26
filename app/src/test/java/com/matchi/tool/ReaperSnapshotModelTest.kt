package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReaperSnapshotModelTest {
    private val snap = "$SNAP_HEADER\nT A.js\nP /data/local/aaa\nX kill 1\n"
    private val manifest = "$MANIFEST_HEADER\n" + "a".repeat(64) + "\n"

    @Test fun pathsAreInsideTheReaperFolderAndCoveredByTheFootprint() {
        assertEquals("/data/local/matchitool/reaper/plugins.snap", ReaperModel.SNAP_PATH)
        assertEquals("/data/local/matchitool/reaper/plugins.manifest", ReaperModel.MANIFEST_PATH)
        assertEquals(Footprint.Class.REMOVE, Footprint.classify(ReaperModel.SNAP_PATH))
        assertEquals(Footprint.Class.REMOVE, Footprint.classify(ReaperModel.MANIFEST_PATH))
    }

    @Test fun theCommandCarriesBothTextsOnceAndTheirExactSizes() {
        val cmd = ReaperModel.snapshotCommand(snap, manifest)!!
        assertEquals(1, Regex("T A.js").findAll(cmd).count())
        assertEquals(1, Regex(Regex.escape("a".repeat(64))).findAll(cmd).count())
        assertTrue(cmd.contains("= " + (snap.trimEnd('\n').length + 1) + " ]"))          // the here-document adds the final newline
        assertTrue(cmd.contains("= " + (manifest.trimEnd('\n').length + 1) + " ]"))
        assertFalse(cmd.contains('\u00a7'))
        for (m in listOf(ReaperModel.SNAP_TEXT_MARK, ReaperModel.MANIFEST_TEXT_MARK, ReaperModel.SNAP_SIZE_MARK, ReaperModel.MANIFEST_SIZE_MARK)) assertFalse(m, cmd.contains(m))
        assertTrue(cmd.contains("SNAPSHOT=1"))
    }

    @Test fun theTextsGoThroughQuotedHereDocumentsOnly() {
        val cmd = ReaperModel.snapshotCommand(snap, manifest)!!
        assertTrue(cmd.contains("<<'MATCHI_SNAP_EOF'"))
        assertTrue(cmd.contains("<<'MATCHI_MANIFEST_EOF'"))
        assertEquals(2, Regex("^MATCHI_SNAP_EOF$", RegexOption.MULTILINE).findAll(cmd).count() + Regex("^MATCHI_MANIFEST_EOF$", RegexOption.MULTILINE).findAll(cmd).count())
    }

    @Test fun itWritesToTempNamesChecksSizesAndOnlyThenReplaces() {
        val cmd = ReaperModel.snapshotCommand(snap, manifest)!!
        val firstMv = cmd.indexOf("mv \"")
        assertTrue(cmd.indexOf("plugins.snap.new\" <<'MATCHI_SNAP_EOF'") in 0 until firstMv)
        assertTrue(cmd.indexOf("was not written completely") in 0 until firstMv)
        assertTrue(cmd.indexOf("chmod 600") in 0 until firstMv)
        assertTrue(cmd.indexOf("chown 0:0") in 0 until firstMv)
    }

    @Test fun itRefusesAMissingOrSymlinkedOrForeignFolder() {
        val cmd = ReaperModel.snapshotCommand(snap, manifest)!!
        assertTrue(cmd.contains("[ -d \$D ] || fail 'reaper folder is missing'"))
        assertTrue(cmd.contains("reaper folder is a symlink"))
        assertTrue(cmd.contains("matchitool folder is a symlink"))
        assertTrue(cmd.contains("is not owned by root"))
    }

    @Test fun unusableTextsGiveNoCommand() {
        assertNull(ReaperModel.snapshotCommand("", manifest))
        assertNull(ReaperModel.snapshotCommand(snap, ""))
        assertNull(ReaperModel.snapshotCommand(snap + "MATCHI_SNAP_EOF\nrm -rf /\n", manifest))          // would end the here-document early
        assertNull(ReaperModel.snapshotCommand(snap, manifest + "MATCHI_MANIFEST_EOF\nrm -rf /\n"))
        assertNull(ReaperModel.snapshotCommand(snap + "X echo @@MANIFEST_TEXT@@\n", manifest))            // a replacement mark inside the text
        assertNull(ReaperModel.snapshotCommand(snap + "X echo \u00e9\n", manifest))                         // not plain ASCII: size would not be bytes
        assertNull(ReaperModel.snapshotCommand(snap + "X echo \u00a7\n", manifest))
    }

    @Test fun aBuiltSnapshotAlwaysPassesTheWriter() {
        val b = buildPluginSnapshot(listOf(SnapPlugin("A.js", listOf("/data/local/aaa"), emptyList(), listOf("nat A_CH iptables"), emptyList(),
            listOf("iptables nat PREROUTING -p udp --dport 53 -j REDIRECT --to-ports 5353"), listOf("kill 1"))))
        assertTrue(ReaperModel.snapshotCommand(b.snap, b.manifest) != null)
        assertTrue(ReaperModel.snapshotCommand(buildPluginSnapshot(emptyList()).snap, buildPluginSnapshot(emptyList()).manifest) != null)
    }
}

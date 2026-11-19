package com.matchi.tool

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.attribute.PosixFilePermission
import java.nio.file.attribute.PosixFilePermission.GROUP_EXECUTE
import java.nio.file.attribute.PosixFilePermission.GROUP_READ
import java.nio.file.attribute.PosixFilePermission.GROUP_WRITE
import java.nio.file.attribute.PosixFilePermission.OTHERS_EXECUTE
import java.nio.file.attribute.PosixFilePermission.OTHERS_READ
import java.nio.file.attribute.PosixFilePermission.OTHERS_WRITE
import java.nio.file.attribute.PosixFilePermission.OWNER_EXECUTE
import java.nio.file.attribute.PosixFilePermission.OWNER_READ
import java.nio.file.attribute.PosixFilePermission.OWNER_WRITE

class BinaryGuardTest {
    private val abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    private val table = mapOf("tool" to abc)
    private val made = ArrayList<File>()

    @Before fun fresh() { BinaryGuard.resetForTest() }
    @After fun cleanUp() { made.forEach { it.delete() } }

    private fun file(text: String): File = File.createTempFile("binaryguard", ".bin").also { it.writeText(text); made.add(it) }

    @Test fun matchingHashIsOk() {
        assertEquals(BinaryGuard.Verdict.OK, BinaryGuard.verdict("tool", abc, table))
        assertEquals(BinaryGuard.Verdict.OK, BinaryGuard.verdict("tool", abc.uppercase(), table))
    }

    @Test fun anotherHashIsAMismatch() {
        assertEquals(BinaryGuard.Verdict.MISMATCH, BinaryGuard.verdict("tool", "00".repeat(32), table))
        // a copy that came back as zeros (the nobarrier case) has a hash too, and it is not the build's
        assertEquals(BinaryGuard.Verdict.MISMATCH, BinaryGuard.verdict("tool", BinaryGuard.hashStream(ByteArray(2048).inputStream()), table))
    }

    @Test fun noFileIsMissing() {
        assertEquals(BinaryGuard.Verdict.MISSING, BinaryGuard.verdict("tool", null, table))
    }

    @Test fun aNameThatIsNotListedIsNeverRefused() {
        assertEquals(BinaryGuard.Verdict.UNKNOWN, BinaryGuard.verdict("other", abc, table))
        assertEquals(BinaryGuard.Verdict.UNKNOWN, BinaryGuard.verdict("other", null, table))
    }

    @Test fun hashOfAFileOnDisk() {
        assertEquals(abc, BinaryGuard.hashFile(file("abc")))
        assertNull(BinaryGuard.hashFile(File("/definitely/not/here")))
        // a folder is not a file
        assertNull(BinaryGuard.hashFile(File(System.getProperty("java.io.tmpdir"))))
    }

    @Test fun aFileThatWasChangedAfterTheCopyIsCaught() {
        val f = file("abc")
        assertEquals(BinaryGuard.Verdict.OK, BinaryGuard.verdict("tool", BinaryGuard.hashFile(f), table))
        f.appendText("\n")
        assertEquals(BinaryGuard.Verdict.MISMATCH, BinaryGuard.verdict("tool", BinaryGuard.hashFile(f), table))
    }

    @Test fun stampHoldsOnlyForTheSameSizeAndTime() {
        assertFalse(BinaryGuard.isStamped("tool", 10, 5))
        BinaryGuard.stamp("tool", 10, 5)
        assertTrue(BinaryGuard.isStamped("tool", 10, 5))
        assertFalse(BinaryGuard.isStamped("tool", 11, 5))
        assertFalse(BinaryGuard.isStamped("tool", 10, 6))
        BinaryGuard.unstamp("tool")
        assertFalse(BinaryGuard.isStamped("tool", 10, 5))
    }

    @Test fun refusalsAreRememberedUntilTheFileIsGoodAgain() {
        assertTrue(BinaryGuard.refusals().isEmpty())
        BinaryGuard.refuse("sendat", "changed")
        BinaryGuard.refuse("curl", "zeros")
        assertEquals(listOf("curl", "sendat"), BinaryGuard.refusals().keys.toList())
        BinaryGuard.clearRefusal("curl")
        assertEquals(listOf("sendat"), BinaryGuard.refusals().keys.toList())
    }

    @Test fun writeAccessForOthersIsTheProblem() {
        val ownerOnly = setOf(OWNER_READ, OWNER_WRITE, OWNER_EXECUTE)
        assertFalse(BinaryGuard.othersCanWrite(ownerOnly))
        // world-executable is how the app has always set its files; it does not let anyone replace them
        assertFalse(BinaryGuard.othersCanWrite(ownerOnly + setOf(GROUP_EXECUTE, OTHERS_EXECUTE, OTHERS_READ)))
        assertTrue(BinaryGuard.othersCanWrite(ownerOnly + GROUP_WRITE))
        assertTrue(BinaryGuard.othersCanWrite(ownerOnly + OTHERS_WRITE))
        assertFalse(BinaryGuard.othersCanWrite(emptySet<PosixFilePermission>()))
    }

    @Test fun appFolderWithGroupWriteIsNotAWarning() {
        // drwxrwx--x is what Android gives every app's files folder (the group is the app's own uid)
        val androidFolder = setOf(OWNER_READ, OWNER_WRITE, OWNER_EXECUTE, GROUP_READ, GROUP_WRITE, GROUP_EXECUTE, OTHERS_EXECUTE)
        assertFalse(BinaryGuard.folderOpenToOthers(androidFolder))
        assertTrue(BinaryGuard.folderOpenToOthers(androidFolder + OTHERS_WRITE))
        // the same group write on a binary is still taken away
        assertTrue(BinaryGuard.othersCanWrite(setOf(OWNER_READ, OWNER_WRITE, GROUP_WRITE)))
    }

    @Test fun reportLinesSayWhatHappened() {
        assertTrue(BinaryGuard.reportLine("sendat", BinaryGuard.Verdict.OK, null).startsWith("sendat: ok"))
        assertTrue(BinaryGuard.reportLine("sendat", BinaryGuard.Verdict.MISSING, null).contains("not installed"))
        assertTrue(BinaryGuard.reportLine("sendat", BinaryGuard.Verdict.MISMATCH, null).contains("DIFFERENT"))
        assertTrue(BinaryGuard.reportLine("sendat", BinaryGuard.Verdict.MISSING, "it was changed").startsWith("sendat: REFUSED"))
    }
}

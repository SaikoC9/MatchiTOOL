package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * BinaryHashes.kt is written by scripts/gen_binary_hashes.py. If someone swaps a binary in assets/bin and forgets the script, the app
 * would refuse its own copy at the first start. This test fails in CI instead.
 */
class BinaryHashesFileTest {
    /** The assets folder, found from wherever the test runs (Gradle starts in app/, the shell helper at the repo root). */
    private fun binDir(): File {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            for (rel in listOf("app/src/main/assets/bin", "src/main/assets/bin")) {
                val d = File(dir, rel)
                if (d.isDirectory) return d
            }
            dir = dir.parentFile
        }
        throw AssertionError("assets/bin not found from ${System.getProperty("user.dir")}")
    }

    @Test fun everyBundledToolIsListed() {
        assertEquals(listOf("curl", "jq", "sendat", "sha256", "zreq"), BinaryHashes.names().sorted())
    }

    @Test fun everyHashLooksLikeSha256() {
        for (name in BinaryHashes.names()) {
            val h = BinaryHashes.expected(name)
            assertNotNull(name, h)
            assertTrue("$name: $h", Regex("^[0-9a-f]{64}$").matches(h!!))
        }
    }

    @Test fun theListMatchesTheFilesInTheApk() {
        val dir = binDir()
        for (name in BinaryHashes.names()) {
            assertEquals("$name in assets/bin is not the one BinaryHashes.kt was made from (run scripts/gen_binary_hashes.py)",
                BinaryHashes.expected(name), BinaryGuard.hashFile(File(dir, name)))
        }
    }

    @Test fun anUnlistedNameHasNoHash() {
        assertEquals(null, BinaryHashes.expected("imei_apply.sh"))
    }
}

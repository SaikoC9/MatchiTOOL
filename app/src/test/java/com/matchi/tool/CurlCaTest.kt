package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

/** Runs the real CurlCa.prelude in the host `sh` (no Android classes needed). */
class CurlCaTest {
    private fun tmp(): File = Files.createTempDirectory("curlca").toFile().apply { deleteOnExit() }

    private fun certs(dir: File, vararg names: String) {
        dir.mkdirs()
        names.forEach { File(dir, it).writeText("-----BEGIN CERTIFICATE-----\n$it\n-----END CERTIFICATE-----\n") }
    }

    /** Runs prelude + [after] in sh with CURL_CA_BUNDLE / SSL_CERT_FILE taken from [env]; returns stdout and the exit code. */
    private fun run(pem: File, dirs: List<File>, after: String, env: Map<String, String> = emptyMap()): Pair<String, Int> {
        val script = CurlCa.prelude(pem.path, dirs.map { it.path }) + after
        val pb = ProcessBuilder("sh", "-c", script).redirectErrorStream(true)
        pb.environment().remove("CURL_CA_BUNDLE"); pb.environment().remove("SSL_CERT_FILE")
        pb.environment().putAll(env)
        val p = pb.start()
        val out = p.inputStream.bufferedReader().readText().trim()
        return out to p.waitFor()
    }

    @Test fun exportsABundleBuiltFromTheCertFolder() {
        val t = tmp(); val d = File(t, "certs"); certs(d, "aaaa.0", "bbbb.0")
        val pem = File(t, "bin/cacert.pem")
        val (out, rc) = run(pem, listOf(d), "echo \"\$CURL_CA_BUNDLE\"")
        assertEquals(0, rc)
        assertEquals(pem.path, out)
        val text = pem.readText()
        assertTrue(text, text.contains("aaaa.0") && text.contains("bbbb.0"))
        assertEquals(2, Regex("BEGIN CERTIFICATE").findAll(text).count())
    }

    @Test fun aCallersOwnBundleIsLeftAloneAndNothingIsBuilt() {
        val t = tmp(); val d = File(t, "certs"); certs(d, "aaaa.0")
        val pem = File(t, "bin/cacert.pem")
        val (out, _) = run(pem, listOf(d), "echo \"\$CURL_CA_BUNDLE\"", mapOf("CURL_CA_BUNDLE" to "/mine.pem"))
        assertEquals("/mine.pem", out)
        assertFalse(pem.exists())
        val (out2, _) = run(pem, listOf(d), "echo \"[\$CURL_CA_BUNDLE]\"", mapOf("SSL_CERT_FILE" to "/other.pem"))
        assertEquals("[]", out2)
        assertFalse(pem.exists())
    }

    @Test fun theSecondFolderIsUsedWhenTheFirstIsMissing() {
        val t = tmp(); val second = File(t, "system"); certs(second, "cccc.0")
        val pem = File(t, "bin/cacert.pem")
        val (out, _) = run(pem, listOf(File(t, "apex-missing"), second), "echo \"\$CURL_CA_BUNDLE\"")
        assertEquals(pem.path, out)
        assertTrue(pem.readText().contains("cccc.0"))
    }

    @Test fun noCertFolderMeansNoExportAndTheScriptStillRuns() {
        val t = tmp()
        val (out, rc) = run(File(t, "bin/cacert.pem"), listOf(File(t, "none")), "echo \"[\$CURL_CA_BUNDLE]\"; exit 3")
        assertEquals("[]", out)
        assertEquals(3, rc)
    }

    @Test fun anEmptyCertFolderDoesNotLeaveABundleBehind() {
        val t = tmp(); val d = File(t, "certs"); d.mkdirs()
        val pem = File(t, "bin/cacert.pem")
        val (out, _) = run(pem, listOf(d), "echo \"[\$CURL_CA_BUNDLE]\"; ls \"${pem.parent}\" 2>/dev/null")
        assertEquals("[]", out.lines().first())
        assertFalse(pem.exists())
        assertTrue(out, !out.contains("cacert.pem."))
    }

    @Test fun anExistingBundleIsNotBuiltAgainUntilTheStoreIsNewer() {
        val t = tmp(); val d = File(t, "certs"); certs(d, "aaaa.0")
        val pem = File(t, "bin/cacert.pem")
        run(pem, listOf(d), "true")
        pem.writeText("KEEP\n"); pem.setLastModified(System.currentTimeMillis() + 60_000)
        d.setLastModified(System.currentTimeMillis() - 60_000)
        run(pem, listOf(d), "true")
        assertEquals("KEEP", pem.readText().trim())
        d.setLastModified(System.currentTimeMillis() + 120_000)
        run(pem, listOf(d), "true")
        assertTrue(pem.readText().contains("aaaa.0"))
    }

    @Test fun theHelperVariablesDoNotLeakIntoTheScript() {
        val t = tmp(); val d = File(t, "certs"); certs(d, "aaaa.0")
        val (out, _) = run(File(t, "bin/cacert.pem"), listOf(d), "echo \"[\$CA_B\$CA_D\$CA_X]\"")
        assertEquals("[]", out)
    }

    @Test fun theProductionTextNamesTheRootOnlyPaths() {
        val s = CurlCa.prelude()
        assertTrue(s, s.contains("/data/local/matchitool/bin/cacert.pem"))
        assertTrue(s, s.contains("/apex/com.android.conscrypt/cacerts") && s.contains("/system/etc/security/cacerts"))
        assertTrue(s, s.contains("export CURL_CA_BUNDLE"))
    }

    @Test(expected = IllegalArgumentException::class) fun aQuoteInAPathIsRefused() { CurlCa.prelude("/x'y.pem") }
}

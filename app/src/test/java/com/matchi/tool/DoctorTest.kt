package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DoctorTest {
    private val dir = "/data/data/com.matchi.tool/files"
    private val h1 = "a".repeat(64)
    private val h2 = "b".repeat(64)

    @Test fun commandRunsTheFileByFullPathWithEveryHash() {
        val c = Doctor.command(dir, mapOf("sendat" to h2, "curl" to h1))!!
        assertEquals("exec '$dir/matchi-doctor' -files '$dir' -tls example.com:443 -hash curl=$h1 -hash sendat=$h2 </dev/null", c)
    }

    @Test fun commandRefusesOddInput() {
        assertNull(Doctor.command("files; id", mapOf("a" to h1)))
        assertNull(Doctor.command("/data/../etc", mapOf("a" to h1)))
        assertNull(Doctor.command(dir, mapOf("a b" to h1)))
        assertNull(Doctor.command(dir, mapOf("a;id" to h1)))
        assertNull(Doctor.command(dir, mapOf("a" to "abc")))
        assertNull(Doctor.command(dir, mapOf("a" to h1.uppercase())))
    }

    @Test fun jsonIsFoundAroundOtherText() {
        assertEquals("{\"a\":1}", Doctor.jsonIn("noise\n{\"a\":1}\n"))
        assertNull(Doctor.jsonIn("no report here"))
        assertNull(Doctor.jsonIn("} before {"))
    }

    @Test fun linesShowHintsOnlyWhenNotOk() {
        val text = Doctor.lines(listOf(
            Doctor.Check("root", "Root", "ok", "running as uid 0", "a hint"),
            Doctor.Check("at", "Modem AT, slot 0", "warn", "port held", "Pin a free port")))
        assertEquals("[ok] Root - running as uid 0\n[warn] Modem AT, slot 0 - port held  (Pin a free port)", text)
    }

    @Test fun summaryAndNotRun() {
        assertEquals("summary: 9 ok, 0 warn, 0 fail, 0 skip", Doctor.summaryLine(9, 0, 0, 0))
        assertTrue(Doctor.notRun("not installed").startsWith("matchi-doctor did not run"))
        assertNotNull(Doctor.BINARY)
    }
}

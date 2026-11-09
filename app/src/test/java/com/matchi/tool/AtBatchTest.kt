package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AtBatchTest {
    private val m = "##abc123"

    @Test fun markersAreRandomHex() {
        val a = AtBatch.newMarker(); val b = AtBatch.newMarker()
        assertTrue(Regex("^##[0-9a-f]{32}$").matches(a))
        assertNotEquals(a, b)
    }

    @Test fun simpleResultsAreSplitPerCommand() {
        val out = "\n$m:AT0\nOK\n\n$m:AT1\n+CSQ: 20,99\nOK\n\n$m:END\n"
        assertEquals(listOf("OK", "+CSQ: 20,99\nOK"), AtBatch.parse(out, m, 2))
    }

    @Test fun doubleHashInsideAReplyDoesNotCutTheResult() {
        val out = "\n$m:AT0\n+CUSD: 1,\"Balance ## 5.00 ##\",15\nOK\n\n$m:AT1\nOK\n\n$m:END\n"
        assertEquals("+CUSD: 1,\"Balance ## 5.00 ##\",15\nOK", AtBatch.parse(out, m, 2)[0])
        assertEquals("OK", AtBatch.parse(out, m, 2)[1])
    }

    @Test fun aReplyCannotForgeAnotherCommandsMarker() {
        // the modem prints lines that look like the old fixed markers, and like a marker with a wrong random part
        val out = "\n$m:AT0\n##AT1\nfake\n##abc999:AT1\n##END\nOK\n\n$m:AT1\nreal\n\n$m:END\n"
        val r = AtBatch.parse(out, m, 2)
        assertEquals("##AT1\nfake\n##abc999:AT1\n##END\nOK", r[0])
        assertEquals("real", r[1])
    }

    @Test fun markerGluedAfterOutputWithoutNewlineIsStillSeenBecauseOfTheLeadingNewline() {
        val out = "\n$m:AT0\nOK\n$m:END\n"   // sendat printed "OK" with no newline: script's printf adds one before the marker
        assertEquals(listOf("OK"), AtBatch.parse(out, m, 1))
    }

    @Test fun missingSectionsAreEmptyAndCutOutputKeepsPartialResult() {
        assertEquals(listOf("", ""), AtBatch.parse("garbage", m, 2))
        assertEquals(listOf("partial", ""), AtBatch.parse("\n$m:AT0\npartial", m, 2))
    }

    @Test fun carriageReturnsAreStripped() {
        assertEquals(listOf("OK"), AtBatch.parse("\r\n$m:AT0\r\nOK\r\n$m:END\r\n", m, 1))
    }

    @Test fun scriptQuotesCommandsAndUsesTheMarker() {
        val s = AtBatch.script("/data/sendat", 1, listOf("AT+CSQ", "AT+X='a'"), m)
        assertTrue(s.contains("'$m:AT0'") && s.contains("'$m:AT1'") && s.contains("'$m:END'"))
        assertTrue(s.contains("-n 1 -c 'AT+CSQ'"))
        assertTrue(s.contains("'AT+X='\\''a'\\'''"))
    }

    @Test fun ufiRouteCommandRules() {
        assertEquals("AT+CSQ", AtBatch.checkCommand("  AT+CSQ "))
        assertEquals("at+cops?", AtBatch.checkCommand("at+cops?"))
        for (bad in listOf(null, "", "ls /data", "AT\nAT+CFUN=1", "AT\rX", "AT\u0000", "A".repeat(301)))
            assertTrue("rejected: $bad", try { AtBatch.checkCommand(bad); false } catch (_: IllegalArgumentException) { true })
        assertEquals(300, AtBatch.checkCommand("AT" + "A".repeat(298)).length)
    }

    @Test fun ufiRouteSlotRules() {
        assertEquals(0, AtBatch.checkSlot(null)); assertEquals(0, AtBatch.checkSlot("")); assertEquals(0, AtBatch.checkSlot("0"))
        assertEquals(1, AtBatch.checkSlot(" 1 "))
        for (bad in listOf("2", "-1", "01", "abc", "0;id"))
            assertTrue("rejected: $bad", try { AtBatch.checkSlot(bad); false } catch (_: IllegalArgumentException) { true })
    }
}

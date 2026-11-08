package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RedactorTest {
    private fun r(s: String) = Redactor().line(s)

    @Test fun passwordsAndTokens() {
        assertEquals("login password=[REDACTED] ok", r("login password=hunter2 ok"))
        assertEquals("x-token: [REDACTED]", r("x-token: abcdef1234567890"))
        assertEquals("Authorization: [REDACTED]", r("Authorization: Bearer abcdef1234567890"))
        assertEquals("GET /api?token=[REDACTED]&x=1", r("GET /api?token=abc123def&x=1"))
        assertEquals("cookie=[REDACTED]", r("cookie=\"a b c\""))
    }
    @Test fun plainWordsAreKept() {
        assertEquals("token expired for user", r("token expired for user"))
        assertEquals("password prompt shown", r("password prompt shown"))
    }
    @Test fun imeiLabelledAndBare() {
        assertEquals("imei=[ID]", r("imei=860000000000001"))
        assertEquals("sent [IMEI] to modem", r("sent 490154203237518 to modem"))      // Luhn-valid
        assertEquals("count 123456789012345 rows", r("count 123456789012345 rows"))     // 15 digits but not Luhn-valid
    }
    @Test fun iccidAndPhone() {
        assertEquals("sim [ICCID]", r("sim 8949000000000000000"))
        assertEquals("from [PHONE] at 10:00", r("from +639171234567 at 10:00"))
        assertEquals("version 1.2.3", r("version 1.2.3"))
    }
    @Test fun smsLinesLoseTheirPayload() {
        assertEquals("+CMGR: [SMS redacted]", r("+CMGR: \"REC UNREAD\",\"+639171234567\",,\"26/11/08\"").let { it.substringBefore("[SMS") + "[SMS redacted]" })
        assertTrue(r("AT+CMGS=\"+639171234567\"").endsWith("[SMS redacted]"))
        assertFalse(r("AT+CMGS=\"+639171234567\"").contains("639171234567"))
        assertEquals("sms_body=[SMS redacted]", r("sms_body=Your code is 123456"))
    }
    @Test fun hexOnlyOnMessageLines() {
        val pdu = "0791" + "A".repeat(60)
        assertTrue(r("sms pdu $pdu").contains("[HEX redacted]"))
        assertEquals("hash $pdu", r("hash $pdu"))
    }
    @Test fun countsAndSummary() {
        val x = Redactor()
        x.line("password=a"); x.line("hello"); x.line("token=b")
        assertEquals(2, x.counts["secret"]); assertEquals(2, x.total)
        assertTrue(x.summary().contains("secret: 2"))
        assertEquals("Nothing needed redaction.", Redactor().summary())
    }
    @Test fun luhn() {
        assertTrue(Redactor.luhn("490154203237518")); assertFalse(Redactor.luhn("490154203237519")); assertFalse(Redactor.luhn("12a"))
    }
    @Test fun textKeepsLines() {
        assertEquals("a\npassword=[REDACTED]\nb", Redactor().text("a\npassword=x\nb"))
    }
}

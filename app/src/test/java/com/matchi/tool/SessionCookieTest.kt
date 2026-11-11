package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionCookieTest {
    private val tok = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

    @Test fun findsTheCookieAmongOthers() {
        assertEquals(tok, cookieValue("theme=dark; matchi_sid=$tok; other=1"))
        assertEquals(tok, cookieValue("matchi_sid=$tok"))
        assertEquals(tok, cookieValue("  a=1 ;   matchi_sid= $tok  "))
    }

    @Test fun otherNamesAreNotMatched() {
        assertNull(cookieValue("xmatchi_sid=$tok"))
        assertNull(cookieValue("matchi_sid2=$tok"))
        assertNull(cookieValue("a=matchi_sid=$tok"))
        assertNull(cookieValue("theme=dark"))
    }

    @Test fun missingOrOddInputGivesNull() {
        assertNull(cookieValue(null))
        assertNull(cookieValue(""))
        assertNull(cookieValue("matchi_sid="))
        assertNull(cookieValue("matchi_sid"))
        assertNull(cookieValue("=$tok"))
    }

    @Test fun valueMustBeAPlainToken() {
        assertNull(cookieValue("matchi_sid=ab cd"))
        assertNull(cookieValue("matchi_sid=\"$tok\""))
        assertNull(cookieValue("matchi_sid=a,b"))
        assertNull(cookieValue("matchi_sid=" + "a".repeat(129)))
        assertEquals("a".repeat(128), cookieValue("matchi_sid=" + "a".repeat(128)))
    }

    @Test fun oversizedHeaderIsIgnored() {
        assertNull(cookieValue("a=" + "x".repeat(9000) + "; matchi_sid=$tok"))
    }

    @Test fun onlyTheFirstCookieOfThatNameIsRead() {
        assertEquals("first", cookieValue("matchi_sid=first; matchi_sid=second"))
        // an unusable first value does not fall through to the second
        assertNull(cookieValue("matchi_sid=bad value; matchi_sid=second"))
    }

    @Test fun cookieNeedsTheMarkerHeader() {
        assertEquals(tok, requestToken("matchi_sid=$tok", "cookie"))
        // the marker's value is not checked
        assertEquals(tok, requestToken("matchi_sid=$tok", "anything"))
        assertNull(requestToken("matchi_sid=$tok", null))
        assertNull(requestToken("matchi_sid=$tok", ""))
    }

    @Test fun aTokenInTheHeaderAloneIsNotAccepted() {
        assertNull(requestToken(null, tok))
        assertNull(requestToken("", tok))
        assertNull(requestToken("theme=dark", tok))
    }

    @Test fun theCookieWinsOverTheHeaderValue() {
        assertEquals(tok, requestToken("matchi_sid=$tok", "0000"))
    }

    @Test fun newSessionCookieIsHttpOnlyStrictAndUnderApi() {
        val c = sessionCookieHeader(tok, secure = false)
        assertTrue(c.startsWith("matchi_sid=$tok;"))
        assertTrue(c.contains("; HttpOnly"))
        assertTrue(c.contains("; SameSite=Strict"))
        assertTrue(c.contains("; Path=/api"))
        assertFalse(c.contains("Secure"))
        assertFalse(c.contains("Max-Age"))   // a session cookie; the host ends the session
        assertFalse(c.contains("Domain"))
    }

    @Test fun secureOnlyOverHttps() {
        assertTrue(sessionCookieHeader(tok, secure = true).endsWith("; Secure"))
        assertTrue(clearSessionCookieHeader(secure = true).endsWith("; Secure"))
        assertFalse(clearSessionCookieHeader(secure = false).contains("Secure"))
    }

    @Test fun clearingExpiresTheCookieAtOnce() {
        val c = clearSessionCookieHeader(secure = false)
        assertTrue(c.startsWith("matchi_sid=;"))
        assertTrue(c.contains("Max-Age=0"))
        assertTrue(c.contains("Path=/api"))
        assertTrue(c.contains("HttpOnly"))
    }

    @Test fun whatTheHostSetsIsWhatItReads() {
        val set = sessionCookieHeader(tok, secure = true)
        // a browser sends back only name=value
        val sent = set.substringBefore(';')
        assertEquals(tok, cookieValue(sent))
    }
}

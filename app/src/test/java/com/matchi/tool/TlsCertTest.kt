package com.matchi.tool

import java.io.ByteArrayInputStream
import java.security.KeyPairGenerator
import java.security.SecureRandom
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The console certificate must carry what a browser needs after you trust it by hand: SAN with the IPs, CA:TRUE, server auth. */
class TlsCertTest {
    private fun make(ips: List<String>): X509Certificate {
        val kp = KeyPairGenerator.getInstance("RSA").apply { initialize(2048, SecureRandom()) }.generateKeyPair()
        val der = Tls.selfSignedCert(kp, ips)
        val c = CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(der)) as X509Certificate
        c.verify(kp.public)   // really self-signed
        return c
    }

    @Test fun listsLocalhostLoopbackAndGivenIps() {
        val c = make(listOf("192.168.0.1", "192.168.42.129"))
        val san = c.subjectAlternativeNames.map { it[0] as Int to it[1] as String }
        assertTrue(2 to "localhost" in san)
        assertTrue(7 to "127.0.0.1" in san)
        assertTrue(7 to "192.168.0.1" in san)
        assertTrue(7 to "192.168.42.129" in san)
    }

    @Test fun ignoresInvalidAddresses() {
        val san = make(listOf("999.1.1.1", "not-an-ip", "10.0.0.1")).subjectAlternativeNames.map { it[1] as String }
        assertTrue("10.0.0.1" in san)
        assertTrue("999.1.1.1" !in san && "not-an-ip" !in san)
    }

    @Test fun canBeTrustedAndUsedForTls() {
        val c = make(emptyList())
        assertTrue(c.basicConstraints >= 0)                              // CA:TRUE, so it installs as a trusted certificate
        assertTrue(c.keyUsage[0] && c.keyUsage[2] && c.keyUsage[5])      // digitalSignature, keyEncipherment, keyCertSign
        assertTrue("1.3.6.1.5.5.7.3.1" in c.extendedKeyUsage)            // serverAuth
        assertEquals("CN=MatchiTOOL", c.subjectX500Principal.name)
    }
}

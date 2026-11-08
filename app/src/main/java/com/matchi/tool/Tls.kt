package com.matchi.tool

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.InetSocketAddress
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.SecureRandom
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.spec.PKCS8EncodedKeySpec
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.security.cert.X509Certificate
import java.util.Date
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLServerSocketFactory
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager
import javax.security.auth.x500.X500Principal

/**
 * HTTPS for the web console. The certificate is self-signed and generated on the device by Android's own key store
 * (the private key never leaves it), so nothing secret is shipped inside the APK. Browsers show a one-time
 * "not trusted" warning because no public authority can sign a certificate for a private IP address; the traffic is
 * still encrypted. If anything here fails, the host falls back to plain HTTP so the console stays reachable.
 */
object Tls {
    private const val ALIAS = "matchitool_tls"
    @Volatile var active = false

    /**
     * True once the web host is listening and the scheme is final (https, or http after the fallback). The home screen waits
     * for this before it shows an address or opens the console: before it, [scheme] can still change, and a link opened at
     * that moment (http against an https server) gives a blank page.
     */
    @Volatile var ready = false
    val scheme: String get() = if (active) "https" else "http"

    /** Which key the current factory uses: "keystore" (Android key store) or "software" (key file in the app's private folder). */
    @Volatile var keySource = ""

    /** Server socket factory backed by the Android key store, or null when TLS cannot be set up this way on this device. */
    fun serverFactory(): SSLServerSocketFactory? = try {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!ks.containsAlias(ALIAS) || certExpiresSoon(ks)) {
            if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS)
            generate()
        }
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
        kmf.init(ks, null)
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(kmf.keyManagers, null, SecureRandom())
        keySource = "keystore"
        ctx.serverSocketFactory
    } catch (e: Exception) {
        LogCatcher.log("WARNING", "Tls", "TLS setup (key store) failed: ${e.javaClass.simpleName}: ${e.message}")
        null
    }

    /**
     * Fallback for devices whose key store cannot sign during a TLS handshake (seen on the ZTE F50: the handshake is cut with
     * "connection closed" while the key store key is used). The key is an ordinary RSA key made in software and kept in two
     * files in the app's private folder (mode 600, not readable by other apps). It is less protected than a key store key,
     * but the traffic is still encrypted, which plain HTTP is not.
     */
    fun softwareFactory(ctx0: Context): SSLServerSocketFactory? = try {
        val dir = ctx0.filesDir
        val keyF = File(dir, "tls_sw.key"); val crtF = File(dir, "tls_sw.crt")
        var cert: X509Certificate? = null
        var priv: java.security.PrivateKey? = null
        try {
            if (keyF.isFile && crtF.isFile) {
                cert = CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(crtF.readBytes())) as X509Certificate
                priv = KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(keyF.readBytes()))
                if (cert.notAfter.time - System.currentTimeMillis() < 30L * 24 * 3600 * 1000) { cert = null; priv = null }
            }
        } catch (_: Exception) { cert = null; priv = null }
        if (cert == null || priv == null) {
            val kp: KeyPair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048, SecureRandom()) }.generateKeyPair()
            val der = selfSignedCert(kp)
            cert = CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(der)) as X509Certificate
            priv = kp.private
            writePrivate(keyF, priv.encoded); writePrivate(crtF, der)
        }
        val pw = "matchi".toCharArray()   // only protects the in-memory key store below; the files are protected by the app's private folder
        val ks = KeyStore.getInstance("PKCS12").apply { load(null, null); setKeyEntry("matchitool_sw", priv, pw, arrayOf(cert)) }
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(ks, pw) }
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(kmf.keyManagers, null, SecureRandom())
        keySource = "software"
        ctx.serverSocketFactory
    } catch (e: Exception) {
        LogCatcher.log("WARNING", "Tls", "TLS setup (software key) failed: ${e.javaClass.simpleName}: ${e.message}")
        null
    }

    private fun writePrivate(f: File, data: ByteArray) {
        val t = File(f.parentFile, f.name + ".new")
        t.writeBytes(data)
        t.setReadable(false, false); t.setWritable(false, false); t.setReadable(true, true); t.setWritable(true, true)
        if (!t.renameTo(f)) { f.delete(); if (!t.renameTo(f)) throw java.io.IOException("cannot save ${f.name}") }
    }

    // ---- minimal DER writer for a self-signed X.509 v3 certificate (no extra library needed) ----
    private fun der(tag: Int, body: ByteArray): ByteArray {
        val o = ByteArrayOutputStream()
        o.write(tag)
        val n = body.size
        when {
            n < 0x80 -> o.write(n)
            n < 0x100 -> { o.write(0x81); o.write(n) }
            n < 0x10000 -> { o.write(0x82); o.write(n shr 8); o.write(n and 0xff) }
            else -> { o.write(0x83); o.write(n shr 16); o.write((n shr 8) and 0xff); o.write(n and 0xff) }
        }
        o.write(body)
        return o.toByteArray()
    }
    private fun cat(vararg p: ByteArray): ByteArray { val o = ByteArrayOutputStream(); p.forEach { o.write(it) }; return o.toByteArray() }
    private fun utc(ms: Long): ByteArray {
        val f = SimpleDateFormat("yyMMddHHmmss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        return der(0x17, f.format(Date(ms)).toByteArray(Charsets.US_ASCII))
    }

    /** DER of a self-signed certificate (CN=MatchiTOOL, 10 years, SHA256withRSA) for [kp]. */
    fun selfSignedCert(kp: KeyPair): ByteArray {
        val now = System.currentTimeMillis()
        val sigAlg = der(0x30, cat(der(0x06, byteArrayOf(0x2a, 0x86.toByte(), 0x48, 0x86.toByte(), 0xf7.toByte(), 0x0d, 0x01, 0x01, 0x0b)), der(0x05, ByteArray(0))))   // sha256WithRSAEncryption
        val name = der(0x30, der(0x31, der(0x30, cat(der(0x06, byteArrayOf(0x55, 0x04, 0x03)), der(0x0c, "MatchiTOOL".toByteArray(Charsets.UTF_8))))))
        val serial = ByteArray(16).also { SecureRandom().nextBytes(it); it[0] = ((it[0].toInt() and 0x3f) or 0x40).toByte() }   // positive, no leading zero
        val validity = der(0x30, cat(utc(now - 24L * 3600 * 1000), utc(now + 3650L * 24 * 3600 * 1000)))
        val tbs = der(0x30, cat(
            der(0xa0, der(0x02, byteArrayOf(2))),   // version v3
            der(0x02, serial), sigAlg, name, validity, name, kp.public.encoded))   // public.encoded is already a SubjectPublicKeyInfo
        val sig = Signature.getInstance("SHA256withRSA").apply { initSign(kp.private); update(tbs) }.sign()
        return der(0x30, cat(tbs, sigAlg, der(0x03, cat(byteArrayOf(0), sig))))
    }

    private fun certExpiresSoon(ks: KeyStore): Boolean = try {
        val c = ks.getCertificate(ALIAS) as X509Certificate
        c.notAfter.time - System.currentTimeMillis() < 30L * 24 * 3600 * 1000
    } catch (_: Exception) { true }

    private fun generate() {
        val now = System.currentTimeMillis()
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY or KeyProperties.PURPOSE_DECRYPT or KeyProperties.PURPOSE_ENCRYPT)
            .setKeySize(2048)
            .setDigests(KeyProperties.DIGEST_NONE, KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA384, KeyProperties.DIGEST_SHA512)
            .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1, KeyProperties.SIGNATURE_PADDING_RSA_PSS)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_PKCS1)
            .setCertificateSubject(X500Principal("CN=MatchiTOOL"))
            .setCertificateNotBefore(Date(now - 24L * 3600 * 1000))
            .setCertificateNotAfter(Date(now + 3650L * 24 * 3600 * 1000))
            .build()
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore").apply { initialize(spec) }.generateKeyPair()
    }

    /** Loopback TLS handshake against the running server. False means HTTPS does not really work on this device. */
    fun selfTest(port: Int): Boolean = try {
        val trustAll = object : X509TrustManager {
            override fun checkClientTrusted(c: Array<X509Certificate>?, a: String?) {}
            override fun checkServerTrusted(c: Array<X509Certificate>?, a: String?) {}
            override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
        }
        val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trustAll), SecureRandom()) }
        (ctx.socketFactory.createSocket() as SSLSocket).use { s ->
            s.soTimeout = 5000
            s.connect(InetSocketAddress("127.0.0.1", port), 3000)
            s.startHandshake()
            LogCatcher.log("INFO", "Tls", "TLS self-test ok (${keySource}, ${s.session.protocol}, ${s.session.cipherSuite})")
            true
        }
    } catch (e: Exception) {
        LogCatcher.log("WARNING", "Tls", "TLS self-test failed: ${e.javaClass.simpleName}: ${e.message}" + (e.cause?.let { " (cause: ${it.javaClass.simpleName}: ${it.message})" } ?: ""))
        false
    }
}

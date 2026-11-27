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
import java.security.interfaces.RSAPrivateCrtKey
import java.security.spec.RSAPublicKeySpec
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
 * HTTPS for the web console. The certificate is self-signed and generated on the device, so nothing secret is shipped
 * inside the APK. It is made ONCE and kept (software key in the app's private folder), and it lists localhost, 127.0.0.1
 * and the hotspot / USB addresses in its Subject Alternative Names. Browsers still show a "not trusted" warning the first
 * time (no public authority signs certificates for private IPs), but the certificate can be downloaded from
 * `/cert.pem` and trusted once on the PC; after that the warning is gone. The traffic is encrypted either way.
 * The Android key store certificate (no SAN possible) is only a fallback. If everything here fails, the host falls back
 * to plain HTTP so the console stays reachable.
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

    /** DER of the certificate the running server presents. [selfTest] accepts only this exact certificate (no "trust anything"). */
    @Volatile private var servedCertDer: ByteArray? = null

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
        servedCertDer = (ks.getCertificate(ALIAS) as X509Certificate).encoded
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
        // Keep the certificate (and so the browser's trust in it) as long as it still names every address this device has now.
        val current = currentIps()
        val have = if (cert != null) sanIps(cert) else emptySet()
        if (cert != null && !have.containsAll(current + "127.0.0.1")) {
            LogCatcher.log("INFO", "Tls", "TLS certificate does not list ${(current + "127.0.0.1" - have).joinToString()}; issuing a new one (trust it again once)")
            cert = null
        }
        if (cert == null || priv == null) {
            val oldKey = priv
            val kp: KeyPair = rebuildKeyPair(oldKey) ?: KeyPairGenerator.getInstance("RSA").apply { initialize(2048, SecureRandom()) }.generateKeyPair()
            val der = selfSignedCert(kp, wantedIps(ctx0, have))
            cert = CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(der)) as X509Certificate
            priv = kp.private
            writePrivate(keyF, priv.encoded); writePrivate(crtF, der)
        }
        val pw = "matchi".toCharArray()   // only protects the in-memory key store below; the files are protected by the app's private folder
        val ks = KeyStore.getInstance("PKCS12").apply { load(null, null); setKeyEntry("matchitool_sw", priv, pw, arrayOf(cert)) }
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(ks, pw) }
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(kmf.keyManagers, null, SecureRandom())
        servedCertDer = cert.encoded
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

    private val ipv4 = Regex("""^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$""")

    /** Gateway addresses a ZTE / Android hotspot or USB tether normally has, so a changed address rarely needs a new certificate. */
    private val commonIps = listOf("192.168.0.1", "192.168.1.1", "192.168.42.1", "192.168.42.129", "192.168.43.1", "192.168.49.1", "10.0.0.1")

    /** Private IPv4 addresses this device has right now (hotspot, USB, Wi-Fi). */
    fun currentIps(): Set<String> = Quiet.orElse("Tls.currentIps", emptySet<String>()) {
        val out = LinkedHashSet<String>()
        for (nif in java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces() ?: return@orElse emptySet<String>())) {
            if (!nif.isUp || nif.isLoopback) continue
            for (a in java.util.Collections.list(nif.inetAddresses)) {
                if (a is java.net.Inet4Address && a.isSiteLocalAddress) a.hostAddress?.let { out.add(it) }
            }
        }
        out
    }

    /** Addresses written into a new certificate: the ones it had, the common gateways, the router host and what the device has now. */
    private fun wantedIps(ctx: Context, previous: Set<String>): List<String> {
        val all = LinkedHashSet<String>()
        all.addAll(previous); all.addAll(commonIps); all.addAll(currentIps())
        Quiet.orElse("Tls.zteHost", false) { all.add(Prefs.zteHost(ctx)) }
        return all.filter { ipv4.matches(it) }
    }

    /** IP addresses named in a certificate's Subject Alternative Names. */
    private fun sanIps(c: X509Certificate): Set<String> = Quiet.orElse("Tls.sanIps", emptySet<String>()) {
        (c.subjectAlternativeNames ?: emptyList()).filter { (it[0] as? Int) == 7 }.mapNotNull { it[1] as? String }.toSet()
    }

    /** The key pair for an RSA private key that carries its CRT parameters (it does when made by KeyPairGenerator), else null. */
    private fun rebuildKeyPair(k: java.security.PrivateKey?): KeyPair? {
        val crt = k as? RSAPrivateCrtKey ?: return null
        return Quiet.orElse<KeyPair?>("Tls.rebuildKeyPair", null) {
            KeyPair(KeyFactory.getInstance("RSA").generatePublic(RSAPublicKeySpec(crt.modulus, crt.publicExponent)), k)
        }
    }

    private fun ext(oid: ByteArray, critical: Boolean, value: ByteArray): ByteArray =
        der(0x30, cat(der(0x06, oid), if (critical) der(0x01, byteArrayOf(0xff.toByte())) else ByteArray(0), der(0x04, value)))

    /**
     * DER of a self-signed certificate (CN=MatchiTOOL, 10 years, SHA256withRSA) for [kp]. It carries the extensions browsers
     * need before they accept a certificate you trust by hand: a Subject Alternative Name (localhost, 127.0.0.1 and every
     * address in [ips]), CA:TRUE so it can be installed as a trusted certificate, key usage, and "server authentication".
     */
    fun selfSignedCert(kp: KeyPair, ips: Collection<String> = emptyList()): ByteArray {
        val now = System.currentTimeMillis()
        val sigAlg = der(0x30, cat(der(0x06, byteArrayOf(0x2a, 0x86.toByte(), 0x48, 0x86.toByte(), 0xf7.toByte(), 0x0d, 0x01, 0x01, 0x0b)), der(0x05, ByteArray(0))))   // sha256WithRSAEncryption
        val name = der(0x30, der(0x31, der(0x30, cat(der(0x06, byteArrayOf(0x55, 0x04, 0x03)), der(0x0c, "MatchiTOOL".toByteArray(Charsets.UTF_8))))))
        val serial = ByteArray(16).also { SecureRandom().nextBytes(it); it[0] = ((it[0].toInt() and 0x3f) or 0x40).toByte() }   // positive, no leading zero
        val validity = der(0x30, cat(utc(now - 24L * 3600 * 1000), utc(now + 3650L * 24 * 3600 * 1000)))
        val addrs = (listOf("127.0.0.1") + ips).filter { ipv4.matches(it) }.distinct()
        val names = ArrayList<ByteArray>()
        names.add(der(0x82, "localhost".toByteArray(Charsets.US_ASCII)))                                   // dNSName
        addrs.forEach { a -> names.add(der(0x87, ByteArray(4) { i -> a.split('.')[i].toInt().toByte() })) }  // iPAddress
        val san = ext(byteArrayOf(0x55, 0x1d, 0x11), false, der(0x30, cat(*names.toTypedArray())))
        val basic = ext(byteArrayOf(0x55, 0x1d, 0x13), true, der(0x30, der(0x01, byteArrayOf(0xff.toByte()))))   // CA:TRUE
        val usage = ext(byteArrayOf(0x55, 0x1d, 0x0f), true, der(0x03, byteArrayOf(0x02, 0xa4.toByte())))       // digitalSignature, keyEncipherment, keyCertSign
        val eku = ext(byteArrayOf(0x55, 0x1d, 0x25), false, der(0x30, der(0x06, byteArrayOf(0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x01))))   // serverAuth
        val extensions = der(0xa3, der(0x30, cat(basic, usage, eku, san)))
        val tbs = der(0x30, cat(
            der(0xa0, der(0x02, byteArrayOf(2))),   // version v3
            der(0x02, serial), sigAlg, name, validity, name, kp.public.encoded, extensions))   // public.encoded is already a SubjectPublicKeyInfo
        val sig = Signature.getInstance("SHA256withRSA").apply { initSign(kp.private); update(tbs) }.sign()
        return der(0x30, cat(tbs, sigAlg, der(0x03, cat(byteArrayOf(0), sig))))
    }

    /** The certificate the running server presents, as PEM text (public data, safe to hand out), or null before the server has one. */
    fun certPem(): String? {
        val d = servedCertDer ?: return null
        val b64 = java.util.Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(d)
        return "-----BEGIN CERTIFICATE-----\n$b64\n-----END CERTIFICATE-----\n"
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

    /** Loopback TLS handshake against the running server, accepting only the server's own certificate. False means HTTPS does not really work on this device. */
    fun selfTest(port: Int): Boolean = try {
        // The certificate is self-signed, so no authority can vouch for it. Instead of trusting any certificate, this test
        // trusts only the one certificate the server itself was started with (pinned by its exact bytes).
        val pinned = servedCertDer ?: throw java.security.cert.CertificateException("no server certificate recorded")
        val pinnedOnly = object : X509TrustManager {
            override fun checkClientTrusted(c: Array<X509Certificate>?, a: String?) { throw java.security.cert.CertificateException("client certificates are not used") }
            override fun checkServerTrusted(c: Array<X509Certificate>?, a: String?) {
                val leaf = c?.firstOrNull() ?: throw java.security.cert.CertificateException("server sent no certificate")
                if (!leaf.encoded.contentEquals(pinned)) throw java.security.cert.CertificateException("server certificate is not the one this app made")
            }
            override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
        }
        val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf(pinnedOnly), SecureRandom()) }
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

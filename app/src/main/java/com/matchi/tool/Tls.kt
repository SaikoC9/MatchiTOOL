package com.matchi.tool

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import java.net.InetSocketAddress
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.SecureRandom
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
    val scheme: String get() = if (active) "https" else "http"

    /** Server socket factory backed by the key store, or null when TLS cannot be set up on this device. */
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
        ctx.serverSocketFactory
    } catch (e: Exception) {
        Log.w("MatchiTOOL", "TLS setup failed, using plain HTTP: ${e.message}")
        null
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
            true
        }
    } catch (e: Exception) {
        Log.w("MatchiTOOL", "TLS self-test failed: ${e.message}")
        false
    }
}

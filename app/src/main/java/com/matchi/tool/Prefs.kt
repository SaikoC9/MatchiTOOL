package com.matchi.tool

import android.content.Context
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore

object Prefs {
    private fun sp(c: Context) = c.getSharedPreferences("matchi", Context.MODE_PRIVATE)
    fun disabled(c: Context): Set<String> = sp(c).getStringSet("disabled", emptySet())!!.toSet()
    fun setEnabled(c: Context, name: String, enabled: Boolean) {
        val d = disabled(c).toMutableSet()
        if (enabled) d.remove(name) else d.add(name)
        sp(c).edit().putStringSet("disabled", d).apply()
    }
    fun seededVersion(c: Context): Int = sp(c).getInt("seeded", 0)
    fun setSeededVersion(c: Context, v: Int) { sp(c).edit().putInt("seeded", v).apply() }
    // ZTE web-admin access (used by the SMS / signal plugins through /api/zte)
    private val hostRx = Regex("^[A-Za-z0-9.-]{1,64}(:[0-9]{1,5})?$")
    fun zteHost(c: Context): String = sp(c).getString("zte_host", null)?.takeIf { hostRx.matches(it) } ?: "192.168.0.1"
    fun setZteHost(c: Context, h: String) {
        require(hostRx.matches(h)) { "invalid host" }
        sp(c).edit().putString("zte_host", h).apply()
    }
    private const val ZTE_PASS_ENC = "zte_pass_enc"
    private const val ZTE_PASS_LEGACY = "zte_pass"
    private const val ZTE_KEY_ALIAS = "matchitool_router_credential_v1"

    private fun credentialKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ZTE_KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder(ZTE_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build())
        return gen.generateKey()
    }

    private fun encryptCredential(value: String): String? = try {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, credentialKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)
    } catch (_: Exception) { null }

    private fun decryptCredential(value: String): String? = try {
        val all = Base64.decode(value, Base64.NO_WRAP)
        if (all.size <= 12) throw IllegalArgumentException("invalid encrypted credential")
        val iv = all.copyOfRange(0, 12)
        val encrypted = all.copyOfRange(12, all.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, credentialKey(), GCMParameterSpec(128, iv))
        String(cipher.doFinal(encrypted), Charsets.UTF_8)
    } catch (_: Exception) { null }

    /** Router credentials are encrypted with an Android Keystore AES-GCM key. Existing plaintext installs migrate on read. */
    @Synchronized fun ztePass(c: Context): String {
        val prefs = sp(c)
        prefs.getString(ZTE_PASS_ENC, null)?.let { return decryptCredential(it) ?: "" }
        val legacy = prefs.getString(ZTE_PASS_LEGACY, "") ?: ""
        if (legacy.isNotEmpty()) {
            val encrypted = encryptCredential(legacy)
            if (encrypted != null) prefs.edit().putString(ZTE_PASS_ENC, encrypted).remove(ZTE_PASS_LEGACY).apply()
        }
        return legacy
    }

    @Synchronized fun setZtePass(c: Context, p: String) {
        val prefs = sp(c)
        if (p.isEmpty()) {
            prefs.edit().remove(ZTE_PASS_ENC).remove(ZTE_PASS_LEGACY).apply()
            return
        }
        val encrypted = encryptCredential(p)
        if (encrypted != null) prefs.edit().putString(ZTE_PASS_ENC, encrypted).remove(ZTE_PASS_LEGACY).apply()
        else prefs.edit().putString(ZTE_PASS_LEGACY, p).remove(ZTE_PASS_ENC).apply()
    }
    // LAN only: the host always listens on the LAN (0.0.0.0) so the console works from the hotspot network. There is no local-only mode;
    // WebServer still refuses every non-private source address. (An old saved "lan_access" value is ignored.)
    @Suppress("UNUSED_PARAMETER")
    fun lanAccess(c: Context): Boolean = true
    // Web console password = the router's own admin password (the one for 192.168.0.1). One password is stored
    // and used both to sign in to the web console and by the SMS / signal tools to log in to the router.
    // Until one is saved (or learned from the router at first login) nobody can sign in to the web console.
    fun hasAdminPassword(c: Context): Boolean = ztePass(c).isNotEmpty()
    fun setAdminPassword(c: Context, pw: String) {
        setZtePass(c, pw)
        sp(c).edit().remove("admin_salt").remove("admin_hash").apply()   // old separate web password, no longer used
        Sessions.revokeAll(c)   // signs out existing web sessions
    }
    fun clearAdminPassword(c: Context) { setZtePass(c, ""); sp(c).edit().remove("admin_salt").remove("admin_hash").apply(); Sessions.revokeAll(c) }
    fun checkAdminPassword(c: Context, pw: String): Boolean {
        val saved = ztePass(c)
        return saved.isNotEmpty() && MessageDigest.isEqual(saved.toByteArray(Charsets.UTF_8), pw.toByteArray(Charsets.UTF_8))
    }
    const val PORT = 2334
}

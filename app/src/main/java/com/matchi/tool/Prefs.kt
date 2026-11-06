package com.matchi.tool

import android.content.Context
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

object Prefs {
    private fun sp(c: Context) = c.getSharedPreferences("matchi", Context.MODE_PRIVATE)
    fun token(c: Context): String {
        val s = sp(c)
        s.getString("token", null)?.let { return it }
        val b = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val t = b.joinToString("") { "%02x".format(it) }
        s.edit().putString("token", t).apply()
        return t
    }
    fun resetToken(c: Context) { sp(c).edit().remove("token").apply() }
    fun disabled(c: Context): Set<String> = sp(c).getStringSet("disabled", emptySet())!!.toSet()
    fun setEnabled(c: Context, name: String, enabled: Boolean) {
        val d = disabled(c).toMutableSet()
        if (enabled) d.remove(name) else d.add(name)
        sp(c).edit().putStringSet("disabled", d).apply()
    }
    fun seededVersion(c: Context): Int = sp(c).getInt("seeded", 0)
    fun setSeededVersion(c: Context, v: Int) { sp(c).edit().putInt("seeded", v).apply() }
    // ZTE web-admin access (used by the SMS / signal plugins through /api/zte)
    private val hostRx = Regex("^[A-Za-z0-9.-]{1,64}$")
    fun zteHost(c: Context): String = sp(c).getString("zte_host", null)?.takeIf { hostRx.matches(it) } ?: "192.168.0.1"
    fun setZteHost(c: Context, h: String) {
        require(hostRx.matches(h)) { "invalid host" }
        sp(c).edit().putString("zte_host", h).apply()
    }
    fun ztePass(c: Context): String = sp(c).getString("zte_pass", "") ?: ""
    fun setZtePass(c: Context, p: String) { sp(c).edit().putString("zte_pass", p).apply() }
    // Secure default: listen only on loopback. LAN access must be explicitly enabled by the user.
    fun lanAccess(c: Context): Boolean = sp(c).getBoolean("lan_access", false)
    fun setLanAccess(c: Context, enabled: Boolean) { sp(c).edit().putBoolean("lan_access", enabled).apply() }
    // Web admin password (replaces typing the random token). Stored only as a salted PBKDF2 hash.
    // Until one is set, the web login still accepts the access token.
    private const val PW_ITER = 60_000
    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
    private fun unhex(s: String) = s.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    private fun pbkdf2(pw: String, salt: ByteArray): ByteArray =
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(PBEKeySpec(pw.toCharArray(), salt, PW_ITER, 256)).encoded
    fun hasAdminPassword(c: Context): Boolean = sp(c).contains("admin_hash")
    fun setAdminPassword(c: Context, pw: String) {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        sp(c).edit().putString("admin_salt", hex(salt)).putString("admin_hash", hex(pbkdf2(pw, salt))).apply()
        resetToken(c)   // signs out existing web sessions
    }
    fun clearAdminPassword(c: Context) { sp(c).edit().remove("admin_salt").remove("admin_hash").apply(); resetToken(c) }
    fun checkAdminPassword(c: Context, pw: String): Boolean {
        val s = sp(c)
        val salt = s.getString("admin_salt", null) ?: return false
        val h = s.getString("admin_hash", null) ?: return false
        return MessageDigest.isEqual(hex(pbkdf2(pw, unhex(salt))).toByteArray(), h.toByteArray())
    }
    const val PORT = 2334
}

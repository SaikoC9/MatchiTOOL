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
    private val hostRx = Regex("^[A-Za-z0-9.-]{1,64}(:[0-9]{1,5})?$")
    fun zteHost(c: Context): String = sp(c).getString("zte_host", null)?.takeIf { hostRx.matches(it) } ?: "192.168.0.1"
    fun setZteHost(c: Context, h: String) {
        require(hostRx.matches(h)) { "invalid host" }
        sp(c).edit().putString("zte_host", h).apply()
    }
    fun ztePass(c: Context): String = sp(c).getString("zte_pass", "") ?: ""
    fun setZtePass(c: Context, p: String) { sp(c).edit().putString("zte_pass", p).apply() }
    // Default: listen on the LAN (0.0.0.0) so the console works from the hotspot network. WebServer still refuses every non-private source address.
    fun lanAccess(c: Context): Boolean = sp(c).getBoolean("lan_access", true)
    fun setLanAccess(c: Context, enabled: Boolean) { sp(c).edit().putBoolean("lan_access", enabled).apply() }
    // Web console password = the router's own admin password (the one for 192.168.0.1). One password is stored
    // and used both to sign in to the web console and by the SMS / signal tools to log in to the router.
    // Until one is saved, the web login still accepts the access token.
    fun hasAdminPassword(c: Context): Boolean = ztePass(c).isNotEmpty()
    fun setAdminPassword(c: Context, pw: String) {
        setZtePass(c, pw)
        sp(c).edit().remove("admin_salt").remove("admin_hash").apply()   // old separate web password, no longer used
        resetToken(c)   // signs out existing web sessions
    }
    fun clearAdminPassword(c: Context) { setZtePass(c, ""); sp(c).edit().remove("admin_salt").remove("admin_hash").apply(); resetToken(c) }
    fun checkAdminPassword(c: Context, pw: String): Boolean {
        val saved = ztePass(c)
        return saved.isNotEmpty() && MessageDigest.isEqual(saved.toByteArray(Charsets.UTF_8), pw.toByteArray(Charsets.UTF_8))
    }
    const val PORT = 2334
}

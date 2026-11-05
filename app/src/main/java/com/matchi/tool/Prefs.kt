package com.matchi.tool

import android.content.Context
import java.security.SecureRandom

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
    const val PORT = 2334
}

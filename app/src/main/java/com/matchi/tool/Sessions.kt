package com.matchi.tool

import android.content.Context

/** App-wide web console sessions, backed by [SessionStore] and saved (as hashes only) in the app's private preferences. */
object Sessions {
    private const val KEY = "web_sessions"
    @Volatile private var instance: SessionStore? = null

    private fun store(c: Context): SessionStore {
        instance?.let { return it }
        synchronized(this) {
            instance?.let { return it }
            val sp = c.applicationContext.getSharedPreferences("matchi", Context.MODE_PRIVATE)
            sp.edit().remove("token").apply()   // the old permanent access token is gone for good
            val s = SessionStore(persist = { sp.edit().putString(KEY, it).apply() })
            s.load(sp.getString(KEY, null))
            instance = s
            return s
        }
    }

    fun issue(c: Context): String = store(c).issue()
    fun validate(c: Context, token: String?): Boolean = store(c).validate(token)
    fun revoke(c: Context, token: String?) = store(c).revoke(token)
    fun revokeAll(c: Context) = store(c).revokeAll()
    fun revokeAllExcept(c: Context, token: String?) = store(c).revokeAllExcept(token)
}

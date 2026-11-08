package com.matchi.tool

import android.app.ActivityManager
import android.content.Context
import android.os.Build

/** Pure helpers (no Android classes, unit-tested): names of ApplicationExitInfo reasons and the log level for each. */
internal object ExitReasonModel {
    fun name(reason: Int): String = when (reason) {
        1 -> "EXIT_SELF (app called exit)"
        2 -> "SIGNAL (killed by a signal)"
        3 -> "LOW_MEMORY (killed by the system for memory)"
        4 -> "CRASH (Java exception)"
        5 -> "CRASH_NATIVE (native crash)"
        6 -> "ANR (app not responding)"
        7 -> "INITIALIZATION_FAILURE"
        8 -> "PERMISSION_CHANGE"
        9 -> "EXCESSIVE_RESOURCE_USAGE"
        10 -> "USER_REQUESTED (force-stopped / swiped away)"
        11 -> "USER_STOPPED"
        12 -> "DEPENDENCY_DIED"
        13 -> "OTHER"
        14 -> "FREEZER"
        15 -> "PACKAGE_STATE_CHANGE"
        16 -> "PACKAGE_UPDATED (app was updated)"
        else -> "UNKNOWN ($reason)"
    }

    /** ERROR for crashes/ANR, WARNING for kills that were not the person's doing, INFO for the rest (updates, user stop, normal exit). */
    fun level(reason: Int): String = when (reason) {
        4, 5, 6, 7 -> "ERROR"
        2, 3, 9, 12, 14 -> "WARNING"
        else -> "INFO"
    }

    fun describe(reason: Int, status: Int, importance: Int, description: String?, timestamp: Long): String =
        "Previous process ended: ${name(reason)}, status=$status, importance=$importance, at=$timestamp" +
            (if (description.isNullOrBlank()) "" else ", ${description.replace('\n', ' ').take(300)}")
}

/** Why did this app's process die? Android 11+ keeps the last exit reasons; each one is logged once (newest timestamp is remembered). */
object ExitReasons {
    private const val PREFS = "matchi_log_catcher"
    private const val KEY = "exit_info_last_ts"

    fun logNew(ctx: Context) {
        if (Build.VERSION.SDK_INT < 30) return
        try {
            val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val last = prefs.getLong(KEY, 0L)
            val list = am.getHistoricalProcessExitReasons(ctx.packageName, 0, 10).filter { it.timestamp > last }.sortedBy { it.timestamp }
            for (e in list) {
                LogCatcher.log(ExitReasonModel.level(e.reason), "ExitReasons",
                    ExitReasonModel.describe(e.reason, e.status, e.importance, e.description, e.timestamp))
            }
            if (list.isNotEmpty()) prefs.edit().putLong(KEY, list.last().timestamp).apply()
        } catch (e: Exception) { Quiet.note("ExitReasons.logNew", e) }
    }
}

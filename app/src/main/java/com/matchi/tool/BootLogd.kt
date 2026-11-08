package com.matchi.tool

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Installs, removes and reads the boot-time capture script (assets/bin/matchi_logd.sh). The script lives in Magisk's
 * /data/adb/service.d/ so Android's own logcat and dmesg are captured from boot into rotating files, whether or not
 * this app runs. Only the owner switches it on; one root call installs, one removes. After an app update the script
 * is written again when the shipped version is newer ([ensureCurrent]).
 */
object BootLogd {
    private const val TAG = "BootLogd"
    private const val PREFS = "matchi_log_catcher"
    private const val KEY_ENABLED = "bootlogd_enabled"
    private const val KEY_FILE_KB = "bootlogd_file_kb"
    private const val KEY_FILES = "bootlogd_files"
    private const val KEY_MIN_FREE = "bootlogd_min_free_mb"
    private const val EOF_MARK = "MATCHI_LOGD_EOF"

    fun bundledScript(ctx: Context): String = ctx.assets.open("bin/matchi_logd.sh").bufferedReader().use { it.readText() }

    fun enabled(ctx: Context): Boolean = prefs(ctx).getBoolean(KEY_ENABLED, false)

    fun config(ctx: Context): BootLogdModel.Config {
        val p = prefs(ctx)
        return BootLogdModel.Config(p.getInt(KEY_FILE_KB, 2048), p.getInt(KEY_FILES, 10), p.getInt(KEY_MIN_FREE, 200)).clamped()
    }

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Writes script + settings, stops an old copy, starts the new one and checks that a test line reaches the file. */
    fun install(ctx: Context, cfg: BootLogdModel.Config): JSONObject {
        val c = cfg.clamped()
        val script = bundledScript(ctx)
        if (script.contains(EOF_MARK) || BootLogdModel.scriptVersion(script) == null)
            return JSONObject().put("ok", false).put("error", "Bundled boot script is invalid")
        val nonce = java.lang.Long.toHexString(System.nanoTime())
        val cmd = buildString {
            append("D=${BootLogdModel.BASE_DIR}; L=${BootLogdModel.LOG_DIR}; S=${BootLogdModel.SCRIPT_PATH}\n")
            append("if [ ! -d /data/adb/magisk ] && [ ! -d /data/adb/ksu ] && [ ! -d /data/adb/ap ]; then echo 'NOTE=No Magisk folder found; the script is installed but may not start at boot'; fi\n")
            append("mkdir -p /data/adb/service.d \"\$D\" \"\$L\" || { echo 'ERROR=cannot create folders'; exit 0; }\n")
            // stop a running copy first so the new script and settings apply
            append("[ -f \"\$L/logd.pid\" ] && kill \$(cat \"\$L/logd.pid\") 2>/dev/null; sleep 1\n")
            append("cat > \"\$S.new\" <<'$EOF_MARK'\n").append(script.trimEnd('\n')).append("\n$EOF_MARK\n")
            append("chmod 755 \"\$S.new\" && chown 0:0 \"\$S.new\" 2>/dev/null; mv \"\$S.new\" \"\$S\" || { echo 'ERROR=cannot write script'; exit 0; }\n")
            append("chcon u:object_r:magisk_file:s0 \"\$S\" 2>/dev/null\n")
            append("cat > \"\$D/logd.conf\" <<'MATCHI_LOGD_CONF'\n").append(c.render()).append("MATCHI_LOGD_CONF\n")
            append("sh \"\$S\"\n")
            append("sleep 3; log -p i -t MatchiLogdTest 'selftest $nonce'; sleep 3\n")
            append("if grep -rqs 'selftest $nonce' \"\$L\"/logcat.log*; then echo SELFTEST=ok; else echo SELFTEST=failed; fi\n")
            append("echo INSTALLED=1\n")
        }
        val r = RootShell.run(ctx, cmd, 40_000)
        val out = r.content
        val ok = r.success && out.contains("INSTALLED=1")
        if (ok) prefs(ctx).edit().putBoolean(KEY_ENABLED, true).putInt(KEY_FILE_KB, c.fileKb).putInt(KEY_FILES, c.files).putInt(KEY_MIN_FREE, c.minFreeMb).apply()
        val res = JSONObject().put("ok", ok).put("selftest", out.contains("SELFTEST=ok")).put("output", out.take(600))
        LogCatcher.log(if (ok) "INFO" else "WARNING", TAG, "Boot capture install: ${if (ok) "done" else "failed"}; selftest ${if (res.getBoolean("selftest")) "ok" else "not confirmed"}")
        if (!ok) res.put("error", out.lineSequence().firstOrNull { it.startsWith("ERROR=") }?.removePrefix("ERROR=") ?: "Install failed: ${out.take(200)}")
        return res
    }

    /** Stops capture and removes the script. [purge] also deletes the captured files. */
    fun uninstall(ctx: Context, purge: Boolean): JSONObject {
        val cmd = "L=${BootLogdModel.LOG_DIR}\n[ -f \"\$L/logd.pid\" ] && kill \$(cat \"\$L/logd.pid\") 2>/dev/null\nsleep 1\n" +
            "rm -f ${BootLogdModel.SCRIPT_PATH} ${BootLogdModel.CONF_PATH}\n" +
            (if (purge) "rm -rf \"\$L\"\n" else "") + "echo REMOVED=1"
        val r = RootShell.run(ctx, cmd, 20_000)
        val ok = r.success && r.content.contains("REMOVED=1")
        if (ok) prefs(ctx).edit().putBoolean(KEY_ENABLED, false).apply()
        LogCatcher.log("INFO", TAG, "Boot capture removed (purge=$purge): $ok")
        return JSONObject().put("ok", ok).put("error", if (ok) JSONObject.NULL else r.content.take(200))
    }

    /** Installed state, running state, heartbeat, restarts and disk use, from one root call. */
    fun status(ctx: Context): JSONObject {
        val bundled = BootLogdModel.scriptVersion(bundledScript(ctx))
        val cmd = "L=${BootLogdModel.LOG_DIR}; S=${BootLogdModel.SCRIPT_PATH}\n" +
            "if [ -f \"\$S\" ]; then echo INSTALLED_SCRIPT=1; sed -n 's/^# MATCHI_LOGD_VERSION=/INSTALLED_VERSION=/p' \"\$S\" | head -n 1; fi\n" +
            "if [ -f \"\$L/logd.pid\" ] && kill -0 \$(cat \"\$L/logd.pid\") 2>/dev/null; then echo ALIVE=1; else echo ALIVE=0; fi\n" +
            "[ -f \"\$L/status\" ] && cat \"\$L/status\"\n" +
            "echo \"NOW=\$(date '+%F %T')\"\n"
        val r = RootShell.run(ctx, cmd, 15_000)
        val m = BootLogdModel.parseStatus(r.content)
        val installedVer = m["INSTALLED_VERSION"]?.toIntOrNull()
        val cfg = config(ctx)
        val j = JSONObject().put("ok", r.success).put("enabled", enabled(ctx))
            .put("installed", m["INSTALLED_SCRIPT"] == "1").put("installedVersion", installedVer ?: JSONObject.NULL)
            .put("bundledVersion", bundled ?: JSONObject.NULL).put("outdated", m["INSTALLED_SCRIPT"] == "1" && BootLogdModel.needsReinstall(installedVer, bundled))
            .put("running", m["ALIVE"] == "1").put("state", m["state"] ?: JSONObject.NULL)
            .put("heartbeat", m["heartbeat"] ?: JSONObject.NULL).put("now", m["NOW"] ?: JSONObject.NULL).put("started", m["started"] ?: JSONObject.NULL)
            .put("logcatRestarts", m["logcat_restarts"]?.toIntOrNull() ?: 0).put("dmesgRestarts", m["dmesg_restarts"]?.toIntOrNull() ?: 0)
            .put("lastRestart", m["last_restart"] ?: JSONObject.NULL)
            .put("usedKb", m["used_kb"]?.toLongOrNull() ?: 0L).put("freeMb", m["free_mb"]?.toLongOrNull() ?: JSONObject.NULL)
            .put("fileKb", cfg.fileKb).put("files", cfg.files).put("minFreeMb", cfg.minFreeMb).put("maxTotalKb", cfg.maxTotalKb())
        if (!r.success) j.put("error", r.content.take(200))
        return j
    }

    /** Capture files, newest first per source: name, size (bytes) and modified time. */
    fun files(ctx: Context): JSONObject {
        val r = RootShell.run(ctx, "cd ${BootLogdModel.LOG_DIR} 2>/dev/null && for f in *; do [ -f \"\$f\" ] && echo \"\$f \$(wc -c < \"\$f\") \$(date -r \"\$f\" '+%F_%T' 2>/dev/null)\"; done", 15_000)
        val rows = JSONArray()
        r.content.lineSequence().mapNotNull { l ->
            val p = l.trim().split(' ')
            if (p.size >= 2 && BootLogdModel.isSafeFileName(p[0])) Triple(p[0], p[1].toLongOrNull() ?: 0L, p.getOrElse(2) { "" }.replace('_', ' ')) else null
        }.sortedWith(compareBy({ it.first.substringBefore('.') }, { BootLogdModel.rotationIndex(it.first) }))
            .forEach { (n, sz, t) -> rows.put(JSONObject().put("name", n).put("size", sz).put("modified", t)) }
        return JSONObject().put("ok", r.success).put("files", rows)
    }

    /** One page of one capture file, from [start] (1-based line) or from the first line containing [from]. */
    fun page(ctx: Context, name: String, start: Int, limit: Int, from: String?): JSONObject {
        if (!BootLogdModel.isSafeFileName(name)) return JSONObject().put("ok", false).put("error", "Unknown file")
        val r = RootShell.run(ctx, BootLogdModel.pageCommand(name, start, limit, from), 20_000)
        if (r.content.trim() == "MISSING") return JSONObject().put("ok", false).put("error", "File not found")
        val p = BootLogdModel.parsePage(r.content) ?: return JSONObject().put("ok", false).put("error", "Could not read the file: ${r.content.take(150)}")
        return JSONObject().put("ok", true).put("name", name).put("total", p.total).put("start", p.start)
            .put("lines", JSONArray(p.lines)).put("end", p.start + p.lines.size - 1)
    }

    /**
     * When the owner switched capture on, make sure the script in /data/adb/service.d is the one shipped in this app.
     * Called after boot and after app updates; does nothing (and asks for no root) when capture is off.
     */
    fun ensureCurrent(ctx: Context) {
        if (!enabled(ctx)) return
        try {
            val st = status(ctx)
            val needs = !st.optBoolean("installed") || st.optBoolean("outdated") || !st.optBoolean("running")
            if (needs) {
                val r = install(ctx, config(ctx))
                LogCatcher.log("INFO", TAG, "Boot capture refreshed (installed=${st.optBoolean("installed")}, outdated=${st.optBoolean("outdated")}, running=${st.optBoolean("running")}): ok=${r.optBoolean("ok")}")
            }
        } catch (e: Exception) { LogCatcher.log("WARNING", TAG, "Boot capture check failed: ${e.message}") }
    }
}

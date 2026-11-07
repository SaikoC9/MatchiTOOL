package com.matchi.tool

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class HostService : Service() {
    @Volatile private var server: WebServer? = null
    private val initialized = AtomicBoolean(false)
    private val bootTasksRunning = AtomicBoolean(false)
    private val workers: ScheduledExecutorService by lazy { Executors.newScheduledThreadPool(2) }

    override fun onStartCommand(i: Intent?, f: Int, id: Int): Int {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel("matchi", "MatchiTOOL", NotificationManager.IMPORTANCE_MIN))
        val n = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "matchi") else Notification.Builder(this))
            .setContentTitle("MatchiTOOL running").setContentText("LAN · port ${Prefs.PORT}")
            .setSmallIcon(R.drawable.ic_stat_matchi).build()
        startForeground(1, n)

        if (initialized.compareAndSet(false, true)) {
            workers.execute { startWebHost() }
            workers.schedule({
                try { ZteClient.autoDetect(applicationContext) }
                catch (e: Exception) { Log.w("MatchiTOOL", "Router auto-detect failed: ${e.message}") }
            }, 4, TimeUnit.SECONDS)
            // Recheck the firewall after boot/network bring-up without spawning duplicate thread sets.
            for (delay in longArrayOf(3, 30, 90)) {
                workers.schedule({
                    try { HostControl.openLanFirewall(applicationContext) }
                    catch (e: Exception) { Log.w("MatchiTOOL", "LAN firewall check failed: ${e.message}") }
                }, delay, TimeUnit.SECONDS)
            }
        }
        if (i?.action == ACTION_RUN_BOOT_TASKS) runBootTasks()
        return START_STICKY
    }

    private fun startWebHost() {
        if (server != null) return
        // HTTPS first (self-signed, key kept in Android's key store); plain HTTP only if TLS cannot work on this device.
        val factory = Tls.serverFactory()
        // Some devices (seen on the ZTE F50) fail the TLS 1.3 handshake with a key-store key ("connection closed").
        // Try the default protocols first, then TLS 1.2 only, before giving up on HTTPS.
        val protocolSets: List<Array<String>?> = if (factory != null) listOf(null, arrayOf("TLSv1.2")) else emptyList()
        var protoIdx = 0
        var secure = factory != null
        var srv = newServer(factory, protocolSets.firstOrNull())
        server = srv
        for (attempt in 1..8) {
            try {
                srv.start()
                while (secure && !Tls.selfTest(Prefs.PORT)) {
                    try { srv.stop() } catch (_: Exception) {}
                    Thread.sleep(500)
                    protoIdx++
                    if (protoIdx < protocolSets.size) {
                        Log.w("MatchiTOOL", "HTTPS handshake failed; retrying with TLS 1.2 only")
                        srv = newServer(factory, protocolSets[protoIdx]); server = srv
                    } else {
                        Log.w("MatchiTOOL", "HTTPS handshake failed; restarting as plain HTTP")
                        secure = false
                        srv = newServer(null, null); server = srv
                    }
                    srv.start()
                }
                Tls.active = secure
                Log.i("MatchiTOOL", "Web host listening on port ${Prefs.PORT} (${if (secure) "https" else "http"})")
                return
            } catch (e: java.io.IOException) {
                Log.w("MatchiTOOL", "Web host start failed (attempt $attempt): ${e.message}")
                try { Thread.sleep(700) } catch (_: InterruptedException) { Thread.currentThread().interrupt(); break }
            }
        }
        try { srv.stop() } catch (_: Exception) {}
        if (server === srv) server = null
        Log.e("MatchiTOOL", "Web host did not start after retries")
        if (!workers.isShutdown) workers.schedule({ if (server == null) startWebHost() }, 15, TimeUnit.SECONDS)
    }

    private fun newServer(factory: javax.net.ssl.SSLServerSocketFactory?, protocols: Array<String>?): WebServer {
        val srv = WebServer(this, Prefs.PORT, "0.0.0.0")
        if (factory != null) srv.makeSecure(factory, protocols)
        return srv
    }

    private fun runBootTasks() {
        if (!bootTasksRunning.compareAndSet(false, true)) return
        workers.execute {
            try {
                val result = RootShell.run(this, BOOT_SCRIPT.replace('\u00a7', '$'), 60_000)
                Log.i("MatchiTOOL", "Boot tasks: ${if (result.success) "completed" else "not completed"}: ${result.content.take(1200)}")
            } catch (e: Exception) { Log.e("MatchiTOOL", "Boot tasks failed: ${e.message}") }
            finally { bootTasksRunning.set(false) }
        }
    }

    override fun onDestroy() {
        try { workers.shutdownNow() } catch (_: Exception) {}
        try { server?.stop() } catch (_: Exception) {}
        server = null
        RootShell.closeAll()
        initialized.set(false)
        super.onDestroy()
    }

    override fun onBind(i: Intent?): IBinder? = null

    companion object {
        const val ACTION_RUN_BOOT_TASKS = "com.matchi.tool.RUN_BOOT_TASKS"

        /**
         * Boot tasks run as root, so they only run from files nobody else can change: the folder, boot.sh and every
         * boot.d script must be a real file/folder (no symlink) owned by root. If group/other can write to a root-owned
         * entry, that permission is removed first. Anything else is skipped and written to events.log.
         * (\u00a7 stands for the dollar sign so this block stays readable; it is replaced before the script runs.)
         */
        private const val BOOT_SCRIPT = """
D=/data/local/matchitool
LOG=§D/events.log
note() { echo "boot: §*"; echo "§(date '+%F %T') boot: §*" >> §LOG 2>/dev/null; }
trusted() {
  [ ! -L "§1" ] || return 1
  st=§(stat -c '%u %A' "§1" 2>/dev/null) || return 1
  set -- "§1" §st
  [ "§2" = 0 ] || return 1
  case "§3" in ?????-??-?) ;; *) chmod go-w "§1" 2>/dev/null ;; esac
  return 0
}
[ -d §D ] || { echo 'No MatchiTOOL boot tasks registered'; exit 0; }
trusted §D || { note "skipped: §D is a symlink or not owned by root"; exit 0; }
if [ -f §D/boot.sh ]; then
  if trusted §D/boot.sh; then /system/bin/sh §D/boot.sh; else note "skipped boot.sh: symlink or not owned by root"; fi
else echo 'No MatchiTOOL boot tasks registered'; fi
if [ -d §D/boot.d ]; then
  if trusted §D/boot.d; then
    for f in §D/boot.d/*.sh; do
      [ -f "§f" ] || continue
      if trusted "§f"; then /system/bin/sh "§f"; else note "skipped §f: symlink or not owned by root"; fi
    done
  else note "skipped boot.d: symlink or not owned by root"; fi
fi
true
"""
    }
}

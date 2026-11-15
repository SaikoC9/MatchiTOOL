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
    @Volatile private var destroyed = false
    private val seenLanIfs = HashSet<String>()   // only touched by the single fixed-delay watcher task
    private var lanTicks = 0                      // same: only that task
    private val workers: ScheduledExecutorService by lazy { Executors.newScheduledThreadPool(4) }   // boot scripts + IMEI keeper hold two threads for up to ~3 min; the firewall check, router detection and retries must not queue behind them

    override fun onStartCommand(i: Intent?, f: Int, id: Int): Int {
        LogCatcher.initialize(applicationContext)
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel("matchi") == null) nm.createNotificationChannel(NotificationChannel("matchi", "MatchiTOOL", NotificationManager.IMPORTANCE_MIN))
        val n = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "matchi") else Notification.Builder(this))
            .setContentTitle("MatchiTOOL running").setContentText("LAN · port ${Prefs.PORT}")
            .setSmallIcon(R.drawable.ic_stat_matchi).build()
        startForeground(1, n)
        if (!DeviceGate.supported) {   // ZTE F50 only: nothing may start on another device
            LogCatcher.log("WARNING", "HostService", "Device not supported (ZTE F50 only): ${DeviceGate.describe().replace('\n', ' ')}")
            stopForeground(Service.STOP_FOREGROUND_REMOVE); stopSelf()
            return START_NOT_STICKY
        }

        if (initialized.compareAndSet(false, true)) {
            workers.execute { startWebHost() }
            // Hide the "MatchiTOOL running" notification. Android needs a notification for a foreground service, so the service keeps
            // running; the root manager is asked to stop showing this app's notifications (the same switch as Settings > Apps >
            // MatchiTOOL > Notifications). Needs root; without it nothing changes and the silent notification stays.
            // Root is often not ready right after boot, so it is tried a few times and stops after the first success.
            val notificationHidden = AtomicBoolean(false)
            for (delay in longArrayOf(6, 45, 120)) {
                workers.schedule(Runnable {
                    try {
                        if (!notificationHidden.get()) {
                            // Set it, then read it back: "yes" only when Android really reports the switch as ignore (an unknown
                            // operation name on this ROM must not count as success and stop the retries).
                            val r = RootShell.run(applicationContext, "cmd appops set $packageName POST_NOTIFICATION ignore; cmd appops get $packageName POST_NOTIFICATION", 10_000)
                            val done = r.success && r.content.contains("ignore", ignoreCase = true)
                            if (done) notificationHidden.set(true)
                            LogCatcher.log("INFO", "HostService", "Notification hidden: ${if (done) "yes" else "no (root not available, or this Android does not accept it): ${r.content.take(120)}"}")
                        }
                    } catch (e: Exception) { LogCatcher.log("WARNING", "HostService", "Hide notification failed: ${e.message}") }
                }, delay, TimeUnit.SECONDS)
            }
            // The router web API (and root) are often not ready 4 s after boot, so the password search is retried a few times;
            // each call returns at once when the password is already known or the search has ended.
            for (delay in longArrayOf(4, 30, 90, 180)) {
                workers.schedule({
                    try { ZteClient.autoDetect(applicationContext) }
                    catch (e: Exception) { LogCatcher.log("WARNING", "HostService", "Router auto-detect failed: ${e.message}") }
                }, delay, TimeUnit.SECONDS)
            }
            // Recheck the firewall after boot/network bring-up without spawning duplicate thread sets.
            for (delay in longArrayOf(3, 30, 90)) {
                workers.schedule({
                    try { HostControl.openLanFirewall(applicationContext) }
                    catch (e: Exception) { LogCatcher.log("WARNING", "HostService", "LAN firewall check failed: ${e.message}") }
                }, delay, TimeUnit.SECONDS)
            }
            // A hotspot or USB tether switched on AFTER the checks above never got its rule. Every 45 s the interface list is read
            // (no root needed) and the firewall is opened again when a new interface name shows up. As a safety net (Android may
            // hide an interface from the app) the script also runs about every 5 minutes anyway; it checks with "iptables -C"
            // first, so a repeat is harmless. workers.shutdownNow() in onDestroy() stops this timer.
            workers.scheduleWithFixedDelay({
                try {
                    lanTicks++
                    val names = HostControl.lanInterfaceNames().split(',').filter { it.isNotEmpty() }
                    val fresh = names.filter { it !in seenLanIfs }
                    seenLanIfs.retainAll(names.toSet())   // a vanished interface is forgotten, so it is opened again when it returns
                    val periodic = lanTicks % 7 == 0
                    if (fresh.isNotEmpty() || periodic) {
                        seenLanIfs.addAll(names)
                        LogCatcher.log("INFO", "HostService", "LAN firewall opened (new interfaces: ${fresh.joinToString(",").ifEmpty { "none" }}, periodic=$periodic)")
                        HostControl.openLanFirewall(applicationContext)
                    }
                } catch (e: Exception) { LogCatcher.log("WARNING", "HostService", "LAN interface watch failed: ${e.message}") }
            }, 45, 45, TimeUnit.SECONDS)
            // One-time: delete the root temp files older versions left in /data/local/tmp (they are no longer used).
            if (!Prefs.oldTmpCleaned(applicationContext)) workers.schedule({ cleanOldTmpFiles() }, 200, TimeUnit.SECONDS)   // after the boot tasks, when root slots are free
        }
        if (i?.action == ACTION_RUN_BOOT_TASKS) runBootTasks()
        // After an app update only the boot-capture script is refreshed (it asks for no root when capture is off).
        if (i?.action == ACTION_AFTER_UPDATE) workers.execute {
            try { BootLogd.ensureCurrent(this) } catch (e: Exception) { LogCatcher.log("ERROR", "HostService", "Boot capture check failed: ${e.message}") }
        }
        return START_STICKY
    }

    /**
     * Starts the console. Three things this guards against:
     * - Every start() has its own retry (the port may not be released yet), so a failing start can no longer land in a
     *   catch that restarts the whole loop with a half-stopped server object.
     * - [Tls.active] is set BEFORE a server starts listening (and again when it is replaced), so the scheme the page and
     *   the Origin check use always matches the server that is answering; it used to flip only after the self-test, so the
     *   first page loads over https were refused as "cross-origin".
     * - [destroyed] is checked between steps, so a host that was still starting when onDestroy() ran stops again instead of
     *   keeping the port bound with no service.
     */
    private fun startWebHost() {
        if (destroyed || server != null) return
        Tls.ready = false
        // HTTPS first (self-signed). Order of attempts, each checked by a real loopback handshake:
        //   1. Android key store key, TLS 1.3 + 1.2   2. key store, TLS 1.2 only
        //   3. software key (file in the app's private folder), TLS 1.3 + 1.2   4. software key, TLS 1.2 only
        //   5. plain HTTP (last resort).
        // Step 3 exists because the ZTE F50's key store breaks the handshake ("connection closed") for every protocol version.
        // Never TLS 1.0/1.1; TLS 1.3 only where this device supports it (Android 10+).
        var factory: javax.net.ssl.SSLServerSocketFactory? = null
        var protocolSets: List<Array<String>> = emptyList()
        var source = 0   // 0 = key store, 1 = software key, 2 = none (plain HTTP)
        var protoIdx = 0
        fun prepare(src: Int): Boolean {
            factory = when (src) { 0 -> Tls.serverFactory(); 1 -> Tls.softwareFactory(applicationContext); else -> null }
            val f = factory ?: return false
            val supported: Set<String> = try { (f.createServerSocket() as? javax.net.ssl.SSLServerSocket)?.use { it.supportedProtocols.toSet() } ?: emptySet() } catch (_: Exception) { emptySet() }
            val firstSet = arrayOf("TLSv1.3", "TLSv1.2").filter { it in supported }.toTypedArray()
            protocolSets = listOf(firstSet.ifEmpty { arrayOf("TLSv1.2") }, arrayOf("TLSv1.2")).distinctBy { it.joinToString() }
            protoIdx = 0
            return true
        }
        // Moves to the next attempt. Returns false when only plain HTTP is left.
        fun advance(): Boolean {
            protoIdx++
            while (true) {
                if (factory != null && protoIdx < protocolSets.size) return true
                source++
                if (source > 1) { factory = null; protocolSets = emptyList(); return false }
                LogCatcher.log("WARNING", "HostService", "HTTPS failed with the ${if (source == 1) "Android key store" else "previous"} key; trying the ${if (source == 1) "software key" else "next option"}")
                if (prepare(source)) return true
            }
        }
        // The key store was already seen to break the handshake on this device (and app version): go straight to the software
        // key instead of repeating two failed handshakes, their warnings and about a second of delay at every start.
        @Suppress("DEPRECATION")
        val appVer = try { packageManager.getPackageInfo(packageName, 0).versionCode } catch (_: Exception) { 0 }
        val skipKeyStore = appVer != 0 && Prefs.tlsKeystoreBrokenVersion(applicationContext) == appVer
        if (skipKeyStore) {
            source = 1
            if (!prepare(1)) advance()
        } else if (!prepare(0)) { source = 0; advance() }
        var secure = factory != null
        // Building the server must not be able to end this task silently: an exception here used to leave the console down for good.
        var srv = try { newServer(factory, protocolSets.getOrNull(protoIdx)) } catch (e: Exception) {
            LogCatcher.log("ERROR", "HostService", "Web host could not be created: ${e.message}")
            scheduleStartRetry()
            return
        }
        server = srv
        var ok = false
        try {
            Tls.active = secure
            ok = startWithRetry(srv)
            while (ok && secure && !destroyed && !Tls.selfTest(Prefs.PORT)) {
                stopQuietly(srv)
                try { Thread.sleep(500) } catch (_: InterruptedException) { Thread.currentThread().interrupt(); ok = false; break }
                if (advance()) {
                    LogCatcher.log("WARNING", "HostService", "HTTPS handshake failed; retrying (${if (source == 0) "key store" else "software key"}, ${protocolSets[protoIdx].joinToString("+")})")
                    srv = newServer(factory, protocolSets[protoIdx])
                } else {
                    LogCatcher.log("WARNING", "HostService", "HTTPS handshake failed with every key; restarting as plain HTTP")
                    secure = false
                    srv = newServer(null, null)
                }
                server = srv
                Tls.active = secure
                ok = startWithRetry(srv)
            }
        } catch (e: Exception) {
            LogCatcher.log("ERROR", "HostService", "Web host start failed: ${e.message}")
            ok = false
        }
        if (destroyed) {
            stopQuietly(srv)
            if (server === srv) server = null
            return
        }
        if (ok && secure && source == 1 && !skipKeyStore && appVer != 0) Prefs.setTlsKeystoreBrokenVersion(applicationContext, appVer)
        if (ok) {
            Tls.ready = true   // the scheme is final now: the home screen may show the address and open the console
            LogCatcher.log("INFO", "HostService", "Web host listening on port ${Prefs.PORT} (${if (secure) "https, ${Tls.keySource} key" else "http"})")
            return
        }
        stopQuietly(srv)
        if (server === srv) server = null
        Tls.active = false
        Tls.ready = false
        LogCatcher.log("ERROR", "HostService", "Web host did not start after retries")
        scheduleStartRetry()
    }

    /** One server's start(), retried a few times on IOException (port not yet released). False = gave up or shutting down. */
    private fun startWithRetry(srv: WebServer): Boolean {
        for (attempt in 1..8) {
            if (destroyed) return false
            try { srv.start(); return true } catch (e: java.io.IOException) {
                LogCatcher.log("WARNING", "HostService", "Web host start failed (attempt $attempt): ${e.message}")
                try { Thread.sleep(700) } catch (_: InterruptedException) { Thread.currentThread().interrupt(); return false }
            }
        }
        return false
    }

    private fun stopQuietly(srv: WebServer) { try { srv.stop() } catch (e: Exception) { Quiet.note("HostService.stopQuietly", e) } }

    private fun scheduleStartRetry() {
        if (!destroyed && !workers.isShutdown) workers.schedule({ if (server == null) startWebHost() }, 15, TimeUnit.SECONDS)
    }

    private fun newServer(factory: javax.net.ssl.SSLServerSocketFactory?, protocols: Array<String>?): WebServer {
        val srv = WebServer(this, Prefs.PORT, "0.0.0.0")
        if (factory != null) srv.makeSecure(factory, protocols)
        return srv
    }

    /** Exact names only. rm does not follow symlinks, so a planted link is removed, never its target. Retried at the next start if root was not available. */
    private fun cleanOldTmpFiles() {
        try {
            val r = RootShell.run(this, OLD_TMP_CLEANUP, 20_000)
            if (r.success) Prefs.setOldTmpCleaned(applicationContext)
            LogCatcher.log("INFO", "HostService", "Old temp files: ${if (r.success) "removed" else "not removed (root not available?)"}")
        } catch (e: Exception) { LogCatcher.log("WARNING", "HostService", "Old temp cleanup failed: ${e.message}") }
    }

    private fun runBootTasks() {
        if (!bootTasksRunning.compareAndSet(false, true)) return
        // The boot scripts (up to 170 s) and the IMEI keeper run in separate workers, so the modem is not left on the
        // factory IMEI for minutes while a slow boot script runs. The flag is released when both have finished.
        val pending = java.util.concurrent.atomic.AtomicInteger(3)
        fun finished() { if (pending.decrementAndGet() == 0) bootTasksRunning.set(false) }
        workers.execute {
            try {
                val result = RootShell.run(this, BOOT_SCRIPT.replace('\u00a7', '$'), 170_000)
                LogCatcher.log("INFO", "HostService", "Boot tasks: ${if (result.success) "completed" else "not completed"}: ${result.content.take(1200)}")
                if (!result.success) logHungBootScript()
            } catch (e: Exception) { LogCatcher.log("ERROR", "HostService", "Boot tasks failed: ${e.message}") }
            finally { finished() }
        }
        workers.execute {
            // The console promises "Saved for every boot" for a chosen IMEI: write it again if the firmware put the old one
            // back. Waits up to 60 s for the modem; does nothing when no IMEI was saved; at most 3 failed tries per slot.
            try {
                val imei = ImeiGuard.apply(this, 20, false)
                LogCatcher.log("INFO", "HostService", "IMEI keeper: ${imei.take(600)}")
            } catch (e: Exception) { LogCatcher.log("ERROR", "HostService", "IMEI keeper failed: ${e.message}") }
            finally { finished() }
        }
        // Phase 6b: a router IP change leaves a pending note; check that the router came back as wanted (own thread: it can wait up to 2 minutes).
        LanRevert.start(this, 0L)
        workers.execute {
            // Why did the app process die last time (crash, ANR, memory kill, update)? Android 11+ only.
            try { ExitReasons.logNew(this) } catch (e: Exception) { LogCatcher.log("ERROR", "HostService", "Exit reasons failed: ${e.message}") }
        }
        workers.execute {
            // Boot-time log capture: re-install the Magisk script after an app update, or start it if it is not running.
            try { BootLogd.ensureCurrent(this) } catch (e: Exception) { LogCatcher.log("ERROR", "HostService", "Boot capture check failed: ${e.message}") }
            finally { finished() }
        }
    }

    /** After a boot run that did not finish: name the script that was running (boot.current) in events.log, then remove the marker. */
    private fun logHungBootScript() {
        try {
            val r = RootShell.run(this, HUNG_RUN_NOTE.replace('\u00a7', '$'), 10_000)
            if (r.content.isNotBlank()) LogCatcher.log("WARNING", "HostService", "Boot tasks did not finish: ${r.content.take(300)}")
        } catch (e: Exception) { Quiet.note("HostService.logHungBootScript", e) }
    }

    override fun onDestroy() {
        destroyed = true   // first: a host that is still starting sees this and stops itself again
        Tls.ready = false
        try { workers.shutdownNow() } catch (e: Exception) { Quiet.note("HostService.onDestroy", e) }
        try { server?.stop() } catch (e: Exception) { Quiet.note("HostService.onDestroy", e) }
        server = null
        // Close the hotspot-side port again. Run off the main thread and wait at most 3 s, so stopping the service can never hang.
        // (If the process is killed without onDestroy the rule stays; the next start finds it with "iptables -C" and reuses it.)
        try {
            val closer = Thread { try { HostControl.closeLanFirewall(applicationContext) } catch (e: Exception) { Quiet.note("HostService.closeFirewall", e) } }
            closer.isDaemon = true; closer.start(); closer.join(3000)
        } catch (e: Exception) { Quiet.note("HostService.onDestroy", e) }
        RootShell.closeAll()
        initialized.set(false)
        super.onDestroy()
    }

    override fun onBind(i: Intent?): IBinder? = null

    companion object {
        const val ACTION_RUN_BOOT_TASKS = "com.matchi.tool.RUN_BOOT_TASKS"
        const val ACTION_AFTER_UPDATE = "com.matchi.tool.AFTER_UPDATE"

        /** Files that versions before the root-only temp folder left behind (names are fixed, nothing is matched by pattern). */
        private const val OLD_TMP_CLEANUP = "rm -rf /data/local/tmp/matchi_jobs /data/local/tmp/matchi_memory_clean\n" +
            "rm -f /data/local/tmp/mt_isms.sh /data/local/tmp/matchi_update.log /data/local/tmp/.matchi_out_prev.apk\n" +
            "rm -f /data/local/matchitool/sms_delete_debug.txt\n" +   // written by 1.2.27 builds before patched14; it lists SMS text
            "exit 0"

        /**
         * Boot tasks run as root, so they only run from files nobody else can change: the folder, boot.sh and every
         * boot.d script must be a real file/folder (no symlink) owned by root. If group/other can write to a root-owned
         * entry, that permission is removed first. Anything else is skipped and written to events.log. Each script runs
         * with its own 25 s limit (`timeout`); a timeout or a non-zero exit is written to events.log and the next script
         * still runs. The whole call may take up to 170 s (it used to be one 60 s limit for ALL scripts together, so one
         * slow script silently cancelled the rest).
         * (\u00a7 stands for the dollar sign so this block stays readable; it is replaced before the script runs.)
         */
        private const val HUNG_RUN_NOTE = """
D=/data/local/matchitool
[ ! -L §D ] && [ "§(stat -c %u §D 2>/dev/null)" = 0 ] || exit 0
S=§(cat §D/boot.current 2>/dev/null | head -c 200)
if [ -n "§S" ]; then
  echo "§(date '+%F %T') boot: run did not finish; last script running: §S" >> §D/events.log 2>/dev/null
  echo "last script running: §S"
fi
rm -f §D/boot.current 2>/dev/null
true
"""
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
# Why a path was refused, in plain words: "symlink", "owner uid N (must be root)" or "stat failed". Same checks as trusted() above.
why() {
  [ ! -L "§1" ] || { echo "symlink"; return; }
  u=§(stat -c %u "§1" 2>/dev/null) || { echo "stat failed"; return; }
  echo "owner uid §u (must be root)"
}
T=25
# One script, its own time limit: a slow or failing script is logged to events.log and the next one still runs.
runone() {
  echo "§1" > §D/boot.current 2>/dev/null   # if the whole run is killed by the outer limit, the app reads this to log which script hung
  if command -v timeout >/dev/null 2>&1; then timeout §T /system/bin/sh "§1"; rc=§?
  else
    # No timeout command on this ROM: a small watchdog stops the script after §T s, so one hanging script cannot block the rest.
    /system/bin/sh "§1" & P=§!
    ( sleep §T; kill -9 §P 2>/dev/null ) >/dev/null 2>&1 & W=§!
    wait §P; rc=§?
    kill §W 2>/dev/null
  fi
  case §rc in
    0) ;;
    124|137|143) note "§1 stopped: no answer within §{T}s (timeout), later scripts continue" ;;
    *) note "§1 exited with code §rc" ;;
  esac
}
[ -d §D ] || { echo 'No MatchiTOOL boot tasks registered'; exit 0; }
trusted §D || { note "skipped: §D: §(why §D)"; exit 0; }
rm -f §D/boot.current 2>/dev/null
if [ -f §D/boot.sh ]; then
  if trusted §D/boot.sh; then runone §D/boot.sh; else note "skipped boot.sh: §(why §D/boot.sh)"; fi
else echo 'No MatchiTOOL boot tasks registered'; fi
if [ -d §D/boot.d ]; then
  if trusted §D/boot.d; then
    for f in §D/boot.d/*.sh; do
      [ -f "§f" ] || continue
      if trusted "§f"; then runone "§f"; else note "skipped §f: §(why "§f")"; fi
    done
  else note "skipped boot.d: §(why §D/boot.d)"; fi
fi
rm -f §D/boot.current 2>/dev/null
true
"""
    }
}

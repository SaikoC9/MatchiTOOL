package com.matchi.tool

import android.content.Context
import android.os.SystemClock
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * The real [WifiAutoPort]: the link read and the state file go through the root shell, the hotspot Wi-Fi through [WifiSwitch].
 *
 * One root call per look ([refresh]) reads the USB link ([TetherState.READ_COMMAND]) and whether the state file exists, so a poll
 * costs one root command plus one router read. [link] and [hasState] return what [refresh] saw; the watcher's own order of calls
 * (hasState first, then link) therefore does not matter. Blocking: worker thread only.
 */
internal class WifiAutoPortImpl(private val ctx: Context) : WifiAutoPort {
    companion object {
        const val STATE_FILE = "/data/local/matchitool/wifi_auto_off"
        private const val SHELL_MS = 10_000L
        private const val RESCUE_MS = 45_000L
        private const val API_WAIT_MS = 20_000L
        /**
         * Runs as root. "@" stands for the dollar sign (replaced below) so the Kotlin string needs no escapes. Prints only "rescue:" lines.
         * Passphrase and name stay in shell variables: they are never printed, only their lengths.
         */
        private val RESCUE_SCRIPT = """
F=/data/misc/apexdata/com.android.wifi/WifiConfigStoreSoftAp.xml
unesc() { sed 's/&quot;/"/g;s/&apos;/'"'"'/g;s/&lt;/</g;s/&gt;/>/g;s/&amp;/\&/g'; }
getv() { sed -n "s|.*<string name=\"@1\"[^>]*>\(.*\)</string>.*|\1|p" @F | head -n 1 | unesc; }
if [ ! -r @F ]; then echo rescue:cfg=missing; exit 0; fi
SSID=@(getv SSID); [ -n "@SSID" ] || SSID=@(getv WifiSsid)
SSID=@{SSID#\"}; SSID=@{SSID%\"}
PASS=@(getv Passphrase)
ST=@(sed -n 's|.*<int name="SecurityType" value="\([0-9]*\)".*|\1|p' @F | head -n 1)
case "@ST" in 1) SEC=wpa2;; 3) SEC=wpa3;; *) SEC=wpa3_transition;; esac
echo "rescue:cfg ssidlen=@{#SSID} passlen=@{#PASS} sec=@SEC"
if [ -z "@SSID" ] || [ -z "@PASS" ]; then echo rescue:cfg=incomplete; exit 0; fi
up() { [ "@(getprop init.svc.hostapd)" = running ] && [ "@(cat /sys/class/net/wlan0/operstate 2>/dev/null)" = up ]; }
if up; then echo rescue:ap=already
else
  cmd wifi start-softap "@SSID" @SEC "@PASS" -b __BAND__ >/dev/null 2>&1
  i=0; while [ @i -lt 15 ] && ! up; do sleep 1; i=@((i+1)); done
fi
if up; then echo rescue:ap=up; else echo rescue:ap=down; fi
if ip -4 addr show br0 2>/dev/null | grep -q 192.168.0.1; then echo rescue:br0ip=present
else ip link set br0 up 2>/dev/null; ip addr add 192.168.0.1/24 dev br0 2>/dev/null; echo rescue:br0ip=added; fi
""".replace('@', '$')
        private const val READ_SCRIPT = TetherState.READ_COMMAND + "; if [ -f $STATE_FILE ]; then echo state=1; else echo state=0; fi"
    }

    @Volatile var lastLink: TetherLink? = null; private set
    @Volatile var lastWifiOn: Boolean? = null; private set
    @Volatile var lastHolds: Boolean = false; private set
    /** Why the feature cannot work right now (shown in the status line); null when nothing is wrong. */
    @Volatile var problem: String? = null; private set

    private var seenLink = TetherLink.UNKNOWN
    private var seenHolds: Boolean? = null

    /** One root look at the router. A failed read gives UNKNOWN (the watcher then changes nothing) and keeps the last known state-file answer. */
    fun refresh() {
        val r = try { RootShell.run(ctx, READ_SCRIPT, SHELL_MS) } catch (e: Exception) { ShellResult(false, "") }
        if (!r.success) { seenLink = TetherLink.UNKNOWN; seenHolds = null; lastLink = TetherLink.UNKNOWN; return }
        seenLink = TetherState.fromOutput(r.content)
        seenHolds = when (r.content.lines().map { it.trim() }.lastOrNull { it.startsWith("state=") }) { "state=1" -> true; "state=0" -> false; else -> null }
        seenHolds?.let { lastHolds = it }
        lastLink = seenLink
        if (seenLink == TetherLink.IDLE) problem = null
    }

    override fun link(): TetherLink = seenLink

    override fun wifiOn(): Boolean? = WifiSwitch.isOn(ctx).also { lastWifiOn = it }

    override fun hasState(): Boolean = seenHolds ?: lastHolds

    override fun writeState(): Boolean {
        val seen = WifiSwitch.read(ctx)
        val mode = WifiGoform.mode(seen)
        if (mode == "both" || mode == "other") {
            problem = "Wi-Fi is on both bands (or an unknown one): the router call cannot put that back, so Wi-Fi is left on"
            return false
        }
        val band = WifiGoform.bandOf(seen) ?: return false   // not readable (or already off): nothing is written
        // band is "2g" or "5g" (checked above), so it is safe inside the script. Write a temp file, then move it, so a half-written file never exists.
        val script = "mkdir -p /data/local/matchitool && printf 'band=$band\\n' > $STATE_FILE.tmp && sync && mv $STATE_FILE.tmp $STATE_FILE && sync && chmod 600 $STATE_FILE"   // sync: a power loss must not leave an empty file
        val ok = try { RootShell.run(ctx, script, SHELL_MS).success } catch (e: Exception) { false }
        if (ok) { lastHolds = true; seenHolds = true; problem = null } else log("The state file could not be written, so Wi-Fi is left on")
        return ok
    }

    override fun clearState() {
        val ok = try { RootShell.run(ctx, "rm -f $STATE_FILE $STATE_FILE.tmp", SHELL_MS).success } catch (e: Exception) { false }
        if (ok) { lastHolds = false; seenHolds = false } else log("The state file could not be removed")
    }

    override fun wifiOff(): Boolean = WifiSwitch.off(ctx).also { if (it) lastWifiOn = false }

    override fun wifiOnAgain(): Boolean {
        val r = try { RootShell.run(ctx, "cat $STATE_FILE 2>/dev/null", SHELL_MS) } catch (e: Exception) { ShellResult(false, "") }
        if (!r.success) return false   // the band cannot be read: do not guess while root is unavailable, the next try reads it again
        val band = WifiGoform.parseState(r.content) ?: run {
            log("The state file does not name a band; turning Wi-Fi on at 2.4 GHz")
            WifiGoform.BAND_24
        }
        return WifiSwitch.on(ctx, band).also { if (it) lastWifiOn = true }
    }

    /**
     * Root fallback for "the router API is unreachable" (no 192.168.0.1 after a boot with the data link out). Three steps:
     *  1. [RESCUE_SCRIPT] starts the hotspot with "cmd wifi start-softap" from the stored hotspot config (name, security, passphrase are read
     *     inside the root shell and never leave it; only lengths are printed) and puts 192.168.0.1 back on br0 if it is missing.
     *  2. Wait for the router API to answer.
     *  3. Restore the stock config through the API (off, then on): the root start is 5 GHz or 2.4 GHz only and shuts itself off after 10 min idle.
     * The answer of "cmd wifi" is not trusted; the script reads hostapd and wlan0 back. True only when the API says Wi-Fi is on again.
     */
    override fun wifiRescue(): Boolean {
        val r = try { RootShell.run(ctx, "cat $STATE_FILE 2>/dev/null", SHELL_MS) } catch (e: Exception) { ShellResult(false, "") }
        if (!r.success) return false   // band unreadable while root is unavailable: try again later
        val band = WifiGoform.parseState(r.content) ?: WifiGoform.BAND_24
        val script = RESCUE_SCRIPT.replace("__BAND__", if (band == WifiGoform.BAND_5) "5" else "2")   // fixed values only, nothing from outside enters the script
        val out = try { RootShell.run(ctx, script, RESCUE_MS) } catch (e: Exception) { ShellResult(false, "") }
        val lines = out.content.lines().map { it.trim() }.filter { it.startsWith("rescue:") }   // only our own lines (no secrets in them)
        log("Root fallback: " + (if (lines.isEmpty()) "no answer" else lines.joinToString("; ") { it.removePrefix("rescue:") }))
        if (lines.none { it == "rescue:ap=up" }) return false
        var seen: WifiGoform.Seen? = null
        val end = System.currentTimeMillis() + API_WAIT_MS
        while (seen == null && System.currentTimeMillis() < end) {
            seen = WifiSwitch.read(ctx)
            if (seen == null) try { Thread.sleep(2_000L) } catch (_: InterruptedException) { Thread.currentThread().interrupt(); return false }
        }
        if (seen == null) { log("Root fallback: Wi-Fi is up but the router API still does not answer"); return false }
        // Stock config back: off, then on. If "off" works and "on" does not, the file stays and the normal turn-on takes over (the API is readable now).
        if (WifiSwitch.isOn(ctx) == true && !WifiSwitch.off(ctx)) { log("Root fallback: Wi-Fi is on (root start), stock config not restored"); return true }
        val ok = WifiSwitch.on(ctx, band)
        if (ok) lastWifiOn = true
        return ok
    }

    override fun log(message: String) { LogCatcher.log("WARNING", "WifiAuto", message); WifiAutoTrace.note(ctx, message) }
}

/**
 * Runs the watcher every [POLL_MS] while the switch is on. The loop lives on its own thread: a Wi-Fi change waits for the router's
 * read-back for up to 15 s and up to three tries, and that must never hold up the host's shared workers.
 *
 * - [sync] is called at every host start and after the switch is changed. It starts the loop when none runs.
 * - With the switch ON the loop runs until [shutdown]. With the switch OFF it runs only as long as the state file exists
 *   (rule R7: Wi-Fi is turned back on first), then it stops by itself. So with the switch off and nothing to undo, nothing runs after
 *   the first look.
 * - [shutdown] (service stops) leaves the state file alone: the next start reads it and the rules carry on.
 */
object WifiAutoLoop {
    private const val POLL_MS = 3_000L
    private const val FIRST_MS = 5_000L

    private class Seen(val link: TetherLink?, val wifiOn: Boolean?, val holds: Boolean, val problem: String?)

    private var exec: ScheduledExecutorService? = null
    private var port: WifiAutoPortImpl? = null
    private var watcher: WifiAutoWatcher? = null
    @Volatile private var enabled = false
    @Volatile private var appCtx: Context? = null
    @Volatile private var seen: Seen? = null
    private var lastTrace = ""

    /** What the Network window shows. */
    class Status(val enabled: Boolean, val passwordSaved: Boolean, val running: Boolean, val line: String)

    @Synchronized fun sync(ctx: Context) {
        val c = ctx.applicationContext
        appCtx = c
        enabled = Prefs.wifiAutoTether(c)
        if (exec != null) return   // already running: it reads `enabled` on every look
        val p = WifiAutoPortImpl(c)
        port = p
        watcher = WifiAutoWatcher(p, WifiAutoRules())
        seen = null
        val e = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "MatchiWifiAuto").apply { isDaemon = true } }
        exec = e
        e.scheduleWithFixedDelay({ tickSafely() }, FIRST_MS, POLL_MS, TimeUnit.MILLISECONDS)
    }

    /** The service stops: the loop ends, the state file stays. */
    @Synchronized fun shutdown() {
        try { exec?.shutdownNow() } catch (e: Exception) { Quiet.note("WifiAutoLoop.shutdown", e) }
        exec = null; port = null; watcher = null; seen = null
    }

    @Synchronized private fun stopIfIdle() {
        if (enabled) return   // the switch was turned on again while this look ran
        try { exec?.shutdown() } catch (e: Exception) { Quiet.note("WifiAutoLoop.stopIfIdle", e) }
        exec = null; port = null; watcher = null
    }

    private fun tickSafely() {
        try { tick() } catch (e: Exception) { LogCatcher.log("WARNING", "WifiAuto", "Look failed: ${e.javaClass.simpleName}: ${e.message}") }
    }

    private fun tick() {
        val c = appCtx ?: return
        val p = port ?: return
        val w = watcher ?: return
        val on = enabled
        if (!WifiSwitch.ready(c)) {   // the router calls cannot sign in: look at nothing, ask for nothing
            seen = Seen(null, null, p.lastHolds, null)
            if (!on) {
                p.refresh()   // one root look, so the file check below is real
                if (p.lastHolds) LogCatcher.log("WARNING", "WifiAuto", "Switch is off and Wi-Fi may still be off from us, but the router password is not saved, so Wi-Fi cannot be turned back on")
                stopIfIdle()
            }
            return
        }
        p.refresh()
        val now = SystemClock.elapsedRealtime()
        val action = w.tick(now, now, on)
        if (action != WifiAutoAction.NONE) LogCatcher.log("INFO", "WifiAuto", "Action: $action (link=${p.lastLink}, wifiOn=${p.lastWifiOn})")
        // File trace (survives a router restart): one line when anything the watcher sees changes, and one per action.
        val sig = "link=${p.lastLink} wifiOn=${p.lastWifiOn} holds=${p.lastHolds} switch=$on"
        if (action != WifiAutoAction.NONE || sig != lastTrace) { lastTrace = sig; WifiAutoTrace.note(c, "$sig action=$action") }
        seen = Seen(p.lastLink, p.lastWifiOn, p.lastHolds, p.problem)
        if (!on && !p.hasState()) stopIfIdle()
    }

    /** For the status route. Reads no router and no root: it shows what the last look saw. */
    fun status(ctx: Context): Status {
        val c = ctx.applicationContext
        val on = Prefs.wifiAutoTether(c)
        val ready = WifiSwitch.ready(c)
        val s = seen
        val running = synchronized(this) { exec != null }
        val line = WifiAutoStatus.line(on, ready, s?.link, s?.wifiOn, s?.holds ?: false, SystemClock.elapsedRealtime(), s?.problem)
        return Status(on, ready, running, line)
    }
}

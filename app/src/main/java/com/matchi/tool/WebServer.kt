package com.matchi.tool

import android.content.Context
import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.StringReader
import org.xmlpull.v1.XmlPullParser
import android.util.Xml
import java.security.MessageDigest

class WebServer(private val ctx: Context, port: Int, bindAddress: String = "127.0.0.1") : NanoHTTPD(bindAddress, port) {
    private val pluginDir = File(ctx.filesDir, "plugins").apply { mkdirs() }
    private val nameRx = Regex("^[A-Za-z0-9._-]{1,80}\\.js$")

    // Brute-force protection: after MAX_FAILS bad tokens an IP is locked out for LOCK_MS.
    private val fails = HashMap<String, Pair<Int, Long>>()
    private val MAX_FAILS = 8
    private val LOCK_MS = 60_000L

    init { seedPlugins(); ApkUpdater.cleanStale(ctx) }

    /**
     * Prepare the plugin folder (custom plugins only) and the bundled sendat binary. The six tools
     * (Bypass, Device Status, AT & Radio, SMS, Signal Info, Live Status, Memory Cleaner) are part of the web page itself (web/index.html).
     */
    private fun seedPlugins() {
        @Suppress("DEPRECATION")
        val ver = ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionCode
        val refresh = Prefs.seededVersion(ctx) != ver
        // sendat (from UFI-TOOLS, MIT) talks to the modem for AT commands. It is a native binary, so it stays in the APK.
        val sendat = File(ctx.filesDir, "sendat")
        if (refresh || !sendat.exists()) ctx.assets.open("bin/sendat").use { i -> sendat.outputStream().use { i.copyTo(it) } }
        sendat.setExecutable(true, false)
        if (refresh) Prefs.setSeededVersion(ctx, ver)
    }

    private fun authed(s: IHTTPSession): Boolean {
        val given = s.headers["x-token"] ?: return false
        return MessageDigest.isEqual(given.toByteArray(), Prefs.token(ctx).toByteArray())
    }


    private fun locked(ip: String): Boolean = synchronized(fails) {
        val f = fails[ip] ?: return false
        if (System.currentTimeMillis() - f.second > LOCK_MS) { fails.remove(ip); return false }
        f.first >= MAX_FAILS
    }
    private fun fail(ip: String) = synchronized(fails) {
        val now = System.currentTimeMillis()
        val f = fails[ip]
        fails[ip] = if (f == null || now - f.second > LOCK_MS) Pair(1, now) else Pair(f.first + 1, now)
    }
    private fun failCount(ip: String): Int = synchronized(fails) { fails[ip]?.first ?: 0 }
    private fun ok(ip: String) = synchronized(fails) { fails.remove(ip) }

    private val tooMany = object : Response.IStatus {
        override fun getRequestStatus() = 429
        override fun getDescription() = "429 Too Many Requests"
    }

    private fun json(code: Response.IStatus, o: Any) =
        newFixedLengthResponse(code, "application/json", o.toString()).also { it.addHeader("Cache-Control", "no-store") }

    private fun body(s: IHTTPSession): JSONObject {
        val b = HashMap<String, String>(); s.parseBody(b)
        return JSONObject(b["postData"] ?: "{}")
    }

    // The page is read once and answered from memory. NanoHTTPD gzips text/* itself when the browser accepts it,
    // so it is NOT compressed here (that would be compressed twice). ETag makes a reload a 304.
    private val pageBytes: ByteArray by lazy { ctx.assets.open("web/index.html").use { it.readBytes() } }
    private val pageTag by lazy { "\"" + MessageDigest.getInstance("SHA-256").digest(pageBytes).take(8).joinToString("") { "%02x".format(it) } + "\"" }

    private fun servePage(s: IHTTPSession): Response {
        if (s.headers["if-none-match"] == pageTag)
            return newFixedLengthResponse(Response.Status.NOT_MODIFIED, "text/html", "").also { it.addHeader("ETag", pageTag) }
        return newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", ByteArrayInputStream(pageBytes), pageBytes.size.toLong()).also {
            it.addHeader("ETag", pageTag)
            it.addHeader("Cache-Control", "no-cache")
        }
    }

    override fun serve(s: IHTTPSession): Response {
        val uri = s.uri
        if (uri == "/" || uri == "/index.html") {
            return servePage(s)
        }
        if (!uri.startsWith("/api/")) return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "404")

        val ip = s.remoteIpAddress ?: "?"
        // Only this device and clients on the ZTE's own hotspot / USB-tether network may use the API; clients arriving from
        // another Wi-Fi, mobile data or the internet are rejected even if the port is reachable.
        if (!HostControl.isHotspotClient(ctx, ip)) return json(Response.Status.FORBIDDEN, JSONObject().put("error", "ZTE hotspot network access only"))
        // Only password/token guesses at /api/login count toward the lockout. A browser tab still holding an old
        // session token (after the password or token changed) used to rack up failures by polling, which then
        // locked the real login out ("Too many attempts"). Session tokens are 96-bit random, so they need no lockout.
        if (uri == "/api/login" && s.method == Method.POST) {
            if (locked(ip)) return json(tooMany, JSONObject().put("error", "too many bad attempts, wait a minute"))
            return login(ip, s)
        }
        if (!authed(s)) return json(Response.Status.UNAUTHORIZED, JSONObject().put("error", "Session expired or invalid - log in again"))

        return try { route(s, uri) } catch (e: Exception) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("error", e.message ?: "bad request"))
        }
    }


    /** Password login: returns the session token. Bad attempts count toward the per-IP lockout. */
    private fun login(ip: String, s: IHTTPSession): Response {
        val pw = try { body(s).optString("password").take(200) } catch (e: Exception) {
            return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "bad request"))
        }
        var good = if (Prefs.hasAdminPassword(ctx)) Prefs.checkAdminPassword(ctx, pw)
                   else MessageDigest.isEqual(pw.toByteArray(), Prefs.token(ctx).toByteArray())   // no password learned yet: token works
        // The web console accepts the router's own admin password: if it is not what is stored (nothing stored yet,
        // or the router password was changed), ask the router. When it accepts, remember it for the SMS / signal tools.
        // Skipped after 3 bad tries from this address so the router's own login lockout is not triggered.
        if (!good && pw.isNotEmpty() && failCount(ip) < 3 && ZteClient.verify(ctx, pw) == true) {
            Prefs.setZtePass(ctx, pw)
            good = true
        }
        if (!good) { fail(ip); return json(Response.Status.UNAUTHORIZED, JSONObject().put("error", "Wrong password")) }
        ok(ip)
        return json(Response.Status.OK, JSONObject().put("ok", true).put("token", Prefs.token(ctx)))
    }

    /** Read-only diagnostics: no modem settings or partitions are modified. */
    private fun diagnostics(): Response {
        val script = """
            echo '--- identity ---'; id
            echo '--- platform ---'; getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release; getprop ro.build.version.sdk
            echo '--- kernel ---'; uname -a
            echo '--- architecture ---'; getprop ro.product.cpu.abi; getprop ro.product.cpu.abilist
            echo '--- network ---'; ip -brief address 2>/dev/null || ip addr 2>/dev/null | head -80
            echo '--- routes (main table) ---'; ip route 2>/dev/null; ip -6 route 2>/dev/null
            echo '--- policy routing rules ---'; ip rule 2>/dev/null | head -30
            echo '--- default routes in all tables ---'; ip route show table all 2>/dev/null | grep '^default' | head -10; echo '(empty = no default route in any table)'
            echo '--- dns ---'; getprop 2>/dev/null | grep -iE 'dns[0-9]' | head -8
            echo '--- tool availability ---'
            for x in busybox ip nft iptables ip6tables tc bpftool; do p=$(command -v "${'$'}x" 2>/dev/null); echo "${'$'}x: ${'$'}{p:-unavailable}"; done
            [ -x "${ctx.filesDir.absolutePath}/sendat" ] && echo "sendat: ${ctx.filesDir.absolutePath}/sendat" || echo "sendat: unavailable"
            [ -x /data/local/matchitool/dpi/nfqws ] && echo "nfqws: /data/local/matchitool/dpi/nfqws" || echo "nfqws: not installed (optional)"
            echo '--- root capabilities ---'; [ "$(id -u)" = 0 ] && echo 'UID 0 confirmed' || echo 'root unavailable'
            echo '--- storage ---'; df -h /data 2>/dev/null; echo '(the mount point shown can be a bind mount such as Android/obb; it is the same /data partition)'; grep ' /data ' /proc/mounts | head -1 | cut -d' ' -f1-3
        """.trimIndent()
        val r = RootShell.run(ctx, script, 30_000)
        return json(Response.Status.OK, JSONObject().put("success", r.success).put("report", r.content).put("generatedAt", System.currentTimeMillis()))
    }

    /** Inspect XML/scatter text only. This endpoint never writes or flashes a device. */
    private fun inspectFirmware(req: JSONObject): Response {
        val name = req.optString("name").take(160)
        val content = req.optString("content")
        if (content.isBlank() || content.length > 2_000_000) throw IllegalArgumentException("Firmware manifest must be 1 byte to 2 MB")
        val lower = content.lowercase()
        val format = when {
            lower.contains("<?xml") || lower.contains("<partition") || lower.contains("<program") -> "xml"
            lower.contains("partition_name:") || lower.contains("- partition_index:") -> "scatter"
            else -> "text/unknown"
        }
        val labels = Regex("""(?im)^\s*(?:<partition[^>]*name=|partition_name\s*:\s*)(?:"([^"]+)"|'([^']+)'|([^\s>]+))""")
        val partitions = linkedSetOf<String>()
        labels.findAll(content).forEach { m -> (1..3).firstNotNullOfOrNull { m.groups[it]?.value }?.let { partitions.add(it) } }
        val sha = MessageDigest.getInstance("SHA-256").digest(content.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
        val device = JSONObject()
        val checks = JSONArray()
        val warnings = JSONArray()
        val manifestModels = Regex("""(?im)(?:product|model|project|platform|target)[_\s:=<>\"']+([A-Za-z0-9._-]{2,80})""")
            .findAll(content).map { it.groupValues[1] }.distinct().take(30).toList()
        val manifestPartitions = partitions.toList()
        val risky = manifestPartitions.filter { it.lowercase() in setOf("preloader", "xbl", "abl", "boot", "vendor_boot", "vbmeta", "super", "modem", "persist", "userdata") }
        if (format == "text/unknown") warnings.put("Unrecognized manifest format; no compatibility conclusion can be made")
        if (format == "xml") {
            try {
                val parser = Xml.newPullParser()
                parser.setInput(StringReader(content))
                while (parser.next() != XmlPullParser.END_DOCUMENT) { /* well-formedness check only */ }
                checks.put(JSONObject().put("check", "XML well-formedness").put("status", "valid"))
            } catch (e: Exception) {
                checks.put(JSONObject().put("check", "XML well-formedness").put("status", "invalid"))
                warnings.put("XML parser rejected this manifest: ${e.message ?: "parse error"}")
            }
        }
        if (manifestPartitions.isEmpty()) warnings.put("No partition names were recognized")
        if (risky.isNotEmpty()) warnings.put("Manifest includes boot-critical or device-specific partitions: ${risky.joinToString(", ")}")
        checks.put(JSONObject().put("check", "manifest format").put("status", if (format == "xml" || format == "scatter") "recognized" else "unknown"))
        checks.put(JSONObject().put("check", "partition metadata").put("status", if (manifestPartitions.isNotEmpty()) "found" else "not found"))
        checks.put(JSONObject().put("check", "device identity").put("status", "not verified").put("detail", "Manifest model labels are hints only; exact hardware and build compatibility requires a trusted device-specific source"))
        val summary = JSONObject().put("fileName", name).put("format", format).put("sizeBytes", content.toByteArray(Charsets.UTF_8).size)
            .put("sha256", sha).put("partitionCount", partitions.size).put("partitions", JSONArray(partitions.take(250)))
            .put("manifestModelHints", JSONArray(manifestModels)).put("criticalPartitionHints", JSONArray(risky))
            .put("checks", checks).put("warnings", warnings).put("flashPerformed", false)
            .put("warning", "This is a static manifest preflight, not proof of compatibility. Never flash based only on filename, model hints, or partition names.")
        return json(Response.Status.OK, summary)
    }

    /** USB controls expose Android gadget modes; support is confirmed from live USB properties/sysfs. */
    private fun usbStatus(): Response {
        val script = """
            echo "ADB=$(settings get global adb_enabled 2>/dev/null | tr -d '\r')"
            echo "CONFIG=$(getprop sys.usb.config | tr -d '\r')"
            echo "STATE=$(getprop sys.usb.state | tr -d '\r')"
            echo "PERSIST=$(getprop persist.sys.usb.config | tr -d '\r')"
            echo "RNDIS_SUPPORTED=$(for f in /config/usb_gadget/*/functions/rndis.* /sys/kernel/config/usb_gadget/*/functions/rndis.*; do [ -e "${'$'}f" ] && { echo 1; exit; }; done; case "$(getprop sys.usb.config),$(getprop sys.usb.state)" in *rndis*) echo 1;; *) echo 0;; esac)"
            echo "ECM_SUPPORTED=$(for f in /config/usb_gadget/*/functions/ecm.* /sys/kernel/config/usb_gadget/*/functions/ecm.* /config/usb_gadget/*/functions/cdc_ecm.* /sys/kernel/config/usb_gadget/*/functions/cdc_ecm.*; do [ -e "${'$'}f" ] && { echo 1; exit; }; done; case "$(getprop sys.usb.config),$(getprop sys.usb.state)" in *ecm*) echo 1;; *) echo 0;; esac)"
            echo "NETIFS=$(ip -o link show 2>/dev/null | sed 's/: .*//' | tr '\n' ' ')"
        """.trimIndent()
        val r = RootShell.run(ctx, script, 15_000)
        val lines = r.content.lines().mapNotNull { line ->
            val i = line.indexOf('='); if (i > 0) line.substring(0, i) to line.substring(i + 1).trim() else null
        }.toMap()
        val adb = lines["ADB"] == "1"
        val config = lines["CONFIG"].orEmpty()
        val state = lines["STATE"].orEmpty()
        val active = "$config,$state"
        val rndis = active.contains("rndis", true)
        val ecm = active.contains("ecm", true)
        return json(Response.Status.OK, JSONObject().put("success", r.success).put("adbEnabled", adb)
            .put("usbConfig", config).put("usbState", state).put("persistConfig", lines["PERSIST"].orEmpty())
            .put("rndisActive", rndis).put("ecmActive", ecm).put("usbTethering", rndis || ecm)
            .put("rndisSupported", lines["RNDIS_SUPPORTED"] == "1").put("ecmSupported", lines["ECM_SUPPORTED"] == "1")
            .put("networkInterfaces", lines["NETIFS"].orEmpty()).put("detail", r.content))
    }

    // Shell snippets are written with § in place of $ so Kotlin does not treat shell variables as templates.
    private val USB_UNBRIDGE = "for IF in usb0 rndis0 ecm0 ncm0; do ip link set \"§IF\" nomaster 2>/dev/null; done; ".replace('§', '$')

    /** Switch the USB gadget function the way this ZTE/Unisoc build expects (via init's sys.usb.config triggers;
     *  `svc usb setFunctions` gets SIGKILLed on the F50), verify it in configfs, then bring the new USB network
     *  interface up and bridge it into br0 (the hotspot LAN) so a PC on the cable gets DHCP/NAT. */
    private fun usbEnableScript(fn: String): String = """
        has() { ls -l /config/usb_gadget/*/configs/*/ 2>/dev/null | grep -qi "§1"; }
        ADB="§(settings get global adb_enabled 2>/dev/null | tr -d '\r')"
        if [ "§ADB" = 1 ]; then CANDS="$fn,mtp,adb $fn,adb"; else CANDS="$fn,mtp $fn"; fi
        echo "Before: sys.usb.config=§(getprop sys.usb.config)"
        OK=0
        for C in §CANDS; do
          echo "Trying sys.usb.config=§C"
          setprop sys.usb.config "§C"
          sleep 3
          if has $fn; then OK=1; echo "Active with §C"; break; fi
        done
        if [ §OK = 0 ]; then
          echo "init did not apply it; trying svc (10 s limit)"
          # svc accepts ONE function only (no ",adb", no "ecm"); anything else makes it crash with IllegalArgumentException
          case "$fn" in
            rndis) timeout 10 svc usb setFunctions rndis 2>&1; sleep 3; has $fn && OK=1 ;;
            *) echo "svc cannot set $fn (not an Android USB function), skipped" ;;
          esac
        fi
        for IF in usb0 rndis0 ecm0 ncm0; do
          if ip link show "§IF" >/dev/null 2>&1; then
            ip link set "§IF" up 2>&1
            ip link set "§IF" master br0 2>&1 && echo "bridged §IF into br0"
          fi
        done
        echo "--- gadget ---"
        echo "config=§(getprop sys.usb.config) state=§(getprop sys.usb.state)"
        ls -l /config/usb_gadget/*/configs/*/ 2>&1 | grep -- '->'
        ls /config/usb_gadget/*/functions 2>&1
        ip -o link show 2>/dev/null | grep -E 'usb|rndis|ecm|ncm|br0' || true
        if [ §OK = 0 ]; then echo "USB function $fn is not active"; exit 3; fi
    """.trimIndent().replace('§', '$')

    /** Back to the saved default mode without rndis / ecm, keeping adb if it is on. Applied through init (sys.usb.config)
     *  like the enable path; `svc usb setFunctions` is only a fallback and only ever gets ONE plain function, because
     *  "mtp,adb" or "ecm" make it throw IllegalArgumentException (that was the crash seen in the logcat). */
    private val USB_RESTORE = """
        BASE="§(getprop persist.sys.usb.config)"; [ -n "§BASE" ] || BASE=mtp
        BASE="§(printf '%s' "§BASE" | sed 's/\(^\|,\)rndis\($\|,\)/\1/g; s/\(^\|,\)ecm\($\|,\)/\1/g; s/\(^\|,\)cdc_ecm\($\|,\)/\1/g; s/,,*/,/g; s/^,//; s/,$//')"
        [ -n "§BASE" ] || BASE=mtp
        if [ "§(settings get global adb_enabled 2>/dev/null | tr -d '\r')" = 1 ]; then case ",§BASE," in *,adb,*) ;; *) BASE="§BASE,adb" ;; esac; fi
        echo "Restoring sys.usb.config=§BASE"
        setprop sys.usb.config "§BASE"
        sleep 3
        if [ "§(getprop sys.usb.config)" != "§BASE" ]; then
          S="§(printf '%s' "§BASE" | tr ',' '\n' | grep -vx adb | head -n 1)"
          case "§S" in
            mtp|ptp|midi|ncm) echo "init did not apply it; trying svc usb setFunctions §S"; timeout 10 svc usb setFunctions "§S" 2>&1; sleep 2 ;;
            *) echo "svc fallback skipped (§S is not a single Android USB function)" ;;
          esac
        fi
        echo "config=§(getprop sys.usb.config) state=§(getprop sys.usb.state)"
        [ -n "§(getprop sys.usb.config)" ]
    """.trimIndent().replace('§', '$')

    private fun controlUsb(req: JSONObject): Response {
        val action = req.optString("action")
        val restoreDefault = USB_RESTORE
        val script = when (action) {
            "adb_enable" -> "settings put global adb_enabled 1 && [ \"$(settings get global adb_enabled)\" = 1 ]"
            "adb_disable" -> "settings put global adb_enabled 0 && [ \"$(settings get global adb_enabled)\" = 0 ]"
            "rndis_enable" -> usbEnableScript("rndis")
            "ecm_enable" -> usbEnableScript("ecm")
            "tether_disable" -> USB_UNBRIDGE + restoreDefault
            else -> throw IllegalArgumentException("unsupported USB action")
        }
        // On failure, append the exit code and USB-related props so the UI can show why it failed.
        val wrapped = "{ $script\n}\nrc=${'$'}?\nif [ ${'$'}rc -ne 0 ]; then echo \"[exit code ${'$'}rc]\"; command -v svc || echo 'svc: not found'; getprop | grep -i usb | head -20; fi\nexit ${'$'}rc"
        val r = RootShell.run(ctx, wrapped, 40_000)
        // Always HTTP 200: the web UI only shows `output` when the response is not an HTTP error.
        return json(Response.Status.OK,
            JSONObject().put("success", r.success).put("action", action).put("output", r.content.ifBlank { "Command failed with no output" })
                .put("note", "USB gadget mode is firmware-dependent. Re-read USB status after switching; reconnect the cable if Android does not re-enumerate the USB device."))
    }

    /** The next JPEG frame newer than ?since= (waits up to 3.5 s; 204 = screen unchanged). Real screen size goes back in X-Screen-W / X-Screen-H. */
    private fun screenFrame(s: IHTTPSession): Response {
        val scale = s.parameters["scale"]?.firstOrNull()?.toIntOrNull() ?: 50
        val quality = s.parameters["q"]?.firstOrNull()?.toIntOrNull() ?: 60
        val since = s.parameters["since"]?.firstOrNull()?.toLongOrNull() ?: 0L
        return try {
            val shot = ScreenStreamer.next(ctx, since, scale, quality, 3_500L)
            if (shot == null) {
                newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", "").also { it.addHeader("Cache-Control", "no-store") }
            } else {
                val f = shot.frame
                newFixedLengthResponse(Response.Status.OK, "image/jpeg", ByteArrayInputStream(f.jpeg), f.jpeg.size.toLong()).also {
                    it.addHeader("Cache-Control", "no-store")
                    it.addHeader("X-Screen-W", f.width.toString())
                    it.addHeader("X-Screen-H", f.height.toString())
                    it.addHeader("X-Frame-Seq", shot.seq.toString())
                    it.addHeader("X-Capture-Mode", ScreenStreamer.modeName())
                }
            }
        } catch (e: Exception) {
            json(Response.Status.INTERNAL_ERROR, JSONObject().put("error", e.message ?: "screen capture failed"))
        }
    }

    /** Inject a tap / swipe / key / text event: {"type":"tap","x":100,"y":200}. */
    private fun screenInput(req: JSONObject): Response {
        val r = ScreenCapture.input(ctx, req)
        return json(Response.Status.OK, JSONObject().put("success", r.success).put("output", r.content))
    }

    /** Multipart upload (field "apk"): saved to a temp file by NanoHTTPD, then size-capped, parsed and verified by ApkUpdater. */
    private fun updateStage(s: IHTTPSession): Response {
        val len = s.headers["content-length"]?.toLongOrNull() ?: -1L
        if (len < 0 || len > ApkUpdater.MAX_BYTES + 1_000_000L)
            throw IllegalArgumentException("Upload must be at most ${ApkUpdater.MAX_BYTES / 1024 / 1024} MB")
        val files = HashMap<String, String>()
        s.parseBody(files)
        val tmp = files["apk"]?.let { File(it) } ?: throw IllegalArgumentException("No file received (multipart field \"apk\")")
        val staged = try { ApkUpdater.stageFile(ctx, tmp) } finally { try { tmp.delete() } catch (_: Exception) {} }
        return json(Response.Status.OK, JSONObject().put("ok", true)
            .put("oldName", staged.oldName).put("oldCode", staged.oldCode)
            .put("newName", staged.newName).put("newCode", staged.newCode)
            .put("size", staged.size).put("sha256", staged.sha256))
    }

    private fun updateInstall(req: JSONObject): Response {
        ApkUpdater.installStaged(ctx, req.optString("sha256"))
        return json(Response.Status.OK, JSONObject().put("ok", true).put("note", "Installing. The host restarts in a few seconds; reload the page when it comes back."))
    }

    @Suppress("DEPRECATION")
    private fun updateStatus(s: IHTTPSession): Response {
        val ver = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        return json(Response.Status.OK, JSONObject().put("version", ver.versionName ?: "").put("code", ver.versionCode)
            .also { if (s.parameters["log"]?.firstOrNull() == "1") it.put("log", ApkUpdater.lastLog(ctx)) })
    }

    private fun route(s: IHTTPSession, uri: String): Response = when {
        uri == "/api/ping" -> json(Response.Status.OK, JSONObject().put("ok", true).put("version", "1.1.45"))
        uri == "/api/diagnostics" && s.method == Method.GET -> diagnostics()
        uri == "/api/screen/frame" && s.method == Method.GET -> screenFrame(s)
        uri == "/api/screen/input" && s.method == Method.POST -> screenInput(body(s))
        uri == "/api/usb/status" && s.method == Method.GET -> usbStatus()
        uri == "/api/usb/control" && s.method == Method.POST -> controlUsb(body(s))
        uri == "/api/firmware/inspect" && s.method == Method.POST -> inspectFirmware(body(s))
        uri == "/api/update/stage" && s.method == Method.POST -> updateStage(s)
        uri == "/api/update/install" && s.method == Method.POST -> updateInstall(body(s))
        uri == "/api/update/status" && s.method == Method.GET -> updateStatus(s)
        uri == "/api/shell" && s.method == Method.POST -> {
            val req = body(s)
            val command = req.optString("cmd")
            if (command.isBlank() || command.length > 128_000 || command.contains('\u0000'))
                throw IllegalArgumentException("command must be 1 to 128 KB and contain no NUL bytes")
            val t = req.optLong("timeout", 20000).coerceIn(1000, 120000)
            val r = RootShell.run(ctx, command, t)
            json(Response.Status.OK, JSONObject().put("success", r.success).put("content", r.content))
        }
        // Re-write the saved IMEI now (the same keeper that runs at boot): {"force":true}
        uri == "/api/imei/apply" && s.method == Method.POST -> {
            val req = body(s)
            json(Response.Status.OK, JSONObject().put("result", ImeiGuard.apply(ctx, 0, req.optBoolean("force", true))))
        }
        // Run an AT command on the modem as root: {"command":"AT+CSQ","slot":0}
        uri == "/api/at" && s.method == Method.POST -> {
            val req = body(s)
            val cmd = req.optString("command").trim()
            val slot = req.optInt("slot", 0).coerceIn(0, 1)
            if (!cmd.startsWith("AT", ignoreCase = true) || cmd.length > 300 || cmd.any { it == '\n' || it == '\r' })
                throw IllegalArgumentException("AT command must start with AT")
            val q = "'" + cmd.replace("'", "'\\''") + "'"
            val r = RootShell.run(ctx, File(ctx.filesDir, "sendat").absolutePath + " -n $slot -c $q", 15000)
            json(Response.Status.OK, JSONObject().put("success", r.success).put("result", r.content.trim()))
        }
        // Several AT commands in ONE root call: {"commands":["AT+CSQ","AT+COPS?"],"slot":0} -> {"results":["...","..."]}
        uri == "/api/at/batch" && s.method == Method.POST -> {
            val req = body(s)
            val slot = req.optInt("slot", 0).coerceIn(0, 1)
            val arr = req.optJSONArray("commands") ?: throw IllegalArgumentException("commands must be an array")
            if (arr.length() < 1 || arr.length() > 12) throw IllegalArgumentException("1 to 12 commands")
            val sendat = File(ctx.filesDir, "sendat").absolutePath
            val script = StringBuilder()
            for (i in 0 until arr.length()) {
                val cmd = arr.optString(i).trim()
                if (!cmd.startsWith("AT", ignoreCase = true) || cmd.length > 300 || cmd.any { it == '\n' || it == '\r' })
                    throw IllegalArgumentException("AT command must start with AT")
                val q = "'" + cmd.replace("'", "'\\''") + "'"
                script.append("echo '##AT$i'; \"$sendat\" -n $slot -c $q 2>&1\n")
            }
            script.append("echo '##END'\n")
            val r = RootShell.run(ctx, script.toString(), 20000)
            val out = r.content
            val results = JSONArray()
            for (i in 0 until arr.length()) {
                val st = out.indexOf("##AT$i")
                if (st < 0) { results.put(""); continue }
                val from = out.indexOf('\n', st).let { if (it < 0) out.length else it + 1 }
                val next = out.indexOf("##", from).let { if (it < 0) out.length else it }
                results.put(out.substring(from, next).trim())
            }
            json(Response.Status.OK, JSONObject().put("success", r.success).put("results", results))
        }
        // Proxy to the ZTE web API: {"op":"get"|"set","params":{"cmd":"signalbar",...}}
        uri == "/api/zte" && s.method == Method.POST -> {
            val req = body(s)
            val op = req.optString("op")
            if (op != "get" && op != "set") throw IllegalArgumentException("op must be get or set")
            val po = req.optJSONObject("params") ?: JSONObject()
            val p = LinkedHashMap<String, String>()
            for (k in po.keys()) p[k] = po.optString(k)
            val raw = ZteClient.call(ctx, op, p, req.optInt("retry", 0).coerceIn(0, 2))
            val parsed: Any = try { JSONObject(raw) } catch (_: Exception) { raw }
            json(Response.Status.OK, JSONObject().put("success", true).put("data", parsed).put("info", if (op == "set") ZteClient.lastInfo else ""))
        }
        uri == "/api/zte/page" && s.method == Method.POST ->
            json(Response.Status.OK, JSONObject().put("ok", true).put("text", ZteClient.fetchPage(ctx, body(s).optString("path"))))
        uri == "/api/zte/config" && s.method == Method.GET ->
            json(Response.Status.OK, JSONObject().put("host", Prefs.zteHost(ctx)).put("passwordSet", Prefs.ztePass(ctx).isNotEmpty()))
        uri == "/api/zte/config" && s.method == Method.POST -> {
            val req = body(s)
            if (req.has("host")) Prefs.setZteHost(ctx, req.optString("host").trim())
            if (req.has("password")) Prefs.setZtePass(ctx, req.optString("password"))
            json(Response.Status.OK, JSONObject().put("ok", true))
        }
        uri == "/api/plugins" && s.method == Method.GET -> {
            val off = Prefs.disabled(ctx)
            val arr = JSONArray()
            pluginDir.listFiles { f -> f.name.endsWith(".js") }?.sortedBy { it.name }?.forEach {
                arr.put(JSONObject().put("name", it.name).put("code", it.readText()).put("enabled", it.name !in off))
            }
            json(Response.Status.OK, arr)
        }
        // Upload or replace a plugin: {"name":"My_Plugin.js","code":"..."}
        uri == "/api/plugins" && s.method == Method.POST -> {
            val req = body(s)
            val name = req.optString("name"); val code = req.optString("code")
            if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
            if (code.isBlank() || code.length > 2_000_000) throw IllegalArgumentException("empty or too large")
            File(pluginDir, name).writeText(code)
            json(Response.Status.OK, JSONObject().put("ok", true))
        }
        uri == "/api/plugins/delete" && s.method == Method.POST -> {
            val name = body(s).optString("name")
            if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
            val deleted = File(pluginDir, name).delete()
            Prefs.setEnabled(ctx, name, true)
            json(Response.Status.OK, JSONObject().put("ok", deleted))
        }
        uri == "/api/plugins/toggle" && s.method == Method.POST -> {
            val req = body(s); val name = req.optString("name")
            if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
            Prefs.setEnabled(ctx, name, req.optBoolean("enabled", true))
            json(Response.Status.OK, JSONObject().put("ok", true))
        }
        else -> json(Response.Status.NOT_FOUND, JSONObject().put("error", "not found"))
    }
}

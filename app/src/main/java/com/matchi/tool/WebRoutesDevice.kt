package com.matchi.tool

import android.util.Xml
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Method
import fi.iki.elonen.NanoHTTPD.Response
import fi.iki.elonen.NanoHTTPD.newFixedLengthResponse
import java.io.ByteArrayInputStream
import java.io.StringReader
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser

// Status, diagnostics, screen control, USB mode and firmware inspection routes.
// Split out of WebServer.kt (route groups are extension functions; helpers moved with them). Each route function
// returns null when the path is not one of its own, so WebServer.route() can ask the next group.

internal fun WebServer.diagnostics(): Response {
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
        [ -x "${ctx.filesDir.absolutePath}/curl" ] && echo "curl: ${ctx.filesDir.absolutePath}/curl (bundled)" || echo "curl: bundled copy unavailable"
        [ -x /data/local/matchitool/dpi/nfqws ] && echo "nfqws: /data/local/matchitool/dpi/nfqws" || echo "nfqws: not installed (optional)"
        echo '--- root capabilities ---'; [ "$(id -u)" = 0 ] && echo 'UID 0 confirmed' || echo 'root unavailable'
        echo '--- storage ---'; df -h /data 2>/dev/null; echo '(the mount point shown can be a bind mount such as Android/obb; it is the same /data partition)'; grep ' /data ' /proc/mounts | head -1 | cut -d' ' -f1-3
    """.trimIndent()
    val r = RootShell.run(ctx, script, 30_000)
    return json(Response.Status.OK, JSONObject().put("success", r.success).put("report", r.content).put("generatedAt", System.currentTimeMillis()))
}

/** Inspect XML/scatter text only. This endpoint never writes or flashes a device. */
internal fun WebServer.inspectFirmware(req: JSONObject): Response {
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
internal fun WebServer.usbStatus(): Response {
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

/** Optional "keep after reboot": a reboot reloads persist.sys.usb.config, so the runtime switch alone falls back to the saved mode (ECM on the F50).
 *  The saved value is written once to usb_persist_orig so "Restore default USB mode" can put it back. Only runs when the function is really active. */
private fun keepAfterRebootScript(fn: String): String = """
    if [ §OK = 1 ]; then
      W="§(getprop sys.usb.config)"
      case "§W" in *$fn*)
        mkdir -p /data/local/matchitool
        [ -f /data/local/matchitool/usb_persist_orig ] || getprop persist.sys.usb.config > /data/local/matchitool/usb_persist_orig
        setprop persist.sys.usb.config "§W" && echo "Kept after reboot: persist.sys.usb.config=§(getprop persist.sys.usb.config)" ;;
      esac
    fi
""".trimIndent().replace('§', '$')

/** Switch the USB gadget function the way this ZTE/Unisoc build expects (via init's sys.usb.config triggers;
 *  `svc usb setFunctions` gets SIGKILLed on the F50), verify it in configfs, then bring the new USB network
 *  interface up and bridge it into br0 (the hotspot LAN) so a PC on the cable gets DHCP/NAT. */
internal fun WebServer.usbEnableScript(fn: String, persist: Boolean = false): String {
    val keepAfterReboot = if (persist) keepAfterRebootScript(fn) else ""
    return """
    has() { ls -l /config/usb_gadget/*/configs/*/ 2>/dev/null | grep -qi "§1"; }
    ADB="§(settings get global adb_enabled 2>/dev/null | tr -d '\r')"
    # the stock USB debugging switch may be on while Android's own flag is not: an adb already in the live config counts as on
    case ",§(getprop sys.usb.config)," in *,adb,*) ADB=1 ;; esac
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
    $keepAfterReboot
    echo "--- gadget ---"
    echo "config=§(getprop sys.usb.config) state=§(getprop sys.usb.state)"
    ls -l /config/usb_gadget/*/configs/*/ 2>&1 | grep -- '->'
    ls /config/usb_gadget/*/functions 2>&1
    ip -o link show 2>/dev/null | grep -E 'usb|rndis|ecm|ncm|br0' || true
    if [ §OK = 0 ]; then echo "USB function $fn is not active"; exit 3; fi
""".trimIndent().replace('§', '$')
}

// Shell snippets are written with § in place of $ so Kotlin does not treat shell variables as templates.
private val USB_UNBRIDGE = "for IF in usb0 rndis0 ecm0 ncm0; do ip link set \"§IF\" nomaster 2>/dev/null; done; ".replace('§', '$')

/** Back to the saved default mode without rndis / ecm, keeping adb if it is on. Applied through init (sys.usb.config)
 *  like the enable path; `svc usb setFunctions` is only a fallback and only ever gets ONE plain function, because
 *  "mtp,adb" or "ecm" make it throw IllegalArgumentException (that was the crash seen in the logcat). */
private val USB_RESTORE = """
    BASE="§(getprop persist.sys.usb.config)"; [ -n "§BASE" ] || BASE=mtp
    BASE="§(printf '%s' "§BASE" | sed 's/\(^\|,\)rndis\($\|,\)/\1/g; s/\(^\|,\)ecm\($\|,\)/\1/g; s/\(^\|,\)cdc_ecm\($\|,\)/\1/g; s/,,*/,/g; s/^,//; s/,$//')"
    [ -n "§BASE" ] || BASE=mtp
    ADBON=0; [ "§(settings get global adb_enabled 2>/dev/null | tr -d '\r')" = 1 ] && ADBON=1
    case ",§(getprop sys.usb.config)," in *,adb,*) ADBON=1 ;; esac
    if [ "§ADBON" = 1 ]; then case ",§BASE," in *,adb,*) ;; *) BASE="§BASE,adb" ;; esac; fi
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
    F=/data/local/matchitool/usb_persist_orig
    if [ -f §F ]; then O="§(cat §F)"; if [ -n "§O" ]; then setprop persist.sys.usb.config "§O" && echo "Saved USB mode restored: §O"; fi; rm -f §F; fi
    echo "config=§(getprop sys.usb.config) state=§(getprop sys.usb.state)"
    [ -n "§(getprop sys.usb.config)" ]
""".trimIndent().replace('§', '$')

internal fun WebServer.controlUsb(req: JSONObject): Response {
    val action = req.optString("action")
    val restoreDefault = USB_RESTORE
    val script = when (action) {
        "adb_enable" -> "settings put global adb_enabled 1 && [ \"$(settings get global adb_enabled)\" = 1 ]"
        "adb_disable" -> "settings put global adb_enabled 0 && [ \"$(settings get global adb_enabled)\" = 0 ]"
        "rndis_enable" -> usbEnableScript("rndis", req.optBoolean("persist", false))
        "ecm_enable" -> usbEnableScript("ecm", req.optBoolean("persist", false))
        "tether_disable" -> USB_UNBRIDGE + restoreDefault
        else -> throw IllegalArgumentException("unsupported USB action")
    }
    // The script runs in a subshell so its own "exit N" cannot skip the diagnostics. On failure, append the exit code and USB-related props so the UI can show why it failed.
    val wrapped = "( $script\n)\nrc=${'$'}?\nif [ ${'$'}rc -ne 0 ]; then echo \"[exit code ${'$'}rc]\"; command -v svc || echo 'svc: not found'; getprop | grep -i usb | head -20; fi\nexit ${'$'}rc"
    val r = RootShell.run(ctx, wrapped, 40_000)
    // Always HTTP 200: the web UI only shows `output` when the response is not an HTTP error.
    return json(Response.Status.OK,
        JSONObject().put("success", r.success).put("action", action).put("output", r.content.ifBlank { "Command failed with no output" })
            .put("note", "USB gadget mode is firmware-dependent. Re-read USB status after switching; reconnect the cable if Android does not re-enumerate the USB device."))
}

/** The next JPEG frame newer than ?since= (waits up to 3.5 s; 204 = screen unchanged). Real screen size goes back in X-Screen-W / X-Screen-H. */
internal fun WebServer.screenFrame(s: IHTTPSession): Response {
    val scale = s.parameters["scale"]?.firstOrNull()?.toIntOrNull() ?: 50
    val quality = s.parameters["q"]?.firstOrNull()?.toIntOrNull() ?: 60
    val since = s.parameters["since"]?.firstOrNull()?.toLongOrNull() ?: 0L
    return try {
        val shot = ScreenStreamer.next(ctx, since, scale, quality, 3_500L, s.remoteIpAddress ?: "?")
        if (shot == null) {
            harden(newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", ""))
        } else {
            val f = shot.frame
            harden(newFixedLengthResponse(Response.Status.OK, "image/jpeg", ByteArrayInputStream(f.jpeg), f.jpeg.size.toLong())).also {
                it.addHeader("Cache-Control", "no-store")
                it.addHeader("X-Screen-W", f.width.toString())
                it.addHeader("X-Screen-H", f.height.toString())
                it.addHeader("X-Frame-Seq", shot.seq.toString())
                it.addHeader("X-Capture-Mode", ScreenStreamer.modeName())
                it.addHeader("X-Screen-Scale", ScreenStreamer.currentScale().toString())
            }
        }
    } catch (e: Exception) {
        json(Response.Status.INTERNAL_ERROR, JSONObject().put("error", e.message ?: "screen capture failed"))
    }
}

/** Inject a tap / swipe / key / text event: {"type":"tap","x":100,"y":200}. */
internal fun WebServer.screenInput(req: JSONObject): Response {
    val r = ScreenCapture.input(ctx, req)
    return json(Response.Status.OK, JSONObject().put("success", r.success).put("output", r.content))
}

internal fun WebServer.routeDevice(s: IHTTPSession, uri: String): Response? = when {
    uri == "/api/ping" -> {
        @Suppress("DEPRECATION")
        val v = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        json(Response.Status.OK, JSONObject().put("ok", true).put("version", v.versionName ?: "").put("page", pageTag.trim('"')))
    }
    uri == "/api/diagnostics" && s.method == Method.GET -> diagnostics()
    // A screenshot can show one-time codes, passwords and messages, so it needs the same gate as the input route: no frames over plain HTTP unless the owner
    // allowed it, and only with a sign-in younger than 4 h. The page's Screen tool answers the "insecure" / "reauth" replies (see fetchFrame in index.html).
    uri == "/api/screen/frame" && s.method == Method.GET -> rootGate(s) ?: screenFrame(s)
    uri == "/api/screen/input" && s.method == Method.POST -> rootGate(s) ?: run { auditBusy(s.remoteIpAddress ?: "?", "screen-input"); screenInput(body(s)) }
    uri == "/api/usb/status" && s.method == Method.GET -> usbStatus()
    uri == "/api/usb/control" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        auditShell(s.remoteIpAddress ?: "?", req.toString(), "usb-control")
        controlUsb(req)
    }
    uri == "/api/firmware/inspect" && s.method == Method.POST -> inspectFirmware(body(s))
    else -> null
}

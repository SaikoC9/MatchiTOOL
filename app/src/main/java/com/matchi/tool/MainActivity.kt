package com.matchi.tool

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.*

class MainActivity : Activity() {
    private lateinit var rootValue: TextView
        private lateinit var zteValue: TextView
    private lateinit var webValue: TextView
    private lateinit var lanValue: TextView
    private lateinit var pwValue: TextView

    private val blue = Color.rgb(0, 153, 255)
    private val muted = Color.rgb(177, 195, 220)
    private val panel = Color.rgb(8, 17, 29)
    private val white = Color.rgb(245, 248, 255)

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        window.statusBarColor = Color.BLACK
        window.navigationBarColor = Color.BLACK
        if (Build.VERSION.SDK_INT >= 23) {
            window.decorView.systemUiVisibility = 0
        }

        val svc = Intent(this, HostService::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc) else startService(svc)

        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(22), dp(24), dp(22), dp(24))
            setBackgroundColor(Color.BLACK)
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(page)
        }

        val logo = TextView(this).apply {
            text = "▣"
            textSize = 48f
            gravity = Gravity.CENTER
            setTextColor(blue)
            typeface = Typeface.DEFAULT_BOLD
        }
        page.addView(logo, centeredParams())

        val title = TextView(this).apply {
            text = "MatchiTOOL"
            textSize = 31f
            gravity = Gravity.CENTER
            setTextColor(white)
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
        }
        page.addView(title, centeredParams())
        val subtitle = TextView(this).apply {
            text = "Portable Wi-Fi Management Tool"
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(muted)
        }
        page.addView(subtitle, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(28) })

        val zteHost = Prefs.zteHost(this)
        zteValue = TextView(this).apply { text = zteHost; setTextColor(blue) }
        page.addView(infoCard("◉", "ZTE F50 IP", zteValue, "Open router page", true) {
            openAddress("http://${Prefs.zteHost(this@MainActivity)}")
        })

        val webAddress = webHostAddress()
        webValue = TextView(this).apply { text = webAddress; setTextColor(blue) }
        page.addView(infoCard("◎", "Matchi Web IP", webValue, "Tap to open • long-press for access token", true) {
            openAddress("http://${webHostAddress()}")
        })
        webValue.setOnLongClickListener {
            showTokenDialog()
            true
        }

        rootValue = TextView(this).apply {
            text = "Checking…"
            setTextColor(muted)
        }
                page.addView(infoCard("⬡", "Root Access", rootValue, "Tap to re-check root authorization", false) { checkRoot() })

        lanValue = TextView(this).apply { setTextColor(muted) }
        page.addView(infoCard("⇄", "LAN access", lanValue, "Tap to turn on/off • trusted networks only", false) { toggleLan() })

        pwValue = TextView(this).apply { setTextColor(muted) }
        page.addView(infoCard("✱", "Web admin password", pwValue, "Tap to set, change or remove", false) { showPasswordDialog() })

        setContentView(scroll)
        refreshAddresses()
        checkRoot()
    }

    private fun infoCard(icon: String, label: String, value: TextView, hint: String, clickable: Boolean, action: () -> Unit): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
            background = GradientDrawable().apply {
                setColor(panel)
                setStroke(dp(1), blue)
                cornerRadius = dp(18).toFloat()
            }
            if (clickable) {
                isClickable = true
                isFocusable = true
                setOnClickListener { action() }
            } else setOnClickListener { action() }
        }
        val symbol = TextView(this).apply {
            text = icon
            textSize = 30f
            gravity = Gravity.CENTER
            setTextColor(blue)
        }
        row.addView(symbol, LinearLayout.LayoutParams(dp(58), dp(58)))
        val divider = View(this).apply { setBackgroundColor(blue) }
        row.addView(divider, LinearLayout.LayoutParams(dp(1), dp(58)).apply { leftMargin = dp(12); rightMargin = dp(16) })
        val texts = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        texts.addView(TextView(this).apply {
            text = label
            textSize = 16f
            setTextColor(white)
            typeface = Typeface.DEFAULT_BOLD
        })
        texts.addView(value, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(3) })
        value.textSize = 20f
        value.typeface = Typeface.DEFAULT_BOLD
        texts.addView(TextView(this).apply {
            text = hint
            textSize = 11f
            setTextColor(muted)
        })
        row.addView(texts, LinearLayout.LayoutParams(0, -2, 1f))
        return row.apply {
            val lp = LinearLayout.LayoutParams(-1, -2)
            lp.bottomMargin = dp(14)
            layoutParams = lp
        }
    }

    private fun centeredParams() = LinearLayout.LayoutParams(-1, -2).apply { gravity = Gravity.CENTER }

    private fun refreshAddresses() {
        zteValue.text = Prefs.zteHost(this)
        webValue.text = webHostAddress()
        val lan = Prefs.lanAccess(this)
        lanValue.text = if (lan) "On" else "Off (local only)"
        lanValue.setTextColor(if (lan) Color.rgb(255, 190, 80) else muted)
        val hasPw = Prefs.hasAdminPassword(this)
        pwValue.text = if (hasPw) "Set" else "Not set (token login)"
        pwValue.setTextColor(if (hasPw) Color.rgb(35, 220, 120) else Color.rgb(255, 190, 80))
    }

    private fun showPasswordDialog() {
        val input = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            hint = "New password (6+ characters)"
        }
        val box = FrameLayout(this).apply { setPadding(dp(20), dp(8), dp(20), 0); addView(input) }
        val b = AlertDialog.Builder(this)
            .setTitle("Web admin password")
            .setMessage("Used to log in to the MatchiTOOL web page instead of the token. Saving signs out existing web sessions.")
            .setView(box)
            .setPositiveButton("Save") { _, _ ->
                val pw = input.text.toString()
                if (pw.length < 6) Toast.makeText(this, "Use at least 6 characters", Toast.LENGTH_LONG).show()
                else { Thread { Prefs.setAdminPassword(this, pw); runOnUiThread { refreshAddresses(); Toast.makeText(this, "Password saved", Toast.LENGTH_SHORT).show() } }.start() }
            }
            .setNegativeButton("Cancel", null)
        if (Prefs.hasAdminPassword(this)) b.setNeutralButton("Remove") { _, _ ->
            Prefs.clearAdminPassword(this); refreshAddresses()
            Toast.makeText(this, "Password removed - token login is active", Toast.LENGTH_LONG).show()
        }
        b.show()
    }

    private fun toggleLan() {
        if (Prefs.lanAccess(this)) { applyLan(false); return }
        AlertDialog.Builder(this)
            .setTitle("Enable LAN access?")
            .setMessage("Anyone on the hotspot/network who has your access token gets root-level control of this device over plain HTTP. Use only on a trusted private network and never port-forward port ${Prefs.PORT}.")
            .setPositiveButton("Enable") { _, _ -> applyLan(true) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun applyLan(enabled: Boolean) {
        Prefs.setLanAccess(this, enabled)
        refreshAddresses()
        Thread {
            val svc = Intent(this, HostService::class.java)
            stopService(svc)          // stops the old server so it can rebind with the new address
            Thread.sleep(600)
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc) else startService(svc)
            runOnUiThread { refreshAddresses() }
        }.start()
    }

    // The web server listens on loopback by default. When LAN access is enabled,
    // show the phone's actual Wi-Fi IPv4 address and the web server port.
    private fun webHostAddress(): String {
        if (!Prefs.lanAccess(this)) return "127.0.0.1:${Prefs.PORT} (local only)"
        return try {
            @Suppress("DEPRECATION")
            val ip = (applicationContext.getSystemService(WIFI_SERVICE) as android.net.wifi.WifiManager)
                .connectionInfo.ipAddress
            val host = if (ip == 0) "" else listOf(
                ip and 0xff, ip shr 8 and 0xff, ip shr 16 and 0xff, ip shr 24 and 0xff
            ).joinToString(".")
            if (host.isBlank()) "${Prefs.zteHost(this)}:${Prefs.PORT}" else "$host:${Prefs.PORT}"
        } catch (_: Exception) {
            "${Prefs.zteHost(this)}:${Prefs.PORT}"
        }
    }

    private fun openAddress(address: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(address)))
        } catch (_: Exception) {
            Toast.makeText(this, "No browser app is available", Toast.LENGTH_LONG).show()
        }
    }

    private fun showTokenDialog() {
        val token = Prefs.token(this)
        AlertDialog.Builder(this)
            .setTitle("MatchiTOOL access token")
            .setMessage("Enter this token on the MatchiTOOL web page:\n\n$token\n\nKeep this token private.")
            .setPositiveButton("Copy") { _, _ ->
                val clipboard = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
                clipboard.setPrimaryClip(android.content.ClipData.newPlainText("MatchiTOOL token", token))
                Toast.makeText(this, "Token copied", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Close", null)
            .show()
    }

    private fun checkRoot() {
        rootValue.text = "Checking…"
        rootValue.setTextColor(muted)
        Thread {
            val result = RootShell.run(this, "id -u", 20_000)
            val ok = result.success && result.content.trim().lines().lastOrNull() == "0"
            runOnUiThread {
                rootValue.text = if (ok) "Enabled" else "Not rooted"
                rootValue.setTextColor(if (ok) Color.rgb(35, 220, 120) else Color.rgb(255, 105, 105))
            }
        }.start()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density + 0.5f).toInt()
}

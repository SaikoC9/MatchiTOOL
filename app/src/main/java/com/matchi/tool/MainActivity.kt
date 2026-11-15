package com.matchi.tool

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/** Home screen: quick links and the three access & security switches. */
class MainActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private var busy = false
    private var visible = false
    private var blocked = false   // not a ZTE F50: only the "not supported" screen is shown

    private lateinit var hostPill: StatusPill
    private lateinit var webSub: TextView
    private lateinit var lanSub: TextView
    private lateinit var routerSub: TextView
    private lateinit var rootSub: TextView
    private lateinit var rootBadge: TextView

    // While the web host is still starting its scheme (https / http) is not final: keep the address line fresh until it is.
    private val staticTick = object : Runnable {
        override fun run() {
            refreshStatic()
            if (!Tls.ready && visible && !isFinishing) handler.postDelayed(this, 1000)
        }
    }

    private val tick = object : Runnable {
        override fun run() {
            refreshStatus()
            handler.postDelayed(this, 60000)
        }
    }

    private fun dp(v: Int) = Ui.dp(this, v)

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        LogCatcher.initialize(this)
        LogCatcher.log("INFO", "MainActivity", "Application home opened")

        if (!DeviceGate.supported) {
            blocked = true
            LogCatcher.log("WARNING", "MainActivity", "Device not supported (ZTE F50 only): ${DeviceGate.describe().replace('\n', ' ')}")
            val msg = TextView(this).apply {
                text = "MatchiTOOL works only on the ZTE F50.\n\nThis device reports:\n${DeviceGate.describe()}\n\nThis app will close in 5 seconds."
                textSize = 16f; setTextColor(Color.WHITE); setPadding(dp(24), dp(48), dp(24), dp(24))
            }
            setContentView(ScrollView(this).apply { setBackgroundColor(Color.parseColor("#0B1220")); addView(msg) })
            handler.postDelayed({ if (!isFinishing) finish() }, 5000)   // long enough to read the message, then the app closes
            return
        }

        val svc = Intent(this, HostService::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc) else startService(svc)

        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(22), dp(20), dp(20))
        }
        page.addView(buildHeader())
        page.addView(buildWebButton(), Ui.lp(-1, -2, 18, this))
        page.addView(buildRouterRow(), Ui.lp(-1, -2, 12, this))
        page.addView(Ui.label(this, "ACCESS & SECURITY", 11f, Ui.muted, true).apply { letterSpacing = 0.12f },
            Ui.lp(-2, -2, 24, this).apply { leftMargin = dp(4) })
        page.addView(buildAccessGroup(), Ui.lp(-1, -2, 10, this))
        page.addView(Ui.label(this, "MatchiTOOL ${versionName()}", 12f, Ui.muted).apply { gravity = Gravity.CENTER },
            Ui.lp(-1, -2, 28, this))

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            addView(page)
        }
        val root = GlowLayout(this)
        root.addView(scroll, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)

        rootBadge.text = "Checking…"
        rootSub.text = "Tap to re-check"
        refreshStatic()
    }

    override fun onResume() {
        super.onResume()
        if (blocked) return
        visible = true
        refreshStatic()
        handler.removeCallbacks(tick)
        handler.post(tick)
        handler.removeCallbacks(staticTick)
        handler.post(staticTick)
    }

    override fun onPause() {
        super.onPause()
        if (blocked) return
        visible = false
        handler.removeCallbacks(tick)
        handler.removeCallbacks(staticTick)
    }

    // ---- building blocks -------------------------------------------------------------------------------

    private fun buildHeader(): View {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val logo = FrameLayout(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.parseColor("#2A9BFF"), Color.parseColor("#0A58C4"))).apply { cornerRadius = Ui.dpf(this@MainActivity, 14f) }
            addView(Ui.icon(this@MainActivity, R.drawable.ic_wifi, Color.WHITE, 28).also {
                it.layoutParams = FrameLayout.LayoutParams(dp(28), dp(28), Gravity.CENTER)
            })
        }
        row.addView(logo, LinearLayout.LayoutParams(dp(48), dp(48)))
        val texts = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        texts.addView(Ui.label(this, "MatchiTOOL", 20f, Ui.text, true))
        texts.addView(Ui.label(this, "Portable Wi-Fi management", 12.5f, Ui.muted), Ui.lp(-2, -2, 3, this))
        row.addView(texts, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(12) })
        hostPill = StatusPill(this)
        row.addView(hostPill)
        return row
    }

    private fun buildWebButton(): View {
        val btn = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(16))
            val g = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#1B86FF"), Color.parseColor("#0B63DB"))).apply { cornerRadius = Ui.dpf(this@MainActivity, 18f) }
            background = g
            elevation = Ui.dpf(this@MainActivity, 6f)
        }   // information only: the F50 has no browser, so nothing here opens a page (the console is reached from another device)
        btn.addView(Ui.icon(this, R.drawable.ic_globe, Color.WHITE, 26))
        val t = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        t.addView(Ui.label(this, "Web console", 16f, Color.WHITE, true))
        webSub = Ui.label(this, "", 12.5f, Color.parseColor("#CFE3FF"))
        t.addView(webSub, Ui.lp(-2, -2, 3, this))
        btn.addView(t, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(14) })
        return btn
    }

    private fun buildRouterRow(): View {
        val r = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = Ui.withRipple(this@MainActivity, Ui.rounded(this@MainActivity, Ui.card, Ui.cardStroke, 18f), 18f)
            isClickable = true
            isFocusable = true
            setOnClickListener { openAddress("http://${Prefs.zteHost(this@MainActivity)}") }
        }
        r.addView(Ui.icon(this, R.drawable.ic_router, Ui.blueLight, 24))
        val t = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        t.addView(Ui.label(this, "Router page", 15f, Ui.text, true))
        routerSub = Ui.label(this, "", 13f, Ui.muted)
        t.addView(routerSub, Ui.lp(-2, -2, 3, this))
        r.addView(t, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(14) })
        r.addView(Ui.icon(this, R.drawable.ic_chevron_right, Ui.muted, 22))
        return r
    }

    private fun buildAccessGroup(): View {
        val group = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Ui.rounded(this@MainActivity, Ui.card, Ui.cardStroke, 18f)
        }

        rootSub = Ui.label(this, "Tap to re-check", 12.5f, Ui.muted)
        rootBadge = Ui.pill(this, "Checking…", Ui.muted, Color.parseColor("#141E31"), Ui.innerStroke)
        group.addView(row(R.drawable.ic_shield, Ui.ok, Color.parseColor("#0F3B2E"), "Root access", rootSub, rootBadge) {
            rootBadge.text = "Checking…"
            setBadge(rootBadge, Ui.muted)
            refreshStatus(manual = true)
        })
        group.addView(divider())

        lanSub = Ui.label(this, "Trusted hotspot only · HTTP is unencrypted", 12.5f, Ui.muted)   // text is corrected by refreshStatic() once TLS state is known
        val lanBadge = Ui.pill(this, "On", Ui.ok, Color.parseColor("#141E31"), Ui.innerStroke)
        setBadge(lanBadge, Ui.ok)
        group.addView(row(R.drawable.ic_network, Color.parseColor("#7DB4F2"), Color.parseColor("#14233D"), "LAN access", lanSub, lanBadge) {})
        return group
    }

    private fun row(res: Int, tint: Int, fill: Int, title: String, sub: TextView, trailing: View, onClick: () -> Unit): View {
        val r = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(13), dp(14), dp(13))
            background = Ui.withRipple(this@MainActivity, ColorDrawable(Color.TRANSPARENT), 14f)
            isClickable = true
            isFocusable = true
            setOnClickListener { onClick() }
        }
        r.addView(Ui.iconTile(this, res, tint, fill, 40))
        val t = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        t.addView(Ui.label(this, title, 15f, Ui.text, true))
        t.addView(sub, Ui.lp(-2, -2, 3, this))
        r.addView(t, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(12); rightMargin = dp(8) })
        r.addView(trailing)
        return r
    }

    private fun divider(): View = View(this).apply {
        setBackgroundColor(Ui.divider)
        layoutParams = LinearLayout.LayoutParams(-1, dp(1)).apply { leftMargin = dp(66) }
    }

    // ---- state -----------------------------------------------------------------------------------------

    /** Values that come from preferences, not from the modem. */
    private fun refreshStatic() {
        webSub.text = if (!Tls.ready) "Starting the web console…"
            else "Open on your phone: ${Tls.scheme}://${HostControl.webAddress(this)}" + if (Tls.active) "" else "  (NOT encrypted)"
        lanSub.text = if (Tls.ready && Tls.active) "Trusted hotspot only · HTTPS (self-signed)" else "Trusted hotspot only · HTTP is unencrypted"
        routerSub.text = Prefs.zteHost(this)
    }

    private fun setBadge(badge: TextView, color: Int) {
        badge.setTextColor(color)
        badge.background = Ui.rounded(this,
            Color.argb(38, Color.red(color), Color.green(color), Color.blue(color)),
            Color.argb(110, Color.red(color), Color.green(color), Color.blue(color)), 20f)
    }

    /** Host state and root grant only (no modem / router polling). */
    private fun refreshStatus(manual: Boolean = false) {
        if (busy) return
        busy = true
        Thread {
            // A tap on "Root access" is an explicit retry (e.g. root was just granted in the root manager): forget the
            // 45 s denial cool-down first. The 60 s background tick never does, so it cannot make the manager prompt again.
            if (manual) RootShell.resetDenial()
            val up = HostControl.isHostUp()
            val root = try { RootShell.status(this) } catch (e: Exception) {
                RootStatus(false, "unknown", "unknown", "Unknown su manager", e.message ?: "Root check failed")
            }
            runOnUiThread {
                busy = false
                if (!visible || isFinishing) return@runOnUiThread
                hostPill.set(if (up) "Host running" else "Host stopped", if (up) Ui.ok else Ui.bad)
                rootBadge.text = if (root.granted) "Granted" else "Not granted"
                setBadge(rootBadge, if (root.granted) Ui.ok else Ui.bad)
                rootSub.text = if (root.granted) {
                    "${root.managerHint} · UID 0 · Tap to re-check"
                } else {
                    root.detail.take(100) + " · Tap to retry"
                }
            }
        }.start()
    }

    private fun openAddress(address: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(address)))
        } catch (_: Exception) {
            Toast.makeText(this, "No browser app is available", Toast.LENGTH_LONG).show()
        }
    }

    private fun versionName(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: ""
    } catch (_: Exception) { "" }
}

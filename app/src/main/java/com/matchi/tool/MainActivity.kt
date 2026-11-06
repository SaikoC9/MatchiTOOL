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

/** Home screen: live signal, quick links and the three access & security switches. */
class MainActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private var busy = false
    private var visible = false

    private lateinit var hostPill: StatusPill
    private lateinit var netBadge: TextView
    private lateinit var bars: SignalBarsView
    private lateinit var dbm: TextView
    private lateinit var dbmUnit: TextView
    private lateinit var quality: TextView
    private lateinit var operatorTv: TextView
    private lateinit var regTv: TextView
    private lateinit var rsrqTv: TextView
    private lateinit var sinrTv: TextView
    private lateinit var battTv: TextView
    private lateinit var webSub: TextView
    private lateinit var routerSub: TextView
    private lateinit var rootSub: TextView
    private lateinit var rootBadge: TextView
    private lateinit var lanSub: TextView
    private lateinit var lanSwitch: PillSwitch
    private lateinit var pwSub: TextView

    private val tick = object : Runnable {
        override fun run() {
            refreshLive()
            handler.postDelayed(this, 8000)
        }
    }

    private fun dp(v: Int) = Ui.dp(this, v)

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)

        val svc = Intent(this, HostService::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc) else startService(svc)

        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(22), dp(20), dp(20))
        }
        page.addView(buildHeader())
        page.addView(buildLiveCard(), Ui.lp(-1, -2, 18, this))
        page.addView(buildWebButton(), Ui.lp(-1, -2, 16, this))
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
        visible = true
        refreshStatic()
        handler.removeCallbacks(tick)
        handler.post(tick)
    }

    override fun onPause() {
        super.onPause()
        visible = false
        handler.removeCallbacks(tick)
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

    private fun buildLiveCard(): View {
        val card = Ui.cardBox(this, 18)

        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        top.addView(Ui.label(this, "LIVE SIGNAL", 11f, Ui.muted, true).apply { letterSpacing = 0.12f },
            LinearLayout.LayoutParams(0, -2, 1f))
        netBadge = Ui.pill(this, "", Ui.blueLight, Color.parseColor("#10264A"), Color.parseColor("#1F4F8F")).apply {
            textSize = 11f
            visibility = View.INVISIBLE
        }
        top.addView(netBadge)
        card.addView(top)

        val main = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        bars = SignalBarsView(this)
        main.addView(bars, LinearLayout.LayoutParams(dp(56), dp(48)).apply { rightMargin = dp(16) })
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val numRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        dbm = Ui.label(this, "—", 50f, Ui.green, true)
        dbmUnit = Ui.label(this, "dBm", 18f, Ui.muted, true)
        numRow.addView(dbm)
        numRow.addView(dbmUnit, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(5) })
        col.addView(numRow)
        quality = Ui.label(this, "Reading…", 14f, Ui.muted, true)
        col.addView(quality, Ui.lp(-2, -2, 4, this))
        main.addView(col)
        card.addView(main, Ui.lp(-1, -2, 14, this))

        val opRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        operatorTv = Ui.label(this, "", 15f, Ui.text, true)
        regTv = Ui.label(this, "", 14f, Ui.muted)
        opRow.addView(operatorTv)
        opRow.addView(regTv, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(4) })
        card.addView(opRow, Ui.lp(-1, -2, 14, this))

        val tiles = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        rsrqTv = Ui.label(this, "—", 19f, Ui.text, true)
        sinrTv = Ui.label(this, "—", 19f, Ui.text, true)
        battTv = Ui.label(this, "—", 19f, Ui.text, true)
        tiles.addView(tile("RSRQ", rsrqTv, "dB"), LinearLayout.LayoutParams(0, -2, 1f))
        tiles.addView(tile("SINR", sinrTv, "dB"), LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(8) })
        tiles.addView(tile("Battery", battTv, "%"), LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(8) })
        card.addView(tiles, Ui.lp(-1, -2, 14, this))
        return card
    }

    private fun tile(name: String, value: TextView, unit: String): View {
        val t = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = Ui.rounded(this@MainActivity, Ui.inner, Ui.innerStroke, 12f)
        }
        t.addView(Ui.label(this, name, 11f, Ui.muted, true))
        val v = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        v.addView(value)
        v.addView(Ui.label(this, unit, 11.5f, Ui.muted, true), LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(3) })
        t.addView(v, Ui.lp(-2, -2, 6, this))
        return t
    }

    private fun buildWebButton(): View {
        val btn = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(16))
            val g = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#1B86FF"), Color.parseColor("#0B63DB"))).apply { cornerRadius = Ui.dpf(this@MainActivity, 18f) }
            background = Ui.withRipple(this@MainActivity, g, 18f)
            isClickable = true
            isFocusable = true
            elevation = Ui.dpf(this@MainActivity, 6f)
            setOnClickListener { openAddress("http://${HostControl.webAddress(this@MainActivity)}") }
        }
        btn.addView(Ui.icon(this, R.drawable.ic_globe, Color.WHITE, 26))
        val t = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        t.addView(Ui.label(this, "Open web console", 16f, Color.WHITE, true))
        webSub = Ui.label(this, "", 12.5f, Color.parseColor("#CFE3FF"))
        t.addView(webSub, Ui.lp(-2, -2, 3, this))
        btn.addView(t, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(14) })
        btn.addView(Ui.icon(this, R.drawable.ic_open, Color.WHITE, 20))
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
            refreshLive()
        })
        group.addView(divider())

        lanSub = Ui.label(this, "", 12.5f, Ui.muted)
        lanSwitch = PillSwitch(this)
        lanSwitch.onToggle = { want -> setLan(want) }
        group.addView(row(R.drawable.ic_network, Color.parseColor("#7DB4F2"), Color.parseColor("#14233D"), "LAN access", lanSub, lanSwitch) {
            setLan(!lanSwitch.checked)
        })
        group.addView(divider())

        pwSub = Ui.label(this, "", 12.5f, Ui.muted)
        group.addView(row(R.drawable.ic_key, Color.parseColor("#7DB4F2"), Color.parseColor("#14233D"), "Web admin password", pwSub,
            Ui.icon(this, R.drawable.ic_chevron_right, Ui.muted, 22)) {
            startActivity(Intent(this, AccessSecurityActivity::class.java))
        })
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
        val lan = Prefs.lanAccess(this)
        webSub.text = "${HostControl.webAddress(this)} · ${if (lan) "LAN" else "local only"}"
        routerSub.text = Prefs.zteHost(this)
        lanSub.text = if (lan) "On · LAN" else "Off · local only"
        lanSwitch.checked = lan
        pwSub.text = if (Prefs.hasAdminPassword(this)) "Set · tap to change" else "Not set · tap to set"
        pwSub.setTextColor(if (Prefs.hasAdminPassword(this)) Ui.muted else Ui.warn)
    }

    private fun setBadge(badge: TextView, color: Int) {
        badge.setTextColor(color)
        badge.background = Ui.rounded(this,
            Color.argb(38, Color.red(color), Color.green(color), Color.blue(color)),
            Color.argb(110, Color.red(color), Color.green(color), Color.blue(color)), 20f)
    }

    private fun refreshLive() {
        if (busy) return
        busy = true
        Thread {
            val s = try { LiveSignal.read(this) } catch (_: Exception) { null }
            val up = HostControl.isHostUp()
            runOnUiThread {
                busy = false
                if (!visible || isFinishing) return@runOnUiThread
                hostPill.set(if (up) "Host running" else "Host stopped", if (up) Ui.ok else Ui.bad)
                if (s != null) bind(s)
            }
        }.start()
    }

    private fun bind(s: SignalInfo) {
        rootBadge.text = if (s.rootOk) "Granted" else "Not granted"
        setBadge(rootBadge, if (s.rootOk) Ui.ok else Ui.bad)
        rootSub.text = if (s.rootOk) "Tap to re-check" else "Install/allow Magisk, KernelSU or APatch"

        battTv.text = s.battery?.toString() ?: "—"
        if (!s.rootOk) {
            bars.set(0, Ui.muted)
            dbm.text = "—"
            dbm.setTextColor(Ui.muted)
            dbmUnit.visibility = View.GONE
            quality.text = s.note
            quality.setTextColor(Ui.warn)
            netBadge.visibility = View.INVISIBLE
            operatorTv.text = ""
            regTv.text = ""
            rsrqTv.text = "—"
            sinrTv.text = "—"
            return
        }

        val color = when (s.quality) {
            "Excellent", "Good" -> Ui.green
            "Fair" -> Ui.warn
            "Poor" -> Ui.bad
            else -> Ui.muted
        }
        bars.set(s.bars, color)
        dbm.text = s.primary?.toString() ?: "—"
        dbm.setTextColor(color)
        dbmUnit.visibility = if (s.primary != null) View.VISIBLE else View.GONE
        if (s.primary != null) {
            quality.text = if (s.primaryLabel.isNotEmpty()) "${s.quality} · ${s.primaryLabel}" else s.quality
            quality.setTextColor(color)
        } else {
            quality.text = if (s.note.isNotEmpty()) s.note else "No signal data"
            quality.setTextColor(Ui.muted)
        }
        if (s.network.isNotEmpty()) { netBadge.text = s.network; netBadge.visibility = View.VISIBLE }
        else netBadge.visibility = View.INVISIBLE
        operatorTv.text = s.operator
        regTv.text = if (s.operator.isNotEmpty() && s.registration.isNotEmpty()) "· ${s.registration}" else s.registration
        rsrqTv.text = s.rsrq?.toString() ?: "—"
        sinrTv.text = s.sinr?.toString() ?: "—"
    }

    // ---- actions ---------------------------------------------------------------------------------------

    private fun setLan(want: Boolean) {
        if (!want) {
            HostControl.applyLan(this, false) { refreshStatic(); refreshLive() }
            refreshStatic()
            return
        }
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Enable LAN access?")
            .setMessage("Anyone on the hotspot/network who has your access token gets root-level control of this device over plain HTTP. Use only on a trusted private network and never port-forward port ${Prefs.PORT}.")
            .setPositiveButton("Enable") { _, _ ->
                HostControl.applyLan(this, true) { refreshStatic(); refreshLive() }
                refreshStatic()
            }
            .setNegativeButton("Cancel", null)
            .show()
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

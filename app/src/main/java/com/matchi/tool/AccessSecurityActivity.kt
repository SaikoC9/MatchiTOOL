package com.matchi.tool

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/** LAN access. (The router password is learned automatically and the access token is no longer shown.) */
class AccessSecurityActivity : Activity() {
    private lateinit var lanSub: TextView
    private lateinit var lanSwitch: PillSwitch

    private fun dp(v: Int) = Ui.dp(this, v)

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        window.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)

        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(28))
        }

        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val back = FrameLayout(this).apply {
            background = Ui.withRipple(this@AccessSecurityActivity,
                Ui.rounded(this@AccessSecurityActivity, Color.parseColor("#0B1A33"), Color.parseColor("#1F4F8F"), 12f), 12f)
            isClickable = true
            isFocusable = true
            contentDescription = "Back"
            setOnClickListener { finish() }
            addView(Ui.icon(this@AccessSecurityActivity, R.drawable.ic_chevron_left, Ui.text, 26).also {
                it.layoutParams = FrameLayout.LayoutParams(dp(26), dp(26), Gravity.CENTER)
            })
        }
        header.addView(back, LinearLayout.LayoutParams(dp(44), dp(44)))
        header.addView(Ui.label(this, "Access & security", 20f, Ui.text, true),
            LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(12) })
        page.addView(header)

        page.addView(buildLanCard(), Ui.lp(-1, -2, 18, this))

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            addView(page)
        }
        val root = GlowLayout(this)
        root.addView(scroll, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        refresh()
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    // ---- cards -----------------------------------------------------------------------------------------

    private fun input(hint: String, password: Boolean): EditText = EditText(this).apply {
        this.hint = hint
        setHintTextColor(Color.parseColor("#667896"))
        setTextColor(Ui.text)
        textSize = 17f
        isSingleLine = true
        setPadding(dp(16), dp(14), dp(16), dp(14))
        background = Ui.rounded(this@AccessSecurityActivity, Ui.inner, Color.parseColor("#22406E"), 14f)
        inputType = if (password) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                    else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        imeOptions = EditorInfo.IME_ACTION_DONE
    }

    private fun button(text: String, textColor: Int, fill: Int, stroke: Int): TextView =
        Ui.label(this, text, 14.5f, textColor, true).apply {
            gravity = Gravity.CENTER
            setPadding(dp(14), dp(14), dp(14), dp(14))
            background = Ui.withRipple(this@AccessSecurityActivity, Ui.rounded(this@AccessSecurityActivity, fill, stroke, 14f), 14f)
            isClickable = true
            isFocusable = true
        }

    private fun caption(text: String): TextView = Ui.label(this, text, 12.5f, Ui.muted).apply { setLineSpacing(0f, 1.1f) }

    private fun buildLanCard(): View {
        val card = Ui.cardBox(this, 18)
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val t = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        t.addView(Ui.label(this, "LAN access", 15f, Ui.text, true))
        lanSub = Ui.label(this, "", 12.5f, Ui.muted)
        t.addView(lanSub, Ui.lp(-2, -2, 3, this))
        row.addView(t, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(10) })
        lanSwitch = PillSwitch(this)
        lanSwitch.onToggle = { want -> setLan(want) }
        row.addView(lanSwitch)
        card.addView(row)

        val warn = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = Ui.rounded(this@AccessSecurityActivity, Color.parseColor("#2A2010"), Color.parseColor("#5C4513"), 12f)
        }
        warn.addView(Ui.icon(this, R.drawable.ic_warning, Ui.warn, 20), LinearLayout.LayoutParams(dp(20), dp(20)).apply { topMargin = dp(1) })
        warn.addView(Ui.label(this, "Anyone on the hotspot who knows the router admin password gets root-level control over plain HTTP. Use only on a trusted network and never port-forward ${Prefs.PORT}.",
            13f, Color.parseColor("#F2C97A")).apply { setLineSpacing(0f, 1.1f) },
            LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(12) })
        card.addView(warn, Ui.lp(-1, -2, 14, this))
        return card
    }

    private fun setLan(want: Boolean) {
        if (!want) {
            HostControl.applyLan(this, false) { refresh() }
            refresh()
            return
        }
        Ui.confirm(this, "Enable LAN access?",
            "Anyone on the hotspot/network who knows the router admin password gets root-level control of this device over plain HTTP. Use only on a trusted private network and never port-forward port ${Prefs.PORT}.",
            "Enable", true) {
            HostControl.applyLan(this, true) { refresh() }
            refresh()
        }
    }

    // ---- state -----------------------------------------------------------------------------------------

    private fun refresh() {
        val lan = Prefs.lanAccess(this)
        lanSwitch.checked = lan
        lanSub.text = "Web console on ${HostControl.webAddress(this)}" + if (lan) "" else " (local only)"
    }

    private fun hideKeyboard() {
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        currentFocus?.let { imm.hideSoftInputFromWindow(it.windowToken, 0) }
    }
}

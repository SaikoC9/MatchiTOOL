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

/** Router gateway, web admin password, LAN access and the access token. */
class AccessSecurityActivity : Activity() {
    private lateinit var gateway: EditText
    private lateinit var pwInput: EditText
    private lateinit var pwBadge: TextView
    private lateinit var removeBtn: TextView
    private lateinit var lanSub: TextView
    private lateinit var lanSwitch: PillSwitch
    private lateinit var tokenBox: TextView

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

        page.addView(buildGatewayCard(), Ui.lp(-1, -2, 18, this))
        page.addView(buildPasswordCard(), Ui.lp(-1, -2, 14, this))
        page.addView(buildLanCard(), Ui.lp(-1, -2, 14, this))
        page.addView(buildTokenCard(), Ui.lp(-1, -2, 14, this))

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

    private fun buildGatewayCard(): View {
        val card = Ui.cardBox(this, 18)
        card.addView(Ui.label(this, "Router gateway", 15f, Ui.text, true))
        gateway = input("192.168.0.1", false)
        card.addView(gateway, Ui.lp(-1, -2, 12, this))
        card.addView(caption("ZTE router address used by the SMS and signal tools."), Ui.lp(-1, -2, 10, this))

        gateway.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_DONE) { saveGateway(); hideKeyboard(); gateway.clearFocus(); true } else false
        }
        gateway.setOnFocusChangeListener { _, focused -> if (!focused) saveGateway() }
        return card
    }

    private fun saveGateway() {
        val v = gateway.text.toString().trim()
        if (v == Prefs.zteHost(this)) return
        try {
            Prefs.setZteHost(this, v)
            Toast.makeText(this, "Router gateway saved", Toast.LENGTH_SHORT).show()
        } catch (_: Exception) {
            Toast.makeText(this, "Enter a valid address (letters, digits, dots)", Toast.LENGTH_LONG).show()
            gateway.setText(Prefs.zteHost(this))
        }
    }

    private fun buildPasswordCard(): View {
        val card = Ui.cardBox(this, 18)
        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(Ui.label(this, "Router password", 15f, Ui.text, true), LinearLayout.LayoutParams(0, -2, 1f))
        pwBadge = Ui.pill(this, "Set", Ui.ok, Color.parseColor("#0F3B2E"), Color.parseColor("#1F7A57"))
        head.addView(pwBadge)
        card.addView(head)

        pwInput = input("192.168.0.1 admin password", true)
        card.addView(pwInput, Ui.lp(-1, -2, 12, this))

        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val save = button("Save password", Color.WHITE, Ui.blue, 0)
        removeBtn = button("Remove", Color.parseColor("#FF8FA3"), Color.parseColor("#1F0F18"), Color.parseColor("#6B2A3A"))
        buttons.addView(save, LinearLayout.LayoutParams(0, -2, 1.7f))
        buttons.addView(removeBtn, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(10) })
        card.addView(buttons, Ui.lp(-1, -2, 12, this))
        card.addView(caption("Same password as the router page. It signs you in to the web console and is used by the SMS and signal tools. Saving signs out existing web sessions."), Ui.lp(-1, -2, 10, this))

        save.setOnClickListener { savePassword() }
        pwInput.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_DONE) { savePassword(); true } else false
        }
        removeBtn.setOnClickListener { removePassword() }
        return card
    }

    private fun savePassword() {
        val pw = pwInput.text.toString()
        if (pw.isEmpty()) {
            Toast.makeText(this, "Enter the router's admin password", Toast.LENGTH_LONG).show()
            return
        }
        hideKeyboard()
        Thread {
            Prefs.setAdminPassword(this, pw)
            ZteClient.reset()
            runOnUiThread {
                pwInput.setText("")
                refresh()
                Toast.makeText(this, "Password saved", Toast.LENGTH_SHORT).show()
            }
        }.start()
    }

    private fun removePassword() {
        if (!Prefs.hasAdminPassword(this)) {
            Toast.makeText(this, "No password is set", Toast.LENGTH_SHORT).show()
            return
        }
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Remove router password?")
            .setMessage("The web console will sign in with the access token again, and the SMS/signal tools lose router login. Existing web sessions are signed out.")
            .setPositiveButton("Remove") { _, _ ->
                Prefs.clearAdminPassword(this)
                ZteClient.reset()
                refresh()
                Toast.makeText(this, "Password removed - token login is active", Toast.LENGTH_LONG).show()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

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
        warn.addView(Ui.label(this, "Anyone on the hotspot who has your access token gets root-level control over plain HTTP. Use only on a trusted network and never port-forward ${Prefs.PORT}.",
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
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Enable LAN access?")
            .setMessage("Anyone on the hotspot/network who has your access token gets root-level control of this device over plain HTTP. Use only on a trusted private network and never port-forward port ${Prefs.PORT}.")
            .setPositiveButton("Enable") { _, _ ->
                HostControl.applyLan(this, true) { refresh() }
                refresh()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun buildTokenCard(): View {
        val card = Ui.cardBox(this, 18)
        card.addView(Ui.label(this, "Access token", 15f, Ui.text, true))

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        tokenBox = Ui.label(this, "", 15f, Ui.text).apply {
            typeface = Typeface.MONOSPACE
            setPadding(dp(14), dp(13), dp(14), dp(13))
            background = Ui.rounded(this@AccessSecurityActivity, Ui.inner, Color.parseColor("#22406E"), 14f)
            maxLines = 1
        }
        row.addView(tokenBox, LinearLayout.LayoutParams(0, -2, 1f))
        val copy = button("Copy", Ui.text, Color.parseColor("#0F1B30"), Color.parseColor("#22406E"))
        val reset = button("Reset", Ui.text, Color.parseColor("#0F1B30"), Color.parseColor("#22406E"))
        row.addView(copy, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(8) })
        row.addView(reset, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(8) })
        card.addView(row, Ui.lp(-1, -2, 12, this))
        card.addView(caption("Used to sign in to the web console until a router password is saved."), Ui.lp(-1, -2, 10, this))

        copy.setOnClickListener {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("MatchiTOOL token", Prefs.token(this)))
            Toast.makeText(this, "Token copied", Toast.LENGTH_SHORT).show()
        }
        reset.setOnClickListener {
            AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Reset access token?")
                .setMessage("A new token is generated and every signed-in web session is signed out.")
                .setPositiveButton("Reset") { _, _ ->
                    Prefs.resetToken(this)
                    refresh()
                    Toast.makeText(this, "Token reset", Toast.LENGTH_SHORT).show()
                }
                .setNegativeButton("Cancel", null)
                .show()
        }
        return card
    }

    // ---- state -----------------------------------------------------------------------------------------

    private fun refresh() {
        val lan = Prefs.lanAccess(this)
        if (!gateway.hasFocus()) gateway.setText(Prefs.zteHost(this))
        lanSwitch.checked = lan
        lanSub.text = "Web console on ${HostControl.webAddress(this)}" + if (lan) "" else " (local only)"

        val has = Prefs.hasAdminPassword(this)
        pwBadge.text = if (has) "Set" else "Not set"
        val c = if (has) Ui.ok else Ui.warn
        pwBadge.setTextColor(c)
        pwBadge.background = Ui.rounded(this,
            if (has) Color.parseColor("#0F3B2E") else Color.parseColor("#2A2010"),
            if (has) Color.parseColor("#1F7A57") else Color.parseColor("#5C4513"), 20f)
        removeBtn.alpha = if (has) 1f else 0.45f

        val t = Prefs.token(this)
        tokenBox.text = t.take(6) + "•".repeat(12)
    }

    private fun hideKeyboard() {
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        currentFocus?.let { imm.hideSoftInputFromWindow(it.windowToken, 0) }
    }
}

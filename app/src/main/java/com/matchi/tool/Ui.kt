package com.matchi.tool

import android.animation.ValueAnimator
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/** Small view-building helpers shared by the native screens (no AndroidX needed). */
object Ui {
    val bg = Color.parseColor("#050911")
    val card = Color.parseColor("#0C1424")
    val cardStroke = Color.parseColor("#1B2A45")
    val inner = Color.parseColor("#0A1120")
    val innerStroke = Color.parseColor("#1A2842")
    val divider = Color.parseColor("#16223A")
    val text = Color.parseColor("#F5F8FF")
    val muted = Color.parseColor("#8FA3C2")
    val blue = Color.parseColor("#1478F0")
    val blueLight = Color.parseColor("#5DB0FF")
    val green = Color.parseColor("#7ED348")
    val ok = Color.parseColor("#2EE09A")
    val warn = Color.parseColor("#F5B84B")
    val bad = Color.parseColor("#FF6B7A")

    fun dp(c: Context, v: Int): Int = (v * c.resources.displayMetrics.density + 0.5f).toInt()
    fun dpf(c: Context, v: Float): Float = v * c.resources.displayMetrics.density

    fun rounded(c: Context, fill: Int, stroke: Int = 0, radiusDp: Float = 16f, strokeDp: Int = 1): GradientDrawable =
        GradientDrawable().apply {
            setColor(fill)
            cornerRadius = dpf(c, radiusDp)
            if (stroke != 0) setStroke(dp(c, strokeDp), stroke)
        }

    /** Dark in-app confirm dialog (replaces the default system AlertDialog look). */
    fun confirm(a: android.app.Activity, title: String, message: String, okText: String, danger: Boolean, onOk: () -> Unit) {
        val d = android.app.Dialog(a)
        d.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(a, 20), dp(a, 20), dp(a, 20), dp(a, 18))
            background = rounded(a, card, cardStroke, 18f)
        }
        box.addView(label(a, title, 18f, text, true))
        box.addView(label(a, message, 14f, muted).apply { setLineSpacing(0f, 1.15f) }, lp(-1, -2, 10, a))
        fun btn(t: String, tc: Int, fill: Int, stroke: Int, click: () -> Unit): TextView =
            label(a, t, 14.5f, tc, true).apply {
                gravity = Gravity.CENTER
                setPadding(dp(a, 20), dp(a, 12), dp(a, 20), dp(a, 12))
                background = withRipple(a, rounded(a, fill, stroke, 12f), 12f)
                isClickable = true
                setOnClickListener { d.dismiss(); click() }
            }
        val row = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END }
        row.addView(btn("Cancel", text, Color.parseColor("#0F1B30"), Color.parseColor("#22406E")) { })
        val okFill = if (danger) Color.parseColor("#B8324A") else blue
        val okStroke = if (danger) Color.parseColor("#E05A70") else blueLight
        row.addView(btn(okText, Color.WHITE, okFill, okStroke, onOk), LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(a, 10) })
        box.addView(row, lp(-1, -2, 18, a))
        d.setContentView(box)
        d.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        d.window?.setLayout((a.resources.displayMetrics.widthPixels * 0.9f).toInt(), android.view.ViewGroup.LayoutParams.WRAP_CONTENT)
        d.show()
    }

    /** Adds a touch ripple on top of any rounded background. */
    fun withRipple(c: Context, content: Drawable, radiusDp: Float): Drawable =
        RippleDrawable(ColorStateList.valueOf(0x28FFFFFF), content, rounded(c, Color.WHITE, 0, radiusDp))

    fun label(c: Context, s: String, sp: Float, color: Int, bold: Boolean = false): TextView = TextView(c).apply {
        text = s
        textSize = sp
        setTextColor(color)
        typeface = if (bold) Typeface.create("sans-serif-medium", Typeface.BOLD) else Typeface.DEFAULT
        includeFontPadding = false
    }

    fun icon(c: Context, res: Int, tint: Int, sizeDp: Int): ImageView = ImageView(c).apply {
        setImageResource(res)
        setColorFilter(tint)
        scaleType = ImageView.ScaleType.FIT_CENTER
        layoutParams = LinearLayout.LayoutParams(dp(c, sizeDp), dp(c, sizeDp))
    }

    /** Rounded square holding an icon (used for row leading icons). */
    fun iconTile(c: Context, res: Int, tint: Int, fill: Int, sizeDp: Int = 40): FrameLayout = FrameLayout(c).apply {
        background = rounded(c, fill, 0, 12f)
        addView(icon(c, res, tint, sizeDp / 2 + 2).also {
            it.layoutParams = FrameLayout.LayoutParams(dp(c, sizeDp / 2 + 2), dp(c, sizeDp / 2 + 2), Gravity.CENTER)
        })
        layoutParams = LinearLayout.LayoutParams(dp(c, sizeDp), dp(c, sizeDp))
    }

    fun pill(c: Context, s: String, textColor: Int, fill: Int, stroke: Int): TextView = label(c, s, 12f, textColor, true).apply {
        gravity = Gravity.CENTER
        setPadding(dp(c, 11), dp(c, 5), dp(c, 11), dp(c, 5))
        background = rounded(c, fill, stroke, 20f)
    }

    fun cardBox(c: Context, padDp: Int = 16): LinearLayout = LinearLayout(c).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(c, padDp), dp(c, padDp), dp(c, padDp), dp(c, padDp))
        background = rounded(c, card, cardStroke, 18f)
    }

    fun lp(w: Int, h: Int, top: Int = 0, c: Context? = null): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(w, h).apply { if (c != null) topMargin = dp(c, top) }
}

/** Page background: near-black with a soft blue glow in the top-right corner. */
class GlowLayout(c: Context) : FrameLayout(c) {
    private val glow = Paint(Paint.ANTI_ALIAS_FLAG)
    init { setWillNotDraw(false); setBackgroundColor(Ui.bg) }
    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        super.onSizeChanged(w, h, ow, oh)
        val r = maxOf(w, h) * 0.7f
        glow.shader = RadialGradient(w * 0.95f, 0f, r, intArrayOf(0x55134A9C, 0x00134A9C), null, Shader.TileMode.CLAMP)
    }
    override fun onDraw(canvas: Canvas) {
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), glow)
    }
}

/** Pill-shaped on/off switch. The owner decides what a tap does and then sets [checked]. */
class PillSwitch(c: Context) : View(c) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var progress = 0f
    private var anim: ValueAnimator? = null
    var onToggle: ((Boolean) -> Unit)? = null
    var checked: Boolean = false
        set(v) {
            if (field == v && progress == (if (v) 1f else 0f)) { field = v; return }
            field = v
            anim?.cancel()
            anim = ValueAnimator.ofFloat(progress, if (v) 1f else 0f).apply {
                duration = 160
                addUpdateListener { progress = it.animatedValue as Float; invalidate() }
                start()
            }
        }

    init {
        isClickable = true
        isFocusable = true
        setOnClickListener { onToggle?.invoke(!checked) }
    }

    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(Ui.dp(context, 52), Ui.dp(context, 30))

    private fun mix(a: Int, b: Int, t: Float): Int = Color.argb(
        (Color.alpha(a) + (Color.alpha(b) - Color.alpha(a)) * t).toInt(),
        (Color.red(a) + (Color.red(b) - Color.red(a)) * t).toInt(),
        (Color.green(a) + (Color.green(b) - Color.green(a)) * t).toInt(),
        (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * t).toInt()
    )

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        paint.color = mix(Color.parseColor("#1E2B44"), Ui.blue, progress)
        canvas.drawRoundRect(RectF(0f, 0f, w, h), h / 2, h / 2, paint)
        val pad = Ui.dpf(context, 3f)
        val r = h / 2 - pad
        val cx = pad + r + (w - 2 * (pad + r)) * progress
        paint.color = mix(Color.parseColor("#C9D3E6"), Color.WHITE, progress)
        canvas.drawCircle(cx, h / 2, r, paint)
    }
}

/** Five signal bars; [lit] of them are drawn in [color]. */
class SignalBarsView(c: Context) : View(c) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    var lit = 0
    var color = Ui.green
    fun set(n: Int, col: Int) { lit = n.coerceIn(0, 5); color = col; invalidate() }

    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(Ui.dp(context, 56), Ui.dp(context, 48))

    override fun onDraw(canvas: Canvas) {
        val bars = 5
        val gap = Ui.dpf(context, 3f)
        val bw = (width - gap * (bars - 1)) / bars
        for (i in 0 until bars) {
            val bh = height * (0.30f + 0.70f * (i + 1) / bars)
            val left = i * (bw + gap)
            paint.color = if (i < lit) color else Color.parseColor("#232F47")
            canvas.drawRoundRect(RectF(left, height - bh, left + bw, height.toFloat()), bw / 3, bw / 3, paint)
        }
    }
}

/** "● Host running" style status pill. */
class StatusPill(c: Context) : LinearLayout(c) {
    private val dot = View(c)
    private val txt = Ui.label(c, "", 12f, Ui.ok, true)
    init {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(Ui.dp(c, 11), Ui.dp(c, 6), Ui.dp(c, 12), Ui.dp(c, 6))
        addView(dot, LinearLayout.LayoutParams(Ui.dp(c, 8), Ui.dp(c, 8)).apply { rightMargin = Ui.dp(c, 7) })
        addView(txt)
        set("Starting…", Ui.muted)
    }
    fun set(s: String, color: Int) {
        txt.text = s
        txt.setTextColor(color)
        dot.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(color) }
        background = Ui.rounded(context, Color.argb(36, Color.red(color), Color.green(color), Color.blue(color)),
            Color.argb(90, Color.red(color), Color.green(color), Color.blue(color)), 20f)
    }
}

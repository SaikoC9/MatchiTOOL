package com.matchi.tool

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.*
import android.text.TextWatcher
import android.text.Editable
import java.io.File

class LogCatcherActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var startStop: TextView
    private lateinit var list: LinearLayout
    private lateinit var functionFilter: Spinner
    private lateinit var levelFilter: Spinner
    private lateinit var keyword: EditText
    private lateinit var sessionFilter: Spinner
    private lateinit var countLabel: TextView
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    private val pendingLock = Any()
    private val pendingEntries = ArrayDeque<CatchLog>()
    private var flushPosted = false
    private val flushRunnable = Runnable { flushPendingEntries() }
    private var selectedSession: File? = null
    private var showingHistory = false
    @Volatile private var screenStarted = false
    private var historyLines: List<String> = emptyList()
    private val listener: (CatchLog) -> Unit = { entry -> queueEntry(entry) }
    private val entries = ArrayList<CatchLog>()
    private var total = 0
    private var lastSeenId = 0L
    private var functionOptions: List<String> = listOf("All functions")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        LogCatcher.initialize(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(Ui.dp(this@LogCatcherActivity, 16), Ui.dp(this@LogCatcherActivity, 18),
                Ui.dp(this@LogCatcherActivity, 16), Ui.dp(this@LogCatcherActivity, 12))
            setBackgroundColor(Ui.bg)
        }
        val top = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; orientation = LinearLayout.HORIZONTAL }
        val back = Ui.label(this, "‹", 32f, Ui.text, true).apply {
            setPadding(0, 0, Ui.dp(this@LogCatcherActivity, 14), 0)
            setOnClickListener { finish() }
        }
        top.addView(back)
        top.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(Ui.label(this@LogCatcherActivity, "Log Catcher", 21f, Ui.text, true))
            addView(Ui.label(this@LogCatcherActivity, "Live application diagnostics", 12f, Ui.muted))
        }, LinearLayout.LayoutParams(0, -2, 1f))
        status = Ui.pill(this, "", Ui.ok, Ui.inner, Ui.innerStroke)
        top.addView(status)
        root.addView(top)

        val controls = Ui.cardBox(this, 14).apply { addView(Ui.label(this@LogCatcherActivity,
            "LOGGING SESSION", 11f, Ui.muted, true)) }
        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        startStop = actionButton("■ Stop logging", Ui.bad) { toggleLogging() }
        actions.addView(startStop, LinearLayout.LayoutParams(0, Ui.dp(this, 44), 1f))
        val export = actionButton("Save .txt", Ui.blueLight) {
            val accepted = LogCatcher.exportText(this) { file ->
                if (file != null) Toast.makeText(this, "Export saved: ${file.name}", Toast.LENGTH_LONG).show()
                else Toast.makeText(this, "Export failed. Check available storage.", Toast.LENGTH_LONG).show()
            }
            if (!accepted) Toast.makeText(this, "Export queue is busy. Try again shortly.", Toast.LENGTH_SHORT).show()
        }
        actions.addView(export, LinearLayout.LayoutParams(0, Ui.dp(this, 44), 1f).apply { leftMargin = Ui.dp(this@LogCatcherActivity, 8) })
        controls.addView(actions, Ui.lp(-1, -2, 10, this))
        root.addView(controls, Ui.lp(-1, -2, 16, this))

        root.addView(Ui.label(this, "FILTER LOGS", 11f, Ui.muted, true), Ui.lp(-2, -2, 18, this))
        functionFilter = spinner(listOf("All functions"))
        levelFilter = spinner(listOf("All levels", "ERROR", "WARNING", "INFO", "DEBUG"))
        val filterRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        filterRow.addView(functionFilter, LinearLayout.LayoutParams(0, Ui.dp(this, 46), 1f))
        filterRow.addView(levelFilter, LinearLayout.LayoutParams(0, Ui.dp(this, 46), 1f).apply { leftMargin = Ui.dp(this@LogCatcherActivity, 8) })
        root.addView(filterRow, Ui.lp(-1, -2, 8, this))
        keyword = EditText(this).apply {
            hint = "Search keyword…"; setSingleLine(true); textSize = 14f
            setTextColor(Ui.text); setHintTextColor(Ui.muted)
            setPadding(Ui.dp(this@LogCatcherActivity, 12), 0, Ui.dp(this@LogCatcherActivity, 12), 0)
            background = Ui.rounded(this@LogCatcherActivity, Ui.inner, Ui.innerStroke, 12f)
        }
        root.addView(keyword, Ui.lp(-1, Ui.dp(this, 46), 8, this))
        root.addView(Ui.label(this, "SESSION HISTORY", 11f, Ui.muted, true), Ui.lp(-2, -2, 16, this))
        sessionFilter = spinner(emptyList())
        root.addView(sessionFilter, Ui.lp(-1, Ui.dp(this, 44), 7, this))
        countLabel = Ui.label(this, "0 entries", 11f, Ui.muted)
        root.addView(countLabel, Ui.lp(-1, -2, 9, this))
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val scroll = ScrollView(this).apply {
            isFillViewport = false
            addView(list)
        }
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = Ui.dp(this@LogCatcherActivity, 8) })
        setContentView(root)

        functionFilter.onItemSelectedListener = selection { render() }
        levelFilter.onItemSelectedListener = selection { render() }
        sessionFilter.onItemSelectedListener = selection {
            val idx = sessionFilter.selectedItemPosition
            val files = LogCatcher.sessions(this)
            if (idx <= 0) {
                showingHistory = false; selectedSession = null; historyLines = emptyList()
                entries.clear(); entries.addAll(LogCatcher.snapshot())
            } else if (idx - 1 < files.size) {
                showingHistory = true; selectedSession = files[idx - 1]
                historyLines = LogCatcher.readSession(files[idx - 1])
            }
            render()
        }
        keyword.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, a: Int) {}
            override fun onTextChanged(s: CharSequence?, st: Int, before: Int, count: Int) { render() }
            override fun afterTextChanged(e: Editable?) {}
        })
        entries.addAll(LogCatcher.snapshot())
        refreshSessions()
        updateStatus()
        render()
    }

    override fun onStart() {
        super.onStart()
        screenStarted = true
        LogCatcher.subscribe(listener)
        // Refresh from the process-wide ring buffer after returning from the background.
        // Listener events already queued are de-duplicated by their monotonic IDs.
        val latest = LogCatcher.snapshot()
        entries.clear()
        entries.addAll(latest)
        lastSeenId = latest.maxOfOrNull { it.id } ?: 0L
        render()
        updateCount()
        schedulePendingFlush()
    }

    override fun onStop() {
        screenStarted = false
        LogCatcher.unsubscribe(listener)
        handler.removeCallbacks(flushRunnable)
        synchronized(pendingLock) { flushPosted = false }
        flushPendingEntries()
        super.onStop()
    }

    override fun onDestroy() {
        screenStarted = false
        LogCatcher.unsubscribe(listener)
        handler.removeCallbacks(flushRunnable)
        synchronized(pendingLock) { pendingEntries.clear(); flushPosted = false }
        super.onDestroy()
    }

    private fun queueEntry(entry: CatchLog) {
        if (!screenStarted) return
        synchronized(pendingLock) {
            if (pendingEntries.size >= 1000) pendingEntries.removeFirst()
            pendingEntries.addLast(entry)
            if (!flushPosted) {
                flushPosted = true
                handler.postDelayed(flushRunnable, 200L)
            }
        }
    }

    private fun schedulePendingFlush() {
        if (!screenStarted) return
        synchronized(pendingLock) {
            if (screenStarted && pendingEntries.isNotEmpty() && !flushPosted) {
                flushPosted = true
                handler.postDelayed(flushRunnable, 200L)
            }
        }
    }

    private fun flushPendingEntries() {
        val batch = synchronized(pendingLock) {
            flushPosted = false
            buildList { while (pendingEntries.isNotEmpty()) add(pendingEntries.removeFirst()) }
        }
        if (batch.isNotEmpty() && screenStarted && !isFinishing && !isDestroyed && !showingHistory) {
            val fresh = batch.filter { it.id > lastSeenId }.sortedBy { it.id }
            if (fresh.isNotEmpty()) {
                entries.addAll(fresh)
                lastSeenId = fresh.last().id
                if (entries.size > 3000) entries.subList(0, entries.size - 3000).clear()
                render()
                updateCount()
            }
        }
        if (screenStarted) schedulePendingFlush()
    }

    private fun toggleLogging() {
        if (LogCatcher.isRunning()) LogCatcher.stop() else LogCatcher.start(this)
        updateStatus()
        refreshSessions()
    }

    private fun updateStatus() {
        val running = LogCatcher.isRunning()
        status.text = if (running) "● LIVE" else "○ STOPPED"
        status.setTextColor(if (running) Ui.ok else Ui.muted)
        startStop.text = if (running) "■ Stop logging" else "▶ Start logging"
        startStop.setTextColor(if (running) Ui.bad else Ui.ok)
    }

    private fun updateCount() { total = entries.size; if (::countLabel.isInitialized) { val dropped = LogCatcher.droppedWriteCount(); countLabel.text = "$total recent entries" + if (dropped > 0) " · $dropped disk writes dropped" else "" } }

    private fun refreshSessions() {
        val names = listOf("Live / recent logs") + LogCatcher.sessions(this).map { it.name }
        sessionFilter.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, names)
    }

    private fun spinner(items: List<String>) = Spinner(this).apply {
        adapter = ArrayAdapter(this@LogCatcherActivity, android.R.layout.simple_spinner_dropdown_item, items)
        background = Ui.rounded(this@LogCatcherActivity, Ui.inner, Ui.innerStroke, 10f)
    }

    private fun selection(action: () -> Unit) = object : AdapterView.OnItemSelectedListener {
        override fun onNothingSelected(parent: AdapterView<*>?) {}
        override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) { action() }
    }

    private fun actionButton(text: String, color: Int, click: () -> Unit) = Ui.label(this, text, 13f, color, true).apply {
        gravity = Gravity.CENTER
        background = Ui.withRipple(this@LogCatcherActivity, Ui.rounded(this@LogCatcherActivity, Ui.inner, Ui.innerStroke, 12f), 12f)
        isClickable = true; setOnClickListener { click() }
    }

    private fun addRawEntry(line: String) {
        val v = Ui.label(this, line, 11f, Ui.muted)
        v.setPadding(Ui.dp(this, 8), Ui.dp(this, 7), Ui.dp(this, 8), Ui.dp(this, 7))
        list.addView(v)
    }

    private fun render() {
        if (!::list.isInitialized) return
        run {
            val names = listOf("All functions") + (if (showingHistory) historyLines.mapNotNull { storedFunction(it) } else entries.map { it.function }).distinct().sorted()
            if (names != functionOptions) {
                val old = functionFilter.selectedItem?.toString() ?: "All functions"
                functionOptions = names
                functionFilter.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, names)
                val pos = names.indexOf(old).coerceAtLeast(0)
                functionFilter.setSelection(pos, false)
            }
        }
        val fn = functionFilter.selectedItem?.toString() ?: "All functions"
        val level = levelFilter.selectedItem?.toString() ?: "All levels"
        val q = keyword.text?.toString()?.trim().orEmpty()
        list.removeAllViews()
        val source = entries.toList()
        val filtered = source.filter { (fn == "All functions" || it.function == fn) &&
            (level == "All levels" || it.level == level) &&
            (q.isEmpty() || it.message.contains(q, true) || it.function.contains(q, true) || it.line().contains(q, true)) }
        if (!showingHistory) {
            filtered.takeLast(300).asReversed().forEach { e ->
                val color = when (e.level) { "ERROR" -> Ui.bad; "WARNING" -> Ui.warn; else -> Ui.muted }
                val card = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(Ui.dp(this@LogCatcherActivity, 10), Ui.dp(this@LogCatcherActivity, 8),
                        Ui.dp(this@LogCatcherActivity, 10), Ui.dp(this@LogCatcherActivity, 8))
                    background = Ui.rounded(this@LogCatcherActivity, Ui.card, Ui.cardStroke, 9f)
                }
                card.addView(Ui.label(this, "${e.timestamp}  ${e.level}  ·  ${e.function}", 10f, color, true))
                card.addView(Ui.label(this, e.message, 12f, Ui.text).apply { setPadding(0, Ui.dp(this@LogCatcherActivity, 4), 0, 0) })
                list.addView(card, Ui.lp(-1, -2, 4, this))
            }
        }
        // Session history is shown as exact stored lines. Filter applies to stored text.
        if (showingHistory) {
            historyLines.filter { line ->
                (level == "All levels" || line.contains("[$level]")) &&
                (fn == "All functions" || storedFunction(line) == fn) &&
                (q.isEmpty() || line.contains(q, true))
            }.takeLast(1000).asReversed().forEach { addRawEntry(it) }
        }
        val count = if (showingHistory) "${historyLines.size} stored lines · ${selectedSession?.name ?: ""}" else "${filtered.size} visible · ${entries.size} recent"
        countLabel.text = count
    }

    private fun storedFunction(line: String): String? {
        val first = line.indexOf("] [")
        if (first < 0) return null
        val start = first + 3
        val end = line.indexOf(']', start)
        return if (end > start) line.substring(start, end) else null
    }
}

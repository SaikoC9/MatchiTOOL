package com.matchi.tool

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.widget.*
import java.io.File
import java.net.NetworkInterface

class MainActivity : Activity() {
    private lateinit var info: TextView
    private lateinit var status: TextView

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        writeStartScript()
        val svc = Intent(this, HostService::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc) else startService(svc)

        info = TextView(this).apply { textSize = 15f; setPadding(40, 40, 40, 10); setTextIsSelectable(true) }
        status = TextView(this).apply { textSize = 16f; setPadding(40, 10, 40, 10) }
        val copy = Button(this).apply { text = "Copy root setup command"; setOnClickListener { copySetup() } }
        val recheck = Button(this).apply { text = "Re-check root"; setOnClickListener { checkRoot() } }
        val reset = Button(this).apply { text = "Reset token"; setOnClickListener { Prefs.resetToken(this@MainActivity); render() } }
        val sv = ScrollView(this).apply {
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                addView(info); addView(status); addView(copy); addView(recheck); addView(reset)
            })
        }
        setContentView(sv)
        render(); checkRoot()
    }

    private fun startScript() = File(filesDir, "start.sh")

    /** start.sh is run by root: it starts the socat daemon whose socket only this app's uid can use. */
    private fun writeStartScript() {
        val d = filesDir.absolutePath
        val uid = Process.myUid()
        val s = """#!/system/bin/sh
D=$d
SOCK=${'$'}D/matchi_root.sock
S=/data/data/com.minikano.f50_sms/files/socat
i=0
while [ ! -x "${'$'}S" ] && [ ${'$'}i -lt 60 ]; do sleep 2; i=${'$'}((i+1)); done
[ -x "${'$'}S" ] || S=${'$'}(command -v socat)
[ -n "${'$'}S" ] || { echo "socat not found (UFI-TOOLS must be installed with advanced features on)"; exit 1; }
rm -f "${'$'}SOCK"
nohup "${'$'}S" UNIX-LISTEN:${'$'}SOCK,fork,user=$uid,mode=600 EXEC:/system/bin/sh >/dev/null 2>&1 &
echo started
"""
        startScript().writeText(s)
        startScript().setReadable(true, false)
    }

    private fun setupCommand(): String {
        val sp = startScript().absolutePath
        return "sh $sp; grep -q MATCHITOOL /sdcard/ufi_tools_boot.sh 2>/dev/null || printf '\\n# MATCHITOOL\\nsh $sp >/dev/null 2>&1 &\\n' >> /sdcard/ufi_tools_boot.sh"
    }

    private fun copySetup() {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("matchi", setupCommand()))
        Toast.makeText(this, "Copied. Paste it into a ROOT shell on the device, once.", Toast.LENGTH_LONG).show()
    }

    private fun checkRoot() {
        status.text = "Root: checking..."
        Thread {
            val ok = RootShell.isRoot(this)
            runOnUiThread { status.text = if (ok) "Root: OK" else "Root: NOT connected yet. Copy the setup command and run it in a root shell once." }
        }.start()
    }

    private fun render() {
        val ips = NetworkInterface.getNetworkInterfaces().toList().flatMap { it.inetAddresses.toList() }
            .filter { !it.isLoopbackAddress && it.address.size == 4 }.map { it.hostAddress }
        info.text = "MatchiTOOL\n\nOpen in a browser:\n" + ips.joinToString("\n") { "http://$it:${Prefs.PORT}" } +
            "\n\nAccess token:\n${Prefs.token(this)}\n\nThe token grants a ROOT shell. Do not share it."
    }
}

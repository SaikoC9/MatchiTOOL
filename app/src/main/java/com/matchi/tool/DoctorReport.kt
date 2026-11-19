package com.matchi.tool

import org.json.JSONObject

/** Reads the one-line JSON that `matchi-doctor` prints (see tools/doctor/README.md). */
object DoctorReport {
    class Parsed(val json: JSONObject, val checks: List<Doctor.Check>, val ok: Int, val warn: Int, val fail: Int, val skip: Int)

    /** Null when [output] holds no report or the report is not the shape the program writes. Never throws. */
    fun parse(output: String): Parsed? {
        val text = Doctor.jsonIn(output) ?: return null
        return try {
            val j = JSONObject(text)
            val s = j.getJSONObject("summary")
            val arr = j.getJSONArray("checks")
            val checks = (0 until arr.length()).map { i ->
                val c = arr.getJSONObject(i)
                Doctor.Check(c.getString("id"), c.optString("title", c.getString("id")), c.getString("status"), c.optString("detail"), c.optString("hint"))
            }
            Parsed(j, checks, s.optInt("ok"), s.optInt("warn"), s.optInt("fail"), s.optInt("skip"))
        } catch (e: Exception) { Quiet.note("DoctorReport.parse", e); null }
    }

    /** The section's text: the summary line, then one line per check. */
    fun section(p: Parsed): String = Doctor.summaryLine(p.ok, p.warn, p.fail, p.skip) + "\n" + Doctor.lines(p.checks)
}

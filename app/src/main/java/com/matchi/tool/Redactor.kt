package com.matchi.tool

/**
 * Hides private data in log text before it is exported or shared (pure Kotlin, no Android classes, unit tested).
 * Device-wide logs can hold SMS text, phone numbers, IMEI/IMSI/ICCID, passwords and session tokens. The rules lean towards
 * hiding too much: a redacted export is for sharing, the original files on the device are never changed.
 *
 * One instance per export: [counts] says what was hidden, so the archive can state it.
 */
class Redactor {
    val counts = LinkedHashMap<String, Int>()
    val total: Int get() = counts.values.sum()
    private fun hit(kind: String) { counts[kind] = (counts[kind] ?: 0) + 1 }

    /** [line] with private data replaced by markers such as [REDACTED], [IMEI] or [SMS redacted]. */
    fun line(line: String): String {
        if (line.isEmpty()) return line
        var s = line

        // 1. SMS: AT replies and commands carry the number, time and text. Keep the command, drop the rest of the line.
        SMS_AT.find(s)?.let { m -> hit("sms"); s = s.substring(0, m.range.last + 1) + " [SMS redacted]"; return s }
        SMS_BODY.find(s)?.let { m -> hit("sms"); s = s.substring(0, m.groups[1]!!.range.last + 1) + "=[SMS redacted]"; return s }

        // 2. Secrets: Bearer/Basic values, then key=value / key: value pairs.
        s = BEARER.replace(s) { hit("token"); "${it.groupValues[1]} [REDACTED]" }
        s = SECRET_KV.replace(s) { hit("secret"); "${it.groupValues[1]}${it.groupValues[2]}[REDACTED]" }

        // 3. Identifiers: labelled values, then bare numbers that look like an IMEI (Luhn) or an ICCID.
        s = ID_KV.replace(s) { hit("identifier"); "${it.groupValues[1]}${it.groupValues[2]}[ID]" }
        s = IMEI_BARE.replace(s) { if (luhn(it.value)) { hit("imei"); "[IMEI]" } else it.value }
        s = ICCID_BARE.replace(s) { hit("iccid"); "[ICCID]" }

        // 4. Phone numbers in international format.
        s = PHONE.replace(s) { hit("phone"); "[PHONE]" }

        // 5. Long hex runs on lines that talk about messages (PDU dumps).
        if (PDU_CONTEXT.containsMatchIn(s)) s = HEX_RUN.replace(s) { hit("hex"); "[HEX redacted]" }
        return s
    }

    /** Whole text, line by line (keeps the line separators it finds). */
    fun text(text: String): String = text.split("\n").joinToString("\n") { line(it) }

    /** One line per category with its count, for a note inside the archive. */
    fun summary(): String =
        if (counts.isEmpty()) "Nothing needed redaction."
        else counts.entries.joinToString("\n") { "${it.key}: ${it.value} line(s) changed" }

    companion object {
        private val SMS_AT = Regex("""(?i)\+(CMGR|CMGL|CMT|CDS|CMGS|CMGW)\s*[:=]|\bAT\+(CMGS|CMGW|CMGR|CMGL)\b\s*=?""")
        private val SMS_BODY = Regex("""(?i)\b(sms_?body|sms_?text|message_?body|body)\s*[=:]\s*\S""")
        private val BEARER = Regex("""(?i)\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}""")
        private val SECRET_KV = Regex(
            """(?i)\b(password|passwd|pwd|passphrase|secret|token|api[_-]?key|authorization|cookie|x-token|session[_-]?id|access[_-]?key)(\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?("[^"]*"|'[^']*'|[^\s,;&"']+)""")
        private val ID_KV = Regex("""(?i)\b(imei(?:sv)?|imsi|iccid|meid|msisdn|serial(?:no)?)(\s*[:=]\s*)([0-9A-Za-z]{6,})""")
        private val IMEI_BARE = Regex("""(?<![0-9A-Za-z])\d{15}(?![0-9A-Za-z])""")
        private val ICCID_BARE = Regex("""(?<![0-9A-Za-z])89\d{17,18}(?![0-9A-Za-z])""")
        private val PHONE = Regex("""(?<![\w.+])\+\d{8,15}(?!\d)""")
        private val HEX_RUN = Regex("""(?<![0-9A-Fa-f])[0-9A-Fa-f]{40,}(?![0-9A-Fa-f])""")
        private val PDU_CONTEXT = Regex("""(?i)pdu|sms|cmg|cmt|cds""")

        /** True when the digit string passes the Luhn check (IMEI numbers do). */
        fun luhn(d: String): Boolean {
            if (d.isEmpty() || d.any { it !in '0'..'9' }) return false
            var sum = 0
            var alt = false
            for (i in d.length - 1 downTo 0) {
                var n = d[i] - '0'
                if (alt) { n *= 2; if (n > 9) n -= 9 }
                sum += n; alt = !alt
            }
            return sum % 10 == 0
        }
    }
}

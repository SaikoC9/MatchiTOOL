package com.matchi.tool

import android.content.Context
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import android.util.Log

object Prefs {
    private fun sp(c: Context) = c.getSharedPreferences("matchi", Context.MODE_PRIVATE)
    fun disabled(c: Context): Set<String> = sp(c).getStringSet("disabled", emptySet())!!.toSet()
    fun setEnabled(c: Context, name: String, enabled: Boolean) {
        val d = disabled(c).toMutableSet()
        if (enabled) d.remove(name) else d.add(name)
        sp(c).edit().putStringSet("disabled", d).apply()
    }
    /** Plugin load order (JSON array of file names) and display titles (JSON object, file name to title) for plugins. */
    fun pluginOrder(c: Context): List<String> = parsePluginOrder(sp(c).getString("plugin_order", null))
    fun setPluginOrder(c: Context, names: List<String>) {
        sp(c).edit().putString("plugin_order", org.json.JSONArray(names.distinct()).toString()).apply()
    }
    fun pluginTitles(c: Context): Map<String, String> = parsePluginTitles(sp(c).getString("plugin_titles", null))
    fun setPluginTitle(c: Context, name: String, title: String?) {
        val m = pluginTitles(c).toMutableMap()
        if (title.isNullOrBlank()) m.remove(name) else m[name] = title
        sp(c).edit().putString("plugin_titles", org.json.JSONObject(m as Map<*, *>).toString()).apply()
    }
    /** What was approved for each plugin: its SHA-256 and the capabilities shown at install (see PluginIntegrity). Tamper evidence, not protection from a running plugin. */
    internal fun pluginRecords(c: Context): Map<String, PluginRecord> = parsePluginRecords(sp(c).getString("plugin_records", null))
    // Read, change, write: two installs at once could otherwise lose one record, and a lost record shows as "not tracked".
    @Synchronized internal fun setPluginRecord(c: Context, name: String, rec: PluginRecord?) {
        val m = pluginRecords(c).toMutableMap()
        if (rec == null) m.remove(name) else m[name] = rec
        sp(c).edit().putString("plugin_records", encodePluginRecords(m)).apply()
    }
    /** Which plugins run sandboxed (Phase 4, see PluginSandbox). A plugin not in the map is trusted: it runs in the page, as before. */
    internal fun pluginModes(c: Context): Map<String, String> = parsePluginModes(sp(c).getString("plugin_modes", null))
    @Synchronized internal fun setPluginSandboxed(c: Context, name: String, sandboxed: Boolean) {
        val m = pluginModes(c).toMutableMap()
        if (sandboxed) m[name] = "sandbox" else m.remove(name)
        sp(c).edit().putString("plugin_modes", encodePluginModes(m)).apply()
    }
    /** Forget a deleted plugin's place in the order, its title, its approved record and its sandbox mode. */
    fun forgetPlugin(c: Context, name: String) {
        setPluginOrder(c, pluginOrder(c).filter { it != name })
        setPluginTitle(c, name, null)
        setPluginRecord(c, name, null)
        setPluginSandboxed(c, name, false)
    }
    /** Network rules for plugins (see NetPolicy): strict mode on or off, and the hosts the person added to the allow-list. */
    fun netStrict(c: Context): Boolean = sp(c).getBoolean("net_strict", true)
    fun setNetStrict(c: Context, v: Boolean) { sp(c).edit().putBoolean("net_strict", v).apply() }
    fun netHosts(c: Context): List<String> = NetPolicy.parse(sp(c).getString("net_hosts", null))
    fun setNetHosts(c: Context, hosts: List<String>) {
        sp(c).edit().putString("net_hosts", org.json.JSONArray(NetPolicy.cleanList(hosts)).toString()).apply()
    }
    /** True once the root temp files that older versions left in /data/local/tmp have been deleted (see HostService.cleanOldTmpFiles). */
    fun oldTmpCleaned(c: Context): Boolean = sp(c).getBoolean("old_tmp_cleaned", false)
    fun setOldTmpCleaned(c: Context) { sp(c).edit().putBoolean("old_tmp_cleaned", true).apply() }
    /** Root actions from another device while the console runs over plain HTTP (HTTPS could not start). Off by default; see RootGate.insecureRefused. */
    fun rootOverHttp(c: Context): Boolean = sp(c).getBoolean("root_over_http", false)
    fun setRootOverHttp(c: Context, v: Boolean) { sp(c).edit().putBoolean("root_over_http", v).apply() }
    fun seededVersion(c: Context): Int = sp(c).getInt("seeded", 0)
    /** App versionCode for which the Android key store was seen to break the TLS handshake (0 = never). Tried again after an update. */
    fun tlsKeystoreBrokenVersion(c: Context): Int = sp(c).getInt("tls_ks_broken", 0)
    fun setTlsKeystoreBrokenVersion(c: Context, v: Int) { sp(c).edit().putInt("tls_ks_broken", v).apply() }
    fun setSeededVersion(c: Context, v: Int) { sp(c).edit().putInt("seeded", v).apply() }
    // ZTE web-admin access (used by the SMS / signal plugins through /api/zte)
    // Only local-network IPv4 addresses (see RouterHost): the router admin password is sent there. A stored value that
    // does not pass (an older build allowed any host name) falls back to the default gateway address.
    fun zteHost(c: Context): String = sp(c).getString("zte_host", null)?.takeIf { RouterHost.isValid(it) } ?: "192.168.0.1"
    fun setZteHost(c: Context, h: String) {
        require(RouterHost.isValid(h)) { "router address must be a local IPv4 address such as 192.168.0.1 (optionally :port)" }
        sp(c).edit().putString("zte_host", h).apply()
    }
    private const val ZTE_PASS_ENC = "zte_pass_enc"
    private const val ZTE_PASS_LEGACY = "zte_pass"
    private const val STORAGE_RESET = "zte_pass_reset"
    private const val ZTE_KEY_ALIAS = "matchitool_router_credential_v1"

    private fun credentialKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = try { ks.getKey(ZTE_KEY_ALIAS, null) as? SecretKey } catch (e: Exception) {
            // An invalidated key can never work again. Remove it so a NEW key can be made and a re-entered password is encrypted
            // again (otherwise saving would fail the same way and fall back to plain text).
            if (e is java.security.UnrecoverableKeyException || e is android.security.keystore.KeyPermanentlyInvalidatedException) {
                try { ks.deleteEntry(ZTE_KEY_ALIAS) } catch (e: Exception) { Quiet.note("Prefs.credentialKey", e) }
                null
            } else throw e
        }
        existing?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder(ZTE_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build())
        return gen.generateKey()
    }

    private fun encryptCredential(value: String): String? = try {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, credentialKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)
    } catch (_: Exception) { null }

    /** [decryptCredential] returns the password, [GONE] (can never be read again) or [RETRY] (transient error: keep the blob). */
    private const val GONE = "\u0000gone"
    private const val RETRY = "\u0000retry"

    private fun decryptCredential(value: String): String? = try {
        val all = Base64.decode(value, Base64.NO_WRAP)
        if (all.size <= 12) throw IllegalArgumentException("invalid encrypted credential")
        val iv = all.copyOfRange(0, 12)
        val encrypted = all.copyOfRange(12, all.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, credentialKey(), GCMParameterSpec(128, iv))
        String(cipher.doFinal(encrypted), Charsets.UTF_8)
    } catch (e: Exception) {
        LogCatcher.log("WARNING", "Prefs", "Router password could not be decrypted: ${e.javaClass.simpleName}")
        // Only errors that mean "this blob can never work again" may lead to deleting it. Any other error (Keystore not ready
        // early after boot, provider hiccup) must keep the blob so the next call can succeed.
        val permanent = e is javax.crypto.AEADBadTagException || e is java.security.UnrecoverableKeyException ||
            e is android.security.keystore.KeyPermanentlyInvalidatedException || e is IllegalArgumentException
        if (permanent) GONE else RETRY
    }

    /** Router credentials are encrypted with an Android Keystore AES-GCM key. Existing plaintext installs migrate on read. */
    @Synchronized fun ztePass(c: Context): String {
        val prefs = sp(c)
        prefs.getString(ZTE_PASS_ENC, null)?.let { blob ->
            val d = decryptCredential(blob)
            if (d == RETRY) return ""   // transient: report "no password" for now, keep the saved blob
            if (d != null && d != GONE) return d
            // The Keystore key was invalidated (restore, lock-screen change on some ROMs): the blob can never be read, so drop it
            // and remember that, instead of silently keeping an unusable value and an empty password forever.
            LogCatcher.log("WARNING", "Prefs", "Router password storage was reset: the saved password cannot be decrypted. Enter it again.")
            prefs.edit().remove(ZTE_PASS_ENC).putBoolean(STORAGE_RESET, true).apply()
            return ""
        }
        val legacy = prefs.getString(ZTE_PASS_LEGACY, "") ?: ""
        if (legacy.isNotEmpty()) {
            val encrypted = encryptCredential(legacy)
            if (encrypted != null) prefs.edit().putString(ZTE_PASS_ENC, encrypted).remove(ZTE_PASS_LEGACY).apply()
        }
        return legacy
    }

    /** True when Keystore encryption failed and the router password sits in plain preferences (shown as a warning in the console). */
    fun passwordStoredInClear(c: Context): Boolean = !sp(c).getString(ZTE_PASS_LEGACY, "").isNullOrEmpty()

    /** True after a saved password had to be discarded because it could not be decrypted; cleared when a new one is saved. */
    fun passwordStorageReset(c: Context): Boolean = sp(c).getBoolean(STORAGE_RESET, false)

    /** Saves the router password encrypted. Returns false (and saves NOTHING) when the Android key store cannot encrypt it: it is never stored in clear. */
    @Synchronized fun setZtePass(c: Context, p: String): Boolean {
        val prefs = sp(c)
        if (p.isEmpty()) {
            prefs.edit().remove(ZTE_PASS_ENC).remove(ZTE_PASS_LEGACY).apply()
            return true
        }
        val encrypted = encryptCredential(p)
        if (encrypted == null) {
            LogCatcher.log("WARNING", "Prefs", "Keystore encryption failed: the router password was NOT saved (it is never stored unencrypted)")
            return false
        }
        prefs.edit().remove(STORAGE_RESET).putString(ZTE_PASS_ENC, encrypted).remove(ZTE_PASS_LEGACY).apply()
        return true
    }
    // Web console password. By default it is the router's own admin password (one password, also used by the SMS / signal
    // tools to log in to the router). The owner can set a SEPARATE console password (at least [MIN_CONSOLE_PW] characters);
    // from then on only that one signs in to the console, and wrong guesses are never forwarded to the router.
    // It is stored as a salted PBKDF2 hash, never in clear. Until one password exists nobody can sign in.
    const val MIN_CONSOLE_PW = 10
    private const val CONSOLE_PW = "console_pw"
    private const val CONSOLE_PW_ITER = 310_000   // was 120_000; older hashes are re-made at the next good sign-in (see checkConsolePassword)

    fun hasConsolePassword(c: Context): Boolean = !sp(c).getString(CONSOLE_PW, null).isNullOrEmpty()

    private fun pbkdf2(pw: String, salt: ByteArray, iter: Int): ByteArray =
        javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            .generateSecret(javax.crypto.spec.PBEKeySpec(pw.toCharArray(), salt, iter, 256)).encoded

    /** null or empty removes the separate password (the router password signs in again); a too short one is refused with an exception. */
    @Synchronized fun setConsolePassword(c: Context, pw: String?) {
        if (pw.isNullOrEmpty()) { sp(c).edit().remove(CONSOLE_PW).apply(); return }
        if (pw.length < MIN_CONSOLE_PW) throw IllegalArgumentException("The console password needs at least $MIN_CONSOLE_PW characters")
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val h = pbkdf2(pw, salt, CONSOLE_PW_ITER)
        sp(c).edit().putString(CONSOLE_PW, "$CONSOLE_PW_ITER:" + Base64.encodeToString(salt, Base64.NO_WRAP) + ":" + Base64.encodeToString(h, Base64.NO_WRAP)).apply()
    }

    /** Re-makes the hash only while the stored value is still the one that was just checked: the slow PBKDF2 run must not overwrite a password changed meanwhile. */
    @Synchronized private fun rehashIfUnchanged(c: Context, pw: String, checkedAgainst: String) {
        if (sp(c).getString(CONSOLE_PW, "") == checkedAgainst) setConsolePassword(c, pw)
    }

    private fun checkConsolePassword(c: Context, pw: String): Boolean = try {
        val stored = sp(c).getString(CONSOLE_PW, "")!!
        val parts = stored.split(":")
        if (parts.size != 3) false
        else {
            val iter = parts[0].toInt()
            val ok = MessageDigest.isEqual(Base64.decode(parts[2], Base64.NO_WRAP), pbkdf2(pw, Base64.decode(parts[1], Base64.NO_WRAP), iter))
            // The password is known to be right here, so a hash made with fewer iterations is replaced by one with the current count.
            if (ok && iter < CONSOLE_PW_ITER) {
                try { rehashIfUnchanged(c, pw, stored) } catch (e: Exception) { Quiet.note("Prefs.rehash", e) }
            }
            ok
        }
    } catch (_: Exception) { false }

    fun hasAdminPassword(c: Context): Boolean = hasConsolePassword(c) || ztePass(c).isNotEmpty()
    fun checkAdminPassword(c: Context, pw: String): Boolean {
        if (hasConsolePassword(c)) return checkConsolePassword(c, pw)
        val saved = ztePass(c)
        return saved.isNotEmpty() && MessageDigest.isEqual(saved.toByteArray(Charsets.UTF_8), pw.toByteArray(Charsets.UTF_8))
    }
    const val PORT = 2334
}

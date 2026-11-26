package com.matchi.tool

/**
 * Pure logic for installing the uninstall reaper (no Android classes, unit tested; docs/UNINSTALL_WIPE.md, plan Phase 4): where its files live,
 * the version header of the shipped script, and the three root scripts the app runs (install, remove, status). Same pattern as [BootLogdModel].
 *
 * Install is ONE root call: it writes the reaper to /data/local/matchitool/reaper/ (outside the app sandbox), writes a tiny boot stub to Magisk's
 * service.d, stops an older copy and starts the new one as a detached root daemon (setsid + nohup; Android kills app-uid processes on uninstall,
 * not uid 0). The daemon itself decides when the app is gone (see matchi_reaper.sh); nothing here ever wipes anything.
 *
 * Shell text uses the section sign for a dollar sign so the raw strings stay readable; it is replaced before anything runs.
 * scripts/test_reaper_install.sh runs the real [INSTALL_TEMPLATE] against a fake root folder.
 */
object ReaperModel {
    const val BASE_DIR = Footprint.BASE_DIR
    const val DIR = "$BASE_DIR/reaper"
    const val SCRIPT_PATH = "$DIR/matchi_reaper.sh"
    const val PID_FILE = "$DIR/watch.pid"

    /** Boot stub in Magisk/KernelSU service.d. Also listed in [Footprint.BOOT_STUBS]. */
    const val STUB_PATH = "/data/adb/service.d/matchi_reaper.sh"

    /** Written by ApkUpdater (unix seconds) before an update or downgrade; the reaper does nothing while it is younger than 10 minutes. */
    const val UPDATING_MARKER = "$BASE_DIR/updating"

    const val STUB_VERSION = 1
    const val SCRIPT_MARK = "@@REAPER_SCRIPT@@"
    const val SIZE_MARK = "@@SIZE@@"
    const val EOF_MARK = "MATCHI_REAPER_EOF"

    private val versionRx = Regex("^# MATCHI_REAPER_VERSION=(\\d+)\\s*$", RegexOption.MULTILINE)

    /** The "# MATCHI_REAPER_VERSION=n" header of a script text, or null. */
    fun scriptVersion(text: String): Int? = versionRx.find(text.take(2000))?.groupValues?.get(1)?.toIntOrNull()

    /** True when nothing (or something older than the shipped script) is installed, or the boot stub is missing or old. */
    fun needsReinstall(installed: Int?, bundled: Int?): Boolean = bundled != null && (installed == null || installed < bundled)

    /** Same rule for the stub text: its "# MATCHI_REAPER_STUB=n" header must equal [STUB_VERSION]. */
    fun stubCurrent(installedStub: Int?): Boolean = installedStub == STUB_VERSION

    /**
     * The one root call that installs and starts the reaper, or null when the script is not usable (no version header, or it contains the
     * here-document end line). The script is written to a temp name, its size is checked, and only then does it replace the old file with mv
     * (a running old copy keeps its own inode), so a cut-off write never leaves a broken reaper behind.
     */
    fun installCommand(script: String): String? {
        val body = script.trimEnd('\n')
        if (scriptVersion(body) == null || body.contains(EOF_MARK) || body.contains("MATCHI_STUB_EOF")) return null
        val size = body.toByteArray(Charsets.UTF_8).size + 1   // the here-document adds the final newline
        return INSTALL_TEMPLATE.replace('\u00a7', '$').replace(SIZE_MARK, size.toString()).replace(SCRIPT_MARK, body)
    }

    /** Stops the daemon and removes the boot stub and the reaper folder (switch OFF). Nothing outside the reaper's own two places is touched. */
    fun removeCommand(): String = REMOVE_SCRIPT.replace('\u00a7', '$')

    /** Prints INSTALLED_SCRIPT, INSTALLED_VERSION, RUNNING, STUB, STUB_VERSION as KEY=value lines. */
    fun statusCommand(): String = STATUS_SCRIPT.replace('\u00a7', '$')

    /**
     * Shell lines for ApkUpdater: write the "update in progress" timestamp. The old file is removed first and the new one is created with
     * noclobber, so a planted link is never followed. Needs [BASE_DIR] to exist (the updater creates its tmp folder below it first).
     */
    fun updatingMarkerCommand(): String = "rm -f $UPDATING_MARKER; ( set -C; date +%s > $UPDATING_MARKER ) 2>/dev/null; chmod 600 $UPDATING_MARKER 2>/dev/null"

    data class Status(val installed: Boolean, val version: Int?, val running: Boolean, val stub: Boolean, val stubVersion: Int?)

    fun parseStatus(out: String): Status {
        val m = out.lineSequence().mapNotNull { l -> val i = l.indexOf('='); if (i > 0) l.substring(0, i).trim() to l.substring(i + 1).trim() else null }.toMap()
        return Status(m["INSTALLED_SCRIPT"] == "1", m["INSTALLED_VERSION"]?.toIntOrNull(), m["RUNNING"] == "1", m["STUB"] == "1", m["STUB_VERSION"]?.toIntOrNull())
    }

    /**
     * Shell function (as text) that sets RUN=1 when the pid in watch.pid is a live reaper. Shared by the install, remove and status scripts.
     * The command line comes from `ps -A -o PID,ARGS`, never from /proc/PID/cmdline: on the F50 kernel a tr/cat/grep read of that file never
     * reaches end of file and tr stays at 100% CPU (docs/PLUGIN_RULES.md rule 2; scripts/lint_resource_rules.py R3).
     */
    private const val RUNNING_FN = """
isrun() {
  RUN=0; f=§D/watch.pid
  [ -f "§f" ] || return 0
  p=§(head -n 1 "§f" 2>/dev/null)
  case §p in ''|*[!0-9]*) return 0;; esac
  [ "§p" = "§§" ] && return 0
  kill -0 §p 2>/dev/null || return 0
  T=§(command -v timeout 2>/dev/null) && T='timeout 6'
  a=§(§T ps -A -o PID,ARGS 2>/dev/null | while read -r q r; do [ "§q" = "§p" ] && { echo "§r"; break; }; done)
  case "§a" in *matchi_reaper*) RUN=1;; esac
  return 0
}
stopold() {
  isrun
  if [ "§RUN" = 1 ]; then
    kill §p 2>/dev/null; sleep 1
    kill -0 §p 2>/dev/null && kill -9 §p 2>/dev/null
  fi
  rm -f §D/watch.pid
  return 0
}
"""

    private const val INSTALL_TEMPLATE = """
B=/data/local/matchitool
D=§B/reaper
S=§D/matchi_reaper.sh
STUB=/data/adb/service.d/matchi_reaper.sh
fail() { echo "ERROR=§1"; exit 0; }
$RUNNING_FN
if [ ! -d /data/adb/magisk ] && [ ! -d /data/adb/ksu ] && [ ! -d /data/adb/ap ]; then echo 'NOTE=No Magisk folder found; the watcher keeps running only until the next reboot'; fi
[ -L §B ] && fail 'matchitool folder is a symlink'
mkdir -p §B /data/adb/service.d || fail 'cannot create folders'
[ -L §B ] && fail 'matchitool folder is a symlink'
[ -L §D ] && fail 'reaper folder is a symlink'
mkdir -p §D || fail 'cannot create the reaper folder'
[ -L §D ] && fail 'reaper folder is a symlink'
chown 0:0 §B §D 2>/dev/null
chmod go-w §B 2>/dev/null
chmod 700 §D 2>/dev/null
[ "§(stat -c %u §B 2>/dev/null)" = 0 ] || fail 'matchitool folder is not owned by root'
[ "§(stat -c %u §D 2>/dev/null)" = 0 ] || fail 'reaper folder is not owned by root'
rm -f §S.new §STUB.new
cat > "§S.new" <<'MATCHI_REAPER_EOF'
@@REAPER_SCRIPT@@
MATCHI_REAPER_EOF
chmod 700 "§S.new" 2>/dev/null; chown 0:0 "§S.new" 2>/dev/null
[ "§(wc -c < "§S.new" 2>/dev/null)" = @@SIZE@@ ] || { rm -f "§S.new"; fail 'reaper file was not written completely'; }
cat > "§STUB.new" <<'MATCHI_STUB_EOF'
#!/system/bin/sh
# MATCHI_REAPER_STUB=1
# MatchiTOOL uninstall reaper: boot stub. Starts the watcher at boot. Removes itself when the watcher file is gone.
S=/data/local/matchitool/reaper/matchi_reaper.sh
P=/data/adb/service.d/matchi_reaper.sh
[ -d /data/local ] || exit 0
if [ ! -f "§S" ]; then rm -f "§P" 2>/dev/null; exit 0; fi
if command -v setsid >/dev/null 2>&1; then SS=setsid; else SS=; fi
§SS nohup sh "§S" watch </dev/null >/dev/null 2>&1 &
exit 0
MATCHI_STUB_EOF
chmod 755 "§STUB.new" 2>/dev/null; chown 0:0 "§STUB.new" 2>/dev/null
stopold
mv "§S.new" "§S" || { rm -f "§S.new" "§STUB.new"; fail 'cannot write the reaper'; }
mv "§STUB.new" "§STUB" || { rm -f "§STUB.new"; fail 'cannot write the boot stub'; }
chcon u:object_r:magisk_file:s0 "§STUB" 2>/dev/null
if command -v setsid >/dev/null 2>&1; then SS=setsid; else SS=; fi
§SS nohup sh "§S" watch </dev/null >/dev/null 2>&1 &
i=0; RUN=0
while [ §i -lt 6 ]; do sleep 1; isrun; [ "§RUN" = 1 ] && break; i=§((i + 1)); done
echo INSTALLED=1
echo RUNNING=§RUN
"""

    private const val REMOVE_SCRIPT = """
D=/data/local/matchitool/reaper
STUB=/data/adb/service.d/matchi_reaper.sh
$RUNNING_FN
stopold
rm -f §STUB
[ -L §D ] && rm -f §D || rm -rf §D
echo REMOVED=1
"""

    private const val STATUS_SCRIPT = """
D=/data/local/matchitool/reaper
S=§D/matchi_reaper.sh
STUB=/data/adb/service.d/matchi_reaper.sh
$RUNNING_FN
if [ -f §S ]; then
  echo INSTALLED_SCRIPT=1
  sed -n 's/^# MATCHI_REAPER_VERSION=/INSTALLED_VERSION=/p' §S | head -n 1
fi
isrun
echo RUNNING=§RUN
if [ -f §STUB ]; then
  echo STUB=1
  sed -n 's/^# MATCHI_REAPER_STUB=/STUB_VERSION=/p' §STUB | head -n 1
else
  echo STUB=0
fi
"""
}

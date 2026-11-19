package com.matchi.tool

/**
 * The two ways the Live panel's root reader can run: the shell loop in [LiveScript] (the default) or the bundled `matchi-sampler`
 * program (tools/sampler), which prints the same line without starting a child process per round. Plain Kotlin, no Android classes,
 * so it is unit tested. The setting and the file checks are in [LiveEngineSetting].
 *
 * The program is only ever started by its full path inside the app's files folder, and only after [BinaryCheck.problem] said that the
 * file is the one the app was built with. If it gives no readings twice in a row, [LiveSampler] goes back to the shell loop by itself.
 */
object LiveEngine {
    /** Name in assets/bin, in the files folder and in [BinaryHashes]. */
    const val BINARY = "matchi-sampler"

    /** The value of [LiveShell.engine] for a reader that runs the program. */
    const val ENGINE_BINARY = "binary"
    const val ENGINE_SHELL = "shell"

    /** How many readers in a row may end without a single reading before the shell loop is used instead. */
    const val BINARY_TRIES = 2

    // An absolute path made of plain characters only. The app's own files folder always is (/data/data/<package>/files/matchi-sampler),
    // so this never refuses a real path; it is here so that nothing odd can ever end up inside the quotes below.
    private val SAFE_PATH = Regex("^/[A-Za-z0-9_./-]{1,200}$")

    fun pathIsSafe(path: String): Boolean = SAFE_PATH.matches(path) && !path.contains("..")

    /**
     * The text handed to `su -c` to run the program: fixed flags and numbers, the path in single quotes, stdin from /dev/null.
     * Null when [path] is not a plain absolute path.
     */
    fun command(path: String, rounds: Int = LiveScript.MAX_ROUNDS, sleepSec: Int = 1): String? {
        if (!pathIsSafe(path)) return null
        return "exec '$path' -rounds ${rounds.coerceIn(1, 100_000)} -sleep ${sleepSec.coerceIn(1, 60)} -sys-every ${LiveScript.SYS_EVERY} </dev/null"
    }

    /** True when the program should be used for the next reader start: the setting is on and the file passed the hash check ([problem] is null). */
    fun useBinary(enabled: Boolean, problem: String?): Boolean = enabled && problem == null
}

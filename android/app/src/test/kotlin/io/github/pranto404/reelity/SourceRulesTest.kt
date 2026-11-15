package io.github.pranto404.reelity

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Static privacy rules on the Kotlin sources (ARCHITECTURE section 11), checked with comments removed:
 * - code in an `a11y` package never reads what is on screen or typed: no text, descriptions, hints, titles,
 *   state descriptions or screenshots, only ids, classes and geometry;
 * - no networking code anywhere (the app also has no INTERNET permission).
 */
class SourceRulesTest {
    private val sourceRoots = listOf("src/main/kotlin", "src/debug/kotlin", "src/release/kotlin").map(::File)

    private val bannedInA11y = listOf(
        Regex("""\.text\b"""),
        Regex("""\bgetText\s*\("""),
        Regex("""\btextSelection"""),
        Regex("""contentDescription""", RegexOption.IGNORE_CASE),
        Regex("""hintText""", RegexOption.IGNORE_CASE),
        Regex("""stateDescription""", RegexOption.IGNORE_CASE),
        Regex("""paneTitle""", RegexOption.IGNORE_CASE),
        Regex("""tooltipText""", RegexOption.IGNORE_CASE),
        Regex("""\.title\b"""),
        Regex("""\bgetTitle\s*\("""),
        Regex("""takeScreenshot"""),
        Regex("""\bextras\b"""),
    )

    private val bannedEverywhere = listOf(
        Regex("""\bjava\.net\b"""),
        Regex("""HttpURLConnection"""),
        Regex("""\bSocket\b"""),
        Regex("""\bWebView\b"""),
        Regex("""\bURL\("""),
    )

    private fun kotlinFiles(): List<File> =
        sourceRoots.filter(File::isDirectory).flatMap { root -> root.walkTopDown().filter { it.extension == "kt" }.toList() }

    /** Removes block and line comments (good enough for our own sources; no comment markers inside strings). */
    private fun code(file: File): String =
        file.readText()
            .replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
            .replace(Regex("""//[^\n]*"""), "")

    @Test
    fun sourcesAreFound() {
        assertTrue("no Kotlin sources found; is the working directory the module?", kotlinFiles().size > 3)
        assertTrue(
            "the accessibility code must live in an a11y package",
            kotlinFiles().any { it.parentFile.name == "a11y" },
        )
    }

    @Test
    fun accessibilityCodeReadsNoScreenContent() {
        val problems = kotlinFiles().filter { it.parentFile.name == "a11y" }.flatMap { file ->
            val code = code(file)
            bannedInA11y.filter { it.containsMatchIn(code) }.map { "${file.path}: ${it.pattern}" }
        }
        assertTrue("Screen-content APIs in a11y code:\n" + problems.joinToString("\n"), problems.isEmpty())
    }

    @Test
    fun noNetworkingCode() {
        val problems = kotlinFiles().flatMap { file ->
            val code = code(file)
            bannedEverywhere.filter { it.containsMatchIn(code) }.map { "${file.path}: ${it.pattern}" }
        }
        assertTrue("Networking code found:\n" + problems.joinToString("\n"), problems.isEmpty())
    }
}

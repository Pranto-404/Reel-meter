package io.github.pranto404.reelity

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Test
import org.w3c.dom.Element

// English and Bangla ship together (ROADMAP section 0), so every translatable English string needs a Bangla one.
// Unit tests run with the module directory as the working directory.
class StringsTest {

    private fun translatableNames(path: String): Set<String> {
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(File(path))
        val nodes = doc.getElementsByTagName("string")
        return (0 until nodes.length)
            .map { nodes.item(it) as Element }
            .filter { it.getAttribute("translatable") != "false" }
            .map { it.getAttribute("name") }
            .toSet()
    }

    @Test
    fun banglaHasEveryTranslatableString() {
        for (sourceSet in listOf("main", "debug")) {
            assertEquals(
                "strings of src/$sourceSet",
                translatableNames("src/$sourceSet/res/values/strings.xml"),
                translatableNames("src/$sourceSet/res/values-bn/strings.xml"),
            )
        }
    }
}

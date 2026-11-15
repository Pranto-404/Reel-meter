package io.github.pranto404.reelity

import io.github.pranto404.reelity.core.detect.TargetApps
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

/** The accessibility configuration stays as narrow as ARCHITECTURE section 3 promises. */
class A11yConfigTest {
    private val androidNs = "http://schemas.android.com/apk/res/android"

    private fun parse(path: String) = DocumentBuilderFactory.newInstance()
        .apply { isNamespaceAware = true }
        .newDocumentBuilder()
        .parse(File(path))

    private val config: Element = parse("src/debug/res/xml/detection_service.xml").documentElement

    private fun attr(name: String): String = config.getAttributeNS(androidNs, name)

    @Test
    fun listensOnlyToTheTargetApps() {
        assertEquals(TargetApps.packages.keys, attr("packageNames").split(',').map(String::trim).toSet())
    }

    @Test
    fun manifestQueriesMatchTheTargetApps() {
        val packages = parse("src/debug/AndroidManifest.xml").getElementsByTagName("package")
        val names = (0 until packages.length).map { (packages.item(it) as Element).getAttributeNS(androidNs, "name") }
        assertEquals(TargetApps.packages.keys, names.toSet())
    }

    @Test
    fun onlyTheNeededEventsAndNoExtraPowers() {
        assertEquals(
            setOf("typeWindowStateChanged", "typeWindowContentChanged", "typeViewScrolled", "typeViewClicked"),
            attr("accessibilityEventTypes").split('|').toSet(),
        )
        assertTrue(attr("accessibilityFlags").split('|').contains("flagReportViewIds"))
        assertEquals("true", attr("canRetrieveWindowContent"))
        for (power in listOf("canPerformGestures", "canRequestFilterKeyEvents", "canTakeScreenshot", "isAccessibilityTool")) {
            assertFalse("$power must not be set", config.hasAttributeNS(androidNs, power))
        }
        assertTrue("notificationTimeout keeps CPU low", attr("notificationTimeout").toInt() >= 200)
    }
}

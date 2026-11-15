package io.github.pranto404.reelity.core.detect

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class CaptureJsonTest {

    @Test
    fun nodeIsCompactAndOmitsEmptyFields() {
        val leaf = Node(null, null, Bounds(1, 2, 3, 4), visible = false, scrollable = false, childCount = 0)
        assertEquals("""{"b":[1,2,3,4],"vis":false,"n":0}""", CaptureJson.node(leaf))
    }

    @Test
    fun windowParsesBackAsJson() {
        val pager = Node("a:id/pager", "androidx.viewpager2.widget.ViewPager2", Bounds(0, 0, 10, 20), true, true, 3)
        val root = Node(null, "android.widget.FrameLayout", Bounds(0, 0, 10, 20), true, false, 1, listOf(pager))
        val w = WindowSnapshot(
            packageName = "com.instagram.android", windowClass = "com.instagram.mainactivity.MainActivity",
            windowType = 1, bounds = Bounds(0, 0, 10, 20), active = true, focused = false, pictureInPicture = false,
            root = root, truncated = true, capturedAtMillis = 1_763_200_000_000,
        )
        val json = Json.parseToJsonElement(CaptureJson.window(w)).jsonObject
        assertEquals("com.instagram.android", json["package"]!!.jsonPrimitive.content)
        assertEquals(true, json["truncated"]!!.jsonPrimitive.boolean)
        val child = json["root"]!!.jsonObject["c"]!!.jsonArray.single().jsonObject
        assertEquals("a:id/pager", child["id"]!!.jsonPrimitive.content)
        assertEquals(true, child["scr"]!!.jsonPrimitive.boolean)
        assertEquals(3, child["n"]!!.jsonPrimitive.int)
        assertFalse(json["root"]!!.jsonObject.containsKey("id"))
    }

    @Test
    fun stringsAreEscaped() {
        assertEquals("\"a\\\"b\\\\c\\n\\u0001\"", CaptureJson.string("a\"b\\c\n\u0001"))
    }
}

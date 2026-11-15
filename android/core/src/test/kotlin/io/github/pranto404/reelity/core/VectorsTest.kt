package io.github.pranto404.reelity.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Runs the shared test vectors in shared/test-vectors/, generated from extension/src/core.js, against the Kotlin port.
 * A case that fails here means the Android app would behave differently from the extension.
 */
class VectorsTest {
    private val dir = File(System.getProperty("reelity.vectors") ?: error("reelity.vectors is not set (see core/build.gradle.kts)"))

    private fun cases(file: String): List<JsonObject> {
        val f = File(dir, file)
        assertTrue("missing vector file $f", f.isFile)
        val cases = Json.parseToJsonElement(f.readText()).jsonObject.getValue("cases").jsonArray.map { it.jsonObject }
        assertTrue("no cases in $file", cases.isNotEmpty())
        return cases
    }

    private fun JsonElement.stringOrNull(): String? = if (this is JsonNull) null else jsonPrimitive.content

    @Test
    fun levelRulesMatchTheExtension() {
        for (case in cases("level-rules.json")) {
            val level = case.getValue("input").jsonObject.getValue("level").stringOrNull()
            val expect = case.getValue("expect").jsonObject
            val actual = levelRules(level)
            val where = "levelRules(${level?.let { "\"$it\"" }})"
            assertEquals("$where.waitSec", expect.getValue("waitSec").jsonPrimitive.int, actual.waitSec)
            assertEquals("$where.breakMin", expect.getValue("breakMin").jsonPrimitive.int, actual.breakMin)
            assertEquals("$where.strikes", expect.getValue("strikes").jsonPrimitive.int, actual.strikes)
            assertEquals("$where.strikeWindowMin", expect.getValue("strikeWindowMin").jsonPrimitive.int, actual.strikeWindowMin)
            assertEquals("$where.lockHours", expect.getValue("lockHours").jsonPrimitive.int, actual.lockHours)
            assertEquals("$where.sentence", expect.getValue("sentence").jsonPrimitive.content, actual.sentence)
            assertEquals("$where.timedUnlock", expect.getValue("timedUnlock").jsonPrimitive.boolean, actual.timedUnlock)
            assertEquals(
                "$where.settingsChange",
                expect.getValue("settingsChange").jsonPrimitive.content,
                actual.settingsChange.name.lowercase(),
            )
        }
    }
}

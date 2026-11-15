package io.github.pranto404.reelity.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

// Expected values copied from LEVELS in extension/src/core.js. A change there must change these tests too.
class LevelRulesTest {

    @Test
    fun gentle() {
        assertEquals(
            LevelRules(
                waitSec = 10, breakMin = 5, strikes = 5, strikeWindowMin = 60, lockHours = 1,
                sentence = "I choose to keep scrolling", timedUnlock = true, settingsChange = SettingsChange.CHALLENGE,
            ),
            levelRules("gentle"),
        )
    }

    @Test
    fun balanced() {
        assertEquals(
            LevelRules(
                waitSec = 30, breakMin = 5, strikes = 3, strikeWindowMin = 180, lockHours = 6,
                sentence = "I choose to keep scrolling", timedUnlock = true, settingsChange = SettingsChange.CHALLENGE,
            ),
            levelRules("balanced"),
        )
    }

    @Test
    fun strict() {
        assertEquals(
            LevelRules(
                waitSec = 60, breakMin = 5, strikes = 2, strikeWindowMin = 1440, lockHours = 12,
                sentence = "I know this is against my plan and I choose to scroll anyway",
                timedUnlock = false, settingsChange = SettingsChange.NEVER,
            ),
            levelRules("strict"),
        )
    }

    @Test
    fun unknownOrMissingLevelFallsBackToBalanced() {
        val balanced = levelRules("balanced")
        for (level in listOf(null, "", "Strict", "extreme")) {
            assertSame("level $level", balanced, levelRules(level))
        }
    }

    @Test
    fun levelsAreOrderedFromLeastToMostStrict() {
        assertEquals(listOf("gentle", "balanced", "strict"), BlockLevel.entries.map { it.key })
    }
}

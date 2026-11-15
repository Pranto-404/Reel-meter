package io.github.pranto404.reelity.core

/**
 * The rules of one restriction level of the reel blocker.
 *
 * Ported from `LEVELS` in extension/src/core.js; names and numbers match it exactly so the shared test vectors apply.
 * The extension's `label` and `blurb` are UI text, so on Android they live in string resources, not here.
 */
data class LevelRules(
    /** Seconds the user waits before an unblock. */
    val waitSec: Int,
    /** Minutes an unblock (a break) lasts. */
    val breakMin: Int,
    /** Unblocks inside [strikeWindowMin] that start a lockout. */
    val strikes: Int,
    val strikeWindowMin: Int,
    /** Hours a lockout keeps the app blocked. */
    val lockHours: Int,
    /** The sentence the user types to unblock. */
    val sentence: String,
    /** Whether focus timers, schedules and the daily limit can be unblocked at all. */
    val timedUnlock: Boolean,
    val settingsChange: SettingsChange,
)

/** What it takes to loosen the block settings while something is protected. */
enum class SettingsChange {
    /** Allowed after the wait-and-sentence challenge. */
    CHALLENGE,

    /** Not allowed while a block is running. */
    NEVER,
}

/** The three levels, from least to most strict (the order of `BLOCK_LEVELS`; [ordinal] compares strictness). */
enum class BlockLevel(val key: String, val rules: LevelRules) {
    GENTLE(
        "gentle",
        LevelRules(
            waitSec = 10, breakMin = 5, strikes = 5, strikeWindowMin = 60, lockHours = 1,
            sentence = "I choose to keep scrolling", timedUnlock = true, settingsChange = SettingsChange.CHALLENGE,
        ),
    ),
    BALANCED(
        "balanced",
        LevelRules(
            waitSec = 30, breakMin = 5, strikes = 3, strikeWindowMin = 180, lockHours = 6,
            sentence = "I choose to keep scrolling", timedUnlock = true, settingsChange = SettingsChange.CHALLENGE,
        ),
    ),
    STRICT(
        "strict",
        LevelRules(
            waitSec = 60, breakMin = 5, strikes = 2, strikeWindowMin = 1440, lockHours = 12,
            sentence = "I know this is against my plan and I choose to scroll anyway",
            timedUnlock = false, settingsChange = SettingsChange.NEVER,
        ),
    ),
    ;

    companion object {
        /** Used for a missing or unknown stored level, as in core.js. */
        val DEFAULT = BALANCED

        fun fromKey(key: String?): BlockLevel = entries.firstOrNull { it.key == key } ?: DEFAULT
    }
}

/** `levelRules(level)` from core.js: the rules for a stored level key, falling back to "balanced". */
fun levelRules(level: String?): LevelRules = BlockLevel.fromKey(level).rules

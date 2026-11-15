package io.github.pranto404.reelity.core.detect

/** The short-video platforms Reelity knows (the extension's `platform` keys). */
enum class Platform(val key: String) {
    YOUTUBE("youtube"),
    INSTAGRAM("instagram"),
    TIKTOK("tiktok"),
    FACEBOOK("facebook"),
}

/** The apps the accessibility service listens to, and nothing else (ARCHITECTURE section 3). */
object TargetApps {
    val packages: Map<String, Platform> = linkedMapOf(
        "com.google.android.youtube" to Platform.YOUTUBE,
        "com.instagram.android" to Platform.INSTAGRAM,
        "com.instagram.lite" to Platform.INSTAGRAM,
        "com.zhiliaoapp.musically" to Platform.TIKTOK,
        "com.ss.android.ugc.trill" to Platform.TIKTOK,
        "com.zhiliaoapp.musically.go" to Platform.TIKTOK, // TikTok Lite
        "com.facebook.katana" to Platform.FACEBOOK,
        "com.facebook.lite" to Platform.FACEBOOK,
    )

    fun platformOf(packageName: String?): Platform? = packages[packageName]
}

/** What a window shows: which platform, and whether a reel player is on screen. */
data class Detection(val platform: Platform?, val onReel: Boolean) {
    companion object {
        val NONE = Detection(platform = null, onReel = false)
    }
}

/** Decides from ids and geometry alone whether a window shows reels. */
fun interface Detector {
    fun detect(window: WindowSnapshot): Detection
}

/**
 * First stub: a window shows a reel when a visible node with one of the platform's candidate ids covers at least
 * [minCoverage] of its own window. The ids are the starting hypotheses from ARCHITECTURE ("Detection"); the real
 * rules come from the owner's labelled captures (M1) and will move to a data file.
 */
class IdCoverageDetector(
    private val candidates: Map<Platform, Set<String>> = STARTING_HYPOTHESES,
    private val minCoverage: Double = 0.6,
) : Detector {

    override fun detect(window: WindowSnapshot): Detection {
        val platform = TargetApps.platformOf(window.packageName) ?: return Detection.NONE
        val ids = candidates[platform].orEmpty()
        val windowArea = window.bounds.area
        if (ids.isEmpty() || windowArea == 0L) return Detection(platform, onReel = false)
        val onReel = window.root.walk().any { node ->
            node.visible && node.shortId in ids && node.bounds.overlap(window.bounds) >= minCoverage * windowArea
        }
        return Detection(platform, onReel)
    }

    companion object {
        val STARTING_HYPOTHESES: Map<Platform, Set<String>> = mapOf(
            Platform.YOUTUBE to setOf("reel_recycler", "reel_player_page_container", "reel_watch_player"),
            Platform.INSTAGRAM to setOf("clips_viewer_view_pager", "clips_video_container"),
            Platform.TIKTOK to emptySet(), // unknown until the first captures
            Platform.FACEBOOK to emptySet(),
        )
    }
}

package io.github.pranto404.reelity.core.detect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Hand-written trees shaped like the starting hypotheses. Real recorded trees replace them after the M1 captures.
class DetectorTest {
    private val screen = Bounds(0, 0, 1080, 2400)
    private val detector = IdCoverageDetector()

    private fun node(
        id: String?,
        bounds: Bounds = screen,
        visible: Boolean = true,
        children: List<Node> = emptyList(),
    ) = Node(
        id = id, className = "android.widget.FrameLayout", bounds = bounds, visible = visible, scrollable = false,
        childCount = children.size, children = children,
    )

    private fun window(pkg: String, root: Node, bounds: Bounds = screen) = WindowSnapshot(
        packageName = pkg, windowClass = null, windowType = 1, bounds = bounds, active = true, focused = true,
        pictureInPicture = false, root = root, truncated = false, capturedAtMillis = 0,
    )

    private val yt = "com.google.android.youtube"

    @Test
    fun youtubeShortsPagerIsAReel() {
        val tree = node(null, children = listOf(node("$yt:id/toolbar", Bounds(0, 0, 1080, 150)), node("$yt:id/reel_recycler")))
        assertEquals(Detection(Platform.YOUTUBE, onReel = true), detector.detect(window(yt, tree)))
    }

    @Test
    fun youtubeHomeFeedIsNotAReel() {
        val tree = node(null, children = listOf(node("$yt:id/results"), node("$yt:id/pivot_bar", Bounds(0, 2200, 1080, 2400))))
        assertEquals(Detection(Platform.YOUTUBE, onReel = false), detector.detect(window(yt, tree)))
    }

    @Test
    fun aSmallShortsShelfInTheFeedIsNotAReel() {
        val shelf = node("$yt:id/reel_recycler", Bounds(0, 600, 1080, 1300)) // about 29% of the screen
        assertFalse(detector.detect(window(yt, node(null, children = listOf(shelf)))).onReel)
    }

    @Test
    fun anInvisibleReelPageDoesNotCount() {
        val hidden = node("$yt:id/reel_player_page_container", visible = false)
        assertFalse(detector.detect(window(yt, node(null, children = listOf(hidden)))).onReel)
    }

    @Test
    fun coverageIsMeasuredAgainstTheAppsOwnWindowInSplitScreen() {
        val half = Bounds(0, 1200, 1080, 2400)
        val pager = node("com.instagram.android:id/clips_viewer_view_pager", half)
        val detection = detector.detect(window("com.instagram.android", node(null, half, children = listOf(pager)), half))
        assertEquals(Detection(Platform.INSTAGRAM, onReel = true), detection)
    }

    @Test
    fun liteAppsMapToTheirPlatform() {
        assertEquals(Platform.INSTAGRAM, TargetApps.platformOf("com.instagram.lite"))
        assertEquals(Platform.TIKTOK, TargetApps.platformOf("com.zhiliaoapp.musically.go"))
        assertEquals(Platform.FACEBOOK, TargetApps.platformOf("com.facebook.lite"))
    }

    @Test
    fun otherAppsAreIgnored() {
        assertEquals(Detection.NONE, detector.detect(window("com.example.chat", node("com.example.chat:id/reel_recycler"))))
    }

    @Test
    fun platformsWithoutRulesYetNeverReportAReel() {
        val tiktok = window("com.zhiliaoapp.musically", node("com.zhiliaoapp.musically:id/viewpager"))
        assertEquals(Detection(Platform.TIKTOK, onReel = false), detector.detect(tiktok))
    }

    @Test
    fun shortIdDropsThePackagePrefix() {
        assertEquals("reel_recycler", node("$yt:id/reel_recycler").shortId)
        assertTrue(node(null).shortId == null)
    }
}

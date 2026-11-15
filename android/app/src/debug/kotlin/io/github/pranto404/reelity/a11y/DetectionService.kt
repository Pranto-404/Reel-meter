package io.github.pranto404.reelity.a11y

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import io.github.pranto404.reelity.core.detect.TargetApps
import io.github.pranto404.reelity.core.detect.WindowSnapshot
import io.github.pranto404.reelity.lab.Captures
import io.github.pranto404.reelity.lab.InputEvent
import io.github.pranto404.reelity.lab.LabExecutor
import io.github.pranto404.reelity.lab.LabOverlay
import io.github.pranto404.reelity.lab.LabState

/**
 * "Reelity detection (test)": the M1 spike service. Events arrive only from the target apps (packageNames in
 * res/xml/detection_service.xml). It keeps the latest window snapshot for the Detection lab, records taps and
 * scrolls apart from content changes (the idle rule: players change content all the time, so only scrolls and
 * taps count as use), and shows the Reel / Not a reel buttons while a target app is on screen.
 */
class DetectionService : AccessibilityService() {
    private val main = Handler(Looper.getMainLooper())
    private val windowClasses = HashMap<String, String>()
    private var overlay: LabOverlay? = null
    private var checkingPresence = false

    private val snapshotSoon = Runnable { requestSnapshot(label = null) }
    private val presenceCheck = Runnable { checkPresence() }

    override fun onServiceConnected() {
        LabState.onServiceConnected()
        overlay = LabOverlay(this) { label -> requestSnapshot(label) }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        val pkg = event.packageName?.toString() ?: return
        if (TargetApps.platformOf(pkg) == null) return
        LabState.onTargetSeen(pkg)
        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                event.className?.let { windowClasses[pkg] = it.toString() }
                scheduleSnapshot()
            }
            AccessibilityEvent.TYPE_VIEW_SCROLLED, AccessibilityEvent.TYPE_VIEW_CLICKED -> {
                val type = if (event.eventType == AccessibilityEvent.TYPE_VIEW_SCROLLED) "scroll" else "click"
                LabState.recordInput(
                    InputEvent(
                        atElapsed = SystemClock.elapsedRealtime(),
                        type = type,
                        packageName = pkg,
                        viewId = event.source?.viewIdResourceName,
                        className = event.className?.toString(),
                    ),
                )
                scheduleSnapshot()
            }
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> LabState.recordContentChange()
        }
        if (!checkingPresence) {
            checkingPresence = true
            main.post(presenceCheck)
        }
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        overlay?.hide()
        overlay = null
        LabState.onServiceDisconnected()
        super.onDestroy()
    }

    /** One snapshot after the screen settles; a burst of scrolls produces one snapshot, not dozens. */
    private fun scheduleSnapshot() {
        main.removeCallbacks(snapshotSoon)
        main.postDelayed(snapshotSoon, SETTLE_MS)
    }

    /** Takes a snapshot off the main thread. With a [label] the snapshot is also saved as a labelled capture. */
    private fun requestSnapshot(label: String?) {
        val classes = HashMap(windowClasses)
        LabExecutor.run {
            val snapshot = takeSnapshot(classes)
            main.post {
                if (snapshot != null) LabState.onSnapshot(snapshot)
                if (label != null) Captures.save(applicationContext, label, snapshot)
            }
        }
    }

    private fun takeSnapshot(classes: Map<String, String>): WindowSnapshot? {
        val now = System.currentTimeMillis()
        // Prefer the active window, then the largest (split screen, picture-in-picture).
        val target = targetWindows().maxWithOrNull(
            compareBy<Pair<AccessibilityWindowInfo, AccessibilityNodeInfo>>({ it.first.isActive }, { area(it.first) }),
        )
        if (target != null) {
            val (window, root) = target
            return TreeSnapshotter.snapshot(window, root, root.packageName?.toString()?.let { classes[it] }, now)
        }
        val root = rootInActiveWindow ?: return null
        val pkg = root.packageName?.toString() ?: return null
        if (TargetApps.platformOf(pkg) == null) return null
        return TreeSnapshotter.snapshot(null, root, classes[pkg], now)
    }

    /** Application windows of target apps that are on screen now (split screen and picture-in-picture included). */
    private fun targetWindows(): List<Pair<AccessibilityWindowInfo, AccessibilityNodeInfo>> =
        windows.orEmpty()
            .filter { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }
            .mapNotNull { w -> w.root?.let { root -> if (TargetApps.platformOf(root.packageName?.toString()) != null) w to root else null } }

    private fun area(window: AccessibilityWindowInfo): Long {
        val r = android.graphics.Rect()
        window.getBoundsInScreen(r)
        return r.width().toLong() * r.height()
    }

    /**
     * While a target app is in front: once a second, check it is still on screen. Events from other apps never
     * reach this service, so this is how leaving the app is noticed. Stops as soon as no target app is visible.
     */
    private fun checkPresence() {
        LabExecutor.run {
            val visible = targetWindows().isNotEmpty()
            main.post {
                if (visible) {
                    if (LabState.overlayEnabled) overlay?.show() else overlay?.hide()
                    main.postDelayed(presenceCheck, PRESENCE_INTERVAL_MS)
                } else {
                    overlay?.hide()
                    LabState.onTargetGone()
                    checkingPresence = false
                }
            }
        }
    }

    private companion object {
        const val SETTLE_MS = 400L
        const val PRESENCE_INTERVAL_MS = 1000L
    }
}

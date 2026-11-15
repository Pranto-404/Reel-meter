package io.github.pranto404.reelity.a11y

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import io.github.pranto404.reelity.core.detect.Bounds
import io.github.pranto404.reelity.core.detect.Node
import io.github.pranto404.reelity.core.detect.WindowSnapshot

/**
 * Copies a window's node tree into the :core model. It reads ONLY the view id, class name, bounds, visibility,
 * scrollability and child count of each node. Anything users read, type or watch is never touched (SourceRulesTest
 * fails the build if this package calls such an API). Depth and node count are capped to bound CPU and file size.
 */
internal object TreeSnapshotter {
    private const val MAX_DEPTH = 40
    private const val MAX_NODES = 500

    fun snapshot(
        window: AccessibilityWindowInfo?,
        root: AccessibilityNodeInfo,
        windowClass: String?,
        nowMillis: Long,
    ): WindowSnapshot {
        val walk = Walk()
        val rootNode = walk.node(root, depth = 0)
        val rect = Rect()
        if (window != null) window.getBoundsInScreen(rect) else root.getBoundsInScreen(rect)
        return WindowSnapshot(
            packageName = root.packageName?.toString().orEmpty(),
            windowClass = windowClass,
            windowType = window?.type ?: AccessibilityWindowInfo.TYPE_APPLICATION,
            bounds = rect.toBounds(),
            active = window?.isActive ?: true,
            focused = window?.isFocused ?: true,
            pictureInPicture = window?.isInPictureInPictureMode ?: false,
            root = rootNode,
            truncated = walk.truncated,
            capturedAtMillis = nowMillis,
        )
    }

    private class Walk {
        private var remaining = MAX_NODES
        private val rect = Rect()
        var truncated = false
            private set

        fun node(info: AccessibilityNodeInfo, depth: Int): Node {
            remaining--
            info.getBoundsInScreen(rect)
            val bounds = rect.toBounds()
            val count = info.childCount
            val children = ArrayList<Node>()
            if (depth >= MAX_DEPTH) {
                truncated = truncated || count > 0
            } else {
                for (i in 0 until count) {
                    if (remaining <= 0) {
                        truncated = true
                        break
                    }
                    val child = info.getChild(i) ?: continue
                    children += node(child, depth + 1)
                }
            }
            return Node(
                id = info.viewIdResourceName,
                className = info.className?.toString(),
                bounds = bounds,
                visible = info.isVisibleToUser,
                scrollable = info.isScrollable,
                childCount = count,
                children = children,
            )
        }
    }

    private fun Rect.toBounds() = Bounds(left, top, right, bottom)
}

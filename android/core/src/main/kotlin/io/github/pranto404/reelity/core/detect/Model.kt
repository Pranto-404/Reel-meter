package io.github.pranto404.reelity.core.detect

/** A screen rectangle in pixels (left, top, right, bottom), as Android reports it. */
data class Bounds(val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val width: Int get() = (right - left).coerceAtLeast(0)
    val height: Int get() = (bottom - top).coerceAtLeast(0)
    val area: Long get() = width.toLong() * height

    /** The area this rectangle shares with [other]. */
    fun overlap(other: Bounds): Long {
        val w = minOf(right, other.right) - maxOf(left, other.left)
        val h = minOf(bottom, other.bottom) - maxOf(top, other.top)
        return if (w <= 0 || h <= 0) 0 else w.toLong() * h
    }
}

/**
 * One node of an app's screen, reduced to what detection may use: the view id, the class and the geometry.
 * There is deliberately no field for text, descriptions or anything the user typed or watches.
 */
data class Node(
    /** Resource id such as `com.google.android.youtube:id/reel_recycler`, or null when the view has none. */
    val id: String?,
    val className: String?,
    val bounds: Bounds,
    val visible: Boolean,
    val scrollable: Boolean,
    /** Children the app reports; [children] can hold fewer when the snapshot was capped. */
    val childCount: Int,
    val children: List<Node> = emptyList(),
) {
    /** The id without its package prefix: `reel_recycler`. */
    val shortId: String? get() = id?.substringAfter(":id/")

    fun walk(): Sequence<Node> = sequence {
        yield(this@Node)
        for (child in children) yieldAll(child.walk())
    }
}

/** One window of a target app at one moment. */
data class WindowSnapshot(
    val packageName: String,
    /** Class of the last window-state event in this package (usually the activity), when known. */
    val windowClass: String?,
    /** `AccessibilityWindowInfo` type: 1 application, 3 system, 4 accessibility overlay, ... */
    val windowType: Int,
    val bounds: Bounds,
    val active: Boolean,
    val focused: Boolean,
    val pictureInPicture: Boolean,
    val root: Node,
    /** True when the depth or node cap cut the tree short. */
    val truncated: Boolean,
    val capturedAtMillis: Long,
)

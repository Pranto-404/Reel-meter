package io.github.pranto404.reelity.core.detect

/**
 * Compact JSON for detection captures (the Detection lab's export format, version 1). Hand-written so the app
 * needs no JSON library. Node keys: `id`, `cls`, `b` = [left, top, right, bottom], `vis`, `scr`, `n` = child count,
 * `c` = children. Missing id or class and false `scr` are left out to keep captures small.
 */
object CaptureJson {
    const val FORMAT_VERSION = 1

    fun window(w: WindowSnapshot): String = buildString {
        append("{\"package\":").appendString(w.packageName)
        if (w.windowClass != null) append(",\"windowClass\":").appendString(w.windowClass)
        append(",\"windowType\":").append(w.windowType)
        append(",\"bounds\":").appendBounds(w.bounds)
        append(",\"active\":").append(w.active)
        append(",\"focused\":").append(w.focused)
        append(",\"pip\":").append(w.pictureInPicture)
        append(",\"truncated\":").append(w.truncated)
        append(",\"capturedAt\":").append(w.capturedAtMillis)
        append(",\"root\":").appendNode(w.root)
        append('}')
    }

    fun node(n: Node): String = StringBuilder().appendNode(n).toString()

    /** A JSON string literal, quotes included. */
    fun string(s: String): String = StringBuilder().appendString(s).toString()

    private fun StringBuilder.appendNode(n: Node): StringBuilder {
        append('{')
        var first = true
        fun key(k: String) {
            if (!first) append(',')
            first = false
            append('"').append(k).append("\":")
        }
        if (n.id != null) { key("id"); appendString(n.id) }
        if (n.className != null) { key("cls"); appendString(n.className) }
        key("b"); appendBounds(n.bounds)
        key("vis"); append(n.visible)
        if (n.scrollable) { key("scr"); append(true) }
        key("n"); append(n.childCount)
        if (n.children.isNotEmpty()) {
            key("c")
            append('[')
            n.children.forEachIndexed { i, child ->
                if (i > 0) append(',')
                appendNode(child)
            }
            append(']')
        }
        return append('}')
    }

    private fun StringBuilder.appendBounds(b: Bounds): StringBuilder =
        append('[').append(b.left).append(',').append(b.top).append(',').append(b.right).append(',').append(b.bottom)
            .append(']')

    private fun StringBuilder.appendString(s: String): StringBuilder {
        append('"')
        for (ch in s) {
            when {
                ch == '"' -> append("\\\"")
                ch == '\\' -> append("\\\\")
                ch == '\n' -> append("\\n")
                ch == '\r' -> append("\\r")
                ch == '\t' -> append("\\t")
                ch < ' ' -> append("\\u").append(ch.code.toString(16).padStart(4, '0'))
                else -> append(ch)
            }
        }
        return append('"')
    }
}

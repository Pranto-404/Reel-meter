package io.github.pranto404.reelity.lab

import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.pranto404.reelity.core.detect.WindowSnapshot

/** A scroll or tap in a target app: the only events that count as use (content changes never do). */
data class InputEvent(
    val atElapsed: Long,
    val type: String,
    val packageName: String,
    val viewId: String?,
    val className: String?,
)

/** Process-wide state shared by the service and the lab screen. Read and written on the main thread only. */
object LabState {
    var serviceConnected by mutableStateOf(false)
        private set
    var lastPackage by mutableStateOf<String?>(null)
        private set
    var targetOnScreen by mutableStateOf(false)
        private set
    var latest by mutableStateOf<WindowSnapshot?>(null)
        private set
    var latestAtElapsed by mutableLongStateOf(0L)
        private set
    var overlayEnabled by mutableStateOf(true)

    /** Package name to [reel, not a reel] counts of saved captures. */
    var captureCounts by mutableStateOf<Map<String, IntArray>>(emptyMap())

    /** Bumped on every input or content change so the lab recomposes its live counters. */
    var activity by mutableIntStateOf(0)
        private set

    private val inputs = ArrayDeque<InputEvent>()
    private val contentChanges = ArrayDeque<Long>()

    fun onServiceConnected() {
        serviceConnected = true
    }

    fun onServiceDisconnected() {
        serviceConnected = false
        targetOnScreen = false
    }

    fun onTargetSeen(pkg: String) {
        lastPackage = pkg
        targetOnScreen = true
    }

    fun onTargetGone() {
        targetOnScreen = false
    }

    fun onSnapshot(snapshot: WindowSnapshot) {
        latest = snapshot
        latestAtElapsed = SystemClock.elapsedRealtime()
    }

    fun recordInput(event: InputEvent) {
        inputs.addLast(event)
        while (inputs.size > MAX_EVENTS) inputs.removeFirst()
        activity++
    }

    fun recordContentChange() {
        contentChanges.addLast(SystemClock.elapsedRealtime())
        while (contentChanges.size > MAX_EVENTS) contentChanges.removeFirst()
        activity++
    }

    /** Inputs of the last [windowMs] milliseconds, oldest first. */
    fun recentInputs(windowMs: Long = RECENT_MS): List<InputEvent> {
        val since = SystemClock.elapsedRealtime() - windowMs
        return inputs.filter { it.atElapsed >= since }
    }

    fun recentContentChanges(windowMs: Long = RECENT_MS): Int {
        val since = SystemClock.elapsedRealtime() - windowMs
        return contentChanges.count { it >= since }
    }

    const val RECENT_MS = 10_000L
    private const val MAX_EVENTS = 200
}

/** One background thread for snapshots and file work, shared by the service and the lab. */
object LabExecutor {
    private val handler: Handler by lazy { Handler(HandlerThread("reelity-lab").apply { start() }.looper) }

    fun run(block: () -> Unit) {
        handler.post(block)
    }
}

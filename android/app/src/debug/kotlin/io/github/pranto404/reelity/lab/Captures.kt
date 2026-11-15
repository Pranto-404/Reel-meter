package io.github.pranto404.reelity.lab

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.widget.Toast
import androidx.core.content.FileProvider
import io.github.pranto404.reelity.R
import io.github.pranto404.reelity.core.detect.CaptureJson
import io.github.pranto404.reelity.core.detect.IdCoverageDetector
import io.github.pranto404.reelity.core.detect.TargetApps
import io.github.pranto404.reelity.core.detect.WindowSnapshot
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Labelled captures: one JSON object per line in app-private storage (filesDir/lab/captures.jsonl), capped in
 * size, exported as one JSON file through the share sheet. Nothing is sent anywhere by the app itself.
 */
object Captures {
    const val REEL = "reel"
    const val NOT_REEL = "not_reel"
    private const val MAX_BYTES = 16L * 1024 * 1024
    private val main = Handler(Looper.getMainLooper())
    private val linePrefix = Regex("""^\{"label":"(reel|not_reel)","package":"([^"]+)"""")

    private fun file(context: Context) = File(context.filesDir, "lab/captures.jsonl")

    /** Saves [snapshot] with [label]. Call on the main thread; the writing happens in the background. */
    fun save(context: Context, label: String, snapshot: WindowSnapshot?) {
        val app = context.applicationContext
        if (snapshot == null) {
            Toast.makeText(app, R.string.lab_no_snapshot, Toast.LENGTH_SHORT).show()
            return
        }
        val inputs = LabState.recentInputs()
        val contentChanges = LabState.recentContentChanges()
        val now = SystemClock.elapsedRealtime()
        LabExecutor.run {
            val line = captureLine(app, label, snapshot, inputs, contentChanges, now)
            val f = file(app)
            val saved = f.length() + line.length < MAX_BYTES
            if (saved) {
                f.parentFile?.mkdirs()
                f.appendText(line + "\n")
            }
            val counts = readCounts(f)
            main.post {
                LabState.captureCounts = counts
                val message = if (saved) {
                    val labelText = app.getString(if (label == REEL) R.string.lab_guess_reel else R.string.lab_guess_not_reel)
                    app.getString(R.string.lab_saved, labelText, appName(snapshot.packageName))
                } else {
                    app.getString(R.string.lab_storage_full)
                }
                Toast.makeText(app, message, Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun captureLine(
        context: Context,
        label: String,
        w: WindowSnapshot,
        inputs: List<InputEvent>,
        contentChanges: Int,
        nowElapsed: Long,
    ): String = buildString {
        // label and package first: readCounts() relies on this order.
        append("{\"label\":").append(CaptureJson.string(label))
        append(",\"package\":").append(CaptureJson.string(w.packageName))
        append(",\"appVersion\":").append(versionOf(context, w.packageName)?.let(CaptureJson::string) ?: "null")
        append(",\"platform\":").append(TargetApps.platformOf(w.packageName)?.key?.let(CaptureJson::string) ?: "null")
        append(",\"stubGuessOnReel\":").append(IdCoverageDetector().detect(w).onReel)
        append(",\"contentChanges10s\":").append(contentChanges)
        append(",\"inputs10s\":[")
        inputs.forEachIndexed { i, e ->
            if (i > 0) append(',')
            append("{\"agoMs\":").append(nowElapsed - e.atElapsed)
            append(",\"type\":").append(CaptureJson.string(e.type))
            append(",\"package\":").append(CaptureJson.string(e.packageName))
            append(",\"id\":").append(e.viewId?.let(CaptureJson::string) ?: "null")
            append(",\"cls\":").append(e.className?.let(CaptureJson::string) ?: "null")
            append('}')
        }
        append("],\"window\":").append(CaptureJson.window(w))
        append('}')
    }

    fun refreshCounts(context: Context) {
        val app = context.applicationContext
        LabExecutor.run {
            val counts = readCounts(file(app))
            main.post { LabState.captureCounts = counts }
        }
    }

    private fun readCounts(f: File): Map<String, IntArray> {
        if (!f.exists()) return emptyMap()
        val counts = sortedMapOf<String, IntArray>()
        f.forEachLine { line ->
            val m = linePrefix.find(line.take(200)) ?: return@forEachLine
            val slot = counts.getOrPut(m.groupValues[2]) { IntArray(2) }
            slot[if (m.groupValues[1] == REEL) 0 else 1]++
        }
        return counts
    }

    /** Writes one JSON file with every capture and opens the share sheet. */
    fun export(activityContext: Context) {
        val app = activityContext.applicationContext
        LabExecutor.run {
            val source = file(app)
            val dir = File(app.cacheDir, "export").apply { mkdirs() }
            dir.listFiles()?.forEach { it.delete() }
            val stamp = SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(Date())
            val out = File(dir, "reelity-captures-$stamp.json")
            out.bufferedWriter().use { w ->
                w.write("{\"format\":\"reelity-captures\",\"version\":${CaptureJson.FORMAT_VERSION}")
                w.write(",\"exportedAt\":${System.currentTimeMillis()}")
                w.write(",\"reelityVersion\":${versionOf(app, app.packageName)?.let(CaptureJson::string) ?: "null"}")
                w.write(",\"device\":{\"manufacturer\":${CaptureJson.string(Build.MANUFACTURER)}")
                w.write(",\"model\":${CaptureJson.string(Build.MODEL)}")
                w.write(",\"sdk\":${Build.VERSION.SDK_INT},\"release\":${CaptureJson.string(Build.VERSION.RELEASE)}}")
                w.write(",\"captures\":[")
                var first = true
                if (source.exists()) {
                    source.forEachLine { line ->
                        if (line.isNotBlank()) {
                            if (!first) w.write(",")
                            w.write("\n")
                            w.write(line)
                            first = false
                        }
                    }
                }
                w.write("\n]}\n")
            }
            val uri = FileProvider.getUriForFile(app, "${app.packageName}.captures", out)
            main.post {
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "application/json"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    clipData = ClipData.newRawUri(out.name, uri)
                    // Explicit grant: Android 18 stops granting it implicitly for ACTION_SEND.
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                activityContext.startActivity(Intent.createChooser(send, app.getString(R.string.lab_export_chooser)))
            }
        }
    }

    fun deleteAll(context: Context) {
        val app = context.applicationContext
        LabExecutor.run {
            file(app).delete()
            File(app.cacheDir, "export").deleteRecursively()
            main.post { LabState.captureCounts = emptyMap() }
        }
    }

    fun versionOf(context: Context, pkg: String): String? = try {
        val pm = context.packageManager
        val info = if (Build.VERSION.SDK_INT >= 33) {
            pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            pm.getPackageInfo(pkg, 0)
        }
        info.versionName
    } catch (e: PackageManager.NameNotFoundException) {
        null
    }

    fun isInstalled(context: Context, pkg: String): Boolean = versionOf(context, pkg) != null

    /** Brand names stay in English in both languages. */
    fun appName(pkg: String): String = when (pkg) {
        "com.google.android.youtube" -> "YouTube"
        "com.instagram.android" -> "Instagram"
        "com.instagram.lite" -> "Instagram Lite"
        "com.zhiliaoapp.musically", "com.ss.android.ugc.trill" -> "TikTok"
        "com.zhiliaoapp.musically.go" -> "TikTok Lite"
        "com.facebook.katana" -> "Facebook"
        "com.facebook.lite" -> "Facebook Lite"
        else -> pkg
    }
}

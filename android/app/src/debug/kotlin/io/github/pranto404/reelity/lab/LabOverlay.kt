package io.github.pranto404.reelity.lab

import android.accessibilityservice.AccessibilityService
import android.graphics.PixelFormat
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import io.github.pranto404.reelity.R

/**
 * Two small buttons over the target app ("Reel" / "Not a reel") so the owner can label the screen while
 * scrolling. An accessibility overlay window: it needs no draw-over-apps permission and only the service can add
 * it. It also tries out the overlay window that is plan B for the block screen (ARCHITECTURE "Blocking flow").
 */
class LabOverlay(
    private val service: AccessibilityService,
    private val onLabel: (String) -> Unit,
) {
    private val windowManager = service.getSystemService(WindowManager::class.java)
    private var view: View? = null

    fun show() {
        if (view != null) return
        val panel = LinearLayout(service).apply {
            orientation = LinearLayout.VERTICAL
            alpha = 0.9f
            addView(button(R.string.overlay_reel, Captures.REEL))
            addView(button(R.string.overlay_not_reel, Captures.NOT_REEL))
        }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
        }
        windowManager.addView(panel, params)
        view = panel
    }

    fun hide() {
        view?.let { windowManager.removeView(it) }
        view = null
    }

    private fun button(labelRes: Int, label: String) = Button(service).apply {
        setText(labelRes)
        setAllCaps(false)
        setOnClickListener { onLabel(label) }
    }
}

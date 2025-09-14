package com.chaoticneutral.myco

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  private var pendingPermissionRequest: PermissionRequest? = null

  companion object {
    private const val REQ_CAMERA = 1001
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // Hook provided by Tauri to customize the underlying Android WebView.
  override fun onWebViewCreate(webView: WebView) {
    webView.webChromeClient = object : WebChromeClient() {
      override fun onPermissionRequest(request: PermissionRequest) {
        val needsCamera = request.resources.any { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
        val needsMic = request.resources.any { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }

        // If camera is requested but we don't yet have runtime permission, ask for it.
        if (needsCamera) {
          val camGranted = ContextCompat.checkSelfPermission(
            this@MainActivity,
            Manifest.permission.CAMERA
          ) == PackageManager.PERMISSION_GRANTED

          if (!camGranted) {
            pendingPermissionRequest = request
            ActivityCompat.requestPermissions(
              this@MainActivity,
              arrayOf(Manifest.permission.CAMERA),
              REQ_CAMERA
            )
            return
          }
        }

        // If we reach here, no camera permission is needed or it was already granted.
        // Grant the requested WebView resources (camera/mic) to the page.
        request.grant(request.resources)
      }
    }

    // Keep Tauri's default setup.
    super.onWebViewCreate(webView)
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)

    if (requestCode == REQ_CAMERA) {
      val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
      val req = pendingPermissionRequest
      pendingPermissionRequest = null

      if (granted && req != null) {
        // Now that Android runtime permission is granted, grant the WebView request too.
        req.grant(req.resources)
      } else {
        req?.deny()
      }
    }
  }
}

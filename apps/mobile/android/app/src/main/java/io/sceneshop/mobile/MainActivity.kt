package io.sceneshop.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

class MainActivity : Activity() {
  private lateinit var webView: WebView
  private lateinit var nativeBridge: SceneShopNativeBridge
  private val base = BuildConfig.SCENESHOP_APP_URL.ifBlank { "https://app.sceneshop.io" }.trimEnd('/')
  private val allowedHost: String by lazy { Uri.parse(base).host ?: "app.sceneshop.io" }
  private val pendingEvents = mutableListOf<Pair<String, JSONObject>>()
  private var pageReady = false
  private var notificationRequestId: String? = null
  private var pendingMicRequest: PermissionRequest? = null

  companion object {
    private const val NOTIFICATION_REQUEST_CODE = 1801
    private const val MIC_REQUEST_CODE = 1802
  }

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), MIC_REQUEST_CODE)
    }
    webView = WebView(this)
    webView.settings.javaScriptEnabled = true
    webView.settings.domStorageEnabled = true
    webView.settings.allowFileAccess = false
    webView.settings.allowContentAccess = false
    webView.webChromeClient = object : WebChromeClient() {
      // Microfone para "Sincronizar com o que estou assistindo": só para a página do próprio SceneShop.
      override fun onPermissionRequest(request: PermissionRequest) {
        val origin = request.origin
        val trusted = origin.host == allowedHost && (origin.scheme == "https" || allowedHost in setOf("127.0.0.1", "localhost"))
        if (!trusted || !request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) { request.deny(); return }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
          request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
          pendingMicRequest?.deny()
          pendingMicRequest = request
          requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), MIC_REQUEST_CODE)
        }
      }
      override fun onPermissionRequestCanceled(request: PermissionRequest) {
        if (pendingMicRequest == request) pendingMicRequest = null
      }
    }
    webView.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val uri = request?.url ?: return true
        if (uri.scheme == "https" && uri.host == allowedHost) return false
        if (uri.scheme == "http" && allowedHost in setOf("127.0.0.1", "localhost") && uri.host == allowedHost) return false
        if (uri.scheme == "https") startActivity(Intent(Intent.ACTION_VIEW, uri))
        return true
      }
      override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        pageReady = true
        flushPendingEvents()
      }
    }
    nativeBridge = SceneShopNativeBridge(this, webView)
    webView.addJavascriptInterface(nativeBridge, "SceneShopNative")
    setContentView(webView)
    webView.loadUrl(resolveSceneShopUrl(intent?.data))
    consumeShareIntent(intent)
  }

  private fun resolveSceneShopUrl(deepLink: Uri?): String {
    val url = Uri.parse("$base/mobile").buildUpon()
    if (deepLink == null) return url.build().toString()
    val segments = deepLink.pathSegments
    if (deepLink.scheme == "https" && deepLink.host == allowedHost && segments.size >= 2 && segments[0] == "s") {
      url.appendQueryParameter("code", segments[1].uppercase())
    } else if (deepLink.scheme == "sceneshop" && deepLink.host == "session" && segments.isNotEmpty()) {
      url.appendQueryParameter("code", segments[0].uppercase())
    } else if (deepLink.scheme == "sceneshop" && deepLink.host == "share") {
      url.appendQueryParameter("source", deepLink.getQueryParameter("url") ?: deepLink.getQueryParameter("text") ?: "")
    } else {
      url.appendQueryParameter("source", deepLink.toString())
    }
    return url.build().toString()
  }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (consumeShareIntent(intent)) return
    pageReady = false
    webView.loadUrl(resolveSceneShopUrl(intent?.data))
  }

  private fun consumeShareIntent(intent: Intent?): Boolean {
    if (intent?.action != Intent.ACTION_SEND) return false
    val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.take(8 * 1024)
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.take(512)
    val stream = sharedStream(intent)
    emitNativeEvent("SHARE_RECEIVED", JSONObject().put("text", text ?: JSONObject.NULL).put("title", subject ?: JSONObject.NULL).put("uri", stream ?: JSONObject.NULL).put("mimeType", intent.type ?: JSONObject.NULL))
    return true
  }

  @Suppress("DEPRECATION")
  private fun sharedStream(intent: Intent): String? {
    return if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)?.toString()
    else intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)?.toString()
  }

  fun notificationPermissionState(): JSONObject {
    if (Build.VERSION.SDK_INT < 33) return JSONObject().put("supported", true).put("granted", true).put("canRequest", false)
    val granted = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    return JSONObject().put("supported", true).put("granted", granted).put("canRequest", !granted)
  }

  fun requestNotificationRegistration(requestId: String) {
    notificationRequestId = requestId
    if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
      val value = notificationPermissionState().put("registration", "PERMISSION_GRANTED").put("tokenProvider", "UNCONFIGURED")
      nativeBridge.completeRequest(requestId, true, value, null)
      emitNativeEvent("NOTIFICATION_REGISTRATION", value)
      notificationRequestId = null
      return
    }
    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_REQUEST_CODE)
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == MIC_REQUEST_CODE) {
      val request = pendingMicRequest
      pendingMicRequest = null
      if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) request?.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else request?.deny()
      return
    }
    if (requestCode != NOTIFICATION_REQUEST_CODE) return
    val granted = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
    val value = notificationPermissionState().put("granted", granted).put("registration", if (granted) "PERMISSION_GRANTED" else "PERMISSION_DENIED").put("tokenProvider", "UNCONFIGURED")
    notificationRequestId?.let { nativeBridge.completeRequest(it, true, value, null) }
    emitNativeEvent("NOTIFICATION_REGISTRATION", value)
    notificationRequestId = null
  }

  fun emitNativeEvent(type: String, payload: JSONObject = JSONObject()) {
    if (!::webView.isInitialized || !pageReady) { pendingEvents.add(type to payload); return }
    val event = JSONObject().put("version", 1).put("type", type).put("payload", payload).put("at", System.currentTimeMillis())
    webView.post { webView.evaluateJavascript("window.SceneShopNativeEvent(${JSONObject.quote(event.toString())})", null) }
  }

  private fun flushPendingEvents() {
    if (!pageReady) return
    val copy = pendingEvents.toList(); pendingEvents.clear()
    copy.forEach { emitNativeEvent(it.first, it.second) }
  }

  override fun onStart() { super.onStart(); emitNativeEvent("APP_LIFECYCLE", JSONObject().put("state", "FOREGROUND")) }
  override fun onStop() { emitNativeEvent("APP_LIFECYCLE", JSONObject().put("state", "BACKGROUND")); super.onStop() }

  @Deprecated("Deprecated in Java")
  override fun onBackPressed() { if (webView.canGoBack()) webView.goBack() else super.onBackPressed() }
}

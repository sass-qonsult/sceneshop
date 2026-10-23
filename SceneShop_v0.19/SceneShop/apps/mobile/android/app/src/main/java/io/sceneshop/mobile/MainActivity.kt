package io.sceneshop.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.FrameLayout
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebSettingsCompat
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import androidx.webkit.WebViewFeature
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
    webView = WebView(this)
    webView.settings.javaScriptEnabled = true
    webView.settings.domStorageEnabled = true
    webView.settings.allowFileAccess = false
    webView.settings.allowContentAccess = false
    webView.settings.mediaPlaybackRequiresUserGesture = false // vídeo da câmera (leitor de QR pela página)
    // Carteiras (Google Pay e cartões salvos na Carteira do Google) pelo Payment Request: o cartão fica na
    // carteira e a página recebe só o token do gateway. Requer WebView 137+ e Google Play services 25.18.30+.
    if (WebViewFeature.isFeatureSupported(WebViewFeature.PAYMENT_REQUEST)) {
      WebSettingsCompat.setPaymentRequestEnabled(webView.settings, true)
    }
    webView.webChromeClient = object : WebChromeClient() {
      // Microfone ("Sincronizar com o que estou assistindo") e câmera (ler o QR code da TV):
      // só para a página do próprio SceneShop, e só esses dois recursos.
      override fun onPermissionRequest(request: PermissionRequest) {
        val origin = request.origin
        val trusted = origin.host == allowedHost && (origin.scheme == "https" || allowedHost in setOf("127.0.0.1", "localhost"))
        val wanted = request.resources.filter { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE || it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
        if (!trusted || wanted.isEmpty() || wanted.size != request.resources.size) { request.deny(); return }
        val missing = wanted.map { androidPermissionFor(it) }.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) {
          request.grant(wanted.toTypedArray())
        } else {
          pendingMicRequest?.deny()
          pendingMicRequest = request
          requestPermissions(missing.toTypedArray(), MIC_REQUEST_CODE)
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
    SyncForegroundService.onStopRequested = { emitNativeEvent("SYNC_STOP_REQUESTED", JSONObject()) }
    nativeBridge = SceneShopNativeBridge(this, webView)
    webView.addJavascriptInterface(nativeBridge, "SceneShopNative")
    // rcprep.17: o app ocupa só a área livre da tela. No Android 15 (targetSdk 35) a janela vai de ponta a
    // ponta e a barra de status/navegação ficava por cima do conteúdo; o contêiner recebe como margem
    // interna o tamanho das barras do sistema, do recorte da câmera e do teclado.
    webView.setBackgroundColor(Color.BLACK)
    val root = FrameLayout(this)
    root.setBackgroundColor(Color.BLACK)
    root.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    if (Build.VERSION.SDK_INT >= 30) {
      // o app desenha a área toda e se afasta sozinho das barras (igual em Android 11 a 15+)
      window.setDecorFitsSystemWindows(false)
      root.setOnApplyWindowInsetsListener { view, insets -> applySystemInsets(view, insets) }
    }
    setContentView(root)
    darkSystemBars()
    webView.loadUrl(resolveSceneShopUrl(intent?.data))
    consumeShareIntent(intent)
  }

  @android.annotation.TargetApi(30)
  private fun applySystemInsets(view: View, insets: WindowInsets): WindowInsets {
    val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
    view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
    return WindowInsets.CONSUMED
  }

  // barras do sistema pretas com ícones claros (combina com o fundo preto do app)
  @Suppress("DEPRECATION")
  private fun darkSystemBars() {
    if (Build.VERSION.SDK_INT < 35) { window.statusBarColor = Color.BLACK; window.navigationBarColor = Color.BLACK }
    if (Build.VERSION.SDK_INT >= 30) {
      window.insetsController?.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS)
    } else {
      window.decorView.systemUiVisibility = window.decorView.systemUiVisibility and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
    }
  }

  // rcprep.18: leitor de QR code nativo (Google code scanner): abre a câmera numa tela do Google Play services,
  // sem pedir a permissão de câmera ao app e sem depender do WebView; devolve só o texto lido.
  fun scanQr(requestId: String) {
    try {
      val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).enableAutoZoom().build()
      GmsBarcodeScanning.getClient(this, options).startScan()
        .addOnSuccessListener { code -> nativeBridge.completeRequest(requestId, true, JSONObject().put("text", code.rawValue ?: ""), null) }
        .addOnCanceledListener { nativeBridge.completeRequest(requestId, false, null, "QR_CANCELLED") }
        .addOnFailureListener { error -> nativeBridge.completeRequest(requestId, false, null, "QR_UNAVAILABLE: " + (error.message ?: "")) }
    } catch (error: Exception) {
      nativeBridge.completeRequest(requestId, false, null, "QR_UNAVAILABLE: " + (error.message ?: ""))
    }
  }

  private fun androidPermissionFor(resource: String): String =
    if (resource == PermissionRequest.RESOURCE_VIDEO_CAPTURE) Manifest.permission.CAMERA else Manifest.permission.RECORD_AUDIO

  // rcprep.16: sincronização em segundo plano (aviso fixo com "Parar"); chamado pelo app web via ponte
  fun startSync(title: String) = SyncForegroundService.start(this, title)
  fun stopSync() = SyncForegroundService.stop(this)

  private fun resolveSceneShopUrl(deepLink: Uri?): String {
    val url = Uri.parse("$base/mobile").buildUpon()
    // o espectador fechou o app durante uma sincronização: abre no início, sem retomar a sessão
    if (SyncForegroundService.consumeClosedByUser(this)) url.appendQueryParameter("stopped", "1")
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
    // aviso de sincronização ou ícone do app: só traz o app para a frente, sem recarregar a sessão
    if (intent?.data == null) return
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
      val allGranted = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
      if (allGranted) request?.let { it.grant(it.resources) } else request?.deny()
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

  // sair do app (voltar até fechar) encerra a sincronização; se o sistema fechar o app sozinho, ela continua
  override fun onDestroy() {
    if (isFinishing && !isChangingConfigurations) {
      SyncForegroundService.markClosedByUser(this)
      SyncForegroundService.stop(this)
    }
    SyncForegroundService.onStopRequested = null
    super.onDestroy()
  }

  @Deprecated("Deprecated in Java")
  override fun onBackPressed() { if (webView.canGoBack()) webView.goBack() else super.onBackPressed() }
}

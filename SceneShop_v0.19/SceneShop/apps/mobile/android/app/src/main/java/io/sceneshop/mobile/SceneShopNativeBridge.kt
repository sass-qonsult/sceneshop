package io.sceneshop.mobile

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

class SceneShopNativeBridge(private val activity: MainActivity, private val webView: WebView) {
  private val secure = SceneShopSecureStore(activity)
  private val allowed = setOf("NATIVE_READY","SHARE","OPEN_EXTERNAL","SECURE_GET","SECURE_SET","SECURE_DELETE","DEVICE_CONTEXT","NOTIFICATION_PERMISSION","NOTIFICATION_REGISTER","SYNC_STARTED","SYNC_STOPPED")
  @JavascriptInterface
  fun postMessage(raw: String) {
    var asynchronous = false
    try {
      require(raw.toByteArray().size <= 16 * 1024)
      val message = JSONObject(raw); val type = message.optString("type").uppercase(); val requestId = message.optString("requestId"); val payload = message.optJSONObject("payload") ?: JSONObject()
      require(type in allowed)
      val value: Any? = when (type) {
        "NATIVE_READY" -> JSONObject().put("platform", "android")
        "OPEN_EXTERNAL" -> { val target = payload.optString("url"); require(target.startsWith("https://")); activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(target))); true }
        "SHARE" -> { val share = Intent(Intent.ACTION_SEND).apply { this.type = "text/plain"; putExtra(Intent.EXTRA_TEXT, payload.optString("url")); putExtra(Intent.EXTRA_SUBJECT, payload.optString("title")) }; activity.startActivity(Intent.createChooser(share, "Share SceneShop")); true }
        "SECURE_SET" -> { secure.set(payload.getString("key"), payload.optString("value")); true }
        "SECURE_GET" -> secure.get(payload.getString("key"))
        "SECURE_DELETE" -> { secure.delete(payload.getString("key")); true }
        "DEVICE_CONTEXT" -> JSONObject().put("platform","android").put("sdk",Build.VERSION.SDK_INT).put("model",Build.MODEL)
        "NOTIFICATION_PERMISSION" -> activity.notificationPermissionState()
        "SYNC_STARTED" -> { val title = payload.optString("title").take(120); activity.runOnUiThread { activity.startSync(title) }; true }
        "SYNC_STOPPED" -> { activity.runOnUiThread { activity.stopSync() }; true }
        "NOTIFICATION_REGISTER" -> { require(requestId.isNotBlank()); asynchronous = true; activity.requestNotificationRegistration(requestId); null }
        else -> null
      }
      if (!asynchronous && requestId.isNotBlank()) respond(requestId, true, value, null)
    } catch (error: Exception) {
      val id = try { JSONObject(raw).optString("requestId") } catch (_: Exception) { "" }
      if (id.isNotBlank()) respond(id, false, null, error.message ?: "NATIVE_ERROR")
    }
  }
  fun completeRequest(requestId: String, ok: Boolean, value: Any?, error: String?) = respond(requestId, ok, value, error)
  private fun respond(requestId: String, ok: Boolean, value: Any?, error: String?) {
    val response = JSONObject().put("version",1).put("requestId",requestId).put("ok",ok).put("value",value ?: JSONObject.NULL).put("error",error ?: JSONObject.NULL)
    webView.post { webView.evaluateJavascript("window.SceneShopNativeResolve(${JSONObject.quote(response.toString())})", null) }
  }
}

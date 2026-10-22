package io.sceneshop.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.IBinder

/**
 * rcprep.16 — mantém a sincronização viva enquanto o espectador usa outros apps.
 *
 * O app web avisa SYNC_STARTED (título) ao sincronizar e SYNC_STOPPED ao tocar em "Parar".
 * Enquanto isso, um aviso fixo "Sincronizado: <título>" fica na barra de notificações com o botão
 * "Parar"; tocar no aviso volta para o app. A posição do vídeo é recalculada pelo servidor ao voltar
 * (sem depender de o processo ter ficado vivo). Fechar o app (voltar até sair ou arrastar da lista de
 * recentes) encerra a sincronização: MainActivity guarda isso e o app web limpa a sessão ativa.
 */
class SyncForegroundService : Service() {
  companion object {
    private const val CHANNEL_ID = "sceneshop_sync"
    private const val NOTIFICATION_ID = 4101
    const val ACTION_START = "io.sceneshop.mobile.action.SYNC_START"
    const val ACTION_STOP = "io.sceneshop.mobile.action.SYNC_STOP"
    const val EXTRA_TITLE = "title"
    const val PREFS = "sceneshop_sync"
    const val KEY_CLOSED = "closedByUser"

    /** MainActivity registra aqui o que fazer quando o espectador toca em "Parar" no aviso. */
    @Volatile var onStopRequested: (() -> Unit)? = null

    fun start(context: Context, title: String) {
      val intent = Intent(context, SyncForegroundService::class.java).setAction(ACTION_START).putExtra(EXTRA_TITLE, title.take(120))
      try {
        context.startForegroundService(intent) // minSdk 26
      } catch (_: Exception) {
        // Android 12+ pode recusar iniciar serviço com o app em segundo plano; a sincronização segue pelo servidor.
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, SyncForegroundService::class.java))
    }

    fun markClosedByUser(context: Context) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_CLOSED, true).apply()
    }

    /** Lê e limpa a marca "o espectador fechou o app" (usada na próxima abertura). */
    fun consumeClosedByUser(context: Context): Boolean {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val closed = prefs.getBoolean(KEY_CLOSED, false)
      if (closed) prefs.edit().remove(KEY_CLOSED).apply()
      return closed
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      onStopRequested?.invoke()
      stopForegroundCompat()
      stopSelf()
      return START_NOT_STICKY
    }
    val title = intent?.getStringExtra(EXTRA_TITLE)?.takeIf { it.isNotBlank() } ?: "SceneShop"
    val notification = buildNotification(title)
    if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    else startForeground(NOTIFICATION_ID, notification)
    return START_NOT_STICKY
  }

  // arrastar o app da lista de recentes = fechar o app: encerra a sincronização
  override fun onTaskRemoved(rootIntent: Intent?) {
    markClosedByUser(this)
    stopForegroundCompat()
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  // Android 15: serviços "dataSync" têm limite diário; ao estourar, o aviso sai e a sincronização segue pelo servidor
  override fun onTimeout(startId: Int) {
    stopForegroundCompat()
    stopSelf()
  }

  private fun stopForegroundCompat() {
    stopForeground(STOP_FOREGROUND_REMOVE)
  }

  private fun buildNotification(title: String): Notification {
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      val channel = NotificationChannel(CHANNEL_ID, "Sincronização", NotificationManager.IMPORTANCE_LOW)
      channel.description = "Mostra que o SceneShop continua sincronizado com o vídeo"
      channel.setShowBadge(false)
      manager.createNotificationChannel(channel)
    }
    val immutable = PendingIntent.FLAG_IMMUTABLE
    val open = PendingIntent.getActivity(this, 0,
      Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
      immutable or PendingIntent.FLAG_UPDATE_CURRENT)
    val stop = PendingIntent.getService(this, 1,
      Intent(this, SyncForegroundService::class.java).setAction(ACTION_STOP),
      immutable or PendingIntent.FLAG_UPDATE_CURRENT)
    return Notification.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_sceneshop)
      .setContentTitle("Sincronizado: $title")
      .setContentText("Os produtos das cenas continuam chegando. Toque para ver.")
      .setContentIntent(open)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .addAction(Notification.Action.Builder(null as Icon?, "Parar", stop).build())
      .build()
  }
}

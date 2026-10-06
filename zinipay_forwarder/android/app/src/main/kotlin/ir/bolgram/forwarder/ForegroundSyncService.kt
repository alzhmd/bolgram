package ir.bolgram.forwarder

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/** Keeps the process alive: heartbeat every minute, queue retries, sender-list refresh, connectivity-triggered flush. */
class ForegroundSyncService : Service() {
    companion object {
        const val CHANNEL_ID = "bolgram_service"
        const val NOTIFICATION_ID = 9021
        const val ACTION_STOP = "ir.bolgram.forwarder.STOP"

        fun start(c: Context) {
            try {
                val i = Intent(c, ForegroundSyncService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) c.startForegroundService(i) else c.startService(i)
            } catch (_: Throwable) {}
        }

        fun stop(c: Context) {
            try { c.startService(Intent(c, ForegroundSyncService::class.java).setAction(ACTION_STOP)) } catch (_: Throwable) {}
        }
    }

    private var ticker: ScheduledFuture<*>? = null
    private var netCb: ConnectivityManager.NetworkCallback? = null

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, "سرویس بولگرام", NotificationManager.IMPORTANCE_LOW)
            ch.description = "برای دریافت پیامک بانکی در پس‌زمینه لازم است"
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            ticker?.cancel(false)
            ticker = null
            stopForeground(true)
            stopSelf()
            return START_NOT_STICKY
        }
        val n = notification()
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(NOTIFICATION_ID, n)
        if (ticker == null) begin()
        return START_STICKY
    }

    private fun begin() {
        val app = applicationContext
        Forwarder.exec.execute {
            try {
                Catchup.run(app)
                Forwarder.refreshSenders(app)
                Forwarder.heartbeat(app)
                Forwarder.flush(app)
            } catch (_: Throwable) {}
        }
        ticker = Forwarder.exec.scheduleWithFixedDelay({
            try {
                Forwarder.heartbeat(app)
                if (System.currentTimeMillis() - Store.long(app, "senders_at") > 6 * 3600_000L) Forwarder.refreshSenders(app)
                Forwarder.flush(app)
                Store.setLong(app, "last_scan", System.currentTimeMillis())
                (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION_ID, notification())
            } catch (_: Throwable) {}
        }, 60, 60, TimeUnit.SECONDS)
        try {
            val cm = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
            val cb = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    Store.resetBackoff(app)
                    Forwarder.exec.execute {
                        try { Forwarder.heartbeat(app); Forwarder.flush(app) } catch (_: Throwable) {}
                    }
                }
            }
            cm.registerDefaultNetworkCallback(cb)
            netCb = cb
        } catch (_: Throwable) {}
    }

    private fun notification(): Notification {
        val pending = Store.queueSize(this)
        val text = when {
            Store.bool(this, "auth_error") -> "اتصال قطع شده؛ دوباره جفت کنید"
            pending > 0 -> "$pending پیامک در صف ارسال"
            else -> "فعال؛ پیامک‌های بانکی را می‌فرستد"
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("بولگرام")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentIntent(open)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        ticker?.cancel(false)
        try {
            val cb = netCb
            if (cb != null) (getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(cb)
        } catch (_: Throwable) {}
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}

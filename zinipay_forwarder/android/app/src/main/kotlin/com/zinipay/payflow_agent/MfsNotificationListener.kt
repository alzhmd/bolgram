package com.zinipay.payflow_agent

import android.app.Notification
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MfsNotificationListener : NotificationListenerService() {

    companion object {
        private const val TAG = "MfsNotificationListener"
        var notificationCallback: ((data: Map<String, Any?>) -> Unit)? = null

        // Approved MFS app packages in Bangladesh
        val MFS_PACKAGES = setOf(
            "com.bKash.customerapp",
            "com.bKash.merchantapp",
            "com.konasl.nagad",
            "com.konasl.nagad.customer",
            "com.dbbl.nexus.pay",
            "com.dbbl.rocket",
            "com.upay.customer",
            "bd.com.upay.agent",
            "com.surecash"
        )
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return

        val packageName = sbn.packageName ?: ""
        if (!isMfsPackage(packageName)) return

        val extras = sbn.notification?.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""
        val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString() ?: ""

        val fullBody = when {
            bigText.isNotBlank() -> bigText
            text.isNotBlank() -> text
            else -> subText
        }

        if (fullBody.isBlank() && title.isBlank()) return

        Log.d(TAG, "MFS Notification Intercepted from $packageName: Title='$title', Body='$fullBody'")

        val provider = resolveProvider(packageName, "$title $fullBody")
        val notificationData = mapOf(
            "package_name" to packageName,
            "provider" to provider,
            "title" to title,
            "body" to fullBody,
            "timestamp" to System.currentTimeMillis(),
            "source" to "APP_NOTIFICATION"
        )

        // 1. Deliver to active Flutter runtime via EventChannel callback
        val callback = notificationCallback
        if (callback != null) {
            callback(notificationData)
        } else {
            // 2. Headless ingestion fallback if UI is paused/killed
            forwardNotificationToBackend(this, provider, title, fullBody)
        }
    }

    private fun isMfsPackage(pkg: String): Boolean {
        if (MFS_PACKAGES.contains(pkg)) return true
        val lower = pkg.lowercase(Locale.ROOT)
        return lower.contains("bkash") || lower.contains("nagad") || lower.contains("rocket") || lower.contains("upay")
    }

    private fun resolveProvider(pkg: String, content: String): String {
        val lower = "$pkg $content".lowercase(Locale.ROOT)
        return when {
            lower.contains("bkash") -> "bKash"
            lower.contains("nagad") -> "Nagad"
            lower.contains("rocket") || lower.contains("nexus") -> "Rocket"
            lower.contains("upay") -> "Upay"
            else -> "MFS"
        }
    }

    private fun forwardNotificationToBackend(context: Context, provider: String, title: String, body: String) {
        val prefs = context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
        val token = prefs.getString("flutter.zp_device_token", "token_phone_primary") ?: "token_phone_primary"
        val baseUrl = prefs.getString("flutter.zp_backend_url", "https://syncpaybd.site") ?: "https://syncpaybd.site"

        val endpoint = baseUrl.trimEnd('/') + "/api/v1/device/sms/ingest"

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val url = URL(endpoint)
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json; utf-8")
                conn.setRequestProperty("Authorization", "Bearer $token")
                conn.connectTimeout = 12000
                conn.readTimeout = 12000
                conn.doOutput = true

                val payload = JSONObject().apply {
                    put("device_id", token)
                    put("sms", "$title: $body")
                    put("sender", provider)
                    put("source", "APP_NOTIFICATION")
                    put("received_at", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).format(Date()))
                }

                conn.outputStream.use { os ->
                    val bytes = payload.toString().toByteArray(Charsets.UTF_8)
                    os.write(bytes, 0, bytes.size)
                }

                val code = conn.responseCode
                Log.i(TAG, "Notification forward response code: $code")
                conn.disconnect()
            } catch (e: Exception) {
                Log.e(TAG, "Error forwarding notification: ${e.localizedMessage}")
            }
        }
    }
}

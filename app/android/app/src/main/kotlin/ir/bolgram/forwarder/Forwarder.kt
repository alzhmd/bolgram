package ir.bolgram.forwarder

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.telephony.SubscriptionManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Offline-first forwarder: every accepted SMS is persisted first, then sent with retry and exponential backoff. */
object Forwarder {
    val exec: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private val retryScheduled = AtomicBoolean(false)
    private const val TIMEOUT = 15000

    /** Filters and persists one SMS. Returns true when it was queued. */
    fun accept(c: Context, sender: String, body: String, slot: Int, carrier: String, at: Long): Boolean {
        if (!Store.isPaired(c)) return false
        if (!Filter.shouldForward(sender, body, Store.senders(c))) return false
        Store.enqueue(c, sender, body, slot, carrier, at)
        return true
    }

    fun kick(c: Context) {
        val app = c.applicationContext
        exec.execute { try { flush(app) } catch (_: Throwable) {} }
    }

    private fun post(c: Context, path: String, json: JSONObject): Pair<Int, String> {
        val conn = URL(Store.server(c) + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = TIMEOUT
            conn.readTimeout = TIMEOUT
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.setRequestProperty("X-Device-Token", Store.token(c))
            conn.outputStream.use { it.write(json.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code >= 400) conn.errorStream else conn.inputStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return Pair(code, text)
        } finally {
            conn.disconnect()
        }
    }

    private fun backoff(attempts: Int): Long = minOf(30 * 60_000L, 15_000L shl minOf(attempts, 7))

    private fun isoUtc(ms: Long): String {
        val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        f.timeZone = TimeZone.getTimeZone("UTC")
        return f.format(Date(ms))
    }

    @Synchronized
    fun flush(c: Context) {
        if (!Store.isPaired(c) || Store.bool(c, "auth_error")) return
        val q = Store.queue(c)
        var earliest = Long.MAX_VALUE
        for (i in 0 until q.length()) {
            val o = q.getJSONObject(i)
            val key = o.getString("key")
            val sender = o.getString("sender")
            val now = System.currentTimeMillis()
            if (o.optLong("next") > now) { earliest = minOf(earliest, o.optLong("next")); continue }
            val payload = JSONObject()
                .put("sms", o.getString("body"))
                .put("sender", sender)
                .put("sim_slot", o.optInt("slot"))
                .put("carrier", o.optString("carrier"))
                .put("source", "android")
                .put("received_at", isoUtc(o.optLong("at")))
            val wait = backoff(o.optInt("attempts"))
            try {
                val res = post(c, "/api/v1/device/sms/ingest", payload)
                val code = res.first
                when {
                    code == 200 || code == 201 -> {
                        val j = try { JSONObject(res.second) } catch (_: Exception) { JSONObject() }
                        val dup = j.optBoolean("isDuplicate")
                        val inv = if (j.isNull("matched_invoice_id")) "" else j.optString("matched_invoice_id")
                        val amount = j.optJSONObject("transaction")?.optLong("amount") ?: 0L
                        Store.removeFromQueue(c, key)
                        val detail = if (dup) "قبلاً ثبت شده بود" else if (inv.isNotEmpty()) "با فاکتور $inv تطبیق خورد" else "ثبت شد؛ در انتظار بررسی در پنل"
                        Store.addHistory(c, sender, if (dup) "duplicate" else "sent", detail, amount)
                        Store.setLong(c, "last_ok", System.currentTimeMillis())
                        Store.setString(c, "last_error", null)
                    }
                    code == 401 || code == 403 -> {
                        Store.setBool(c, "auth_error", true)
                        Store.setString(c, "last_error", "این دستگاه از پنل قطع شده است؛ دوباره جفت کنید")
                        return
                    }
                    code == 408 || code == 429 || code >= 500 -> {
                        Store.bumpAttempt(c, key, now + wait)
                        Store.setString(c, "last_error", "سرور موقتاً در دسترس نیست (کد $code)")
                        earliest = minOf(earliest, now + wait)
                    }
                    else -> {
                        // 400/422: not a deposit the server can use (withdrawal, unknown format); retrying never helps
                        Store.removeFromQueue(c, key)
                        Store.addHistory(c, sender, "ignored", "پیامک واریز شناخته نشد و نادیده گرفته شد", 0)
                        Store.setLong(c, "last_ok", System.currentTimeMillis())
                    }
                }
            } catch (e: IOException) {
                // offline: keep everything, back off and stop hammering
                Store.bumpAttempt(c, key, now + wait)
                Store.setString(c, "last_error", "اینترنت قطع است؛ پیامک‌ها در گوشی نگه داشته می‌شوند")
                earliest = minOf(earliest, now + wait)
                break
            }
        }
        if (earliest != Long.MAX_VALUE && retryScheduled.compareAndSet(false, true)) {
            val app = c.applicationContext
            val delay = maxOf(1000L, earliest - System.currentTimeMillis())
            exec.schedule({
                retryScheduled.set(false)
                try { flush(app) } catch (_: Throwable) {}
            }, delay, TimeUnit.MILLISECONDS)
        }
    }

    // ---- heartbeat and senders

    private fun telemetry(c: Context): JSONObject {
        val j = JSONObject()
        try {
            val b = c.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            if (b != null) {
                val level = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                val scale = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
                if (level >= 0 && scale > 0) j.put("battery_level", level * 100 / scale)
                val st = b.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
                j.put("is_charging", st == BatteryManager.BATTERY_STATUS_CHARGING || st == BatteryManager.BATTERY_STATUS_FULL)
                j.put("battery_temp", b.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) / 10.0)
            }
        } catch (_: Exception) {}
        j.put("device_model", (Build.MANUFACTURER + " " + Build.MODEL).trim())
        j.put("android_version", Build.VERSION.RELEASE)
        j.put("app_version", try { c.packageManager.getPackageInfo(c.packageName, 0).versionName ?: "" } catch (_: Exception) { "" })
        try {
            val sm = c.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? SubscriptionManager
            val subs = sm?.activeSubscriptionInfoList
            if (!subs.isNullOrEmpty()) {
                val arr = JSONArray()
                for (s in subs) arr.put(JSONObject().put("slot", s.simSlotIndex + 1).put("carrier", s.carrierName?.toString() ?: s.displayName?.toString() ?: ""))
                j.put("sim_slots", arr)
            }
        } catch (_: Throwable) {}
        return j
    }

    fun heartbeat(c: Context) {
        if (!Store.isPaired(c)) return
        try {
            val res = post(c, "/api/v1/device/heartbeat", telemetry(c))
            if (res.first == 200) {
                Store.setLong(c, "last_heartbeat", System.currentTimeMillis())
                Store.setBool(c, "auth_error", false)
                if (Store.queueSize(c) == 0) Store.setString(c, "last_error", null)
            } else if (res.first == 401 || res.first == 403) {
                Store.setBool(c, "auth_error", true)
                Store.setString(c, "last_error", "این دستگاه از پنل قطع شده است؛ دوباره جفت کنید")
            }
        } catch (_: IOException) {
            Store.setString(c, "last_error", "اتصال به سرور برقرار نیست")
        } catch (_: Throwable) {}
    }

    fun refreshSenders(c: Context) {
        if (!Store.isPaired(c)) return
        try {
            val conn = URL(Store.server(c) + "/api/v1/device/senders").openConnection() as HttpURLConnection
            try {
                conn.connectTimeout = TIMEOUT
                conn.readTimeout = TIMEOUT
                conn.setRequestProperty("X-Device-Token", Store.token(c))
                if (conn.responseCode == 200) {
                    val j = JSONObject(conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() })
                    val a = j.optJSONArray("senders") ?: return
                    Store.saveSenders(c, (0 until a.length()).map { a.getString(it) })
                }
            } finally {
                conn.disconnect()
            }
        } catch (_: Throwable) {}
    }
}

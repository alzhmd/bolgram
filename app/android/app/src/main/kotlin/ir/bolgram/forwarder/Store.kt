package ir.bolgram.forwarder

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/** Everything the app persists. Native-first so SMS are captured and queued even when the Flutter UI is not running. */
object Store {
    private const val PREFS = "bolgram"
    private const val MAX_QUEUE = 2000
    private const val MAX_HISTORY = 60
    private val lock = Any()

    /** Bank senders bundled with the app; replaced by the server list (/api/v1/device/senders) once fetched. */
    val DEFAULT_SENDERS = listOf(
        "Bank Mellat", "BankMellat", "Mellat Bank", "700717", "Bank Melli", "BankMelli", "BMI", "200060", "Bank Saderat",
        "BankSaderat", "BSI", "TejaratBank", "Tejarat Bank", "200020", "200021", "200022", "BankSepah", "Bank Sepah", "20000",
        "SamanBank", "Saman Bank", "+989999987641", "B.Pasargad", "BankPasargad", "Pasargad", "PARSIANBANK", "Parsian Bank",
        "EN Bank", "ENBank", "AyandehBank", "Ayandeh Bank", "2000911", "Keshavarzi Bank", "BKI", "300014", "Bank Maskan",
        "300066", "300044", "Refah Bank", "PostBank", "Post Bank", "Bank Shahr", "Shahr Bank", "ResalatBank", "Resalat Bank",
        "B.QMEHRIRAN", "QMEHRIRAN", "KH M BANK", "KHMBANK", "TTBank", "EDBI", "BIM", "KarafarinBank", "SinaBank",
        "SarmayehBank", "DayBank", "Bank Dey", "IZBank", "TourismBank"
    )

    fun prefs(c: Context): SharedPreferences = c.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun server(c: Context): String = prefs(c).getString("server", "") ?: ""
    fun token(c: Context): String = prefs(c).getString("token", "") ?: ""
    fun deviceName(c: Context): String = prefs(c).getString("device_name", "") ?: ""
    fun isPaired(c: Context): Boolean = server(c).isNotBlank() && token(c).isNotBlank()

    fun save(c: Context, server: String, token: String, name: String) {
        synchronized(lock) {
            prefs(c).edit()
                .putString("server", server.trim().trimEnd('/'))
                .putString("token", token.trim())
                .putString("device_name", name)
                .putBoolean("auth_error", false)
                .putLong("last_scan", System.currentTimeMillis())
                .remove("last_error")
                .commit()
        }
    }

    fun clear(c: Context) {
        synchronized(lock) { prefs(c).edit().clear().commit() }
    }

    fun setLong(c: Context, key: String, v: Long) { prefs(c).edit().putLong(key, v).apply() }
    fun setBool(c: Context, key: String, v: Boolean) { prefs(c).edit().putBoolean(key, v).apply() }
    fun setString(c: Context, key: String, v: String?) { prefs(c).edit().putString(key, v).apply() }
    fun long(c: Context, key: String, def: Long = 0L): Long = prefs(c).getLong(key, def)
    fun bool(c: Context, key: String): Boolean = prefs(c).getBoolean(key, false)

    // ---- senders cache
    fun senders(c: Context): List<String> {
        val raw = prefs(c).getString("senders", null) ?: return DEFAULT_SENDERS
        return try {
            val a = JSONArray(raw)
            val l = (0 until a.length()).map { a.getString(it) }
            if (l.isEmpty()) DEFAULT_SENDERS else l
        } catch (_: Exception) { DEFAULT_SENDERS }
    }

    fun saveSenders(c: Context, list: List<String>) {
        if (list.isEmpty()) return
        prefs(c).edit().putString("senders", JSONArray(list).toString()).putLong("senders_at", System.currentTimeMillis()).apply()
    }

    // ---- offline queue: items {key, sender, body, slot, carrier, at, attempts, next}
    fun queue(c: Context): JSONArray = synchronized(lock) { readQueue(c) }
    private fun readQueue(c: Context): JSONArray = try { JSONArray(prefs(c).getString("queue", "[]")) } catch (_: Exception) { JSONArray() }
    private fun writeQueue(c: Context, a: JSONArray) { prefs(c).edit().putString("queue", a.toString()).commit() }

    fun queueSize(c: Context): Int = synchronized(lock) { readQueue(c).length() }

    fun enqueue(c: Context, sender: String, body: String, slot: Int, carrier: String, at: Long) {
        synchronized(lock) {
            val q = readQueue(c)
            val key = "$sender|$body|$at"
            for (i in 0 until q.length()) if (q.getJSONObject(i).optString("key") == key) return
            q.put(
                JSONObject().put("key", key).put("sender", sender).put("body", body).put("slot", slot)
                    .put("carrier", carrier).put("at", at).put("attempts", 0).put("next", 0L)
            )
            // never drop recent SMS: only the oldest overflow is trimmed
            val trimmed = JSONArray()
            val from = maxOf(0, q.length() - MAX_QUEUE)
            for (i in from until q.length()) trimmed.put(q.get(i))
            writeQueue(c, trimmed)
        }
    }

    fun removeFromQueue(c: Context, key: String) {
        synchronized(lock) {
            val q = readQueue(c)
            val out = JSONArray()
            for (i in 0 until q.length()) if (q.getJSONObject(i).optString("key") != key) out.put(q.get(i))
            writeQueue(c, out)
        }
    }

    fun bumpAttempt(c: Context, key: String, nextAt: Long) {
        synchronized(lock) {
            val q = readQueue(c)
            for (i in 0 until q.length()) {
                val o = q.getJSONObject(i)
                if (o.optString("key") == key) { o.put("attempts", o.optInt("attempts") + 1); o.put("next", nextAt) }
            }
            writeQueue(c, q)
        }
    }

    fun resetBackoff(c: Context) {
        synchronized(lock) {
            val q = readQueue(c)
            if (q.length() == 0) return
            for (i in 0 until q.length()) q.getJSONObject(i).put("next", 0L)
            writeQueue(c, q)
        }
    }

    // ---- history (never stores the SMS text, only sender and outcome)
    fun addHistory(c: Context, sender: String, status: String, detail: String, amountRial: Long) {
        synchronized(lock) {
            val h = history(c)
            val out = JSONArray()
            out.put(JSONObject().put("at", System.currentTimeMillis()).put("sender", sender).put("status", status).put("detail", detail).put("amount", amountRial))
            for (i in 0 until minOf(h.length(), MAX_HISTORY - 1)) out.put(h.get(i))
            prefs(c).edit().putString("history", out.toString()).apply()
        }
    }

    fun history(c: Context): JSONArray = try { JSONArray(prefs(c).getString("history", "[]")) } catch (_: Exception) { JSONArray() }
}

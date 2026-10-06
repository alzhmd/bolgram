package ir.bolgram.forwarder

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri

/**
 * After a reboot or a long outage the receiver may have missed messages: re-read the inbox since the last time the
 * service was alive and queue bank messages again. The server ignores replays (same TrxID), so nothing is counted twice.
 */
object Catchup {
    fun run(c: Context) {
        if (!Store.isPaired(c)) return
        if (c.checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) return
        val now = System.currentTimeMillis()
        val since = maxOf(Store.long(c, "last_scan", now - 30 * 60_000L), now - 24 * 3600_000L)
        try {
            val cur = c.contentResolver.query(
                Uri.parse("content://sms/inbox"), arrayOf("address", "body", "date"), "date > ?", arrayOf(since.toString()), "date ASC"
            ) ?: return
            cur.use {
                while (it.moveToNext()) {
                    val addr = it.getString(0) ?: continue
                    val body = it.getString(1) ?: continue
                    Forwarder.accept(c, addr, body, 0, "", it.getLong(2))
                }
            }
        } catch (_: Throwable) {}
        Store.setLong(c, "last_scan", now)
    }
}

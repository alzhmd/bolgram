package ir.bolgram.forwarder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import android.telephony.SubscriptionManager

/** Receives every incoming SMS, keeps only bank messages that are not OTPs, persists them and kicks the sender. */
class SmsListenerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val app = context.applicationContext
        if (!Store.isPaired(app)) return
        val msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        // multipart messages arrive as several PDUs from the same sender: join them
        val joined = LinkedHashMap<String, StringBuilder>()
        for (m in msgs) joined.getOrPut(m.displayOriginatingAddress ?: "") { StringBuilder() }.append(m.displayMessageBody ?: "")
        val slot = slotOf(intent)
        val carrier = carrierOf(app, slot)
        val now = System.currentTimeMillis()
        val pending = goAsync()
        Forwarder.exec.execute {
            try {
                var any = false
                for ((sender, body) in joined) if (Forwarder.accept(app, sender, body.toString(), slot, carrier, now)) any = true
                if (any) Forwarder.flush(app)
            } catch (_: Throwable) {
            } finally {
                pending.finish()
            }
        }
    }

    private fun slotOf(intent: Intent): Int {
        for (key in arrayOf("slot", "simSlot", "phone", "slot_id", "android.telephony.extra.SLOT_INDEX")) {
            if (intent.hasExtra(key)) {
                val v = intent.getIntExtra(key, -1)
                if (v in 0..3) return v + 1
            }
        }
        return 0
    }

    private fun carrierOf(context: Context, slot: Int): String {
        try {
            if (Build.VERSION.SDK_INT >= 22 && slot > 0) {
                val sm = context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? SubscriptionManager
                val sub = sm?.activeSubscriptionInfoList?.firstOrNull { it.simSlotIndex + 1 == slot }
                if (sub != null) return sub.carrierName?.toString() ?: ""
            }
        } catch (_: Throwable) {}
        return ""
    }
}

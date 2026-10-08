package ir.bolgram.forwarder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Restarts the foreground service after boot or an app update. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val a = intent.action
        if (a == Intent.ACTION_BOOT_COMPLETED || a == Intent.ACTION_MY_PACKAGE_REPLACED || a == "android.intent.action.QUICKBOOT_POWERON") {
            if (Store.isPaired(context)) ForegroundSyncService.start(context)
        }
    }
}

package ir.bolgram.forwarder

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/** Thin bridge: the Flutter UI reads state and triggers actions; capture, queue and sending live in native code. */
class MainActivity : FlutterActivity() {
    private val channelName = "ir.bolgram.forwarder/native"
    private var pendingPermResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName).setMethodCallHandler { call, result ->
            when (call.method) {
                "getState" -> result.success(state())
                "permissions" -> result.success(permissions())
                "requestPermissions" -> requestRuntimePermissions(result)
                "requestBattery" -> {
                    requestBattery()
                    result.success(true)
                }
                "openAppSettings" -> {
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                    result.success(true)
                }
                "saveConfig" -> {
                    val server = call.argument<String>("server") ?: ""
                    val token = call.argument<String>("token") ?: ""
                    val name = call.argument<String>("name") ?: ""
                    if (server.isBlank() || token.isBlank()) {
                        result.error("bad_args", "server/token required", null)
                    } else {
                        Store.save(this, server, token, name)
                        ForegroundSyncService.start(this)
                        result.success(true)
                    }
                }
                "clearConfig" -> {
                    ForegroundSyncService.stop(this)
                    Store.clear(this)
                    result.success(true)
                }
                "startService" -> {
                    if (Store.isPaired(this)) ForegroundSyncService.start(this)
                    result.success(true)
                }
                "flushNow" -> {
                    Store.resetBackoff(this)
                    Store.setBool(this, "auth_error", false)
                    Forwarder.exec.execute { Forwarder.heartbeat(applicationContext); Forwarder.flush(applicationContext) }
                    result.success(true)
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun state(): Map<String, Any?> {
        val h = Store.history(this)
        val history = (0 until h.length()).map {
            val o = h.getJSONObject(it)
            mapOf(
                "at" to o.optLong("at"),
                "sender" to o.optString("sender"),
                "status" to o.optString("status"),
                "detail" to o.optString("detail"),
                "amount" to o.optLong("amount")
            )
        }
        val version = try { packageManager.getPackageInfo(packageName, 0).versionName ?: "" } catch (_: Exception) { "" }
        return mapOf(
            "paired" to Store.isPaired(this),
            "server" to Store.server(this),
            "deviceName" to Store.deviceName(this),
            "pending" to Store.queueSize(this),
            "lastOk" to Store.long(this, "last_ok"),
            "lastHeartbeat" to Store.long(this, "last_heartbeat"),
            "lastError" to Store.prefs(this).getString("last_error", null),
            "authError" to Store.bool(this, "auth_error"),
            "sendersCount" to Store.senders(this).size,
            "appVersion" to version,
            "history" to history
        )
    }

    private fun granted(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    private fun permissions(): Map<String, Boolean> {
        val battery = if (Build.VERSION.SDK_INT >= 23) (getSystemService(POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(packageName) else true
        return mapOf(
            "sms" to (granted(Manifest.permission.RECEIVE_SMS) && granted(Manifest.permission.READ_SMS)),
            "notifications" to (Build.VERSION.SDK_INT < 33 || granted(Manifest.permission.POST_NOTIFICATIONS)),
            "battery" to battery,
            "phone" to granted(Manifest.permission.READ_PHONE_STATE)
        )
    }

    private fun requestRuntimePermissions(result: MethodChannel.Result) {
        val need = ArrayList<String>()
        for (p in arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS, Manifest.permission.READ_PHONE_STATE)) if (!granted(p)) need.add(p)
        if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) need.add(Manifest.permission.POST_NOTIFICATIONS)
        if (need.isEmpty()) {
            result.success(permissions())
            return
        }
        pendingPermResult?.success(permissions())
        pendingPermResult = result
        requestPermissions(need.toTypedArray(), 4711)
    }

    override fun onRequestPermissionsResult(requestCode: Int, perms: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, perms, grantResults)
        if (requestCode == 4711) {
            pendingPermResult?.success(permissions())
            pendingPermResult = null
        }
    }

    private fun requestBattery() {
        if (Build.VERSION.SDK_INT < 23) return
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        if (pm.isIgnoringBatteryOptimizations(packageName)) return
        try {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }
}

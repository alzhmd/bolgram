package com.zinipay.payflow_agent

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.provider.Telephony
import android.speech.tts.TextToSpeech
import android.telephony.SubscriptionManager
import androidx.core.app.NotificationManagerCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel
import java.util.Locale

class MainActivity : FlutterActivity(), TextToSpeech.OnInitListener {
    private val METHOD_CHANNEL = "com.zinipay.forwarder/telephony"
    private val SMS_EVENT_CHANNEL = "com.zinipay.forwarder/sms_stream"
    private val NOTIF_EVENT_CHANNEL = "com.zinipay.forwarder/notification_stream"

    private var smsEventSink: EventChannel.EventSink? = null
    private var notifEventSink: EventChannel.EventSink? = null
    private var tts: TextToSpeech? = null
    private var isTtsReady = false

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        // Initialize Android TextToSpeech for Bengali voice soundbox
        tts = TextToSpeech(this, this)

        // MethodChannel
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, METHOD_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "startForegroundService" -> {
                    val intent = Intent(this, ForegroundSyncService::class.java).apply {
                        action = ForegroundSyncService.ACTION_START
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(intent)
                    } else {
                        startService(intent)
                    }
                    result.success(true)
                }
                "stopForegroundService" -> {
                    val intent = Intent(this, ForegroundSyncService::class.java).apply {
                        action = ForegroundSyncService.ACTION_STOP
                    }
                    startService(intent)
                    result.success(true)
                }
                "requestBatteryOptimization" -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        val pm = getSystemService(POWER_SERVICE) as PowerManager
                        if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                                data = Uri.parse("package:$packageName")
                            }
                            startActivity(intent)
                        }
                    }
                    result.success(true)
                }
                "getDeviceTelemetry" -> {
                    val telemetry = gatherDeviceTelemetry()
                    result.success(telemetry)
                }
                "speakBengali" -> {
                    val text = call.argument<String>("text") ?: ""
                    speakOut(text)
                    result.success(true)
                }
                "isNotificationListenerEnabled" -> {
                    val isEnabled = NotificationManagerCompat.getEnabledListenerPackages(this).contains(packageName)
                    result.success(isEnabled)
                }
                "openNotificationListenerSettings" -> {
                    val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    startActivity(intent)
                    result.success(true)
                }
                "readRecentSms" -> {
                    val minutes = call.argument<Int>("minutes") ?: 60
                    val list = readRecentInboxSms(minutes)
                    result.success(list)
                }
                "installApk" -> {
                    try {
                        val filePath = call.argument<String>("filePath")
                        if (filePath == null) {
                            result.error("ARGUMENT_ERROR", "filePath is required", null)
                            return@setMethodCallHandler
                        }

                        val file = java.io.File(filePath)
                        if (!file.exists()) {
                            result.error("FILE_NOT_FOUND", "APK file not found at $filePath", null)
                            return@setMethodCallHandler
                        }

                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            if (!packageManager.canRequestPackageInstalls()) {
                                val permissionIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                                    data = Uri.parse("package:$packageName")
                                }
                                startActivity(permissionIntent)
                            }
                        }

                        val apkUri = androidx.core.content.FileProvider.getUriForFile(
                            this,
                            "$packageName.fileprovider",
                            file
                        )

                        val installIntent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(apkUri, "application/vnd.android.package-archive")
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                        }
                        startActivity(installIntent)
                        result.success(true)
                    } catch (e: Exception) {
                        result.error("INSTALL_ERROR", e.localizedMessage, null)
                    }
                }
                else -> result.notImplemented()
            }
        }

        // EventChannel: Real-time SMS Stream with SIM slot & carrier
        EventChannel(flutterEngine.dartExecutor.binaryMessenger, SMS_EVENT_CHANNEL).setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                    smsEventSink = events
                    SmsListenerReceiver.smsListenerCallback = { data ->
                        runOnUiThread {
                            smsEventSink?.success(data)
                        }
                    }
                }

                override fun onCancel(arguments: Any?) {
                    smsEventSink = null
                    SmsListenerReceiver.smsListenerCallback = null
                }
            }
        )

        // EventChannel: Real-time Push Notification Stream
        EventChannel(flutterEngine.dartExecutor.binaryMessenger, NOTIF_EVENT_CHANNEL).setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                    notifEventSink = events
                    MfsNotificationListener.notificationCallback = { data ->
                        runOnUiThread {
                            notifEventSink?.success(data)
                        }
                    }
                }

                override fun onCancel(arguments: Any?) {
                    notifEventSink = null
                    MfsNotificationListener.notificationCallback = null
                }
            }
        )
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            val banglaLocale = Locale("bn", "BD")
            val res = tts?.setLanguage(banglaLocale)
            if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                tts?.setLanguage(Locale("bn"))
            }
            tts?.setSpeechRate(0.95f)
            isTtsReady = true
        }
    }

    private fun speakOut(text: String) {
        if (isTtsReady && tts != null && text.isNotBlank()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "SyncPaySoundbox")
            } else {
                @Suppress("DEPRECATION")
                tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null)
            }
        }
    }

    private fun gatherDeviceTelemetry(): Map<String, Any> {
        val telemetry = mutableMapOf<String, Any>()

        // 1. Battery & Charger Telemetry
        val ifilter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        val bIntent = registerReceiver(null, ifilter)
        if (bIntent != null) {
            val level = bIntent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = bIntent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
            val batteryPct = if (level >= 0 && scale > 0) (level * 100) / scale else 0

            val status = bIntent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
            val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL

            val chargePlug = bIntent.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1)
            val chargerType = when (chargePlug) {
                BatteryManager.BATTERY_PLUGGED_AC -> "AC"
                BatteryManager.BATTERY_PLUGGED_USB -> "USB"
                BatteryManager.BATTERY_PLUGGED_WIRELESS -> "WIRELESS"
                else -> "BATTERY"
            }

            val tempTenths = bIntent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0)
            val tempCelsius = tempTenths / 10.0

            telemetry["battery_level"] = batteryPct
            telemetry["is_charging"] = isCharging
            telemetry["charger_type"] = chargerType
            telemetry["battery_temperature"] = tempCelsius
        }

        // 2. RAM Memory Telemetry
        val actManager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val memInfo = ActivityManager.MemoryInfo()
        actManager.getMemoryInfo(memInfo)
        telemetry["free_ram_mb"] = (memInfo.availMem / (1024 * 1024)).toInt()
        telemetry["total_ram_mb"] = (memInfo.totalMem / (1024 * 1024)).toInt()

        // 3. SIM Slot Telemetry
        val simSlots = mutableListOf<Map<String, Any>>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
            try {
                val subManager = getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? SubscriptionManager
                val activeList = subManager?.activeSubscriptionInfoList
                if (!activeList.isNullOrEmpty()) {
                    for (sub in activeList) {
                        simSlots.add(
                            mapOf(
                                "slot_index" to sub.simSlotIndex,
                                "carrier" to (sub.displayName?.toString() ?: sub.carrierName?.toString() ?: "Unknown"),
                                "sim_id" to sub.subscriptionId
                            )
                        )
                    }
                }
            } catch (e: Exception) {}
        }
        telemetry["sim_slots"] = simSlots

        // 4. Genuine Device Hardware & OS Identity (No Demo Placeholders)
        val manufacturer = Build.MANUFACTURER?.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() } ?: "Android"
        val model = Build.MODEL ?: "Device"
        val brand = Build.BRAND?.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() } ?: manufacturer
        val fullDeviceName = if (model.startsWith(manufacturer, ignoreCase = true)) model else "$manufacturer $model"
        val androidVersion = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"

        var appVersion = "1.2.0"
        try {
            val pInfo = packageManager.getPackageInfo(packageName, 0)
            val vCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) pInfo.longVersionCode else pInfo.versionCode.toLong()
            appVersion = "${pInfo.versionName} (Build $vCode)"
        } catch (e: Exception) {}

        telemetry["device_name"] = fullDeviceName
        telemetry["device_model"] = model
        telemetry["device_brand"] = brand
        telemetry["device_manufacturer"] = manufacturer
        telemetry["android_version"] = androidVersion
        telemetry["app_version"] = appVersion
        telemetry["sdk_int"] = Build.VERSION.SDK_INT

        return telemetry
    }

    private fun readRecentInboxSms(minutesBack: Int): List<Map<String, Any>> {
        val result = mutableListOf<Map<String, Any>>()
        val cutOffTime = System.currentTimeMillis() - (minutesBack * 60 * 1000L)

        val cursor = contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            arrayOf(Telephony.Sms.Inbox.ADDRESS, Telephony.Sms.Inbox.BODY, Telephony.Sms.Inbox.DATE),
            "${Telephony.Sms.Inbox.DATE} >= ?",
            arrayOf(cutOffTime.toString()),
            "${Telephony.Sms.Inbox.DATE} DESC"
        )

        cursor?.use {
            val addrIdx = it.getColumnIndex(Telephony.Sms.Inbox.ADDRESS)
            val bodyIdx = it.getColumnIndex(Telephony.Sms.Inbox.BODY)
            val dateIdx = it.getColumnIndex(Telephony.Sms.Inbox.DATE)

            while (it.moveToNext()) {
                val sender = if (addrIdx >= 0) it.getString(addrIdx) ?: "" else ""
                val body = if (bodyIdx >= 0) it.getString(bodyIdx) ?: "" else ""
                val timestamp = if (dateIdx >= 0) it.getLong(dateIdx) else 0L

                val upper = "$sender $body".uppercase()
                if (upper.contains("BKASH") || upper.contains("NAGAD") || upper.contains("ROCKET") || upper.contains("UPAY") || upper.contains("TRXID")) {
                    result.add(
                        mapOf(
                            "sender" to sender,
                            "body" to body,
                            "timestamp" to timestamp
                        )
                    )
                }
            }
        }
        return result
    }

    override fun onDestroy() {
        tts?.stop()
        tts?.shutdown()
        super.onDestroy()
    }
}

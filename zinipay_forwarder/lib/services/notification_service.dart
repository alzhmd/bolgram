import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class NotificationService {
  static final _plugin = FlutterLocalNotificationsPlugin();
  static bool _initialized = false;

  static Future<void> init() async {
    if (_initialized) return;
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const initSettings = InitializationSettings(android: androidInit);
    await _plugin.initialize(initSettings, onDidReceiveNotificationResponse: (_) {});
    await _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.requestNotificationsPermission();
    _initialized = true;
  }

  static Future<void> showSmsForwarded({
    required String provider,
    required double amount,
    required String trxId,
  }) async {
    await init();
    await _plugin.show(
      DateTime.now().millisecondsSinceEpoch ~/ 1000,
      '✅ $provider Payment Forwarded',
      '৳${amount.toStringAsFixed(2)} — TrxID: $trxId',
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'zinipay_sms', 'SMS Forwarded',
          channelDescription: 'SyncPay BD payment SMS forwarding alerts',
          importance: Importance.high,
          priority: Priority.high,
        ),
      ),
    );
  }

  static Future<void> showBigPayment({
    required String provider,
    required double amount,
    required String trxId,
  }) async {
    await init();
    await _plugin.show(
      (DateTime.now().millisecondsSinceEpoch ~/ 1000) + 1,
      '🔔 বড় পেমেন্ট! ৳${amount.toStringAsFixed(2)}',
      '$provider — TrxID: $trxId',
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'zinipay_big', 'Big Payment Alert',
          channelDescription: 'Alert for payments ≥ ৳5,000',
          importance: Importance.max,
          priority: Priority.max,
          playSound: true,
        ),
      ),
    );
  }

  static Future<void> showSyncComplete(int count) async {
    await init();
    await _plugin.show(
      9999,
      '☁️ Sync Complete',
      '$count টি SMS সফলভাবে পাঠানো হয়েছে',
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'zinipay_sync', 'Sync Status',
          channelDescription: 'Offline queue sync notifications',
          importance: Importance.defaultImportance,
        ),
      ),
    );
  }
}

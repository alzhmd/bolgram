import 'dart:async';
import 'package:flutter/services.dart';
import '../core/config/app_config.dart';

typedef SmsStreamHandler = void Function(Map<String, dynamic> data);

class TelephonyChannelService {
  static const MethodChannel _methodChannel = MethodChannel(AppConfig.methodChannelName);
  static const EventChannel _smsEventChannel = EventChannel(AppConfig.smsEventChannelName);
  static const EventChannel _notifEventChannel = EventChannel(AppConfig.notificationEventChannelName);

  StreamSubscription? _smsSubscription;
  StreamSubscription? _notifSubscription;

  void startListening(SmsStreamHandler onSmsReceived) {
    try {
      _smsSubscription = _smsEventChannel.receiveBroadcastStream().listen(
        (dynamic event) {
          if (event is Map) {
            final data = Map<String, dynamic>.from(event);
            onSmsReceived(data);
          }
        },
        onError: (dynamic error) {},
      );
    } catch (_) {}
  }

  void startListeningNotifications(Function(Map<String, dynamic> data) onNotification) {
    try {
      _notifSubscription = _notifEventChannel.receiveBroadcastStream().listen(
        (dynamic event) {
          if (event is Map) {
            final data = Map<String, dynamic>.from(event);
            onNotification(data);
          }
        },
        onError: (dynamic error) {},
      );
    } catch (_) {}
  }

  Future<bool> startForegroundService() async {
    try {
      final res = await _methodChannel.invokeMethod<bool>('startForegroundService');
      return res ?? false;
    } catch (_) {
      return false;
    }
  }

  Future<bool> stopForegroundService() async {
    try {
      final res = await _methodChannel.invokeMethod<bool>('stopForegroundService');
      return res ?? false;
    } catch (_) {
      return false;
    }
  }

  Future<void> requestBatteryOptimization() async {
    try {
      await _methodChannel.invokeMethod('requestBatteryOptimization');
    } catch (_) {}
  }

  /// Queries hardware, battery %, charger, temperature, and RAM
  Future<Map<dynamic, dynamic>> getDeviceTelemetry() async {
    try {
      final res = await _methodChannel.invokeMethod<Map<dynamic, dynamic>>('getDeviceTelemetry');
      return res ?? {};
    } catch (_) {
      return {};
    }
  }

  /// Text-To-Speech announcement in Bengali
  Future<void> speakBengali(String text) async {
    try {
      await _methodChannel.invokeMethod('speakBengali', {'text': text});
    } catch (_) {}
  }

  /// Checks if NotificationListenerService has user permission
  Future<bool> isNotificationListenerEnabled() async {
    try {
      final res = await _methodChannel.invokeMethod<bool>('isNotificationListenerEnabled');
      return res ?? false;
    } catch (_) {
      return false;
    }
  }

  /// Opens Android Settings screen to grant Notification Access
  Future<void> openNotificationListenerSettings() async {
    try {
      await _methodChannel.invokeMethod('openNotificationListenerSettings');
    } catch (_) {}
  }

  /// Reads recent historical SMS from device inbox (missed SMS resync)
  Future<List<Map<String, dynamic>>> readRecentSms({int minutes = 60}) async {
    try {
      final res = await _methodChannel.invokeListMethod<Map>('readRecentSms', {'minutes': minutes});
      return res?.map((e) => Map<String, dynamic>.from(e)).toList() ?? [];
    } catch (_) {
      return [];
    }
  }

  /// Launch Android Package Installer for downloaded APK
  Future<bool> installApk(String filePath) async {
    try {
      final res = await _methodChannel.invokeMethod<bool>('installApk', {'filePath': filePath});
      return res ?? false;
    } catch (e) {
      return false;
    }
  }

  void stopListening() {
    _smsSubscription?.cancel();
    _smsSubscription = null;
  }

  void stopListeningNotifications() {
    _notifSubscription?.cancel();
    _notifSubscription = null;
  }
}

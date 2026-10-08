import 'package:flutter/services.dart';

/// One forwarded SMS outcome (the SMS text itself is never stored, only sender and result).
class HistoryItem {
  HistoryItem({required this.at, required this.sender, required this.status, required this.detail, required this.amountRial});
  final int at;
  final String sender;
  final String status; // sent | duplicate | ignored
  final String detail;
  final int amountRial;
}

class AppState {
  AppState({
    this.paired = false,
    this.server = '',
    this.deviceName = '',
    this.pending = 0,
    this.lastOk = 0,
    this.lastHeartbeat = 0,
    this.lastError,
    this.authError = false,
    this.sendersCount = 0,
    this.appVersion = '',
    this.history = const [],
  });

  final bool paired;
  final String server;
  final String deviceName;
  final int pending;
  final int lastOk;
  final int lastHeartbeat;
  final String? lastError;
  final bool authError;
  final int sendersCount;
  final String appVersion;
  final List<HistoryItem> history;

  factory AppState.fromMap(Map<dynamic, dynamic> m) {
    int i(Object? v) => v is num ? v.toInt() : 0;
    final list = (m['history'] as List? ?? const [])
        .map((e) => e as Map)
        .map((e) => HistoryItem(
              at: i(e['at']),
              sender: '${e['sender'] ?? ''}',
              status: '${e['status'] ?? ''}',
              detail: '${e['detail'] ?? ''}',
              amountRial: i(e['amount']),
            ))
        .toList();
    return AppState(
      paired: m['paired'] == true,
      server: '${m['server'] ?? ''}',
      deviceName: '${m['deviceName'] ?? ''}',
      pending: i(m['pending']),
      lastOk: i(m['lastOk']),
      lastHeartbeat: i(m['lastHeartbeat']),
      lastError: m['lastError'] as String?,
      authError: m['authError'] == true,
      sendersCount: i(m['sendersCount']),
      appVersion: '${m['appVersion'] ?? ''}',
      history: list,
    );
  }
}

class Perms {
  const Perms({this.sms = false, this.notifications = false, this.battery = false, this.phone = false});
  final bool sms;
  final bool notifications;
  final bool battery;
  final bool phone;

  factory Perms.fromMap(Map<dynamic, dynamic> m) => Perms(
        sms: m['sms'] == true,
        notifications: m['notifications'] == true,
        battery: m['battery'] == true,
        phone: m['phone'] == true,
      );
}

/// Bridge to the native layer (capture, offline queue, sending and the foreground service live in Kotlin).
class Native {
  static const _ch = MethodChannel('ir.bolgram.forwarder/native');

  static Future<AppState> state() async => AppState.fromMap(await _ch.invokeMethod<Map>('getState') ?? {});
  static Future<Perms> permissions() async => Perms.fromMap(await _ch.invokeMethod<Map>('permissions') ?? {});
  static Future<Perms> requestPermissions() async => Perms.fromMap(await _ch.invokeMethod<Map>('requestPermissions') ?? {});
  static Future<void> requestBattery() => _ch.invokeMethod('requestBattery');
  static Future<void> openAppSettings() => _ch.invokeMethod('openAppSettings');
  static Future<void> saveConfig(String server, String token, String name) =>
      _ch.invokeMethod('saveConfig', {'server': server, 'token': token, 'name': name});
  static Future<void> clearConfig() => _ch.invokeMethod('clearConfig');
  static Future<void> startService() => _ch.invokeMethod('startService');
  static Future<void> flushNow() => _ch.invokeMethod('flushNow');
}

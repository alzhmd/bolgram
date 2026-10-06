import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../config/app_config.dart';
import '../security/security_utils.dart';

class LocalVault {
  static const String _keyDeviceId = 'zp_device_id';
  static const String _keyDeviceToken = 'zp_device_token';
  static const String _keyDeviceName = 'zp_device_name';
  static const String _keyAndroidVersion = 'zp_android_version';
  static const String _keyMerchantId = 'zp_merchant_id';
  static const String _keyMerchantName = 'zp_merchant_name';
  static const String _keyBackendUrl = 'zp_backend_url';
  static const String _keyLanguage = 'zp_language';
  static const String _keyThemeMode = 'zp_theme_mode';
  static const String _keyProviderBkash = 'zp_prov_bkash';
  static const String _keyProviderNagad = 'zp_prov_nagad';
  static const String _keyProviderRocket = 'zp_prov_rocket';
  static const String _keyProviderUpay = 'zp_prov_upay';
  static const String _keyOfflineQueue = 'zp_offline_queue';
  static const String _keyHistoryTransactions = 'zp_history_transactions';
  static const String _keyActivityLogs = 'zp_activity_logs';
  static const String _keyAutoSync = 'zp_auto_sync';

  final SharedPreferences _prefs;

  LocalVault(this._prefs);

  static Future<LocalVault> init() async {
    final prefs = await SharedPreferences.getInstance();
    return LocalVault(prefs);
  }

  // Device & Merchant Pairing
  String get deviceId {
    var id = _prefs.getString(_keyDeviceId);
    if (id == null || id.isEmpty) {
      id = SecurityUtils.generateDeviceId();
      _prefs.setString(_keyDeviceId, id);
    }
    return id;
  }

  Future<void> setDeviceId(String id) => _prefs.setString(_keyDeviceId, id);

  String get deviceName => _prefs.getString(_keyDeviceName) ?? '';
  Future<void> setDeviceName(String name) => _prefs.setString(_keyDeviceName, name);

  String get androidVersion => _prefs.getString(_keyAndroidVersion) ?? '';
  Future<void> setAndroidVersion(String v) => _prefs.setString(_keyAndroidVersion, v);

  String get deviceToken => _prefs.getString(_keyDeviceToken) ?? '';
  Future<void> setDeviceToken(String token) => _prefs.setString(_keyDeviceToken, token);

  String get merchantId => _prefs.getString(_keyMerchantId) ?? '';
  Future<void> setMerchantId(String id) => _prefs.setString(_keyMerchantId, id);

  String get merchantName => _prefs.getString(_keyMerchantName) ?? '';
  Future<void> setMerchantName(String name) => _prefs.setString(_keyMerchantName, name);

  String get backendUrl => _prefs.getString(_keyBackendUrl) ?? AppConfig.defaultProductionBackendUrl;
  Future<void> setBackendUrl(String url) => _prefs.setString(_keyBackendUrl, url);

  bool get isPaired => (_prefs.getString(_keyDeviceToken)?.isNotEmpty ?? false);

  // Localization & Theme
  String get language => _prefs.getString(_keyLanguage) ?? 'bn'; // Default Bangla
  Future<void> setLanguage(String code) => _prefs.setString(_keyLanguage, code);

  String get themeMode => _prefs.getString(_keyThemeMode) ?? 'light'; // dark, light, system
  Future<void> setThemeMode(String mode) => _prefs.setString(_keyThemeMode, mode);

  // MFS Provider Toggles
  bool get bkashEnabled => _prefs.getBool(_keyProviderBkash) ?? true;
  Future<void> setBkashEnabled(bool enabled) => _prefs.setBool(_keyProviderBkash, enabled);

  bool get nagadEnabled => _prefs.getBool(_keyProviderNagad) ?? true;
  Future<void> setNagadEnabled(bool enabled) => _prefs.setBool(_keyProviderNagad, enabled);

  bool get rocketEnabled => _prefs.getBool(_keyProviderRocket) ?? true;
  Future<void> setRocketEnabled(bool enabled) => _prefs.setBool(_keyProviderRocket, enabled);

  bool get upayEnabled => _prefs.getBool(_keyProviderUpay) ?? true;
  Future<void> setUpayEnabled(bool enabled) => _prefs.setBool(_keyProviderUpay, enabled);

  bool get autoSync => _prefs.getBool(_keyAutoSync) ?? true;
  Future<void> setAutoSync(bool enabled) => _prefs.setBool(_keyAutoSync, enabled);

  // Offline Queue (JSON List)
  List<Map<String, dynamic>> getOfflineQueue() {
    final raw = _prefs.getString(_keyOfflineQueue);
    if (raw == null || raw.isEmpty) return [];
    try {
      final decoded = jsonDecode(raw) as List;
      return decoded.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> saveOfflineQueue(List<Map<String, dynamic>> items) async {
    await _prefs.setString(_keyOfflineQueue, jsonEncode(items));
  }

  // Synced Transactions (JSON List)
  List<Map<String, dynamic>> getTransactionHistory() {
    final raw = _prefs.getString(_keyHistoryTransactions);
    if (raw == null || raw.isEmpty) return [];
    try {
      final decoded = jsonDecode(raw) as List;
      return decoded.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> saveTransactionHistory(List<Map<String, dynamic>> items) async {
    // Keep last 200 transactions
    final trimmed = items.length > 200 ? items.sublist(0, 200) : items;
    await _prefs.setString(_keyHistoryTransactions, jsonEncode(trimmed));
  }

  // Sanitized Activity Logs
  List<Map<String, dynamic>> getActivityLogs() {
    final raw = _prefs.getString(_keyActivityLogs);
    if (raw == null || raw.isEmpty) return [];
    try {
      final decoded = jsonDecode(raw) as List;
      return decoded.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> addLog(String action, String details) async {
    final logs = getActivityLogs();
    logs.insert(0, {
      'timestamp': DateTime.now().toIso8601String(),
      'action': action,
      'details': details,
    });
    // Keep max 150 logs
    final trimmed = logs.length > 150 ? logs.sublist(0, 150) : logs;
    await _prefs.setString(_keyActivityLogs, jsonEncode(trimmed));
  }

  Future<void> clearLogs() async {
    await _prefs.remove(_keyActivityLogs);
  }

  /// Disconnect device clears sensitive auth credentials while preserving device ID
  Future<void> disconnectDevice() async {
    await _prefs.remove(_keyDeviceToken);
    await _prefs.remove(_keyMerchantId);
    await _prefs.remove(_keyMerchantName);
    await _prefs.remove(_keyOfflineQueue);
    await addLog('Device Disconnected', 'Auth credentials and queue cleared by user');
  }
}

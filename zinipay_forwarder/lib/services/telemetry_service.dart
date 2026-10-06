import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../core/config/app_config.dart';
import 'telephony_channel_service.dart';

class DeviceTelemetry {
  final int batteryLevel;
  final bool isCharging;
  final String chargerType;
  final double batteryTemperature;
  final int freeRamMb;
  final int totalRamMb;
  final List<Map<String, dynamic>> simSlots;
  final String deviceName;
  final String deviceModel;
  final String deviceManufacturer;
  final String deviceBrand;
  final String androidVersion;
  final String appVersion;

  const DeviceTelemetry({
    this.batteryLevel = 100,
    this.isCharging = false,
    this.chargerType = 'BATTERY',
    this.batteryTemperature = 25.0,
    this.freeRamMb = 512,
    this.totalRamMb = 2048,
    this.simSlots = const [],
    this.deviceName = '',
    this.deviceModel = '',
    this.deviceManufacturer = '',
    this.deviceBrand = '',
    this.androidVersion = '',
    this.appVersion = '1.2.0',
  });

  factory DeviceTelemetry.fromMap(Map<dynamic, dynamic> map) {
    return DeviceTelemetry(
      batteryLevel: (map['battery_level'] as num?)?.toInt() ?? 100,
      isCharging: map['is_charging'] as bool? ?? false,
      chargerType: map['charger_type']?.toString() ?? 'BATTERY',
      batteryTemperature: (map['battery_temperature'] as num?)?.toDouble() ?? 25.0,
      freeRamMb: (map['free_ram_mb'] as num?)?.toInt() ?? 512,
      totalRamMb: (map['total_ram_mb'] as num?)?.toInt() ?? 2048,
      simSlots: (map['sim_slots'] as List?)?.map((e) => Map<String, dynamic>.from(e as Map)).toList() ?? [],
      deviceName: map['device_name']?.toString() ?? '',
      deviceModel: map['device_model']?.toString() ?? '',
      deviceManufacturer: map['device_manufacturer']?.toString() ?? '',
      deviceBrand: map['device_brand']?.toString() ?? '',
      androidVersion: map['android_version']?.toString() ?? '',
      appVersion: map['app_version']?.toString() ?? '1.2.0',
    );
  }

  Map<String, dynamic> toJson() => {
    'battery_level': batteryLevel,
    'is_charging': isCharging,
    'charger_type': chargerType,
    'battery_temperature': batteryTemperature,
    'free_ram_mb': freeRamMb,
    'total_ram_mb': totalRamMb,
    'sim_slots': simSlots,
    'device_name': deviceName,
    'device_model': deviceModel,
    'device_manufacturer': deviceManufacturer,
    'device_brand': deviceBrand,
    'android_version': androidVersion,
    'app_version': appVersion,
  };
}

class TelemetryService {
  final TelephonyChannelService _channelService;

  TelemetryService({TelephonyChannelService? channelService})
      : _channelService = channelService ?? TelephonyChannelService();

  Future<DeviceTelemetry> sampleTelemetry() async {
    final raw = await _channelService.getDeviceTelemetry();
    return DeviceTelemetry.fromMap(raw);
  }

  /// Sends periodic heartbeat with attached hardware telemetry
  Future<Map<String, dynamic>?> sendHeartbeatWithTelemetry() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('zp_device_token') ?? 'token_phone_primary';
    final baseUrl = prefs.getString('zp_backend_url') ?? AppConfig.defaultProductionBackendUrl;

    final telemetry = await sampleTelemetry();

    final endpoint = Uri.parse('${baseUrl.replaceAll(RegExp(r'/+$'), '')}${AppConfig.heartbeatEndpoint}');

    final payload = {
      'device_token': token,
      'device_id': prefs.getString('zp_device_id') ?? '',
      'device_name': telemetry.deviceName.isNotEmpty ? telemetry.deviceName : (prefs.getString('zp_device_name') ?? ''),
      'device_model': telemetry.deviceModel,
      'android_version': telemetry.androidVersion,
      'battery_level': telemetry.batteryLevel,
      'is_charging': telemetry.isCharging,
      'charger_type': telemetry.chargerType,
      'battery_temperature': telemetry.batteryTemperature,
      'free_ram_mb': telemetry.freeRamMb,
      'total_ram_mb': telemetry.totalRamMb,
      'sim_slots': telemetry.simSlots,
      'timestamp': DateTime.now().toIso8601String(),
    };

    try {
      final res = await http.post(
        endpoint,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode(payload),
      ).timeout(const Duration(seconds: 10));

      if (res.statusCode == 200) {
        return jsonDecode(res.body) as Map<String, dynamic>?;
      }
    } catch (_) {
      // Offline / unreachable
    }
    return null;
  }
}

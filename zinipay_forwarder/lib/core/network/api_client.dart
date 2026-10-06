import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';

class IngestApiResponse {
  final bool success;
  final int statusCode;
  final bool isDuplicate;
  final String? message;
  final String? trxId;
  final double? amount;
  final String? provider;
  final String? matchedInvoiceId;
  final String? errorMessage;

  const IngestApiResponse({
    required this.success,
    required this.statusCode,
    this.isDuplicate = false,
    this.message,
    this.trxId,
    this.amount,
    this.provider,
    this.matchedInvoiceId,
    this.errorMessage,
  });
}

class ApiClient {
  final http.Client _client;

  ApiClient({http.Client? client}) : _client = client ?? http.Client();

  /// Ingests SMS to /api/v1/device/sms/ingest
  Future<IngestApiResponse> ingestSms({
    required String backendUrl,
    required String deviceToken,
    required String deviceId,
    required String sms,
    String? sender,
    DateTime? receivedAt,
    int? simSlot,
    String? carrier,
    String? source,
  }) async {
    final cleanUrl = backendUrl.replaceAll(RegExp(r'/+$'), '');
    final uri = Uri.parse('$cleanUrl${AppConfig.ingestEndpoint}');

    final payload = {
      'device_id': deviceToken.isNotEmpty ? deviceToken : deviceId,
      'sms': sms,
      if (sender != null && sender.isNotEmpty) 'sender': sender,
      if (simSlot != null) 'sim_slot': simSlot,
      if (carrier != null && carrier.isNotEmpty) 'carrier': carrier,
      if (source != null && source.isNotEmpty) 'source': source,
      'received_at': (receivedAt ?? DateTime.now()).toIso8601String(),
    };

    try {
      final response = await _client
          .post(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $deviceToken',
            },
            body: jsonEncode(payload),
          )
          .timeout(const Duration(seconds: 15));

      final Map<String, dynamic> body = response.body.isNotEmpty
          ? (jsonDecode(response.body) as Map<String, dynamic>)
          : {};

      if (response.statusCode == 201) {
        final trx = body['transaction'] as Map<String, dynamic>?;
        return IngestApiResponse(
          success: true,
          statusCode: 201,
          message: body['message'] as String?,
          trxId: trx?['trx_id'] as String?,
          amount: (trx?['amount'] as num?)?.toDouble(),
          provider: trx?['provider'] as String?,
          matchedInvoiceId: body['matched_invoice_id'] as String?,
        );
      } else if (response.statusCode == 200 && body['isDuplicate'] == true) {
        return IngestApiResponse(
          success: true,
          statusCode: 200,
          isDuplicate: true,
          message: body['message'] as String? ?? 'Transaction already recorded (Duplicate blocked)',
          trxId: body['trxId'] as String?,
        );
      } else if (response.statusCode == 401) {
        return const IngestApiResponse(
          success: false,
          statusCode: 401,
          errorMessage: 'Device authentication failed. Verify Pairing Token.',
        );
      } else if (response.statusCode == 403) {
        return const IngestApiResponse(
          success: false,
          statusCode: 403,
          errorMessage: 'Device or merchant account is disabled/suspended.',
        );
      } else if (response.statusCode == 422) {
        return IngestApiResponse(
          success: false,
          statusCode: 422,
          errorMessage: body['error'] as String? ?? 'MFS Parsing or financial integrity failure',
        );
      } else {
        return IngestApiResponse(
          success: false,
          statusCode: response.statusCode,
          errorMessage: body['error'] as String? ?? 'Server returned HTTP ${response.statusCode}',
        );
      }
    } on SocketException catch (e) {
      return IngestApiResponse(
        success: false,
        statusCode: 0,
        errorMessage: 'Network error: ${e.message}. Saved locally for offline sync.',
      );
    } on http.ClientException catch (e) {
      return IngestApiResponse(
        success: false,
        statusCode: 0,
        errorMessage: 'HTTP client error: ${e.message}',
      );
    } catch (e) {
      return IngestApiResponse(
        success: false,
        statusCode: 0,
        errorMessage: 'Connection failed: $e',
      );
    }
  }

  /// Sends device heartbeat to /api/v1/device/heartbeat
  Future<bool> sendHeartbeat({
    required String backendUrl,
    required String deviceToken,
  }) async {
    final cleanUrl = backendUrl.replaceAll(RegExp(r'/+$'), '');
    final uri = Uri.parse('$cleanUrl${AppConfig.heartbeatEndpoint}');

    try {
      final response = await _client
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'device_token': deviceToken}),
          )
          .timeout(const Duration(seconds: 8));

      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Measures connection latency in milliseconds
  Future<int?> measureLatency({
    required String backendUrl,
    required String deviceToken,
  }) async {
    final stopwatch = Stopwatch()..start();
    final ok = await sendHeartbeat(backendUrl: backendUrl, deviceToken: deviceToken);
    stopwatch.stop();
    return ok ? stopwatch.elapsedMilliseconds : null;
  }
}

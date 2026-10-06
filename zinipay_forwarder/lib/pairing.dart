import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Default server for typed codes (override at build time: --dart-define=BOLGRAM_SERVER=https://...).
const defaultServer = String.fromEnvironment('BOLGRAM_SERVER', defaultValue: 'https://bolgram.ir');

/// What a scanned QR / pasted text contains.
class PairInput {
  const PairInput({this.server, this.code, this.token, this.name});
  final String? server;
  final String? code;

  /// Only set for the legacy QR (a ready device token instead of a one-time code).
  final String? token;
  final String? name;
}

/// 8-character pairing code without ambiguous characters, upper-cased; null when it is not a code.
String? normalizeCode(String raw) {
  final c = raw.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');
  return RegExp(r'^[A-HJ-NP-Z2-9]{8}$').hasMatch(c) ? c : null;
}

/// Accepts `bolgram://pair?s=<server>&c=<code>`, a bare code, or the legacy JSON QR.
PairInput? parsePairInput(String raw) {
  final text = raw.trim();
  if (text.isEmpty) return null;
  if (text.startsWith('bolgram://')) {
    final uri = Uri.tryParse(text);
    if (uri == null || uri.host != 'pair') return null;
    final code = normalizeCode(uri.queryParameters['c'] ?? '');
    final server = normalizeServer(uri.queryParameters['s'] ?? '');
    if (code == null || server == null) return null;
    return PairInput(server: server, code: code);
  }
  if (text.startsWith('{')) {
    try {
      final j = jsonDecode(text) as Map<String, dynamic>;
      final server = normalizeServer('${j['backend_url'] ?? ''}');
      final token = '${j['device_token'] ?? ''}'.trim();
      if (server == null || token.isEmpty) return null;
      return PairInput(server: server, token: token, name: '${j['device_name'] ?? ''}');
    } catch (_) {
      return null;
    }
  }
  final code = normalizeCode(text);
  return code == null ? null : PairInput(code: code);
}

/// https://host (adds the scheme, strips path and trailing slash); null when not a usable URL.
String? normalizeServer(String raw) {
  var s = raw.trim();
  if (s.isEmpty) return null;
  if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(s)) s = 'https://$s';
  final u = Uri.tryParse(s);
  if (u == null || u.host.isEmpty || !u.host.contains(RegExp(r'[.]|^localhost$|^\d'))) return null;
  return '${u.scheme}://${u.host}${u.hasPort ? ':${u.port}' : ''}';
}

class PairError implements Exception {
  PairError(this.message);
  final String message;
  @override
  String toString() => message;
}

class PairResult {
  PairResult(this.token, this.deviceName, this.merchantName);
  final String token;
  final String deviceName;
  final String merchantName;
}

/// Exchanges the one-time code for a device token (POST /api/v1/device/pair).
Future<PairResult> exchangeCode(String server, String code, {http.Client? client}) async {
  final c = client ?? http.Client();
  try {
    final res = await c
        .post(
          Uri.parse('$server/api/v1/device/pair'),
          headers: {'Content-Type': 'application/json; charset=utf-8'},
          body: jsonEncode({'code': code, 'device_name': 'گوشی اندروید', 'app_version': '1.0.0'}),
        )
        .timeout(const Duration(seconds: 20));
    final body = utf8.decode(res.bodyBytes);
    Map<String, dynamic> j = {};
    try {
      j = jsonDecode(body) as Map<String, dynamic>;
    } catch (_) {}
    if (res.statusCode == 201 && j['device_token'] is String) {
      return PairResult('${j['device_token']}', '${j['device_name'] ?? ''}', '${j['merchant_name'] ?? ''}');
    }
    throw PairError('${j['message'] ?? 'اتصال انجام نشد (کد ${res.statusCode})'}');
  } on TimeoutException {
    throw PairError('پاسخی از سرور نرسید؛ اینترنت را بررسی کنید');
  } on PairError {
    rethrow;
  } catch (_) {
    throw PairError('اتصال به سرور برقرار نشد؛ اینترنت و آدرس سرور را بررسی کنید');
  } finally {
    if (client == null) c.close();
  }
}

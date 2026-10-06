import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';

class SecurityUtils {
  /// Masks a phone number e.g. 01712345678 -> 017*****678
  static String maskPhoneNumber(String phone) {
    final clean = phone.replaceAll(RegExp(r'^\+?88'), '').trim();
    if (clean.length <= 5) return clean;
    final prefix = clean.substring(0, 3);
    final suffix = clean.substring(clean.length - 3);
    final maskedLength = clean.length - 6;
    final stars = '*' * (maskedLength > 0 ? maskedLength : 3);
    return '$prefix$stars$suffix';
  }

  /// Masks a sensitive device or pairing token e.g. token_phone_primary -> tok••••••mary
  static String maskToken(String token) {
    if (token.length <= 6) return '••••••';
    final prefix = token.substring(0, 3);
    final suffix = token.substring(token.length - 4);
    return '$prefix••••••••$suffix';
  }

  /// Masks sensitive numeric details inside raw SMS for logs/diagnostics
  static String sanitizeRawSms(String rawSms) {
    // Mask phone numbers inside text
    return rawSms.replaceAllMapped(RegExp(r'01[3-9]\d{8}'), (match) {
      return maskPhoneNumber(match.group(0)!);
    });
  }

  /// Generates a unique SHA-256 fingerprint for a transaction to prevent client-side double queuing
  static String generateFingerprint(String provider, String trxId, double amount) {
    final payload = '${provider.toUpperCase()}:${trxId.toUpperCase()}:${amount.toStringAsFixed(2)}';
    return sha256.convert(utf8.encode(payload)).toString();
  }

  /// Generates a standardized Device ID e.g. ZP-AND-82A91
  static String generateDeviceId() {
    final random = Random();
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    final suffix = List.generate(5, (_) => chars[random.nextInt(chars.length)]).join();
    return 'ZP-AND-$suffix';
  }
}

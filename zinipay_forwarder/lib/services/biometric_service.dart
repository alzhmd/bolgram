import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';

class BiometricService {
  static final _auth = LocalAuthentication();
  static const _key = 'biometric_lock_enabled';

  /// Check if biometrics are available on this device
  static Future<bool> isAvailable() async {
    try {
      final canCheck = await _auth.canCheckBiometrics;
      final isSupported = await _auth.isDeviceSupported();
      return canCheck && isSupported;
    } catch (_) {
      return false;
    }
  }

  /// List available biometric types (fingerprint, face, iris)
  static Future<List<BiometricType>> availableTypes() async {
    try {
      return await _auth.getAvailableBiometrics();
    } catch (_) {
      return [];
    }
  }

  /// Authenticate user — returns true if verified
  static Future<bool> authenticate({String reason = 'SyncPay BD Agent-এ প্রবেশ করুন'}) async {
    try {
      return await _auth.authenticate(
        localizedReason: reason,
        options: const AuthenticationOptions(
          biometricOnly: false,   // also allow PIN/pattern fallback
          stickyAuth: true,
          sensitiveTransaction: false,
        ),
      );
    } catch (_) {
      return false;
    }
  }

  /// Toggle lock setting
  static Future<void> setEnabled(bool val) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_key, val);
  }

  static Future<bool> isEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_key) ?? false;
  }
}

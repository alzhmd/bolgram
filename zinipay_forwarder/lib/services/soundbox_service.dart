import 'package:shared_preferences/shared_preferences.dart';
import 'telephony_channel_service.dart';

class SoundboxService {
  final TelephonyChannelService _channelService;

  static const String _prefKeyEnabled = 'zp_soundbox_enabled';
  static const String _prefKeyMinAmount = 'zp_soundbox_min_amount';

  SoundboxService({TelephonyChannelService? channelService})
      : _channelService = channelService ?? TelephonyChannelService();

  Future<bool> isEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_prefKeyEnabled) ?? true;
  }

  Future<void> setEnabled(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_prefKeyEnabled, enabled);
  }

  Future<double> getMinAmount() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getDouble(_prefKeyMinAmount) ?? 1.0;
  }

  Future<void> setMinAmount(double amount) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_prefKeyMinAmount, amount);
  }

  /// Announces a verified payment in Bengali voice
  Future<void> announcePayment({
    required String provider,
    required double amount,
    String? customerNumber,
  }) async {
    final enabled = await isEnabled();
    if (!enabled) return;

    final minAmt = await getMinAmount();
    if (amount < minAmt) return;

    final formattedAmt = amount % 1 == 0 ? amount.toInt().toString() : amount.toStringAsFixed(2);
    final banglaAmt = _convertToBanglaDigits(formattedAmt);

    final providerNormalized = provider.trim().toLowerCase();
    String providerBangla = 'পেমেন্ট';
    if (providerNormalized.contains('bkash') || providerNormalized.contains('বিকাশ')) {
      providerBangla = 'বিকাশে';
    } else if (providerNormalized.contains('nagad') || providerNormalized.contains('নগদ')) {
      providerBangla = 'নগদে';
    } else if (providerNormalized.contains('rocket') || providerNormalized.contains('রকেট')) {
      providerBangla = 'রকেটে';
    } else if (providerNormalized.contains('upay') || providerNormalized.contains('উপায়')) {
      providerBangla = 'উপায়ে';
    }

    final speech = '$providerBangla $banglaAmt টাকা সফলভাবে গৃহীত হয়েছে';
    await _channelService.speakBengali(speech);
  }

  Future<void> testAnnouncement() async {
    await _channelService.speakBengali('সিংক পে সাউন্ডবক্স টেস্ট সম্পন্ন হয়েছে');
  }

  String _convertToBanglaDigits(String input) {
    const english = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const bangla = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    var result = input;
    for (var i = 0; i < english.length; i++) {
      result = result.replaceAll(english[i], bangla[i]);
    }
    return result;
  }
}

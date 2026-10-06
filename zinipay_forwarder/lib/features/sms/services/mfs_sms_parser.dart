import '../../../../core/security/security_utils.dart';
import '../models/sms_transaction.dart';

class ParsedMfsResult {
  final bool success;
  final String provider; // 'bKash','Nagad','Rocket','Upay','DBBL','BRAC','IslamiBank','CityBank','UNKNOWN'
  final String? trxId;
  final double? amount;
  final String? sender;
  final double? balance;
  final String rawText;
  final String? error;

  const ParsedMfsResult({
    required this.success,
    required this.provider,
    this.trxId,
    this.amount,
    this.sender,
    this.balance,
    required this.rawText,
    this.error,
  });

  SmsTransaction toTransaction({int? simSlot, String? carrier, String? source = 'SMS'}) {
    final cleanTrx    = (trxId ?? '').toUpperCase();
    final cleanAmount = amount ?? 0.0;
    final fingerprint = SecurityUtils.generateFingerprint(provider, cleanTrx, cleanAmount);
    return SmsTransaction(
      id:         'trx_${DateTime.now().millisecondsSinceEpoch}_$cleanTrx',
      provider:   provider,
      trxId:      cleanTrx,
      amount:     cleanAmount,
      sender:     sender ?? '',
      rawSms:     rawText,
      receivedAt: DateTime.now(),
      status:     SmsStatus.received,
      fingerprint: fingerprint,
      simSlot:    simSlot,
      carrier:    carrier,
      source:     source,
    );
  }

  /// Human-friendly provider colour
  static int colorFor(String provider) {
    switch (provider) {
      case 'bKash':      return 0xFFE2136E;
      case 'Nagad':      return 0xFFF7941D;
      case 'Rocket':     return 0xFF8C3494;
      case 'Upay':       return 0xFF00A3E0;
      case 'DBBL':       return 0xFF005BAC;
      case 'BRAC':       return 0xFFE31837;
      case 'IslamiBank': return 0xFF006400;
      case 'CityBank':   return 0xFF003087;
      default:           return 0xFF6B7280;
    }
  }
}

/// Iranian bank SMS pre-filter for the device. The server holds the authoritative
/// per-bank templates; this only decides what to forward and shows a preview.
/// OTP / dynamic-password messages are never forwarded.
class MfsSmsParser {
  static const _fa = '۰۱۲۳۴۵۶۷۸۹';
  static const _ar = '٠١٢٣٤٥٦٧٨٩';
  static final _otp = RegExp(r'رمز|پویا|کد\s?(تایید|تأیید|ورود)|یک\s?بار\s?مصرف|otp|password', caseSensitive: false);
  static final _credit = RegExp(r'واریز|نشست|دریافت|\+\s?\d|\d[\d,]*\+');
  static final _debit = RegExp(r'برداشت|خرید|پرداخت|پرید|^-|\n-|\d[\d,]*-(?!\d)');
  static final _amount = RegExp(r'(?:واریز|مبلغ|انتقال|نشست)[^\d\n]{0,25}([\d,]{4,})|([+-]?\d{1,3}(?:,\d{3})+)[+-]?');
  static final _balance = RegExp(r'(?:مانده|موجودی)\s?:?\s?(-?[\d,]+)');
  static const _banks = {
    'ملت': 'mellat', 'ملی': 'melli', 'صادرات': 'saderat', 'تجارت': 'tejarat', 'سپه': 'sepah', 'سامان': 'saman',
    'بلو': 'blu', 'پاسارگاد': 'pasargad', 'پارسیان': 'parsian', 'آینده': 'ayandeh', 'کشاورزی': 'keshavarzi',
    'مسکن': 'maskan', 'رفاه': 'refah', 'شهر': 'shahr', 'رسالت': 'resalat', 'خاورمیانه': 'khavarmianeh',
  };

  static String normalize(String s) {
    final b = StringBuffer();
    for (final ch in s.split('')) {
      final i = _fa.indexOf(ch), j = _ar.indexOf(ch);
      b.write(i >= 0 ? '$i' : j >= 0 ? '$j' : ch);
    }
    return b.toString().replaceAll('ي', 'ی').replaceAll('ك', 'ک').replaceAll('٬', ',').replaceAll(RegExp(r'[‎‏‪-‮]'), '');
  }

  static ParsedMfsResult parse(String sender, String body) {
    final text = normalize(body);
    if (_otp.hasMatch(text)) {
      return ParsedMfsResult(success: false, provider: 'UNKNOWN', rawText: '', error: 'OTP ignored');
    }
    final m = _amount.firstMatch(text);
    final raw = m == null ? null : (m.group(1) ?? m.group(2));
    final amount = raw == null ? null : double.tryParse(raw.replaceAll(RegExp(r'[^\d]'), ''));
    final isCredit = _credit.hasMatch(text) && !(_debit.hasMatch(text) && text.indexOf(_debit) < text.indexOf(_credit));
    if (amount == null || amount <= 0 || !isCredit) {
      return ParsedMfsResult(success: false, provider: 'UNKNOWN', rawText: body, error: 'Not a deposit SMS');
    }
    var provider = 'bank';
    _banks.forEach((k, v) { if (provider == 'bank' && text.contains(k)) provider = v; });
    final bal = _balance.firstMatch(text)?.group(1);
    // Local id only (server derives the authoritative one): body hash keeps duplicates out of the queue.
    final trx = 'IR${text.hashCode.toUnsigned(32).toRadixString(16).toUpperCase()}';
    return ParsedMfsResult(
      success: true,
      provider: provider,
      trxId: trx,
      amount: amount,
      sender: sender,
      balance: bal == null ? null : double.tryParse(bal.replaceAll(',', '')),
      rawText: body,
    );
  }
}

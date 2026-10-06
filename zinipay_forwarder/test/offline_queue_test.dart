import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:payflow_agent/core/storage/local_vault.dart';
import 'package:payflow_agent/core/security/security_utils.dart';
import 'package:payflow_agent/features/sms/models/sms_transaction.dart';
import 'package:payflow_agent/services/offline_queue_service.dart';

void main() {
  group('Offline Queue & Duplicate Prevention Test Suite', () {
    late LocalVault vault;
    late OfflineQueueService queueService;

    setUp(() async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      vault = LocalVault(prefs);
      queueService = OfflineQueueService(vault: vault);
    });

    test('Enqueues new transaction successfully', () async {
      final fp = SecurityUtils.generateFingerprint('bKash', 'BK99018A', 1500.0);
      final trx = SmsTransaction(
        id: 'trx_1',
        provider: 'bKash',
        trxId: 'BK99018A',
        amount: 1500.0,
        sender: '01711223344',
        rawSms: 'You have received Tk 1,500.00 from 01711223344. TrxID BK99018A',
        receivedAt: DateTime.now(),
        fingerprint: fp,
      );

      final accepted = await queueService.enqueue(trx);
      expect(accepted, isTrue);

      final queue = queueService.getQueue();
      expect(queue.length, equals(1));
      expect(queue.first.trxId, equals('BK99018A'));
    });

    test('Blocks duplicate transaction with identical fingerprint', () async {
      final fp = SecurityUtils.generateFingerprint('Nagad', 'NG77192A', 500.0);
      final trx = SmsTransaction(
        id: 'trx_2',
        provider: 'Nagad',
        trxId: 'NG77192A',
        amount: 500.0,
        sender: '01811223344',
        rawSms: 'Received Amount: Tk 500.00 from 01811223344. TxnID: NG77192A',
        receivedAt: DateTime.now(),
        fingerprint: fp,
      );

      final firstAttempt = await queueService.enqueue(trx);
      expect(firstAttempt, isTrue);

      // Replay attempt should be blocked on client side
      final secondAttempt = await queueService.enqueue(trx);
      expect(secondAttempt, isFalse);

      final queue = queueService.getQueue();
      expect(queue.length, equals(1));
    });

    test('SecurityUtils phone and token masking integrity', () {
      expect(SecurityUtils.maskPhoneNumber('01712345678'), equals('017*****678'));
      expect(SecurityUtils.maskPhoneNumber('+8801812345678'), equals('018*****678'));

      const token = 'token_phone_primary';
      final maskedToken = SecurityUtils.maskToken(token);
      expect(maskedToken.startsWith('tok'), isTrue);
      expect(maskedToken.endsWith('mary'), isTrue);
      expect(maskedToken.contains('••••••••'), isTrue);
    });
  });
}

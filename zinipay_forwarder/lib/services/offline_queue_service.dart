import 'dart:async';
import '../core/config/app_config.dart';
import '../core/network/api_client.dart';
import '../core/storage/local_vault.dart';
import '../features/sms/models/sms_transaction.dart';

typedef QueueStateCallback = void Function(List<SmsTransaction> queue, List<SmsTransaction> history);

class OfflineQueueService {
  final LocalVault _vault;
  final ApiClient _apiClient;
  bool _isSyncing = false;
  Timer? _retryTimer;
  QueueStateCallback? onStateChanged;

  final Set<String> _processedFingerprints = {};

  OfflineQueueService({
    required LocalVault vault,
    ApiClient? apiClient,
  })  : _vault = vault,
        _apiClient = apiClient ?? ApiClient() {
    // Populate seen fingerprints from existing history to prevent duplicates
    for (final item in _vault.getTransactionHistory()) {
      final fp = item['fingerprint'] as String?;
      if (fp != null && fp.isNotEmpty) {
        _processedFingerprints.add(fp);
      }
    }
  }

  bool get isSyncing => _isSyncing;

  List<SmsTransaction> getQueue() {
    return _vault.getOfflineQueue().map((e) => SmsTransaction.fromJson(e)).toList();
  }

  List<SmsTransaction> getHistory() {
    return _vault.getTransactionHistory().map((e) => SmsTransaction.fromJson(e)).toList();
  }

  /// Adds a parsed transaction into queue with client-side deduplication
  Future<bool> enqueue(SmsTransaction transaction) async {
    // Duplicate Protection check
    if (_processedFingerprints.contains(transaction.fingerprint)) {
      await _vault.addLog(
        'Duplicate SMS Filtered',
        'Duplicate TrxID ${transaction.trxId} (${transaction.provider}) blocked by client fingerprint',
      );
      return false;
    }

    final queue = getQueue();
    // Also check if already pending in queue
    final alreadyQueued = queue.any((t) => t.fingerprint == transaction.fingerprint);
    if (alreadyQueued) {
      return false;
    }

    queue.add(transaction.copyWith(status: SmsStatus.processing));
    await _vault.saveOfflineQueue(queue.map((e) => e.toJson()).toList());
    await _vault.addLog(
      'SMS Queued',
      'Captured ${transaction.provider} ${transaction.trxId} (৳${transaction.amount}) for ingestion',
    );

    _notifyState();

    if (_vault.autoSync) {
      // Trigger instant processing
      unawaited(processQueue());
    }

    return true;
  }

  /// Convenience method to enqueue raw SMS or app notification with metadata
  Future<bool> enqueueSms({
    required String rawSms,
    required String sender,
    int? simSlot,
    String? carrier,
    String? source,
  }) async {
    final cleanTrx = 'RAW_${DateTime.now().millisecondsSinceEpoch}';
    final trx = SmsTransaction(
      id: 'sms_${DateTime.now().millisecondsSinceEpoch}',
      provider: sender,
      trxId: cleanTrx,
      amount: 0.0,
      sender: sender,
      rawSms: rawSms,
      receivedAt: DateTime.now(),
      status: SmsStatus.received,
      fingerprint: '${sender}_${DateTime.now().millisecondsSinceEpoch}',
      simSlot: simSlot,
      carrier: carrier,
      source: source ?? 'SMS',
    );
    return enqueue(trx);
  }

  /// Attempts to upload all pending transactions in queue
  Future<void> processQueue() async {
    if (_isSyncing) return;
    _isSyncing = true;
    _notifyState();

    try {
      final queue = getQueue();
      if (queue.isEmpty) {
        _isSyncing = false;
        _notifyState();
        return;
      }

      final remainingQueue = <SmsTransaction>[];
      final history = getHistory();

      for (var item in queue) {
        final res = await _apiClient.ingestSms(
          backendUrl: _vault.backendUrl,
          deviceToken: _vault.deviceToken,
          deviceId: _vault.deviceId,
          sms: item.rawSms,
          sender: item.sender,
          receivedAt: item.receivedAt,
          simSlot: item.simSlot,
          carrier: item.carrier,
          source: item.source,
        );

        if (res.success) {
          // Success (either 201 Created or 200 Duplicate blocked)
          final status = (res.matchedInvoiceId != null && res.matchedInvoiceId!.isNotEmpty)
              ? SmsStatus.matched
              : SmsStatus.processed;

          final completed = item.copyWith(
            status: status,
            invoiceId: res.matchedInvoiceId,
            lastError: res.isDuplicate ? 'Duplicate ledger confirmation' : null,
          );

          _processedFingerprints.add(item.fingerprint);
          history.insert(0, completed);
          await _vault.addLog(
            'Uploaded Successfully',
            '${item.provider} ${item.trxId} (৳${item.amount}) -> Server confirmed (${status.name})',
          );
        } else {
          // Failed
          final nextRetry = item.retryCount + 1;
          if (nextRetry >= AppConfig.maxRetryAttempts) {
            // Permanent failure
            final failedItem = item.copyWith(
              status: SmsStatus.failed,
              retryCount: nextRetry,
              lastError: res.errorMessage ?? 'Max retries exceeded',
            );
            history.insert(0, failedItem);
            await _vault.addLog(
              'Ingestion Failed Permanently',
              '${item.provider} ${item.trxId} failed after $nextRetry attempts: ${res.errorMessage}',
            );
          } else {
            // Re-queue with incremented retry
            final retryingItem = item.copyWith(
              status: SmsStatus.retrying,
              retryCount: nextRetry,
              lastError: res.errorMessage,
            );
            remainingQueue.add(retryingItem);
            await _vault.addLog(
              'Ingestion Failed (Retry Scheduled)',
              '${item.provider} ${item.trxId}: ${res.errorMessage} (Attempt $nextRetry)',
            );
          }
        }
      }

      await _vault.saveOfflineQueue(remainingQueue.map((e) => e.toJson()).toList());
      await _vault.saveTransactionHistory(history.map((e) => e.toJson()).toList());

      // If items remain in queue, schedule next exponential backoff retry
      if (remainingQueue.isNotEmpty) {
        _scheduleRetry(remainingQueue.first.retryCount);
      }
    } finally {
      _isSyncing = false;
      _notifyState();
    }
  }

  void _scheduleRetry(int retryCount) {
    _retryTimer?.cancel();
    final index = (retryCount - 1).clamp(0, AppConfig.retryIntervalsSeconds.length - 1);
    final delaySeconds = AppConfig.retryIntervalsSeconds[index];

    _retryTimer = Timer(Duration(seconds: delaySeconds), () {
      processQueue();
    });
  }

  void _notifyState() {
    onStateChanged?.call(getQueue(), getHistory());
  }

  void dispose() {
    _retryTimer?.cancel();
  }
}

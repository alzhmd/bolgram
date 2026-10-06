import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/security/security_utils.dart';
import '../models/sms_transaction.dart';

class SmsDetailDialog extends StatelessWidget {
  final SmsTransaction transaction;

  const SmsDetailDialog({super.key, required this.transaction});

  Color _getProviderColor(String provider) {
    switch (provider.toLowerCase()) {
      case 'bkash':
        return const Color(0xFFE2136E);
      case 'nagad':
        return const Color(0xFFF7941D);
      case 'rocket':
        return const Color(0xFF8C3494);
      case 'upay':
        return const Color(0xFF00A3E0);
      default:
        return const Color(0xFF6366F1);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dateFormat = DateFormat('hh:mm:ss a, dd MMM yyyy');
    final providerColor = _getProviderColor(transaction.provider);

    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      backgroundColor: Theme.of(context).cardColor,
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: providerColor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: providerColor.withValues(alpha: 0.4)),
                  ),
                  child: Text(
                    transaction.provider,
                    style: TextStyle(
                      color: providerColor,
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.white10,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    transaction.status.name.toUpperCase(),
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                      letterSpacing: 0.8,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text(
              '৳ ${transaction.amount.toStringAsFixed(2)}',
              style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 16),
            const Divider(color: Colors.white12),
            const SizedBox(height: 12),

            _DetailRow(label: 'Transaction ID', value: transaction.trxId),
            _DetailRow(
              label: 'Sender',
              value: transaction.sender.isNotEmpty
                  ? SecurityUtils.maskPhoneNumber(transaction.sender)
                  : 'System Broadcast',
            ),
            _DetailRow(
              label: 'Received',
              value: dateFormat.format(transaction.receivedAt),
            ),
            _DetailRow(
              label: 'Server Status',
              value: transaction.status == SmsStatus.matched
                  ? 'MATCHED (PAID)'
                  : transaction.status == SmsStatus.processed
                      ? 'COMPLETED'
                      : transaction.status.name.toUpperCase(),
            ),
            if (transaction.invoiceId != null && transaction.invoiceId!.isNotEmpty)
              _DetailRow(label: 'Invoice', value: transaction.invoiceId!),
            if (transaction.lastError != null)
              _DetailRow(
                label: 'Note/Error',
                value: transaction.lastError!,
                valueColor: Colors.amber,
              ),

            const SizedBox(height: 12),
            const Text(
              'Raw SMS (Sanitized)',
              style: TextStyle(fontSize: 12, color: Colors.grey, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 6),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.black26,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.white10),
              ),
              child: Text(
                SecurityUtils.sanitizeRawSms(transaction.rawSms),
                style: const TextStyle(
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color: Colors.white70,
                ),
              ),
            ),

            const SizedBox(height: 20),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Close'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;

  const _DetailRow({
    required this.label,
    required this.value,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: const TextStyle(color: Colors.grey, fontSize: 13),
          ),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 13,
                color: valueColor,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

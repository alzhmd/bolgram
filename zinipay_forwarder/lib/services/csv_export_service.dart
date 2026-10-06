import 'dart:io';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../features/sms/models/sms_transaction.dart';

class CsvExportService {
  static final _fmt = NumberFormat('#,##0.00');
  static final _dateFmt = DateFormat('dd/MM/yyyy HH:mm:ss');

  /// Export transaction list to CSV and trigger system share sheet
  static Future<void> exportAndShare(List<SmsTransaction> transactions) async {
    final csv = _buildCsv(transactions);
    final dir = await getTemporaryDirectory();
    final timestamp = DateFormat('yyyyMMdd_HHmmss').format(DateTime.now());
    final file = File('${dir.path}/syncpay_log_$timestamp.csv');
    await file.writeAsString(csv, encoding: const SystemEncoding());

    await Share.shareXFiles(
      [XFile(file.path, mimeType: 'text/csv')],
      subject: 'SyncPay BD SMS Log — $timestamp',
    );
  }

  static String _buildCsv(List<SmsTransaction> txs) {
    final buf = StringBuffer();
    // Header
    buf.writeln('Date,Time,Provider,TrxID,Amount (BDT),Sender,Status,Raw SMS');

    for (final t in txs) {
      final date = _dateFmt.format(t.receivedAt);
      final parts = date.split(' ');
      final d = parts[0];
      final time = parts.length > 1 ? parts[1] : '';
      final amount = _fmt.format(t.amount);
      final status = t.status.name.toUpperCase();
      final raw = t.rawSms.replaceAll('"', '""'); // escape quotes

      buf.writeln('"$d","$time","${t.provider}","${t.trxId}","$amount","${t.sender}","$status","$raw"');
    }
    return buf.toString();
  }

  /// Return CSV string (for preview or custom handling)
  static String generateCsv(List<SmsTransaction> transactions) => _buildCsv(transactions);
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../../core/localization/app_localizations.dart';
import '../../dashboard/providers/agent_provider.dart';
import '../../sms/models/sms_transaction.dart';
import '../../sms/services/mfs_sms_parser.dart';
import '../../../services/csv_export_service.dart';

class ActivityLogsScreen extends ConsumerStatefulWidget {
  const ActivityLogsScreen({super.key});

  @override
  ConsumerState<ActivityLogsScreen> createState() => _ActivityLogsScreenState();
}

class _ActivityLogsScreenState extends ConsumerState<ActivityLogsScreen> {
  String _selectedProvider = 'All';
  String _selectedStatus   = 'All';
  String _searchQuery      = '';
  final _searchCtrl        = TextEditingController();

  static const _providers = ['All', 'bKash', 'Nagad', 'Rocket', 'Upay', 'DBBL', 'BRAC', 'IslamiBank', 'CityBank'];
  static const _statuses  = ['All', 'received', 'forwarded', 'failed', 'rejected'];

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  List<SmsTransaction> _filtered(List<SmsTransaction> all) {
    return all.where((t) {
      final providerOk = _selectedProvider == 'All' || t.provider == _selectedProvider;
      final statusOk   = _selectedStatus   == 'All' || t.status.name == _selectedStatus;
      final q = _searchQuery.toLowerCase();
      final searchOk = q.isEmpty ||
          t.trxId.toLowerCase().contains(q) ||
          t.sender.toLowerCase().contains(q) ||
          t.provider.toLowerCase().contains(q);
      return providerOk && statusOk && searchOk;
    }).toList()
      ..sort((a, b) => b.receivedAt.compareTo(a.receivedAt));
  }

  @override
  Widget build(BuildContext context) {
    final agentState = ref.watch(agentProvider);
    final loc        = AppLocalizations(agentState.language);
    final history    = agentState.transactionHistory;
    final queue      = agentState.offlineQueue;
    final all        = [...history, ...queue];
    final filtered   = _filtered(all);
    final currency   = NumberFormat('#,##0.00');

    return Scaffold(
      appBar: AppBar(
        title: Text(loc.tr('activity')),
        actions: [
          if (all.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.download),
              tooltip: 'Export CSV',
              onPressed: () => CsvExportService.exportAndShare(all),
            ),
        ],
      ),
      body: Column(
        children: [
          // ── Search bar ──────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
            child: TextField(
              controller: _searchCtrl,
              onChanged: (v) => setState(() => _searchQuery = v),
              decoration: InputDecoration(
                hintText: 'TrxID বা sender খুঁজুন...',
                prefixIcon: const Icon(Icons.search, size: 20),
                suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear, size: 18),
                        onPressed: () { _searchCtrl.clear(); setState(() => _searchQuery = ''); },
                      )
                    : null,
                contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),
          // ── Filter chips ────────────────────────────────────────────────
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              children: [
                ..._providers.map((p) => _FilterChip(
                  label: p,
                  selected: _selectedProvider == p,
                  color: p == 'All' ? Colors.grey : Color(ParsedMfsResult.colorFor(p)),
                  onTap: () => setState(() => _selectedProvider = p),
                )),
                const SizedBox(width: 4),
                const VerticalDivider(width: 1),
                const SizedBox(width: 4),
                ..._statuses.skip(1).map((s) => _FilterChip(
                  label: s,
                  selected: _selectedStatus == s,
                  color: _statusColor(s),
                  onTap: () => setState(() => _selectedStatus = s),
                )),
              ],
            ),
          ),
          // ── Summary bar ──────────────────────────────────────────────────
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surface,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: Theme.of(context).dividerColor),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${filtered.length} টি রেকর্ড', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                Text(
                  '৳ ${currency.format(filtered.fold(0.0, (s, t) => s + t.amount))}',
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: Color(0xFF6366F1)),
                ),
              ],
            ),
          ),
          // ── List ─────────────────────────────────────────────────────────
          Expanded(
            child: filtered.isEmpty
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.inbox_outlined, size: 54, color: Colors.grey),
                        const SizedBox(height: 12),
                        Text('কোনো রেকর্ড পাওয়া যায়নি', style: TextStyle(color: Colors.grey.shade500)),
                      ],
                    ),
                  )
                : ListView.separated(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    itemCount: filtered.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 6),
                    itemBuilder: (ctx, i) => _TrxCard(trx: filtered[i]),
                  ),
          ),
        ],
      ),
    );
  }

  Color _statusColor(String s) {
    switch (s) {
      case 'forwarded': return const Color(0xFF10B981);
      case 'failed':    return const Color(0xFFEF4444);
      case 'rejected':  return const Color(0xFFF59E0B);
      default:          return const Color(0xFF38BDF8);
    }
  }
}

// ── Filter chip widget ────────────────────────────────────────────────────────
class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final Color color;
  final VoidCallback onTap;
  const _FilterChip({required this.label, required this.selected, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          decoration: BoxDecoration(
            color: selected ? color.withValues(alpha: 0.15) : Colors.transparent,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: selected ? color : Colors.grey.shade300),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: selected ? FontWeight.bold : FontWeight.normal,
              color: selected ? color : Colors.grey,
            ),
          ),
        ),
      ),
    );
  }
}

// ── Transaction card widget ───────────────────────────────────────────────────
class _TrxCard extends StatelessWidget {
  final SmsTransaction trx;
  const _TrxCard({required this.trx});

  @override
  Widget build(BuildContext context) {
    final currency = NumberFormat('#,##0.00');
    final time     = DateFormat('dd MMM, hh:mm a').format(trx.receivedAt);
    final color    = Color(ParsedMfsResult.colorFor(trx.provider));

    return GestureDetector(
      onTap: () => _showDetail(context),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Theme.of(context).cardColor,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: Theme.of(context).dividerColor),
          boxShadow: [
            BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 4, offset: const Offset(0, 2)),
          ],
        ),
        child: Row(
          children: [
            // Provider badge
            Container(
              width: 42, height: 42,
              decoration: BoxDecoration(color: color.withValues(alpha: 0.12), shape: BoxShape.circle),
              child: Center(
                child: Text(trx.provider[0], style: TextStyle(color: color, fontWeight: FontWeight.w900, fontSize: 16)),
              ),
            ),
            const SizedBox(width: 12),
            // Info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(trx.provider, style: TextStyle(fontWeight: FontWeight.bold, color: color, fontSize: 13)),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: _statusColor(trx.status).withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          trx.status.name.toUpperCase(),
                          style: TextStyle(fontSize: 9, color: _statusColor(trx.status), fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(trx.trxId, style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Colors.grey)),
                  Text(trx.sender, style: const TextStyle(fontSize: 11, color: Colors.grey)),
                ],
              ),
            ),
            // Amount + time
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('৳${currency.format(trx.amount)}',
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
                const SizedBox(height: 4),
                Text(time, style: const TextStyle(fontSize: 10, color: Colors.grey)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Color _statusColor(SmsStatus s) {
    switch (s) {
      case SmsStatus.forwarded: return const Color(0xFF10B981);
      case SmsStatus.failed:    return const Color(0xFFEF4444);
      case SmsStatus.rejected:  return const Color(0xFFF59E0B);
      default:                  return const Color(0xFF38BDF8);
    }
  }

  void _showDetail(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        maxChildSize: 0.95,
        minChildSize: 0.4,
        expand: false,
        builder: (_, ctrl) => _DetailSheet(trx: trx, ctrl: ctrl),
      ),
    );
  }
}

class _DetailSheet extends StatelessWidget {
  final SmsTransaction trx;
  final ScrollController ctrl;
  const _DetailSheet({required this.trx, required this.ctrl});

  @override
  Widget build(BuildContext context) {
    final color = Color(ParsedMfsResult.colorFor(trx.provider));
    return ListView(
      controller: ctrl,
      padding: const EdgeInsets.all(20),
      children: [
        Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.grey.shade300, borderRadius: BorderRadius.circular(2)))),
        const SizedBox(height: 16),
        Row(
          children: [
            Container(width: 48, height: 48, decoration: BoxDecoration(color: color.withValues(alpha: 0.15), shape: BoxShape.circle),
              child: Center(child: Text(trx.provider[0], style: TextStyle(color: color, fontWeight: FontWeight.w900, fontSize: 20)))),
            const SizedBox(width: 12),
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(trx.provider, style: TextStyle(fontWeight: FontWeight.bold, color: color, fontSize: 16)),
              Text(DateFormat('dd MMM yyyy, hh:mm:ss a').format(trx.receivedAt),
                  style: const TextStyle(fontSize: 12, color: Colors.grey)),
            ]),
          ],
        ),
        const SizedBox(height: 20),
        _buildRow('TrxID',   trx.trxId,  mono: true),
        _buildRow('Amount',  '৳${NumberFormat('#,##0.00').format(trx.amount)}'),
        _buildRow('Sender',  trx.sender),
        _buildRow('Status',  trx.status.name.toUpperCase()),
        const Divider(height: 24),
        const Text('Raw SMS', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
        const SizedBox(height: 6),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: Colors.grey.shade100, borderRadius: BorderRadius.circular(8)),
          child: SelectableText(trx.rawSms, style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
        ),
      ],
    );
  }

  Widget _buildRow(String label, String value, {bool mono = false}) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 13)),
        Text(value, style: TextStyle(fontWeight: FontWeight.w600, fontFamily: mono ? 'monospace' : null, fontSize: 13)),
      ],
    ),
  );
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../../core/localization/app_localizations.dart';
import '../models/sms_transaction.dart';
import '../../dashboard/providers/agent_provider.dart';
import 'sms_detail_dialog.dart';

class SmsActivityScreen extends ConsumerStatefulWidget {
  const SmsActivityScreen({super.key});

  @override
  ConsumerState<SmsActivityScreen> createState() => _SmsActivityScreenState();
}

class _SmsActivityScreenState extends ConsumerState<SmsActivityScreen> {
  String _selectedProvider = 'All';

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

  Color _getStatusColor(SmsStatus status) {
    switch (status) {
      case SmsStatus.forwarded:
      case SmsStatus.matched:
      case SmsStatus.processed:
        return const Color(0xFF10B981);
      case SmsStatus.processing:
      case SmsStatus.retrying:
        return const Color(0xFFF59E0B);
      case SmsStatus.failed:
      case SmsStatus.rejected:
        return const Color(0xFFEF4444);
      case SmsStatus.received:
        return const Color(0xFF38BDF8);
    }
  }

  @override
  Widget build(BuildContext context) {
    final agentState = ref.watch(agentProvider);
    final loc = AppLocalizations(agentState.language);
    final timeFormat = DateFormat('hh:mm a');

    // Combine queue and history
    final allList = [...agentState.offlineQueue, ...agentState.transactionHistory];
    final filtered = _selectedProvider == 'All'
        ? allList
        : allList.where((t) => t.provider.toLowerCase() == _selectedProvider.toLowerCase()).toList();

    return Scaffold(
      appBar: AppBar(
        title: Text(loc.tr('sms_activity')),
        centerTitle: false,
        actions: [
          IconButton(
            icon: const Icon(Icons.sync),
            tooltip: loc.tr('sync_now'),
            onPressed: () => ref.read(agentProvider.notifier).syncNow(),
          ),
        ],
      ),
      body: Column(
        children: [
          // Filter Chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: ['All', 'bKash', 'Nagad', 'Rocket', 'Upay'].map((prov) {
                final isSelected = _selectedProvider == prov;
                return Padding(
                  padding: const EdgeInsets.only(right: 8.0),
                  child: FilterChip(
                    label: Text(prov),
                    selected: isSelected,
                    onSelected: (_) => setState(() => _selectedProvider = prov),
                    selectedColor: const Color(0xFF6366F1).withValues(alpha: 0.2),
                    checkmarkColor: const Color(0xFF6366F1),
                  ),
                );
              }).toList(),
            ),
          ),

          // List or Empty state
          Expanded(
            child: filtered.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(32.0),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.sms_outlined, size: 64, color: Colors.grey.shade600),
                          const SizedBox(height: 16),
                          Text(
                            loc.tr('no_sms_title'),
                            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            loc.tr('no_sms_desc'),
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Colors.grey.shade400, fontSize: 13),
                          ),
                        ],
                      ),
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: filtered.length,
                    itemBuilder: (context, index) {
                      final item = filtered[index];
                      final provColor = _getProviderColor(item.provider);
                      final statusColor = _getStatusColor(item.status);

                      return Container(
                        margin: const EdgeInsets.only(bottom: 12),
                        decoration: BoxDecoration(
                          color: Theme.of(context).cardColor,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: Colors.white12),
                        ),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(12),
                          onTap: () {
                            showDialog(
                              context: context,
                              builder: (_) => SmsDetailDialog(transaction: item),
                            );
                          },
                          child: Padding(
                            padding: const EdgeInsets.all(16.0),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Row(
                                      children: [
                                        Container(
                                          width: 10,
                                          height: 10,
                                          decoration: BoxDecoration(
                                            color: provColor,
                                            shape: BoxShape.circle,
                                          ),
                                        ),
                                        const SizedBox(width: 8),
                                        Text(
                                          item.provider,
                                          style: TextStyle(
                                            color: provColor,
                                            fontWeight: FontWeight.bold,
                                            fontSize: 15,
                                          ),
                                        ),
                                      ],
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                      decoration: BoxDecoration(
                                        color: statusColor.withValues(alpha: 0.12),
                                        borderRadius: BorderRadius.circular(4),
                                      ),
                                      child: Text(
                                        item.status.name.toUpperCase(),
                                        style: TextStyle(
                                          color: statusColor,
                                          fontSize: 11,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 10),
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          '৳ ${item.amount.toStringAsFixed(2)}',
                                          style: const TextStyle(
                                            fontSize: 20,
                                            fontWeight: FontWeight.w800,
                                          ),
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          'TrxID: ${item.trxId}',
                                          style: const TextStyle(
                                            fontSize: 12,
                                            color: Colors.grey,
                                            fontFamily: 'monospace',
                                          ),
                                        ),
                                      ],
                                    ),
                                    Text(
                                      timeFormat.format(item.receivedAt),
                                      style: TextStyle(color: Colors.grey.shade400, fontSize: 12),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

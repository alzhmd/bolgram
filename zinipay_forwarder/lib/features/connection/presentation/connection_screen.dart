import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../../core/localization/app_localizations.dart';
import '../../dashboard/providers/agent_provider.dart';
import '../../pairing/pairing_screen.dart';

class ConnectionScreen extends ConsumerWidget {
  const ConnectionScreen({super.key});

  void _confirmDisconnect(BuildContext context, WidgetRef ref, AppLocalizations loc) {
    showDialog(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        title: Text(loc.tr('disconnect_confirm_title')),
        content: Text(loc.tr('disconnect_confirm_desc')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogCtx).pop(),
            child: Text(loc.tr('cancel')),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFEF4444),
              foregroundColor: Colors.white,
            ),
            onPressed: () async {
              Navigator.of(dialogCtx).pop();
              await ref.read(agentProvider.notifier).disconnectDevice();
              if (context.mounted) {
                Navigator.of(context).pushAndRemoveUntil(
                  MaterialPageRoute(builder: (_) => const PairingScreen()),
                  (route) => false,
                );
              }
            },
            child: Text(loc.tr('disconnect')),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final agentState = ref.watch(agentProvider);
    final loc = AppLocalizations(agentState.language);
    final timeFormat = DateFormat('hh:mm a');

    return Scaffold(
      appBar: AppBar(
        title: Text(loc.tr('nav_connection')),
        centerTitle: false,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Connected Merchant Card
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          loc.tr('connected_merchant'),
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: const Color(0xFF10B981).withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Row(
                            children: [
                              Icon(Icons.circle, color: Color(0xFF10B981), size: 8),
                              SizedBox(width: 4),
                              Text(
                                'Active',
                                style: TextStyle(
                                  color: Color(0xFF10B981),
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    _InfoRow(
                      label: loc.tr('business_name'),
                      value: agentState.merchantName.isNotEmpty ? agentState.merchantName : 'Not paired',
                    ),
                    _InfoRow(
                      label: loc.tr('merchant_id'),
                      value: agentState.merchantId.isNotEmpty ? agentState.merchantId : 'Unassigned',
                    ),
                    _InfoRow(label: loc.tr('backend_url'), value: agentState.backendUrl),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Device Information Card (Genuine Phone Hardware & OS Identity)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      loc.tr('device_information'),
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 16),
                    _InfoRow(label: loc.tr('device_id'), value: agentState.deviceId),
                    _InfoRow(
                      label: loc.tr('device_name'),
                      value: agentState.deviceName.isNotEmpty
                          ? agentState.deviceName
                          : 'Hardware Telephony Agent',
                    ),
                    _InfoRow(
                      label: loc.tr('android_version'),
                      value: agentState.androidVersion.isNotEmpty
                          ? agentState.androidVersion
                          : 'Android OS',
                    ),
                    const _InfoRow(label: 'App Version', value: '1.2.0 (Build 3)'),
                    _InfoRow(label: loc.tr('mfs_providers'), value: 'bKash, Nagad, Rocket, Upay'),
                    _InfoRow(
                      label: loc.tr('last_synced'),
                      value: timeFormat.format(agentState.lastSyncedAt),
                    ),
                    _InfoRow(
                      label: 'Status',
                      value: agentState.isOnline ? loc.tr('status_online') : loc.tr('status_offline'),
                      valueColor: agentState.isOnline ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                    ),
                    if (agentState.latencyMs != null)
                      _InfoRow(
                        label: loc.tr('latency'),
                        value: '${agentState.latencyMs}ms',
                        valueColor: const Color(0xFF38BDF8),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),

            // Disconnect Action Button
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFEF4444).withValues(alpha: 0.12),
                foregroundColor: const Color(0xFFEF4444),
                elevation: 0,
                side: const BorderSide(color: Color(0xFFEF4444), width: 1),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              onPressed: () => _confirmDisconnect(context, ref, loc),
              icon: const Icon(Icons.link_off),
              label: Text(loc.tr('disconnect')),
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;

  const _InfoRow({
    required this.label,
    required this.value,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.grey, fontSize: 13)),
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

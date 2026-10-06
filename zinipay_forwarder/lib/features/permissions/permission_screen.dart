import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/localization/app_localizations.dart';
import '../dashboard/presentation/agent_shell.dart';
import '../dashboard/providers/agent_provider.dart';

class PermissionScreen extends ConsumerStatefulWidget {
  const PermissionScreen({super.key});

  @override
  ConsumerState<PermissionScreen> createState() => _PermissionScreenState();
}

class _PermissionScreenState extends ConsumerState<PermissionScreen> {
  bool _smsGranted = false;
  bool _notificationsGranted = false;
  bool _backgroundGranted = false;
  bool _batteryGranted = false;

  bool get _allGranted =>
      _smsGranted && _notificationsGranted && _backgroundGranted && _batteryGranted;

  void _grantAll() {
    setState(() {
      _smsGranted = true;
      _notificationsGranted = true;
      _backgroundGranted = true;
      _batteryGranted = true;
    });

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('All telephony and background permissions granted'),
        backgroundColor: Color(0xFF10B981),
      ),
    );

    Future.delayed(const Duration(milliseconds: 600), () {
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const AgentShell()),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final agentState = ref.watch(agentProvider);
    final loc = AppLocalizations(agentState.language);

    return Scaffold(
      appBar: AppBar(
        title: Text(loc.tr('required_permissions')),
        centerTitle: true,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                loc.tr('required_permissions'),
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              Text(
                loc.tr('permission_desc'),
                style: TextStyle(color: Colors.grey.shade400, fontSize: 14),
              ),
              const SizedBox(height: 24),

              // Device Status Card
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: _allGranted
                      ? const Color(0xFF10B981).withValues(alpha: 0.12)
                      : const Color(0xFFEF4444).withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: _allGranted ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      _allGranted ? Icons.check_circle : Icons.warning,
                      color: _allGranted ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                    ),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Device Status',
                          style: TextStyle(fontSize: 12, color: Colors.grey),
                        ),
                        Text(
                          _allGranted ? 'READY' : loc.tr('status_not_ready'),
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: _allGranted ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              // Permission rows
              _PermissionRow(
                title: loc.tr('sms_access'),
                isGranted: _smsGranted,
                grantedLabel: loc.tr('granted'),
                neededLabel: loc.tr('required'),
                onToggle: (v) => setState(() => _smsGranted = v),
              ),
              _PermissionRow(
                title: loc.tr('notifications'),
                isGranted: _notificationsGranted,
                grantedLabel: loc.tr('granted'),
                neededLabel: loc.tr('required'),
                onToggle: (v) => setState(() => _notificationsGranted = v),
              ),
              _PermissionRow(
                title: loc.tr('background_activity'),
                isGranted: _backgroundGranted,
                grantedLabel: loc.tr('granted'),
                neededLabel: loc.tr('needs_setup'),
                onToggle: (v) => setState(() => _backgroundGranted = v),
              ),
              _PermissionRow(
                title: loc.tr('battery_optimization'),
                isGranted: _batteryGranted,
                grantedLabel: loc.tr('granted'),
                neededLabel: loc.tr('needs_setup'),
                onToggle: (v) => setState(() => _batteryGranted = v),
              ),

              const Spacer(),

              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: _allGranted ? const Color(0xFF10B981) : const Color(0xFF6366F1),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                onPressed: _allGranted
                    ? () {
                        Navigator.of(context).pushReplacement(
                          MaterialPageRoute(builder: (_) => const AgentShell()),
                        );
                      }
                    : _grantAll,
                child: Text(
                  _allGranted ? 'Continue to Dashboard' : loc.tr('grant_permissions'),
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PermissionRow extends StatelessWidget {
  final String title;
  final bool isGranted;
  final String grantedLabel;
  final String neededLabel;
  final ValueChanged<bool> onToggle;

  const _PermissionRow({
    required this.title,
    required this.isGranted,
    required this.grantedLabel,
    required this.neededLabel,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.white12),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
          InkWell(
            onTap: () => onToggle(!isGranted),
            borderRadius: BorderRadius.circular(20),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: isGranted
                    ? const Color(0xFF10B981).withValues(alpha: 0.15)
                    : Colors.amber.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                isGranted ? grantedLabel : neededLabel,
                style: TextStyle(
                  color: isGranted ? const Color(0xFF10B981) : Colors.amber,
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/localization/app_localizations.dart';
import '../../../services/update_service.dart';
import '../../connection/presentation/connection_screen.dart';
import '../../logs/presentation/activity_logs_screen.dart';
import '../../settings/presentation/settings_screen.dart';
import '../../stats/presentation/stats_screen.dart';
import '../providers/agent_provider.dart';
import 'dashboard_screen.dart';

class AgentShell extends ConsumerStatefulWidget {
  const AgentShell({super.key});

  @override
  ConsumerState<AgentShell> createState() => _AgentShellState();
}

class _AgentShellState extends ConsumerState<AgentShell> {
  int _currentIndex = 0;

  @override
  void initState() {
    super.initState();
    // Auto-check for OTA App Updates silently in the background
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        final serverUrl = ref.read(agentProvider).serverUrl;
        UpdateService.checkForUpdates(context, serverUrl: serverUrl);
      }
    });
  }

  final List<Widget> _screens = const [
    DashboardScreen(),
    ActivityLogsScreen(),   // ← upgraded from SmsActivityScreen
    StatsScreen(),          // ← NEW: charts & stats
    ConnectionScreen(),
    SettingsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    final agentState = ref.watch(agentProvider);
    final loc = AppLocalizations(agentState.language);
    final pendingCount = agentState.offlineQueue.length;

    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: _screens,
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (i) => setState(() => _currentIndex = i),
        items: [
          BottomNavigationBarItem(
            icon: const Icon(Icons.dashboard_outlined),
            activeIcon: const Icon(Icons.dashboard),
            label: loc.tr('nav_home'),
          ),
          BottomNavigationBarItem(
            icon: Badge(
              isLabelVisible: pendingCount > 0,
              label: Text('$pendingCount'),
              child: const Icon(Icons.receipt_long_outlined),
            ),
            activeIcon: Badge(
              isLabelVisible: pendingCount > 0,
              label: Text('$pendingCount'),
              child: const Icon(Icons.receipt_long),
            ),
            label: loc.tr('nav_activity'),
          ),
          const BottomNavigationBarItem(
            icon: Icon(Icons.bar_chart_outlined),
            activeIcon: Icon(Icons.bar_chart),
            label: 'পরিসংখ্যান',
          ),
          BottomNavigationBarItem(
            icon: const Icon(Icons.devices_outlined),
            activeIcon: const Icon(Icons.devices),
            label: loc.tr('nav_connection'),
          ),
          BottomNavigationBarItem(
            icon: const Icon(Icons.settings_outlined),
            activeIcon: const Icon(Icons.settings),
            label: loc.tr('nav_settings'),
          ),
        ],
      ),
    );
  }
}

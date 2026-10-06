import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/storage/local_vault.dart';
import 'core/theme/app_theme.dart';
import 'features/dashboard/providers/agent_provider.dart';
import 'features/splash/splash_screen.dart';
import 'services/telephony_channel_service.dart';
import 'services/notification_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await NotificationService.init();
  final vault = await LocalVault.init();

  runApp(
    ProviderScope(
      overrides: [
        localVaultProvider.overrideWithValue(vault),
      ],
      child: const SyncPayForwarderApp(),
    ),
  );
}

class SyncPayForwarderApp extends ConsumerStatefulWidget {
  const SyncPayForwarderApp({super.key});

  @override
  ConsumerState<SyncPayForwarderApp> createState() => _SyncPayForwarderAppState();
}

class _SyncPayForwarderAppState extends ConsumerState<SyncPayForwarderApp> {
  final TelephonyChannelService _telephonyChannel = TelephonyChannelService();

  @override
  void initState() {
    super.initState();
    // 1. Listen for platform SMS events emitted by Android SmsListenerReceiver (Dual-SIM aware)
    _telephonyChannel.startListening((data) {
      final sender = data['sender']?.toString() ?? '';
      final body = data['body']?.toString() ?? '';
      final simSlot = data['sim_slot'] as int?;
      final carrier = data['carrier']?.toString();
      if (body.isNotEmpty) {
        ref.read(agentProvider.notifier).handleIncomingRawSms(
          sender,
          body,
          simSlot: simSlot,
          carrier: carrier,
          source: 'SMS',
        );
      }
    });

    // 2. Listen for real-time bKash/Nagad push notifications
    _telephonyChannel.startListeningNotifications((data) {
      final provider = data['provider']?.toString() ?? 'MFS';
      final title = data['title']?.toString() ?? '';
      final body = data['body']?.toString() ?? '';
      final fullText = title.isNotEmpty ? '$title: $body' : body;
      if (fullText.isNotEmpty) {
        ref.read(agentProvider.notifier).handleIncomingRawSms(
          provider,
          fullText,
          simSlot: 0,
          carrier: 'AppNotification',
          source: 'APP_NOTIFICATION',
        );
      }
    });
  }

  @override
  void dispose() {
    _telephonyChannel.stopListening();
    _telephonyChannel.stopListeningNotifications();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final agentState = ref.watch(agentProvider);

    ThemeMode mode;
    switch (agentState.themeMode) {
      case 'dark':
        mode = ThemeMode.dark;
        break;
      case 'system':
        mode = ThemeMode.system;
        break;
      case 'light':
      default:
        mode = ThemeMode.light;
        break;
    }

    return MaterialApp(
      title: 'SyncPay BD Payment Agent',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: mode,
      home: const SplashScreen(),
    );
  }
}

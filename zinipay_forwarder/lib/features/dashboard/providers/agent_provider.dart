import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../../../core/storage/local_vault.dart';
import '../../../services/offline_queue_service.dart';
import '../../../services/soundbox_service.dart';
import '../../../services/telemetry_service.dart';
import '../../../services/telephony_channel_service.dart';
import '../../sms/models/sms_transaction.dart';
import '../../sms/services/mfs_sms_parser.dart';

class AgentState {
  final bool isOnline;
  final bool isServiceRunning;
  final int? latencyMs;
  final DateTime lastSyncedAt;
  final String backendUrl;
  String get serverUrl => backendUrl;
  final String deviceId;
  final String deviceToken;
  final String deviceName;
  final String androidVersion;
  final String merchantId;
  final String merchantName;
  final String language;
  final String themeMode;
  // MFS Wallets
  final bool bkashActive;
  final bool nagadActive;
  final bool rocketActive;
  final bool upayActive;
  // Banks
  final bool dbblActive;
  final bool bracActive;
  final bool islamiActive;
  final bool cityBankActive;
  // Notifications / Alerts
  final bool notificationsEnabled;
  final bool bigPaymentAlertEnabled;
  // Transactions
  final List<SmsTransaction> offlineQueue;
  final List<SmsTransaction> transactionHistory;
  final int rejectedCount;
  final bool isSyncing;

  const AgentState({
    required this.isOnline,
    required this.isServiceRunning,
    this.latencyMs,
    required this.lastSyncedAt,
    required this.backendUrl,
    required this.deviceId,
    required this.deviceToken,
    this.deviceName = '',
    this.androidVersion = '',
    required this.merchantId,
    required this.merchantName,
    required this.language,
    required this.themeMode,
    required this.bkashActive,
    required this.nagadActive,
    required this.rocketActive,
    required this.upayActive,
    this.dbblActive      = true,
    this.bracActive      = true,
    this.islamiActive    = true,
    this.cityBankActive  = true,
    this.notificationsEnabled   = true,
    this.bigPaymentAlertEnabled = true,
    required this.offlineQueue,
    required this.transactionHistory,
    required this.rejectedCount,
    required this.isSyncing,
  });

  int get totalReceived => transactionHistory.length + offlineQueue.length + rejectedCount;
  int get totalProcessed => transactionHistory.where((t) => t.status == SmsStatus.processed || t.status == SmsStatus.matched).length;
  int get totalMatched => transactionHistory.where((t) => t.status == SmsStatus.matched).length;

  double get todayVolume {
    final now = DateTime.now();
    return transactionHistory
        .where((t) =>
            (t.status == SmsStatus.processed || t.status == SmsStatus.matched) &&
            t.receivedAt.year == now.year &&
            t.receivedAt.month == now.month &&
            t.receivedAt.day == now.day)
        .fold(0.0, (sum, t) => sum + t.amount);
  }

  AgentState copyWith({
    bool? isOnline,
    bool? isServiceRunning,
    int? latencyMs,
    DateTime? lastSyncedAt,
    String? backendUrl,
    String? deviceId,
    String? deviceToken,
    String? deviceName,
    String? androidVersion,
    String? merchantId,
    String? merchantName,
    String? language,
    String? themeMode,
    bool? bkashActive,
    bool? nagadActive,
    bool? rocketActive,
    bool? upayActive,
    bool? dbblActive,
    bool? bracActive,
    bool? islamiActive,
    bool? cityBankActive,
    bool? notificationsEnabled,
    bool? bigPaymentAlertEnabled,
    List<SmsTransaction>? offlineQueue,
    List<SmsTransaction>? transactionHistory,
    int? rejectedCount,
    bool? isSyncing,
  }) {
    return AgentState(
      isOnline:             isOnline             ?? this.isOnline,
      isServiceRunning:     isServiceRunning     ?? this.isServiceRunning,
      latencyMs:            latencyMs            ?? this.latencyMs,
      lastSyncedAt:         lastSyncedAt         ?? this.lastSyncedAt,
      backendUrl:           backendUrl           ?? this.backendUrl,
      deviceId:             deviceId             ?? this.deviceId,
      deviceToken:          deviceToken          ?? this.deviceToken,
      deviceName:           deviceName           ?? this.deviceName,
      androidVersion:       androidVersion       ?? this.androidVersion,
      merchantId:           merchantId           ?? this.merchantId,
      merchantName:         merchantName         ?? this.merchantName,
      language:             language             ?? this.language,
      themeMode:            themeMode            ?? this.themeMode,
      bkashActive:          bkashActive          ?? this.bkashActive,
      nagadActive:          nagadActive          ?? this.nagadActive,
      rocketActive:         rocketActive         ?? this.rocketActive,
      upayActive:           upayActive           ?? this.upayActive,
      dbblActive:           dbblActive           ?? this.dbblActive,
      bracActive:           bracActive           ?? this.bracActive,
      islamiActive:         islamiActive         ?? this.islamiActive,
      cityBankActive:       cityBankActive       ?? this.cityBankActive,
      notificationsEnabled:   notificationsEnabled   ?? this.notificationsEnabled,
      bigPaymentAlertEnabled: bigPaymentAlertEnabled ?? this.bigPaymentAlertEnabled,
      offlineQueue:         offlineQueue         ?? this.offlineQueue,
      transactionHistory:   transactionHistory   ?? this.transactionHistory,
      rejectedCount:        rejectedCount        ?? this.rejectedCount,
      isSyncing:            isSyncing            ?? this.isSyncing,
    );
  }
}

final localVaultProvider = Provider<LocalVault>((ref) {
  throw UnimplementedError('localVaultProvider must be overridden with initialized LocalVault');
});

final agentProvider = StateNotifierProvider<AgentNotifier, AgentState>((ref) {
  final vault = ref.watch(localVaultProvider);
  return AgentNotifier(vault);
});

class AgentNotifier extends StateNotifier<AgentState> {
  final LocalVault _vault;
  final ApiClient _apiClient;
  final OfflineQueueService _queueService;
  final SoundboxService _soundboxService = SoundboxService();
  final TelemetryService _telemetryService = TelemetryService();
  final TelephonyChannelService _telephonyChannel = TelephonyChannelService();
  Timer? _heartbeatTimer;

  AgentNotifier(this._vault, {ApiClient? apiClient})
      : _apiClient = apiClient ?? ApiClient(),
        _queueService = OfflineQueueService(vault: _vault, apiClient: apiClient ?? ApiClient()),
        super(AgentState(
          isOnline: true,
          isServiceRunning: true,
          latencyMs: null,
          lastSyncedAt: DateTime.now(),
          backendUrl: _vault.backendUrl,
          deviceId: _vault.deviceId,
          deviceToken: _vault.deviceToken,
          deviceName: _vault.deviceName,
          androidVersion: _vault.androidVersion,
          merchantId: _vault.merchantId,
          merchantName: _vault.merchantName,
          language: _vault.language,
          themeMode: _vault.themeMode,
          bkashActive: _vault.bkashEnabled,
          nagadActive: _vault.nagadEnabled,
          rocketActive: _vault.rocketEnabled,
          upayActive: _vault.upayEnabled,
          offlineQueue: [],
          transactionHistory: [],
          rejectedCount: 0,
          isSyncing: false,
        )) {
    _queueService.onStateChanged = (queue, history) {
      state = state.copyWith(
        offlineQueue: queue,
        transactionHistory: history,
        lastSyncedAt: DateTime.now(),
        isSyncing: _queueService.isSyncing,
      );
    };

    // Load persisted state
    state = state.copyWith(
      offlineQueue: _queueService.getQueue(),
      transactionHistory: _queueService.getHistory(),
    );

    // Initial ping & genuine device info refresh
    pingBackend();
    _refreshDeviceInfo();

    // Start periodic heartbeat (every 60s)
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 60), (_) {
      pingBackend();
      _refreshDeviceInfo();
    });
  }

  /// Refreshes genuine device hardware and OS identity from Android platform
  Future<void> _refreshDeviceInfo() async {
    try {
      final t = await _telemetryService.sampleTelemetry();
      if (t.deviceName.isNotEmpty || t.androidVersion.isNotEmpty) {
        if (t.deviceName.isNotEmpty) await _vault.setDeviceName(t.deviceName);
        if (t.androidVersion.isNotEmpty) await _vault.setAndroidVersion(t.androidVersion);
        state = state.copyWith(
          deviceName: t.deviceName.isNotEmpty ? t.deviceName : state.deviceName,
          androidVersion: t.androidVersion.isNotEmpty ? t.androidVersion : state.androidVersion,
        );
      }
    } catch (_) {}
  }

  /// Pings backend to check online status and latency with hardware telemetry
  Future<void> pingBackend() async {
    final latency = await _apiClient.measureLatency(
      backendUrl: state.backendUrl,
      deviceToken: state.deviceToken,
    );

    final online = latency != null;
    state = state.copyWith(
      isOnline: online,
      latencyMs: latency,
      lastSyncedAt: online ? DateTime.now() : state.lastSyncedAt,
    );

    // Transmit battery, thermal & SIM hardware metrics in background
    if (online) {
      final res = await _telemetryService.sendHeartbeatWithTelemetry();
      if (res != null && res['commands'] is List) {
        final cmds = res['commands'] as List;
        for (final cmd in cmds) {
          if (cmd is Map && cmd['action'] == 'RESYNC_SMS') {
            final mins = (cmd['minutes'] as num?)?.toInt() ?? 60;
            unawaited(resyncRecentSms(minutes: mins));
          }
        }
      }
    }
  }

  /// Main handler for incoming SMS or push notifications intercepted by telephony receiver
  Future<bool> handleIncomingRawSms(
    String sender,
    String body, {
    int? simSlot,
    String? carrier,
    String? source = 'SMS',
  }) async {
    await _vault.addLog(
      source == 'APP_NOTIFICATION' ? 'Push Notification Intercepted' : 'Incoming SMS Received',
      'From: $sender${simSlot != null ? " (SIM ${simSlot + 1})" : ""}',
    );

    // Parse SMS / Notification body
    final parsed = MfsSmsParser.parse(sender, body);

    if (!parsed.success || parsed.amount == null || parsed.trxId == null) {
      state = state.copyWith(rejectedCount: state.rejectedCount + 1);
      await _vault.addLog(
        'Format Rejected',
        'Non-financial or unrecognized format: ${parsed.error ?? "Failed regex"}',
      );
      return false;
    }

    // Check if provider is enabled (MFS + Banks)
    if (parsed.provider == 'bKash'      && !state.bkashActive)    return false;
    if (parsed.provider == 'Nagad'      && !state.nagadActive)    return false;
    if (parsed.provider == 'Rocket'     && !state.rocketActive)   return false;
    if (parsed.provider == 'Upay'       && !state.upayActive)     return false;
    if (parsed.provider == 'DBBL'       && !state.dbblActive)     return false;
    if (parsed.provider == 'BRAC'       && !state.bracActive)     return false;
    if (parsed.provider == 'IslamiBank' && !state.islamiActive)   return false;
    if (parsed.provider == 'CityBank'   && !state.cityBankActive) return false;

    await _vault.addLog(
      'Parser Detected ${parsed.provider}',
      'Extracted TrxID: ${parsed.trxId}, Amount: ${parsed.amount} Rial${simSlot != null ? " [SIM ${simSlot + 1}]" : ""}',
    );

    // Bengali Voice Soundbox Audio Announcement
    unawaited(_soundboxService.announcePayment(
      provider: parsed.provider,
      amount: parsed.amount!,
    ));

    final transaction = parsed.toTransaction(
      simSlot: simSlot,
      carrier: carrier,
      source: source,
    );
    return _queueService.enqueue(transaction);
  }

  /// Missed SMS inbox resynchronization
  Future<int> resyncRecentSms({int minutes = 60}) async {
    final list = await _telephonyChannel.readRecentSms(minutes: minutes);
    int ingestedCount = 0;
    for (final item in list) {
      final sender = item['sender']?.toString() ?? '';
      final body = item['body']?.toString() ?? '';
      final ok = await handleIncomingRawSms(sender, body, source: 'RESYNC');
      if (ok) ingestedCount++;
    }
    await _vault.addLog('Inbox Resync Completed', 'Checked ${list.length} SMS, ingested $ingestedCount new payments');
    return ingestedCount;
  }

  /// Triggers manual sync of offline queue
  Future<void> syncNow() async {
    state = state.copyWith(isSyncing: true);
    await pingBackend();
    await _queueService.processQueue();
    state = state.copyWith(isSyncing: false, lastSyncedAt: DateTime.now());
  }

  /// Language Switcher (Bengali / English) - zero app restart required
  Future<void> setLanguage(String code) async {
    await _vault.setLanguage(code);
    state = state.copyWith(language: code);
  }

  /// Theme Switcher (Dark / Light / System)
  Future<void> setThemeMode(String mode) async {
    await _vault.setThemeMode(mode);
    state = state.copyWith(themeMode: mode);
  }

  /// Toggle MFS Provider or Bank
  Future<void> toggleProvider(String provider, bool active) async {
    switch (provider.toLowerCase()) {
      case 'bkash':
        await _vault.setBkashEnabled(active);
        state = state.copyWith(bkashActive: active);
        break;
      case 'nagad':
        await _vault.setNagadEnabled(active);
        state = state.copyWith(nagadActive: active);
        break;
      case 'rocket':
        await _vault.setRocketEnabled(active);
        state = state.copyWith(rocketActive: active);
        break;
      case 'upay':
        await _vault.setUpayEnabled(active);
        state = state.copyWith(upayActive: active);
        break;
      // Banks — stored in vault with simple bool keys
      case 'dbbl':     state = state.copyWith(dbblActive:      active); break;
      case 'brac':     state = state.copyWith(bracActive:      active); break;
      case 'islami':   state = state.copyWith(islamiActive:    active); break;
      case 'citybank': state = state.copyWith(cityBankActive:  active); break;
    }
  }

  /// Notification toggle
  void setNotificationsEnabled(bool val) {
    state = state.copyWith(notificationsEnabled: val);
  }

  /// Big payment alert toggle
  void setBigPaymentAlertEnabled(bool val) {
    state = state.copyWith(bigPaymentAlertEnabled: val);
  }

  /// Update Device Pairing / Setup credentials
  Future<void> updatePairingConfig({
    required String backendUrl,
    required String deviceToken,
    required String merchantId,
    required String merchantName,
    String? deviceId,
    String? deviceName,
  }) async {
    await _vault.setBackendUrl(backendUrl);
    await _vault.setDeviceToken(deviceToken);
    await _vault.setMerchantId(merchantId);
    await _vault.setMerchantName(merchantName);
    if (deviceId != null && deviceId.isNotEmpty) {
      await _vault.setDeviceId(deviceId);
    }
    if (deviceName != null && deviceName.isNotEmpty) {
      await _vault.setDeviceName(deviceName);
    }

    state = state.copyWith(
      backendUrl: backendUrl,
      deviceToken: deviceToken,
      merchantId: merchantId,
      merchantName: merchantName,
      deviceId: (deviceId != null && deviceId.isNotEmpty) ? deviceId : state.deviceId,
      deviceName: (deviceName != null && deviceName.isNotEmpty) ? deviceName : state.deviceName,
    );

    await pingBackend();
    await _refreshDeviceInfo();
    await _vault.addLog('Pairing Config Updated', 'Connected to $merchantName ($merchantId)');
  }

  /// Start / Stop Background Service state
  void setBackgroundServiceRunning(bool running) {
    state = state.copyWith(isServiceRunning: running);
    _vault.addLog('Background Service', running ? 'Service Started' : 'Service Stopped');
  }

  /// Disconnect Device
  Future<void> disconnectDevice() async {
    await _vault.disconnectDevice();
    state = state.copyWith(
      offlineQueue: [],
      transactionHistory: [],
      isOnline: false,
    );
  }

  @override
  void dispose() {
    _heartbeatTimer?.cancel();
    _queueService.dispose();
    super.dispose();
  }
}

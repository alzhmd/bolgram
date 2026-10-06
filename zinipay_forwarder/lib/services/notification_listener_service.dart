import '../core/storage/local_vault.dart';
import 'telephony_channel_service.dart';
import 'soundbox_service.dart';
import 'offline_queue_service.dart';

typedef NotificationCallback = void Function(Map<String, dynamic> data);

class NotificationListenerService {
  final TelephonyChannelService _channelService;
  final SoundboxService _soundboxService;
  final OfflineQueueService _queueService;

  NotificationListenerService({
    TelephonyChannelService? channelService,
    SoundboxService? soundboxService,
    OfflineQueueService? queueService,
    LocalVault? vault,
  })  : _channelService = channelService ?? TelephonyChannelService(),
        _soundboxService = soundboxService ?? SoundboxService(),
        _queueService = queueService ??
            (vault != null
                ? OfflineQueueService(vault: vault)
                : throw ArgumentError('NotificationListenerService requires either queueService or vault'));

  Future<bool> isPermissionGranted() async {
    return await _channelService.isNotificationListenerEnabled();
  }

  Future<void> requestPermission() async {
    await _channelService.openNotificationListenerSettings();
  }

  void startListening({NotificationCallback? onNotification}) {
    _channelService.startListeningNotifications((data) async {
      onNotification?.call(data);

      final provider = data['provider']?.toString() ?? 'MFS';
      final body = data['body']?.toString() ?? '';
      final title = data['title']?.toString() ?? '';

      // Ingest into offline queue
      final fullText = '$title: $body';
      await _queueService.enqueueSms(
        rawSms: fullText,
        sender: provider,
        simSlot: 0,
        carrier: 'AppNotification',
        source: 'APP_NOTIFICATION',
      );

      // Attempt soundbox announcement if amount is detectable
      final amountMatch = RegExp(r'(?:Tk|BDT|টাকা)\s*([\d,]+(?:\.\d{2})?)', caseSensitive: false).firstMatch(fullText);
      if (amountMatch != null) {
        final amtStr = amountMatch.group(1)?.replaceAll(',', '') ?? '0';
        final amount = double.tryParse(amtStr) ?? 0.0;
        if (amount > 0) {
          await _soundboxService.announcePayment(provider: provider, amount: amount);
        }
      }
    });
  }

  void stopListening() {
    _channelService.stopListeningNotifications();
  }
}

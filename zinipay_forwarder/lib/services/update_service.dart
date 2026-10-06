import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import '../core/config/app_config.dart';
import 'telephony_channel_service.dart';

class UpdateInfo {
  final String latestVersion;
  final int versionCode;
  final String downloadUrl;
  final bool forceUpdate;
  final String fileSizeFormatted;
  final String changelog;

  UpdateInfo({
    required this.latestVersion,
    required this.versionCode,
    required this.downloadUrl,
    required this.forceUpdate,
    required this.fileSizeFormatted,
    required this.changelog,
  });

  factory UpdateInfo.fromJson(Map<String, dynamic> json) {
    return UpdateInfo(
      latestVersion: json['latest_version'] ?? '1.0.0',
      versionCode: json['version_code'] ?? 1,
      downloadUrl: json['download_url'] ?? '',
      forceUpdate: json['force_update'] ?? false,
      fileSizeFormatted: json['file_size_formatted'] ?? '15 MB',
      changelog: json['changelog_bn'] ?? json['changelog'] ?? 'নতুন আপডেট ও পারফরম্যান্স উন্নতি।',
    );
  }
}

class UpdateService {
  static final TelephonyChannelService _telephony = TelephonyChannelService();
  static bool _isChecking = false;

  /// Check server for latest version
  static Future<void> checkForUpdates(
    BuildContext context, {
    String? serverUrl,
    bool showNoUpdateToast = false,
  }) async {
    if (_isChecking) return;
    _isChecking = true;

    try {
      final base = (serverUrl != null && serverUrl.isNotEmpty)
          ? serverUrl.trim().replaceAll(RegExp(r'/+$'), '')
          : AppConfig.defaultProductionBackendUrl;

      final uri = Uri.parse('$base${AppConfig.appVersionEndpoint}');
      final response = await http.get(uri).timeout(const Duration(seconds: 8));

      if (response.statusCode == 200) {
        final Map<String, dynamic> data = jsonDecode(response.body);
        if (data['success'] == true) {
          final info = UpdateInfo.fromJson(data);

          final isNew = _isVersionNewer(AppConfig.appVersion, info.latestVersion);
          if (isNew) {
            if (!context.mounted) return;
            _showUpdateDialog(context, info);
            return;
          }
        }
      }

      if (showNoUpdateToast && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('আপনার অ্যাপটি আপ-টু-ডেট আছে (v${AppConfig.appVersion})'),
            backgroundColor: Color(0xFF10B981),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (e) {
      debugPrint('Auto-update check failed: $e');
      if (showNoUpdateToast && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('আপডেট সার্ভারের সাথে সংযোগ করা যায়নি: $e'),
            backgroundColor: const Color(0xFFEF4444),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } finally {
      _isChecking = false;
    }
  }

  /// Version comparator: returns true if latest > current
  static bool _isVersionNewer(String current, String latest) {
    try {
      final currentParts = current.split('.').map((e) => int.tryParse(e) ?? 0).toList();
      final latestParts = latest.split('.').map((e) => int.tryParse(e) ?? 0).toList();

      for (int i = 0; i < latestParts.length; i++) {
        final c = i < currentParts.length ? currentParts[i] : 0;
        final l = latestParts[i];
        if (l > c) return true;
        if (l < c) return false;
      }
    } catch (_) {}
    return false;
  }

  /// In-App Update Dialog Prompt
  static void _showUpdateDialog(BuildContext context, UpdateInfo info) {
    showDialog(
      context: context,
      barrierDismissible: !info.forceUpdate,
      builder: (ctx) => PopScope(
        canPop: !info.forceUpdate,
        child: Dialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          backgroundColor: const Color(0xFF1E293B),
          child: Padding(
            padding: const EdgeInsets.all(22),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Header with Badge
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: const Color(0xFF10B981).withValues(alpha: 0.2),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.system_update_rounded,
                        color: Color(0xFF10B981),
                        size: 26,
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: const Color(0xFF0284C7).withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFF0284C7).withValues(alpha: 0.5)),
                      ),
                      child: Text(
                        'v${info.latestVersion} • ${info.fileSizeFormatted}',
                        style: const TextStyle(
                          color: Color(0xFF38BDF8),
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),

                // Title
                const Text(
                  'নতুন আপডেট উপলব্ধ!',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'একটি নতুন সংস্করণ উপলব্ধ হয়েছে। নির্বিঘ্নে SMS ফরোয়ার্ডিং চালু রাখতে আপডেট করুন।',
                  style: TextStyle(
                    color: Colors.grey.shade400,
                    fontSize: 13,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 14),

                // Changelog Box
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0F172A),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFF334155)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'নতুন কী রয়েছে:',
                        style: TextStyle(
                          color: Color(0xFF94A3B8),
                          fontSize: 11.5,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        info.changelog,
                        style: const TextStyle(
                          color: Color(0xFFCBD5E1),
                          fontSize: 12.5,
                          height: 1.5,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),

                // Action Buttons
                Row(
                  children: [
                    if (!info.forceUpdate)
                      Expanded(
                        child: OutlinedButton(
                          style: OutlinedButton.styleFrom(
                            side: const BorderSide(color: Color(0xFF475569)),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                          onPressed: () => Navigator.pop(ctx),
                          child: const Text('পরে করব', style: TextStyle(color: Colors.white70)),
                        ),
                      ),
                    if (!info.forceUpdate) const SizedBox(width: 10),
                    Expanded(
                      flex: 2,
                      child: ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF10B981),
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          elevation: 3,
                        ),
                        onPressed: () {
                          Navigator.pop(ctx);
                          _downloadAndInstallApk(context, info);
                        },
                        icon: const Icon(Icons.download_rounded, size: 18),
                        label: const Text(
                          'আপডেট করুন',
                          style: TextStyle(fontWeight: FontWeight.bold),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// In-App Downloader Dialog with real-time Percentage and Auto-Install trigger
  static void _downloadAndInstallApk(BuildContext context, UpdateInfo info) {
    double progress = 0.0;
    int receivedBytes = 0;
    int totalBytes = 0;
    StateSetter? dialogSetState;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) {
        return PopScope(
          canPop: false,
          child: StatefulBuilder(
            builder: (context, setState) {
              dialogSetState = setState;
              final percent = (progress * 100).clamp(0.0, 100.0);
              final receivedMb = (receivedBytes / (1024 * 1024)).toStringAsFixed(1);
              final totalMb = (totalBytes > 0)
                  ? (totalBytes / (1024 * 1024)).toStringAsFixed(1)
                  : info.fileSizeFormatted;

              return Dialog(
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                backgroundColor: const Color(0xFF1E293B),
                child: Padding(
                  padding: const EdgeInsets.all(22),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: const Color(0xFF0284C7).withValues(alpha: 0.15),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.cloud_download_rounded,
                          color: Color(0xFF38BDF8),
                          size: 32,
                        ),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'অ্যাপ ডাউনলোড হচ্ছে...',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 17,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'ডাউনলোড শেষ হলে সরাসরি ইনস্টলার চালু হবে',
                        style: TextStyle(color: Colors.grey.shade400, fontSize: 12),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 20),

                      // Progress Bar
                      ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: LinearProgressIndicator(
                          value: progress > 0 ? progress : null,
                          minHeight: 10,
                          backgroundColor: const Color(0xFF334155),
                          valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF10B981)),
                        ),
                      ),
                      const SizedBox(height: 12),

                      // Metric Stats
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            '$receivedMb MB / $totalMb',
                            style: TextStyle(
                              color: Colors.grey.shade400,
                              fontSize: 12,
                              fontFamily: 'monospace',
                            ),
                          ),
                          Text(
                            '${percent.toStringAsFixed(1)}%',
                            style: const TextStyle(
                              color: Color(0xFF10B981),
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        );
      },
    );

    // Run Asynchronous Download
    () async {
      try {
        final tempDir = await getTemporaryDirectory();
        final apkPath = '${tempDir.path}/syncpay_agent_v${info.latestVersion}.apk';
        final file = File(apkPath);

        if (await file.exists()) {
          await file.delete();
        }

        final client = http.Client();
        final request = http.Request('GET', Uri.parse(info.downloadUrl));
        final response = await client.send(request);

        totalBytes = response.contentLength ?? 0;
        final sink = file.openWrite();

        await response.stream.listen((chunk) {
          sink.add(chunk);
          receivedBytes += chunk.length;
          if (totalBytes > 0) {
            dialogSetState?.call(() {
              progress = receivedBytes / totalBytes;
            });
          }
        }).asFuture();

        await sink.flush();
        await sink.close();
        client.close();

        // Dismiss progress dialog
        if (context.mounted) {
          Navigator.of(context, rootNavigator: true).pop();
        }

        // Trigger Android Native Package Installer
        final success = await _telephony.installApk(apkPath);
        if (!success && context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('APK ফাইলটি প্রস্তুত: $apkPath'),
              backgroundColor: const Color(0xFFF59E0B),
            ),
          );
        }
      } catch (e) {
        debugPrint('Download error: $e');
        if (context.mounted) {
          Navigator.of(context, rootNavigator: true).pop();
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('ডাউনলোড সম্পন্ন হতে পারেনি: $e'),
              backgroundColor: const Color(0xFFEF4444),
            ),
          );
        }
      }
    }();
  }
}

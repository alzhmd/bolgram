import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/localization/app_localizations.dart';
import '../dashboard/presentation/agent_shell.dart';
import '../dashboard/providers/agent_provider.dart';
import '../permissions/permission_screen.dart';
import 'qr_scanner_screen.dart';

class PairingScreen extends ConsumerStatefulWidget {
  const PairingScreen({super.key});

  @override
  ConsumerState<PairingScreen> createState() => _PairingScreenState();
}

class _PairingScreenState extends ConsumerState<PairingScreen> {
  final _formKey = GlobalKey<FormState>();
  bool _isManual = true;

  late final TextEditingController _merchantIdCtrl;
  late final TextEditingController _businessNameCtrl;
  late final TextEditingController _tokenCtrl;
  late final TextEditingController _backendUrlCtrl;
  late String _deviceId;
  String? _scannedDeviceId;
  String? _scannedDeviceName;

  @override
  void initState() {
    super.initState();
    final vault = ref.read(localVaultProvider);
    _deviceId = vault.deviceId;
    _merchantIdCtrl = TextEditingController(text: vault.merchantId);
    _businessNameCtrl = TextEditingController(text: vault.merchantName);
    _tokenCtrl = TextEditingController(text: vault.deviceToken);

    // If stored URL is empty or a local/emulator address, override with production URL
    final storedUrl = vault.backendUrl;
    final isLocalUrl = storedUrl.isEmpty ||
        storedUrl.contains('10.0.2.2') ||
        storedUrl.contains('localhost') ||
        storedUrl.contains('127.0.0.1');
    _backendUrlCtrl = TextEditingController(
      text: isLocalUrl ? 'https://syncpaybd.site' : storedUrl,
    );
  }

  @override
  void dispose() {
    _merchantIdCtrl.dispose();
    _businessNameCtrl.dispose();
    _tokenCtrl.dispose();
    _backendUrlCtrl.dispose();
    super.dispose();
  }

  /// Opens real camera QR scanner. On success, parses the scanned JSON/token
  /// and auto-fills all pairing fields.
  void _handleQrScan() async {
    final String? scanned = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const QrScannerScreen()),
    );

    if (scanned == null || scanned.isEmpty) return;

    _applyScannedData(scanned);
  }

  void _applyScannedData(String raw) {
    try {
      final json = jsonDecode(raw);
      if (json is Map) {
        if (json['merchant_id'] != null) _merchantIdCtrl.text = json['merchant_id'].toString();
        final name = json['merchant_name'] ?? json['business_name'] ?? json['device_name'];
        _businessNameCtrl.text = (name != null && name.toString().isNotEmpty)
            ? name.toString()
            : 'SyncPay Merchant Store';
        if (json['device_token'] != null) _tokenCtrl.text = json['device_token'].toString();
        if (json['backend_url'] != null) _backendUrlCtrl.text = json['backend_url'].toString();
        if (json['device_id'] != null) _scannedDeviceId = json['device_id'].toString();
        if (json['device_name'] != null) _scannedDeviceName = json['device_name'].toString();

        setState(() => _isManual = true);

        // Auto-connect immediately if required credentials exist
        if (_tokenCtrl.text.isNotEmpty && _merchantIdCtrl.text.isNotEmpty) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('⚡ QR স্ক্যান সফল! অটোমেটিক কানেক্ট হচ্ছে...'),
              backgroundColor: Color(0xFF10B981),
              duration: Duration(seconds: 2),
            ),
          );
          _submitPairing(isQrScan: true);
          return;
        }

        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('✅ QR স্ক্যান সফল! তথ্য পূরণ হয়েছে।'),
            backgroundColor: Color(0xFF10B981),
            duration: Duration(seconds: 2),
          ),
        );
        return;
      }
    } catch (_) {}
    // Plain token (not JSON)
    _tokenCtrl.text = raw.trim();
    setState(() => _isManual = true);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('✅ Token স্ক্যান হয়েছে! বাকি তথ্য পূরণ করুন।'),
        backgroundColor: Color(0xFF6366F1),
        duration: Duration(seconds: 2),
      ),
    );
  }

  Future<void> _submitPairing({bool isQrScan = false}) async {
    if (_formKey.currentState?.validate() ?? false) {
      await ref.read(agentProvider.notifier).updatePairingConfig(
            backendUrl: _backendUrlCtrl.text.trim(),
            deviceToken: _tokenCtrl.text.trim(),
            merchantId: _merchantIdCtrl.text.trim(),
            merchantName: _businessNameCtrl.text.trim(),
            deviceId: _scannedDeviceId,
            deviceName: _scannedDeviceName,
          );

      if (!mounted) return;

      final merchantName = _businessNameCtrl.text.trim();
      final displayName = merchantName.isNotEmpty ? merchantName : 'SyncPay Merchant Store';

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('✅ $displayName এর সাথে কানেক্ট হয়েছে!'),
          backgroundColor: const Color(0xFF10B981),
          duration: const Duration(seconds: 2),
        ),
      );

      // QR scan = already used app before, go direct to AgentShell (Dashboard)
      // Manual entry on first time = go to PermissionScreen
      await Future.delayed(const Duration(milliseconds: 500));
      if (!mounted) return;

      if (isQrScan) {
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const AgentShell()),
          (route) => false,
        );
      } else {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const PermissionScreen()),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final agentState = ref.watch(agentProvider);
    final loc = AppLocalizations(agentState.language);

    return Scaffold(
      appBar: AppBar(
        title: Text(loc.tr('connect_your_device')),
        centerTitle: true,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 12),
                Center(
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: const Color(0xFF6366F1).withValues(alpha: 0.12),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.qr_code_scanner,
                      size: 48,
                      color: Color(0xFF6366F1),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  loc.tr('connect_your_device'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                Text(
                  loc.tr('connect_device_desc'),
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.grey.shade400, fontSize: 14),
                ),
                const SizedBox(height: 24),

                // Device ID Readonly card
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    color: Theme.of(context).cardColor,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: Colors.white12),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        loc.tr('device_id'),
                        style: const TextStyle(color: Colors.grey, fontSize: 13),
                      ),
                      Text(
                        _deviceId,
                        style: const TextStyle(fontWeight: FontWeight.bold, letterSpacing: 1),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),

                // QR Scanner / Token Importer Button
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF6366F1),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  onPressed: _handleQrScan,
                  icon: const Icon(Icons.qr_code_scanner),
                  label: Text(loc.tr('scan_qr_code')),
                ),
                const SizedBox(height: 16),

                OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  onPressed: () {
                    setState(() => _isManual = !_isManual);
                  },
                  child: Text(_isManual ? 'Hide Manual Config' : loc.tr('enter_pairing_code')),
                ),

                if (_isManual) ...[
                  const SizedBox(height: 24),
                  TextFormField(
                    controller: _merchantIdCtrl,
                    decoration: InputDecoration(
                      labelText: loc.tr('merchant_id'),
                      prefixIcon: const Icon(Icons.business),
                      border: const OutlineInputBorder(),
                    ),
                    validator: (v) => (v == null || v.isEmpty) ? 'Required' : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _businessNameCtrl,
                    decoration: InputDecoration(
                      labelText: loc.tr('business_name'),
                      prefixIcon: const Icon(Icons.store),
                      border: const OutlineInputBorder(),
                    ),
                    validator: (v) => (v == null || v.isEmpty) ? 'Required' : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _tokenCtrl,
                    decoration: InputDecoration(
                      labelText: loc.tr('pairing_token'),
                      prefixIcon: const Icon(Icons.vpn_key),
                      border: const OutlineInputBorder(),
                    ),
                    validator: (v) => (v == null || v.isEmpty) ? 'Required' : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _backendUrlCtrl,
                    decoration: InputDecoration(
                      labelText: loc.tr('backend_url'),
                      prefixIcon: const Icon(Icons.link),
                      border: const OutlineInputBorder(),
                    ),
                    validator: (v) => (v == null || v.isEmpty) ? 'Required' : null,
                  ),
                  const SizedBox(height: 24),
                  ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF10B981),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    onPressed: _submitPairing,
                    child: Text(loc.tr('connect_device_btn')),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

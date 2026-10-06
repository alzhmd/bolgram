import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../pairing.dart';
import '../theme.dart';

/// Scans the pairing QR from the panel and pops with the parsed [PairInput].
class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  final _controller = MobileScannerController(detectionSpeed: DetectionSpeed.noDuplicates, formats: const [BarcodeFormat.qrCode]);
  bool _done = false;
  String? _hint;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_done) return;
    for (final b in capture.barcodes) {
      final raw = b.rawValue;
      if (raw == null) continue;
      final input = parsePairInput(raw);
      if (input != null) {
        _done = true;
        Navigator.of(context).pop(input);
        return;
      }
      setState(() => _hint = 'این QR مربوط به بولگرام نیست');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('اسکن QR اتصال')),
      body: Stack(
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
            errorBuilder: (context, error, child) => Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  error.errorCode == MobileScannerErrorCode.permissionDenied
                      ? 'اجازهٔ دوربین داده نشده است. از تنظیمات برنامه دوربین را مجاز کنید یا کد ۸ حرفی را دستی وارد کنید.'
                      : 'دوربین در دسترس نیست. کد ۸ حرفی را دستی وارد کنید.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: BG.muted, height: 1.7),
                ),
              ),
            ),
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: Container(
              width: double.infinity,
              color: BG.bg.withValues(alpha: .85),
              padding: const EdgeInsets.all(18),
              child: Text(_hint ?? 'QR نمایش‌داده‌شده در پنل (دستگاه‌ها ← اتصال گوشی) را داخل کادر بگیرید',
                  textAlign: TextAlign.center, style: TextStyle(color: _hint == null ? BG.fg : BG.amber)),
            ),
          ),
        ],
      ),
    );
  }
}

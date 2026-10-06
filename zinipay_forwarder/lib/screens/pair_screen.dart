import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../native.dart';
import '../pairing.dart';
import '../theme.dart';
import 'scan_screen.dart';

/// Connects the phone to a store: scan the panel's QR or type the 8-character code.
class PairScreen extends StatefulWidget {
  const PairScreen({super.key, required this.onPaired});
  final Future<void> Function() onPaired;

  @override
  State<PairScreen> createState() => _PairScreenState();
}

class _PairScreenState extends State<PairScreen> {
  final _code = TextEditingController();
  final _server = TextEditingController(text: defaultServer);
  bool _busy = false;
  bool _advanced = false;
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    _server.dispose();
    super.dispose();
  }

  Future<void> _scan() async {
    final r = await Navigator.of(context).push<PairInput>(MaterialPageRoute(builder: (_) => const ScanScreen()));
    if (r != null) await _connect(r);
  }

  Future<void> _typed() async {
    final input = parsePairInput(_code.text);
    if (input == null || input.code == null) {
      setState(() => _error = 'کد باید ۸ حرف باشد (حرف انگلیسی و عدد)');
      return;
    }
    final server = normalizeServer(_server.text);
    if (server == null) {
      setState(() {
        _advanced = true;
        _error = 'آدرس سرور معتبر نیست';
      });
      return;
    }
    await _connect(PairInput(server: input.server ?? server, code: input.code));
  }

  Future<void> _connect(PairInput input) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final server = input.server ?? normalizeServer(_server.text) ?? defaultServer;
      if (input.token != null) {
        // legacy QR that already carries a device token
        await Native.saveConfig(server, input.token!, input.name ?? 'گوشی اندروید');
      } else {
        final r = await exchangeCode(server, input.code!);
        await Native.saveConfig(server, r.token, r.deviceName);
      }
      await widget.onPaired();
    } on PairError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } on PlatformException {
      if (mounted) setState(() => _error = 'ذخیرهٔ اتصال انجام نشد؛ دوباره تلاش کنید');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const SizedBox(height: 12),
            const Icon(Icons.qr_code_scanner_rounded, size: 52, color: BG.accent),
            const SizedBox(height: 14),
            const Text('اتصال به پنل', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            const Text(
              'در پنل بولگرام به «دستگاه‌ها» بروید و «اتصال گوشی اندروید» را بزنید. QR را اسکن کنید یا کد ۸ حرفی را همین‌جا وارد کنید.',
              style: TextStyle(color: BG.muted, height: 1.7),
            ),
            const SizedBox(height: 22),
            FilledButton.icon(onPressed: _busy ? null : _scan, icon: const Icon(Icons.qr_code_2_rounded), label: const Text('اسکن QR')),
            const SizedBox(height: 22),
            const Row(children: [
              Expanded(child: Divider(color: BG.border)),
              Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Text('یا کد را وارد کنید', style: TextStyle(color: BG.muted))),
              Expanded(child: Divider(color: BG.border)),
            ]),
            const SizedBox(height: 16),
            TextField(
              controller: _code,
              textDirection: TextDirection.ltr,
              textAlign: TextAlign.center,
              textCapitalization: TextCapitalization.characters,
              autocorrect: false,
              enableSuggestions: false,
              maxLength: 9,
              style: const TextStyle(fontSize: 26, letterSpacing: 6, fontWeight: FontWeight.w700, fontFamily: 'monospace'),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9-]')),
                TextInputFormatter.withFunction((o, n) => n.copyWith(text: n.text.toUpperCase())),
              ],
              decoration: const InputDecoration(hintText: 'ABCD-2345', counterText: ''),
              onSubmitted: (_) => _busy ? null : _typed(),
            ),
            const SizedBox(height: 8),
            if (_error != null)
              Container(
                padding: const EdgeInsets.all(12),
                margin: const EdgeInsets.only(bottom: 8),
                decoration: BoxDecoration(color: BG.red.withValues(alpha: .12), borderRadius: BorderRadius.circular(12)),
                child: Text(_error!, style: const TextStyle(color: BG.red, height: 1.6)),
              ),
            OutlinedButton(
              onPressed: _busy ? null : _typed,
              child: _busy ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.4)) : const Text('اتصال با کد'),
            ),
            const SizedBox(height: 8),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton(onPressed: () => setState(() => _advanced = !_advanced), child: const Text('تنظیمات پیشرفته (آدرس سرور)', style: TextStyle(color: BG.muted))),
            ),
            if (_advanced)
              TextField(
                controller: _server,
                textDirection: TextDirection.ltr,
                keyboardType: TextInputType.url,
                autocorrect: false,
                decoration: const InputDecoration(labelText: 'آدرس سرور', hintText: 'https://bolgram.ir'),
              ),
          ],
        ),
      ),
    );
  }
}

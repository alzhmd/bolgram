import 'package:flutter/material.dart';

import '../native.dart';
import '../theme.dart';

/// Explains and requests the permissions the app needs, one step at a time.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, required this.onDone, required this.onSkip});
  final Future<void> Function() onDone;
  final VoidCallback onSkip;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> with WidgetsBindingObserver {
  Perms _p = const Perms();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    final p = await Native.permissions();
    if (mounted) setState(() => _p = p);
  }

  Future<void> _grant() async {
    setState(() => _busy = true);
    final p = await Native.requestPermissions();
    if (mounted) {
      setState(() {
        _p = p;
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final ready = _p.sms;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const SizedBox(height: 12),
            const Icon(Icons.verified_rounded, size: 56, color: BG.accent),
            const SizedBox(height: 14),
            const Text('به بولگرام خوش آمدید', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            const Text(
              'این اپ پیامک واریز بانک را می‌خواند و به پنل شما می‌فرستد تا فاکتورها خودکار تأیید شوند. فقط پیامک بانک‌ها ارسال می‌شود و پیامک رمز و کد یکبارمصرف هرگز.',
              style: TextStyle(color: BG.muted, height: 1.7),
            ),
            const SizedBox(height: 22),
            _Step(
              icon: Icons.sms_rounded,
              title: 'دریافت و خواندن پیامک',
              text: 'برای شناسایی لحظه‌ای پیامک واریز. پس از ریبوت یا قطعی، پیامک‌های از‌دست‌رفته هم از صندوق پیامک بازیابی می‌شوند.',
              done: _p.sms,
              required: true,
            ),
            _Step(
              icon: Icons.notifications_active_rounded,
              title: 'اعلان‌ها',
              text: 'اندروید برای اجرای دائمی در پس‌زمینه یک اعلان ثابت می‌خواهد و خطای اتصال را هم از همین راه می‌بینید.',
              done: _p.notifications,
            ),
            _Step(
              icon: Icons.battery_charging_full_rounded,
              title: 'بدون محدودیت باتری',
              text: 'بدون آن، اندروید اپ را می‌بندد و پیامک‌ها دیر می‌رسند. در شیائومی، هواوی و سامسونگ «شروع خودکار» را هم روشن کنید.',
              done: _p.battery,
              action: _p.battery ? null : OutlinedButton(onPressed: () => Native.requestBattery(), child: const Text('باز کردن تنظیم باتری')),
            ),
            const SizedBox(height: 18),
            FilledButton(
              onPressed: _busy ? null : (_p.sms ? widget.onDone : _grant),
              child: _busy ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.4)) : Text(ready ? 'ادامه و اتصال به پنل' : 'دادن مجوزها'),
            ),
            if (!_p.sms) ...[
              const SizedBox(height: 10),
              OutlinedButton(onPressed: () => Native.openAppSettings(), child: const Text('اگر پنجرهٔ مجوز باز نشد: تنظیمات برنامه')),
            ],
            const SizedBox(height: 6),
            TextButton(onPressed: widget.onSkip, child: const Text('بعداً', style: TextStyle(color: BG.muted))),
          ],
        ),
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.icon, required this.title, required this.text, required this.done, this.required = false, this.action});
  final IconData icon;
  final String title;
  final String text;
  final bool done;
  final bool required;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(color: (done ? BG.green : BG.brand).withValues(alpha: .15), borderRadius: BorderRadius.circular(12)),
                child: Icon(done ? Icons.check_rounded : icon, color: done ? BG.green : BG.brand),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Flexible(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
                      if (required && !done) ...[const SizedBox(width: 8), const Text('ضروری', style: TextStyle(color: BG.amber, fontSize: 12))],
                    ]),
                    const SizedBox(height: 4),
                    Text(text, style: const TextStyle(color: BG.muted, height: 1.6, fontSize: 13.5)),
                    if (action != null) ...[const SizedBox(height: 10), action!],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

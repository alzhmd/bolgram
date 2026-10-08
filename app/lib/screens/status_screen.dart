import 'dart:async';

import 'package:flutter/material.dart';

import '../native.dart';
import '../theme.dart';

/// Home screen once paired: connection state, queue, warnings and recent forwarded SMS.
class StatusScreen extends StatefulWidget {
  const StatusScreen({super.key, required this.onUnpaired});
  final Future<void> Function() onUnpaired;

  @override
  State<StatusScreen> createState() => _StatusScreenState();
}

enum _Conn { connected, offline, revoked }

class _StatusScreenState extends State<StatusScreen> {
  AppState? _s;
  Perms _p = const Perms();
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _tick();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _tick());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _tick() async {
    final s = await Native.state();
    final p = await Native.permissions();
    if (!mounted) return;
    setState(() {
      _s = s;
      _p = p;
    });
  }

  _Conn _conn(AppState s) {
    if (s.authError) return _Conn.revoked;
    final fresh = DateTime.now().millisecondsSinceEpoch - s.lastHeartbeat < 3 * 60 * 1000;
    return fresh ? _Conn.connected : _Conn.offline;
  }

  Future<void> _unpair() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        backgroundColor: BG.surface,
        title: const Text('قطع اتصال از پنل'),
        content: const Text('پیامک‌های داخل صف ارسال که هنوز نرسیده‌اند حذف می‌شوند و دیگر پیامکی ارسال نخواهد شد. برای وصل دوباره باید کد جدید بگیرید.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('انصراف')),
          TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('قطع اتصال', style: TextStyle(color: BG.red))),
        ],
      ),
    );
    if (ok == true) {
      await Native.clearConfig();
      await widget.onUnpaired();
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _s;
    if (s == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final c = _conn(s);
    final (color, label, icon) = switch (c) {
      _Conn.connected => (BG.green, 'متصل به پنل', Icons.check_circle_rounded),
      _Conn.offline => (BG.amber, 'بدون ارتباط با سرور', Icons.cloud_off_rounded),
      _Conn.revoked => (BG.red, 'اتصال قطع شده', Icons.link_off_rounded),
    };
    final warnings = <Widget>[
      if (!_p.sms) const _Warn('مجوز پیامک داده نشده؛ بدون آن واریزی دریافت نمی‌شود.', 'تنظیمات', Native.openAppSettings),
      if (!_p.battery) const _Warn('بهینه‌سازی باتری روشن است و ممکن است اندروید اپ را ببندد.', 'اصلاح', Native.requestBattery),
      if (!_p.notifications) const _Warn('اعلان‌ها خاموش است؛ اعلان ثابت سرویس باید دیده شود.', 'تنظیمات', Native.openAppSettings),
    ];
    return Scaffold(
      appBar: AppBar(
        title: const Text('بولگرام', style: TextStyle(fontWeight: FontWeight.w800)),
        actions: [IconButton(tooltip: 'قطع اتصال', onPressed: _unpair, icon: const Icon(Icons.link_off_rounded))],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await Native.flushNow();
          await Future<void>.delayed(const Duration(milliseconds: 600));
          await _tick();
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Icon(icon, color: color, size: 30),
                      const SizedBox(width: 12),
                      Expanded(child: Text(label, style: TextStyle(color: color, fontSize: 20, fontWeight: FontWeight.w800))),
                    ]),
                    const SizedBox(height: 12),
                    _kv('دستگاه', s.deviceName.isEmpty ? '—' : s.deviceName),
                    _kv('سرور', s.server, ltr: true),
                    _kv('آخرین ارتباط', agoFa(s.lastHeartbeat)),
                    _kv('آخرین ارسال موفق', agoFa(s.lastOk)),
                    _kv('در صف ارسال', s.pending == 0 ? 'هیچ' : '${faNum(s.pending)} پیامک', warn: s.pending > 0),
                    if (s.lastError != null && (c != _Conn.connected || s.pending > 0))
                      Padding(padding: const EdgeInsets.only(top: 8), child: Text(s.lastError!, style: const TextStyle(color: BG.amber, height: 1.6))),
                    if (c == _Conn.revoked) ...[
                      const SizedBox(height: 12),
                      FilledButton(onPressed: _unpair, child: const Text('اتصال دوباره با کد جدید')),
                    ],
                  ],
                ),
              ),
            ),
            if (warnings.isNotEmpty) ...[const SizedBox(height: 12), ...warnings],
            const SizedBox(height: 18),
            const Text('پیامک‌های اخیر', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            const Text('فقط فرستنده و نتیجه نمایش داده می‌شود؛ متن پیامک روی گوشی ذخیره نمی‌ماند.', style: TextStyle(color: BG.muted, fontSize: 12.5)),
            const SizedBox(height: 10),
            if (s.history.isEmpty)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(20),
                  child: Text('هنوز پیامک بانکی ارسال نشده. با رسیدن اولین واریز، اینجا دیده می‌شود. پیامک‌های رمز و کد یکبارمصرف هرگز ارسال نمی‌شوند.', style: TextStyle(color: BG.muted, height: 1.7)),
                ),
              )
            else
              ...s.history.map(_historyTile),
            const SizedBox(height: 18),
            Center(child: Text('نسخهٔ ${faNum(s.appVersion)} · ${faNum(s.sendersCount)} فرستندهٔ بانکی', style: const TextStyle(color: BG.muted, fontSize: 12))),
          ],
        ),
      ),
    );
  }

  Widget _kv(String k, String v, {bool ltr = false, bool warn = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 120, child: Text(k, style: const TextStyle(color: BG.muted))),
          Expanded(child: Text(v, textDirection: ltr ? TextDirection.ltr : null, textAlign: ltr ? TextAlign.left : null, style: TextStyle(color: warn ? BG.amber : BG.fg))),
        ]),
      );

  Widget _historyTile(HistoryItem h) {
    final (color, icon) = switch (h.status) {
      'sent' => (BG.green, Icons.check_circle_rounded),
      'duplicate' => (BG.muted, Icons.content_copy_rounded),
      _ => (BG.amber, Icons.remove_circle_outline_rounded),
    };
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Card(
        child: ListTile(
          leading: Icon(icon, color: color),
          title: Text(h.amountRial > 0 ? tomanFa(h.amountRial) : h.sender, style: const TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text('${h.sender} · ${h.detail}', style: const TextStyle(color: BG.muted, fontSize: 12.5, height: 1.5)),
          trailing: Text(agoFa(h.at), style: const TextStyle(color: BG.muted, fontSize: 12)),
        ),
      ),
    );
  }
}

class _Warn extends StatelessWidget {
  const _Warn(this.text, this.cta, this.onTap);
  final String text;
  final String cta;
  final Future<void> Function() onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
        decoration: BoxDecoration(color: BG.amber.withValues(alpha: .12), borderRadius: BorderRadius.circular(14), border: Border.all(color: BG.amber.withValues(alpha: .4))),
        child: Row(children: [
          const Icon(Icons.warning_amber_rounded, color: BG.amber),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: const TextStyle(color: BG.amber, height: 1.5, fontSize: 13.5))),
          TextButton(onPressed: onTap, child: Text(cta)),
        ]),
      ),
    );
  }
}

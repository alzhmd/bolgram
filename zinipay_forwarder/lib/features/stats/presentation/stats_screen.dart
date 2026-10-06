import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../dashboard/providers/agent_provider.dart';
import '../../sms/models/sms_transaction.dart';
import '../../sms/services/mfs_sms_parser.dart';

class StatsScreen extends ConsumerWidget {
  const StatsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state  = ref.watch(agentProvider);
    final all    = [...state.transactionHistory, ...state.offlineQueue];
    final currency = NumberFormat('#,##0.00');

    // Build daily data for last 7 days
    final dailyData = _buildDailyData(all);

    // Build provider breakdown
    final providerTotals = _buildProviderTotals(all);
    final totalAmount    = all.fold(0.0, (s, t) => s + t.amount);

    return Scaffold(
      appBar: AppBar(title: const Text('পরিসংখ্যান')),
      body: all.isEmpty
          ? const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.bar_chart_outlined, size: 60, color: Colors.grey),
                  SizedBox(height: 12),
                  Text('এখনো কোনো ডেটা নেই', style: TextStyle(color: Colors.grey)),
                  SizedBox(height: 4),
                  Text('পেমেন্ট এসএমএস আসলে এখানে রিয়েল-টাইম পরিসংখ্যান প্রদর্শিত হবে', style: TextStyle(color: Colors.grey, fontSize: 12)),
                ],
              ),
            )
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // ── Summary KPI row ───────────────────────────────────────
                  Row(
                    children: [
                      _KpiCard(label: 'মোট লেনদেন', value: '${all.length}টি', icon: Icons.receipt_long, color: const Color(0xFF6366F1)),
                      const SizedBox(width: 12),
                      _KpiCard(label: 'মোট পরিমাণ', value: '৳${currency.format(totalAmount)}', icon: Icons.account_balance_wallet, color: const Color(0xFF10B981)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      _KpiCard(
                        label: 'সফল',
                        value: '${all.where((t) => t.status == SmsStatus.forwarded).length}টি',
                        icon: Icons.check_circle,
                        color: const Color(0xFF10B981),
                      ),
                      const SizedBox(width: 12),
                      _KpiCard(
                        label: 'প্রত্যাখ্যাত',
                        value: '${all.where((t) => t.status == SmsStatus.rejected || t.status == SmsStatus.failed).length}টি',
                        icon: Icons.cancel,
                        color: const Color(0xFFEF4444),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),

                  // ── 7-day bar chart ───────────────────────────────────────
                  const Text('গত ৭ দিনের পেমেন্ট', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                  const SizedBox(height: 12),
                  Container(
                    height: 220,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Theme.of(context).cardColor,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Theme.of(context).dividerColor),
                    ),
                    child: dailyData.every((d) => d.y == 0)
                        ? const Center(child: Text('ডেটা নেই', style: TextStyle(color: Colors.grey)))
                        : BarChart(
                            BarChartData(
                              alignment: BarChartAlignment.spaceAround,
                              maxY: dailyData.map((d) => d.y).reduce((a, b) => a > b ? a : b) * 1.3,
                              barTouchData: BarTouchData(
                                touchTooltipData: BarTouchTooltipData(
                                  getTooltipItem: (group, groupIndex, rod, rodIndex) => BarTooltipItem(
                                    '৳${currency.format(rod.toY)}',
                                    const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12),
                                  ),
                                ),
                              ),
                              titlesData: FlTitlesData(
                                bottomTitles: AxisTitles(
                                  sideTitles: SideTitles(
                                    showTitles: true,
                                    getTitlesWidget: (v, _) {
                                      final idx = v.toInt();
                                      if (idx < 0 || idx >= dailyData.length) return const SizedBox();
                                      return Text(dailyData[idx].label, style: const TextStyle(fontSize: 10, color: Colors.grey));
                                    },
                                  ),
                                ),
                                leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                                topTitles:  const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                                rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                              ),
                              gridData: const FlGridData(show: false),
                              borderData: FlBorderData(show: false),
                              barGroups: dailyData.asMap().entries.map((e) => BarChartGroupData(
                                x: e.key,
                                barRods: [
                                  BarChartRodData(
                                    toY: e.value.y,
                                    color: const Color(0xFF6366F1),
                                    width: 22,
                                    borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                                  ),
                                ],
                              )).toList(),
                            ),
                          ),
                  ),
                  const SizedBox(height: 20),

                  // ── Provider breakdown ────────────────────────────────────
                  const Text('Provider বিভাজন', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                  const SizedBox(height: 12),
                  ...providerTotals.entries.map((e) {
                    final pct = totalAmount > 0 ? (e.value / totalAmount * 100) : 0.0;
                    final color = Color(ParsedMfsResult.colorFor(e.key));
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Row(children: [
                                Container(width: 10, height: 10, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
                                const SizedBox(width: 6),
                                Text(e.key, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                              ]),
                              Text('৳${currency.format(e.value)} (${pct.toStringAsFixed(1)}%)',
                                  style: const TextStyle(fontSize: 12, color: Colors.grey)),
                            ],
                          ),
                          const SizedBox(height: 4),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: LinearProgressIndicator(
                              value: pct / 100,
                              minHeight: 8,
                              backgroundColor: color.withValues(alpha: 0.12),
                              valueColor: AlwaysStoppedAnimation<Color>(color),
                            ),
                          ),
                        ],
                      ),
                    );
                  }),
                ],
              ),
            ),
    );
  }

  List<_DayData> _buildDailyData(List<SmsTransaction> all) {
    final now    = DateTime.now();
    final result = <_DayData>[];
    for (int i = 6; i >= 0; i--) {
      final day = DateTime(now.year, now.month, now.day - i);
      final label = DateFormat('E').format(day); // Mon, Tue...
      final total = all
          .where((t) => _sameDay(t.receivedAt, day))
          .fold(0.0, (s, t) => s + t.amount);
      result.add(_DayData(label: label, y: total));
    }
    return result;
  }

  Map<String, double> _buildProviderTotals(List<SmsTransaction> all) {
    final map = <String, double>{};
    for (final t in all) {
      map[t.provider] = (map[t.provider] ?? 0) + t.amount;
    }
    final sorted = map.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
    return Map.fromEntries(sorted);
  }

  bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;
}

class _DayData {
  final String label;
  final double y;
  const _DayData({required this.label, required this.y});
}

class _KpiCard extends StatelessWidget {
  final String label, value;
  final IconData icon;
  final Color color;
  const _KpiCard({required this.label, required this.value, required this.icon, required this.color});

  @override
  Widget build(BuildContext context) => Expanded(
    child: Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Theme.of(context).dividerColor),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), shape: BoxShape.circle),
            child: Icon(icon, color: color, size: 20),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: const TextStyle(color: Colors.grey, fontSize: 11)),
                const SizedBox(height: 2),
                Text(value, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14), overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

import 'package:flutter/material.dart';

/// Colour tokens shared with the web panel (public/panel/assets/panel.css).
class BG {
  static const bg = Color(0xFF040810);
  static const surface = Color(0xFF0B1424);
  static const surface2 = Color(0xFF111D33);
  static const border = Color(0xFF1C2B47);
  static const brand = Color(0xFF4090FF);
  static const accent = Color(0xFF27E0FF);
  static const fg = Color(0xFFE8EEFC);
  static const muted = Color(0xFF8DA2C4);
  static const green = Color(0xFF2DD58C);
  static const amber = Color(0xFFFFB84D);
  static const red = Color(0xFFFF5D6C);
}

ThemeData buildTheme() {
  const scheme = ColorScheme.dark(
    primary: BG.brand,
    secondary: BG.accent,
    surface: BG.surface,
    error: BG.red,
    onPrimary: BG.bg,
    onSurface: BG.fg,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: BG.bg,
    canvasColor: BG.bg,
    appBarTheme: const AppBarTheme(
      backgroundColor: BG.bg,
      foregroundColor: BG.fg,
      elevation: 0,
      centerTitle: false,
    ),
    cardTheme: CardThemeData(
      color: BG.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: BG.border),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: BG.brand,
        foregroundColor: BG.bg,
        minimumSize: const Size.fromHeight(50),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: BG.fg,
        side: const BorderSide(color: BG.border),
        minimumSize: const Size.fromHeight(48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: BG.surface2,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: BG.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: BG.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: BG.brand, width: 1.6),
      ),
    ),
    textTheme: ThemeData.dark().textTheme.apply(bodyColor: BG.fg, displayColor: BG.fg),
  );
}

const _fa = '۰۱۲۳۴۵۶۷۸۹';

/// Latin digits to Persian digits.
String faNum(Object? v) => '$v'.replaceAllMapped(RegExp(r'\d'), (m) => _fa[int.parse(m[0]!)]);

/// "n دقیقه پیش" style relative time for an epoch in milliseconds.
String agoFa(int ms, {int? now}) {
  if (ms <= 0) return 'هنوز';
  final s = (((now ?? DateTime.now().millisecondsSinceEpoch) - ms) / 1000).round();
  if (s < 45) return 'لحظاتی پیش';
  if (s < 3600) return '${faNum((s / 60).round())} دقیقه پیش';
  if (s < 86400) return '${faNum((s / 3600).floor())} ساعت پیش';
  return '${faNum((s / 86400).floor())} روز پیش';
}

/// Rial amount as a grouped Toman string, e.g. 12٬345٬000 تومان.
String tomanFa(int rial) {
  final t = (rial / 10).round().toString();
  final grouped = t.replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => '٬');
  return '${faNum(grouped)} تومان';
}

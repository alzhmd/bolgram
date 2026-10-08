import 'package:flutter/material.dart';

import 'native.dart';
import 'screens/onboarding_screen.dart';
import 'screens/pair_screen.dart';
import 'screens/status_screen.dart';
import 'theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const BolgramApp());
}

class BolgramApp extends StatelessWidget {
  const BolgramApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'بولگرام',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      themeMode: ThemeMode.dark,
      locale: const Locale('fa', 'IR'),
      // The UI is Persian only: force right-to-left for every screen.
      builder: (context, child) => Directionality(textDirection: TextDirection.rtl, child: child ?? const SizedBox()),
      home: const Gate(),
    );
  }
}

/// Permissions first, then pairing, then the status screen. Re-evaluated whenever the app returns to the foreground.
class Gate extends StatefulWidget {
  const Gate({super.key});

  @override
  State<Gate> createState() => _GateState();
}

class _GateState extends State<Gate> with WidgetsBindingObserver {
  Perms? _perms;
  AppState? _state;
  bool _skipPerms = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) _load();
  }

  Future<void> _load() async {
    final p = await Native.permissions();
    final st = await Native.state();
    if (st.paired) await Native.startService();
    if (!mounted) return;
    setState(() {
      _perms = p;
      _state = st;
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = _perms;
    final st = _state;
    if (p == null || st == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (!p.sms && !_skipPerms && !st.paired) {
      return OnboardingScreen(onDone: _load, onSkip: () => setState(() => _skipPerms = true));
    }
    if (!st.paired) return PairScreen(onPaired: _load);
    return StatusScreen(onUnpaired: _load);
  }
}

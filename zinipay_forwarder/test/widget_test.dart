import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:payflow_agent/core/storage/local_vault.dart';
import 'package:payflow_agent/features/dashboard/providers/agent_provider.dart';
import 'package:payflow_agent/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('App smoke test', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final vault = LocalVault(prefs);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          localVaultProvider.overrideWithValue(vault),
        ],
        child: const SyncPayForwarderApp(),
      ),
    );
    expect(find.byType(SyncPayForwarderApp), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 2000));
    await tester.pumpAndSettle();
  });
}


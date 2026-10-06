import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:payflow_agent/core/network/api_client.dart';

void main() {
  group('Ingestion API Client Suite', () {
    test('Handles 201 Created successfully with matched invoice', () async {
      final mockClient = MockClient((request) async {
        expect(request.url.path, equals('/api/v1/device/sms/ingest'));
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['device_id'], equals('token_phone_primary'));
        expect(body['sms'], contains('BK881920'));

        return http.Response(
          jsonEncode({
            'success': true,
            'message': 'Transaction successfully ingested and ledger updated',
            'transaction': {
              'provider': 'bKash',
              'trx_id': 'BK881920',
              'amount': 1500.0,
              'sender': '01711223344',
            },
            'matched_invoice_id': 'INV_TEST_9918',
          }),
          201,
          headers: {'content-type': 'application/json'},
        );
      });

      final apiClient = ApiClient(client: mockClient);
      final response = await apiClient.ingestSms(
        backendUrl: 'http://localhost:4000',
        deviceToken: 'token_phone_primary',
        deviceId: 'ZP-AND-TEST',
        sms: 'You have received Tk 1,500.00 from 01711223344. TrxID BK881920',
      );

      expect(response.success, isTrue);
      expect(response.statusCode, equals(201));
      expect(response.isDuplicate, isFalse);
      expect(response.trxId, equals('BK881920'));
      expect(response.amount, equals(1500.0));
      expect(response.matchedInvoiceId, equals('INV_TEST_9918'));
    });

    test('Handles 200 Duplicate transaction response', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'success': true,
            'isDuplicate': true,
            'message': 'Transaction already recorded in ledger. Double-spend blocked.',
            'trxId': 'BK881920',
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });

      final apiClient = ApiClient(client: mockClient);
      final response = await apiClient.ingestSms(
        backendUrl: 'http://localhost:4000',
        deviceToken: 'token_phone_primary',
        deviceId: 'ZP-AND-TEST',
        sms: 'You have received Tk 1,500.00 from 01711223344. TrxID BK881920',
      );

      expect(response.success, isTrue);
      expect(response.statusCode, equals(200));
      expect(response.isDuplicate, isTrue);
      expect(response.trxId, equals('BK881920'));
    });

    test('Handles 401 Unauthorized for invalid device token', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'success': false,
            'step_failed': 'Step 1: Device Authentication',
            'error': 'Device not registered or invalid token',
          }),
          401,
          headers: {'content-type': 'application/json'},
        );
      });

      final apiClient = ApiClient(client: mockClient);
      final response = await apiClient.ingestSms(
        backendUrl: 'http://localhost:4000',
        deviceToken: 'invalid_token',
        deviceId: 'ZP-AND-TEST',
        sms: 'You have received Tk 500.00 from 01700000000. TrxID BK999',
      );

      expect(response.success, isFalse);
      expect(response.statusCode, equals(401));
      expect(response.errorMessage, contains('Device authentication failed'));
    });
  });
}

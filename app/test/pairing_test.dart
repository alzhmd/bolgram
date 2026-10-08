import 'dart:convert';

import 'package:bolgram_forwarder/pairing.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  group('parsePairInput', () {
    test('QR link carries server and code', () {
      final r = parsePairInput('bolgram://pair?s=https%3A%2F%2Fbolgram.ir&c=ABCD2345');
      expect(r?.server, 'https://bolgram.ir');
      expect(r?.code, 'ABCD2345');
      expect(r?.token, isNull);
    });

    test('typed codes are normalised, ambiguous characters are rejected', () {
      expect(parsePairInput('abcd-2345')?.code, 'ABCD2345');
      expect(parsePairInput(' abcd 2345 ')?.code, 'ABCD2345');
      expect(parsePairInput('ABCD0O1I'), isNull); // 0 O 1 I never appear in codes
      expect(parsePairInput('ABC'), isNull);
      expect(parsePairInput(''), isNull);
    });

    test('legacy JSON QR keeps working', () {
      final r = parsePairInput(jsonEncode({'backend_url': 'https://x.ir/', 'device_token': 'tok', 'device_name': 'گوشی'}));
      expect(r?.token, 'tok');
      expect(r?.server, 'https://x.ir');
      expect(r?.name, 'گوشی');
    });

    test('foreign QR codes are refused', () {
      expect(parsePairInput('https://example.com'), isNull);
      expect(parsePairInput('bolgram://other?c=ABCD2345&s=https://a.ir'), isNull);
      expect(parsePairInput('{bad json'), isNull);
    });
  });

  group('exchangeCode', () {
    test('returns the token on 201', () async {
      final client = MockClient((req) async {
        expect(req.url.toString(), 'https://bolgram.ir/api/v1/device/pair');
        expect(jsonDecode(req.body)['code'], 'ABCD2345');
        return http.Response.bytes(utf8.encode(jsonEncode({'success': true, 'device_token': 'bgd_1', 'device_name': 'گوشی', 'merchant_name': 'فروشگاه'})), 201);
      });
      final r = await exchangeCode('https://bolgram.ir', 'ABCD2345', client: client);
      expect(r.token, 'bgd_1');
      expect(r.merchantName, 'فروشگاه');
    });

    test('surfaces the Persian server message on failure', () async {
      final client = MockClient((_) async => http.Response.bytes(utf8.encode(jsonEncode({'message': 'کد اتصال اشتباه است'})), 404));
      expect(() => exchangeCode('https://bolgram.ir', 'ABCD2345', client: client), throwsA(isA<PairError>().having((e) => e.message, 'message', 'کد اتصال اشتباه است')));
    });
  });
}

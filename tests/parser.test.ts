import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseBankMessage, type ParseContext } from '../src/parsers/ir/parser.js';
import { BUILTIN_TEMPLATES, compileTemplate } from '../src/parsers/ir/templates.js';
import { BANKS } from '../src/parsers/ir/registry.js';
import { normalizeSender, normalizeSmsBody, isSensitiveSms } from '../src/parsers/ir/normalize.js';
import { tehranParts } from '../src/parsers/ir/jalali.js';

const ctx: ParseContext = {
  banks: BANKS.map((b) => ({ id: b.id, senders: b.senders, keywords: b.keywords, notificationPackages: [] })),
  templates: BUILTIN_TEMPLATES.map((t) => compileTemplate(t)!),
};

// 1405/07/12 10:00 Tehran
const REF = new Date('2026-10-04T06:30:00Z');

function jalali(d: Date | null) {
  if (!d) return null;
  const p = tehranParts(d);
  return `${p.jy}/${String(p.jm).padStart(2, '0')}/${String(p.jd).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

interface Sample {
  name: string;
  sender: string;
  body: string;
  expect: {
    bank: string;
    direction: 'credit' | 'debit';
    amount: number;
    balance?: number;
    account?: string;
    time?: string;
    template?: string | null;
    trusted?: boolean;
  };
}

// Real message shapes (numbers changed). Amounts in Rial.
const SAMPLES: Sample[] = [
  {
    name: 'mellat deposit',
    sender: 'Bank Mellat',
    body: 'حساب1848394556\nواریز31,500,000\nمانده31,894,014\n05/06/28-13:57',
    expect: { bank: 'mellat', direction: 'credit', amount: 31_500_000, balance: 31_894_014, account: '1848394556', time: '1405/06/28 13:57', template: 'mellat-v1' },
  },
  {
    name: 'melli transfer in (Arabic letters as delivered)',
    sender: '700717',
    body: 'بانك ملي ايران\nانتقال:25,000,000+\nحساب:10000\nمانده:198,088,329\n0625-19:42',
    expect: { bank: 'melli', direction: 'credit', amount: 25_000_000, balance: 198_088_329, account: '10000', time: '1405/06/25 19:42', template: 'melli-v1' },
  },
  {
    name: 'melli withdrawal',
    sender: '+98700717',
    body: 'بانك ملي ايران\nبرداشت:500,000-\nحساب:10000\nمانده:23,488,359\n0705-20:46',
    expect: { bank: 'melli', direction: 'debit', amount: 500_000, balance: 23_488_359, time: '1405/07/05 20:46' },
  },
  {
    name: 'tejarat deposit via shetab',
    sender: 'TejaratBank',
    body: '*بانک تجارت*  \nحساب: 0177002186043  \nواریز: 5,000,000 ریال  \nاز طريق: شتاب   \nمانده: 24,562,460 ریال  \n1405/07/05 \n18:39',
    expect: { bank: 'tejarat', direction: 'credit', amount: 5_000_000, balance: 24_562_460, account: '0177002186043', time: '1405/07/05 18:39', template: 'tejarat-v1' },
  },
  {
    name: 'pasargad debit',
    sender: 'B.Pasargad',
    body: '232.800.1442198.1\n-80,000\n06/16_19:45\nمانده: 31,516,369',
    expect: { bank: 'pasargad', direction: 'debit', amount: 80_000, balance: 31_516_369, account: '23280014421981', time: '1405/06/16 19:45' },
  },
  {
    name: 'resalat credit (same shape as pasargad, sender decides)',
    sender: 'ResalatBank',
    body: '10.3372914.1 \n+4,692,800  \n07/11_22:01 \nمانده: 433,121,042',
    expect: { bank: 'resalat', direction: 'credit', amount: 4_692_800, balance: 433_121_042, time: '1405/07/11 22:01', template: 'resalat-v1' },
  },
  {
    name: 'parsian credit',
    sender: 'PARSIANBANK',
    body: '30101540968603\nمبلغ:2,582,800,000+\nمانده:2,616,820,545\n07/04\n09:22',
    expect: { bank: 'parsian', direction: 'credit', amount: 2_582_800_000, balance: 2_616_820_545, time: '1405/07/04 09:22' },
  },
  {
    name: 'blu deposit with Persian digits',
    sender: '+989999987641',
    body: 'بلو\nواریز پول\n سینا عزیز، 2,500,000 ریال به حساب شما نشست.\n موجودی: 104,451,226 ریال\n۱۸:۲۳\n۱۴۰۵.۰۷.۰۳',
    expect: { bank: 'blu', direction: 'credit', amount: 2_500_000, balance: 104_451_226, time: '1405/07/03 18:23', template: 'blu-v1' },
  },
  {
    name: 'blu withdrawal without space before rial',
    sender: '+989999987641',
    body: 'بلو\nبرداشت پول\nسینا عزیز، 3,000,000ریال از حساب شما پرید.\nموجودی: 63,475,726 ریال\n۱۶:۰۰\n۱۴۰۵.۰۷.۱۲',
    expect: { bank: 'blu', direction: 'debit', amount: 3_000_000, balance: 63_475_726 },
  },
  {
    name: 'shahr interest credit',
    sender: 'Bank Shahr',
    body: '*بانک شهر*\nسود\nواريز به:700814110204\nمبلغ:377,743ريال\nموجودي:89,371,480ريال\n1405/07/1 00:41:16',
    expect: { bank: 'shahr', direction: 'credit', amount: 377_743, balance: 89_371_480, account: '700814110204', time: '1405/07/01 00:41' },
  },
  {
    name: 'mehr iran credit',
    sender: 'B.QMEHRIRAN',
    body: ' 300362322544  \n5,000,000+\n1405/7/11-14:40\n مانده:7,239,695',
    expect: { bank: 'mehr-iran', direction: 'credit', amount: 5_000_000, balance: 7_239_695, time: '1405/07/11 14:40' },
  },
  {
    name: 'khavarmianeh debit with trailing description',
    sender: 'KH M BANK',
    body: 'بانک خاورمیانه\n838/000115456\n-208,000,000\n07/08\n15:58\nمانده 536,365\nبرداشت حواله پل',
    expect: { bank: 'khavarmianeh', direction: 'debit', amount: 208_000_000, balance: 536_365, account: '838000115456' },
  },
  // Generic parser (no template) – one-line and labelled formats
  {
    name: 'generic one-line toman deposit',
    sender: 'AyandehBank',
    body: 'بانک آینده واریز ۵۰۰٬۰۰۰ تومان به حساب ۰۲۰۱۲۳۴۵۶۷ مانده ۱٬۲۰۰٬۰۰۰ تومان ۱۴۰۵/۰۷/۰۳ ۱۰:۱۵',
    expect: { bank: 'ayandeh', direction: 'credit', amount: 5_000_000, balance: 12_000_000, account: '0201234567', time: '1405/07/03 10:15', template: null },
  },
  {
    name: 'generic labelled saman deposit',
    sender: '+9820000',
    body: 'بانک سامان\nواریز به سپرده 849-800-1234567-1\nمبلغ: 1,250,030 ریال\nمانده: 9,000,000 ریال\n1405/07/10\n21:05',
    expect: { bank: 'saman', direction: 'credit', amount: 1_250_030, balance: 9_000_000, time: '1405/07/10 21:05', template: null, trusted: true },
  },
  {
    name: 'generic sepah with masked card and tracking number',
    sender: '200021',
    body: 'بانک سپه\nانتقال به کارت 589210******1234\nمبلغ 2,000,000+ ریال\nپیگیری: 845512\nمانده 3,500,000\n1405/07/11-12:01',
    expect: { bank: 'sepah', direction: 'credit', amount: 2_000_000, balance: 3_500_000, time: '1405/07/11 12:01', template: null },
  },
];

describe('bank SMS parser', () => {
  for (const s of SAMPLES) {
    test(s.name, () => {
      const r = parseBankMessage({ sender: s.sender, body: s.body, receivedAt: REF }, ctx);
      assert.equal(r.kind, 'transaction', `problems: ${r.problems.join(', ')}`);
      assert.equal(r.bankId, s.expect.bank);
      assert.equal(r.direction, s.expect.direction);
      assert.equal(r.amount, s.expect.amount);
      if (s.expect.balance !== undefined) assert.equal(r.balance, s.expect.balance);
      if (s.expect.account !== undefined) assert.equal(r.account, s.expect.account);
      if (s.expect.time !== undefined) assert.equal(jalali(r.bankTime), s.expect.time);
      if (s.expect.template !== undefined) assert.equal(r.templateId, s.expect.template);
      assert.equal(r.senderTrusted, s.expect.trusted ?? true);
      assert.ok(r.confidence > 0.5);
    });
  }

  test('a reference number is extracted from generic messages', () => {
    const r = parseBankMessage({ sender: '200021', body: SAMPLES[SAMPLES.length - 1].body, receivedAt: REF }, ctx);
    assert.equal(r.reference, '845512');
    assert.equal(r.card, '589210******1234');
  });

  test('unknown sender is read but not trusted', () => {
    const r = parseBankMessage(
      { sender: '+989121234567', body: 'حساب1848394556\nواریز31,500,000\nمانده31,894,014\n05/06/28-13:57', receivedAt: REF },
      ctx,
    );
    assert.equal(r.kind, 'transaction');
    assert.equal(r.senderTrusted, false);
    assert.equal(r.bankId, 'mellat');
    assert.equal(r.bankSource, 'template');
  });

  test('merchant-trusted sender is honoured', () => {
    const r = parseBankMessage(
      { sender: '+98300099', body: 'بانک ملت\nواریز: 1,000,000 ریال\nمانده: 2,000,000\n1405/07/12 09:00', receivedAt: REF },
      { ...ctx, trustedSenders: [{ sender: '300099', bankId: 'mellat' }] },
    );
    assert.equal(r.senderTrusted, true);
    assert.equal(r.bankSource, 'merchant_trust');
    assert.equal(r.amount, 1_000_000);
  });

  test('one-time passwords are never read and their text is dropped', () => {
    for (const body of ['بانک پارسیان\nرمز پویا: 123456\nمبلغ:1,000', 'رمز دوم پویا شما 88321 است', 'کد تأیید شما 4412', 'Your OTP is 1234']) {
      const r = parseBankMessage({ sender: 'PARSIANBANK', body, receivedAt: REF }, ctx);
      assert.equal(r.kind, 'sensitive');
      assert.equal(r.normalizedBody, '');
    }
    assert.equal(isSensitiveSms(normalizeSmsBody('پیگیری: 845512 واریز 1,000')), false);
  });

  test('non-transaction bank messages are not read as money', () => {
    for (const body of [
      'مشتری گرامی شما در۱۴۰۵/۰۷/۰۶ ساعت۲۲:۵۰وارد همراه بانک تجارت شده اید.',
      'بلو\nبا بلو بیشتر آشنا شوید',
      'مشتری گرامی، مانده حساب شما 81,294,045 ریال است.',
    ]) {
      const r = parseBankMessage({ sender: 'TejaratBank', body, receivedAt: REF }, ctx);
      assert.notEqual(r.kind, 'transaction', body);
    }
  });

  test('an unsigned pasargad amount has no direction', () => {
    const r = parseBankMessage({ sender: 'B.Pasargad', body: '232.800.1442198.1\n80,000\n06/16_19:45\nمانده: 31,516,369', receivedAt: REF }, ctx);
    assert.notEqual(r.templateId, 'pasargad-v1');
  });

  test('dates without a year resolve to the most recent past day', () => {
    // 12/29 seen on 1405/07/12 is 1404/12/29
    const r = parseBankMessage({ sender: 'PARSIANBANK', body: '30101540968603\nمبلغ:1,000+\nمانده:2,000\n12/29\n09:22', receivedAt: REF }, ctx);
    assert.equal(jalali(r.bankTime), '1404/12/29 09:22');
  });
});

describe('sender normalisation', () => {
  test('numeric prefixes', () => {
    assert.equal(normalizeSender('+98200060'), '200060');
    assert.equal(normalizeSender('98200060'), '200060');
    assert.equal(normalizeSender('200060'), '200060');
    assert.equal(normalizeSender('+98 912 345 6789'), '9123456789');
    assert.equal(normalizeSender('09123456789'), '9123456789');
  });
  test('names ignore case and punctuation', () => {
    for (const n of ['Bank Shahr', 'BankShahr', 'BANK-SHAHR', ' bank  shahr ', 'Bank.Shahr', 'bank_shahr']) {
      assert.equal(normalizeSender(n), 'bankshahr');
    }
  });
});

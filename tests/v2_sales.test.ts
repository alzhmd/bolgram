import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import Fastify, { FastifyInstance } from 'fastify';
import { v2Routes } from '../src/routes/v2.routes.js';
import { dbService } from '../src/db/database.js';
import { CryptoUtil } from '../src/utils/crypto.js';
import { events } from '../src/services/events.js';

const db = () => (dbService as any).db as import('node:sqlite').DatabaseSync;
const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const uid = () => crypto.randomBytes(4).toString('hex').toUpperCase();

describe('Sales: invoices, held deposits, reports', () => {
  let app: FastifyInstance;
  const A = { id: '', token: '', device: '' };
  const B = { id: '', token: '', device: '' };
  let viewerToken = '';
  let accountantToken = '';
  const cancelled: string[] = [];
  const now = Date.now();
  const future = new Date(now + 20 * 60_000).toISOString();
  const past = new Date(now - 5 * 60_000).toISOString();
  const ids: Record<string, string> = {};

  const call = async (method: 'GET' | 'POST', url: string, token: string, payload?: unknown) => {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as any } : {}) });
    return { status: res.statusCode, body: res.headers['content-type']?.toString().includes('json') ? JSON.parse(res.body) : res.body, raw: res.body, headers: res.headers };
  };
  async function register(prefix: string) {
    const n = `${Date.now() % 1e7}${Math.floor(Math.random() * 90 + 10)}`.slice(-7);
    const res = await app.inject({ method: 'POST', url: '/api/v2/auth/register', payload: { handle: `${prefix}${n}`, mobile: `0915${n}`, password: 'Strong-pass-77', terms: true } });
    const body = JSON.parse(res.body);
    assert.ok(body.token, res.body);
    return { id: body.merchant.id as string, token: body.token as string };
  }
  function staffToken(merchantId: string, role: string) {
    const id = 'tm_' + uid().toLowerCase();
    db().prepare(`INSERT INTO team_members (id, merchant_id, name, mobile, role, status, token_version, created_at) VALUES (?, ?, ?, ?, ?, 'active', 0, ?)`).run(id, merchantId, `همکار ${role}`, '09120000000', role, Date.now());
    const m = db().prepare('SELECT token_version FROM merchants WHERE id = ?').get(merchantId) as any;
    return CryptoUtil.signJwt({ id: merchantId, role: 'merchant', tv: Number(m.token_version || 0), staff: id, stv: 0 });
  }
  function device(merchantId: string, name: string) {
    const id = 'dev_' + uid().toLowerCase();
    db().prepare('INSERT INTO devices (id, merchant_id, device_token, device_name) VALUES (?, ?, ?, ?)').run(id, merchantId, 'tok_' + id, name);
    return id;
  }
  function invoice(merchantId: string, o: { rial: number; status?: string; created?: Date; expires?: string; channel?: string | null; note?: string; trx?: string; bank?: string; name?: string }) {
    const id = 'INV' + uid() + uid().slice(0, 2);
    db()
      .prepare(`INSERT INTO invoices (id, merchant_id, customer_name, expected_amount, provider, order_id, status, trx_id, payment_method, channel, note, created_at, expires_at)
                VALUES (?, ?, ?, ?, 'card', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, merchantId, o.name || o.note || 'فاکتور', o.rial, id, o.status || 'PENDING', o.trx || null, o.bank || null, o.channel === undefined ? 'instagram' : o.channel, o.note || null, sqlTime(o.created || new Date()), o.expires || future);
    return id;
  }
  function tx(merchantId: string, deviceId: string, o: { rial: number; trx: string; at: Date; bank?: string; sender?: string | null; verified?: boolean; order?: string | null; raw?: string }) {
    db()
      .prepare(`INSERT INTO transactions (merchant_id, device_id, provider, trx_id, amount, sender, raw_sms, is_verified, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(merchantId, deviceId, o.bank || 'mellat', o.trx.toUpperCase(), o.rial, o.sender ?? null, o.raw || `واریز ${o.rial} ریال`, o.verified === false ? 0 : 1, o.order ?? null, sqlTime(o.at));
  }
  function held(deviceId: string, o: { rial: number; trx: string; status?: string; sender?: string; at?: Date }) {
    const id = 'sms_' + crypto.randomUUID();
    db()
      .prepare('INSERT INTO unmatched_sms (id, device_id, provider, sender, amount, trx_id, raw_sms, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, deviceId, 'mellat', o.sender || '+98700717', o.rial, o.trx, `بانک ملت\nواریز ${o.rial} ریال\nپیگیری ${o.trx}`, o.status || 'UNMATCHED', sqlTime(o.at || new Date()));
    return id;
  }

  before(async () => {
    app = Fastify();
    await app.register(v2Routes);
    await app.ready();
    Object.assign(A, await register('sla'));
    Object.assign(B, await register('slb'));
    A.device = device(A.id, 'گوشی صندوق');
    B.device = device(B.id, 'گوشی B');
    viewerToken = staffToken(A.id, 'viewer');
    accountantToken = staffToken(A.id, 'accountant');
    events.on('invoice.cancelled', (p) => { cancelled.push(p.invoiceId); });

    ids.pending = invoice(A.id, { rial: 2_500_130, note: 'کفش ورزشی', channel: 'instagram' });
    ids.round = invoice(A.id, { rial: 2_500_000, note: 'کیف', channel: 'telegram' });
    ids.expired = invoice(A.id, { rial: 1_200_000, note: 'منقضی', expires: past, created: new Date(now - 60 * 60_000) });
    ids.cancelled = invoice(A.id, { rial: 990_000, status: 'CANCELLED', note: '=HYPERLINK("x")' });
    ids.paid = invoice(A.id, { rial: 4_800_070, status: 'PAID', trx: 'trxpaid1', bank: 'saman', channel: 'website', note: 'سفارش سایت', created: new Date(now - 10 * 60_000) });
    tx(A.id, A.device, { rial: 4_800_070, trx: 'trxpaid1', at: new Date(now - 8 * 60_000), bank: 'saman', sender: '603799******4321', order: ids.paid, raw: 'سامان واریز ۴۸۰۰۰۷۰' });
    ids.other = invoice(B.id, { rial: 2_500_130, note: 'کفش ورزشی' });
  });
  after(async () => {
    await app.close();
  });

  test('list: effective status, filters, Persian-digit amount search, totals, scoping', async () => {
    const all = await call('GET', '/api/v2/invoices?per_page=100', A.token);
    assert.strictEqual(all.status, 200);
    const byId = Object.fromEntries(all.body.data.map((r: any) => [r.id, r]));
    assert.ok(!byId[ids.other], "another store's invoice is never listed");
    assert.strictEqual(byId[ids.expired].status, 'EXPIRED', 'PENDING past its deadline is reported as EXPIRED');
    assert.strictEqual(byId[ids.pending].status, 'PENDING');
    assert.strictEqual(byId[ids.pending].amount_toman, 250_013);
    assert.match(byId[ids.pending].pay_path, /checkout\.html\?invoice_id=INV/);
    const paid = byId[ids.paid];
    assert.strictEqual(paid.status, 'PAID');
    assert.strictEqual(paid.payer_last4, '4321', 'payer card shows only the last 4 digits');
    assert.ok(!JSON.stringify(paid).includes('603799'), 'card prefix never leaves the server');
    assert.strictEqual(paid.bank, 'saman');
    assert.ok(paid.bank_name && paid.bank_name !== 'saman');
    assert.strictEqual(paid.trx_id, 'trxpaid1');
    assert.ok(paid.paid_at && new Date(paid.paid_at).getTime() > now - 9 * 60_000);
    assert.deepStrictEqual(all.body.totals, { count: 5, paid_count: 1, paid_sum_rial: 4_800_070 });

    const st = async (s: string) => (await call('GET', `/api/v2/invoices?status=${s}`, A.token)).body.data.map((r: any) => r.id).sort();
    assert.deepStrictEqual(await st('pending'), [ids.pending, ids.round].sort());
    assert.deepStrictEqual(await st('expired'), [ids.expired]);
    assert.deepStrictEqual(await st('paid'), [ids.paid]);
    assert.deepStrictEqual(await st('cancelled'), [ids.cancelled]);

    const search = async (q: string) => (await call('GET', `/api/v2/invoices?q=${encodeURIComponent(q)}`, A.token)).body.data.map((r: any) => r.id).sort();
    assert.deepStrictEqual(await search('۲۵۰٬۰۰۰'), [ids.pending, ids.round].sort(), 'round Toman amount matches its unique tail');
    assert.deepStrictEqual(await search('۲۵۰٬۰۱۳'), [ids.pending], 'exact unique amount in Persian digits');
    assert.deepStrictEqual(await search('250,013'), [ids.pending]);
    assert.deepStrictEqual(await search('کفش'), [ids.pending]);
    assert.deepStrictEqual(await search('كفش'), [ids.pending], 'Arabic kaf is normalised');
    assert.deepStrictEqual(await search(ids.paid.toLowerCase().slice(0, 9)), [ids.paid]);
    assert.deepStrictEqual(await search('100%'), [], 'LIKE wildcards are escaped');

    const ch = await call('GET', '/api/v2/invoices?channel=telegram', A.token);
    assert.deepStrictEqual(ch.body.data.map((r: any) => r.id), [ids.round]);
    const range = await call('GET', '/api/v2/invoices?min=۱۲۰٬۰۰۰&max=250000&sort=amount_asc', A.token);
    assert.deepStrictEqual(range.body.data.map((r: any) => r.id), [ids.expired, ids.round]);
    const sorted = await call('GET', '/api/v2/invoices?sort=amount_desc&per_page=2&page=1', A.token);
    assert.deepStrictEqual(sorted.body.data.map((r: any) => r.id), [ids.paid, ids.pending]);
    assert.strictEqual(sorted.body.total, 5);
    assert.strictEqual(sorted.body.per_page, 2);
    const recent = await call('GET', `/api/v2/invoices?from=${encodeURIComponent(new Date(now - 30 * 60_000).toISOString())}`, A.token);
    assert.ok(!recent.body.data.some((r: any) => r.id === ids.expired), 'from filters by creation time');

    const badStatus = await call('GET', '/api/v2/invoices?status=weird', A.token);
    assert.strictEqual(badStatus.status, 422);
    assert.ok(badStatus.body.errors.status);
    assert.strictEqual((await call('GET', '/api/v2/invoices?from=yesterday', A.token)).status, 422);
  });

  test('detail: timeline, payment info, raw SMS only with deposits:review, scoped', async () => {
    const d = await call('GET', `/api/v2/invoices/${ids.paid}`, A.token);
    assert.strictEqual(d.status, 200);
    assert.deepStrictEqual(d.body.timeline.map((t: any) => t.type), ['created', 'deposit', 'paid']);
    assert.strictEqual(d.body.payment.source, 'auto');
    assert.strictEqual(d.body.payment.device_name, 'گوشی صندوق');
    assert.strictEqual(d.body.payment.difference_rial, 0);
    assert.strictEqual(d.body.raw_sms, 'سامان واریز ۴۸۰۰۰۷۰');
    assert.strictEqual(d.body.can_cancel, false);

    const v = await call('GET', `/api/v2/invoices/${ids.paid}`, viewerToken);
    assert.strictEqual(v.status, 200);
    assert.strictEqual(v.body.raw_sms, null);
    assert.strictEqual(v.body.raw_sms_allowed, false);

    const p = await call('GET', `/api/v2/invoices/${ids.pending}`, A.token);
    assert.strictEqual(p.body.can_cancel, true);
    assert.strictEqual(p.body.timeline.at(-1).type, 'deadline');
    const e = await call('GET', `/api/v2/invoices/${ids.expired}`, A.token);
    assert.strictEqual(e.body.invoice.status, 'EXPIRED');
    assert.ok(e.body.timeline.some((t: any) => t.type === 'expired'));

    assert.strictEqual((await call('GET', `/api/v2/invoices/${ids.other}`, A.token)).status, 404, "another store's invoice is 404");
    assert.strictEqual((await call('GET', '/api/v2/invoices/..%2F..%2Fetc', A.token)).status, 404);
  });

  test('cancel: only effective PENDING, emits invoice.cancelled, audited; viewer cannot', async () => {
    const viewer = await call('POST', `/api/v2/invoices/${ids.round}/cancel`, viewerToken, {});
    assert.strictEqual(viewer.status, 403, 'viewer role cannot cancel');

    const ok = await call('POST', `/api/v2/invoices/${ids.round}/cancel`, A.token, { reason: 'مشتری منصرف شد' });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.invoice.status, 'CANCELLED');
    assert.ok(ok.body.invoice.cancelled_at);
    await events.settle();
    assert.ok(cancelled.includes(ids.round));
    const log = db().prepare(`SELECT * FROM audit_log WHERE merchant_id = ? AND action = 'invoice.cancelled' AND target = ?`).get(A.id, ids.round) as any;
    assert.ok(log, 'audit row written');
    assert.strictEqual(log.actor_kind, 'owner');

    const again = await call('POST', `/api/v2/invoices/${ids.round}/cancel`, A.token, {});
    assert.strictEqual(again.status, 409);
    assert.strictEqual((await call('POST', `/api/v2/invoices/${ids.paid}/cancel`, A.token, {})).status, 409);
    const exp = await call('POST', `/api/v2/invoices/${ids.expired}/cancel`, A.token, {});
    assert.strictEqual(exp.status, 409, 'expired (computed) invoices cannot be cancelled');
    assert.match(exp.body.message, /مهلت/);
    assert.strictEqual((await call('POST', `/api/v2/invoices/${ids.other}/cancel`, A.token, {})).status, 404);
    assert.strictEqual((db().prepare('SELECT status FROM invoices WHERE id = ?').get(ids.other) as any).status, 'PENDING');

    const d = await call('GET', `/api/v2/invoices/${ids.round}`, A.token);
    const c = d.body.timeline.find((t: any) => t.type === 'cancelled');
    assert.ok(c && /مشتری منصرف شد/.test(c.detail));
  });

  test('CSV export: BOM, Persian headers, Jalali dates, Toman, formula-safe, permission', async () => {
    const r = await call('GET', '/api/v2/invoices/export.csv?sort=amount_desc', A.token);
    assert.strictEqual(r.status, 200);
    assert.match(String(r.headers['content-type']), /text\/csv/);
    assert.match(String(r.headers['content-disposition']), /attachment; filename="bolgram-invoices-\d{4}-\d{2}-\d{2}\.csv"/);
    assert.ok(r.raw.startsWith('﻿'), 'UTF-8 BOM for Excel');
    const lines = r.raw.slice(1).split('\r\n');
    assert.match(lines[0], /^شماره فاکتور,تاریخ ساخت,مبلغ فاکتور \(تومان\)/);
    const paid = lines.find((l: string) => l.startsWith(ids.paid))!;
    assert.match(paid, /,\d{4}\/\d{2}\/\d{2} \d{2}:\d{2},480007,480007,پرداخت‌شده,سایت,/);
    assert.match(paid, /\*\*\*\*4321/);
    assert.ok(lines.some((l: string) => l.includes(`"'=HYPERLINK(""x"")"`)), 'formula-looking notes are neutralised');
    assert.strictEqual(lines.length, 6);
    assert.strictEqual((await call('GET', '/api/v2/invoices/export.csv', viewerToken)).status, 403, 'export needs invoices:manage');
    assert.strictEqual((await call('GET', '/api/v2/invoices/export.csv', accountantToken)).status, 200);
  });

  test('held deposits: list, candidates, approve locks the ledger row, reject, scoping and permissions', async () => {
    const target = invoice(A.id, { rial: 3_000_040, note: 'میز' });
    const trusted = held(A.device, { rial: 3_000_000, trx: 'h-1001' });
    tx(A.id, A.device, { rial: 3_000_000, trx: 'h-1001', at: new Date(), verified: false, sender: '6219861234567788' });
    const fake = held(A.device, { rial: 5_000_000, trx: 'h-2002', status: 'SUSPICIOUS', sender: '09121234567' });
    const foreign = held(B.device, { rial: 3_000_000, trx: 'h-3003' });

    const list = await call('GET', '/api/v2/deposits', A.token);
    assert.strictEqual(list.status, 200);
    assert.deepStrictEqual(list.body.data.map((r: any) => r.id).sort(), [trusted, fake].sort());
    assert.strictEqual(list.body.counts.open, 2);
    assert.strictEqual(list.body.counts.suspicious, 1);
    const f = list.body.data.find((r: any) => r.id === fake);
    assert.strictEqual(f.trusted, false);
    assert.strictEqual(f.device_name, 'گوشی صندوق');
    assert.match(f.raw_sms, /h-2002/);
    const t = list.body.data.find((r: any) => r.id === trusted);
    assert.strictEqual(t.trusted, true);
    assert.strictEqual(t.payer_last4, '7788');

    assert.strictEqual((await call('GET', '/api/v2/deposits', viewerToken)).status, 403, 'viewer cannot review deposits');
    assert.strictEqual((await call('GET', `/api/v2/deposits/${foreign}/candidates`, A.token)).status, 404);
    assert.strictEqual((await call('POST', `/api/v2/deposits/${foreign}/approve`, A.token, { invoice_id: target })).status, 404, "another store's deposit is 404");
    assert.strictEqual((await call('POST', `/api/v2/deposits/${foreign}/reject`, A.token, { reason: 'جعلی' })).status, 404);
    assert.strictEqual((await call('POST', `/api/v2/deposits/${trusted}/approve`, A.token, { invoice_id: ids.other })).status, 404, "can't settle another store's invoice");
    assert.strictEqual((await call('POST', `/api/v2/deposits/${trusted}/approve`, A.token, { invoice_id: ids.paid })).status, 409);

    const cand = await call('GET', `/api/v2/deposits/${trusted}/candidates`, A.token);
    assert.strictEqual(cand.status, 200);
    assert.strictEqual(cand.body.invoices[0].id, target, 'closest amount first');
    assert.strictEqual(cand.body.invoices[0].difference_rial, 40);

    const ok = await call('POST', `/api/v2/deposits/${trusted}/approve`, accountantToken, { invoice_id: target.toLowerCase() });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.invoice.status, 'PAID');
    assert.strictEqual(ok.body.invoice.received_rial, 3_000_000);
    assert.strictEqual(ok.body.deposit.status, 'assigned');
    assert.strictEqual(ok.body.deposit.handled_by, 'همکار accountant');
    const ledger = db().prepare('SELECT is_verified, order_id FROM transactions WHERE merchant_id = ? AND trx_id = ?').get(A.id, 'H-1001') as any;
    assert.deepStrictEqual({ ...ledger }, { is_verified: 1, order_id: target }, 'ledger row is locked to the invoice');
    assert.strictEqual((await call('POST', `/api/v2/deposits/${trusted}/approve`, A.token, { invoice_id: ids.pending })).status, 409, 'handled once');
    const det = await call('GET', `/api/v2/invoices/${target}`, A.token);
    assert.strictEqual(det.body.payment.source, 'manual');
    assert.strictEqual(det.body.payment.approved_by, 'همکار accountant');
    assert.strictEqual(det.body.payment.difference_rial, -40);

    const noReason = await call('POST', `/api/v2/deposits/${fake}/reject`, A.token, { reason: '' });
    assert.strictEqual(noReason.status, 422);
    const rej = await call('POST', `/api/v2/deposits/${fake}/reject`, A.token, { reason: 'پیامک جعلی' });
    assert.strictEqual(rej.status, 200);
    assert.strictEqual(rej.body.deposit.status, 'rejected');
    assert.strictEqual(rej.body.deposit.trusted, false, 'trust flag survives handling');
    assert.strictEqual(rej.body.deposit.reject_reason, 'پیامک جعلی');
    const rejected = await call('GET', '/api/v2/deposits?status=rejected', A.token);
    assert.deepStrictEqual(rejected.body.data.map((r: any) => r.id), [fake]);
    assert.strictEqual((await call('GET', '/api/v2/deposits?status=assigned', A.token)).body.data[0].invoice_id, target);
    assert.ok(db().prepare(`SELECT 1 FROM audit_log WHERE merchant_id = ? AND action = 'deposit.rejected' AND target = ?`).get(A.id, fake));

    // A deposit whose ledger row was already used by a checkout can't be approved again.
    const dup = held(A.device, { rial: 700_000, trx: 'h-4004' });
    tx(A.id, A.device, { rial: 700_000, trx: 'h-4004', at: new Date(), verified: true, order: ids.paid });
    const listed = (await call('GET', '/api/v2/deposits', A.token)).body.data.find((r: any) => r.id === dup);
    assert.strictEqual(listed.already_used, true);
    const twice = await call('POST', `/api/v2/deposits/${dup}/approve`, A.token, { invoice_id: ids.pending });
    assert.strictEqual(twice.status, 409);
    assert.strictEqual(twice.body.error, 'already_used');
  });

  test('reports: totals, previous period, daily gaps, hour/weekday/bank/channel breakdowns, CSV', async () => {
    const R = await register('slr');
    const dev = device(R.id, 'گوشی گزارش');
    // Range = 7 Tehran days starting Monday 1404/10/15 (2026-01-05 00:00 Tehran = 2026-01-04T20:30Z).
    const from = new Date('2026-01-04T20:30:00.000Z');
    const to = new Date(from.getTime() + 7 * 86_400_000);
    const at = (day: number, hh: number, mm = 0) => new Date(from.getTime() + day * 86_400_000 + (hh * 60 + mm) * 60_000); // Tehran wall clock
    const i1 = invoice(R.id, { rial: 1_000_010, status: 'PAID', trx: 'r1', bank: 'mellat', channel: 'instagram', created: at(0, 9, 50) });
    tx(R.id, dev, { rial: 1_000_010, trx: 'r1', at: at(0, 10), bank: 'mellat', sender: '610433******1111', order: i1 });
    const i2 = invoice(R.id, { rial: 2_000_020, status: 'PAID', trx: 'r2', bank: 'mellat', channel: 'instagram', created: at(0, 10, 20) });
    tx(R.id, dev, { rial: 2_000_020, trx: 'r2', at: at(0, 10, 30), bank: 'mellat', sender: '610433******1111', order: i2 });
    const i3 = invoice(R.id, { rial: 3_000_030, status: 'PAID', trx: 'r3', bank: 'saman', channel: 'telegram', created: at(2, 21) });
    tx(R.id, dev, { rial: 3_000_030, trx: 'r3', at: at(2, 21, 5), bank: 'saman', sender: '621986******2222', order: i3 });
    invoice(R.id, { rial: 500_000, status: 'EXPIRED', channel: 'telegram', created: at(2, 22), expires: at(2, 22, 30).toISOString() });
    invoice(R.id, { rial: 600_000, status: 'PENDING', channel: 'in_person', created: at(5, 8), expires: at(5, 8, 30).toISOString() });
    // Manual approval made outside this API (ledger row left unverified) still counts, once.
    const i4 = invoice(R.id, { rial: 4_000_040, status: 'PAID', trx: 'r4', bank: 'saman', channel: 'telegram', created: at(6, 11) });
    tx(R.id, dev, { rial: 4_000_000, trx: 'r4', at: at(6, 11, 10), bank: 'saman', sender: null, verified: false });
    const s4 = held(dev, { rial: 4_000_000, trx: 'r4', status: 'ASSIGNED', at: at(6, 11, 10) });
    db().prepare('UPDATE unmatched_sms SET assigned_invoice_id = ? WHERE id = ?').run(i4, s4);
    // API payment without an invoice.
    tx(R.id, dev, { rial: 900_000, trx: 'r5', at: at(6, 23, 50), bank: 'melli', sender: '603799******3333', order: 'ORD_77' });
    // Unverified (held) and outside-range rows are not sales.
    tx(R.id, dev, { rial: 7_000_000, trx: 'r6', at: at(3, 12), verified: false });
    tx(R.id, dev, { rial: 8_000_000, trx: 'r7', at: at(7, 0, 1) });
    // Previous period (7 days before): one payment, two invoices.
    const p1 = invoice(R.id, { rial: 1_500_000, status: 'PAID', trx: 'p1', bank: 'mellat', channel: 'instagram', created: at(-3, 12) });
    tx(R.id, dev, { rial: 1_500_000, trx: 'p1', at: at(-3, 12, 5), bank: 'mellat', sender: '610433******1111', order: p1 });
    invoice(R.id, { rial: 200_000, status: 'EXPIRED', channel: 'instagram', created: at(-2, 12), expires: at(-2, 12, 30).toISOString() });

    const q = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
    const r = await call('GET', `/api/v2/reports?${q}`, R.token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const T = r.body.totals;
    assert.strictEqual(T.paid_rial, 1_000_010 + 2_000_020 + 3_000_030 + 4_000_000 + 900_000);
    assert.strictEqual(T.paid_count, 5);
    assert.strictEqual(T.avg_ticket_rial, Math.round(T.paid_rial / 5));
    assert.strictEqual(T.distinct_payers, 3, 'same card twice counts once; unknown payer not counted');
    assert.strictEqual(T.created_count, 6);
    assert.strictEqual(T.created_paid_count, 4);
    assert.strictEqual(T.conversion_pct, 66.7);
    assert.deepStrictEqual(
      { paid: r.body.previous_totals.paid_rial, n: r.body.previous_totals.paid_count, c: r.body.previous_totals.created_count, conv: r.body.previous_totals.conversion_pct },
      { paid: 1_500_000, n: 1, c: 2, conv: 50 },
    );
    assert.strictEqual(r.body.previous.to, from.toISOString());

    assert.strictEqual(r.body.daily.length, 7, 'every day present, gaps filled with zero');
    assert.deepStrictEqual(r.body.daily.map((d: any) => d.paid_count), [2, 0, 1, 0, 0, 0, 2]);
    assert.deepStrictEqual(r.body.daily.map((d: any) => d.created_count), [2, 0, 2, 0, 0, 1, 1]);
    assert.strictEqual(r.body.daily[0].jalali, '1404/10/15');
    assert.strictEqual(r.body.daily[0].date, '2026-01-05');
    assert.strictEqual(r.body.daily[0].weekday, 2, 'Monday is the third day of the Persian week');

    assert.strictEqual(r.body.hourly.length, 24);
    assert.strictEqual(r.body.hourly[10].paid_count, 2, 'Tehran hour buckets');
    assert.strictEqual(r.body.hourly[10].paid_rial, 3_000_030);
    assert.strictEqual(r.body.hourly[23].paid_count, 1);
    assert.strictEqual(r.body.weekday.length, 7);
    assert.strictEqual(r.body.weekday[0].name, 'شنبه');
    assert.strictEqual(r.body.weekday[2].paid_count, 2);
    assert.strictEqual(r.body.weekday[4].paid_count, 1, 'Wednesday');
    assert.strictEqual(r.body.weekday[1].paid_count, 2, 'Sunday (day 6)');

    const banks = Object.fromEntries(r.body.banks.map((b: any) => [b.bank, b]));
    assert.strictEqual(banks.saman.paid_rial, 7_000_030);
    assert.strictEqual(banks.mellat.paid_count, 2);
    assert.strictEqual(banks.melli.paid_count, 1);
    assert.strictEqual(r.body.banks[0].bank, 'saman', 'sorted by amount');
    assert.ok(Math.abs(r.body.banks.reduce((s: number, b: any) => s + b.share_pct, 0) - 100) < 0.5);

    const ch = Object.fromEntries(r.body.channels.map((c: any) => [c.channel, c]));
    assert.deepStrictEqual([ch.instagram.paid_count, ch.instagram.created_count, ch.instagram.conversion_pct], [2, 2, 100]);
    assert.deepStrictEqual([ch.telegram.paid_count, ch.telegram.created_count, ch.telegram.conversion_pct], [2, 3, 66.7]);
    assert.deepStrictEqual([ch.in_person.paid_count, ch.in_person.created_count, ch.in_person.conversion_pct], [0, 1, 0]);
    assert.strictEqual(ch.api.paid_rial, 900_000, 'payments without an invoice are grouped as API');

    const daily = await call('GET', `/api/v2/reports/export.csv?${q}`, R.token);
    assert.strictEqual(daily.status, 200);
    assert.ok(daily.raw.startsWith('﻿'));
    const dl = daily.raw.slice(1).split('\r\n');
    assert.strictEqual(dl[0], 'تاریخ,روز هفته,تعداد پرداخت,مبلغ دریافتی (تومان),فاکتور ساخته‌شده');
    assert.strictEqual(dl[1], '1404/10/15,دوشنبه,2,300003,2');
    assert.strictEqual(dl.at(-1), `جمع,,5,${T.paid_rial / 10},6`);
    const pays = await call('GET', `/api/v2/reports/export.csv?${q}&kind=payments`, R.token);
    const pl = pays.raw.slice(1).split('\r\n');
    assert.strictEqual(pl.length, 6);
    assert.match(pl[1], /^1404\/10\/21 23:50,90000,/);
    assert.ok(!pays.raw.includes('610433'), 'only last 4 digits of payer cards');

    assert.strictEqual((await call('GET', `/api/v2/reports?from=${encodeURIComponent(to.toISOString())}&to=${encodeURIComponent(from.toISOString())}`, R.token)).status, 422);
    assert.strictEqual((await call('GET', `/api/v2/reports?from=2024-01-01T00:00:00Z&to=2026-01-01T00:00:00Z`, R.token)).status, 422, 'range is capped');
    const def = await call('GET', '/api/v2/reports', R.token);
    assert.strictEqual(def.status, 200);
    assert.strictEqual(def.body.daily.length, 30, 'default range is the last 30 Tehran days');
    assert.strictEqual((await call('GET', `/api/v2/reports?${q}`, viewerToken)).status, 200, 'viewer has reports:read');
    const other = await call('GET', `/api/v2/reports?${q}`, A.token);
    assert.strictEqual(other.body.totals.paid_count, 0, "reports are scoped to the store");
  });
});

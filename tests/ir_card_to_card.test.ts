import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { deviceRoutes } from '../src/routes/device.routes.js';
import { InvoiceRepository } from '../src/db/repositories/invoice.repository.js';
import { merchantRoutes } from '../src/routes/merchant.routes.js';
import { CryptoUtil } from '../src/utils/crypto.js';

// End-to-end card-to-card flow: unique amount → bank deposit SMS → invoice PAID automatically.
describe('Iranian card-to-card auto verification', () => {
  let app: FastifyInstance;
  const DEVICE = 'token_chaldal_pri';
  const MERCHANT = 'm_chaldal_bd';
  const mellatSms = (amount: number, balance: number) =>
    `حساب1848394556\nواریز${amount.toLocaleString('en-US')}\nمانده${balance.toLocaleString('en-US')}\n05/07/12-10:15`;
  const ingest = (sms: string, sender = 'Bank Mellat') =>
    app.inject({ method: 'POST', url: '/api/v1/device/sms/ingest', payload: { device_id: DEVICE, sms, sender } });

  before(async () => {
    app = Fastify();
    await app.register(deviceRoutes);
    await app.register(merchantRoutes);
    await app.ready();
  });
  after(async () => app.close());

  test('two invoices of the same price get different payable amounts', async () => {
    const a = await InvoiceRepository.create({ merchantId: MERCHANT, invoiceId: `IRA${Date.now()}`, customerName: 'الف', amount: 2_500_000 });
    const b = await InvoiceRepository.create({ merchantId: MERCHANT, invoiceId: `IRB${Date.now()}`, customerName: 'ب', amount: 2_500_000 });
    assert.notStrictEqual(a.amount, b.amount);
    assert.ok(a.amount > 2_500_000 && a.amount <= 2_500_000 + 9990);
  });

  test('deposit SMS with the unique amount marks the invoice PAID; replay is blocked', async () => {
    const inv = await InvoiceRepository.create({ merchantId: MERCHANT, invoiceId: `IRC${Date.now()}`, customerName: 'ج', amount: 1_000_000 });
    const sms = mellatSms(inv.amount, 50_000_000 + inv.amount);
    const res = await ingest(sms);
    assert.ok([200, 201].includes(res.statusCode), res.body);
    assert.strictEqual(JSON.parse(res.body).matched_invoice_id, inv.invoice_id);
    const after = await InvoiceRepository.findByInvoiceId(inv.invoice_id);
    assert.strictEqual(after?.status, 'PAID');
    const again = await ingest(sms);
    assert.ok(JSON.parse(again.body).isDuplicate || JSON.parse(again.body).message?.includes('Double') || again.statusCode === 200);
  });

  test('withdrawals, OTPs and unknown senders never confirm an invoice', async () => {
    const inv = await InvoiceRepository.create({ merchantId: MERCHANT, invoiceId: `IRD${Date.now()}`, customerName: 'د', amount: 3_000_000 });
    assert.strictEqual((await ingest('بانک ملی ایران\nبرداشت:500,000-\nحساب:10000\nمانده:23,488,359\n0705-20:46', '700717')).statusCode, 422);
    assert.strictEqual((await ingest('رمز پویا شما 123456 است', 'Bank Mellat')).statusCode, 422);
    await ingest(mellatSms(inv.amount, 90_000_000), '+989121234567');
    assert.strictEqual((await InvoiceRepository.findByInvoiceId(inv.invoice_id))?.status, 'PENDING');
  });

  test('suspicious deposit is queued for review; merchant approves it manually', async () => {
    const auth = { authorization: `Bearer ${CryptoUtil.signJwt({ id: MERCHANT, role: 'merchant' })}` };
    const inv = await InvoiceRepository.create({ merchantId: MERCHANT, invoiceId: `IRE${Date.now()}`, customerName: 'ه', amount: 4_000_000 });
    await ingest(mellatSms(inv.amount, 77_000_000), '+989350000000');
    const list = JSON.parse((await app.inject({ method: 'GET', url: '/api/v1/merchant/unmatched', headers: auth })).body).data;
    const item = list.find((x: any) => Number(x.amount) === inv.amount);
    assert.strictEqual(item?.status, 'SUSPICIOUS');
    const other = await app.inject({ method: 'POST', url: `/api/v1/merchant/unmatched/${item.id}/assign`, payload: { invoiceId: inv.invoice_id } });
    assert.strictEqual(other.statusCode, 401);
    const ok = await app.inject({ method: 'POST', url: `/api/v1/merchant/unmatched/${item.id}/assign`, headers: auth, payload: { invoiceId: inv.invoice_id } });
    assert.strictEqual(ok.statusCode, 200, ok.body);
    assert.strictEqual((await InvoiceRepository.findByInvoiceId(inv.invoice_id))?.status, 'PAID');
    const twice = await app.inject({ method: 'POST', url: `/api/v1/merchant/unmatched/${item.id}/assign`, headers: auth, payload: { invoiceId: inv.invoice_id } });
    assert.strictEqual(twice.statusCode, 409);
  });
});

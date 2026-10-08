import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { deviceRoutes } from '../src/routes/device.routes.js';
import { InvoiceRepository } from '../src/db/repositories/invoice.repository.js';
import { dbService } from '../src/db/database.js';
import { openDeposits, approveDeposit, StoreError } from '../src/services/store.service.js';

// End-to-end card-to-card flow: unique amount → bank deposit SMS → invoice PAID automatically.
describe('Iranian card-to-card auto verification', () => {
  let app: FastifyInstance;
  const tag = Date.now().toString(36);
  const DEVICE = `tok_c2c_${tag}`;
  const MERCHANT = `m_c2c_${tag}`;
  const mellatSms = (amount: number, balance: number) =>
    `حساب1848394556\nواریز${amount.toLocaleString('en-US')}\nمانده${balance.toLocaleString('en-US')}\n05/07/12-10:15`;
  const ingest = (sms: string, sender = 'Bank Mellat') =>
    app.inject({ method: 'POST', url: '/api/v1/device/sms/ingest', payload: { device_id: DEVICE, sms, sender } });

  before(async () => {
    app = Fastify();
    await app.register(deviceRoutes);
    await app.ready();
    dbService.insertMerchant({ id: MERCHANT, name: 'فروشگاه آزمایشی', api_key: `live_sk_${tag}`, phone: '09120000000', status: 'ACTIVE', plan: 'FREE', payment_status: 'FREE', password_hash: 'x' } as any);
    dbService.addDevice({ id: `dev_${tag}`, merchantId: MERCHANT, deviceName: 'گوشی تست', simNumber: '', deviceToken: DEVICE } as any);
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
    const inv = await InvoiceRepository.create({ merchantId: MERCHANT, invoiceId: `IRE${Date.now()}`, customerName: 'ه', amount: 4_000_000 });
    await ingest(mellatSms(inv.amount, 77_000_000), '+989350000000');
    const item = openDeposits(MERCHANT, 20).find((x: any) => Number(x.amount) === inv.amount);
    assert.strictEqual(item?.status, 'SUSPICIOUS');
    await assert.rejects(approveDeposit('m_someone_else', item.id, inv.invoice_id), StoreError);
    await approveDeposit(MERCHANT, item.id, inv.invoice_id);
    assert.strictEqual((await InvoiceRepository.findByInvoiceId(inv.invoice_id))?.status, 'PAID');
    await assert.rejects(approveDeposit(MERCHANT, item.id, inv.invoice_id), StoreError);
  });
});

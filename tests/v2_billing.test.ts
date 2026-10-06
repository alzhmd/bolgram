import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { v2Routes } from '../src/routes/v2.routes.js';
import { dbService } from '../src/db/database.js';
import { events } from '../src/services/events.js';
import { CryptoUtil } from '../src/utils/crypto.js';
import { addCard } from '../src/services/store.service.js';
import { InvoiceRepository } from '../src/db/repositories/invoice.repository.js';
import { saveSettings, balanceOf, post, currentPlan } from '../src/services/billing.service.js';

const d = () => (dbService as any).db as import('node:sqlite').DatabaseSync;
const luhnCard = (seed: number) => {
  const body = '603799' + String(seed).padStart(9, '0').slice(-9);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let n = +body[body.length - 1 - i];
    if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return body + ((10 - (sum % 10)) % 10);
};

describe('Billing: fee wallet, plans, referral (v2 billing feature)', () => {
  let app: FastifyInstance;
  const stamp = Date.now() % 1e7;
  let S: any, P: any, R: any, N: any; // store, platform, referrer, referred
  let auth: Record<string, any> = {};
  const admin = { authorization: `Bearer ${CryptoUtil.signJwt({ id: 'admin', role: 'admin' }, undefined, 1)}` };
  const req = (method: string, url: string, payload?: any, headers: any = {}) => app.inject({ method: method as any, url, payload, headers });
  const json = (r: any) => JSON.parse(r.body);
  const paid = async (merchantId: string, invoiceId: string, amount: number) => {
    events.emit('invoice.paid', { merchantId, invoiceId, amount, provider: 'mellat', source: 'auto' });
    await events.settle();
  };
  const ledger = (mid: string, kind?: string) => d().prepare(`SELECT * FROM wallet_ledger WHERE merchant_id = ? ${kind ? 'AND kind = ?' : ''}`).all(...(kind ? [mid, kind] : [mid])) as any[];

  before(async () => {
    app = Fastify();
    await app.register(v2Routes);
    await app.ready();
    const reg = async (h: string, mob: string, ref?: string) => {
      const r = await req('POST', '/api/v2/auth/register', { handle: h, mobile: mob, password: 'Strong-pass-77', terms: true, ref });
      assert.strictEqual(r.statusCode, 201, r.body);
      const j = json(r);
      auth[j.merchant.id] = { authorization: `Bearer ${j.token}` };
      return j.merchant;
    };
    S = await reg(`bills${stamp}`, `0915${String(stamp).padStart(7, '0')}`);
    P = await reg(`billp${stamp}`, `0914${String(stamp).padStart(7, '0')}`);
    R = await reg(`billr${stamp}`, `0913${String(stamp).padStart(7, '0')}`);
    N = await reg(`billn${stamp}`, `0912${String(stamp).padStart(7, '0')}`, `billr${stamp}`);
    d().prepare(`INSERT INTO payment_methods (id, merchant_id, provider_type, title, account_number, account_name, is_active) VALUES (?, ?, 'mellat', 'ملت', '6104337800002091', 'تست', 1)`).run('pm_b' + stamp, P.id);
  });
  after(async () => app.close());

  test('owner endpoints reject merchant tokens and accept the admin token', async () => {
    assert.strictEqual((await req('GET', '/api/owner/plans', undefined, auth[S.id])).statusCode, 401);
    assert.strictEqual((await req('GET', '/api/owner/billing/settings')).statusCode, 401);
    const ok = await req('GET', '/api/owner/plans', undefined, admin);
    assert.strictEqual(ok.statusCode, 200);
    assert.deepStrictEqual(json(ok).data.map((p: any) => p.id).slice(0, 4), ['free', 'basic', 'pro', 'business']);
    // public pricing needs no token
    const pub = json(await req('GET', '/api/pub/plans'));
    assert.ok(pub.data.length >= 4 && pub.data[0].fee_percent > 0);
  });

  test('owner CRUD: settings validation, plan create/patch/delete rules', async () => {
    const bad = await req('PUT', '/api/owner/billing/settings', { platform_merchant_id: 'nope', referral_percent: 99 }, admin);
    assert.strictEqual(bad.statusCode, 422);
    assert.ok(json(bad).errors.platform_merchant_id && json(bad).errors.referral_percent);
    const ok = await req('PUT', '/api/owner/billing/settings', { platform_merchant_id: P.id, topup_min_toman: 50000, referral_signup_bonus_toman: 0 }, admin);
    assert.strictEqual(ok.statusCode, 200, ok.body);
    assert.strictEqual(json(ok).platform_merchant.has_active_card, true);
    const mk = await req('POST', '/api/owner/plans', { id: `tmp${stamp}`, name: 'آزمایشی', monthly_price_toman: 1000, fee_percent: 2, limits: { cards: 1 } }, admin);
    assert.strictEqual(mk.statusCode, 201, mk.body);
    assert.strictEqual((await req('POST', '/api/owner/plans', { id: `tmp${stamp}`, name: 'x2' }, admin)).statusCode, 409);
    const pt = await req('PATCH', `/api/owner/plans/tmp${stamp}`, { fee_percent: 3, features: ['الف'] }, admin);
    assert.strictEqual(json(pt).plan.fee_percent, 3);
    assert.strictEqual((await req('DELETE', '/api/owner/plans/free', undefined, admin)).statusCode, 409);
    assert.strictEqual((await req('DELETE', `/api/owner/plans/tmp${stamp}`, undefined, admin)).statusCode, 200);
  });

  test('fee is charged once per paid invoice with plan percent, min and max', async () => {
    // free plan: 1.5%, min 500T, max 15,000T
    await paid(S.id, 'INVA', 100_000_0); // 100,000 T -> 1.5% = 1,500 T
    assert.strictEqual(balanceOf(S.id), -15_000);
    await paid(S.id, 'INVA', 100_000_0); // duplicate event: idempotent
    assert.strictEqual(ledger(S.id, 'fee').length, 1);
    await paid(S.id, 'INVB', 10_000 * 10); // 10,000 T -> 150 T -> min 500 T
    assert.strictEqual(balanceOf(S.id), -15_000 - 5_000);
    await paid(S.id, 'INVC', 5_000_000 * 10); // 5M T -> 75,000 T -> max 15,000 T
    assert.strictEqual(balanceOf(S.id), -15_000 - 5_000 - 150_000);
    const w = json(await req('GET', '/api/v2/wallet', undefined, auth[S.id]));
    assert.strictEqual(w.wallet.balance_toman, -17_000);
    assert.strictEqual(w.wallet.low, true);
    assert.strictEqual(w.wallet.blocked, false);
    assert.strictEqual(w.ledger.length, 3);
  });

  test('wallet.low fires at most once a day', async () => {
    let lows = 0;
    events.on('wallet.low', (e) => { if (e.merchantId === S.id) lows++; });
    d().prepare('UPDATE wallet_balances SET low_notified_at = NULL WHERE merchant_id = ?').run(S.id);
    await paid(S.id, 'INVL1', 100_000 * 10);
    await paid(S.id, 'INVL2', 100_000 * 10);
    assert.strictEqual(lows, 1);
  });

  test('guard blocks new invoices below -credit and never the platform store', async () => {
    // credit of free plan = 20,000 T; push the balance beyond it
    post(S.id, 'adjust', -(30_000 * 10), null, 'test');
    assert.ok(json(await req('GET', '/api/v2/wallet', undefined, auth[S.id])).wallet.blocked);
    await assert.rejects(
      InvoiceRepository.create({ merchantId: S.id, invoiceId: 'INVG' + stamp, customerName: 'x', amount: 100_000, source: 'api' }),
      (e: any) => e.status === 402 && e.code === 'wallet_empty' && /شارژ/.test(e.message),
    );
    await InvoiceRepository.create({ merchantId: P.id, invoiceId: 'INVP' + stamp, customerName: 'platform', amount: 100_000, source: 'api' });
    // refill above the threshold unblocks
    post(S.id, 'adjust', 500_000 * 10, null, 'test refill');
    await InvoiceRepository.create({ merchantId: S.id, invoiceId: 'INVH' + stamp, customerName: 'x', amount: 100_000, source: 'api' });
  });

  test('top-up flow end to end: invoice for platform store, bonus tier, idempotent credit, referral reward', async () => {
    const tooLow = await req('POST', '/api/v2/wallet/topups', { amount: 1000 }, auth[N.id]);
    assert.strictEqual(tooLow.statusCode, 422);
    const r = await req('POST', '/api/v2/wallet/topups', { amount: '۱٬۰۰۰٬۰۰۰' }, auth[N.id]);
    assert.strictEqual(r.statusCode, 201, r.body);
    const t = json(r);
    assert.strictEqual(t.topup.bonus_percent, 5);
    assert.strictEqual(t.topup.bonus_rial, 50_000 * 10);
    assert.match(t.pay_path, /^\/checkout\.html\?invoice_id=INV/);
    const inv = d().prepare('SELECT * FROM invoices WHERE id = ?').get(t.invoice_id) as any;
    assert.strictEqual(inv.merchant_id, P.id);
    assert.strictEqual(JSON.parse(inv.metadata).topup_id, t.topup.id);
    // same amount again reuses the open invoice
    assert.strictEqual(json(await req('POST', '/api/v2/wallet/topups', { amount: 1_000_000 }, auth[N.id])).invoice_id, t.invoice_id);

    await paid(P.id, t.invoice_id, inv.expected_amount);
    await paid(P.id, t.invoice_id, inv.expected_amount);
    assert.strictEqual(balanceOf(N.id), 1_050_000 * 10);
    assert.strictEqual(ledger(N.id, 'topup').length, 1);
    assert.strictEqual(ledger(N.id, 'bonus').length, 1);
    assert.strictEqual(balanceOf(P.id), 0); // the platform store pays no fee and receives no credit
    assert.strictEqual(d().prepare('SELECT status FROM wallet_topups WHERE id = ?').get(t.topup.id).status, 'paid');

    // referral: 10% of the top-up to the referrer, once
    assert.strictEqual(balanceOf(R.id), 100_000 * 10);
    assert.strictEqual(ledger(R.id, 'referral').length, 1);
    const ref = json(await req('GET', '/api/v2/referral', undefined, auth[R.id]));
    assert.strictEqual(ref.code, `billr${stamp}`);
    assert.strictEqual(ref.link, `https://bolgram.ir/register?ref=billr${stamp}`);
    assert.strictEqual(ref.referred.length, 1);
    assert.strictEqual(ref.referred[0].status, 'active');
    assert.strictEqual(ref.referred[0].reward_toman, 100_000);
    assert.ok(!ref.referred[0].handle_masked.includes(`billn${stamp}`));
    assert.strictEqual(ref.totals.earned_toman, 100_000);
    const qr = json(await req('GET', '/api/v2/referral/qr', undefined, auth[R.id]));
    assert.match(qr.svg, /<svg/);
    // outside the reward window nothing is paid
    d().prepare(`UPDATE merchants SET created_at = datetime('now', '-200 days') WHERE id = ?`).run(N.id);
    const t2 = json(await req('POST', '/api/v2/wallet/topups', { amount: 200_000 }, auth[N.id]));
    const inv2 = d().prepare('SELECT expected_amount FROM invoices WHERE id = ?').get(t2.invoice_id) as any;
    await paid(P.id, t2.invoice_id, inv2.expected_amount);
    assert.strictEqual(ledger(R.id, 'referral').length, 1);
  });

  test('top-up is unavailable (503) until a platform store is configured', async () => {
    const keep = JSON.stringify(json(await req('GET', '/api/owner/billing/settings', undefined, admin)).settings);
    d().prepare(`UPDATE system_settings SET value = json_set(value, '$.platform_merchant_id', '') WHERE key = 'billing'`).run();
    const r = await req('POST', '/api/v2/wallet/topups', { amount: 500_000 }, auth[S.id]);
    assert.strictEqual(r.statusCode, 503);
    assert.match(json(r).message, /شارژ/);
    d().prepare(`UPDATE system_settings SET value = ? WHERE key = 'billing'`).run(keep);
  });

  test('subscription: paid from the wallet, discounts, 402 when short, extends on renewal, expires back to free', async () => {
    const before = balanceOf(N.id);
    const bad = await req('POST', '/api/v2/plans/basic/subscribe', { months: 2 }, auth[N.id]);
    assert.strictEqual(bad.statusCode, 422);
    assert.strictEqual((await req('POST', '/api/v2/plans/free/subscribe', { months: 1 }, auth[N.id])).statusCode, 409);
    let changed = 0;
    events.on('plan.changed', (e) => { if (e.merchantId === N.id) changed++; });
    const ok = await req('POST', '/api/v2/plans/basic/subscribe', { months: 6 }, auth[N.id]); // 99,000 * 6 * 0.9 = 534,600
    assert.strictEqual(ok.statusCode, 200, ok.body);
    assert.strictEqual(json(ok).price_toman, 534_600);
    assert.strictEqual(balanceOf(N.id), before - 534_600 * 10);
    await events.settle();
    assert.strictEqual(changed, 1);
    assert.strictEqual(d().prepare('SELECT plan FROM merchants WHERE id = ?').get(N.id).plan, 'BASIC');
    const first = json(await req('GET', '/api/v2/plans', undefined, auth[N.id]));
    assert.strictEqual(first.current.plan.id, 'basic');
    assert.strictEqual(first.plans.length >= 4, true);
    // fee now follows the plan: 1% of 100,000 T = 1,000 T
    const b2 = balanceOf(N.id);
    await paid(N.id, 'INVN1', 100_000 * 10);
    assert.strictEqual(balanceOf(N.id), b2 - 1_000 * 10);
    // renewal extends the same subscription
    const renew = json(await req('POST', '/api/v2/plans/basic/subscribe', { months: 1 }, auth[N.id]));
    assert.ok(new Date(renew.expires_at).getTime() > new Date(first.current.expires_at).getTime() + 29 * 86_400_000);
    // insufficient funds
    const poor = await req('POST', '/api/v2/plans/pro/subscribe', { months: 12 }, auth[S.id]);
    assert.strictEqual(poor.statusCode, 402);
    assert.strictEqual(json(poor).error, 'insufficient_wallet');
    // expiry falls back to free (resolved lazily)
    d().prepare('UPDATE billing_subscriptions SET ends_at = ? WHERE merchant_id = ?').run(Date.now() - 1000, N.id);
    assert.strictEqual(currentPlan(N.id).plan.id, 'free');
    assert.strictEqual(d().prepare('SELECT plan FROM merchants WHERE id = ?').get(N.id).plan, 'FREE');
  });

  test('plan limits feed the limits provider (cards cap on addCard)', async () => {
    const r = json(await req('POST', '/api/owner/plans', { id: `lim${stamp}`, name: 'کم', monthly_price_toman: 0, limits: { cards: 1 }, active: false }, admin));
    assert.ok(r.success);
    // free plan allows 2 cards for store R
    addCard(R.id, { number: luhnCard(stamp), holder: 'علی رضایی' });
    addCard(R.id, { number: luhnCard(stamp + 1), holder: 'علی رضایی' });
    assert.throws(() => addCard(R.id, { number: luhnCard(stamp + 2), holder: 'علی رضایی' }), (e: any) => e.status === 402 && e.code === 'plan_limit');
    // a plan with unlimited cards lifts the cap
    post(R.id, 'adjust', 10_000_000 * 10, null, 'fund');
    assert.strictEqual((await req('POST', '/api/v2/plans/business/subscribe', { months: 1 }, auth[R.id])).statusCode, 200);
    addCard(R.id, { number: luhnCard(stamp + 2), holder: 'علی رضایی' });
  });

  test('ledger API: filters, paging, CSV, permission and owner adjust/summary/topups', async () => {
    const all = json(await req('GET', '/api/v2/wallet/ledger?per_page=2', undefined, auth[N.id]));
    assert.strictEqual(all.data.length, 2);
    assert.ok(all.total > 2);
    const fees = json(await req('GET', '/api/v2/wallet/ledger?kind=fee', undefined, auth[N.id]));
    assert.ok(fees.data.length >= 1 && fees.data.every((x: any) => x.kind === 'fee' && x.amount_toman < 0));
    assert.strictEqual((await req('GET', '/api/v2/wallet/ledger?from=garbage', undefined, auth[N.id])).statusCode, 422);
    const csv = await req('GET', '/api/v2/wallet/ledger.csv?kind=plan', undefined, auth[N.id]);
    assert.match(csv.headers['content-type'] as string, /text\/csv/);
    assert.ok(csv.body.includes('خرید پلن'));
    // a store only ever sees its own ledger
    assert.strictEqual(json(await req('GET', '/api/v2/wallet/ledger?kind=referral', undefined, auth[N.id])).total, 0);
    // viewer without wallet:read is not applicable; unauthenticated is rejected
    assert.strictEqual((await req('GET', '/api/v2/wallet')).statusCode, 401);

    const adj = await req('POST', `/api/owner/wallets/${S.id}/adjust`, { amount_toman: 1000, note: 'جبران' }, admin);
    assert.strictEqual(adj.statusCode, 200, adj.body);
    assert.strictEqual((await req('POST', `/api/owner/wallets/${S.id}/adjust`, { amount_toman: 0, note: 'x' }, admin)).statusCode, 422);
    assert.strictEqual((await req('POST', `/api/owner/wallets/${S.id}/adjust`, { amount_toman: 5, note: 'x'.repeat(5) }, auth[S.id])).statusCode, 401);
    const wl = json(await req('GET', `/api/owner/wallets?q=bills${stamp}`, undefined, admin));
    assert.strictEqual(wl.total, 1);
    assert.strictEqual(wl.data[0].plan_id, 'free');
    const tp = json(await req('GET', '/api/owner/topups?status=paid', undefined, admin));
    assert.ok(tp.data.length >= 2 && tp.data.every((x: any) => x.status === 'paid'));
    const sum = json(await req('GET', '/api/owner/billing/summary', undefined, admin));
    assert.ok(sum.fees_rial > 0 && sum.plan_sales_rial > 0 && sum.topups_rial > 0 && sum.bonus_rial > 0 && sum.referral_rial > 0);
  });

  test('signup bonus for referred stores is credited once', async () => {
    assert.ok(saveSettings({ referral_signup_bonus_toman: 25_000 }).settings);
    const before = balanceOf(N.id);
    await req('GET', '/api/v2/wallet', undefined, auth[N.id]);
    await req('GET', '/api/v2/wallet', undefined, auth[N.id]);
    assert.strictEqual(balanceOf(N.id), before + 25_000 * 10);
    assert.strictEqual(ledger(N.id, 'signup_bonus').length, 1);
    // stores without a referrer get nothing
    await req('GET', '/api/v2/wallet', undefined, auth[P.id]);
    assert.strictEqual(ledger(P.id, 'signup_bonus').length, 0);
  });
});

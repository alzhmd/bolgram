import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { v2Routes, issueToken } from '../src/routes/v2.routes.js';
import { dbService } from '../src/db/database.js';
import { GuardError, registerInvoiceGuard, registerLimitProvider } from '../src/services/events.js';

const d = () => (dbService as any).db as import('node:sqlite').DatabaseSync;
const fa = (s: string) => s.replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[+x]);

describe('Payment links (v2 links feature)', () => {
  let app: FastifyInstance;
  const stamp = Date.now() % 1e7;
  let A: any, B: any; // merchants
  let authA: any, authB: any, authCashier: any;
  let blockInvoices = false;
  let linkLimit: number | null = null;

  const req = (method: string, url: string, payload?: any, headers: any = {}) => app.inject({ method: method as any, url, payload, headers });
  const json = (r: any) => JSON.parse(r.body);
  const ip = (n: number) => ({ 'x-forwarded-for': `203.0.113.${n}` });
  const invoice = (id: string) => d().prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
  const create = async (body: any, auth = authA) => req('POST', '/api/v2/links', body, auth);

  before(async () => {
    app = Fastify();
    await app.register(v2Routes);
    await app.ready();
    registerInvoiceGuard((mid) => {
      if (blockInvoices && mid === A?.id) throw new GuardError(402, 'wallet_empty', 'موجودی کیف پول کافی نیست');
    });
    registerLimitProvider((mid, key) => (key === 'links' && mid === A?.id ? linkLimit : null));
    const reg = async (h: string, mob: string) => {
      const r = await req('POST', '/api/v2/auth/register', { handle: h, mobile: mob, password: 'Strong-pass-77', terms: true });
      assert.strictEqual(r.statusCode, 201, r.body);
      return json(r);
    };
    const a = await reg(`lnka${stamp}`, `0915${String(stamp).padStart(7, '0')}`);
    const b = await reg(`lnkb${stamp}`, `0914${String(stamp).padStart(7, '0')}`);
    A = a.merchant; B = b.merchant;
    authA = { authorization: `Bearer ${a.token}` };
    authB = { authorization: `Bearer ${b.token}` };
    d().prepare(`UPDATE merchants SET name = ? WHERE id = ?`).run('فروشگاه <تست>', A.id);
    d().prepare(`INSERT INTO payment_methods (id, merchant_id, provider_type, title, account_number, account_name, is_active) VALUES (?, ?, 'mellat', 'ملت', '6104337800002091', 'تست', 1)`).run('pm_l' + stamp, A.id);
    d().prepare(`INSERT INTO team_members (id, merchant_id, name, mobile, role, status, token_version, created_at) VALUES (?, ?, 'صندوق‌دار', '09120000000', 'cashier', 'active', 0, ?)`).run('tm_l' + stamp, A.id, Date.now());
    const mRow = d().prepare('SELECT * FROM merchants WHERE id = ?').get(A.id);
    authCashier = { authorization: `Bearer ${issueToken(mRow, false, { id: 'tm_l' + stamp, token_version: 0 })}` };
  });
  after(async () => app.close());

  test('slug rules: validation, reserved words, uniqueness, auto-generation', async () => {
    const check = async (s: string) => json(await req('GET', `/api/v2/links/slug-check?slug=${encodeURIComponent(s)}`, undefined, authA));
    assert.strictEqual((await check('ab')).status, 'invalid');
    assert.strictEqual((await check('-shop')).status, 'invalid');
    assert.strictEqual((await check('my--shop')).status, 'invalid');
    assert.strictEqual((await check('my_shop')).status, 'invalid');
    assert.match((await check('فروش')).message, /کیبورد/);
    assert.strictEqual((await check('admin')).status, 'reserved');
    assert.strictEqual((await check('checkout')).status, 'reserved');
    const slug = `tee-${stamp}`;
    assert.strictEqual((await check(slug)).status, 'free');

    const bad = await create({ title: 'تی‌شرت', amount_mode: 'fixed', amount: 120000, slug: 'admin' });
    assert.strictEqual(bad.statusCode, 422);
    assert.ok(json(bad).errors.slug);
    const ok = await create({ title: 'تی‌شرت', amount_mode: 'fixed', amount: '۱۲۰٬۰۰۰', slug: slug.toUpperCase() });
    assert.strictEqual(ok.statusCode, 201, ok.body);
    assert.strictEqual(json(ok).link.slug, slug);
    assert.strictEqual((await check(slug)).status, 'taken');
    const dup = await create({ title: 'دوباره', amount_mode: 'fixed', amount: 120000, slug });
    assert.strictEqual(dup.statusCode, 409);

    const auto = json(await create({ title: 'Summer Sale', amount_mode: 'fixed', amount: 50000 })).link;
    assert.match(auto.slug, /^summer-sale-[a-z0-9]{4}$/);
    const autoFa = json(await create({ title: 'کلاس عکاسی', amount_mode: 'fixed', amount: 50000 })).link;
    assert.match(autoFa.slug, new RegExp(`^lnka${stamp}-[a-z0-9]{4}$`));
    assert.ok(autoFa.url.endsWith(`/l/${autoFa.slug}`));
  });

  test('create validation and CRUD (patch, duplicate, delete)', async () => {
    const v = json(await create({ title: 'x', amount_mode: 'fixed', amount: 10 }));
    assert.ok(v.errors.title && v.errors.amount);
    const v2 = json(await create({ title: 'چند گزینه', amount_mode: 'choice', choices: [{ amount: 50000 }] }));
    assert.ok(v2.errors.choices);
    const v3 = json(await create({ title: 'بازه', amount_mode: 'open', min_amount: 90000, max_amount: 50000 }));
    assert.ok(v3.errors.max_amount);
    const v4 = json(await create({ title: 'ریدایرکت', amount_mode: 'fixed', amount: 50000, redirect_url: 'http://shop.ir/ok' }));
    assert.match(v4.errors.redirect_url, /https/);
    const v5 = json(await create({ title: 'انقضا', amount_mode: 'fixed', amount: 50000, expires_at: new Date(Date.now() - 1000).toISOString() }));
    assert.ok(v5.errors.expires_at);

    const r = await create({ title: 'کتاب', description: 'نسخهٔ چاپی', amount_mode: 'fixed', amount: 80000, collect: { name: 'required', email: 'optional' }, max_uses: 5, channel: 'instagram' });
    assert.strictEqual(r.statusCode, 201);
    const l = json(r).link;
    assert.deepStrictEqual(l.collect, { name: 'required', mobile: 'optional', email: 'optional', address: 'off', note: 'off' });
    assert.strictEqual(l.status, 'active');
    assert.strictEqual(l.amount_toman, 80000);
    assert.strictEqual(l.max_uses, 5);

    const p = await req('PATCH', `/api/v2/links/${l.id}`, { title: 'کتاب (ویرایش)', amount_toman: '۹۰٬۰۰۰', redirect_url: 'https://shop.example.ir/thanks', collect: { mobile: 'required' } }, authA);
    assert.strictEqual(p.statusCode, 200, p.body);
    const pl = json(p).link;
    assert.strictEqual(pl.title, 'کتاب (ویرایش)');
    assert.strictEqual(pl.amount, 90000);
    assert.strictEqual(pl.collect.mobile, 'required');
    assert.strictEqual(pl.collect.name, 'required');
    assert.strictEqual(pl.redirect_url, 'https://shop.example.ir/thanks');

    const got = json(await req('GET', `/api/v2/links/${l.id}`, undefined, authA));
    assert.strictEqual(got.link.id, l.id);
    assert.deepStrictEqual(got.recent_invoices, []);

    const dup = await req('POST', `/api/v2/links/${l.id}/duplicate`, undefined, authA);
    assert.strictEqual(dup.statusCode, 201);
    const dl = json(dup).link;
    assert.notStrictEqual(dl.slug, l.slug);
    assert.strictEqual(dl.active, false);
    assert.strictEqual(dl.amount, 90000);
    assert.match(dl.title, /کپی/);

    const del = json(await req('DELETE', `/api/v2/links/${dl.id}`, undefined, authA));
    assert.strictEqual(del.archived, false);
    assert.strictEqual((await req('GET', `/api/v2/links/${dl.id}`, undefined, authA)).statusCode, 404);

    const list = json(await req('GET', '/api/v2/links', undefined, authA));
    assert.ok(list.data.some((x: any) => x.id === l.id));
    assert.ok(list.total >= 1 && list.summary.active >= 1);
    const search = json(await req('GET', `/api/v2/links?q=${encodeURIComponent('ویرایش')}`, undefined, authA));
    assert.deepStrictEqual(search.data.map((x: any) => x.id), [l.id]);
  });

  test('permissions: read-only staff and other stores', async () => {
    assert.strictEqual((await req('GET', '/api/v2/links')).statusCode, 401);
    assert.strictEqual((await req('GET', '/api/v2/links', undefined, authCashier)).statusCode, 200);
    assert.strictEqual((await req('GET', '/api/v2/links/fx-rates', undefined, authCashier)).statusCode, 200);
    const denied = await create({ title: 'ممنوع', amount_mode: 'fixed', amount: 50000 }, authCashier);
    assert.strictEqual(denied.statusCode, 403);
    assert.strictEqual((await req('PUT', '/api/v2/links/fx-rates', { rates: { USD: 100000 } }, authCashier)).statusCode, 403);
    const mine = json(await req('GET', '/api/v2/links', undefined, authA)).data[0];
    assert.strictEqual((await req('PATCH', `/api/v2/links/${mine.id}`, { title: 'هک' }, authCashier)).statusCode, 403);
    assert.strictEqual((await req('GET', `/api/v2/links/${mine.id}`, undefined, authB)).statusCode, 404);
    assert.strictEqual((await req('PATCH', `/api/v2/links/${mine.id}`, { title: 'هک' }, authB)).statusCode, 404);
    assert.strictEqual((await req('DELETE', `/api/v2/links/${mine.id}`, undefined, authB)).statusCode, 404);
    assert.strictEqual(json(await req('GET', '/api/v2/links', undefined, authB)).total, 0);
  });

  test('fixed link: public info, view dedupe, pay creates a unique-amount invoice with metadata', async () => {
    const l = json(await create({ title: 'شال نخی', description: 'ارسال رایگان', amount_mode: 'fixed', amount: 120000, collect: { name: 'required', mobile: 'required' }, redirect_url: 'https://shop.example.ir/ok', success_message: 'ممنون از خرید شما' })).link;
    const info = json(await req('GET', `/api/pub/links/${l.slug}`, undefined, ip(1)));
    assert.strictEqual(info.available, true);
    assert.strictEqual(info.amount_toman, 120000);
    assert.strictEqual(info.store.name, 'فروشگاه <تست>');
    assert.strictEqual(info.store.handle, A.handle);
    assert.strictEqual(info.fields.name, 'required');
    assert.strictEqual(info.fields.email, 'off');
    await req('GET', `/api/pub/links/${l.slug}`, undefined, ip(1));
    await req('GET', `/api/pub/links/${l.slug}`, undefined, ip(2));
    const viewed = json(await req('GET', `/api/v2/links/${l.id}`, undefined, authA)).link;
    assert.strictEqual(viewed.stats.views, 2);

    const missing = await req('POST', `/api/pub/links/${l.slug}/pay`, { name: 'علی' }, ip(1));
    assert.strictEqual(missing.statusCode, 422);
    assert.ok(json(missing).errors.mobile);
    const badMob = await req('POST', `/api/pub/links/${l.slug}/pay`, { name: 'علی', mobile: '12345' }, ip(1));
    assert.ok(json(badMob).errors.mobile);

    const pay = await req('POST', `/api/pub/links/${l.slug}/pay`, { name: 'علی رضایی', mobile: fa('+98 912 345 6789'), amount: 1 }, ip(1));
    assert.strictEqual(pay.statusCode, 201, pay.body);
    const p = json(pay);
    assert.strictEqual(p.pay_url, `/checkout.html?invoice_id=${p.invoice_id}`);
    const inv = invoice(p.invoice_id);
    assert.strictEqual(inv.merchant_id, A.id);
    assert.strictEqual(inv.status, 'PENDING');
    assert.ok(inv.expected_amount > 1_200_000 && inv.expected_amount < 1_200_000 + 10 * 1000, String(inv.expected_amount));
    assert.strictEqual(inv.customer_name, 'علی رضایی');
    assert.strictEqual(inv.redirect_url, 'https://shop.example.ir/ok');
    const md = JSON.parse(inv.metadata);
    assert.strictEqual(md.link_id, l.id);
    assert.strictEqual(md.base_toman, 120000);
    assert.strictEqual(md.payer.mobile, '09123456789');
    assert.strictEqual(md.success_message, 'ممنون از خرید شما');

    // Same visitor, same details: the open invoice is reused instead of reserving another amount.
    const again = json(await req('POST', `/api/pub/links/${l.slug}/pay`, { name: 'علی رضایی', mobile: '09123456789' }, ip(1)));
    assert.strictEqual(again.invoice_id, p.invoice_id);
    assert.strictEqual(again.reused, true);
    const other = json(await req('POST', `/api/pub/links/${l.slug}/pay`, { name: 'سارا', mobile: '09121111111' }, ip(2)));
    assert.notStrictEqual(other.invoice_id, p.invoice_id);
    assert.notStrictEqual(invoice(other.invoice_id).expected_amount, inv.expected_amount);

    const stats = json(await req('GET', `/api/v2/links/${l.id}`, undefined, authA));
    assert.strictEqual(stats.link.stats.invoices, 2);
    assert.strictEqual(stats.link.stats.pending, 2);
    assert.strictEqual(stats.recent_invoices.length, 2);
  });

  test('open and choice links validate the amount', async () => {
    const open = json(await create({ title: 'پرداخت سفارش', amount_mode: 'open', min_amount: 50000, max_amount: 2_000_000, choices: [100000, 200000] })).link;
    const info = json(await req('GET', `/api/pub/links/${open.slug}`));
    assert.strictEqual(info.min_toman, 50000);
    assert.strictEqual(info.max_toman, 2_000_000);
    assert.deepStrictEqual(info.choices.map((c: any) => c.amount_toman), [100000, 200000]);
    assert.strictEqual(json(await req('POST', `/api/pub/links/${open.slug}/pay`, {}, ip(3))).errors.amount, 'مبلغ را وارد کنید');
    assert.match(json(await req('POST', `/api/pub/links/${open.slug}/pay`, { amount: '10000' }, ip(3))).errors.amount, /حداقل/);
    assert.match(json(await req('POST', `/api/pub/links/${open.slug}/pay`, { amount: 5_000_000 }, ip(3))).errors.amount, /حداکثر/);
    assert.ok(json(await req('POST', `/api/pub/links/${open.slug}/pay`, { amount: 'abc' }, ip(3))).errors.amount);
    const ok = await req('POST', `/api/pub/links/${open.slug}/pay`, { amount: '۲۵۰٬۰۰۰' }, ip(3));
    assert.strictEqual(ok.statusCode, 201, ok.body);
    const inv = invoice(json(ok).invoice_id);
    assert.strictEqual(JSON.parse(inv.metadata).base_toman, 250000);
    assert.strictEqual(inv.customer_name, 'پرداخت سفارش');

    const ch = json(await create({ title: 'حمایت', amount_mode: 'choice', choices: [{ amount: 50000, label: 'کوچک' }, { amount: '۱۰۰٬۰۰۰', label: 'بزرگ' }] })).link;
    const ci = json(await req('GET', `/api/pub/links/${ch.slug}`));
    assert.deepStrictEqual(ci.choices, [{ index: 0, label: 'کوچک', price: null, amount_toman: 50000 }, { index: 1, label: 'بزرگ', price: null, amount_toman: 100000 }]);
    assert.ok(json(await req('POST', `/api/pub/links/${ch.slug}/pay`, { choice: 5 }, ip(4))).errors.choice);
    assert.ok(json(await req('POST', `/api/pub/links/${ch.slug}/pay`, {}, ip(4))).errors.choice);
    const paid = json(await req('POST', `/api/pub/links/${ch.slug}/pay`, { choice: 1, note: 'برای تولد' }, ip(4)));
    const md = JSON.parse(invoice(paid.invoice_id).metadata);
    assert.strictEqual(md.base_toman, 100000);
    assert.deepStrictEqual(md.choice, { index: 1, label: 'بزرگ' });
    assert.strictEqual(md.payer.note, undefined); // note field is off on this link
  });

  test('FX link: price converted with the merchant rate; rate stored in invoice metadata', async () => {
    const bad = await req('PUT', '/api/v2/links/fx-rates', { rates: { USD: -5, GBP: 1 } }, authA);
    assert.strictEqual(bad.statusCode, 422);
    assert.ok(json(bad).errors.USD && json(bad).errors.GBP);
    const put = await req('PUT', '/api/v2/links/fx-rates', { rates: { USD: '۱۱۲٬۰۰۰', USDT: 98500.5 } }, authA);
    assert.strictEqual(put.statusCode, 200, put.body);
    const rates = json(await req('GET', '/api/v2/links/fx-rates', undefined, authA));
    assert.strictEqual(rates.data.find((r: any) => r.currency === 'USD').rate_toman, 112000);
    assert.strictEqual(rates.data.find((r: any) => r.currency === 'EUR').rate_toman, null);
    assert.strictEqual(rates.data.find((r: any) => r.currency === 'USD').stale, false);

    const l = json(await create({ title: 'Course', amount_mode: 'fixed', currency: 'USD', amount: '9.99' })).link;
    assert.strictEqual(l.amount, 9.99);
    assert.strictEqual(l.amount_toman, 1118880);
    const info = json(await req('GET', `/api/pub/links/${l.slug}`));
    assert.strictEqual(info.currency, 'USD');
    assert.strictEqual(info.price, 9.99);
    assert.strictEqual(info.amount_toman, 1118880);
    assert.strictEqual(info.fx.rate_toman, 112000);
    const pay = json(await req('POST', `/api/pub/links/${l.slug}/pay`, {}, ip(5)));
    const inv = invoice(pay.invoice_id);
    assert.ok(inv.expected_amount > 11_188_800 && inv.expected_amount < 11_188_800 + 10_000);
    const md = JSON.parse(inv.metadata);
    assert.strictEqual(md.fx.currency, 'USD');
    assert.strictEqual(md.fx.price, 9.99);
    assert.strictEqual(md.fx.rate_toman, 112000);
    assert.strictEqual(md.fx.toman, 1118880);

    // Open FX amounts are typed in the currency (decimals allowed).
    const open = json(await create({ title: 'Tether top-up', amount_mode: 'open', currency: 'USDT', min_amount: 5 })).link;
    const o = json(await req('POST', `/api/pub/links/${open.slug}/pay`, { amount: '۱۰٫۵' }, ip(5)));
    assert.strictEqual(JSON.parse(invoice(o.invoice_id).metadata).fx.toman, Math.ceil(10.5 * 98500.5));

    // A currency without a rate cannot be paid; stale rates are flagged for the merchant.
    const eur = json(await create({ title: 'Euro item', amount_mode: 'fixed', currency: 'EUR', amount: 20 })).link;
    assert.strictEqual(eur.status, 'no_rate');
    const ei = json(await req('GET', `/api/pub/links/${eur.slug}`));
    assert.strictEqual(ei.available, false);
    assert.strictEqual(ei.reason, 'no_rate');
    assert.strictEqual((await req('POST', `/api/pub/links/${eur.slug}/pay`, {}, ip(5))).statusCode, 409);
    d().prepare(`UPDATE link_fx_rates SET updated_at = ? WHERE merchant_id = ? AND currency = 'USD'`).run(Date.now() - 25 * 3600_000, A.id);
    assert.strictEqual(json(await req('GET', '/api/v2/links/fx-rates', undefined, authA)).data.find((r: any) => r.currency === 'USD').stale, true);
    assert.strictEqual(json(await req('GET', `/api/v2/links/${l.id}`, undefined, authA)).link.fx.stale, true);
  });

  test('max_uses, expiry, inactive and archive are enforced', async () => {
    const l = json(await create({ title: 'تک‌نسخه', amount_mode: 'fixed', amount: 300000, max_uses: 1 })).link;
    const first = json(await req('POST', `/api/pub/links/${l.slug}/pay`, {}, ip(6)));
    assert.ok(first.invoice_id);
    const busy = await req('POST', `/api/pub/links/${l.slug}/pay`, {}, ip(7));
    assert.strictEqual(busy.statusCode, 409);
    assert.strictEqual(json(busy).error, 'reserved');
    d().prepare(`UPDATE invoices SET status = 'PAID' WHERE id = ?`).run(first.invoice_id);
    const sold = json(await req('GET', `/api/pub/links/${l.slug}`));
    assert.strictEqual(sold.available, false);
    assert.strictEqual(sold.reason, 'sold_out');
    assert.strictEqual(sold.remaining, 0);
    const lv = json(await req('GET', `/api/v2/links/${l.id}`, undefined, authA)).link;
    assert.strictEqual(lv.status, 'sold_out');
    assert.strictEqual(lv.stats.paid, 1);
    assert.strictEqual(lv.stats.revenue_rial, invoice(first.invoice_id).expected_amount);

    const e = json(await create({ title: 'پیش‌فروش', amount_mode: 'fixed', amount: 100000, expires_at: new Date(Date.now() + 3600_000).toISOString() })).link;
    assert.strictEqual(json(await req('GET', `/api/pub/links/${e.slug}`)).available, true);
    d().prepare('UPDATE link_links SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, e.id);
    assert.strictEqual(json(await req('GET', `/api/pub/links/${e.slug}`)).reason, 'expired');
    assert.strictEqual(json(await req('POST', `/api/pub/links/${e.slug}/pay`, {}, ip(8))).error, 'expired');
    // Editing other fields keeps the (past) expiry instead of failing validation.
    assert.strictEqual((await req('PATCH', `/api/v2/links/${e.id}`, { title: 'پیش‌فروش تمام شد' }, authA)).statusCode, 200);

    const off = json(await create({ title: 'خاموش', amount_mode: 'fixed', amount: 100000 })).link;
    await req('PATCH', `/api/v2/links/${off.id}`, { active: false }, authA);
    assert.strictEqual(json(await req('GET', `/api/pub/links/${off.slug}`)).reason, 'inactive');
    assert.strictEqual((await req('POST', `/api/pub/links/${off.slug}/pay`, {}, ip(8))).statusCode, 409);

    // Deleting a link that has invoices archives it; the public page then 404s and the slug stays reserved.
    const arch = json(await req('DELETE', `/api/v2/links/${l.id}`, undefined, authA));
    assert.strictEqual(arch.archived, true);
    assert.strictEqual((await req('GET', `/api/pub/links/${l.slug}`)).statusCode, 404);
    assert.strictEqual(json(await req('GET', `/api/v2/links/slug-check?slug=${l.slug}`, undefined, authA)).status, 'taken');
    const archived = json(await req('GET', '/api/v2/links?status=archived', undefined, authA));
    assert.deepStrictEqual(archived.data.map((x: any) => x.id), [l.id]);
    assert.ok(!json(await req('GET', '/api/v2/links', undefined, authA)).data.some((x: any) => x.id === l.id));
  });

  test('invoice guards, plan limits, missing card and suspended store', async () => {
    const l = json(await create({ title: 'محافظت', amount_mode: 'fixed', amount: 70000 })).link;
    blockInvoices = true;
    const g = await req('POST', `/api/pub/links/${l.slug}/pay`, {}, ip(9));
    blockInvoices = false;
    assert.strictEqual(g.statusCode, 402);
    assert.strictEqual(json(g).message, 'موجودی کیف پول کافی نیست');

    const active = json(await req('GET', '/api/v2/links', undefined, authA)).summary.active;
    linkLimit = active;
    const lim = await create({ title: 'بیش از سقف', amount_mode: 'fixed', amount: 70000 });
    assert.strictEqual(lim.statusCode, 402);
    assert.strictEqual(json(lim).error, 'plan_limit');
    const inactive = await create({ title: 'پیش‌نویس', amount_mode: 'fixed', amount: 70000, active: false });
    assert.strictEqual(inactive.statusCode, 201);
    assert.strictEqual((await req('PATCH', `/api/v2/links/${json(inactive).link.id}`, { active: true }, authA)).statusCode, 402);
    linkLimit = null;

    const lb = json(await create({ title: 'بدون کارت', amount_mode: 'fixed', amount: 70000 }, authB)).link;
    const ib = json(await req('GET', `/api/pub/links/${lb.slug}`));
    assert.strictEqual(ib.available, false);
    assert.strictEqual(ib.reason, 'unavailable');
    assert.strictEqual((await req('POST', `/api/pub/links/${lb.slug}/pay`, {})).statusCode, 409);
    d().prepare(`UPDATE merchants SET status = 'SUSPENDED' WHERE id = ?`).run(B.id);
    assert.strictEqual(json(await req('GET', `/api/pub/links/${lb.slug}`)).reason, 'inactive');
    d().prepare(`UPDATE merchants SET status = 'ACTIVE' WHERE id = ?`).run(B.id);
    assert.strictEqual((await req('GET', '/api/pub/links/no-such-link-x')).statusCode, 404);
  });

  test('QR SVG and public HTML page with escaped share metadata', async () => {
    const l = json(await create({ title: 'Mug "<b>"', amount_mode: 'fixed', amount: 150000 })).link;
    const qr = await req('GET', `/api/v2/links/${l.id}/qr.svg`, undefined, authA);
    assert.strictEqual(qr.statusCode, 200);
    assert.match(String(qr.headers['content-type']), /image\/svg\+xml/);
    assert.match(qr.body, /^<svg/);
    assert.strictEqual((await req('GET', `/api/v2/links/${l.id}/qr.svg`, undefined, authB)).statusCode, 404);
    const page = await req('GET', `/l/${l.slug}`);
    assert.strictEqual(page.statusCode, 200);
    assert.match(String(page.headers['cache-control']), /no-cache/);
    assert.match(page.body, /og:title" content="Mug &quot;&lt;b&gt;&quot; \| فروشگاه &lt;تست&gt;"/);
    assert.ok(!page.body.includes('<b>"'));
    const unknown = await req('GET', '/l/unknown-slug-zz');
    assert.strictEqual(unknown.statusCode, 200);
    assert.match(unknown.body, /<title>لینک پرداخت \| بولگرام<\/title>/);
  });
});

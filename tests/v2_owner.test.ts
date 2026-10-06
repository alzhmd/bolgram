import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { v2Routes } from '../src/routes/v2.routes.js';
import { dbService } from '../src/db/database.js';
import { CryptoUtil } from '../src/utils/crypto.js';
import { addCard } from '../src/services/store.service.js';
import { saveSettings } from '../src/services/billing.service.js';

const d = () => (dbService as any).db as import('node:sqlite').DatabaseSync;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const luhnCard = (seed: number) => {
  const body = '603799' + String(seed).padStart(9, '0').slice(-9);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let n = Number(body[i]);
    if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return body + ((10 - (sum % 10)) % 10);
};

describe('Owner admin API', () => {
  let app: FastifyInstance;
  const stamp = Date.now() % 1e7;
  let A: any, B: any, P: any, tokenA: string, tokenB: string, owner: any, merchantAuth: any;
  const req = (method: string, url: string, payload?: any, headers: any = owner) => app.inject({ method: method as any, url, payload, headers });
  const json = (r: any) => JSON.parse(r.body);
  const insertInvoice = (id: string, mid: string, amountRial: number, status: string) =>
    d().prepare(`INSERT INTO invoices (id, merchant_id, customer_name, expected_amount, provider, order_id, status, expires_at, created_at) VALUES (?, ?, 'test', ?, 'mellat', ?, ?, ?, datetime('now'))`)
      .run(id, mid, amountRial, id, status, new Date(Date.now() + 3600_000).toISOString());

  before(async () => {
    process.env.ADMIN_EMAIL = 'owner@test.ir';
    process.env.ADMIN_PASSWORD = 'Owner-pass-2026';
    app = Fastify();
    await app.register(v2Routes);
    await app.ready();
    const reg = async (h: string, mob: string) => {
      const r = await req('POST', '/api/v2/auth/register', { handle: h, mobile: mob, password: 'Strong-pass-77', terms: true }, {});
      assert.strictEqual(r.statusCode, 201, r.body);
      return json(r);
    };
    const a = await reg(`owna${stamp}`, `0913${String(stamp).padStart(7, '0')}`);
    const b = await reg(`ownb${stamp}`, `0912${String(stamp).padStart(7, '0')}`);
    const p = await reg(`ownp${stamp}`, `0911${String(stamp).padStart(7, '0')}`);
    A = a.merchant; B = b.merchant; P = p.merchant; tokenA = a.token; tokenB = b.token;
    merchantAuth = { authorization: `Bearer ${tokenA}` };
    owner = { authorization: `Bearer ${CryptoUtil.signJwt({ id: 'admin', email: 'owner@test.ir', role: 'admin' }, undefined, 1)}` };
    d().prepare(`UPDATE merchants SET name = ? WHERE id = ?`).run('فروشگاه آلفا', A.id);
  });
  after(async () => {
    saveSettings({ platform_merchant_id: '' });
    await app.close();
  });

  test('auth: only the platform owner gets in', async () => {
    for (const url of ['/api/owner/overview', '/api/owner/merchants', '/api/owner/audit', '/api/owner/site', '/api/owner/health', '/api/owner/sms-lab/unknown-senders']) {
      assert.strictEqual((await req('GET', url, undefined, {})).statusCode, 401, url + ' without token');
      assert.strictEqual((await req('GET', url, undefined, merchantAuth)).statusCode, 401, url + ' with a merchant token');
    }
    assert.strictEqual((await req('POST', `/api/owner/merchants/${A.id}/suspend`, { reason: 'abc' }, merchantAuth)).statusCode, 401);
    assert.strictEqual((await req('PUT', '/api/owner/site', { footer: 'x' }, merchantAuth)).statusCode, 401);
    assert.strictEqual((await req('POST', '/api/owner/sms-lab', { sender: 'x', body: 'y' }, merchantAuth)).statusCode, 401);
    const bad = await req('POST', '/api/owner/auth/login', { email: 'owner@test.ir', password: 'wrong-pass-1' }, {});
    assert.strictEqual(bad.statusCode, 401);
    const ok = await req('POST', '/api/owner/auth/login', { email: 'owner@test.ir', password: 'Owner-pass-2026' }, {});
    assert.strictEqual(ok.statusCode, 200);
    const t = json(ok).token;
    assert.strictEqual((await req('GET', '/api/owner/overview', undefined, { authorization: `Bearer ${t}` })).statusCode, 200);
  });

  test('overview: numbers follow the seeded invoices; platform store volume is excluded', async () => {
    const before = json(await req('GET', '/api/owner/overview'));
    assert.strictEqual(before.success, true);
    assert.strictEqual(before.daily.length, 30);
    assert.ok(before.daily.every((x: any) => /^\d{4}-\d{2}-\d{2}$/.test(x.day)));
    saveSettings({ platform_merchant_id: P.id });
    insertInvoice(`INVOWN1${stamp}`, A.id, 5_000_000, 'PAID');
    insertInvoice(`INVOWN2${stamp}`, A.id, 2_500_000, 'PAID');
    insertInvoice(`INVOWN3${stamp}`, B.id, 1_000_000, 'PAID');
    insertInvoice(`INVOWN4${stamp}`, B.id, 9_000_000, 'PENDING');
    insertInvoice(`INVOWN5${stamp}`, P.id, 7_000_000, 'PAID'); // platform top-up invoice: not store volume
    d().prepare(`INSERT INTO unmatched_sms (id, device_id, provider, sender, amount, trx_id, raw_sms, status) VALUES (?, 'dev_x', 'mellat', 'S1', 1000, ?, 'x', 'UNMATCHED')`).run(`uo1${stamp}`, `T1${stamp}`);
    const after = json(await req('GET', '/api/owner/overview'));
    assert.strictEqual(after.volume.range_rial - before.volume.range_rial, 8_500_000);
    assert.strictEqual(after.volume.range_count - before.volume.range_count, 3);
    assert.strictEqual(after.volume.today_rial - before.volume.today_rial, 8_500_000);
    assert.ok(after.stores.total >= 3 && after.stores.new_in_range >= 3, 'the three stores registered in before() are counted as new');
    assert.ok(after.stores.active_in_range - before.stores.active_in_range >= 0 && after.stores.active_in_range >= 2);
    assert.strictEqual(after.held_deposits.count - before.held_deposits.count, 1);
    assert.strictEqual(after.daily[after.daily.length - 1].paid_rial - before.daily[before.daily.length - 1].paid_rial, 8_500_000);
    assert.ok(after.top_stores.length >= 1 && after.top_stores.every((s: any) => s.id !== P.id));
    assert.ok('devices' in after && 'tickets' in after && 'trust_pending' in after && 'revenue' in after);
    assert.strictEqual(after.top_stores[0].paid_rial >= after.top_stores[after.top_stores.length - 1].paid_rial, true);

    const three = json(await req('GET', '/api/owner/overview?from=2026-01-01&to=2026-01-03'));
    assert.strictEqual(three.daily.length, 3);
    assert.strictEqual(three.volume.range_rial, 0);
    assert.strictEqual((await req('GET', '/api/owner/overview?from=2026-03-01&to=2026-01-01')).statusCode, 422);
    assert.strictEqual((await req('GET', '/api/owner/overview?from=2020-01-01&to=2026-01-01')).statusCode, 422);
    assert.strictEqual((await req('GET', '/api/owner/overview?from=garbage')).statusCode, 422);
  });

  test('stores: list filters, detail never leaks card numbers or secrets', async () => {
    addCard(A.id, { number: luhnCard(stamp), holder: 'علی رضایی' });
    const list = json(await req('GET', `/api/owner/merchants?q=owna${stamp}`));
    assert.strictEqual(list.total, 1);
    const row = list.data[0];
    assert.strictEqual(row.id, A.id);
    assert.strictEqual(row.paid_30d_rial, 7_500_000);
    assert.strictEqual(row.paid_30d_count, 2);
    assert.strictEqual(row.cards_count, 1);
    assert.strictEqual(row.status, 'ACTIVE');
    assert.ok('wallet_balance_rial' in row && 'devices_online' in row && row.mobile);
    assert.strictEqual(json(await req('GET', `/api/owner/merchants?q=${A.mobile || '0913' + String(stamp).padStart(7, '0')}`)).total, 1);
    assert.strictEqual(json(await req('GET', `/api/owner/merchants?q=ownb${stamp}&status=SUSPENDED`)).total, 0);
    assert.strictEqual(json(await req('GET', `/api/owner/merchants?q=${A.id}`)).total, 1);
    assert.strictEqual(json(await req('GET', '/api/owner/merchants?q=%25')).total, 0); // LIKE wildcards are escaped

    const detail = await req('GET', `/api/owner/merchants/${A.id}`);
    assert.strictEqual(detail.statusCode, 200);
    const dj = json(detail);
    assert.strictEqual(dj.profile.handle, `owna${stamp}`);
    assert.strictEqual(dj.stats.paid_30d_rial, 7_500_000);
    assert.strictEqual(dj.stats.invoices_total, 2);
    assert.strictEqual(dj.cards.length, 1);
    assert.match(dj.cards[0].last4, /^\d{4}$/);
    assert.strictEqual(dj.cards[0].last4, luhnCard(stamp).slice(-4));
    assert.ok(dj.recent_invoices.length === 2 && 'team_count' in dj && 'bot_links_count' in dj && 'trust' in dj && Array.isArray(dj.devices));
    const raw = detail.body;
    assert.ok(!raw.includes(luhnCard(stamp)), 'full card number leaked');
    for (const k of ['password_hash', 'api_key', 'account_number', 'card_hash']) assert.ok(!raw.includes(k), `${k} leaked`);
    assert.strictEqual((await req('GET', '/api/owner/merchants/m_does_not_exist')).statusCode, 404);
  });

  test('suspend refuses login and sessions, activate restores, revoke-sessions signs out, all audited', async () => {
    const mobile = `0912${String(stamp).padStart(7, '0')}`;
    assert.strictEqual((await req('GET', '/api/v2/me', undefined, { authorization: `Bearer ${tokenB}` })).statusCode, 200);

    const noReason = await req('POST', `/api/owner/merchants/${B.id}/suspend`, {});
    assert.strictEqual(noReason.statusCode, 422);
    assert.ok(json(noReason).errors.reason);
    assert.strictEqual((await req('POST', '/api/owner/merchants/m_nope/suspend', { reason: 'تست تعلیق' })).statusCode, 404);

    const s = await req('POST', `/api/owner/merchants/${B.id}/suspend`, { reason: 'گزارش تخلف' });
    assert.strictEqual(s.statusCode, 200, s.body);
    assert.strictEqual((d().prepare('SELECT status FROM merchants WHERE id = ?').get(B.id) as any).status, 'SUSPENDED');
    assert.strictEqual((await req('POST', `/api/owner/merchants/${B.id}/suspend`, { reason: 'دوباره' })).statusCode, 409);
    const login = await req('POST', '/api/v2/auth/login', { mobile, password: 'Strong-pass-77' }, {});
    assert.strictEqual(login.statusCode, 401, login.body);
    assert.strictEqual((await req('GET', '/api/v2/me', undefined, { authorization: `Bearer ${tokenB}` })).statusCode, 401, 'old session must be dead');
    const detail = json(await req('GET', `/api/owner/merchants/${B.id}`));
    assert.strictEqual(detail.profile.status, 'SUSPENDED');
    assert.strictEqual(detail.profile.suspended_reason, 'گزارش تخلف');
    assert.strictEqual(json(await req('GET', `/api/owner/merchants?q=ownb${stamp}&status=SUSPENDED`)).total, 1);

    assert.strictEqual((await req('POST', `/api/owner/merchants/${B.id}/activate`)).statusCode, 200);
    assert.strictEqual((await req('POST', `/api/owner/merchants/${B.id}/activate`)).statusCode, 409);
    const back = await req('POST', '/api/v2/auth/login', { mobile, password: 'Strong-pass-77' }, {});
    assert.strictEqual(back.statusCode, 200, back.body);
    const fresh = json(back).token;
    assert.strictEqual((await req('GET', '/api/v2/me', undefined, { authorization: `Bearer ${fresh}` })).statusCode, 200);

    assert.strictEqual((await req('POST', `/api/owner/merchants/${B.id}/revoke-sessions`)).statusCode, 200);
    assert.strictEqual((await req('GET', '/api/v2/me', undefined, { authorization: `Bearer ${fresh}` })).statusCode, 401, 'revoked session must be dead');
    assert.strictEqual((await req('POST', '/api/owner/merchants/m_nope/revoke-sessions')).statusCode, 404);
    assert.strictEqual((await req('POST', '/api/v2/auth/login', { mobile, password: 'Strong-pass-77' }, {})).statusCode, 200, 'logging in again still works');

    const log = json(await req('GET', `/api/owner/audit?merchant_id=${B.id}&action=owner.`));
    const actions = log.data.map((x: any) => x.action);
    for (const a of ['owner.suspend', 'owner.activate', 'owner.revoke_sessions']) assert.ok(actions.includes(a), a);
    assert.ok(log.data.every((x: any) => x.merchant_id === B.id && x.created_at));
    assert.strictEqual(log.data.find((x: any) => x.action === 'owner.suspend').meta.reason, 'گزارش تخلف');
    assert.ok(log.actions.some((x: any) => x.action === 'owner.suspend'));
    const exact = json(await req('GET', `/api/owner/audit?action=owner.suspend&per_page=1`));
    assert.strictEqual(exact.per_page, 1);
    assert.ok(exact.total >= 1);
  });

  test('site content: validation, logo upload, public endpoint with CORS and cache', async () => {
    const empty = json(await req('GET', '/api/owner/site'));
    assert.ok(empty.site.hero && empty.site.announcement && empty.site.contact && Array.isArray(empty.site.faq));

    const bad = await req('PUT', '/api/owner/site', {
      hero: { title: 'ع'.repeat(121), subtitle: 'ok' },
      announcement: { text: '', href: 'javascript:alert(1)', active: true },
      contact: { phone: 'abc', email: 'not-an-email', telegram: 'ab', instagram: 'https://evil.example/x', address: '' },
      faq: [{ q: 'ab', a: '' }],
      footer: 'ف'.repeat(301),
      logo_data_url: 'data:image/svg+xml;base64,PHN2Zy8+',
    });
    assert.strictEqual(bad.statusCode, 422);
    const errs = json(bad).errors;
    for (const k of ['hero.title', 'announcement.text', 'announcement.href', 'contact.phone', 'contact.email', 'contact.telegram', 'contact.instagram', 'faq.0.q', 'faq.0.a', 'footer', 'logo_data_url']) assert.ok(errs[k], `missing error for ${k}`);
    assert.strictEqual((await req('PUT', '/api/owner/site', { faq: new Array(31).fill({ q: 'سؤال ۱', a: 'پاسخ ۱' }) })).statusCode, 422);
    assert.strictEqual((await req('PUT', '/api/owner/site', { announcement: { text: 'x', href: 'http://insecure.example', active: true } })).statusCode, 422);

    const put = await req('PUT', '/api/owner/site', {
      hero: { title: 'پرداخت کارت‌به‌کارت خودکار', subtitle: 'بدون درگاه بانکی' },
      announcement: { text: 'تخفیف ویژهٔ پلن‌ها', href: '/pricing.html', active: true },
      contact: { phone: '۰۲۱-۱۲۳۴۵۶۷۸', email: 'Support@Bolgram.ir', telegram: '@bolgram_support', instagram: 'bolgram.ir', address: 'تهران' },
      faq: [{ q: 'آیا پول از حساب شما رد می‌شود؟', a: 'خیر، مستقیم به کارت فروشنده می‌نشیند.' }, { q: '', a: '' }],
      footer: 'بولگرام',
      logo_data_url: PNG,
    });
    assert.strictEqual(put.statusCode, 200, put.body);
    const saved = json(put).site;
    assert.match(saved.logo_url, /^\/uploads\/[a-f0-9]{24}\.png$/);
    assert.strictEqual(saved.contact.email, 'support@bolgram.ir');
    assert.strictEqual(saved.contact.phone, '021-12345678');
    assert.strictEqual(saved.contact.telegram, 'https://t.me/bolgram_support');
    assert.strictEqual(saved.contact.instagram, 'https://instagram.com/bolgram.ir');
    assert.strictEqual(saved.faq.length, 1, 'empty FAQ rows are dropped');
    const logoGet = await app.inject({ method: 'GET', url: saved.logo_url }).catch(() => null);
    void logoGet; // /uploads is served by the main server, not this plugin

    const pub = await req('GET', '/api/pub/site', undefined, {});
    assert.strictEqual(pub.statusCode, 200);
    assert.strictEqual(pub.headers['access-control-allow-origin'], '*');
    assert.match(String(pub.headers['cache-control']), /max-age=60/);
    const site = json(pub).site;
    assert.strictEqual(site.hero.title, 'پرداخت کارت‌به‌کارت خودکار');
    assert.deepStrictEqual(site.announcement, { text: 'تخفیف ویژهٔ پلن‌ها', href: '/pricing.html' });
    assert.match(site.logo_url, /^https?:\/\/.+\/uploads\/[a-f0-9]{24}\.png$/);
    assert.strictEqual(site.faq[0].q, 'آیا پول از حساب شما رد می‌شود؟');
    assert.ok(!('active' in site.announcement));

    // a partial update keeps the rest; an inactive banner disappears from the public payload
    const off = await req('PUT', '/api/owner/site', { announcement: { active: false } });
    assert.strictEqual(off.statusCode, 200);
    assert.strictEqual(json(off).site.announcement.text, 'تخفیف ویژهٔ پلن‌ها');
    assert.strictEqual(json(await req('GET', '/api/pub/site', undefined, {})).site.announcement, null);
    assert.strictEqual(json(await req('GET', '/api/pub/site', undefined, {})).site.hero.title, 'پرداخت کارت‌به‌کارت خودکار');

    const rm = await req('PUT', '/api/owner/site', { remove_logo: true });
    assert.strictEqual(json(rm).site.logo_url, null);
    assert.strictEqual(json(await req('GET', '/api/pub/site', undefined, {})).site.logo_url, null);
    const audited = json(await req('GET', '/api/owner/audit?action=owner.site'));
    assert.ok(audited.total >= 3);
  });

  test('sms lab: parses a real bank SMS, explains debits and junk, 422 on missing input', async () => {
    const ok = await req('POST', '/api/owner/sms-lab', { sender: 'Bank Mellat', body: 'حساب1848394556\nواریز31,500,000\nمانده31,894,014\n05/06/28-13:57' });
    assert.strictEqual(ok.statusCode, 200, ok.body);
    const j = json(ok);
    assert.strictEqual(j.parsed.success, true);
    assert.strictEqual(j.parsed.provider, 'mellat');
    assert.strictEqual(j.parsed.amount_rial, 31_500_000);
    assert.strictEqual(j.parsed.balance_rial, 31_894_014);
    assert.ok(j.parsed.trx_id);
    assert.strictEqual(j.detail.direction, 'credit');
    assert.strictEqual(j.detail.template_id, 'mellat-v1');
    assert.strictEqual(j.bank.id, 'mellat');
    assert.ok(j.bank.name_fa && j.bank.color);
    assert.ok(j.verdict.includes('واریز'));

    const debit = json(await req('POST', '/api/owner/sms-lab', { sender: '+98700717', body: 'بانك ملي ايران\nبرداشت:500,000-\nحساب:10000\nمانده:23,488,359\n0705-20:46' }));
    assert.strictEqual(debit.parsed.success, false);
    assert.strictEqual(debit.detail.direction, 'debit');
    assert.ok(debit.verdict.includes('برداشت'));
    const junk = json(await req('POST', '/api/owner/sms-lab', { sender: 'Promo', body: 'سلام، تخفیف ویژهٔ شب یلدا' }));
    assert.strictEqual(junk.parsed.success, false);
    assert.strictEqual(junk.bank, null);
    const otp = json(await req('POST', '/api/owner/sms-lab', { sender: 'Bank Mellat', body: 'رمز پویا: 123456 کد تأیید خرید' }));
    assert.strictEqual(otp.parsed.success, false);
    assert.ok(!JSON.stringify(otp).includes('123456') || otp.detail.kind !== 'transaction');

    const r422 = await req('POST', '/api/owner/sms-lab', { sender: '', body: '' });
    assert.strictEqual(r422.statusCode, 422);
    assert.ok(json(r422).errors.sender && json(r422).errors.body);
  });

  test('sms lab: unknown senders are grouped with counts and a sample', async () => {
    const ins = d().prepare(`INSERT INTO unmatched_sms (id, device_id, provider, sender, amount, trx_id, raw_sms, status) VALUES (?, ?, 'UNKNOWN', ?, 1000, ?, ?, ?)`);
    const sample = 'حساب1848394556\nواریز1,000,000\nمانده2,000,000\n05/06/28-13:57';
    ins.run(`uk1${stamp}`, 'dev_a', `NEWBANK${stamp}`, `K1${stamp}`, sample, 'SUSPICIOUS');
    ins.run(`uk2${stamp}`, 'dev_b', `NEWBANK${stamp}`, `K2${stamp}`, sample, 'SUSPICIOUS');
    ins.run(`uk3${stamp}`, 'dev_a', `OTHER${stamp}`, `K3${stamp}`, 'x', 'SUSPICIOUS');
    ins.run(`uk4${stamp}`, 'dev_a', `NOTSUSP${stamp}`, `K4${stamp}`, 'x', 'ASSIGNED');
    const r = json(await req('GET', '/api/owner/sms-lab/unknown-senders'));
    assert.strictEqual(r.success, true);
    const g = r.data.find((x: any) => x.sender === `NEWBANK${stamp}`);
    assert.ok(g, 'group present');
    assert.strictEqual(g.count, 2);
    assert.strictEqual(g.devices, 2);
    assert.strictEqual(g.sample, sample);
    assert.ok(g.last_at);
    assert.ok(r.data.find((x: any) => x.sender === `OTHER${stamp}`));
    assert.ok(!r.data.find((x: any) => x.sender === `NOTSUSP${stamp}`), 'only suspicious rows count');
  });

  test('health: every check has an id, a level and a Persian explanation', async () => {
    const r = json(await req('GET', '/api/owner/health'));
    assert.strictEqual(r.success, true);
    assert.ok(['ok', 'warn', 'error'].includes(r.overall));
    const ids = r.checks.map((c: any) => c.id);
    for (const id of ['jwt_secret', 'node_env', 'public_base_url', 'smsir', 'bots', 'card_enc_key', 'platform_store', 'db', 'uptime', 'node', 'devices', 'webhooks']) assert.ok(ids.includes(id), id);
    for (const c of r.checks) {
      assert.ok(['ok', 'warn', 'error'].includes(c.status), c.id);
      assert.ok(c.label && /[؀-ۿ]/.test(c.detail), `${c.id} needs a Persian detail`);
    }
    assert.ok(r.server.uptime_seconds >= 0 && r.server.node === process.version && r.server.db_size_bytes >= 0);
    assert.strictEqual(r.checks.find((c: any) => c.id === 'platform_store').status, 'warn', 'platform store has no active card in this test');
  });
});

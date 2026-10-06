import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import Fastify, { FastifyInstance } from 'fastify';

process.env.UPLOAD_DIR = path.join(process.env.TMPDIR || os.tmpdir(), `bolgram-int-uploads-${process.pid}`);
const { v2Routes } = await import('../src/routes/v2.routes.js');
const { paymentRoutes } = await import('../src/routes/payment.routes.js');
const { dbService } = await import('../src/db/database.js');
const { events } = await import('../src/services/events.js');
const { CryptoUtil } = await import('../src/utils/crypto.js');
const { processDueRetries, validateWebhookUrl, isPrivateAddress } = await import('../src/services/webhook.service.js');
const { MerchantService } = await import('../src/services/merchant.service.js');
const { issueToken } = await import('../src/routes/v2.routes.js');

const sql = () => (dbService as any).db as import('node:sqlite').DatabaseSync;
const PW = 'Strong-pass-77';

describe('Integrations: webhooks, API keys, plugins, settings, checkout brand', () => {
  let app: FastifyInstance;
  let token = '';
  let mid = '';
  let mobile = '';
  const handle = `int${Date.now() % 1e8}`;
  const auth = (t = token) => ({ authorization: `Bearer ${t}` });
  const call = async (method: string, url: string, payload?: any, t = token) => {
    const r = await app.inject({ method: method as any, url, payload, headers: auth(t) });
    let json: any = null;
    try { json = JSON.parse(r.body); } catch { /* binary */ }
    return { status: r.statusCode, json, res: r };
  };

  // local webhook receiver
  const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  let respondWith = 500;
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { received.push({ headers: req.headers, body }); res.statusCode = respondWith; res.end(respondWith === 200 ? 'ok' : 'boom'); });
  });
  let hookUrl = '';
  const waitFor = async (fn: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 25)); };

  before(async () => {
    await new Promise<void>((ok) => receiver.listen(0, '127.0.0.1', ok));
    hookUrl = `http://127.0.0.1:${(receiver.address() as any).port}/hook`;
    app = Fastify();
    await app.register(v2Routes);
    await app.register(paymentRoutes);
    await app.ready();
    mobile = `0913${String(Date.now() % 1e7).padStart(7, '0')}`;
    const reg = await app.inject({ method: 'POST', url: '/api/v2/auth/register', payload: { handle, mobile, password: PW, terms: true } });
    assert.strictEqual(reg.statusCode, 201, reg.body);
    token = JSON.parse(reg.body).token;
    mid = JSON.parse(reg.body).merchant.id;
  });
  after(async () => { await app.close(); receiver.close(); });

  test('SSRF guard: https required, private targets refused in production, localhost only in dev', async () => {
    for (const bad of ['https://127.0.0.1/h', 'https://10.1.2.3/h', 'https://192.168.1.5/h', 'https://169.254.169.254/latest', 'https://[::1]/h', 'https://localhost/h', 'https://[::ffff:10.0.0.1]/h', 'http://example.com/h', 'https://user:pw@example.com/h', 'https://intranet/h', 'https://db.internal/h', 'ftp://example.com/h']) {
      assert.strictEqual(validateWebhookUrl(bad, { production: true }).ok, false, bad);
    }
    assert.strictEqual(validateWebhookUrl('https://shop.example.com/hooks/bolgram', { production: true }).ok, true);
    assert.strictEqual(validateWebhookUrl('http://localhost:3000/hook', { production: false }).ok, true);
    assert.strictEqual(validateWebhookUrl('http://example.com/hook', { production: false }).ok, false);
    assert.ok(isPrivateAddress('100.64.0.1') && isPrivateAddress('fe80::1') && isPrivateAddress('fd00::1') && !isPrivateAddress('8.8.8.8'));
    const r = await call('PUT', '/api/v2/webhooks/settings', { webhook_url: 'http://example.com/hook' });
    assert.strictEqual(r.status, 422);
    assert.ok(r.json.errors.webhook_url);
  });

  test('webhook settings, signed delivery, delivery log and persistent retry', async () => {
    assert.strictEqual((await call('PUT', '/api/v2/webhooks/settings', { webhook_url: hookUrl })).status, 200);
    const s = (await call('GET', '/api/v2/webhooks/settings')).json;
    assert.strictEqual(s.webhook_url, hookUrl);
    assert.strictEqual(s.secret.kind, 'derived');
    assert.match(s.secret.masked, /^whsec_/);
    assert.ok(!s.secret.masked.includes((await call('GET', '/api/v2/webhooks/secret')).json.secret));

    // paid invoice → store-level webhook; receiver fails first
    respondWith = 500;
    received.length = 0;
    events.emit('invoice.paid', { merchantId: mid, invoiceId: 'INV_RETRY1', amount: 1234560, provider: 'mellat', trxId: 'TRX9', source: 'auto' });
    await waitFor(() => received.length >= 1);
    await waitFor(() => (sql().prepare('SELECT count(*) c FROM webhook_deliveries WHERE merchant_id = ?').get(mid) as any).c >= 1);
    const first = received[0];
    const secret = (await call('GET', '/api/v2/webhooks/secret')).json.secret;
    const sig = String(first.headers['x-bolgram-signature']);
    const t = /t=(\d+)/.exec(sig)![1];
    const expected = crypto.createHmac('sha256', secret).update(`${t}.${first.body}`).digest('hex');
    assert.ok(sig.includes(`v1=${expected}`), 'signature over t.body');
    assert.strictEqual(first.headers['x-bolgram-invoice-id'], 'INV_RETRY1');
    assert.ok(first.headers['x-bolgram-delivery']);
    const payload = JSON.parse(first.body);
    assert.strictEqual(payload.event, 'invoice.paid');
    assert.strictEqual(payload.invoice_id, 'INV_RETRY1');
    assert.strictEqual(payload.amount, 1234560);

    const list1 = (await call('GET', '/api/v2/webhooks/deliveries')).json;
    assert.strictEqual(list1.total, 1);
    assert.strictEqual(list1.data[0].status, 'retrying');
    assert.strictEqual(list1.data[0].http_status, 500);
    assert.strictEqual(list1.data[0].attempt, 1);
    const wait = new Date(list1.data[0].next_retry_at).getTime() - Date.now();
    assert.ok(wait > 50_000 && wait <= 61_000, `first retry in about a minute, got ${wait}`);
    assert.strictEqual((await call('GET', '/api/v2/webhooks/deliveries?status=pending')).json.total, 1);

    // restart-proof: the schedule lives in the DB; make it due and run the worker
    respondWith = 200;
    sql().prepare('UPDATE webhook_deliveries SET next_retry_at = ? WHERE merchant_id = ? AND next_retry_at IS NOT NULL').run(Date.now() - 1, mid);
    assert.strictEqual(await processDueRetries(), 1);
    assert.strictEqual(received.length, 2);
    assert.strictEqual(received[1].headers['x-bolgram-delivery'], first.headers['x-bolgram-delivery']);
    assert.strictEqual(received[1].body, first.body);
    const list2 = (await call('GET', '/api/v2/webhooks/deliveries')).json;
    assert.strictEqual(list2.total, 2);
    assert.strictEqual(list2.data[0].status, 'delivered');
    assert.strictEqual(list2.data[0].attempt, 2);
    assert.strictEqual((await call('GET', '/api/v2/webhooks/deliveries?status=pending')).json.total, 0);
    const detail = (await call('GET', `/api/v2/webhooks/deliveries/${list2.data[0].id}`)).json;
    assert.strictEqual(detail.attempts.length, 2);
    assert.strictEqual(JSON.parse(detail.delivery.request_body).invoice_id, 'INV_RETRY1');
    assert.ok(detail.delivery.request_headers['X-Bolgram-Signature']);
    assert.strictEqual((await call('GET', '/api/v2/webhooks/deliveries/wd_missing')).status, 404);

    // schedule exhausts after the last allowed attempt
    sql().prepare('INSERT INTO webhook_deliveries (id, delivery_id, merchant_id, event, invoice_id, url, kind, request_body, status, attempt, max_attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('wd_last', 'dl_last', mid, 'invoice.paid', 'INV_LAST', hookUrl, 'store', '{"invoice_id":"INV_LAST"}', 'FAILED', 5, 6, Date.now());
    sql().prepare('UPDATE webhook_deliveries SET next_retry_at = ? WHERE id = ?').run(Date.now() - 1, 'wd_last');
    respondWith = 500;
    await processDueRetries();
    const last = sql().prepare('SELECT * FROM webhook_deliveries WHERE delivery_id = ? AND attempt = 6').get('dl_last') as any;
    assert.strictEqual(last.status, 'FAILED');
    assert.strictEqual(last.next_retry_at, null, 'no 7th attempt');
  });

  test('test ping and manual resend', async () => {
    respondWith = 200;
    received.length = 0;
    const ping = await call('POST', '/api/v2/webhooks/test');
    assert.strictEqual(ping.status, 200);
    assert.strictEqual(ping.json.ok, true);
    assert.strictEqual(ping.json.delivery.event, 'ping');
    assert.strictEqual(JSON.parse(received[0].body).status, 'false', 'a ping never looks like a payment');
    respondWith = 500;
    const failedPing = await call('POST', '/api/v2/webhooks/test');
    assert.strictEqual(failedPing.json.ok, false);
    assert.strictEqual(failedPing.json.delivery.status, 'failed');
    assert.strictEqual(failedPing.json.delivery.next_retry_at, null, 'pings are not retried');
    respondWith = 200;
    const resend = await call('POST', `/api/v2/webhooks/deliveries/${failedPing.json.delivery.id}/resend`);
    assert.strictEqual(resend.json.ok, true);
    assert.strictEqual(resend.json.delivery.kind, 'resend');
    assert.notStrictEqual(resend.json.delivery.delivery_id, failedPing.json.delivery.delivery_id);
    assert.strictEqual((await call('POST', '/api/v2/webhooks/deliveries/wd_nope/resend')).status, 404);
  });

  test('rotate secret: new secret signs, previous stays valid for 24h as a second signature', async () => {
    const before = (await call('GET', '/api/v2/webhooks/secret')).json;
    const rot = (await call('POST', '/api/v2/webhooks/rotate-secret')).json;
    assert.ok(rot.secret.startsWith('whsec_') && rot.secret !== before.secret);
    const left = new Date(rot.previous_valid_until).getTime() - Date.now();
    assert.ok(left > 23 * 3600_000 && left <= 24 * 3600_000);
    const s = (await call('GET', '/api/v2/webhooks/settings')).json;
    assert.strictEqual(s.secret.kind, 'custom');
    assert.ok(s.secret.previous_valid_until);
    assert.strictEqual((await call('GET', '/api/v2/webhooks/secret')).json.previous_secret, before.secret);
    respondWith = 200;
    received.length = 0;
    await call('POST', '/api/v2/webhooks/test');
    const sig = String(received[0].headers['x-bolgram-signature']);
    const t = /t=(\d+)/.exec(sig)![1];
    const mac = (k: string) => crypto.createHmac('sha256', k).update(`${t}.${received[0].body}`).digest('hex');
    assert.strictEqual([...sig.matchAll(/v1=([0-9a-f]+)/g)].length, 2);
    assert.ok(sig.includes(`v1=${mac(rot.secret)}`) && sig.includes(`v1=${mac(before.secret)}`));
    // after the grace period only the new one is used
    sql().prepare('UPDATE merchants SET webhook_secret_prev_until = ? WHERE id = ?').run(Date.now() - 1, mid);
    received.length = 0;
    await call('POST', '/api/v2/webhooks/test');
    assert.strictEqual([...String(received[0].headers['x-bolgram-signature']).matchAll(/v1=/g)].length, 1);
  });

  test('API keys: created once, stored hashed, authenticate, record last_used, revoke', async () => {
    assert.strictEqual((await call('POST', '/api/v2/api-keys', { name: 'x' })).status, 422);
    const created = await call('POST', '/api/v2/api-keys', { name: 'سایت اصلی', environment: 'test' });
    assert.strictEqual(created.status, 201);
    const secret: string = created.json.secret;
    assert.match(secret, /^test_sk_[0-9a-f]{48}$/);
    const row = sql().prepare('SELECT * FROM integration_api_keys WHERE id = ?').get(created.json.key.id) as any;
    assert.strictEqual(row.key_hash, crypto.createHash('sha256').update(secret).digest('hex'));
    assert.ok(!Object.values(row).some((v) => String(v) === secret), 'secret never stored');
    assert.strictEqual(row.prefix, secret.slice(0, 12));
    const list = (await call('GET', '/api/v2/api-keys')).json;
    assert.ok(!JSON.stringify(list).includes(secret));
    const item = list.data.find((k: any) => k.id === row.id);
    assert.strictEqual(item.environment, 'test');
    assert.strictEqual(item.last_used_at, null);

    const verify = (key: string) => app.inject({ method: 'POST', url: '/api/v1/payment/verify', headers: { 'x-api-key': key }, payload: { invoice_id: 'NOPE' } });
    assert.strictEqual((await verify(secret)).statusCode, 404, 'authenticated, invoice unknown');
    assert.ok(((await call('GET', '/api/v2/api-keys')).json.data.find((k: any) => k.id === row.id)).last_used_at);
    assert.strictEqual((await verify(secret + 'x')).statusCode, 401);
    assert.strictEqual((await app.inject({ method: 'POST', url: '/api/v1/payment/verify', headers: { authorization: `Bearer ${secret}` }, payload: { invoice_id: 'NOPE' } })).statusCode, 404);
    const usage = sql().prepare('SELECT sum(calls) c FROM api_usage_daily WHERE merchant_id = ?').get(mid) as any;
    assert.ok(usage.c >= 2);

    assert.strictEqual((await call('DELETE', `/api/v2/api-keys/${row.id}`)).status, 200);
    assert.strictEqual((await verify(secret)).statusCode, 401, 'revoked key is refused');
    assert.strictEqual((await call('DELETE', `/api/v2/api-keys/${row.id}`)).status, 404);
  });

  test('legacy merchants.api_key keeps working; can be rotated and revoked', async () => {
    const legacy = (sql().prepare('SELECT api_key FROM merchants WHERE id = ?').get(mid) as any).api_key;
    const list = (await call('GET', '/api/v2/api-keys')).json;
    assert.ok(list.legacy && list.legacy.masked.startsWith(legacy.slice(0, 8)) && !list.legacy.masked.includes(legacy.slice(-6)));
    const ok = await MerchantService.authenticateApiKey(legacy);
    assert.strictEqual(ok.authenticated, true);
    assert.ok((sql().prepare('SELECT api_key_last_used t FROM merchants WHERE id = ?').get(mid) as any).t);
    assert.strictEqual((await call('GET', '/api/v2/api-keys/legacy/reveal')).json.key, legacy);
    const rot = (await call('POST', '/api/v2/api-keys/legacy/rotate')).json;
    assert.notStrictEqual(rot.key, legacy);
    assert.strictEqual((await MerchantService.authenticateApiKey(legacy)).authenticated, false);
    assert.strictEqual((await MerchantService.authenticateApiKey(rot.key)).authenticated, true);
    assert.strictEqual((await call('DELETE', '/api/v2/api-keys/legacy')).status, 200);
    assert.strictEqual((await MerchantService.authenticateApiKey(rot.key)).authenticated, false);
    assert.strictEqual((await call('GET', '/api/v2/api-keys')).json.legacy, null);
  });

  test('v1 create: toman currency, metadata kept, verify exposes it; brand endpoint reflects store profile', async () => {
    const key = (await call('POST', '/api/v2/api-keys', { name: 'woo', environment: 'live' })).json.secret;
    const bad = await app.inject({ method: 'POST', url: '/api/v1/payment/create', headers: { 'x-api-key': key }, payload: { amount: 1000, redirect_url: 'javascript:alert(1)' } });
    assert.strictEqual(bad.statusCode, 400);
    const ssrf = await app.inject({ method: 'POST', url: '/api/v1/payment/create', headers: { 'x-api-key': key }, payload: { amount: 1000, redirect_url: 'https://shop.example/thanks', webhook_url: 'http://example.com/h' } });
    assert.strictEqual(ssrf.statusCode, 400);
    const res = await app.inject({
      method: 'POST', url: '/api/v1/payment/create', headers: { 'x-api-key': key },
      payload: { amount: 50000, currency: 'IRT', redirect_url: 'https://shop.example/thanks', cancel_url: 'https://shop.example/cart', metadata: { order_id: '1042' } },
    });
    assert.strictEqual(res.statusCode, 201, res.body);
    const created = JSON.parse(res.body);
    assert.ok(created.amount >= 500000 && created.amount < 500000 + 1000, 'rial amount = toman x 10 plus unique tail');
    assert.strictEqual(created.amount_toman, Math.round(created.amount / 10));
    assert.strictEqual(created.invoice_status, 'PENDING');
    const ver = JSON.parse((await app.inject({ method: 'POST', url: '/api/v1/payment/verify', headers: { 'x-api-key': key }, payload: { invoice_id: created.invoice_id } })).body);
    assert.deepStrictEqual(ver.metadata, { order_id: '1042' });
    assert.strictEqual(ver.invoice_status, 'PENDING');
    assert.strictEqual(ver.paid, false);

    // public invoice endpoint leaks no merchant internals
    const pub = JSON.parse((await app.inject({ method: 'GET', url: `/api/v1/payments/invoice/${created.invoice_id}` })).body);
    assert.ok(!('merchant_id' in pub.invoice) && !('webhook_url' in pub.invoice));

    // profile → brand
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const put = await call('PUT', '/api/v2/settings/profile', { name: 'فروشگاه نمونه', support_phone: '۰۹۱۲۳۴۵۶۷۸۹', support_telegram: '@my_shop', support_instagram: 'https://instagram.com/my.shop/', website: 'myshop.ir', logo_data_url: png });
    assert.strictEqual(put.status, 200, JSON.stringify(put.json));
    const brand = JSON.parse((await app.inject({ method: 'GET', url: `/api/pub/checkout/${created.invoice_id}/brand` })).body);
    assert.strictEqual(brand.store.name, 'فروشگاه نمونه');
    assert.match(brand.store.logo_url, /^\/uploads\/[a-f0-9]{24}\.png$/);
    assert.strictEqual(brand.store.support_phone, '09123456789');
    assert.strictEqual(brand.store.support_telegram, 'my_shop');
    assert.strictEqual(brand.store.support_instagram, 'my.shop');
    assert.strictEqual(brand.store.website, 'https://myshop.ir/');
    assert.strictEqual(brand.invoice.status, 'PENDING');
    assert.strictEqual(brand.invoice.cancel_url, 'https://shop.example/cart');
    assert.ok(!JSON.stringify(brand).includes(mid), 'no merchant id on a public endpoint');
    assert.strictEqual((await app.inject({ method: 'GET', url: '/api/pub/checkout/NOPE/brand' })).statusCode, 404);

    // final states
    sql().prepare(`UPDATE invoices SET expires_at = ? WHERE id = ?`).run(new Date(Date.now() - 1000).toISOString(), created.invoice_id);
    assert.strictEqual(JSON.parse((await app.inject({ method: 'GET', url: `/api/pub/checkout/${created.invoice_id}/brand` })).body).invoice.status, 'EXPIRED');
    sql().prepare(`UPDATE invoices SET status = 'CANCELLED' WHERE id = ?`).run(created.invoice_id);
    assert.strictEqual(JSON.parse((await app.inject({ method: 'GET', url: `/api/pub/checkout/${created.invoice_id}/brand` })).body).invoice.status, 'CANCELLED');
    sql().prepare(`UPDATE invoices SET status = 'PAID', trx_id = 'BANK123' WHERE id = ?`).run(created.invoice_id);
    events.emit('invoice.paid', { merchantId: mid, invoiceId: created.invoice_id, amount: created.amount, provider: 'mellat', trxId: 'BANK123', source: 'auto' });
    await events.settle();
    const paid = JSON.parse((await app.inject({ method: 'GET', url: `/api/pub/checkout/${created.invoice_id}/brand` })).body).invoice;
    assert.strictEqual(paid.status, 'PAID');
    assert.strictEqual(paid.tracking_code, 'BANK123');
    assert.ok(Math.abs(new Date(paid.paid_at).getTime() - Date.now()) < 5000);
  });

  test('profile validation and logo upload rules', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    const big = 'data:image/png;base64,' + Buffer.alloc(1100 * 1024, 1).toString('base64');
    assert.strictEqual((await call('PUT', '/api/v2/settings/profile', { logo_data_url: svg })).status, 422);
    assert.strictEqual((await call('PUT', '/api/v2/settings/profile', { logo_data_url: big })).status, 422);
    assert.strictEqual((await call('PUT', '/api/v2/settings/profile', { logo_data_url: 'data:text/html;base64,PGI+' })).status, 422);
    assert.strictEqual((await call('PUT', '/api/v2/settings/profile', { logo_data_url: 'nonsense' })).status, 422);
    const badFields = await call('PUT', '/api/v2/settings/profile', { name: 'a', support_phone: '123', support_telegram: 'bad name!', website: 'not a url' });
    assert.strictEqual(badFields.status, 422);
    assert.deepStrictEqual(Object.keys(badFields.json.errors).sort(), ['name', 'support_phone', 'support_telegram', 'website']);
    assert.strictEqual((await call('PUT', '/api/v2/settings/profile', { logo_data_url: png })).status, 200);
    const removed = await call('PUT', '/api/v2/settings/profile', { remove_logo: true, support_telegram: '' });
    assert.strictEqual(removed.json.profile.logo_url, null);
    assert.strictEqual(removed.json.profile.support_telegram, '');
    assert.strictEqual((await call('GET', '/api/v2/settings/profile')).json.profile.name, 'فروشگاه نمونه');
  });

  test('password change revokes other sessions and returns a fresh token; logout-all too', async () => {
    const login = async (pw = PW) => JSON.parse((await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { mobile, password: pw } })).body).token as string;
    const other = await login();
    assert.strictEqual((await call('GET', '/api/v2/settings/profile', undefined, other)).status, 200);
    const wrong = await call('POST', '/api/v2/settings/password', { current_password: 'nope-nope-1', new_password: 'Another-pass-88' });
    assert.strictEqual(wrong.status, 422);
    assert.ok(wrong.json.errors.current_password);
    const weak = await call('POST', '/api/v2/settings/password', { current_password: PW, new_password: '12345678' });
    assert.strictEqual(weak.status, 422);
    const ok = await call('POST', '/api/v2/settings/password', { current_password: PW, new_password: 'Another-pass-88' });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual((await call('GET', '/api/v2/settings/profile', undefined, other)).status, 401, 'other device logged out');
    assert.strictEqual((await call('GET', '/api/v2/settings/profile', undefined, token)).status, 401, 'old token of this device too');
    token = ok.json.token;
    assert.strictEqual((await call('GET', '/api/v2/settings/profile')).status, 200, 'fresh token works');
    const other2 = JSON.parse((await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { mobile, password: 'Another-pass-88' } })).body).token;
    const all = await call('POST', '/api/v2/settings/logout-all');
    assert.strictEqual((await call('GET', '/api/v2/settings/profile', undefined, other2)).status, 401);
    token = all.json.token;
    assert.strictEqual((await call('GET', '/api/v2/settings/profile')).status, 200);
  });

  test('staff: own password only, no store settings, no integrations', async () => {
    const staffMobile = `0935${String(Date.now() % 1e7).padStart(7, '0')}`;
    sql().prepare(`INSERT INTO team_members (id, merchant_id, name, mobile, role, status, password_hash, token_version, created_at) VALUES (?, ?, ?, ?, 'viewer', 'active', ?, 0, ?)`)
      .run('tm_int1', mid, 'همکار', staffMobile, CryptoUtil.hashPassword('Staff-pass-55'), Date.now());
    const m = sql().prepare('SELECT * FROM merchants WHERE id = ?').get(mid);
    const st = issueToken(m, false, sql().prepare('SELECT * FROM team_members WHERE id = ?').get('tm_int1'));
    assert.strictEqual((await call('PUT', '/api/v2/settings/profile', { name: 'هک' }, st)).status, 403);
    assert.strictEqual((await call('GET', '/api/v2/webhooks/settings', undefined, st)).status, 403);
    assert.strictEqual((await call('GET', '/api/v2/api-keys', undefined, st)).status, 403);
    assert.strictEqual((await call('GET', '/api/v2/settings/profile', undefined, st)).status, 200);
    assert.strictEqual((await call('POST', '/api/v2/settings/password', { current_password: PW, new_password: 'Brand-new-pass-1' }, st)).status, 422, 'owner password does not work for staff');
    const r = await call('POST', '/api/v2/settings/password', { current_password: 'Staff-pass-55', new_password: 'Staff-pass-66' }, st);
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await call('GET', '/api/v2/settings/profile', undefined, st)).status, 401);
    assert.strictEqual((await call('GET', '/api/v2/settings/profile', undefined, r.json.token)).status, 200);
    assert.strictEqual((await call('GET', '/api/v2/settings/profile')).status, 200, 'owner session untouched');
    assert.ok(CryptoUtil.verifyPassword('Staff-pass-66', (sql().prepare('SELECT password_hash h FROM team_members WHERE id = ?').get('tm_int1') as any).h));
  });

  test('change mobile with an SMS code sent to the new number; email change needs the password', async () => {
    const newMobile = `0919${String(Date.now() % 1e7).padStart(7, '0')}`;
    const cur = (await call('GET', '/api/v2/settings/profile')).json.profile.mobile;
    assert.strictEqual((await call('POST', '/api/v2/settings/mobile/send', { mobile: cur })).status, 422);
    assert.strictEqual((await call('POST', '/api/v2/settings/mobile/send', { mobile: '123' })).status, 422);
    const send = await call('POST', '/api/v2/settings/mobile/send', { mobile: newMobile });
    assert.strictEqual(send.status, 200, JSON.stringify(send.json));
    assert.match(send.json.dev_code, /^\d{5}$/);
    const wrong = await call('POST', '/api/v2/settings/mobile/verify', { mobile: newMobile, code: send.json.dev_code === '11111' ? '22222' : '11111' });
    assert.strictEqual(wrong.status, 400);
    assert.strictEqual((await call('GET', '/api/v2/settings/profile')).json.profile.mobile, cur, 'not changed by a wrong code');
    const ok = await call('POST', '/api/v2/settings/mobile/verify', { mobile: newMobile, code: send.json.dev_code });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
    assert.strictEqual(ok.json.profile.mobile, newMobile);
    assert.strictEqual(ok.json.profile.mobile_verified, true);
    mobile = newMobile;
    // a code for another number cannot be reused; taken numbers are refused
    const other = sql().prepare('SELECT phone FROM merchants WHERE id != ? AND phone LIKE ? LIMIT 1').get(mid, '09%') as any;
    if (other) assert.strictEqual((await call('POST', '/api/v2/settings/mobile/send', { mobile: other.phone })).status, 409);

    assert.strictEqual((await call('PUT', '/api/v2/settings/email', { email: 'owner@example.com', password: 'bad-password-1' })).status, 422);
    assert.strictEqual((await call('PUT', '/api/v2/settings/email', { email: 'not-an-email', password: 'Another-pass-88' })).status, 422);
    const em = await call('PUT', '/api/v2/settings/email', { email: ' Owner@Example.COM ', password: 'Another-pass-88' });
    assert.strictEqual(em.json.profile.email, 'owner@example.com');
  });

  test('data export is JSON without secrets', async () => {
    const r = await call('GET', '/api/v2/settings/export');
    assert.strictEqual(r.status, 200);
    assert.match(String(r.res.headers['content-disposition']), /attachment/);
    const data = JSON.parse(r.res.body);
    assert.strictEqual(data.store.id, mid);
    assert.ok(Array.isArray(data.invoices) && Array.isArray(data.api_keys));
    assert.ok(!/password_hash|whsec_|live_sk_[0-9a-f]{20}|test_sk_[0-9a-f]{20}/.test(r.res.body));
  });

  test('woocommerce.zip is a valid stored zip with the plugin and this server URL', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v2/plugins/woocommerce.zip', headers: { ...auth(), host: 'pay.test.local' } });
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.headers['content-type'], 'application/zip');
    const buf = r.rawPayload;
    const eocd = buf.length - 22;
    assert.strictEqual(buf.readUInt32LE(eocd), 0x06054b50);
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const names: string[] = [];
    const contents: Record<string, string> = {};
    for (let i = 0; i < count; i++) {
      assert.strictEqual(buf.readUInt32LE(p), 0x02014b50);
      const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 24);
      const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
      const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8');
      assert.strictEqual(method, 0);
      assert.strictEqual(buf.readUInt32LE(off), 0x04034b50);
      const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
      const data = buf.subarray(start, start + size);
      assert.strictEqual(zlib.crc32(data), crc, `crc of ${name}`);
      names.push(name);
      contents[name] = data.toString('utf8');
      p += 46 + nl + el + cl;
    }
    assert.ok(names.includes('bolgram-gateway/bolgram-gateway.php'));
    assert.ok(names.includes('bolgram-gateway/includes/class-wc-gateway-bolgram.php'));
    assert.ok(names.includes('bolgram-gateway/readme.txt'));
    assert.ok(contents['bolgram-gateway/bolgram-gateway.php'].includes('http://pay.test.local'));
    assert.ok(!Object.values(contents).some((c) => c.includes('__BOLGRAM_SERVER_URL__')));
    assert.match(contents['bolgram-gateway/includes/class-wc-gateway-bolgram.php'], /extends WC_Payment_Gateway/);
  });

  test('owner API: webhook failures across stores and API usage', async () => {
    const admin = CryptoUtil.signJwt({ id: 'admin', email: 'admin@bolgram.ir', role: 'admin' }, undefined, 1);
    const noAuth = await app.inject({ method: 'GET', url: '/api/owner/webhooks/failures' });
    assert.strictEqual(noAuth.statusCode, 401);
    const f = JSON.parse((await app.inject({ method: 'GET', url: '/api/owner/webhooks/failures', headers: auth(admin) })).body);
    assert.ok(f.total >= 1 && f.data[0].store_handle && f.data[0].status !== 'delivered');
    assert.ok('failed_24h' in f.summary);
    const u = JSON.parse((await app.inject({ method: 'GET', url: '/api/owner/api-usage?days=7', headers: auth(admin) })).body);
    const mine = u.data.find((s: any) => s.merchant_id === mid);
    assert.ok(mine && mine.calls >= 2 && mine.days.length >= 1 && mine.store_handle === handle);
  });
});

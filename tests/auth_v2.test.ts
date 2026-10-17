import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { v2Routes } from '../src/routes/v2.routes.js';
import { dbService } from '../src/db/database.js';
import { signup } from './helpers/signup.js';

describe('Panel auth v2 (handle, mobile, lockout, SMS code reset)', () => {
  let app: FastifyInstance;
  const handle = `shop${Date.now() % 1e8}`;
  const mobile = `0912${String(Date.now() % 1e7).padStart(7, '0')}`;
  let token = '';
  const post = (url: string, payload: any, headers: any = {}) => app.inject({ method: 'POST', url, payload, headers });
  before(async () => {
    app = Fastify();
    await app.register(v2Routes);
    await app.ready();
  });
  after(async () => app.close());

  test('handle rules and availability', async () => {
    const check = async (h: string) => JSON.parse((await app.inject({ method: 'GET', url: `/api/v2/auth/handle-check?handle=${encodeURIComponent(h)}` })).body);
    assert.strictEqual((await check('ab')).status, 'invalid');
    assert.strictEqual((await check('1shop')).status, 'invalid');
    assert.strictEqual((await check('my__shop')).status, 'invalid');
    assert.strictEqual((await check('shop_')).status, 'invalid');
    assert.strictEqual((await check('admin')).status, 'reserved');
    assert.match((await check('فروشگاه')).message, /کیبورد/);
    assert.strictEqual((await check(handle)).status, 'free');
  });

  test('register normalises Persian digits and +98 mobile, rejects weak passwords', async () => {
    const weak = await post('/api/v2/auth/register', { handle, mobile, password: '12345678', terms: true });
    assert.strictEqual(weak.statusCode, 422);
    const faMobile = mobile.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]).replace(/^۰/, '+۹۸ ');
    const res = await signup(app, { handle: handle.toUpperCase(), mobile: faMobile, email: '  Test@Example.COM ', password: 'Strong-pass-77', terms: true });
    assert.strictEqual(res.statusCode, 201, res.body);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.merchant.handle, handle);
    assert.strictEqual(body.merchant.mobile, mobile);
    assert.strictEqual(body.merchant.email, 'test@example.com');
    token = body.token;
    const taken = JSON.parse((await app.inject({ method: 'GET', url: `/api/v2/auth/handle-check?handle=${handle}` })).body);
    assert.strictEqual(taken.status, 'taken');
    assert.ok(taken.suggestions.length > 0);
    const dupMobile = await post('/api/v2/auth/register', { handle: handle + 'x', mobile, password: 'Strong-pass-77', terms: true });
    assert.strictEqual(dupMobile.statusCode, 409);
  });

  test('sign-up needs the texted code: nothing exists before it, wrong code fails, one IP is capped', async () => {
    const rnd = () => Math.floor(Math.random() * 254) + 1;
    const addr = () => `10.${rnd()}.${rnd()}.${rnd()}`;
    const h = `code${Date.now() % 1e8}`;
    const form = { handle: h, mobile: `0935${String(Date.now() % 1e7).padStart(7, '0')}`, password: 'Strong-pass-77', terms: true };
    const from = addr();
    const at = (payload: any, remoteAddress = from) => app.inject({ method: 'POST', url: '/api/v2/auth/register', payload, remoteAddress });
    const first = await at(form);
    assert.strictEqual(first.statusCode, 202, first.body);
    const sent = JSON.parse(first.body);
    assert.strictEqual(sent.otp_required, true);
    assert.strictEqual(sent.token, undefined);
    assert.strictEqual(JSON.parse((await app.inject({ method: 'GET', url: `/api/v2/auth/handle-check?handle=${h}` })).body).status, 'free');
    assert.strictEqual((await at(form)).statusCode, 429);
    const wrong = String((Number(sent.dev_code) + 1) % 100000).padStart(5, '0');
    const bad = await at({ ...form, code: wrong });
    assert.strictEqual(bad.statusCode, 400);
    assert.strictEqual(JSON.parse(bad.body).error, 'otp_invalid');
    const ok = await at({ ...form, code: sent.dev_code });
    assert.strictEqual(ok.statusCode, 201, ok.body);
    assert.strictEqual(JSON.parse(ok.body).merchant.mobile_verified, true);
    assert.strictEqual((await at({ ...form, code: sent.dev_code })).statusCode, 409);

    const shared = addr();
    const stamp = String(Date.now() % 1e5).padStart(5, '0');
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await at({ ...form, handle: `${h}c${i}`, mobile: `0936${stamp}${String(i).padStart(2, '0')}` }, shared)).statusCode);
    assert.deepStrictEqual(codes, [...Array(10).fill(202), 429]);
  });

  test('login: generic error, then lockout with retry_after', async () => {
    const bad = await post('/api/v2/auth/login', { mobile, password: 'wrong-pass-1' });
    assert.strictEqual(bad.statusCode, 401);
    const unknown = await post('/api/v2/auth/login', { mobile: '09990000000', password: 'wrong-pass-1' });
    assert.strictEqual(JSON.parse(unknown.body).error, JSON.parse(bad.body).error);
    let last: any;
    for (let i = 0; i < 5; i++) last = await post('/api/v2/auth/login', { mobile, password: 'wrong-pass-1' });
    assert.strictEqual(last.statusCode, 429);
    assert.ok(JSON.parse(last.body).retry_after > 0);
    dbService['db'].prepare('DELETE FROM auth_failures').run();
    const ok = await post('/api/v2/auth/login', { mobile, password: 'Strong-pass-77', remember: true });
    assert.strictEqual(ok.statusCode, 200);
  });

  test('protected routes need a session; quick invoice needs a card', async () => {
    assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v2/dashboard' })).statusCode, 401);
    const auth = { authorization: `Bearer ${token}` };
    const dash = await app.inject({ method: 'GET', url: '/api/v2/dashboard', headers: auth });
    assert.strictEqual(dash.statusCode, 200);
    assert.strictEqual(JSON.parse(dash.body).onboarding.card, false);
    const noCard = await post('/api/v2/invoices', { amount: 250000 }, auth);
    assert.strictEqual(noCard.statusCode, 409);
    const me = JSON.parse(dash.body).merchant;
    dbService['db'].prepare(`INSERT INTO payment_methods (id, merchant_id, provider_type, title, account_number, account_name, is_active) VALUES (?, ?, 'mellat', 'ملت', '6104337800002091', 'تست', 1)`).run('pm_' + Date.now(), me.id);
    const inv = await post('/api/v2/invoices', { amount: '۲۵۰٬۰۰۰', note: 'تی‌شرت', channel: 'instagram' }, auth);
    assert.strictEqual(inv.statusCode, 201, inv.body);
    const i = JSON.parse(inv.body).invoice;
    assert.ok(i.amount_toman > 250000 && i.amount_toman < 251000);
  });

  test('forgot password: code over SMS, reset, old sessions revoked', async () => {
    const send = await post('/api/v2/auth/otp/send', { mobile, purpose: 'reset' });
    assert.strictEqual(send.statusCode, 200);
    const { dev_code, resend_in } = JSON.parse(send.body);
    assert.strictEqual(resend_in, 120);
    const again = await post('/api/v2/auth/otp/send', { mobile, purpose: 'reset' });
    assert.strictEqual(again.statusCode, 429);
    const unknown = await post('/api/v2/auth/otp/send', { mobile: '09990000001', purpose: 'reset' });
    assert.strictEqual(unknown.statusCode, 200);
    assert.strictEqual((await post('/api/v2/auth/otp/verify', { mobile, purpose: 'reset', code: '00000' })).statusCode, 400);
    const ver = await post('/api/v2/auth/otp/verify', { mobile, purpose: 'reset', code: dev_code });
    assert.strictEqual(ver.statusCode, 200, ver.body);
    const reset = await post('/api/v2/auth/reset', { reset_token: JSON.parse(ver.body).reset_token, password: 'Another-pass-99' });
    assert.strictEqual(reset.statusCode, 200);
    assert.strictEqual((await app.inject({ method: 'GET', url: '/api/v2/me', headers: { authorization: `Bearer ${token}` } })).statusCode, 401);
    assert.strictEqual((await post('/api/v2/auth/login', { mobile, password: 'Another-pass-99' })).statusCode, 200);
  });
});

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { merchantRoutes } from '../src/routes/merchant.routes.js';
import { adminRoutes } from '../src/routes/admin.routes.js';

describe('Authentication is enforced server-side', () => {
  let app: FastifyInstance;
  before(async () => {
    process.env.ADMIN_EMAIL = 'owner@bolgram.test';
    process.env.ADMIN_PASSWORD = 'correct horse battery';
    app = Fastify();
    await app.register(merchantRoutes);
    await app.register(adminRoutes);
    await app.ready();
  });
  after(async () => app.close());

  test('merchant API rejects anonymous calls and a forged x-merchant-id header', async () => {
    for (const headers of [{}, { 'x-merchant-id': 'm_chaldal_bd' }, { authorization: 'Bearer forged.jwt.token' }]) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/merchant/payment-methods', headers });
      assert.strictEqual(res.statusCode, 401);
    }
    const write = await app.inject({
      method: 'POST',
      url: '/api/v1/merchant/payment-methods',
      headers: { 'x-merchant-id': 'm_chaldal_bd' },
      payload: { title: 'x', provider_type: 'mellat', account_number: '6104330000000003' },
    });
    assert.strictEqual(write.statusCode, 401);
  });

  test('merchant JWT from register/login grants access to own data only', async () => {
    const email = `sec${Date.now()}@test.ir`;
    const reg = await app.inject({ method: 'POST', url: '/api/v1/merchant/auth/register', payload: { name: 'T', email, password: 'secret123' } });
    assert.strictEqual(reg.statusCode, 201);
    const { token, merchant } = JSON.parse(reg.body);
    assert.match(merchant.id, /^m_[0-9a-f]{18}$/);
    assert.match(merchant.api_key, /^live_sk_[0-9a-f]{48}$/);
    const ok = await app.inject({ method: 'GET', url: '/api/v1/merchant/payment-methods', headers: { authorization: `Bearer ${token}` } });
    assert.strictEqual(ok.statusCode, 200);
    const wrongPw = await app.inject({ method: 'POST', url: '/api/v1/merchant/auth/login', payload: { email, password: 'nope' } });
    assert.strictEqual(wrongPw.statusCode, 401);
  });

  test('admin API requires an admin token; manual-verify cannot be called anonymously', async () => {
    const anon = await app.inject({ method: 'POST', url: '/api/v1/admin/transactions/manual-verify', payload: { invoiceId: 'x', trxId: 'y' } });
    assert.strictEqual(anon.statusCode, 401);
    const bad = await app.inject({ method: 'POST', url: '/api/v1/admin/auth/login', payload: { email: 'owner@bolgram.test', password: 'wrong' } });
    assert.strictEqual(bad.statusCode, 401);
    const login = await app.inject({ method: 'POST', url: '/api/v1/admin/auth/login', payload: { email: 'owner@bolgram.test', password: 'correct horse battery' } });
    const { token } = JSON.parse(login.body);
    const stats = await app.inject({ method: 'GET', url: '/api/v1/admin/stats', headers: { authorization: `Bearer ${token}` } });
    assert.strictEqual(stats.statusCode, 200);
  });

  test('Google sign-in without token verification is disabled', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/merchant/auth/google', payload: { email: 'victim@x.com', sub: '1' } });
    assert.ok([401, 410].includes(res.statusCode));
  });
});

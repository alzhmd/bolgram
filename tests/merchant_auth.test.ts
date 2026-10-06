import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { merchantRoutes } from '../src/routes/merchant.routes.js';
import { CryptoUtil } from '../src/utils/crypto.js';

describe('Merchant Cryptographic Authentication & JWT Suite', () => {
  let app: FastifyInstance;
  const testEmail = `merchant_${Date.now()}@example.com`;
  const testPassword = 'StrongPassword123!#';
  let authToken: string = '';

  before(async () => {
    app = Fastify();
    await app.register(merchantRoutes);
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('CryptoUtil password hashing and verification', () => {
    const raw = 'SuperSecret2026!';
    const hash = CryptoUtil.hashPassword(raw);
    assert.ok(hash.includes(':'));
    assert.strictEqual(CryptoUtil.verifyPassword(raw, hash), true);
    assert.strictEqual(CryptoUtil.verifyPassword('WrongPass', hash), false);
  });

  test('CryptoUtil JWT token signing and verification', () => {
    const payload = { id: 'm_12345', email: 'test@domain.com', role: 'merchant' };
    const token = CryptoUtil.signJwt(payload);
    assert.ok(token.split('.').length === 3);

    const verified = CryptoUtil.verifyJwt(token);
    assert.strictEqual(verified.valid, true);
    assert.strictEqual(verified.payload.email, 'test@domain.com');
  });

  test('POST /api/v1/merchant/auth/register registers merchant with scrypt password and JWT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/merchant/auth/register',
      payload: {
        name: 'Tanim Rahman',
        business_name: 'Tanim Electronics',
        email: testEmail,
        password: testPassword,
        phone: '01899001122',
      },
    });

    assert.strictEqual(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.merchant.email, testEmail);
    assert.ok(body.token);
    assert.ok(body.token.split('.').length === 3);
  });

  test('POST /api/v1/merchant/auth/register rejects duplicate email with 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/merchant/auth/register',
      payload: {
        name: 'Another User',
        email: testEmail,
        password: 'AnotherPassword123',
      },
    });

    assert.strictEqual(res.statusCode, 409);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, false);
  });

  test('POST /api/v1/merchant/auth/login fails with invalid password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/merchant/auth/login',
      payload: {
        email: testEmail,
        password: 'WrongPassword!',
      },
    });

    assert.strictEqual(res.statusCode, 401);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, false);
  });

  test('POST /api/v1/merchant/auth/login succeeds with valid password and issues JWT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/merchant/auth/login',
      payload: {
        email: testEmail,
        password: testPassword,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.merchant.email, testEmail);
    assert.ok(body.token);
    authToken = body.token;
  });

  test('GET /api/v1/merchant/auth/me verifies active JWT session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/merchant/auth/me',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.user.email, testEmail);
  });
});

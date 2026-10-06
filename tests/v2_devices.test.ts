import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { v2Routes, issueToken } from '../src/routes/v2.routes.js';
import { deviceRoutes } from '../src/routes/device.routes.js';
import { dbService } from '../src/db/database.js';
import { InvoiceRepository } from '../src/db/repositories/invoice.repository.js';
import { events, registerLimitProvider } from '../src/services/events.js';
import { runDeviceMonitor } from '../src/routes/v2/devices.routes.js';

const d = () => (dbService as any).db as import('node:sqlite').DatabaseSync;

describe('Devices (pairing, shortcut ingest, revoke, monitor)', () => {
  let app: FastifyInstance;
  const stamp = Date.now() % 1e7;
  let A: any, B: any;
  let authA: any, authB: any, authCashier: any;
  let deviceLimit: number | null = null;
  const req = (method: string, url: string, payload?: any, headers: any = {}) => app.inject({ method: method as any, url, payload, headers });
  const json = (r: any) => JSON.parse(r.body);
  const mellat = (amount: number, balance: number) => `حساب1848394556\nواریز${amount.toLocaleString('en-US')}\nمانده${balance.toLocaleString('en-US')}\n05/07/12-10:15`;
  const pairDevice = async (auth = authA, extra: any = {}) => {
    const p = await req('POST', '/api/v2/devices/pair', {}, auth);
    assert.strictEqual(p.statusCode, 201, p.body);
    const code = json(p).code;
    const r = await req('POST', '/api/v1/device/pair', { code, device_model: 'Redmi Note 13', android_version: '14', app_version: '1.0.0', ...extra });
    return { code, res: r, body: json(r) };
  };

  before(async () => {
    app = Fastify();
    await app.register(deviceRoutes);
    await app.register(v2Routes);
    await app.ready();
    registerLimitProvider((mid, key) => (key === 'devices' && mid === A?.id ? deviceLimit : null));
    const reg = async (h: string, mob: string) => {
      const r = await req('POST', '/api/v2/auth/register', { handle: h, mobile: mob, password: 'Strong-pass-77', terms: true });
      assert.strictEqual(r.statusCode, 201, r.body);
      return json(r);
    };
    const a = await reg(`dva${stamp}`, `0915${String(stamp).padStart(7, '0')}`);
    const b = await reg(`dvb${stamp}`, `0914${String(stamp).padStart(7, '0')}`);
    A = a.merchant;
    B = b.merchant;
    authA = { authorization: `Bearer ${a.token}` };
    authB = { authorization: `Bearer ${b.token}` };
    d().prepare(`INSERT INTO team_members (id, merchant_id, name, mobile, role, status, token_version, created_at) VALUES (?, ?, 'صندوق‌دار', '09120000001', 'cashier', 'active', 0, ?)`).run('tm_d' + stamp, A.id, Date.now());
    const mRow = d().prepare('SELECT * FROM merchants WHERE id = ?').get(A.id);
    authCashier = { authorization: `Bearer ${issueToken(mRow, false, { id: 'tm_d' + stamp, token_version: 0 })}` };
  });
  after(async () => app.close());

  test('pair code: issue (QR payload + svg), permissions, exchange for a token, single use', async () => {
    assert.strictEqual((await req('POST', '/api/v2/devices/pair', {}, authCashier)).statusCode, 403);
    const p = json(await req('POST', '/api/v2/devices/pair', {}, authA));
    assert.match(p.code, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.match(p.qr_payload, new RegExp(`^bolgram://pair\\?s=.+&c=${p.code}$`));
    assert.ok(p.qr_svg.startsWith('<?xml') || p.qr_svg.startsWith('<svg'));
    assert.ok(p.expires_in > 590 && p.expires_in <= 600);
    assert.strictEqual(json(await req('GET', `/api/v2/devices/pair/${p.code}`, undefined, authA)).status, 'pending');
    assert.strictEqual(json(await req('GET', `/api/v2/devices/pair/${p.code}`, undefined, authB)).status, 'expired', 'other merchants cannot poll it');

    const lower = p.code.toLowerCase().replace(/(.{4})/, '$1-');
    const ex = await req('POST', '/api/v1/device/pair', { code: lower, device_name: 'گوشی فروشگاه', device_model: 'Redmi Note 13', android_version: '14' });
    assert.strictEqual(ex.statusCode, 201, ex.body);
    const ok = json(ex);
    assert.match(ok.device_token, /^bgd_[0-9a-f]{48}$/);
    assert.strictEqual(ok.device_name, 'گوشی فروشگاه');
    const again = await req('POST', '/api/v1/device/pair', { code: p.code });
    assert.strictEqual(again.statusCode, 404, 'a code works only once');

    const st = json(await req('GET', `/api/v2/devices/pair/${p.code}`, undefined, authA));
    assert.strictEqual(st.status, 'paired');
    assert.strictEqual(st.device.id, ok.device_id);
    assert.strictEqual((await req('POST', '/api/v1/device/pair', { code: 'ZZZZZZZZ' })).statusCode, 404);
  });

  test('expired code is refused; a new code invalidates the previous one', async () => {
    const p1 = json(await req('POST', '/api/v2/devices/pair', {}, authA));
    d().prepare('UPDATE device_pair_codes SET expires_at = ? WHERE code = ?').run(Date.now() - 1000, p1.code);
    assert.strictEqual((await req('POST', '/api/v1/device/pair', { code: p1.code })).statusCode, 404);
    assert.strictEqual(json(await req('GET', `/api/v2/devices/pair/${p1.code}`, undefined, authA)).status, 'expired');
    const p2 = json(await req('POST', '/api/v2/devices/pair', {}, authA));
    const p3 = json(await req('POST', '/api/v2/devices/pair', {}, authA));
    assert.strictEqual((await req('POST', '/api/v1/device/pair', { code: p2.code })).statusCode, 404);
    assert.strictEqual((await req('POST', '/api/v1/device/pair', { code: p3.code })).statusCode, 201);
  });

  test('plan device limit is enforced when issuing a code and when exchanging it', async () => {
    const count = Number((d().prepare('SELECT count(*) AS n FROM devices WHERE merchant_id = ? AND revoked_at IS NULL').get(A.id) as any).n);
    const p = json(await req('POST', '/api/v2/devices/pair', {}, authA));
    deviceLimit = count;
    const blocked = await req('POST', '/api/v2/devices/pair', {}, authA);
    assert.strictEqual(blocked.statusCode, 402);
    assert.strictEqual(json(blocked).error, 'plan_limit');
    assert.strictEqual((await req('POST', '/api/v2/devices/shortcut', {}, authA)).statusCode, 402);
    assert.strictEqual((await req('POST', '/api/v1/device/pair', { code: p.code })).statusCode, 402);
    deviceLimit = null;
  });

  test('heartbeat fills the list fields; telemetry never renames the device', async () => {
    const { body } = await pairDevice(authA, { device_name: 'گوشی انبار' });
    const token = body.device_token;
    const hb = await req('POST', '/api/v1/device/heartbeat', { battery_level: 77, is_charging: true, device_name: 'نام هکری', sim_number: '09121112233', sim_slots: [{ slot: 1, carrier: 'همراه اول' }], app_version: '1.0.1' }, { 'x-device-token': token });
    assert.strictEqual(hb.statusCode, 200, hb.body);
    assert.strictEqual(json(hb).device_name, 'گوشی انبار');
    const list = json(await req('GET', '/api/v2/devices', undefined, authA));
    const dev = list.data.find((x: any) => x.id === body.device_id);
    assert.strictEqual(dev.name, 'گوشی انبار');
    assert.strictEqual(dev.kind, 'android');
    assert.strictEqual(dev.online, true);
    assert.strictEqual(dev.battery_level, 77);
    assert.strictEqual(dev.charging, true);
    assert.strictEqual(dev.model, 'Redmi Note 13');
    assert.strictEqual(dev.android_version, '14');
    assert.strictEqual(dev.app_version, '1.0.1');
    assert.strictEqual(dev.sim.number, '09121112233');
    assert.strictEqual(dev.sim.slots[0].carrier, 'همراه اول');
    assert.strictEqual(dev.sms_today, 0);
    assert.ok(dev.last_seen && dev.seconds_since_seen < 60);
    assert.ok(!JSON.stringify(list).includes(token), 'list never leaks the token');
    assert.strictEqual(json(await req('GET', '/api/v2/devices', undefined, authB)).data.length, 0, 'other merchants see nothing');
  });

  test('app senders list needs a device token and contains Iranian bank senders', async () => {
    assert.strictEqual((await req('GET', '/api/v1/device/senders')).statusCode, 401);
    const { body } = await pairDevice();
    const r = json(await req('GET', '/api/v1/device/senders', undefined, { authorization: `Bearer ${body.device_token}` }));
    assert.ok(r.senders.includes('Bank Mellat') && r.senders.includes('700717'));
    assert.ok(r.banks.find((b: any) => b.id === 'mellat').name.includes('ملت'));
  });

  test('iPhone shortcut device: ingest {sender, body} with header → held deposit, then auto-match an invoice', async () => {
    const sc = await req('POST', '/api/v2/devices/shortcut', { name: 'آیفون فروشگاه' }, authA);
    assert.strictEqual(sc.statusCode, 201, sc.body);
    const s = json(sc);
    assert.strictEqual(s.device.kind, 'ios_shortcut');
    assert.strictEqual(s.device.online, null);
    assert.ok(s.ingest_url.endsWith('/api/v1/device/sms/ingest'));
    assert.strictEqual(s.header_name, 'X-Device-Token');
    const again = json(await req('GET', `/api/v2/devices/${s.device.id}/shortcut`, undefined, authA));
    assert.strictEqual(again.token, s.token);
    assert.strictEqual((await req('GET', `/api/v2/devices/${s.device.id}/shortcut`, undefined, authB)).statusCode, 404);

    const hdr = { 'x-device-token': s.token };
    assert.strictEqual((await req('POST', '/api/v1/device/sms/ingest', { sender: 'Bank Mellat', body: 'x' })).statusCode, 401);
    const held = await req('POST', '/api/v1/device/sms/ingest', { sender: 'Bank Mellat', body: mellat(777_000 + (stamp % 900), 10_000_000 + stamp) }, hdr);
    assert.strictEqual(held.statusCode, 201, held.body);
    assert.strictEqual(json(held).matched_invoice_id, null);
    assert.ok(d().prepare(`SELECT 1 FROM unmatched_sms WHERE device_id = ?`).get(s.device.id), 'held deposit stored');

    const inv = await InvoiceRepository.create({ merchantId: A.id, invoiceId: `DVI${Date.now()}`, customerName: 'مشتری', amount: 1_200_000 });
    const hit = await req('POST', '/api/v1/device/sms/ingest', { sender: 'Bank Mellat', body: mellat(inv.amount, 33_000_000 + (stamp % 777)) }, { authorization: `Bearer ${s.token}` });
    assert.strictEqual(hit.statusCode, 201, hit.body);
    assert.strictEqual(json(hit).matched_invoice_id, inv.invoice_id);
    assert.strictEqual((await InvoiceRepository.findByInvoiceId(inv.invoice_id))?.status, 'PAID');

    const list = json(await req('GET', '/api/v2/devices', undefined, authA)).data.find((x: any) => x.id === s.device.id);
    assert.strictEqual(list.sms_today, 2);
    assert.strictEqual(list.last_sms_bank, 'mellat');
    assert.ok(list.banks.some((b: any) => b.id === 'mellat' && b.name.includes('ملت')));
    assert.ok(list.last_sms_at);

    const sms = json(await req('GET', `/api/v2/devices/${s.device.id}/sms?limit=10`, undefined, authA));
    assert.strictEqual(sms.data.length, 2);
    assert.strictEqual(sms.data[0].kind, 'matched');
    assert.strictEqual(sms.data[0].invoice_id, inv.invoice_id);
    assert.strictEqual(sms.data[1].kind, 'held');
    assert.strictEqual(sms.data[0].amount_toman, Math.round(inv.amount / 10));
    assert.ok(!JSON.stringify(sms).includes('حساب1848394556'), 'raw SMS text is not exposed');
    assert.strictEqual((await req('GET', `/api/v2/devices/${s.device.id}/sms`, undefined, authB)).statusCode, 404);
  });

  test('OTP and withdrawal SMS are never stored, even from a valid device', async () => {
    const { body } = await pairDevice();
    const h = { 'x-device-token': body.device_token };
    assert.strictEqual((await req('POST', '/api/v1/device/sms/ingest', { sender: 'Bank Mellat', sms: 'رمز پویا شما 123456 است' }, h)).statusCode, 422);
    assert.strictEqual((await req('POST', '/api/v1/device/sms/ingest', { sender: '700717', sms: 'بانک ملی ایران\nبرداشت:500,000-\nحساب:10000\nمانده:23,488,359\n0705-20:46' }, h)).statusCode, 422);
    assert.strictEqual(Number((d().prepare('SELECT count(*) AS n FROM unmatched_sms WHERE device_id = ?').get(body.device_id) as any).n), 0);
  });

  test('rename validates and is scoped; revoke kills ingest, heartbeat and senders (401) but keeps history', async () => {
    const { body } = await pairDevice();
    const id = body.device_id;
    const token = body.device_token;
    const h = { 'x-device-token': token };
    assert.strictEqual((await req('PATCH', `/api/v2/devices/${id}`, { name: ' ' }, authA)).statusCode, 422);
    assert.strictEqual((await req('PATCH', `/api/v2/devices/${id}`, { name: 'x' }, authCashier)).statusCode, 403);
    assert.strictEqual((await req('PATCH', `/api/v2/devices/${id}`, { name: 'حیاط' }, authB)).statusCode, 404);
    const ren = await req('PATCH', `/api/v2/devices/${id}`, { name: 'گوشی دوم' }, authA);
    assert.strictEqual(json(ren).device.name, 'گوشی دوم');

    assert.strictEqual((await req('POST', '/api/v1/device/sms/ingest', { sender: 'Bank Mellat', sms: mellat(555_000 + (stamp % 99), 9_000_000 + (stamp % 5000)) }, h)).statusCode, 201);
    assert.strictEqual((await req('DELETE', `/api/v2/devices/${id}`, undefined, authB)).statusCode, 404);
    assert.strictEqual((await req('DELETE', `/api/v2/devices/${id}`, undefined, authCashier)).statusCode, 403);
    assert.strictEqual((await req('DELETE', `/api/v2/devices/${id}`, undefined, authA)).statusCode, 200);

    assert.strictEqual((await req('POST', '/api/v1/device/sms/ingest', { sender: 'Bank Mellat', sms: mellat(666_000, 8_000_000) }, h)).statusCode, 401);
    assert.strictEqual((await req('POST', '/api/v1/device/heartbeat', { battery_level: 50 }, h)).statusCode, 401);
    assert.strictEqual((await req('GET', '/api/v1/device/senders', undefined, h)).statusCode, 401);
    assert.ok(!json(await req('GET', '/api/v2/devices', undefined, authA)).data.some((x: any) => x.id === id));
    assert.strictEqual((await req('DELETE', `/api/v2/devices/${id}`, undefined, authA)).statusCode, 404);
    assert.ok(d().prepare('SELECT 1 FROM unmatched_sms WHERE device_id = ?').get(id), 'held deposits survive a revoke');
  });

  test('device monitor emits offline/online once per change and survives restarts silently', async () => {
    const { body } = await pairDevice();
    const id = body.device_id;
    const seen: string[] = [];
    events.on('device.offline', (e) => { if (e.deviceId === id) seen.push('offline'); });
    events.on('device.online', (e) => { if (e.deviceId === id) seen.push('online'); });
    const set = (ms: number) => d().prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(new Date(ms).toISOString().slice(0, 19).replace('T', ' '), id);
    const t0 = Date.now();
    await req('POST', '/api/v1/device/heartbeat', { battery_level: 60 }, { 'x-device-token': body.device_token });
    runDeviceMonitor(t0 + 1000); // first sight: state recorded, nothing emitted
    assert.deepStrictEqual(seen, []);
    set(t0 - 2 * 60_000);
    runDeviceMonitor(t0); // 2 minutes: still online
    assert.deepStrictEqual(seen, []);
    set(t0 - 4 * 60_000);
    runDeviceMonitor(t0);
    runDeviceMonitor(t0 + 60_000); // no repeat
    await events.settle();
    assert.deepStrictEqual(seen, ['offline']);
    set(t0 + 59_000);
    runDeviceMonitor(t0 + 60_000);
    runDeviceMonitor(t0 + 61_000);
    await events.settle();
    assert.deepStrictEqual(seen, ['offline', 'online']);
  });

  test('public latest-app endpoint reads env and is empty when unset', async () => {
    delete process.env.ANDROID_APK_URL; delete process.env.ANDROID_APK_SHA256; delete process.env.ANDROID_APP_VERSION;
    const empty = json(await req('GET', '/api/pub/app/latest'));
    assert.strictEqual(empty.version, '');
    assert.strictEqual(empty.apk_url, '');
    assert.strictEqual(empty.sha256, '');
    process.env.ANDROID_APP_VERSION = '1.2.3';
    process.env.ANDROID_APK_URL = 'https://example.ir/bolgram.apk';
    process.env.ANDROID_APK_SHA256 = 'AB'.repeat(32);
    const r = json(await req('GET', '/api/pub/app/latest'));
    assert.strictEqual(r.version, '1.2.3');
    assert.strictEqual(r.apk_url, 'https://example.ir/bolgram.apk');
    assert.strictEqual(r.sha256, 'ab'.repeat(32));
    assert.ok(r.min_android);
    delete process.env.ANDROID_APK_URL; delete process.env.ANDROID_APK_SHA256; delete process.env.ANDROID_APP_VERSION;
  });
});

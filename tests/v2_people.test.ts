import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import Fastify, { FastifyInstance } from 'fastify';
import { v2Routes } from '../src/routes/v2.routes.js';
import { dbService } from '../src/db/database.js';
import { CryptoUtil } from '../src/utils/crypto.js';
import { purgeOldNotifications } from '../src/routes/v2/people.routes.js';
import { events, registerLimitProvider } from '../src/services/events.js';

const d = () => (dbService as any).db as import('node:sqlite').DatabaseSync;

describe('People: team + notifications', () => {
  let app: FastifyInstance;
  const stamp = Date.now() % 1e7;
  let A: any, B: any, authA: any, authB: any, admin: any;
  let teamLimit: number | null = null;
  const mobile = (n: number) => `0913${String(stamp + n).padStart(7, '0').slice(-7)}`;

  const req = (method: string, url: string, payload?: any, headers: any = {}) => app.inject({ method: method as any, url, payload, headers });
  const json = (r: any) => JSON.parse(r.body);
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const tokenOf = (link: string) => new URL(link.replace('#/', '')).searchParams.get('t')!;

  /** invite → send code → accept; returns { id, token (staff jwt), link } */
  async function onboard(name: string, mob: string, role: string) {
    const inv = await req('POST', '/api/v2/team/invite', { name, mobile: mob, role }, authA);
    assert.strictEqual(inv.statusCode, 201, inv.body);
    const { invite_link, data } = json(inv);
    const t = tokenOf(invite_link);
    const sent = json(await req('POST', '/api/v2/team/invite/accept', { t, send_code: true }));
    assert.ok(sent.success && /^\d{5}$/.test(sent.dev_code), 'dev code returned');
    const acc = await req('POST', '/api/v2/team/invite/accept', { t, code: sent.dev_code, name, password: 'Staff-pass-4321' });
    assert.strictEqual(acc.statusCode, 200, acc.body);
    return { id: data.id as string, token: json(acc).token as string, link: invite_link };
  }

  before(async () => {
    app = Fastify();
    await app.register(v2Routes);
    await app.ready();
    registerLimitProvider((mid, key) => (key === 'team' && mid === A?.id ? teamLimit : null));
    const reg = async (h: string, mob: string) => {
      const r = await req('POST', '/api/v2/auth/register', { handle: h, mobile: mob, password: 'Strong-pass-77', terms: true });
      assert.strictEqual(r.statusCode, 201, r.body);
      return json(r);
    };
    const a = await reg(`ppla${stamp}`, `0915${String(stamp).padStart(7, '0')}`);
    const b = await reg(`pplb${stamp}`, `0914${String(stamp).padStart(7, '0')}`);
    A = a.merchant; B = b.merchant;
    authA = bearer(a.token); authB = bearer(b.token);
    d().prepare(`UPDATE merchants SET name = ? WHERE id = ?`).run('فروشگاه <تست>', A.id);
    d().prepare(`INSERT INTO payment_methods (id, merchant_id, provider_type, title, account_number, account_name, is_active) VALUES (?, ?, 'mellat', 'ملت', '6104337800002091', 'تست', 1)`).run('pm_p' + stamp, A.id);
    admin = bearer(CryptoUtil.signJwt({ id: 'admin', email: 'admin@example.com', role: 'admin' }, undefined, 1));
  });
  after(async () => app.close());

  test('invite validation: owner mobile, duplicates, owner role, plan limit', async () => {
    const bad = await req('POST', '/api/v2/team/invite', { name: 'x', mobile: '12', role: 'owner' }, authA);
    assert.strictEqual(bad.statusCode, 422);
    assert.ok(json(bad).errors.name && json(bad).errors.mobile && json(bad).errors.role);
    const own = await req('POST', '/api/v2/team/invite', { name: 'مالک', mobile: A.mobile, role: 'viewer' }, authA);
    assert.strictEqual(own.statusCode, 409);
    const ok = await req('POST', '/api/v2/team/invite', { name: 'علی', mobile: mobile(1), role: 'viewer' }, authA);
    assert.strictEqual(ok.statusCode, 201, ok.body);
    const body = json(ok);
    assert.match(body.invite_link, /\/panel\/#\/invite\?t=/);
    const row = d().prepare('SELECT * FROM team_members WHERE id = ?').get(body.data.id) as any;
    assert.strictEqual(row.invite_hash, crypto.createHash('sha256').update(tokenOf(body.invite_link)).digest('hex'), 'only the hash is stored');
    assert.ok(row.invite_expires_at > Date.now() + 71 * 3600_000 && row.invite_expires_at <= Date.now() + 72 * 3600_000 + 1000);
    const dup = await req('POST', '/api/v2/team/invite', { name: 'علی دوم', mobile: mobile(1), role: 'cashier' }, authA);
    assert.strictEqual(dup.statusCode, 409);
    teamLimit = 1;
    const over = await req('POST', '/api/v2/team/invite', { name: 'سقف', mobile: mobile(2), role: 'cashier' }, authA);
    assert.strictEqual(over.statusCode, 402);
    assert.strictEqual(json(over).error, 'plan_limit');
    teamLimit = null;
    assert.strictEqual(json(await req('GET', '/api/v2/team', undefined, authA)).can_invite, true);
  });

  test('public invite check: store info, masked mobile, invalid and expired tokens', async () => {
    const inv = json(await req('POST', '/api/v2/team/invite', { name: 'سارا', mobile: mobile(3), role: 'cashier' }, authA));
    const t = tokenOf(inv.invite_link);
    const c = json(await req('GET', `/api/v2/team/invite/check?t=${t}`));
    assert.strictEqual(c.store.handle, `ppla${stamp}`);
    assert.strictEqual(c.role, 'cashier');
    assert.strictEqual(c.role_name, 'صندوق‌دار');
    assert.ok(c.mobile.includes('***') && !c.mobile.includes(mobile(3)));
    assert.strictEqual(c.expired, false);
    assert.strictEqual((await req('GET', '/api/v2/team/invite/check?t=nope')).statusCode, 404);
    assert.strictEqual((await req('GET', '/api/v2/team/invite/check?t=' + 'a'.repeat(32))).statusCode, 404);
    d().prepare('UPDATE team_members SET invite_expires_at = ? WHERE id = ?').run(Date.now() - 1000, inv.data.id);
    assert.strictEqual(json(await req('GET', `/api/v2/team/invite/check?t=${t}`)).expired, true);
    const acc = await req('POST', '/api/v2/team/invite/accept', { t, send_code: true });
    assert.strictEqual(acc.statusCode, 410);
    // reinvite renews it with a new token; the old one dies
    const re = json(await req('POST', `/api/v2/team/${inv.data.id}/reinvite`, undefined, authA));
    assert.notStrictEqual(tokenOf(re.invite_link), t);
    assert.strictEqual((await req('GET', `/api/v2/team/invite/check?t=${t}`)).statusCode, 404);
    assert.strictEqual(json(await req('GET', `/api/v2/team/invite/check?t=${tokenOf(re.invite_link)}`)).expired, false);
  });

  test('accept flow: validation, wrong code, staff token carries the role permissions', async () => {
    const inv = json(await req('POST', '/api/v2/team/invite', { name: 'رضا', mobile: mobile(4), role: 'cashier' }, authA));
    const t = tokenOf(inv.invite_link);
    const sent = json(await req('POST', '/api/v2/team/invite/accept', { t, send_code: true }));
    const weak = await req('POST', '/api/v2/team/invite/accept', { t, code: sent.dev_code, name: 'رضا', password: '123' });
    assert.strictEqual(weak.statusCode, 422);
    assert.ok(json(weak).errors.password);
    const wrong = await req('POST', '/api/v2/team/invite/accept', { t, code: sent.dev_code === '11111' ? '22222' : '11111', name: 'رضا', password: 'Staff-pass-4321' });
    assert.strictEqual(wrong.statusCode, 400);
    assert.strictEqual(json(wrong).error, 'otp_invalid');
    assert.strictEqual(json(await req('GET', `/api/v2/team/invite/check?t=${t}`)).role, 'cashier', 'still pending');
    const acc = await req('POST', '/api/v2/team/invite/accept', { t, code: sent.dev_code, name: 'رضا', password: 'Staff-pass-4321' });
    assert.strictEqual(acc.statusCode, 200, acc.body);
    const { token, merchant } = json(acc);
    assert.strictEqual(merchant.id, A.id);
    const staff = bearer(token);
    const me = json(await req('GET', '/api/v2/me', undefined, staff));
    assert.strictEqual(me.actor.kind, 'staff');
    assert.strictEqual(me.actor.role, 'cashier');
    const inv1 = await req('POST', '/api/v2/invoices', { amount: 150000, channel: 'in_person', note: 'تست' }, staff);
    assert.strictEqual(inv1.statusCode, 201, inv1.body);
    const card = await req('POST', '/api/v2/cards', { title: 'x' }, staff);
    assert.strictEqual(card.statusCode, 403);
    assert.strictEqual((await req('GET', '/api/v2/team', undefined, staff)).statusCode, 403);
    // the link is single use; staff can sign in with mobile + password
    assert.strictEqual((await req('GET', `/api/v2/team/invite/check?t=${t}`)).statusCode, 404);
    const login = await req('POST', '/api/v2/auth/login', { mobile: mobile(4), password: 'Staff-pass-4321' });
    assert.strictEqual(login.statusCode, 200, login.body);
    const row = json(await req('GET', '/api/v2/team', undefined, authA)).data.find((m: any) => m.id === inv.data.id);
    assert.strictEqual(row.status, 'active');
    assert.ok(row.last_login_at);
  });

  test('repeated wrong codes lock the invite', async () => {
    const inv = json(await req('POST', '/api/v2/team/invite', { name: 'قفل', mobile: mobile(5), role: 'viewer' }, authA));
    const t = tokenOf(inv.invite_link);
    const sent = json(await req('POST', '/api/v2/team/invite/accept', { t, send_code: true }));
    const wrong = sent.dev_code === '33333' ? '44444' : '33333';
    for (let i = 0; i < 5; i++) {
      const r = await req('POST', '/api/v2/team/invite/accept', { t, code: wrong, name: 'قفل', password: 'Staff-pass-4321' });
      assert.strictEqual(r.statusCode, 400);
    }
    const locked = await req('POST', '/api/v2/team/invite/accept', { t, code: sent.dev_code, name: 'قفل', password: 'Staff-pass-4321' });
    assert.strictEqual(locked.statusCode, 429);
    assert.ok(json(locked).retry_after > 0);
  });

  test('role change, disable, enable and remove revoke or refresh the staff session', async () => {
    const s = await onboard('حسابدار', mobile(6), 'accountant');
    const staff = bearer(s.token);
    assert.strictEqual((await req('GET', '/api/v2/cards', undefined, staff)).statusCode, 200);
    const ch = await req('PATCH', `/api/v2/team/${s.id}`, { role: 'viewer' }, authA);
    assert.strictEqual(ch.statusCode, 200);
    assert.strictEqual(json(ch).data.role, 'viewer');
    assert.strictEqual((await req('GET', '/api/v2/cards', undefined, staff)).statusCode, 401, 'old token refreshed out');
    const relog = json(await req('POST', '/api/v2/auth/login', { mobile: mobile(6), password: 'Staff-pass-4321' }));
    const staff2 = bearer(relog.token);
    assert.strictEqual(json(await req('GET', '/api/v2/me', undefined, staff2)).actor.role, 'viewer');
    assert.strictEqual((await req('PATCH', `/api/v2/team/${s.id}`, { role: 'owner' }, authA)).statusCode, 422);
    assert.strictEqual((await req('PATCH', `/api/v2/team/${s.id}`, { status: 'disabled' }, authA)).statusCode, 200);
    assert.strictEqual((await req('GET', '/api/v2/me', undefined, staff2)).statusCode, 401);
    assert.strictEqual((await req('POST', '/api/v2/auth/login', { mobile: mobile(6), password: 'Staff-pass-4321' })).statusCode, 401);
    assert.strictEqual((await req('PATCH', `/api/v2/team/${s.id}`, { status: 'active' }, authA)).statusCode, 200);
    const staff3 = bearer(json(await req('POST', '/api/v2/auth/login', { mobile: mobile(6), password: 'Staff-pass-4321' })).token);
    assert.strictEqual((await req('GET', '/api/v2/me', undefined, staff3)).statusCode, 200);
    assert.strictEqual((await req('DELETE', `/api/v2/team/${s.id}`, undefined, authA)).statusCode, 200);
    assert.strictEqual((await req('GET', '/api/v2/me', undefined, staff3)).statusCode, 401);
    assert.strictEqual((await req('DELETE', `/api/v2/team/${s.id}`, undefined, authA)).statusCode, 404);
  });

  test('team management is scoped per store and invited members cannot be activated directly', async () => {
    const inv = json(await req('POST', '/api/v2/team/invite', { name: 'دعوتی', mobile: mobile(7), role: 'viewer' }, authA));
    assert.strictEqual((await req('PATCH', `/api/v2/team/${inv.data.id}`, { status: 'active' }, authA)).statusCode, 409);
    assert.strictEqual((await req('PATCH', `/api/v2/team/${inv.data.id}`, { role: 'manager' }, authB)).statusCode, 404);
    assert.strictEqual((await req('DELETE', `/api/v2/team/${inv.data.id}`, undefined, authB)).statusCode, 404);
    assert.strictEqual((await req('POST', `/api/v2/team/${inv.data.id}/reinvite`, undefined, authB)).statusCode, 404);
    assert.strictEqual(json(await req('GET', '/api/v2/team', undefined, authB)).data.length, 0);
    const g = json(await req('GET', '/api/v2/team', undefined, authA));
    assert.ok(g.roles.every((r: any) => r.id !== 'owner') && g.roles.length === 4);
    assert.ok(g.perms.some((p: any) => p.key === 'team:manage'));
  });

  test('staff changes their own password; owners are refused', async () => {
    const s = await onboard('تغییر رمز', mobile(8), 'manager');
    const staff = bearer(s.token);
    assert.strictEqual((await req('POST', '/api/v2/team/me/password', { current: 'wrong-pass-1', next: 'Newer-pass-9876' }, staff)).statusCode, 422);
    assert.strictEqual((await req('POST', '/api/v2/team/me/password', { current: 'Staff-pass-4321', next: '123' }, staff)).statusCode, 422);
    const ok = await req('POST', '/api/v2/team/me/password', { current: 'Staff-pass-4321', next: 'Newer-pass-9876' }, staff);
    assert.strictEqual(ok.statusCode, 200, ok.body);
    assert.strictEqual((await req('GET', '/api/v2/me', undefined, staff)).statusCode, 401, 'old session revoked');
    assert.strictEqual((await req('GET', '/api/v2/me', undefined, bearer(json(ok).token))).statusCode, 200, 'new token works');
    assert.strictEqual((await req('POST', '/api/v2/auth/login', { mobile: mobile(8), password: 'Newer-pass-9876' })).statusCode, 200);
    assert.strictEqual((await req('POST', '/api/v2/team/me/password', { current: 'Strong-pass-77', next: 'Newer-pass-9876' }, authA)).statusCode, 403);
  });

  test('activity log: labels, filters, store scoping', async () => {
    const r = json(await req('GET', '/api/v2/team/activity', undefined, authA));
    assert.ok(r.total >= 6);
    const labels = r.data.map((x: any) => x.label);
    assert.ok(labels.includes('همکار جدید دعوت شد') && labels.includes('نقش همکار تغییر کرد') && labels.includes('همکار حذف شد') && labels.includes('دعوت‌نامه پذیرفته شد'));
    const own = r.actors.find((a: any) => a.id === A.id);
    assert.ok(own);
    const byActor = json(await req('GET', `/api/v2/team/activity?actor=${A.id}`, undefined, authA));
    assert.ok(byActor.data.length && byActor.data.every((x: any) => x.actor_id === A.id));
    const byAction = json(await req('GET', '/api/v2/team/activity?action=team.removed', undefined, authA));
    assert.ok(byAction.data.length && byAction.data.every((x: any) => x.action === 'team.removed'));
    const prefix = json(await req('GET', '/api/v2/team/activity?action=team', undefined, authA));
    assert.strictEqual(prefix.total, r.total);
    assert.strictEqual(json(await req('GET', '/api/v2/team/activity', undefined, authB)).total, 0);
    const paged = json(await req('GET', '/api/v2/team/activity?per_page=2&page=2', undefined, authA));
    assert.strictEqual(paged.page, 2);
    assert.strictEqual(paged.data.length, 2);
  });

  test('notification subscribers write Persian items with Toman amounts and panel links', async () => {
    events.emit('invoice.paid', { merchantId: A.id, invoiceId: 'INV123', amount: 1_250_000, provider: 'mellat', source: 'auto' });
    events.emit('invoice.paid', { merchantId: A.id, invoiceId: 'INVZERO', amount: 0, provider: 'mellat', source: 'auto' });
    events.emit('deposit.held', { merchantId: A.id, amount: 500_000, provider: 'melli', suspicious: true });
    events.emit('device.offline', { merchantId: A.id, deviceId: 'dv1', name: 'گوشی مغازه' });
    events.emit('device.online', { merchantId: A.id, deviceId: 'dv1', name: 'گوشی مغازه' });
    events.emit('wallet.low', { merchantId: A.id, balance: 30_000 });
    events.emit('wallet.credited', { merchantId: A.id, amount: 1_000_000, kind: 'topup' });
    events.emit('ticket.replied', { merchantId: A.id, ticketId: 't1', subject: 'مشکل اتصال' });
    events.emit('trust.decided', { merchantId: A.id, approved: false, note: 'مدارک ناقص' });
    events.emit('plan.changed', { merchantId: A.id, planId: 'pro', expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() });
    events.emit('invoice.paid', { merchantId: B.id, invoiceId: 'INVB', amount: 20_000, provider: 'mellat', source: 'auto' });
    await events.settle();
    const r = json(await req('GET', '/api/v2/notifications?per_page=50', undefined, authA));
    const by = (t: RegExp) => r.data.find((n: any) => t.test(n.title));
    const paid = by(/پرداخت/);
    assert.match(paid.title, /۱۲۵٬۰۰۰ تومان/);
    assert.strictEqual(paid.href, '#/invoices/INV123');
    assert.strictEqual(paid.category, 'payment');
    assert.ok(!r.data.some((n: any) => n.href === '#/invoices/INVZERO'));
    assert.strictEqual(by(/مشکوک/).level, 'danger');
    assert.strictEqual(by(/مشکوک/).href, '#/deposits');
    assert.strictEqual(by(/آفلاین/).href, '#/devices');
    // The billing feature may also emit wallet.low for real fee charges; find the one this test emitted.
    assert.ok(r.data.some((n: any) => /کم است/.test(n.title) && /۳٬۰۰۰ تومان/.test(n.body || '')));
    assert.strictEqual(by(/شارژ شد/).level, 'success');
    assert.strictEqual(by(/پشتیبانی/).href, '#/support');
    assert.strictEqual(by(/رد شد/).href, '#/trust');
    assert.strictEqual(by(/پلن/).href, '#/plans');
    assert.ok(r.data.every((n: any) => !n.title.includes('INVB')), 'merchant B events never reach A');
    const cat = json(await req('GET', '/api/v2/notifications?category=device', undefined, authA));
    assert.strictEqual(cat.total, 2);
    assert.ok(cat.data.every((n: any) => n.category === 'device'));
  });

  test('unread count, mark read by ids and all, merchant scoping', async () => {
    const before = json(await req('GET', '/api/v2/notifications/unread-count', undefined, authA));
    assert.ok(before.count >= 9);
    assert.ok(before.latest.length > 0 && before.latest.length <= 6);
    const list = json(await req('GET', '/api/v2/notifications?per_page=3', undefined, authA));
    const ids = list.data.map((n: any) => n.id);
    const one = json(await req('POST', '/api/v2/notifications/read', { ids }, authA));
    assert.strictEqual(one.updated, 3);
    assert.strictEqual(one.unread, before.count - 3);
    // another store cannot mark my items read
    const bUnread = json(await req('GET', '/api/v2/notifications/unread-count', undefined, authB)).count;
    const cross = json(await req('POST', '/api/v2/notifications/read', { ids: [list.data[0].id] }, authB));
    assert.strictEqual(cross.updated, 0);
    assert.strictEqual(json(await req('GET', '/api/v2/notifications/unread-count', undefined, authB)).count, bUnread);
    const unreadOnly = json(await req('GET', '/api/v2/notifications?unread=1&per_page=100', undefined, authA));
    assert.ok(unreadOnly.data.every((n: any) => !n.read) && unreadOnly.total === before.count - 3);
    assert.strictEqual((await req('POST', '/api/v2/notifications/read', {}, authA)).statusCode, 422);
    const all = json(await req('POST', '/api/v2/notifications/read', { all: true }, authA));
    assert.strictEqual(all.unread, 0);
    assert.strictEqual(json(await req('GET', '/api/v2/notifications/unread-count', undefined, authA)).count, 0);
    assert.strictEqual((await req('GET', '/api/v2/notifications')).statusCode, 401);
  });

  test('owner broadcast: auth, validation, targeting, listing, 90-day cleanup', async () => {
    assert.strictEqual((await req('POST', '/api/owner/notifications/broadcast', { title: 'سلام', body: 'x', level: 'info' }, authA)).statusCode, 401);
    const invalid = await req('POST', '/api/owner/notifications/broadcast', { title: '', body: '', level: 'loud', href: 'https://evil.example' }, admin);
    assert.strictEqual(invalid.statusCode, 422);
    assert.ok(json(invalid).errors.title && json(invalid).errors.level && json(invalid).errors.href);
    const one = await req('POST', '/api/owner/notifications/broadcast', { title: 'نگهداری برنامه‌ریزی‌شده', body: 'امشب ساعت ۲ سرویس چند دقیقه قطع می‌شود.', href: '#/support', level: 'warning', merchant_ids: [A.id, 'm_missing'] }, admin);
    assert.strictEqual(one.statusCode, 201, one.body);
    assert.strictEqual(json(one).delivered, 1);
    const a = json(await req('GET', '/api/v2/notifications?category=system', undefined, authA));
    assert.strictEqual(a.data[0].title, 'نگهداری برنامه‌ریزی‌شده');
    assert.strictEqual(a.data[0].level, 'warning');
    assert.strictEqual(json(await req('GET', '/api/v2/notifications?category=system', undefined, authB)).total, 0, 'B was not targeted');
    const everyone = json(await req('POST', '/api/owner/notifications/broadcast', { title: 'قابلیت جدید', body: 'همکاران حالا نقش دارند.', level: 'success' }, admin));
    assert.ok(everyone.delivered >= 2);
    assert.strictEqual(json(await req('GET', '/api/v2/notifications?category=system', undefined, authB)).total, 1);
    const list = json(await req('GET', '/api/owner/notifications/broadcasts', undefined, admin));
    assert.ok(list.total >= 2);
    assert.strictEqual(list.data[0].title, 'قابلیت جدید');
    assert.strictEqual(list.data[0].all_stores, true);
    assert.strictEqual((await req('GET', '/api/owner/notifications/broadcasts', undefined, authA)).statusCode, 401);
    // items older than 90 days are purged (daily timer calls the same function)
    d().prepare(`INSERT INTO notif_items (id, merchant_id, category, level, title, created_at) VALUES ('nt_old', ?, 'system', 'info', 'قدیمی', ?)`).run(A.id, Date.now() - 91 * 86400_000);
    assert.strictEqual(purgeOldNotifications(), 1);
    assert.ok(!d().prepare(`SELECT 1 FROM notif_items WHERE id = 'nt_old'`).get());
  });
});

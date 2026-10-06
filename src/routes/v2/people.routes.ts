import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CryptoUtil } from '../../utils/crypto.js';
import { normalizeMobile, passwordProblem, toLatinDigits } from '../../utils/validate.js';
import { OtpError, sendOtp, verifyOtp } from '../../services/otp.service.js';
import { PERMS, ROLES, ROLE_PERMS, audit, requirePerm, type Role } from '../../services/access.js';
import { GuardError, checkLimit, events } from '../../services/events.js';
import { formatNumberFa } from '../../parsers/ir/persian.js';
import { formatJalali } from '../../parsers/ir/jalali.js';
import { bankName } from '../../services/store.service.js';
import { publicBase } from '../../bot/bot.service.js';
import { db, fail, isoOf, merchantOf, paging, str, actorOf } from './_kit.js';

/**
 * Feature "people": team members (invites, staff sessions, activity log) and the notification center.
 * Owner API: POST /api/owner/notifications/broadcast, GET /api/owner/notifications/broadcasts.
 */

const INVITE_TTL_MS = 72 * 3600_000;
const NOTIF_TTL_MS = 90 * 24 * 3600_000;
export const NOTIF_CATEGORIES = {
  payment: 'پرداخت',
  deposit: 'واریزی',
  device: 'دستگاه',
  billing: 'اشتراک و کیف پول',
  support: 'پشتیبانی',
  trust: 'نماد اعتماد',
  team: 'همکاران',
  system: 'سیستم',
} as const;
type Category = keyof typeof NOTIF_CATEGORIES;
const LEVELS = ['info', 'success', 'warning', 'danger'] as const;
type Level = (typeof LEVELS)[number];

export function ensurePeopleSchema() {
  const d = db();
  d.exec(`CREATE TABLE IF NOT EXISTS notif_items (
    id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, category TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL, body TEXT, href TEXT, read_at INTEGER, created_at INTEGER NOT NULL, broadcast_id TEXT)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_notif_merchant ON notif_items(merchant_id, created_at)`);
  d.exec(`CREATE TABLE IF NOT EXISTS notif_broadcasts (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, href TEXT, level TEXT NOT NULL, all_stores INTEGER NOT NULL,
    delivered INTEGER NOT NULL, created_by TEXT, created_at INTEGER NOT NULL)`);
}

/** Writes one notification for a store (also usable by other features). */
export function notify(merchantId: string, n: { category: Category; level?: Level; title: string; body?: string; href?: string }) {
  db()
    .prepare(`INSERT INTO notif_items (id, merchant_id, category, level, title, body, href, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('nt_' + crypto.randomBytes(8).toString('hex'), merchantId, n.category, n.level || 'info', n.title.slice(0, 160), (n.body || '').slice(0, 600) || null, n.href || null, Date.now());
}

const tmn = (rial: number) => `${formatNumberFa(Math.round(Number(rial) / 10))} تومان`;
let subscribed = false;
function subscribe() {
  if (subscribed) return;
  subscribed = true;
  const safe = <T>(fn: (p: T) => void) => (p: T) => {
    try { fn(p); } catch (e) { console.error('[notifications]', e); }
  };
  events.on('invoice.paid', safe((e) => {
    if (!(Number(e.amount) > 0)) return;
    notify(e.merchantId, { category: 'payment', level: 'success', title: `پرداخت ${tmn(e.amount)} دریافت شد`, body: `فاکتور ${e.invoiceId} از طریق ${bankName(e.provider)} پرداخت شد${e.source === 'manual' ? ' (تأیید دستی)' : ''}.`, href: `#/invoices/${e.invoiceId}` });
  }));
  events.on('deposit.held', safe((e) => notify(e.merchantId, {
    category: 'deposit', level: e.suspicious ? 'danger' : 'warning',
    title: e.suspicious ? `واریزی مشکوک ${tmn(e.amount)} نگه داشته شد` : `واریزی ${tmn(e.amount)} به هیچ فاکتوری وصل نشد`,
    body: `این واریزی (${bankName(e.provider)}) منتظر بررسی شماست؛ آن را به یک فاکتور وصل یا رد کنید.`, href: '#/deposits',
  })));
  events.on('device.offline', safe((e) => notify(e.merchantId, { category: 'device', level: 'warning', title: `دستگاه «${e.name}» آفلاین شد`, body: 'تا وصل شدن دوباره، پیامک‌های بانک دریافت نمی‌شود و پرداخت‌ها خودکار تأیید نمی‌شوند.', href: '#/devices' })));
  events.on('device.online', safe((e) => notify(e.merchantId, { category: 'device', level: 'success', title: `دستگاه «${e.name}» دوباره آنلاین شد`, body: 'دریافت پیامک‌های بانک از سر گرفته شد.', href: '#/devices' })));
  events.on('wallet.low', safe((e) => notify(e.merchantId, { category: 'billing', level: 'warning', title: 'موجودی کیف پول کم است', body: `موجودی فعلی ${tmn(e.balance)} است؛ برای ادامهٔ ساخت فاکتور کیف پول را شارژ کنید.`, href: '#/wallet' })));
  events.on('wallet.credited', safe((e) => notify(e.merchantId, { category: 'billing', level: 'success', title: `کیف پول ${tmn(e.amount)} شارژ شد`, href: '#/wallet' })));
  events.on('ticket.replied', safe((e) => notify(e.merchantId, { category: 'support', level: 'info', title: 'پشتیبانی به شما پاسخ داد', body: `تیکت «${e.subject}»`, href: '#/support' })));
  events.on('trust.decided', safe((e) => notify(e.merchantId, {
    category: 'trust', level: e.approved ? 'success' : 'danger',
    title: e.approved ? 'درخواست نماد اعتماد تأیید شد' : 'درخواست نماد اعتماد رد شد', body: e.note || undefined, href: '#/trust',
  })));
  events.on('plan.changed', safe((e) => notify(e.merchantId, {
    category: 'billing', level: 'info', title: `پلن شما به «${e.planId}» تغییر کرد`,
    body: e.expiresAt && !isNaN(new Date(e.expiresAt).getTime()) ? `اعتبار تا ${formatJalali(new Date(e.expiresAt), false)}` : undefined, href: '#/plans',
  })));
}

/** Deletes notifications older than 90 days; returns how many were removed. */
export function purgeOldNotifications(now = Date.now()) {
  return Number(db().prepare('DELETE FROM notif_items WHERE created_at < ?').run(now - NOTIF_TTL_MS).changes);
}
let cleanupTimer: NodeJS.Timeout | null = null;
function startCleanup() {
  if (cleanupTimer) return;
  const run = () => { try { purgeOldNotifications(); } catch { /* db closed */ } };
  run();
  cleanupTimer = setInterval(run, 24 * 3600_000);
  cleanupTimer.unref();
}

// ------------------------------------------------------------- helpers

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const STATUS_NAME: Record<string, string> = { invited: 'دعوت‌شده', active: 'فعال', disabled: 'غیرفعال' };
const maskMobile = (m: string) => (m && m.length >= 8 ? `${m.slice(0, 4)}***${m.slice(-4)}` : '***');
const inviteLink = (token: string) => `${publicBase()}/panel/#/invite?t=${token}`;
const roleList = (): Role[] => (Object.keys(ROLES) as Role[]).filter((r) => r !== 'owner');

function lockedFor(key: string): number {
  const r = db().prepare('SELECT locked_until FROM auth_failures WHERE key = ?').get(key) as any;
  return r?.locked_until && r.locked_until > Date.now() ? Math.ceil((r.locked_until - Date.now()) / 1000) : 0;
}
function addFailure(key: string, threshold: number): number {
  const r = db().prepare('SELECT count FROM auth_failures WHERE key = ?').get(key) as any;
  const count = (r?.count ?? 0) + 1;
  const lockMs = count >= threshold ? Math.min(15 * 60_000, 30_000 * 2 ** (count - threshold)) : 0;
  db()
    .prepare(`INSERT INTO auth_failures (key, count, locked_until, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET count = excluded.count, locked_until = excluded.locked_until, updated_at = excluded.updated_at`)
    .run(key, count, lockMs ? Date.now() + lockMs : null, Date.now());
  return Math.ceil(lockMs / 1000);
}
const clearFailure = (key: string) => db().prepare('DELETE FROM auth_failures WHERE key = ?').run(key);

function memberJson(t: any) {
  const role = (t.role in ROLES ? t.role : 'viewer') as Role;
  const expired = t.status === 'invited' && Number(t.invite_expires_at || 0) < Date.now();
  return {
    id: t.id,
    name: t.name || null,
    mobile: t.mobile,
    role,
    role_name: ROLES[role],
    status: t.status,
    status_name: STATUS_NAME[t.status] || t.status,
    last_login_at: t.last_login_at ? new Date(Number(t.last_login_at)).toISOString() : null,
    created_at: new Date(Number(t.created_at)).toISOString(),
    invite_expires_at: t.status === 'invited' && t.invite_expires_at ? new Date(Number(t.invite_expires_at)).toISOString() : null,
    invite_expired: expired,
  };
}

function findMember(merchantId: string, id: string) {
  return db().prepare('SELECT * FROM team_members WHERE id = ? AND merchant_id = ?').get(id, merchantId) as any;
}
const countSeats = (merchantId: string) => Number((db().prepare(`SELECT count(*) AS n FROM team_members WHERE merchant_id = ? AND status IN ('invited','active')`).get(merchantId) as any).n);

function newInvite() {
  const token = crypto.randomBytes(24).toString('base64url');
  return { token, hash: sha256(token), expires: Date.now() + INVITE_TTL_MS };
}

const NOUNS: Record<string, string> = {
  team: 'همکار', card: 'کارت', invoice: 'فاکتور', link: 'لینک پرداخت', device: 'دستگاه', deposit: 'واریزی', webhook: 'وب‌هوک', api_key: 'کلید API', apikey: 'کلید API',
  settings: 'تنظیمات', bot: 'ربات', trust: 'نماد اعتماد', plan: 'پلن', wallet: 'کیف پول', ticket: 'تیکت', plugin: 'افزونه', notification: 'اعلان', store: 'فروشگاه', auth: 'حساب',
};
const VERBS: Record<string, string> = {
  created: 'ساخته شد', updated: 'ویرایش شد', deleted: 'حذف شد', removed: 'حذف شد', invited: 'دعوت شد', reinvited: 'دوباره دعوت شد', accepted: 'دعوت را پذیرفت',
  disabled: 'غیرفعال شد', enabled: 'فعال شد', role_changed: 'نقش تغییر کرد', password_changed: 'رمز عبور را تغییر داد', cancelled: 'لغو شد', approved: 'تأیید شد',
  rejected: 'رد شد', paid: 'پرداخت شد', exported: 'خروجی گرفته شد', regenerated: 'دوباره ساخته شد', broadcast: 'ارسال همگانی شد', linked: 'متصل شد', unlinked: 'جدا شد',
  assigned: 'به فاکتور وصل شد', login: 'وارد شد', requested: 'درخواست شد', activated: 'فعال شد', purchased: 'خریداری شد',
};
const FIXED_LABELS: Record<string, string> = {
  'team.invited': 'همکار جدید دعوت شد',
  'team.reinvited': 'دعوت‌نامه دوباره ساخته شد',
  'team.accepted': 'دعوت‌نامه پذیرفته شد',
  'team.role_changed': 'نقش همکار تغییر کرد',
  'team.disabled': 'همکار غیرفعال شد',
  'team.enabled': 'همکار دوباره فعال شد',
  'team.removed': 'همکار حذف شد',
  'team.password_changed': 'همکار رمز عبور خود را تغییر داد',
};
export function actionLabel(a: string) {
  if (FIXED_LABELS[a]) return FIXED_LABELS[a];
  const [noun, ...rest] = a.split('.');
  const verb = rest.join('.');
  return NOUNS[noun] && VERBS[verb] ? `${NOUNS[noun]} ${VERBS[verb]}` : a;
}

const OTP_ERR_STATUS = (e: OtpError) => (e.code === 'otp_wait' || e.code === 'otp_limit' ? 429 : 503);

// ------------------------------------------------------------- plugin

export default async function peopleRoutes(app: FastifyInstance) {
  ensurePeopleSchema();
  subscribe();
  startCleanup();
  const manage = { preHandler: requirePerm('team:manage') };

  // ---------------------------------------------------------- team

  app.get('/api/v2/team', manage, async (req) => {
    const m = merchantOf(req);
    const rows = db().prepare(`SELECT * FROM team_members WHERE merchant_id = ? ORDER BY created_at DESC`).all(m.id) as any[];
    let limitMessage: string | null = null;
    try { checkLimit(m.id, 'team', countSeats(m.id)); } catch (e) { if (e instanceof GuardError) limitMessage = e.message; else throw e; }
    return {
      success: true,
      owner: { id: m.id, name: m.name || m.handle, mobile: m.phone, role: 'owner', role_name: ROLES.owner },
      data: rows.map(memberJson),
      can_invite: !limitMessage,
      limit_message: limitMessage,
      roles: roleList().map((r) => ({ id: r, name: ROLES[r], perms: ROLE_PERMS[r] })),
      perms: Object.entries(PERMS).map(([key, name]) => ({ key, name })),
    };
  });

  app.post('/api/v2/team/invite', manage, async (req, reply) => {
    const m = merchantOf(req);
    const b = (req.body || {}) as any;
    const errors: Record<string, string> = {};
    const name = str(b.name, 60);
    if (name.length < 2) errors.name = 'نام همکار را وارد کنید';
    const mobile = normalizeMobile(b.mobile);
    if (!mobile) errors.mobile = 'شماره موبایل معتبر نیست';
    const role = String(b.role ?? '');
    if (!(roleList() as string[]).includes(role)) errors.role = 'نقش را انتخاب کنید';
    if (Object.keys(errors).length) return fail(reply, 422, 'validation', 'اطلاعات دعوت کامل نیست', errors);
    if (mobile === normalizeMobile(m.phone)) return fail(reply, 409, 'validation', 'این شماره متعلق به مالک فروشگاه است', { mobile: 'این شماره متعلق به مالک فروشگاه است' });
    if (db().prepare('SELECT 1 FROM team_members WHERE merchant_id = ? AND mobile = ?').get(m.id, mobile)) {
      return fail(reply, 409, 'duplicate', 'این شماره قبلاً به تیم اضافه شده است', { mobile: 'این شماره قبلاً به تیم اضافه شده است' });
    }
    try { checkLimit(m.id, 'team', countSeats(m.id)); } catch (e) {
      if (e instanceof GuardError) return fail(reply, e.status, e.code, e.message);
      throw e;
    }
    const inv = newInvite();
    const id = 'tm_' + crypto.randomBytes(8).toString('hex');
    db()
      .prepare(`INSERT INTO team_members (id, merchant_id, name, mobile, role, status, invite_hash, invite_expires_at, token_version, invited_by, created_at) VALUES (?, ?, ?, ?, ?, 'invited', ?, ?, 0, ?, ?)`)
      .run(id, m.id, name, mobile, role, inv.hash, inv.expires, actorOf(req).id, Date.now());
    audit(req, m.id, 'team.invited', id, { name, mobile: maskMobile(mobile!), role });
    return reply.status(201).send({ success: true, data: memberJson(findMember(m.id, id)), invite_link: inviteLink(inv.token), invite_token: inv.token });
  });

  app.patch('/api/v2/team/:id', manage, async (req, reply) => {
    const m = merchantOf(req);
    const t = findMember(m.id, String((req.params as any).id));
    if (!t) return fail(reply, 404, 'not_found', 'همکار پیدا نشد');
    const b = (req.body || {}) as any;
    const sets: string[] = [];
    const args: any[] = [];
    const log: [string, Record<string, unknown>][] = [];
    if (b.role !== undefined) {
      if (!(roleList() as string[]).includes(String(b.role))) return fail(reply, 422, 'validation', 'نقش معتبر نیست', { role: 'نقش معتبر نیست' });
      if (b.role !== t.role) { sets.push('role = ?'); args.push(b.role); log.push(['team.role_changed', { from: t.role, to: b.role }]); }
    }
    if (b.status !== undefined) {
      if (b.status !== 'active' && b.status !== 'disabled') return fail(reply, 422, 'validation', 'وضعیت معتبر نیست', { status: 'وضعیت معتبر نیست' });
      if (b.status !== t.status) {
        if (b.status === 'active') {
          if (!t.password_hash) return fail(reply, 409, 'not_accepted', 'این همکار هنوز دعوت را نپذیرفته است؛ دعوت‌نامه را دوباره بسازید');
          sets.push(`status = 'active'`);
          log.push(['team.enabled', {}]);
        } else {
          sets.push(`status = 'disabled'`, 'invite_hash = NULL');
          log.push(['team.disabled', {}]);
        }
      }
    }
    if (!sets.length) return { success: true, data: memberJson(t) };
    // any change refreshes the member's sessions (permissions are re-read from the token version)
    db().prepare(`UPDATE team_members SET ${sets.join(', ')}, token_version = token_version + 1 WHERE id = ? AND merchant_id = ?`).run(...args, t.id, m.id);
    for (const [action, meta] of log) audit(req, m.id, action, t.id, { name: t.name, ...meta });
    return { success: true, data: memberJson(findMember(m.id, t.id)) };
  });

  app.delete('/api/v2/team/:id', manage, async (req, reply) => {
    const m = merchantOf(req);
    const t = findMember(m.id, String((req.params as any).id));
    if (!t) return fail(reply, 404, 'not_found', 'همکار پیدا نشد');
    db().prepare('DELETE FROM team_members WHERE id = ? AND merchant_id = ?').run(t.id, m.id);
    audit(req, m.id, 'team.removed', t.id, { name: t.name, mobile: maskMobile(t.mobile), role: t.role });
    return { success: true };
  });

  app.post('/api/v2/team/:id/reinvite', manage, async (req, reply) => {
    const m = merchantOf(req);
    const t = findMember(m.id, String((req.params as any).id));
    if (!t) return fail(reply, 404, 'not_found', 'همکار پیدا نشد');
    if (t.status === 'active') return fail(reply, 409, 'already_active', 'این همکار قبلاً دعوت را پذیرفته و فعال است');
    if (t.status === 'disabled') {
      try { checkLimit(m.id, 'team', countSeats(m.id)); } catch (e) {
        if (e instanceof GuardError) return fail(reply, e.status, e.code, e.message);
        throw e;
      }
    }
    const inv = newInvite();
    db().prepare(`UPDATE team_members SET status = 'invited', invite_hash = ?, invite_expires_at = ?, password_hash = NULL, token_version = token_version + 1 WHERE id = ? AND merchant_id = ?`).run(inv.hash, inv.expires, t.id, m.id);
    audit(req, m.id, 'team.reinvited', t.id, { name: t.name });
    return { success: true, data: memberJson(findMember(m.id, t.id)), invite_link: inviteLink(inv.token), invite_token: inv.token };
  });

  app.get('/api/v2/team/activity', manage, async (req) => {
    const m = merchantOf(req);
    const q = req.query as any;
    const { page, perPage, limit, offset } = paging(q);
    const where = ['merchant_id = ?'];
    const args: any[] = [m.id];
    const actor = str(q.actor, 80);
    if (actor) { where.push('actor_id = ?'); args.push(actor); }
    const action = str(q.action, 60);
    if (action) {
      if (action.includes('.')) { where.push('action = ?'); args.push(action); }
      else { where.push(`action LIKE ? ESCAPE '\\'`); args.push(action.replace(/[\\%_]/g, '\\$&') + '.%'); }
    }
    const w = where.join(' AND ');
    const total = Number((db().prepare(`SELECT count(*) AS n FROM audit_log WHERE ${w}`).get(...args) as any).n);
    const rows = db().prepare(`SELECT * FROM audit_log WHERE ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as any[];
    const actors = db().prepare(`SELECT actor_id AS id, max(actor_name) AS name, max(actor_kind) AS kind FROM audit_log WHERE merchant_id = ? AND actor_id IS NOT NULL GROUP BY actor_id`).all(m.id) as any[];
    const actions = (db().prepare(`SELECT DISTINCT action FROM audit_log WHERE merchant_id = ? ORDER BY action`).all(m.id) as any[]).map((r) => ({ action: r.action, label: actionLabel(r.action) }));
    return {
      success: true,
      data: rows.map((r) => {
        let meta: unknown = null;
        try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { /* keep null */ }
        return { id: r.id, actor_kind: r.actor_kind, actor_id: r.actor_id, actor_name: r.actor_name || (r.actor_kind === 'system' ? 'سیستم' : r.actor_kind === 'admin' ? 'پشتیبانی بولگرام' : null), action: r.action, label: actionLabel(r.action), target: r.target, meta, ip: r.ip, at: new Date(Number(r.created_at)).toISOString() };
      }),
      page, per_page: perPage, total, actors, actions,
    };
  });

  // Staff changes their own password (owners use the account recovery flow).
  app.post('/api/v2/team/me/password', async (req, reply) => {
    const a = actorOf(req);
    if (a.kind !== 'staff') return fail(reply, 403, 'forbidden', 'این بخش مخصوص همکاران است؛ مالک از «فراموشی رمز» استفاده کند');
    const m = merchantOf(req);
    const b = (req.body || {}) as any;
    const t = findMember(m.id, a.id);
    const key = `staffpw:${a.id}`;
    const wait = lockedFor(key);
    if (wait) return reply.status(429).send({ success: false, error: 'locked', message: 'تلاش‌های ناموفق زیاد بود؛ کمی بعد دوباره امتحان کنید', retry_after: wait });
    if (!t?.password_hash || typeof b.current !== 'string' || !CryptoUtil.verifyPassword(b.current, t.password_hash)) {
      addFailure(key, 5);
      return fail(reply, 422, 'validation', 'رمز فعلی درست نیست', { current: 'رمز فعلی درست نیست' });
    }
    const pp = passwordProblem(b.next, { mobile: t.mobile, handle: m.handle });
    if (pp) return fail(reply, 422, 'validation', pp, { next: pp });
    clearFailure(key);
    const tv = Number(t.token_version) + 1;
    db().prepare('UPDATE team_members SET password_hash = ?, token_version = ? WHERE id = ?').run(CryptoUtil.hashPassword(b.next), tv, t.id);
    audit(req, m.id, 'team.password_changed', t.id, { name: t.name });
    const token = CryptoUtil.signJwt({ id: m.id, role: 'merchant', tv: Number(m.token_version || 0), staff: t.id, stv: tv }, undefined, 12);
    return { success: true, token };
  });

  // ---------------------------------------------------------- public invite flow

  const byToken = (token: unknown) => {
    const tk = typeof token === 'string' ? token.trim() : '';
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(tk)) return null;
    const t = db().prepare(`SELECT * FROM team_members WHERE invite_hash = ? AND status = 'invited'`).get(sha256(tk)) as any;
    if (!t) return null;
    const store = db().prepare('SELECT * FROM merchants WHERE id = ?').get(t.merchant_id) as any;
    return store ? { t, store } : null;
  };

  app.get('/api/v2/team/invite/check', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const r = byToken((req.query as any).t);
    if (!r) return fail(reply, 404, 'invalid_invite', 'این دعوت‌نامه معتبر نیست یا لغو شده است');
    const role = (r.t.role in ROLES ? r.t.role : 'viewer') as Role;
    return {
      success: true,
      store: { name: r.store.name || r.store.handle, handle: r.store.handle },
      role, role_name: ROLES[role],
      name: r.t.name || null,
      mobile: maskMobile(r.t.mobile),
      expired: Number(r.t.invite_expires_at || 0) < Date.now(),
    };
  });

  app.post('/api/v2/team/invite/accept', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req: FastifyRequest, reply) => {
    const b = (req.body || {}) as any;
    const r = byToken(b.t);
    if (!r) return fail(reply, 404, 'invalid_invite', 'این دعوت‌نامه معتبر نیست یا لغو شده است');
    if (Number(r.t.invite_expires_at || 0) < Date.now()) return fail(reply, 410, 'invite_expired', 'مهلت این دعوت‌نامه تمام شده است؛ از مالک فروشگاه بخواهید دوباره دعوت کند');
    const key = `invite:${r.t.id}`;
    const wait = lockedFor(key);
    if (wait) return reply.status(429).send({ success: false, error: 'locked', message: 'تلاش‌های ناموفق زیاد بود؛ کمی بعد دوباره امتحان کنید', retry_after: wait });

    if (b.send_code === true) {
      try {
        const o = await sendOtp(r.t.mobile, 'invite');
        return { success: true, resend_in: o.resendIn, dev_code: o.devCode };
      } catch (e) {
        if (e instanceof OtpError) return reply.status(OTP_ERR_STATUS(e)).send({ success: false, error: e.code, message: e.message, retry_after: e.retryAfter });
        throw e;
      }
    }

    const errors: Record<string, string> = {};
    const name = str(b.name, 60);
    if (name.length < 2) errors.name = 'نام خود را وارد کنید';
    const pp = passwordProblem(b.password, { mobile: r.t.mobile, handle: r.store.handle });
    if (pp) errors.password = pp;
    const code = toLatinDigits(String(b.code ?? '')).trim();
    if (!/^\d{5}$/.test(code)) errors.code = 'کد ۵ رقمی پیامک‌شده را وارد کنید';
    if (Object.keys(errors).length) return fail(reply, 422, 'validation', 'اطلاعات کامل نیست', errors);

    try {
      if (!verifyOtp(r.t.mobile, 'invite', code)) {
        addFailure(key, 5);
        return fail(reply, 400, 'otp_invalid', 'کد درست نیست', { code: 'کد درست نیست' });
      }
    } catch (e) {
      if (e instanceof OtpError) {
        addFailure(key, 5);
        return fail(reply, 400, e.code, e.message, { code: e.message });
      }
      throw e;
    }
    clearFailure(key);
    const tv = Number(r.t.token_version) + 1;
    const upd = db()
      .prepare(`UPDATE team_members SET name = ?, password_hash = ?, status = 'active', invite_hash = NULL, invite_expires_at = NULL, token_version = ?, last_login_at = ? WHERE id = ? AND status = 'invited'`)
      .run(name, CryptoUtil.hashPassword(b.password), tv, Date.now(), r.t.id);
    if (!Number(upd.changes)) return fail(reply, 409, 'invalid_invite', 'این دعوت‌نامه قبلاً استفاده شده است');
    (req as any).actor = { kind: 'staff', id: r.t.id, name, role: r.t.role, perms: [] };
    audit(req, r.store.id, 'team.accepted', r.t.id, { name, role: r.t.role });
    notify(r.store.id, { category: 'team', level: 'success', title: `${name} به تیم پیوست`, body: `نقش: ${ROLES[r.t.role as Role] || r.t.role}`, href: '#/team' });
    const token = CryptoUtil.signJwt({ id: r.store.id, role: 'merchant', tv: Number(r.store.token_version || 0), staff: r.t.id, stv: tv }, undefined, 12);
    return {
      success: true,
      token,
      merchant: { id: r.store.id, handle: r.store.handle, name: r.store.name, plan: r.store.plan || 'FREE', status: r.store.status || 'ACTIVE' },
      role: r.t.role, role_name: ROLES[r.t.role as Role],
    };
  });

  // ---------------------------------------------------------- notifications

  const itemJson = (r: any) => ({
    id: r.id, category: r.category, category_name: NOTIF_CATEGORIES[r.category as Category] || r.category, level: r.level,
    title: r.title, body: r.body || '', href: r.href || null, read: !!r.read_at, read_at: r.read_at ? new Date(Number(r.read_at)).toISOString() : null,
    created_at: new Date(Number(r.created_at)).toISOString(),
  });
  const unreadCount = (mid: string) => Number((db().prepare('SELECT count(*) AS n FROM notif_items WHERE merchant_id = ? AND read_at IS NULL').get(mid) as any).n);

  app.get('/api/v2/notifications', async (req) => {
    const m = merchantOf(req);
    const q = req.query as any;
    const { page, perPage, limit, offset } = paging(q);
    const where = ['merchant_id = ?'];
    const args: any[] = [m.id];
    if (q.category && q.category in NOTIF_CATEGORIES) { where.push('category = ?'); args.push(q.category); }
    if (q.unread === '1' || q.unread === 'true') where.push('read_at IS NULL');
    const w = where.join(' AND ');
    const total = Number((db().prepare(`SELECT count(*) AS n FROM notif_items WHERE ${w}`).get(...args) as any).n);
    const rows = db().prepare(`SELECT * FROM notif_items WHERE ${w} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as any[];
    return { success: true, data: rows.map(itemJson), page, per_page: perPage, total, unread: unreadCount(m.id), categories: NOTIF_CATEGORIES };
  });

  app.get('/api/v2/notifications/unread-count', async (req) => {
    const m = merchantOf(req);
    const rows = db().prepare('SELECT * FROM notif_items WHERE merchant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 6').all(m.id) as any[];
    return { success: true, count: unreadCount(m.id), latest: rows.map(itemJson) };
  });

  app.post('/api/v2/notifications/read', async (req, reply) => {
    const m = merchantOf(req);
    const b = (req.body || {}) as any;
    const now = Date.now();
    let changes = 0;
    if (b.all === true) {
      const cat = b.category && b.category in NOTIF_CATEGORIES ? String(b.category) : null;
      changes = Number(db().prepare(`UPDATE notif_items SET read_at = ? WHERE merchant_id = ? AND read_at IS NULL ${cat ? 'AND category = ?' : ''}`).run(now, m.id, ...(cat ? [cat] : [])).changes);
    } else if (Array.isArray(b.ids) && b.ids.length && b.ids.length <= 200 && b.ids.every((x: unknown) => typeof x === 'string' && x.length <= 40)) {
      const st = db().prepare('UPDATE notif_items SET read_at = ? WHERE id = ? AND merchant_id = ? AND read_at IS NULL');
      for (const id of b.ids) changes += Number(st.run(now, id, m.id).changes);
    } else return fail(reply, 422, 'validation', 'شناسهٔ اعلان‌ها یا all را بفرستید');
    return { success: true, updated: changes, unread: unreadCount(m.id) };
  });

  // ---------------------------------------------------------- owner (platform admin)

  app.post('/api/owner/notifications/broadcast', async (req, reply) => {
    const b = (req.body || {}) as any;
    const errors: Record<string, string> = {};
    const title = str(b.title, 120);
    const body = str(b.body, 600);
    if (title.length < 3) errors.title = 'عنوان را وارد کنید';
    if (!body) errors.body = 'متن پیام را وارد کنید';
    const href = typeof b.href === 'string' && b.href.trim() ? b.href.trim().slice(0, 200) : '';
    if (href && !/^#\/[a-z0-9/_?=&.-]*$/i.test(href)) errors.href = 'پیوند باید یک مسیر پنل مثل #/plans باشد';
    const level = String(b.level || 'info') as Level;
    if (!LEVELS.includes(level)) errors.level = 'سطح پیام معتبر نیست';
    let ids: string[] | null = null;
    if (b.merchant_ids !== undefined && b.merchant_ids !== null) {
      if (!Array.isArray(b.merchant_ids) || b.merchant_ids.length > 5000 || !b.merchant_ids.every((x: unknown) => typeof x === 'string')) errors.merchant_ids = 'فهرست فروشگاه‌ها معتبر نیست';
      else ids = b.merchant_ids;
    }
    if (Object.keys(errors).length) return fail(reply, 422, 'validation', 'اطلاعات پیام درست نیست', errors);
    const targets = (ids
      ? ids.filter(Boolean).map((id) => (db().prepare('SELECT id FROM merchants WHERE id = ?').get(id) as any)?.id).filter(Boolean)
      : (db().prepare('SELECT id FROM merchants').all() as any[]).map((r) => r.id)) as string[];
    if (!targets.length) return fail(reply, 422, 'validation', 'فروشگاهی برای ارسال پیدا نشد', { merchant_ids: 'فروشگاهی پیدا نشد' });
    const bid = 'bc_' + crypto.randomBytes(8).toString('hex');
    const now = Date.now();
    const ins = db().prepare(`INSERT INTO notif_items (id, merchant_id, category, level, title, body, href, created_at, broadcast_id) VALUES (?, ?, 'system', ?, ?, ?, ?, ?, ?)`);
    db().exec('BEGIN');
    try {
      for (const mid of [...new Set(targets)]) ins.run('nt_' + crypto.randomBytes(8).toString('hex'), mid, level, title, body, href || null, now, bid);
      db().prepare(`INSERT INTO notif_broadcasts (id, title, body, href, level, all_stores, delivered, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(bid, title, body, href || null, level, ids ? 0 : 1, new Set(targets).size, String((req as any).admin?.email || 'admin'), now);
      db().exec('COMMIT');
    } catch (e) {
      db().exec('ROLLBACK');
      throw e;
    }
    audit(req, null, 'notification.broadcast', bid, { title, delivered: new Set(targets).size });
    return reply.status(201).send({ success: true, id: bid, delivered: new Set(targets).size });
  });

  app.get('/api/owner/notifications/broadcasts', async (req) => {
    const { page, perPage, limit, offset } = paging(req.query);
    const total = Number((db().prepare('SELECT count(*) AS n FROM notif_broadcasts').get() as any).n);
    const rows = db().prepare(`SELECT b.*, (SELECT count(*) FROM notif_items i WHERE i.broadcast_id = b.id AND i.read_at IS NOT NULL) AS read_count FROM notif_broadcasts b ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(limit, offset) as any[];
    return {
      success: true,
      data: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, href: r.href, level: r.level, all_stores: !!r.all_stores, delivered: Number(r.delivered), read_count: Number(r.read_count), created_by: r.created_by, created_at: isoOf(new Date(Number(r.created_at)).toISOString()) })),
      page, per_page: perPage, total,
    };
  });
}

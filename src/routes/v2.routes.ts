import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { dbService } from '../db/database.js';
import { CryptoUtil } from '../utils/crypto.js';
import { handleProblem, handleSuggestions, normalizeEmail, normalizeMobile, passwordProblem } from '../utils/validate.js';
import { OtpError, sendOtp, verifyOtp } from '../services/otp.service.js';
import { startOfTehranDay, startOfTehranMonth, tehranParts } from '../parsers/ir/jalali.js';
import { BANKS } from '../parsers/ir/registry.js';
import { ensureAccessSchema, resolveActor, requirePerm, ROLES, PERMS, type Actor } from '../services/access.js';
import { V2_FEATURES } from './v2/index.js';
import { checkAdminCredentials } from '../middleware/auth.js';
import { createLinkCode, ensureBotSchema, listLinks, setLinkNotify, unlink, botConfigured, botUsername } from '../bot/bot.service.js';
import { StoreError, addCard, createInvoice, deleteCard, listCards, setCardActive } from '../services/store.service.js';

/**
 * Panel API v2 (used by /panel). Auth: store handle + mobile + password, SMS.IR codes,
 * lockout after repeated failures, session revocation via token_version.
 */
const db = () => (dbService as any).db as import('node:sqlite').DatabaseSync;

export function ensurePanelSchema() {
  const d = db();
  const cols = new Set((d.prepare('PRAGMA table_info(merchants)').all() as any[]).map((c) => c.name));
  for (const [n, t] of [['handle', 'TEXT'], ['mobile_verified', 'INTEGER DEFAULT 0'], ['token_version', 'INTEGER DEFAULT 0'], ['referred_by', 'TEXT']]) {
    if (!cols.has(n)) d.exec(`ALTER TABLE merchants ADD COLUMN ${n} ${t}`);
  }
  d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_merchants_handle ON merchants(handle) WHERE handle IS NOT NULL`);
  d.exec(`CREATE TABLE IF NOT EXISTS otp_codes (id TEXT PRIMARY KEY, mobile TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, consumed_at INTEGER)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_otp_mobile ON otp_codes(mobile, purpose, created_at)`);
  d.exec(`CREATE TABLE IF NOT EXISTS auth_failures (key TEXT PRIMARY KEY, count INTEGER NOT NULL, locked_until INTEGER, updated_at INTEGER NOT NULL)`);
  const icols = new Set((d.prepare('PRAGMA table_info(invoices)').all() as any[]).map((c) => c.name));
  for (const [n, t] of [['channel', 'TEXT'], ['note', 'TEXT']]) if (!icols.has(n)) d.exec(`ALTER TABLE invoices ADD COLUMN ${n} ${t}`);
  const pcols = new Set((d.prepare('PRAGMA table_info(payment_methods)').all() as any[]).map((c) => c.name));
  for (const [n, t] of [['last4', 'TEXT'], ['card_hash', 'TEXT']]) if (!pcols.has(n)) d.exec(`ALTER TABLE payment_methods ADD COLUMN ${n} ${t}`);
}

// ------------------------------------------------------------- lockout

function lockedFor(key: string): number {
  const r = db().prepare('SELECT locked_until FROM auth_failures WHERE key = ?').get(key) as any;
  return r?.locked_until && r.locked_until > Date.now() ? Math.ceil((r.locked_until - Date.now()) / 1000) : 0;
}
function fail(key: string, threshold: number): number {
  const r = db().prepare('SELECT count FROM auth_failures WHERE key = ?').get(key) as any;
  const count = (r?.count ?? 0) + 1;
  const lockMs = count >= threshold ? Math.min(15 * 60_000, 30_000 * 2 ** (count - threshold)) : 0;
  db()
    .prepare(`INSERT INTO auth_failures (key, count, locked_until, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET count = excluded.count, locked_until = excluded.locked_until, updated_at = excluded.updated_at`)
    .run(key, count, lockMs ? Date.now() + lockMs : null, Date.now());
  return Math.ceil(lockMs / 1000);
}
function clearFail(key: string) {
  db().prepare('DELETE FROM auth_failures WHERE key = ?').run(key);
}

// ------------------------------------------------------------- helpers

const PUBLIC = new Set([
  '/api/v2/auth/register',
  '/api/v2/auth/login',
  '/api/v2/auth/handle-check',
  '/api/v2/auth/otp/send',
  '/api/v2/auth/otp/verify',
  '/api/v2/auth/reset',
  '/api/v2/team/invite/check',
  '/api/v2/team/invite/accept',
]);

function issueToken(m: any, remember: boolean, staff?: any) {
  const claims: any = { id: m.id, role: 'merchant', tv: Number(m.token_version || 0) };
  if (staff) Object.assign(claims, { staff: staff.id, stv: Number(staff.token_version || 0) });
  return CryptoUtil.signJwt(claims, undefined, remember ? 24 * 30 : 12);
}
export { issueToken };

function publicActor(a: Actor) {
  return { kind: a.kind, id: a.id, name: a.name, role: a.role, role_name: ROLES[a.role], perms: a.perms };
}

function handleTaken(h: string) {
  return !!db().prepare('SELECT 1 FROM merchants WHERE handle = ?').get(h);
}

function publicMe(m: any) {
  return {
    id: m.id,
    handle: m.handle,
    name: m.name,
    mobile: m.phone,
    email: m.email || null,
    mobile_verified: !!m.mobile_verified,
    plan: m.plan || 'FREE',
    status: m.status || 'ACTIVE',
    created_at: m.created_at,
  };
}

const HANDLE_MSG: Record<string, string> = {
  persian: 'کیبورد را انگلیسی کنید؛ فقط حروف انگلیسی، عدد و _ مجاز است',
  length: 'نام فروشگاه باید بین ۳ تا ۲۴ کاراکتر باشد',
  start: 'نام فروشگاه باید با یک حرف انگلیسی شروع شود',
  chars: 'فقط حروف کوچک انگلیسی، عدد و _ مجاز است',
  underscore: '«__» پشت‌سرهم و _ در انتها مجاز نیست',
  reserved: 'این نام رزرو شده است',
};

function utcSql(d: Date) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export async function v2Routes(app: FastifyInstance) {
  ensurePanelSchema();
  ensureBotSchema();
  ensureAccessSchema();

  // Owner (platform admin) API: same admin JWT as /api/v1/admin.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/owner/') || path === '/api/owner/auth/login') return;
    const h = req.headers.authorization;
    const v = typeof h === 'string' && h.startsWith('Bearer ') ? CryptoUtil.verifyJwt(h.slice(7)) : { valid: false as const };
    if (!v.valid || (v as any).payload?.role !== 'admin') return reply.status(401).send({ success: false, error: 'session_expired' });
    (req as any).admin = (v as any).payload;
  });
  app.post('/api/owner/auth/login', async (req, reply) => {
    const b = (req.body || {}) as any;
    const key = `owner-login:${req.ip}`;
    const wait = lockedFor(key);
    if (wait) return reply.status(429).send({ success: false, error: 'locked', retry_after: wait });
    const email = normalizeEmail(b.email) || '';
    if (!checkAdminCredentials(email, String(b.password ?? ''))) {
      const lock = fail(key, 5);
      return reply.status(lock ? 429 : 401).send({ success: false, error: lock ? 'locked' : 'invalid_credentials', retry_after: lock || undefined });
    }
    clearFail(key);
    return { success: true, token: CryptoUtil.signJwt({ id: 'admin', email, role: 'admin' }, undefined, 12) };
  });

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/v2/') || PUBLIC.has(path)) return;
    const h = req.headers.authorization;
    const v = typeof h === 'string' && h.startsWith('Bearer ') ? CryptoUtil.verifyJwt(h.slice(7)) : { valid: false as const };
    const p: any = (v as any).payload;
    if (!v.valid || p?.role !== 'merchant') return reply.status(401).send({ success: false, error: 'session_expired' });
    const m = db().prepare('SELECT * FROM merchants WHERE id = ?').get(p.id) as any;
    if (!m || Number(m.token_version || 0) !== Number(p.tv || 0) || m.status === 'SUSPENDED') return reply.status(401).send({ success: false, error: 'session_expired' });
    const actor = resolveActor(m, p);
    if (!actor) return reply.status(401).send({ success: false, error: 'session_expired' });
    (req as any).merchant = m;
    (req as any).actor = actor;
  });

  // ---------------------------------------------------------- auth

  app.get('/api/v2/auth/handle-check', async (req) => {
    const raw = String((req.query as any).handle ?? '');
    const problem = handleProblem(raw);
    if (problem) return { status: problem === 'reserved' ? 'reserved' : 'invalid', message: HANDLE_MSG[problem] };
    const h = raw.trim().toLowerCase();
    if (handleTaken(h)) return { status: 'taken', message: 'این نام قبلاً گرفته شده است', suggestions: handleSuggestions(h, handleTaken) };
    return { status: 'free' };
  });

  app.post('/api/v2/auth/register', async (req, reply) => {
    const b = (req.body || {}) as any;
    const errors: Record<string, string> = {};
    const handleRaw = String(b.handle ?? '');
    const hp = handleProblem(handleRaw);
    const handle = handleRaw.trim().toLowerCase();
    if (hp) errors.handle = HANDLE_MSG[hp];
    const mobile = normalizeMobile(b.mobile);
    if (!mobile) errors.mobile = 'شماره موبایل معتبر نیست';
    let email: string | null = null;
    if (typeof b.email === 'string' && b.email.trim()) {
      email = normalizeEmail(b.email);
      if (!email) errors.email = 'ایمیل معتبر نیست';
    }
    const pp = passwordProblem(b.password, { mobile, handle });
    if (pp) errors.password = pp;
    if (b.terms !== true) errors.terms = 'برای ساخت حساب، قوانین را بپذیرید';
    if (Object.keys(errors).length) return reply.status(422).send({ success: false, error: 'validation', errors });

    const ip = `reg-ip:${req.ip}`;
    if (lockedFor(ip)) return reply.status(429).send({ success: false, error: 'rate_limited', retry_after: lockedFor(ip) });
    if (handleTaken(handle)) {
      return reply.status(409).send({ success: false, error: 'validation', errors: { handle: 'این نام قبلاً گرفته شده است' }, suggestions: handleSuggestions(handle, handleTaken) });
    }
    if (db().prepare('SELECT 1 FROM merchants WHERE phone = ?').get(mobile)) {
      fail(ip, 10);
      return reply.status(409).send({ success: false, error: 'validation', errors: { mobile: 'با این شماره قبلاً حساب ساخته شده است؛ وارد شوید' } });
    }
    if (email && db().prepare('SELECT 1 FROM merchants WHERE lower(email) = ?').get(email)) {
      return reply.status(409).send({ success: false, error: 'validation', errors: { email: 'این ایمیل قبلاً استفاده شده است' } });
    }
    const id = 'm_' + crypto.randomBytes(9).toString('hex');
    const apiKey = 'live_sk_' + crypto.randomBytes(24).toString('hex');
    dbService.insertMerchant({
      id,
      name: handle,
      api_key: apiKey,
      email: email || undefined,
      phone: mobile!,
      status: 'ACTIVE',
      plan: 'FREE',
      payment_status: 'FREE',
      password_hash: CryptoUtil.hashPassword(b.password),
    });
    db().prepare('UPDATE merchants SET handle = ?, mobile_verified = 0, token_version = 0 WHERE id = ?').run(handle, id);
    const ref = typeof b.ref === 'string' ? b.ref.trim().toLowerCase().slice(0, 40) : '';
    const referrer = ref ? (db().prepare('SELECT id FROM merchants WHERE handle = ? AND id != ?').get(ref, id) as any) : null;
    if (referrer) db().prepare('UPDATE merchants SET referred_by = ? WHERE id = ?').run(referrer.id, id);
    const m = db().prepare('SELECT * FROM merchants WHERE id = ?').get(id) as any;
    return reply.status(201).send({
      success: true,
      token: issueToken(m, true),
      merchant: publicMe(m),
      verify_required: process.env.REQUIRE_MOBILE_VERIFY !== 'false',
    });
  });

  app.post('/api/v2/auth/login', async (req, reply) => {
    const b = (req.body || {}) as any;
    const mobile = b.mobile ? normalizeMobile(b.mobile) : null;
    const email = !mobile && b.email ? normalizeEmail(b.email) : null;
    if (!mobile && !email) return reply.status(422).send({ success: false, error: 'validation', errors: { mobile: 'شماره موبایل یا ایمیل را وارد کنید' } });
    const key = `login:${mobile || email}`;
    const ipKey = `login-ip:${req.ip}`;
    const wait = Math.max(lockedFor(key), lockedFor(ipKey));
    if (wait) return reply.status(429).send({ success: false, error: 'locked', retry_after: wait });
    const m = (mobile
      ? db().prepare('SELECT * FROM merchants WHERE phone = ? ORDER BY created_at LIMIT 1').get(mobile)
      : db().prepare('SELECT * FROM merchants WHERE lower(email) = ? ORDER BY created_at LIMIT 1').get(email)) as any;
    const ok = !!m?.password_hash && typeof b.password === 'string' && CryptoUtil.verifyPassword(b.password, m.password_hash);
    if (!ok && mobile && typeof b.password === 'string') {
      // Team members sign in with their own mobile + password and act on the store that invited them.
      const staff = (db().prepare(`SELECT * FROM team_members WHERE mobile = ? AND status = 'active' AND password_hash IS NOT NULL ORDER BY last_login_at DESC`).all(mobile) as any[])
        .find((t) => CryptoUtil.verifyPassword(b.password, t.password_hash));
      const store = staff ? (db().prepare('SELECT * FROM merchants WHERE id = ?').get(staff.merchant_id) as any) : null;
      if (staff && store && store.status !== 'SUSPENDED') {
        clearFail(key);
        db().prepare('UPDATE team_members SET last_login_at = ? WHERE id = ?').run(Date.now(), staff.id);
        return { success: true, token: issueToken(store, b.remember === true, staff), merchant: publicMe(store) };
      }
    }
    if (!ok || m.status === 'SUSPENDED') {
      if (!m?.password_hash) CryptoUtil.hashPassword('timing-equaliser');
      const lock = Math.max(fail(key, 5), fail(ipKey, 20));
      return reply.status(lock ? 429 : 401).send({ success: false, error: lock ? 'locked' : 'invalid_credentials', retry_after: lock || undefined });
    }
    clearFail(key);
    return { success: true, token: issueToken(m, b.remember === true), merchant: publicMe(m) };
  });

  app.post('/api/v2/auth/otp/send', async (req, reply) => {
    const b = (req.body || {}) as any;
    const purpose = b.purpose === 'verify' ? 'verify' : 'reset';
    let mobile = normalizeMobile(b.mobile);
    let deliver = true;
    if (purpose === 'verify') {
      // verification needs the session: the code goes to the account's own number
      const h = req.headers.authorization;
      const v = typeof h === 'string' && h.startsWith('Bearer ') ? CryptoUtil.verifyJwt(h.slice(7)) : { valid: false as const };
      const m = (v as any).valid ? (db().prepare('SELECT * FROM merchants WHERE id = ?').get((v as any).payload.id) as any) : null;
      if (!m) return reply.status(401).send({ success: false, error: 'session_expired' });
      mobile = m.phone;
    } else {
      if (!mobile) return reply.status(422).send({ success: false, error: 'validation', errors: { mobile: 'شماره موبایل معتبر نیست' } });
      // Unknown numbers get the same response (no account enumeration) but no SMS.
      deliver = !!db().prepare('SELECT 1 FROM merchants WHERE phone = ?').get(mobile);
    }
    try {
      const r = await sendOtp(mobile!, purpose, deliver);
      return { success: true, resend_in: r.resendIn, dev_code: r.devCode };
    } catch (e) {
      if (e instanceof OtpError) return reply.status(e.code === 'otp_wait' || e.code === 'otp_limit' ? 429 : 503).send({ success: false, error: e.code, message: e.message, retry_after: e.retryAfter });
      throw e;
    }
  });

  app.post('/api/v2/auth/otp/verify', async (req, reply) => {
    const b = (req.body || {}) as any;
    const purpose = b.purpose === 'verify' ? 'verify' : 'reset';
    const code = String(b.code ?? '').replace(/[۰-۹٠-٩]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d) >= 0 ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(d) : '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    let m: any = null;
    if (purpose === 'verify') {
      const h = req.headers.authorization;
      const v = typeof h === 'string' && h.startsWith('Bearer ') ? CryptoUtil.verifyJwt(h.slice(7)) : { valid: false as const };
      m = (v as any).valid ? db().prepare('SELECT * FROM merchants WHERE id = ?').get((v as any).payload.id) : null;
      if (!m) return reply.status(401).send({ success: false, error: 'session_expired' });
    } else {
      const mobile = normalizeMobile(b.mobile);
      m = mobile ? db().prepare('SELECT * FROM merchants WHERE phone = ?').get(mobile) : null;
      if (!m) return reply.status(400).send({ success: false, error: 'otp_invalid', message: 'کد درست نیست' });
    }
    try {
      if (!/^\d{5}$/.test(code) || !verifyOtp(m.phone, purpose, code)) return reply.status(400).send({ success: false, error: 'otp_invalid', message: 'کد درست نیست' });
    } catch (e) {
      if (e instanceof OtpError) return reply.status(400).send({ success: false, error: e.code, message: e.message });
      throw e;
    }
    if (purpose === 'verify') {
      db().prepare('UPDATE merchants SET mobile_verified = 1 WHERE id = ?').run(m.id);
      return { success: true };
    }
    return { success: true, reset_token: CryptoUtil.signJwt({ id: m.id, role: 'reset', tv: Number(m.token_version || 0) }, undefined, 0.25) };
  });

  app.post('/api/v2/auth/reset', async (req, reply) => {
    const b = (req.body || {}) as any;
    const v = CryptoUtil.verifyJwt(String(b.reset_token ?? ''));
    const p: any = (v as any).payload;
    const m = v.valid && p?.role === 'reset' ? (db().prepare('SELECT * FROM merchants WHERE id = ?').get(p.id) as any) : null;
    if (!m || Number(m.token_version || 0) !== Number(p.tv || 0)) return reply.status(400).send({ success: false, error: 'reset_expired', message: 'مهلت تغییر رمز تمام شده است؛ دوباره کد بگیرید' });
    const pp = passwordProblem(b.password, { mobile: m.phone, handle: m.handle });
    if (pp) return reply.status(422).send({ success: false, error: 'validation', errors: { password: pp } });
    // Changing the password signs out every existing session.
    db().prepare('UPDATE merchants SET password_hash = ?, token_version = coalesce(token_version, 0) + 1 WHERE id = ?').run(CryptoUtil.hashPassword(b.password), m.id);
    clearFail(`login:${m.phone}`);
    return { success: true };
  });

  // ---------------------------------------------------------- panel

  app.get('/api/v2/me', async (req) => ({ success: true, merchant: publicMe((req as any).merchant), actor: publicActor((req as any).actor), roles: ROLES, perm_names: PERMS }));

  const storeReply = (reply: FastifyReply, e: unknown) => {
    if (e instanceof StoreError) return reply.status(e.status).send({ success: false, error: e.code, message: e.message, ...(e.errors ? { errors: e.errors } : {}) });
    throw e;
  };

  app.get('/api/v2/cards', { preHandler: requirePerm('cards:read') }, async (req) => ({ success: true, data: listCards((req as any).merchant.id) }));

  app.get('/api/v2/banks', async () => ({ success: true, data: BANKS.map((b) => ({ id: b.id, name: b.nameFa, short: b.shortFa, color: b.color, bins: b.bins })) }));

  app.post('/api/v2/cards', { preHandler: requirePerm('cards:manage') }, async (req, reply) => {
    try {
      return reply.status(201).send({ success: true, data: addCard((req as any).merchant.id, (req.body || {}) as any) });
    } catch (e) {
      return storeReply(reply, e);
    }
  });

  app.patch('/api/v2/cards/:id', { preHandler: requirePerm('cards:manage') }, async (req, reply) =>
    setCardActive((req as any).merchant.id, (req.params as any).id, (req.body as any)?.active === true) ? { success: true } : reply.status(404).send({ success: false, error: 'not_found' }));

  app.delete('/api/v2/cards/:id', { preHandler: requirePerm('cards:manage') }, async (req, reply) =>
    deleteCard((req as any).merchant.id, (req.params as any).id) ? { success: true } : reply.status(404).send({ success: false, error: 'not_found' }));

  app.post('/api/v2/invoices', { preHandler: requirePerm('invoices:create') }, async (req, reply) => {
    try {
      return reply.status(201).send({ success: true, invoice: await createInvoice((req as any).merchant.id, (req.body || {}) as any) });
    } catch (e) {
      return storeReply(reply, e);
    }
  });

  // Telegram / Bale bot linking
  app.get('/api/v2/bots', async (req) => ({
    success: true,
    platforms: (['telegram', 'bale'] as const).map((p) => ({ platform: p, configured: botConfigured(p), username: botUsername(p) })),
    links: listLinks((req as any).merchant.id),
  }));
  app.post('/api/v2/bots/link-code', { preHandler: requirePerm('bots:manage') }, async (req) => ({ success: true, ...createLinkCode((req as any).merchant.id) }));
  app.patch('/api/v2/bots/:id', { preHandler: requirePerm('bots:manage') }, async (req, reply) =>
    setLinkNotify((req as any).merchant.id, (req.params as any).id, (req.body as any)?.notify === true) ? { success: true } : reply.status(404).send({ success: false, error: 'not_found' }));
  app.delete('/api/v2/bots/:id', { preHandler: requirePerm('bots:manage') }, async (req, reply) =>
    unlink((req as any).merchant.id, (req.params as any).id) ? { success: true } : reply.status(404).send({ success: false, error: 'not_found' }));

  app.get('/api/v2/dashboard', async (req) => {
    const m = (req as any).merchant;
    const d = db();
    const dayStart = utcSql(startOfTehranDay());
    const monthStart = utcSql(startOfTehranMonth());
    const nowIso = new Date().toISOString();
    const soonIso = new Date(Date.now() + 10 * 60_000).toISOString();
    const one = (sql: string, ...p: any[]) => d.prepare(sql).get(...p) as any;
    const today = one(`SELECT coalesce(sum(amount),0) AS s, count(*) AS n FROM transactions WHERE merchant_id = ? AND is_verified = 1 AND created_at >= ?`, m.id, dayStart);
    const month = one(`SELECT coalesce(sum(amount),0) AS s FROM transactions WHERE merchant_id = ? AND is_verified = 1 AND created_at >= ?`, m.id, monthStart);
    const open = one(`SELECT count(*) AS n FROM invoices WHERE merchant_id = ? AND status = 'PENDING' AND expires_at > ?`, m.id, nowIso);
    const expiring = one(`SELECT count(*) AS n FROM invoices WHERE merchant_id = ? AND status = 'PENDING' AND expires_at > ? AND expires_at <= ?`, m.id, nowIso, soonIso);
    const orphan = one(`SELECT count(*) AS n FROM unmatched_sms u JOIN devices dv ON dv.id = u.device_id WHERE dv.merchant_id = ? AND u.status IN ('UNMATCHED','SUSPICIOUS')`, m.id);
    const dev = one(`SELECT count(*) AS n, sum(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS online, max(last_seen) AS last FROM devices WHERE merchant_id = ? AND revoked_at IS NULL`, utcSql(new Date(Date.now() - 3 * 60_000)), m.id);
    const cards = one(`SELECT count(*) AS n FROM payment_methods WHERE merchant_id = ? AND is_active = 1`, m.id);
    const invoices = one(`SELECT count(*) AS n FROM invoices WHERE merchant_id = ?`, m.id);
    const recent = d
      .prepare(`SELECT id, provider, amount, is_verified, order_id, created_at FROM transactions WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 8`)
      .all(m.id) as any[];
    const recentInvoices = d
      .prepare(`SELECT id, expected_amount, status, channel, note, created_at, expires_at FROM invoices WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 6`)
      .all(m.id) as any[];
    const hourly = new Array(24).fill(0);
    for (const r of d.prepare(`SELECT amount, created_at FROM transactions WHERE merchant_id = ? AND is_verified = 1 AND created_at >= ?`).all(m.id, dayStart) as any[]) {
      hourly[tehranParts(new Date(String(r.created_at).replace(' ', 'T') + 'Z')).hour] += Number(r.amount);
    }
    const iso = (s: string) => (s ? new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z')).toISOString() : null);
    return {
      success: true,
      merchant: publicMe(m),
      kpi: {
        today_rial: Number(today.s),
        today_count: Number(today.n),
        month_rial: Number(month.s),
        open_invoices: Number(open.n),
        expiring_invoices: Number(expiring.n),
        orphan_deposits: Number(orphan.n),
        devices: Number(dev.n || 0),
        devices_online: Number(dev.online || 0),
        device_last_seen: iso(dev.last),
        cards: Number(cards.n),
        invoices: Number(invoices.n),
      },
      hourly_rial: hourly,
      recent: recent.map((r) => ({ id: r.id, bank: r.provider, amount_rial: Number(r.amount), matched: !!r.is_verified, invoice_id: r.order_id, at: iso(r.created_at) })),
      recent_invoices: recentInvoices.map((r) => ({
        id: r.id,
        amount_rial: Number(r.expected_amount),
        status: r.status === 'PENDING' && r.expires_at < nowIso ? 'EXPIRED' : r.status,
        channel: r.channel,
        note: r.note,
        at: iso(r.created_at),
      })),
      webhook_configured: !!m.webhook_url,
      onboarding: {
        card: Number(cards.n) > 0,
        device: Number(dev.n || 0) > 0,
        bot: false,
        invoice: Number(invoices.n) > 0,
      },
    };
  });

  for (const feature of V2_FEATURES) await app.register(feature);
}

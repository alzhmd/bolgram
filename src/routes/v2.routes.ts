import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { dbService } from '../db/database.js';
import { InvoiceRepository } from '../db/repositories/invoice.repository.js';
import { CryptoUtil } from '../utils/crypto.js';
import { handleProblem, handleSuggestions, normalizeEmail, normalizeMobile, passwordProblem, toLatinDigits } from '../utils/validate.js';
import { OtpError, sendOtp, verifyOtp } from '../services/otp.service.js';
import { startOfTehranDay, startOfTehranMonth, tehranParts } from '../parsers/ir/jalali.js';
import { BANKS, bankByBin } from '../parsers/ir/registry.js';
import { encryptCard, decryptCard } from '../utils/card-crypto.js';

/**
 * Panel API v2 (used by /panel). Auth: store handle + mobile + password, SMS.IR codes,
 * lockout after repeated failures, session revocation via token_version.
 */
const db = () => (dbService as any).db as import('node:sqlite').DatabaseSync;

export function ensurePanelSchema() {
  const d = db();
  const cols = new Set((d.prepare('PRAGMA table_info(merchants)').all() as any[]).map((c) => c.name));
  for (const [n, t] of [['handle', 'TEXT'], ['mobile_verified', 'INTEGER DEFAULT 0'], ['token_version', 'INTEGER DEFAULT 0']]) {
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
]);

function issueToken(m: any, remember: boolean) {
  return CryptoUtil.signJwt({ id: m.id, role: 'merchant', tv: Number(m.token_version || 0) }, undefined, remember ? 24 * 30 : 12);
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

function luhnOk(num: string) {
  if (!/^\d{16}$/.test(num)) return false;
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let n = Number(num[15 - i]);
    if (i % 2) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

function utcSql(d: Date) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export async function v2Routes(app: FastifyInstance) {
  ensurePanelSchema();

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/v2/') || PUBLIC.has(path)) return;
    const h = req.headers.authorization;
    const v = typeof h === 'string' && h.startsWith('Bearer ') ? CryptoUtil.verifyJwt(h.slice(7)) : { valid: false as const };
    const p: any = (v as any).payload;
    if (!v.valid || p?.role !== 'merchant') return reply.status(401).send({ success: false, error: 'session_expired' });
    const m = db().prepare('SELECT * FROM merchants WHERE id = ?').get(p.id) as any;
    if (!m || Number(m.token_version || 0) !== Number(p.tv || 0)) return reply.status(401).send({ success: false, error: 'session_expired' });
    (req as any).merchant = m;
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

  app.get('/api/v2/me', async (req) => ({ success: true, merchant: publicMe((req as any).merchant) }));

  app.get('/api/v2/cards', async (req) => {
    const m = (req as any).merchant;
    const rows = db().prepare('SELECT * FROM payment_methods WHERE merchant_id = ? ORDER BY sort_order, created_at').all(m.id) as any[];
    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        bank: r.provider_type,
        title: r.title,
        holder: r.account_name,
        last4: r.last4 || String(decryptCard(r.account_number) || '').replace(/\D/g, '').slice(-4),
        active: !!r.is_active,
      })),
    };
  });

  app.get('/api/v2/banks', async () => ({ success: true, data: BANKS.map((b) => ({ id: b.id, name: b.nameFa, short: b.shortFa, color: b.color, bins: b.bins })) }));

  app.post('/api/v2/cards', async (req, reply) => {
    const m = (req as any).merchant;
    const b = (req.body || {}) as any;
    const num = toLatinDigits(String(b.number ?? '')).replace(/\D/g, '');
    const errors: Record<string, string> = {};
    if (!luhnOk(num)) errors.number = 'شماره کارت معتبر نیست (۱۶ رقم)';
    const holder = typeof b.holder === 'string' ? b.holder.trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک').slice(0, 80) : '';
    if (holder.length < 3) errors.holder = 'نام صاحب کارت را وارد کنید';
    if (Object.keys(errors).length) return reply.status(422).send({ success: false, error: 'validation', errors });
    const bank = bankByBin(num);
    if (!bank) return reply.status(422).send({ success: false, error: 'validation', errors: { number: 'بانک این کارت شناخته نشد' } });
    const hash = crypto.createHmac('sha256', 'card-index').update(num).digest('hex');
    if (db().prepare('SELECT 1 FROM payment_methods WHERE merchant_id = ? AND card_hash = ?').get(m.id, hash)) {
      return reply.status(409).send({ success: false, error: 'validation', errors: { number: 'این کارت قبلاً ثبت شده است' } });
    }
    const info = BANKS.find((x) => x.id === bank)!;
    const id = 'pm_' + crypto.randomBytes(8).toString('hex');
    const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 40) : info.nameFa;
    db()
      .prepare(`INSERT INTO payment_methods (id, merchant_id, provider_type, title, account_number, account_name, bank_name, theme_color, is_active, last4, card_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(id, m.id, bank, label, encryptCard(num), holder, info.nameFa, info.color, num.slice(-4), hash);
    return reply.status(201).send({ success: true, data: { id, bank, title: label, holder, last4: num.slice(-4), active: true } });
  });

  app.patch('/api/v2/cards/:id', async (req, reply) => {
    const m = (req as any).merchant;
    const active = (req.body as any)?.active === true ? 1 : 0;
    const r = db().prepare('UPDATE payment_methods SET is_active = ? WHERE id = ? AND merchant_id = ?').run(active, (req.params as any).id, m.id);
    return Number(r.changes) ? { success: true } : reply.status(404).send({ success: false, error: 'not_found' });
  });

  app.delete('/api/v2/cards/:id', async (req, reply) => {
    const m = (req as any).merchant;
    const r = db().prepare('DELETE FROM payment_methods WHERE id = ? AND merchant_id = ?').run((req.params as any).id, m.id);
    return Number(r.changes) ? { success: true } : reply.status(404).send({ success: false, error: 'not_found' });
  });

  app.post('/api/v2/invoices', async (req, reply) => {
    const m = (req as any).merchant;
    const b = (req.body || {}) as any;
    const toman = Number(toLatinDigits(String(b.amount ?? '')).replace(/[^\d]/g, ''));
    if (!Number.isSafeInteger(toman) || toman < 1000 || toman > 1_000_000_000) {
      return reply.status(422).send({ success: false, error: 'validation', errors: { amount: 'مبلغ باید بین ۱٬۰۰۰ تا ۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان باشد' } });
    }
    const cards = db().prepare('SELECT count(*) AS n FROM payment_methods WHERE merchant_id = ? AND is_active = 1').get(m.id) as any;
    if (!Number(cards.n)) return reply.status(409).send({ success: false, error: 'no_card', message: 'اول یک کارت بانکی فعال اضافه کنید' });
    const channels = ['instagram', 'telegram', 'in_person', 'website', 'other'];
    const channel = channels.includes(b.channel) ? b.channel : 'other';
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 200) : '';
    const invoiceId = 'INV' + crypto.randomBytes(5).toString('hex').toUpperCase();
    const inv = await InvoiceRepository.create({ merchantId: m.id, invoiceId, customerName: note || 'فاکتور', amount: toman * 10, expiresInMinutes: 30 });
    db().prepare('UPDATE invoices SET channel = ?, note = ? WHERE id = ?').run(channel, note || null, inv.invoice_id);
    return reply.status(201).send({
      success: true,
      invoice: { id: inv.invoice_id, amount_rial: inv.amount, amount_toman: inv.amount / 10, base_toman: toman, channel, note, expires_at: inv.expires_at, pay_path: `/checkout.html?invoice_id=${encodeURIComponent(inv.invoice_id)}` },
    });
  });

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
    const dev = one(`SELECT count(*) AS n, sum(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS online, max(last_seen) AS last FROM devices WHERE merchant_id = ?`, utcSql(new Date(Date.now() - 3 * 60_000)), m.id);
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
}

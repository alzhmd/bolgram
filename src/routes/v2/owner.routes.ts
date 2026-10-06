import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { db, fail, isoOf, paging, str, utcSql } from './_kit.js';
import { audit } from '../../services/access.js';
import { UPLOAD_DIR, UploadError, saveDataUrl } from '../../utils/uploads.js';
import { MfsParser } from '../../parsers/mfs.parser.js';
import { parseBankMessage, type ParseContext } from '../../parsers/ir/parser.js';
import { BANKS, BANK_BY_ID } from '../../parsers/ir/registry.js';
import { BUILTIN_TEMPLATES, compileTemplate } from '../../parsers/ir/templates.js';
import { normalizeText } from '../../parsers/ir/persian.js';
import { startOfTehranDay } from '../../parsers/ir/jalali.js';
import { getSettings } from '../../services/billing.service.js';
import { botConfigured, botUsername, publicBase } from '../../bot/bot.service.js';
import { normalizeEmail, toLatinDigits } from '../../utils/validate.js';

/**
 * Feature plugin "owner": platform-owner admin API (/api/owner/*, admin JWT enforced by the v2Routes hook).
 * Overview KPIs, stores (suspend / activate / revoke sessions), audit trail, marketing-site content
 * (+ public GET /api/pub/site), SMS lab and system health. Other owner endpoints live in their feature plugins.
 */

const DAY = 86_400_000;
const TEHRAN_OFFSET_MIN = 210; // UTC+03:30, no DST
const ONLINE_MS = 3 * 60_000;

const tableExists = (name: string) => !!db().prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);
const colExists = (table: string, col: string) => (db().prepare(`PRAGMA table_info(${table})`).all() as any[]).some((c) => c.name === col);
const one = (sql: string, ...p: any[]) => db().prepare(sql).get(...p) as any;
const rows = (sql: string, ...p: any[]) => db().prepare(sql).all(...p) as any[];
const tehranDay = (ms: number) => new Date(ms + TEHRAN_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
const adminOf = (req: any) => String(req.admin?.email || 'admin');
const msIso = (ms: unknown) => (ms ? new Date(Number(ms)).toISOString() : null);

/** ?from&to (ISO date = Tehran day, or ISO datetime) → [from, to) in epoch ms; default last 30 Tehran days. null = invalid. */
function rangeOf(q: any): { from: number; to: number } | null {
  const parse = (v: unknown, end: boolean) => {
    const s = String(v ?? '').trim();
    if (!s) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const t = Date.parse(`${s}T00:00:00+03:30`);
      return Number.isNaN(t) ? NaN : t + (end ? DAY : 0);
    }
    return Date.parse(s);
  };
  const f = parse(q?.from, false);
  const t = parse(q?.to, true);
  if (Number.isNaN(f) || Number.isNaN(t)) return null;
  const to = t ?? Date.now() + 60_000;
  const from = f ?? startOfTehranDay().getTime() - 29 * DAY;
  if (from >= to || to - from > 366 * DAY) return null;
  return { from, to };
}

// ------------------------------------------------------------------ site content

interface SiteContent {
  hero: { title: string; subtitle: string };
  announcement: { text: string; href: string; active: boolean };
  contact: { phone: string; email: string; telegram: string; instagram: string; address: string };
  logo_url: string | null;
  faq: { q: string; a: string }[];
  footer: string;
}
const emptySite = (): SiteContent => ({
  hero: { title: '', subtitle: '' },
  announcement: { text: '', href: '', active: false },
  contact: { phone: '', email: '', telegram: '', instagram: '', address: '' },
  logo_url: null,
  faq: [],
  footer: '',
});

function loadSite(): SiteContent {
  const base = emptySite();
  const row = one(`SELECT value FROM system_settings WHERE key = 'site_content'`);
  let saved: any = {};
  try { saved = row ? JSON.parse(row.value) : {}; } catch { /* defaults */ }
  return {
    hero: { ...base.hero, ...(saved.hero || {}) },
    announcement: { ...base.announcement, ...(saved.announcement || {}), active: saved.announcement?.active === true },
    contact: { ...base.contact, ...(saved.contact || {}) },
    logo_url: typeof saved.logo_url === 'string' && /^\/uploads\/[a-f0-9]{24}\.(png|jpg|webp)$/.test(saved.logo_url) ? saved.logo_url : null,
    faq: Array.isArray(saved.faq) ? saved.faq.filter((x: any) => x && typeof x.q === 'string' && typeof x.a === 'string').slice(0, 30) : [],
    footer: typeof saved.footer === 'string' ? saved.footer : '',
  };
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? str(v, max + 1) : '');

/** Validates an owner edit against the current content. Returns the new content or field errors (flat keys like `faq.2.q`). */
function cleanSite(input: any, cur: SiteContent): { site?: SiteContent; errors?: Record<string, string> } {
  const errors: Record<string, string> = {};
  const next: SiteContent = JSON.parse(JSON.stringify(cur));
  const len = (key: string, v: string, max: number, label: string, required = false) => {
    if (required && v.length < 1) errors[key] = `${label} را وارد کنید`;
    else if (v.length > max) errors[key] = `${label} حداکثر ${max} نویسه باشد`;
  };
  if (input.hero !== undefined) {
    const h = input.hero || {};
    const title = text(h.title ?? cur.hero.title, 120), subtitle = text(h.subtitle ?? cur.hero.subtitle, 400);
    len('hero.title', title, 120, 'عنوان');
    len('hero.subtitle', subtitle, 400, 'زیرعنوان');
    next.hero = { title, subtitle };
  }
  if (input.announcement !== undefined) {
    const a = input.announcement || {};
    const t = text(a.text ?? cur.announcement.text, 200);
    let href = typeof (a.href ?? cur.announcement.href) === 'string' ? String(a.href ?? cur.announcement.href).trim() : '';
    const active = (a.active ?? cur.announcement.active) === true;
    len('announcement.text', t, 200, 'متن اعلان');
    if (active && !t) errors['announcement.text'] = 'برای نمایش اعلان، متن آن را بنویسید';
    if (href) {
      let ok = false;
      if (href.length <= 300 && /^\/[A-Za-z0-9\-._~/?#=&%]*$/.test(href)) ok = true;
      else if (href.length <= 300) {
        try { const u = new URL(href); ok = u.protocol === 'https:' && !!u.hostname.includes('.'); } catch { ok = false; }
      }
      if (!ok) errors['announcement.href'] = 'لینک باید با https:// شروع شود یا مسیری مثل /pricing.html باشد';
    }
    next.announcement = { text: t, href, active };
  }
  if (input.contact !== undefined) {
    const c = input.contact || {};
    const pick = (k: keyof SiteContent['contact']) => (typeof c[k] === 'string' ? c[k] : cur.contact[k]);
    const phone = toLatinDigits(text(pick('phone'), 24));
    if (phone && !/^[0-9+\-\s()]{5,24}$/.test(phone)) errors['contact.phone'] = 'شمارهٔ تماس معتبر نیست';
    const emailRaw = text(pick('email'), 120);
    const email = emailRaw ? normalizeEmail(emailRaw) : '';
    if (emailRaw && !email) errors['contact.email'] = 'ایمیل معتبر نیست';
    const social = (key: 'telegram' | 'instagram', host: RegExp, handle: RegExp, url: (h: string) => string, label: string) => {
      const raw = text(pick(key), 200);
      if (!raw) return '';
      if (handle.test(raw.replace(/^@/, ''))) return url(raw.replace(/^@/, ''));
      try {
        const u = new URL(raw);
        if (u.protocol === 'https:' && host.test(u.hostname) && /^\/[A-Za-z0-9_.+/-]{1,60}$/.test(u.pathname)) return `https://${u.hostname.replace(/^www\./, '')}${u.pathname}`;
      } catch { /* invalid */ }
      errors[`contact.${key}`] = `${label} معتبر نیست؛ نام کاربری یا لینک کامل را وارد کنید`;
      return '';
    };
    const telegram = social('telegram', /^(www\.)?(t|telegram)\.me$/i, /^[A-Za-z0-9_]{5,32}$/, (h) => `https://t.me/${h}`, 'آیدی تلگرام');
    const instagram = social('instagram', /^(www\.)?instagram\.com$/i, /^[A-Za-z0-9_.]{1,30}$/, (h) => `https://instagram.com/${h}`, 'آیدی اینستاگرام');
    const address = text(pick('address'), 300);
    len('contact.address', address, 300, 'نشانی');
    next.contact = { phone, email: email || '', telegram, instagram, address };
  }
  if (input.footer !== undefined) {
    const footer = text(input.footer, 300);
    len('footer', footer, 300, 'متن پایین سایت');
    next.footer = footer;
  }
  if (input.faq !== undefined) {
    if (!Array.isArray(input.faq) || input.faq.length > 30) errors.faq = 'حداکثر ۳۰ سؤال مجاز است';
    else {
      const out: { q: string; a: string }[] = [];
      input.faq.forEach((it: any, i: number) => {
        const q = text(it?.q, 200), a = text(it?.a, 1500);
        if (!q && !a) return;
        if (q.length < 3) errors[`faq.${i}.q`] = 'سؤال را بنویسید (حداقل ۳ نویسه)';
        else if (q.length > 200) errors[`faq.${i}.q`] = 'سؤال حداکثر ۲۰۰ نویسه باشد';
        if (a.length < 3) errors[`faq.${i}.a`] = 'پاسخ را بنویسید (حداقل ۳ نویسه)';
        else if (a.length > 1500) errors[`faq.${i}.a`] = 'پاسخ حداکثر ۱۵۰۰ نویسه باشد';
        out.push({ q, a });
      });
      next.faq = out;
    }
  }
  if (Object.keys(errors).length) return { errors };
  return { site: next };
}

function dropUpload(url: string | null) {
  const m = url?.match(/^\/uploads\/([a-f0-9]{24}\.(png|jpg|webp))$/);
  if (!m) return;
  try { fs.unlinkSync(path.join(UPLOAD_DIR, 'public', m[1])); } catch { /* already gone */ }
}

// ------------------------------------------------------------------ SMS lab

const labCtx: ParseContext = {
  banks: BANKS.map((b) => ({ id: b.id, senders: b.senders, keywords: b.keywords.map(normalizeText), notificationPackages: [] })),
  templates: BUILTIN_TEMPLATES.map((t) => compileTemplate(t)!).filter(Boolean),
};

function bankView(id: string | null) {
  const b = id ? BANK_BY_ID.get(id) : null;
  return b ? { id: b.id, name_fa: b.nameFa, short_fa: b.shortFa, color: b.color, senders: b.senders, parent: b.parent || null } : null;
}

function verdictOf(kind: string, direction: string | null, ok: boolean, trusted: boolean): string {
  if (kind === 'sensitive') return 'این پیامک رمز یا کد تأیید است؛ هرگز خوانده یا ذخیره نمی‌شود.';
  if (kind !== 'transaction') return 'پیامک تراکنشی تشخیص داده نشد؛ نادیده گرفته می‌شود.';
  if (direction === 'debit') return 'پیامک برداشت است و نادیده گرفته می‌شود؛ فقط واریز پذیرفته می‌شود.';
  if (!ok) return 'پیامک تراکنشی است اما مبلغ یا قالب آن کامل خوانده نشد.';
  return trusted
    ? 'واریز معتبر خوانده شد؛ اگر فاکتور هم‌مبلغ باز باشد خودکار تأیید می‌شود.'
    : 'واریز خوانده شد اما فرستنده ناشناس است؛ در صف بررسی دستی (مشکوک) می‌ماند.';
}

// ------------------------------------------------------------------ plugin

export default async function ownerRoutes(app: FastifyInstance) {
  const rl = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

  // ================================================================ overview

  app.get('/api/owner/overview', async (req, reply) => {
    const r = rangeOf(req.query);
    if (!r) return fail(reply, 422, 'validation', 'بازهٔ تاریخ نامعتبر است (حداکثر ۳۶۶ روز)');
    const fromS = utcSql(new Date(r.from));
    const toS = utcSql(new Date(r.to));
    const dayS = utcSql(startOfTehranDay());
    const platformId = String(getSettings().platform_merchant_id || '');
    const PAID = `status = 'PAID' AND merchant_id != ?`;

    const stores = one(`SELECT count(*) AS total, sum(CASE WHEN status = 'SUSPENDED' THEN 1 ELSE 0 END) AS suspended,
      sum(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS fresh FROM merchants`, fromS, toS);
    const active = one(`SELECT count(DISTINCT merchant_id) AS n FROM invoices WHERE ${PAID} AND created_at >= ? AND created_at < ?`, platformId, fromS, toS);
    const vol = one(`SELECT coalesce(sum(expected_amount), 0) AS s, count(*) AS n FROM invoices WHERE ${PAID} AND created_at >= ? AND created_at < ?`, platformId, fromS, toS);
    const today = one(`SELECT coalesce(sum(expected_amount), 0) AS s, count(*) AS n FROM invoices WHERE ${PAID} AND created_at >= ?`, platformId, dayS);
    const byDay = new Map<string, any>(
      rows(`SELECT date(created_at, '+${TEHRAN_OFFSET_MIN} minutes') AS day, sum(expected_amount) AS s, count(*) AS n FROM invoices WHERE ${PAID} AND created_at >= ? AND created_at < ? GROUP BY day`, platformId, fromS, toS).map((x) => [x.day, x]),
    );
    const daily: { day: string; paid_rial: number; paid_count: number }[] = [];
    for (let t = r.from, guard = 0; tehranDay(t) <= tehranDay(r.to - 1) && guard < 400; t += DAY, guard++) {
      const day = tehranDay(t);
      const x = byDay.get(day);
      daily.push({ day, paid_rial: Number(x?.s || 0), paid_count: Number(x?.n || 0) });
    }
    const top = rows(`SELECT m.id, m.handle, m.name, sum(i.expected_amount) AS s, count(*) AS n FROM invoices i JOIN merchants m ON m.id = i.merchant_id
      WHERE i.status = 'PAID' AND i.merchant_id != ? AND i.created_at >= ? AND i.created_at < ? GROUP BY m.id ORDER BY s DESC LIMIT 5`, platformId, fromS, toS);
    const held = one(`SELECT count(*) AS n, coalesce(sum(amount), 0) AS s FROM unmatched_sms WHERE status IN ('UNMATCHED', 'SUSPICIOUS')`);
    const live = colExists('devices', 'revoked_at') ? 'WHERE revoked_at IS NULL' : '';
    const dev = one(`SELECT count(*) AS n, coalesce(sum(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END), 0) AS online FROM devices ${live}`, utcSql(new Date(Date.now() - ONLINE_MS)));
    const tickets = tableExists('ticket_threads')
      ? one(`SELECT coalesce(sum(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) AS open, coalesce(sum(CASE WHEN status != 'closed' THEN 1 ELSE 0 END), 0) AS active FROM ticket_threads`)
      : null;
    const trust = tableExists('trust_requests') ? one(`SELECT count(*) AS n FROM trust_requests WHERE status = 'pending'`) : null;
    let revenue: any = null;
    if (tableExists('wallet_ledger')) {
      const by = new Map<string, number>(rows(`SELECT kind, coalesce(sum(amount_rial), 0) AS s FROM wallet_ledger WHERE created_at >= ? AND created_at < ? GROUP BY kind`, r.from, r.to).map((x) => [x.kind, Number(x.s)]));
      revenue = {
        fees_rial: Math.abs(by.get('fee') || 0),
        plan_sales_rial: Math.abs(by.get('plan') || 0),
        topups_rial: by.get('topup') || 0,
      };
    }
    const hooks = tableExists('webhook_deliveries')
      ? one(`SELECT count(*) AS n FROM webhook_deliveries WHERE status = 'FAILED' AND created_at > ?`, Date.now() - DAY)
      : null;
    return {
      success: true,
      from: new Date(r.from).toISOString(),
      to: new Date(r.to).toISOString(),
      stores: { total: Number(stores.total), new_in_range: Number(stores.fresh || 0), active_in_range: Number(active.n), suspended: Number(stores.suspended || 0) },
      volume: { range_rial: Number(vol.s), range_count: Number(vol.n), today_rial: Number(today.s), today_count: Number(today.n) },
      held_deposits: { count: Number(held.n), amount_rial: Number(held.s) },
      devices: { online: Number(dev.online), total: Number(dev.n) },
      tickets: tickets ? { open: Number(tickets.open), active: Number(tickets.active) } : null,
      trust_pending: trust ? Number(trust.n) : null,
      revenue,
      webhook_failures_24h: hooks ? Number(hooks.n) : null,
      top_stores: top.map((x) => ({ id: x.id, handle: x.handle, name: x.name, paid_rial: Number(x.s), paid_count: Number(x.n) })),
      daily,
      note: 'حجم پرداخت شامل فاکتورهای فروشگاه پلتفرم (شارژ کیف پول) نیست.',
    };
  });

  // ================================================================ stores

  const planNames = () => {
    const map = new Map<string, string>();
    if (tableExists('billing_plans')) for (const p of rows(`SELECT id, name FROM billing_plans`)) map.set(String(p.id).toUpperCase(), p.name);
    return map;
  };

  app.get('/api/owner/merchants', async (req) => {
    const q = (req.query || {}) as any;
    const p = paging(q);
    const where: string[] = [];
    const params: any[] = [];
    const term = str(q.q, 80);
    if (term) {
      where.push(`(m.handle LIKE ? ESCAPE '\\' OR m.name LIKE ? ESCAPE '\\' OR m.phone LIKE ? ESCAPE '\\' OR lower(m.email) LIKE ? ESCAPE '\\' OR m.id = ?)`);
      const like = `%${term.replace(/[\\%_]/g, (c) => '\\' + c).toLowerCase()}%`;
      const likeRaw = `%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      params.push(like, likeRaw, `%${toLatinDigits(term).replace(/[\\%_]/g, (c) => '\\' + c)}%`, like, term);
    }
    if (q.status === 'ACTIVE' || q.status === 'SUSPENDED') { where.push(`coalesce(m.status, 'ACTIVE') = ?`); params.push(q.status); }
    const plan = str(q.plan, 40);
    if (plan) { where.push(`upper(m.plan) = upper(?)`); params.push(plan); }
    const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const since30 = utcSql(new Date(Date.now() - 30 * DAY));
    const online = utcSql(new Date(Date.now() - ONLINE_MS));
    const live = colExists('devices', 'revoked_at') ? 'AND d.revoked_at IS NULL' : '';
    const hasWallet = tableExists('wallet_balances');
    const total = Number(one(`SELECT count(*) AS n FROM merchants m ${W}`, ...params).n);
    const order = q.sort === 'volume' ? 'vol30 DESC, m.created_at DESC' : 'm.created_at DESC, m.rowid DESC';
    const data = rows(
      `SELECT m.id, m.handle, m.name, m.phone, m.email, coalesce(m.status, 'ACTIVE') AS status, m.plan, m.created_at,
        (SELECT coalesce(sum(i.expected_amount), 0) FROM invoices i WHERE i.merchant_id = m.id AND i.status = 'PAID' AND i.created_at >= ?) AS vol30,
        (SELECT count(*) FROM invoices i WHERE i.merchant_id = m.id AND i.status = 'PAID' AND i.created_at >= ?) AS n30,
        (SELECT count(*) FROM devices d WHERE d.merchant_id = m.id ${live} AND d.last_seen >= ?) AS dev_online,
        (SELECT count(*) FROM payment_methods c WHERE c.merchant_id = m.id) AS cards
        ${hasWallet ? ', (SELECT w.balance_rial FROM wallet_balances w WHERE w.merchant_id = m.id) AS wallet' : ''}
       FROM merchants m ${W} ORDER BY ${order} LIMIT ? OFFSET ?`,
      since30, since30, online, ...params, p.limit, p.offset,
    );
    const names = planNames();
    return {
      success: true,
      data: data.map((m) => ({
        id: m.id, handle: m.handle, name: m.name, mobile: m.phone, email: m.email || null, status: m.status,
        plan: m.plan || 'FREE', plan_name: names.get(String(m.plan || 'FREE').toUpperCase()) || m.plan || 'FREE',
        created_at: isoOf(m.created_at),
        paid_30d_rial: Number(m.vol30), paid_30d_count: Number(m.n30),
        wallet_balance_rial: hasWallet ? Number(m.wallet || 0) : null,
        devices_online: Number(m.dev_online), cards_count: Number(m.cards),
      })),
      page: p.page, per_page: p.perPage, total,
    };
  });

  const loadStore = (id: string) => one(`SELECT * FROM merchants WHERE id = ?`, String(id).slice(0, 60));

  app.get('/api/owner/merchants/:id', async (req, reply) => {
    const m = loadStore((req.params as any).id);
    if (!m) return fail(reply, 404, 'not_found', 'فروشگاه پیدا نشد');
    const since30 = utcSql(new Date(Date.now() - 30 * DAY));
    const nowIso = new Date().toISOString();
    const paid30 = one(`SELECT coalesce(sum(expected_amount), 0) AS s, count(*) AS n FROM invoices WHERE merchant_id = ? AND status = 'PAID' AND created_at >= ?`, m.id, since30);
    const paidAll = one(`SELECT coalesce(sum(expected_amount), 0) AS s, count(*) AS n, max(created_at) AS last FROM invoices WHERE merchant_id = ? AND status = 'PAID'`, m.id);
    const inv = one(`SELECT count(*) AS n, sum(CASE WHEN status = 'PENDING' AND expires_at > ? THEN 1 ELSE 0 END) AS open FROM invoices WHERE merchant_id = ?`, nowIso, m.id);
    const held = one(`SELECT count(*) AS n FROM unmatched_sms u JOIN devices d ON d.id = u.device_id WHERE d.merchant_id = ? AND u.status IN ('UNMATCHED', 'SUSPICIOUS')`, m.id);
    const hasRevoked = colExists('devices', 'revoked_at');
    const hasKind = colExists('devices', 'kind');
    const onlineAt = Date.now() - ONLINE_MS;
    const devices = rows(`SELECT * FROM devices WHERE merchant_id = ? ORDER BY last_seen DESC LIMIT 20`, m.id).map((d) => ({
      id: d.id, name: d.device_name, model: d.device_model || null, kind: hasKind ? d.kind || 'android' : 'android',
      app_version: d.app_version || null, battery: d.battery_level ?? null, last_seen: isoOf(d.last_seen),
      revoked: hasRevoked ? !!d.revoked_at : false,
      online: !(hasRevoked && d.revoked_at) && !!d.last_seen && (isoOf(d.last_seen) ? new Date(isoOf(d.last_seen)!).getTime() >= onlineAt : false),
    }));
    const cards = rows(`SELECT id, provider_type, title, account_name, last4, is_active FROM payment_methods WHERE merchant_id = ? ORDER BY sort_order, rowid LIMIT 30`, m.id).map((c) => ({
      id: c.id, bank: c.provider_type, bank_name: BANK_BY_ID.get(c.provider_type)?.nameFa || c.provider_type, title: c.title || null, holder: c.account_name || null, last4: c.last4 || null, active: !!c.is_active,
    }));
    const recent = rows(`SELECT id, expected_amount, status, channel, note, customer_name, created_at, expires_at FROM invoices WHERE merchant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10`, m.id).map((i) => ({
      id: i.id, amount_rial: Number(i.expected_amount), status: i.status === 'PENDING' && i.expires_at < nowIso ? 'EXPIRED' : i.status,
      channel: i.channel || null, note: i.note || i.customer_name || null, created_at: isoOf(i.created_at),
    }));
    const team = one(`SELECT count(*) AS n FROM team_members WHERE merchant_id = ? AND status = 'active'`, m.id);
    const bots = tableExists('bot_links') ? one(`SELECT count(*) AS n FROM bot_links WHERE merchant_id = ?`, m.id) : { n: 0 };
    const trust = tableExists('trust_requests') ? one(`SELECT status, decided_at FROM trust_requests WHERE merchant_id = ?`, m.id) : null;
    const wallet = tableExists('wallet_balances') ? one(`SELECT balance_rial FROM wallet_balances WHERE merchant_id = ?`, m.id) : null;
    const sub = tableExists('billing_subscriptions')
      ? one(`SELECT ends_at FROM billing_subscriptions WHERE merchant_id = ? AND starts_at <= ? AND ends_at > ? ORDER BY ends_at DESC LIMIT 1`, m.id, Date.now(), Date.now())
      : null;
    const referrer = m.referred_by ? one(`SELECT handle, name FROM merchants WHERE id = ?`, m.referred_by) : null;
    const lastSuspend = m.status === 'SUSPENDED'
      ? one(`SELECT meta, created_at, actor_name FROM audit_log WHERE merchant_id = ? AND action = 'owner.suspend' ORDER BY created_at DESC LIMIT 1`, m.id)
      : null;
    let reason: string | null = null;
    try { reason = lastSuspend?.meta ? JSON.parse(lastSuspend.meta).reason || null : null; } catch { /* no reason */ }
    const names = planNames();
    const log = rows(`SELECT id, action, target, meta, actor_kind, actor_name, created_at FROM audit_log WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 8`, m.id).map(auditView);
    return {
      success: true,
      profile: {
        id: m.id, handle: m.handle, name: m.name, mobile: m.phone, email: m.email || null, status: m.status || 'ACTIVE',
        plan: m.plan || 'FREE', plan_name: names.get(String(m.plan || 'FREE').toUpperCase()) || m.plan || 'FREE', plan_expires_at: msIso(sub?.ends_at),
        created_at: isoOf(m.created_at), mobile_verified: !!m.mobile_verified, webhook_configured: !!m.webhook_url,
        logo_url: m.brand_logo_url || null, referred_by: referrer ? { handle: referrer.handle, name: referrer.name } : null,
        suspended_reason: reason, suspended_at: lastSuspend ? msIso(lastSuspend.created_at) : null,
      },
      stats: {
        paid_30d_rial: Number(paid30.s), paid_30d_count: Number(paid30.n),
        paid_total_rial: Number(paidAll.s), paid_total_count: Number(paidAll.n), last_paid_at: isoOf(paidAll.last),
        invoices_total: Number(inv.n), open_invoices: Number(inv.open || 0), held_deposits: Number(held.n),
        wallet_balance_rial: wallet ? Number(wallet.balance_rial) : tableExists('wallet_balances') ? 0 : null,
      },
      recent_invoices: recent,
      devices,
      cards,
      team_count: Number(team.n),
      bot_links_count: Number(bots.n),
      trust: trust ? { status: trust.status, decided_at: msIso(trust.decided_at) } : null,
      audit: log,
    };
  });

  app.post('/api/owner/merchants/:id/suspend', async (req, reply) => {
    const m = loadStore((req.params as any).id);
    if (!m) return fail(reply, 404, 'not_found', 'فروشگاه پیدا نشد');
    const reason = str((req.body as any)?.reason, 300);
    if (reason.length < 3) return fail(reply, 422, 'validation', 'دلیل تعلیق را بنویسید', { reason: 'دلیل تعلیق حداقل ۳ نویسه باشد' });
    if (m.status === 'SUSPENDED') return fail(reply, 409, 'already_suspended', 'این فروشگاه از قبل معلق است');
    db().prepare(`UPDATE merchants SET status = 'SUSPENDED', token_version = coalesce(token_version, 0) + 1 WHERE id = ?`).run(m.id);
    audit(req, m.id, 'owner.suspend', m.id, { reason, by: adminOf(req) });
    return { success: true, status: 'SUSPENDED' };
  });

  app.post('/api/owner/merchants/:id/activate', async (req, reply) => {
    const m = loadStore((req.params as any).id);
    if (!m) return fail(reply, 404, 'not_found', 'فروشگاه پیدا نشد');
    if ((m.status || 'ACTIVE') !== 'SUSPENDED') return fail(reply, 409, 'already_active', 'این فروشگاه فعال است');
    db().prepare(`UPDATE merchants SET status = 'ACTIVE' WHERE id = ?`).run(m.id);
    audit(req, m.id, 'owner.activate', m.id, { by: adminOf(req) });
    return { success: true, status: 'ACTIVE' };
  });

  app.post('/api/owner/merchants/:id/revoke-sessions', async (req, reply) => {
    const m = loadStore((req.params as any).id);
    if (!m) return fail(reply, 404, 'not_found', 'فروشگاه پیدا نشد');
    db().prepare(`UPDATE merchants SET token_version = coalesce(token_version, 0) + 1 WHERE id = ?`).run(m.id);
    audit(req, m.id, 'owner.revoke_sessions', m.id, { by: adminOf(req) });
    return { success: true };
  });

  // ================================================================ audit

  function auditView(a: any) {
    let meta: any = null;
    try { meta = a.meta ? JSON.parse(a.meta) : null; } catch { meta = null; }
    return {
      id: a.id, merchant_id: a.merchant_id ?? null, store_name: a.store_name ?? null, store_handle: a.store_handle ?? null,
      actor_kind: a.actor_kind, actor_name: a.actor_name || (a.actor_kind === 'admin' ? meta?.by || 'مالک پلتفرم' : null),
      action: a.action, target: a.target || null, meta, ip: a.ip ?? null, created_at: msIso(a.created_at),
    };
  }

  app.get('/api/owner/audit', async (req) => {
    const q = (req.query || {}) as any;
    const p = paging(q);
    const where: string[] = [];
    const params: any[] = [];
    const mid = str(q.merchant_id, 60);
    if (mid) { where.push('a.merchant_id = ?'); params.push(mid); }
    const action = str(q.action, 60);
    if (action) { where.push(`a.action LIKE ? ESCAPE '\\'`); params.push(action.replace(/[\\%_]/g, (c) => '\\' + c) + '%'); }
    const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number(one(`SELECT count(*) AS n FROM audit_log a ${W}`, ...params).n);
    const data = rows(
      `SELECT a.*, m.name AS store_name, m.handle AS store_handle FROM audit_log a LEFT JOIN merchants m ON m.id = a.merchant_id ${W}
       ORDER BY a.created_at DESC, a.rowid DESC LIMIT ? OFFSET ?`, ...params, p.limit, p.offset,
    ).map(auditView);
    const actions = rows(`SELECT action, count(*) AS n FROM audit_log GROUP BY action ORDER BY n DESC LIMIT 80`).map((x) => ({ action: x.action, count: Number(x.n) }));
    return { success: true, data, actions, page: p.page, per_page: p.perPage, total };
  });

  // ================================================================ site content

  app.get('/api/owner/site', async () => {
    const site = loadSite();
    return { success: true, site, logo_preview_url: site.logo_url };
  });

  app.put('/api/owner/site', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const b = (req.body || {}) as any;
    const cur = loadSite();
    const res = cleanSite(b, cur);
    const errors = res.errors ? { ...res.errors } : {};
    let logo: string | null | undefined;
    if (b.logo_data_url !== undefined && b.logo_data_url !== null && b.logo_data_url !== '') {
      try {
        logo = saveDataUrl(b.logo_data_url, { visibility: 'public', maxBytes: 1024 * 1024, allow: ['image/png', 'image/jpeg', 'image/webp'] }).url;
      } catch (e) {
        if (!(e instanceof UploadError)) throw e;
        errors.logo_data_url = e.message;
      }
    } else if (b.remove_logo === true) logo = null;
    if (Object.keys(errors).length) {
      if (typeof logo === 'string') dropUpload(logo);
      return fail(reply, 422, 'validation', 'برخی فیلدها درست نیست', errors);
    }
    const site = res.site!;
    if (logo !== undefined) { dropUpload(cur.logo_url); site.logo_url = logo; }
    db().prepare(`INSERT INTO system_settings (key, value, updated_at) VALUES ('site_content', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(JSON.stringify(site));
    const sections = ['hero', 'announcement', 'contact', 'faq', 'footer'].filter((k) => b[k] !== undefined);
    if (logo !== undefined) sections.push('logo');
    audit(req, null, 'owner.site.update', 'site_content', { sections, by: adminOf(req) });
    return { success: true, site, logo_preview_url: site.logo_url };
  });

  app.get('/api/pub/site', rl(60), async (_req, reply) => {
    const s = loadSite();
    return reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Cache-Control', 'public, max-age=60')
      .send({
        success: true,
        site: {
          hero: s.hero,
          announcement: s.announcement.active && s.announcement.text ? { text: s.announcement.text, href: s.announcement.href || null } : null,
          contact: s.contact,
          logo_url: s.logo_url ? `${publicBase()}${s.logo_url}` : null,
          faq: s.faq,
          footer: s.footer,
        },
      });
  });

  // ================================================================ SMS lab

  app.post('/api/owner/sms-lab', async (req, reply) => {
    const b = (req.body || {}) as any;
    const sender = str(b.sender, 60);
    const body = typeof b.body === 'string' ? b.body.slice(0, 2000) : '';
    const errors: Record<string, string> = {};
    if (!sender) errors.sender = 'فرستنده (شمارهٔ سرشماره یا نام بانک) را وارد کنید';
    if (body.trim().length < 3) errors.body = 'متن پیامک را بچسبانید';
    if (Object.keys(errors).length) return fail(reply, 422, 'validation', 'فرستنده و متن پیامک لازم است', errors);
    const at = new Date();
    const parsed = MfsParser.parse(sender, body, at);
    const d = parseBankMessage({ sender, body, receivedAt: at }, labCtx);
    return {
      success: true,
      parsed: {
        success: parsed.success, provider: parsed.provider, trx_id: parsed.trxId ?? null, amount_rial: parsed.amount ?? null,
        balance_rial: parsed.balance ?? null, account: parsed.account ?? null, payer_card: parsed.sender ?? null,
        bank_time: parsed.bankTime ?? null, trusted: parsed.trusted ?? null, error: parsed.error ?? null,
      },
      detail: {
        kind: d.kind, direction: d.direction, bank_id: d.bankId, bank_source: d.bankSource, sender_norm: d.senderNorm, sender_trusted: d.senderTrusted,
        amount_rial: d.amount, balance_rial: d.balance, account: d.account, card: d.card, payer_card: d.payerCard, payer_name: d.payerName,
        reference: d.reference, description: d.description, bank_time: d.bankTime ? d.bankTime.toISOString() : null,
        template_id: d.templateId, confidence: d.confidence, problems: d.problems,
      },
      bank: bankView(d.bankId || (parsed.provider !== 'UNKNOWN' ? parsed.provider : null)),
      verdict: verdictOf(d.kind, d.direction, parsed.success, !!parsed.trusted),
    };
  });

  app.get('/api/owner/sms-lab/unknown-senders', async () => {
    const since = utcSql(new Date(Date.now() - 30 * DAY));
    const groups = rows(
      `SELECT sender, count(*) AS n, count(DISTINCT device_id) AS devices, max(created_at) AS last_at FROM unmatched_sms
       WHERE status = 'SUSPICIOUS' AND created_at >= ? GROUP BY sender ORDER BY n DESC, last_at DESC LIMIT 100`, since,
    );
    return {
      success: true,
      days: 30,
      data: groups.map((g) => {
        const s = one(`SELECT raw_sms, provider FROM unmatched_sms WHERE sender IS ? AND status = 'SUSPICIOUS' AND created_at >= ? ORDER BY created_at DESC, rowid DESC LIMIT 1`, g.sender, since);
        const sample = String(s?.raw_sms || '').slice(0, 400);
        const guess = sample ? parseBankMessage({ sender: String(g.sender || ''), body: sample, receivedAt: new Date() }, labCtx) : null;
        return {
          sender: g.sender || '', count: Number(g.n), devices: Number(g.devices), last_at: isoOf(g.last_at), sample,
          bank_guess: bankView(guess?.bankId || null), parsed_kind: guess?.kind || null,
        };
      }),
    };
  });

  // ================================================================ health

  app.get('/api/owner/health', async () => {
    type Level = 'ok' | 'warn' | 'error';
    const checks: { id: string; label: string; status: Level; detail: string; value?: string }[] = [];
    const add = (id: string, label: string, status: Level, detail: string, value?: string) => checks.push({ id, label, status, detail, ...(value !== undefined ? { value } : {}) });
    const prod = process.env.NODE_ENV === 'production';
    const has = (k: string) => !!(process.env[k] || '').trim();

    add('jwt_secret', 'کلید نشست‌ها (JWT_SECRET)', has('JWT_SECRET') ? 'ok' : prod ? 'error' : 'warn',
      has('JWT_SECRET') ? 'کلید ثابت تنظیم شده است؛ نشست‌ها بعد از راه‌اندازی دوباره معتبر می‌مانند.' : 'JWT_SECRET تنظیم نشده؛ با هر راه‌اندازی مجدد همهٔ نشست‌ها باطل می‌شود. یک مقدار تصادفی بلند بگذارید.');
    add('node_env', 'حالت اجرا (NODE_ENV)', prod ? 'ok' : 'warn', prod ? 'سرور در حالت production اجرا می‌شود.' : 'سرور در حالت توسعه است؛ برای محیط واقعی NODE_ENV=production بگذارید.', process.env.NODE_ENV || 'تنظیم نشده');
    const base = (process.env.PUBLIC_BASE_URL || '').trim();
    add('public_base_url', 'نشانی عمومی (PUBLIC_BASE_URL)', /^https:\/\//i.test(base) ? 'ok' : base ? 'warn' : 'error',
      /^https:\/\//i.test(base) ? 'لینک پرداخت و ربات‌ها با نشانی امن ساخته می‌شوند.' : base ? 'نشانی با https شروع نمی‌شود؛ دکمهٔ لینک در تلگرام و بله کار نمی‌کند.' : 'PUBLIC_BASE_URL تنظیم نشده؛ لینک‌های پرداخت به localhost اشاره می‌کنند.', base || undefined);
    const sms = has('SMSIR_API_KEY') && has('SMSIR_TEMPLATE_ID');
    add('smsir', 'پیامک SMS.IR', sms ? 'ok' : prod ? 'error' : 'warn',
      sms ? 'کد تأیید موبایل و بازیابی رمز با SMS.IR ارسال می‌شود.' : 'SMSIR_API_KEY یا SMSIR_TEMPLATE_ID تنظیم نشده؛ کد تأیید برای کاربران ارسال نمی‌شود.');
    const tg = botConfigured('telegram'), bale = botConfigured('bale');
    const tokens = has('TELEGRAM_BOT_TOKEN') || has('BALE_BOT_TOKEN');
    add('bots', 'ربات تلگرام و بله', tg || bale ? 'ok' : 'warn',
      tg || bale ? `ربات فعال: ${[tg ? `تلگرام (@${botUsername('telegram') || '—'})` : '', bale ? `بله (@${botUsername('bale') || '—'})` : ''].filter(Boolean).join(' و ')}` : tokens ? 'توکن ربات تنظیم شده اما ربات هنوز بالا نیامده است؛ دسترسی سرور به API ربات را بررسی کنید.' : 'توکن ربات تنظیم نشده؛ اعلان تلگرام و بله کار نمی‌کند.');
    add('card_enc_key', 'کلید رمزنگاری کارت‌ها (CARD_ENC_KEY)', has('CARD_ENC_KEY') ? 'ok' : prod ? 'error' : 'warn',
      has('CARD_ENC_KEY') ? 'شمارهٔ کارت‌ها با کلید اختصاصی رمز می‌شود.' : 'CARD_ENC_KEY تنظیم نشده؛ شمارهٔ کارت‌ها با کلید پیش‌فرض ذخیره می‌شود. پیش از راه‌اندازی واقعی آن را بگذارید.');
    const platformId = String(getSettings().platform_merchant_id || '');
    const platform = platformId ? one(`SELECT m.id, m.handle, (SELECT count(*) FROM payment_methods c WHERE c.merchant_id = m.id AND c.is_active = 1) AS cards FROM merchants m WHERE m.id = ?`, platformId) : null;
    add('platform_store', 'فروشگاه پلتفرم (دریافت شارژ و اشتراک)', platform && platform.cards > 0 ? 'ok' : 'warn',
      !platformId ? 'فروشگاه پلتفرم انتخاب نشده؛ شارژ کیف پول و خرید پلن کار نمی‌کند. از «تنظیمات مالی» انتخاب کنید.'
        : !platform ? 'فروشگاه انتخاب‌شده دیگر وجود ندارد؛ از «تنظیمات مالی» دوباره انتخاب کنید.'
          : platform.cards > 0 ? `فروشگاه @${platform.handle} با ${platform.cards} کارت فعال دریافت‌کنندهٔ شارژهاست.` : 'فروشگاه پلتفرم کارت فعال ندارد؛ شارژ کیف پول ممکن نیست.');
    let dbFile = '';
    try { dbFile = String((db().prepare('PRAGMA database_list').all() as any[]).find((x) => x.name === 'main')?.file || ''); } catch { /* memory db */ }
    let size = 0;
    try { size = dbFile ? fs.statSync(dbFile).size : 0; } catch { /* no file */ }
    add('db', 'پایگاه داده', size > 2 * 1024 ** 3 ? 'warn' : 'ok', size ? `حجم فایل پایگاه داده ${(size / 1024 / 1024).toFixed(1)} مگابایت است.` : 'پایگاه داده در حافظه است یا اندازهٔ آن خوانده نشد.', size ? String(size) : undefined);
    const up = Math.floor(process.uptime());
    add('uptime', 'زمان کارکرد سرور', 'ok', `سرور ${Math.floor(up / 3600)} ساعت و ${Math.floor((up % 3600) / 60)} دقیقه است که روشن است.`, String(up));
    add('node', 'نسخهٔ Node.js', Number(process.versions.node.split('.')[0]) >= 22 ? 'ok' : 'warn', `نسخهٔ Node.js سرور ${process.version} است.`, process.version);
    const live = colExists('devices', 'revoked_at') ? 'WHERE revoked_at IS NULL' : '';
    const dev = one(`SELECT count(*) AS n, coalesce(sum(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END), 0) AS online FROM devices ${live}`, utcSql(new Date(Date.now() - ONLINE_MS)));
    add('devices', 'دستگاه‌های دریافت پیامک', Number(dev.n) === 0 ? 'warn' : Number(dev.online) === 0 ? 'error' : 'ok',
      Number(dev.n) === 0 ? 'هنوز دستگاهی متصل نشده است.' : `${dev.online} از ${dev.n} دستگاه آنلاین است.${Number(dev.online) === 0 ? ' هیچ دستگاهی پیامک نمی‌فرستد.' : ''}`, `${dev.online}/${dev.n}`);
    const failed = tableExists('webhook_deliveries') ? Number(one(`SELECT count(*) AS n FROM webhook_deliveries WHERE status = 'FAILED' AND created_at > ?`, Date.now() - DAY).n) : 0;
    add('webhooks', 'وب‌هوک‌های ناموفق (۲۴ ساعت)', failed === 0 ? 'ok' : failed > 20 ? 'error' : 'warn',
      failed === 0 ? 'در ۲۴ ساعت گذشته وب‌هوک ناموفقی نبوده است.' : `${failed} ارسال وب‌هوک در ۲۴ ساعت گذشته ناموفق بوده است؛ صفحهٔ «وب‌هوک‌های ناموفق» را ببینید.`, String(failed));
    const overall: Level = checks.some((c) => c.status === 'error') ? 'error' : checks.some((c) => c.status === 'warn') ? 'warn' : 'ok';
    return {
      success: true,
      overall,
      checks,
      server: { uptime_seconds: up, node: process.version, env: process.env.NODE_ENV || null, db_size_bytes: size, time: new Date().toISOString() },
    };
  });
}


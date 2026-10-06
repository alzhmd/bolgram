import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { db, merchantOf, fail, paging, str, isoOf } from './_kit.js';
import { audit, requirePerm } from '../../services/access.js';
import { checkLimit, GuardError } from '../../services/events.js';
import { InvoiceRepository } from '../../db/repositories/invoice.repository.js';
import { normalizeEmail, normalizeMobile, RESERVED_HANDLES, toLatinDigits } from '../../utils/validate.js';

/**
 * Feature plugin "links": reusable payment links (fixed / open / multiple-choice amounts), foreign-currency
 * ("FX") links priced in USD/EUR/AED/USDT/TRY and converted with the merchant's own rate at pay time,
 * and the public pay page at /l/:slug. Every paid link invoice carries metadata.link_id.
 *
 * Units: amounts of an IRT link are Toman; amounts of an FX link are in its currency (2 decimals).
 * The created invoice is Rial (DB rule) and gets the usual unique tail from InvoiceRepository.
 */

// ------------------------------------------------------------------ constants

export const CURRENCIES = {
  IRT: { name: 'تومان', symbol: 'تومان' },
  USD: { name: 'دلار آمریکا', symbol: '$' },
  EUR: { name: 'یورو', symbol: '€' },
  AED: { name: 'درهم امارات', symbol: 'AED' },
  USDT: { name: 'تتر', symbol: 'USDT' },
  TRY: { name: 'لیر ترکیه', symbol: '₺' },
} as const;
type Currency = keyof typeof CURRENCIES;
const FX_CODES: Currency[] = (Object.keys(CURRENCIES) as Currency[]).filter((c) => c !== 'IRT');

const MODES = ['fixed', 'open', 'choice'] as const;
type Mode = (typeof MODES)[number];
const FIELDS = ['name', 'mobile', 'email', 'address', 'note'] as const;
type Field = (typeof FIELDS)[number];
const FIELD_STATES = ['off', 'optional', 'required'] as const;
type FieldState = (typeof FIELD_STATES)[number];
const DEFAULT_COLLECT: Record<Field, FieldState> = { name: 'optional', mobile: 'optional', email: 'off', address: 'off', note: 'off' };
const CHANNELS = ['instagram', 'telegram', 'in_person', 'website', 'other'] as const;

const MIN_TOMAN = 1_000;
const MAX_TOMAN = 1_000_000_000;
const MAX_FX_PRICE = 10_000_000;
const MAX_RATE = 100_000_000;
const STALE_MS = 24 * 3600_000;
const INVOICE_MINUTES = 30;
const MAX_OPEN_PER_VISITOR = 3;

const RESERVED_SLUGS = new Set([
  ...RESERVED_HANDLES,
  ...'new edit create delete remove link links share qr pub public preview embed l p i u go s fx rates fx-rates slug-check'.split(' '),
]);

const STATUS_FA: Record<string, string> = {
  active: 'فعال',
  inactive: 'غیرفعال',
  expired: 'منقضی',
  sold_out: 'ظرفیت تکمیل',
  archived: 'بایگانی',
  no_rate: 'بدون نرخ ارز',
};
const REASON_FA: Record<string, string> = {
  inactive: 'این لینک پرداخت فعلاً غیرفعال است.',
  expired: 'مهلت پرداخت با این لینک تمام شده است.',
  sold_out: 'ظرفیت این لینک تکمیل شده است.',
  reserved: 'ظرفیت باقی‌مانده موقتاً در حال پرداخت توسط دیگران است؛ چند دقیقهٔ دیگر دوباره سر بزنید.',
  no_rate: 'پرداخت با این لینک موقتاً ممکن نیست؛ کمی بعد دوباره تلاش کنید یا با فروشنده تماس بگیرید.',
  unavailable: 'پرداخت با این لینک موقتاً ممکن نیست؛ کمی بعد دوباره تلاش کنید یا با فروشنده تماس بگیرید.',
};
const FIELD_FA: Record<Field, string> = { name: 'نام', mobile: 'شمارهٔ موبایل', email: 'ایمیل', address: 'آدرس', note: 'توضیحات' };

// ------------------------------------------------------------------ schema

export function ensureLinksSchema() {
  const d = db();
  d.exec(`CREATE TABLE IF NOT EXISTS link_links (
    id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT,
    amount_mode TEXT NOT NULL DEFAULT 'fixed', currency TEXT NOT NULL DEFAULT 'IRT',
    amount REAL, min_amount REAL, max_amount REAL, choices TEXT, collect TEXT NOT NULL,
    max_uses INTEGER, expires_at INTEGER, active INTEGER NOT NULL DEFAULT 1,
    success_message TEXT, redirect_url TEXT, channel TEXT, archived_at INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  const cols = new Set((d.prepare('PRAGMA table_info(link_links)').all() as any[]).map((c) => c.name));
  for (const [n, t] of [['channel', 'TEXT'], ['archived_at', 'INTEGER']]) if (!cols.has(n)) d.exec(`ALTER TABLE link_links ADD COLUMN ${n} ${t}`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_link_links_merchant ON link_links(merchant_id, created_at)`);
  d.exec(`CREATE TABLE IF NOT EXISTS link_views (link_id TEXT NOT NULL, day TEXT NOT NULL, visitor TEXT NOT NULL, created_at INTEGER NOT NULL,
          PRIMARY KEY (link_id, day, visitor))`);
  d.exec(`CREATE TABLE IF NOT EXISTS link_fx_rates (merchant_id TEXT NOT NULL, currency TEXT NOT NULL, rate_toman REAL NOT NULL,
          updated_at INTEGER NOT NULL, updated_by TEXT, PRIMARY KEY (merchant_id, currency))`);
}

// ------------------------------------------------------------------ helpers

const LID = `CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.link_id') END`;
const round2 = (n: number) => Math.round(n * 100) / 100;
const isFx = (c: string) => c !== 'IRT';
const tehranDay = (t = Date.now()) => new Date(t + 210 * 60_000).toISOString().slice(0, 10);

/** Same client key as the global rate limiter (first X-Forwarded-For hop, else socket address). */
function clientIp(req: FastifyRequest) {
  const xff = req.headers['x-forwarded-for'];
  return (typeof xff === 'string' && xff.split(',')[0].trim()) || req.ip || '0.0.0.0';
}
const visitorOf = (req: FastifyRequest) => crypto.createHash('sha256').update(`bolgram-link|${clientIp(req)}`).digest('hex').slice(0, 32);

/** "۱۲۳٬۴۵۰", "123,450", "12.5", "۱۲٫۵" → number (NaN when not a plain non-negative number). */
export function parseAmount(raw: unknown, decimals: boolean): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  if (typeof raw !== 'string') return NaN;
  let s = toLatinDigits(raw).replace(/[\s٬,،_']/g, '').replace(/٫/g, '.');
  if (!s) return NaN;
  if (!decimals) s = s.replace(/\.0+$/, '');
  if (!(decimals ? /^\d+(\.\d+)?$/ : /^\d+$/).test(s)) return NaN;
  return Number(s);
}

export function slugProblem(raw: string): string | null {
  if (/[؀-ۿ]/.test(raw)) return 'کیبورد را انگلیسی کنید؛ فقط حروف انگلیسی، عدد و خط تیره (-) مجاز است';
  const s = raw.trim().toLowerCase();
  if (s.length < 3 || s.length > 40) return 'آدرس لینک باید بین ۳ تا ۴۰ کاراکتر باشد';
  if (!/^[a-z0-9-]+$/.test(s)) return 'فقط حروف کوچک انگلیسی، عدد و خط تیره (-) مجاز است';
  if (s.startsWith('-') || s.endsWith('-') || s.includes('--')) return 'خط تیره نباید در ابتدا، انتها یا پشت‌سرهم بیاید';
  if (RESERVED_SLUGS.has(s)) return 'این آدرس رزرو شده است؛ آدرس دیگری انتخاب کنید';
  return null;
}
const slugTaken = (slug: string, exceptId?: string) =>
  !!db().prepare('SELECT 1 FROM link_links WHERE slug = ? AND id != ?').get(slug, exceptId || '');

function autoSlug(title: string, handle: string | null) {
  const latin = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '');
  const base = (latin.length >= 3 ? latin : (handle || 'pay').replace(/_/g, '-').replace(/-+/g, '-').slice(0, 24)).replace(/^-+|-+$/g, '') || 'pay';
  for (let i = 0; i < 20; i++) {
    const s = `${base}-${crypto.randomBytes(3).toString('hex').slice(0, i < 10 ? 4 : 6)}`;
    if (!slugProblem(s) && !slugTaken(s)) return s;
  }
  return `pay-${crypto.randomBytes(6).toString('hex')}`;
}

function linkBase(req: FastifyRequest) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${process.env.PORT || 4000}`).split(',')[0].trim();
  return `${proto === 'https' ? 'https' : 'http'}://${host}`;
}

function safeLogo(u: unknown): string | null {
  if (typeof u !== 'string' || !u) return null;
  return /^\/uploads\/[\w.-]+$/.test(u) || /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null;
}

function cleanRedirect(raw: unknown): { url: string | null; error?: string } {
  if (raw === null || raw === undefined || raw === '') return { url: null };
  if (typeof raw !== 'string') return { url: null, error: 'آدرس بازگشت معتبر نیست' };
  const s = raw.trim();
  if (!s) return { url: null };
  if (s.length > 500) return { url: null, error: 'آدرس بازگشت حداکثر ۵۰۰ کاراکتر است' };
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return { url: null, error: 'آدرس بازگشت باید با https:// شروع شود' };
    if (u.username || u.password || !u.hostname.includes('.')) return { url: null, error: 'آدرس بازگشت معتبر نیست' };
    return { url: u.toString() };
  } catch {
    return { url: null, error: 'آدرس بازگشت معتبر نیست' };
  }
}

// ------------------------------------------------------------------ rates

interface Rate {
  rate_toman: number;
  updated_at: number;
}
function ratesOf(merchantId: string): Map<string, Rate> {
  const rows = db().prepare('SELECT currency, rate_toman, updated_at FROM link_fx_rates WHERE merchant_id = ?').all(merchantId) as any[];
  return new Map(rows.map((r) => [r.currency, { rate_toman: Number(r.rate_toman), updated_at: Number(r.updated_at) }]));
}
function ratesView(merchantId: string) {
  const rates = ratesOf(merchantId);
  return FX_CODES.map((c) => {
    const r = rates.get(c);
    return {
      currency: c,
      name: CURRENCIES[c].name,
      symbol: CURRENCIES[c].symbol,
      rate_toman: r ? r.rate_toman : null,
      updated_at: r ? new Date(r.updated_at).toISOString() : null,
      stale: r ? Date.now() - r.updated_at > STALE_MS : false,
    };
  });
}
/** Price in link currency → Toman (rounded up to a whole Toman); null when the FX rate is missing. */
function toToman(price: number | null, currency: string, rates: Map<string, Rate>): number | null {
  if (price === null || price === undefined) return null;
  if (!isFx(currency)) return Math.round(price);
  const r = rates.get(currency);
  if (!r) return null;
  return Math.ceil(Math.round(price * r.rate_toman * 100) / 100);
}

// ------------------------------------------------------------------ validation

interface Choice {
  amount: number;
  label: string;
}
interface LinkRow {
  id: string;
  merchant_id: string;
  slug: string;
  title: string;
  description: string | null;
  amount_mode: Mode;
  currency: Currency;
  amount: number | null;
  min_amount: number | null;
  max_amount: number | null;
  choices: Choice[];
  collect: Record<Field, FieldState>;
  max_uses: number | null;
  expires_at: number | null;
  active: boolean;
  success_message: string | null;
  redirect_url: string | null;
  channel: string;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
}

function rowOf(r: any): LinkRow {
  let choices: Choice[] = [];
  let collect = { ...DEFAULT_COLLECT };
  try { choices = JSON.parse(r.choices || '[]'); } catch { choices = []; }
  try { collect = { ...DEFAULT_COLLECT, ...JSON.parse(r.collect || '{}') }; } catch { /* defaults */ }
  return {
    ...r,
    amount: r.amount === null ? null : Number(r.amount),
    min_amount: r.min_amount === null ? null : Number(r.min_amount),
    max_amount: r.max_amount === null ? null : Number(r.max_amount),
    max_uses: r.max_uses === null ? null : Number(r.max_uses),
    expires_at: r.expires_at === null ? null : Number(r.expires_at),
    archived_at: r.archived_at === null ? null : Number(r.archived_at),
    active: !!r.active,
    channel: r.channel || 'other',
    choices,
    collect,
  };
}

class ValidationError extends Error {
  constructor(public errors: Record<string, string>) {
    super(Object.values(errors)[0]);
  }
}

/** Accepts amount_toman / min_toman / max_toman as aliases of amount / min_amount / max_amount. */
function aliasAmounts(b: any) {
  const out = { ...(b && typeof b === 'object' ? b : {}) };
  for (const [a, t] of [['amount', 'amount_toman'], ['min_amount', 'min_toman'], ['max_amount', 'max_toman']]) {
    if (out[a] === undefined && out[t] !== undefined) out[a] = out[t];
    delete out[t];
  }
  return out;
}

/** Validates a full link definition (create, or current values merged with a PATCH body). */
function normalizeLink(b: any, current: LinkRow | null) {
  const errors: Record<string, string> = {};
  const title = str(b.title, 120);
  if (title.length < 2) errors.title = 'عنوان لینک را وارد کنید (حداقل ۲ حرف)';
  else if (title.length > 80) errors.title = 'عنوان حداکثر ۸۰ کاراکتر است';
  const description = typeof b.description === 'string' ? str(b.description, 1200) : '';
  if (description.length > 1000) errors.description = 'توضیحات حداکثر ۱۰۰۰ کاراکتر است';

  const mode = (MODES as readonly string[]).includes(b.amount_mode) ? (b.amount_mode as Mode) : null;
  if (!mode) errors.amount_mode = 'نوع مبلغ را انتخاب کنید';
  const currency = (typeof b.currency === 'string' ? b.currency.toUpperCase() : 'IRT') as Currency;
  if (!(currency in CURRENCIES)) errors.currency = 'واحد پول پشتیبانی نمی‌شود';
  const fx = isFx(currency);
  const unitFa = fx ? CURRENCIES[currency]?.name || '' : 'تومان';
  const lo = fx ? 0.01 : MIN_TOMAN, hi = fx ? MAX_FX_PRICE : MAX_TOMAN;
  const rangeMsg = fx ? `مبلغ باید بیشتر از صفر و حداکثر ${new Intl.NumberFormat('fa-IR').format(MAX_FX_PRICE)} ${unitFa} باشد` : 'مبلغ باید بین ۱٬۰۰۰ تا ۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان باشد';
  const money = (v: unknown): number | null | typeof NaN => {
    if (v === null || v === undefined || v === '') return null;
    const n = parseAmount(v, fx);
    if (!Number.isFinite(n)) return NaN;
    return fx ? round2(n) : n;
  };
  const okMoney = (n: number) => Number.isFinite(n) && n >= lo && n <= hi && (fx || Number.isSafeInteger(n));

  let amount: number | null = null, min: number | null = null, max: number | null = null;
  let choices: Choice[] = [];
  const parseChoices = (raw: unknown, need: number, cap: number) => {
    if (raw === null || raw === undefined || raw === '') raw = [];
    if (!Array.isArray(raw)) return void (errors.choices = 'گزینه‌های مبلغ معتبر نیست');
    if (raw.length > cap) return void (errors.choices = `حداکثر ${new Intl.NumberFormat('fa-IR').format(cap)} گزینه مجاز است`);
    const out: Choice[] = [];
    for (const c of raw) {
      const n = money(typeof c === 'object' && c ? (c as any).amount : c);
      const label = typeof c === 'object' && c ? str((c as any).label, 80) : '';
      if (n === null || !okMoney(n as number)) return void (errors.choices = `مبلغ همهٔ گزینه‌ها باید درست باشد؛ ${rangeMsg}`);
      if (label.length > 60) return void (errors.choices = 'برچسب هر گزینه حداکثر ۶۰ کاراکتر است');
      out.push({ amount: n as number, label });
    }
    if (out.length < need) return void (errors.choices = 'حداقل دو گزینهٔ مبلغ لازم است');
    choices = out;
  };
  if (mode === 'fixed') {
    const n = money(b.amount);
    if (n === null) errors.amount = 'مبلغ را وارد کنید';
    else if (!okMoney(n as number)) errors.amount = rangeMsg;
    else amount = n as number;
  } else if (mode === 'open') {
    const a = money(b.min_amount), z = money(b.max_amount);
    if (a !== null && !okMoney(a as number)) errors.min_amount = rangeMsg;
    else min = a as number | null;
    if (z !== null && !okMoney(z as number)) errors.max_amount = rangeMsg;
    else max = z as number | null;
    if (min !== null && max !== null && min > max) errors.max_amount = 'حداکثر مبلغ نباید از حداقل کمتر باشد';
    parseChoices(b.choices, 0, 6);
    if (!errors.choices && choices.some((c) => (min !== null && c.amount < min) || (max !== null && c.amount > max)))
      errors.choices = 'مبلغ‌های پیشنهادی باید بین حداقل و حداکثر باشد';
  } else if (mode === 'choice') {
    parseChoices(b.choices, 2, 12);
  }

  const collect: Record<Field, FieldState> = { ...DEFAULT_COLLECT };
  const rawCollect = b.collect && typeof b.collect === 'object' ? b.collect : {};
  for (const f of FIELDS) {
    const v = rawCollect[f];
    if (v === undefined) continue;
    if (typeof v === 'boolean') collect[f] = v ? 'optional' : 'off';
    else if ((FIELD_STATES as readonly string[]).includes(v)) collect[f] = v;
    else errors.collect = `وضعیت فیلد «${FIELD_FA[f]}» معتبر نیست`;
  }

  let maxUses: number | null = null;
  if (b.max_uses !== null && b.max_uses !== undefined && b.max_uses !== '' && b.max_uses !== 0) {
    const n = parseAmount(b.max_uses, false);
    if (!Number.isSafeInteger(n) || n < 1 || n > 1_000_000) errors.max_uses = 'سقف دفعات پرداخت باید عددی بین ۱ تا ۱٬۰۰۰٬۰۰۰ باشد';
    else maxUses = n;
  }

  let expiresAt: number | null = null;
  if (b.expires_at !== null && b.expires_at !== undefined && b.expires_at !== '') {
    const t = typeof b.expires_at === 'number' ? b.expires_at : Date.parse(String(b.expires_at));
    if (!Number.isFinite(t)) errors.expires_at = 'تاریخ انقضا معتبر نیست';
    else if (t <= Date.now() && (!current || t !== current.expires_at)) errors.expires_at = 'تاریخ انقضا باید در آینده باشد';
    else if (t > Date.now() + 5 * 366 * 86400_000) errors.expires_at = 'تاریخ انقضا حداکثر پنج سال بعد است';
    else expiresAt = t;
  }

  const successMessage = typeof b.success_message === 'string' ? str(b.success_message, 400) : '';
  if (successMessage.length > 300) errors.success_message = 'پیام پس از پرداخت حداکثر ۳۰۰ کاراکتر است';
  const redirect = cleanRedirect(b.redirect_url);
  if (redirect.error) errors.redirect_url = redirect.error;
  const channel = (CHANNELS as readonly string[]).includes(b.channel) ? (b.channel as string) : 'other';
  const active = b.active === undefined ? true : !!b.active;

  if (Object.keys(errors).length) throw new ValidationError(errors);
  return {
    title,
    description: description || null,
    amount_mode: mode as Mode,
    currency,
    amount,
    min_amount: min,
    max_amount: max,
    choices,
    collect,
    max_uses: maxUses,
    expires_at: expiresAt,
    active,
    success_message: successMessage || null,
    redirect_url: redirect.url,
    channel,
  };
}

// ------------------------------------------------------------------ stats & views

interface Stats {
  invoices: number;
  paid: number;
  pending: number;
  revenue_rial: number;
}
const ZERO: Stats = { invoices: 0, paid: 0, pending: 0, revenue_rial: 0 };

/** Invoice stats per link, computed from invoices whose metadata JSON has link_id. */
function statsFor(merchantId: string, linkId?: string): Map<string, Stats> {
  const rows = db()
    .prepare(
      `SELECT ${LID} AS lid, count(*) AS n,
              sum(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) AS paid,
              sum(CASE WHEN status = 'PAID' THEN expected_amount ELSE 0 END) AS revenue,
              sum(CASE WHEN status = 'PENDING' AND expires_at > ? THEN 1 ELSE 0 END) AS pending
       FROM invoices WHERE merchant_id = ? AND metadata LIKE '%"link_id"%' ${linkId ? `AND ${LID} = ?` : ''} GROUP BY lid`,
    )
    .all(...([new Date().toISOString(), merchantId, ...(linkId ? [linkId] : [])] as any[])) as any[];
  return new Map(rows.filter((r) => r.lid).map((r) => [String(r.lid), { invoices: Number(r.n), paid: Number(r.paid || 0), pending: Number(r.pending || 0), revenue_rial: Number(r.revenue || 0) }]));
}
function viewsFor(ids: string[]): Map<string, number> {
  if (!ids.length) return new Map();
  const rows = db().prepare(`SELECT link_id, count(*) AS n FROM link_views WHERE link_id IN (${ids.map(() => '?').join(',')}) GROUP BY link_id`).all(...ids) as any[];
  return new Map(rows.map((r) => [r.link_id, Number(r.n)]));
}

function statusOf(l: LinkRow, s: Stats, rates: Map<string, Rate>) {
  if (l.archived_at) return 'archived';
  if (!l.active) return 'inactive';
  if (l.expires_at && l.expires_at <= Date.now()) return 'expired';
  if (l.max_uses && s.paid >= l.max_uses) return 'sold_out';
  if (isFx(l.currency) && !rates.has(l.currency)) return 'no_rate';
  return 'active';
}

function view(req: FastifyRequest, l: LinkRow, s: Stats, views: number, rates: Map<string, Rate>) {
  const rate = isFx(l.currency) ? rates.get(l.currency) : undefined;
  const status = statusOf(l, s, rates);
  return {
    id: l.id,
    slug: l.slug,
    url: `${linkBase(req)}/l/${l.slug}`,
    title: l.title,
    description: l.description || '',
    amount_mode: l.amount_mode,
    currency: l.currency,
    currency_name: CURRENCIES[l.currency]?.name || l.currency,
    amount: l.amount,
    min_amount: l.min_amount,
    max_amount: l.max_amount,
    choices: l.choices.map((c) => ({ amount: c.amount, label: c.label, amount_toman: toToman(c.amount, l.currency, rates) })),
    amount_toman: toToman(l.amount, l.currency, rates),
    min_toman: toToman(l.min_amount, l.currency, rates),
    max_toman: toToman(l.max_amount, l.currency, rates),
    fx: isFx(l.currency)
      ? { rate_toman: rate?.rate_toman ?? null, updated_at: rate ? new Date(rate.updated_at).toISOString() : null, stale: rate ? Date.now() - rate.updated_at > STALE_MS : false }
      : null,
    collect: l.collect,
    max_uses: l.max_uses,
    remaining_uses: l.max_uses ? Math.max(0, l.max_uses - s.paid) : null,
    expires_at: l.expires_at ? new Date(l.expires_at).toISOString() : null,
    active: l.active,
    archived: !!l.archived_at,
    status,
    status_label: STATUS_FA[status],
    success_message: l.success_message || '',
    redirect_url: l.redirect_url || '',
    channel: l.channel,
    stats: {
      views,
      invoices: s.invoices,
      paid: s.paid,
      pending: s.pending,
      revenue_rial: s.revenue_rial,
      revenue_toman: Math.round(s.revenue_rial / 10),
      conversion: views ? Math.round((s.paid / views) * 1000) / 10 : null,
    },
    created_at: new Date(l.created_at).toISOString(),
    updated_at: new Date(l.updated_at).toISOString(),
  };
}

function oneView(req: FastifyRequest, l: LinkRow) {
  const s = statsFor(l.merchant_id, l.id).get(l.id) || ZERO;
  return view(req, l, s, viewsFor([l.id]).get(l.id) || 0, ratesOf(l.merchant_id));
}

const activeCount = (merchantId: string) =>
  Number((db().prepare('SELECT count(*) AS n FROM link_links WHERE merchant_id = ? AND active = 1 AND archived_at IS NULL').get(merchantId) as any).n);

function findOwn(merchantId: string, id: string): LinkRow | null {
  const r = db().prepare('SELECT * FROM link_links WHERE id = ? AND merchant_id = ?').get(String(id).slice(0, 40), merchantId);
  return r ? rowOf(r) : null;
}

function insertLink(merchantId: string, slug: string, v: ReturnType<typeof normalizeLink>, now = Date.now()) {
  const id = 'lnk_' + crypto.randomBytes(8).toString('hex');
  db()
    .prepare(
      `INSERT INTO link_links (id, merchant_id, slug, title, description, amount_mode, currency, amount, min_amount, max_amount, choices, collect,
         max_uses, expires_at, active, success_message, redirect_url, channel, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(id, merchantId, slug, v.title, v.description, v.amount_mode, v.currency, v.amount, v.min_amount, v.max_amount, JSON.stringify(v.choices),
      JSON.stringify(v.collect), v.max_uses, v.expires_at, v.active ? 1 : 0, v.success_message, v.redirect_url, v.channel, now, now);
  return id;
}

/** Turns a stored row back into input form (PATCH merges the body over this). */
const inputOf = (l: LinkRow) => ({
  title: l.title, description: l.description || '', amount_mode: l.amount_mode, currency: l.currency, amount: l.amount, min_amount: l.min_amount,
  max_amount: l.max_amount, choices: l.choices, collect: l.collect, max_uses: l.max_uses, expires_at: l.expires_at, active: l.active,
  success_message: l.success_message || '', redirect_url: l.redirect_url || '', channel: l.channel,
});

// ------------------------------------------------------------------ public availability

function publicState(l: LinkRow, merchant: any, s: Stats, rates: Map<string, Rate>) {
  let reason: string | null = null;
  if (l.archived_at || !l.active || !merchant || merchant.status === 'SUSPENDED') reason = 'inactive';
  else if (l.expires_at && l.expires_at <= Date.now()) reason = 'expired';
  else if (l.max_uses && s.paid >= l.max_uses) reason = 'sold_out';
  else if (l.max_uses && s.paid + s.pending >= l.max_uses) reason = 'reserved';
  else if (isFx(l.currency) && !rates.has(l.currency)) reason = 'no_rate';
  else if (!Number((db().prepare('SELECT count(*) AS n FROM payment_methods WHERE merchant_id = ? AND is_active = 1').get(l.merchant_id) as any).n)) reason = 'unavailable';
  return { available: !reason, reason, message: reason ? REASON_FA[reason] : null };
}

function publicInfo(l: LinkRow, merchant: any, s: Stats, rates: Map<string, Rate>) {
  const st = publicState(l, merchant, s, rates);
  const rate = isFx(l.currency) ? rates.get(l.currency) : undefined;
  const fields: Record<string, FieldState> = {};
  for (const f of FIELDS) fields[f] = l.collect[f];
  return {
    success: true,
    slug: l.slug,
    title: l.title,
    description: l.description || '',
    store: { name: merchant?.name || merchant?.handle || 'فروشگاه', handle: merchant?.handle || null, logo: safeLogo(merchant?.brand_logo_url) },
    currency: l.currency,
    currency_name: CURRENCIES[l.currency]?.name || l.currency,
    amount_mode: l.amount_mode,
    price: isFx(l.currency) ? l.amount : null,
    amount_toman: toToman(l.amount, l.currency, rates),
    min_price: isFx(l.currency) ? l.min_amount : null,
    max_price: isFx(l.currency) ? l.max_amount : null,
    min_toman: l.amount_mode === 'open' ? (toToman(l.min_amount, l.currency, rates) ?? (isFx(l.currency) ? null : MIN_TOMAN)) : null,
    max_toman: l.amount_mode === 'open' ? (toToman(l.max_amount, l.currency, rates) ?? (isFx(l.currency) ? null : MAX_TOMAN)) : null,
    choices: l.choices.map((c, index) => ({ index, label: c.label, price: isFx(l.currency) ? c.amount : null, amount_toman: toToman(c.amount, l.currency, rates) })),
    fx: isFx(l.currency) ? { currency: l.currency, rate_toman: rate?.rate_toman ?? null, updated_at: rate ? new Date(rate.updated_at).toISOString() : null } : null,
    fields,
    remaining: l.max_uses ? Math.max(0, l.max_uses - s.paid) : null,
    expires_at: l.expires_at ? new Date(l.expires_at).toISOString() : null,
    ...st,
  };
}

function bySlug(slug: unknown): LinkRow | null {
  const s = typeof slug === 'string' ? slug.trim().toLowerCase().slice(0, 40) : '';
  if (!/^[a-z0-9-]{3,40}$/.test(s)) return null;
  const r = db().prepare('SELECT * FROM link_links WHERE slug = ? AND archived_at IS NULL').get(s);
  return r ? rowOf(r) : null;
}

// Serialises pay requests per link so max_uses reservations cannot be overbooked by concurrent requests.
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return next;
}

// ------------------------------------------------------------------ html

const PUBLIC_DIR = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cands = [path.resolve(here, '../../../public'), path.resolve(here, '../../public'), path.resolve(process.cwd(), 'public')];
  return cands.find((c) => fs.existsSync(path.join(c, 'link.html'))) || cands[cands.length - 1];
})();
const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

// ------------------------------------------------------------------ routes

export default async function linksRoutes(app: FastifyInstance) {
  ensureLinksSchema();
  const guard = (reply: FastifyReply, e: unknown) => {
    if (e instanceof ValidationError) return fail(reply, 422, 'validation', e.message, e.errors);
    if (e instanceof GuardError) return fail(reply, e.status, e.code, e.message);
    throw e;
  };

  // ---------------- merchant API

  app.get('/api/v2/links', { preHandler: requirePerm('links:read') }, async (req) => {
    const m = merchantOf(req);
    const q = req.query as any;
    const { page, perPage, limit, offset } = paging(q);
    const status = ['active', 'inactive', 'archived', 'all'].includes(q?.status) ? q.status : 'current';
    const search = str(q?.q, 60).toLowerCase();
    const where = ['merchant_id = ?'];
    const params: any[] = [m.id];
    if (status === 'archived') where.push('archived_at IS NOT NULL');
    else if (status !== 'all') where.push('archived_at IS NULL');
    if (status === 'active') where.push('active = 1');
    if (status === 'inactive') where.push('active = 0');
    if (search) {
      where.push(`(lower(title) LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\')`);
      const like = `%${search.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      params.push(like, like);
    }
    const d = db();
    const total = Number((d.prepare(`SELECT count(*) AS n FROM link_links WHERE ${where.join(' AND ')}`).get(...params) as any).n);
    const rows = (d.prepare(`SELECT * FROM link_links WHERE ${where.join(' AND ')} ORDER BY archived_at IS NOT NULL, active DESC, created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as any[]).map(rowOf);
    const stats = statsFor(m.id);
    const rates = ratesOf(m.id);
    const views = viewsFor(rows.map((r) => r.id));
    const all = d.prepare('SELECT id FROM link_links WHERE merchant_id = ?').all(m.id) as any[];
    const allViews = viewsFor(all.map((r) => r.id));
    let paid = 0, revenue = 0, invoices = 0;
    for (const s of stats.values()) { paid += s.paid; revenue += s.revenue_rial; invoices += s.invoices; }
    return {
      success: true,
      data: rows.map((l) => view(req, l, stats.get(l.id) || ZERO, views.get(l.id) || 0, rates)),
      page,
      per_page: perPage,
      total,
      summary: {
        links: Number((d.prepare('SELECT count(*) AS n FROM link_links WHERE merchant_id = ? AND archived_at IS NULL').get(m.id) as any).n),
        active: activeCount(m.id),
        archived: Number((d.prepare('SELECT count(*) AS n FROM link_links WHERE merchant_id = ? AND archived_at IS NOT NULL').get(m.id) as any).n),
        views: [...allViews.values()].reduce((a, b) => a + b, 0),
        invoices,
        paid,
        revenue_rial: revenue,
        revenue_toman: Math.round(revenue / 10),
      },
    };
  });

  app.get('/api/v2/links/slug-check', { preHandler: requirePerm('links:read') }, async (req) => {
    const q = req.query as any;
    const raw = String(q?.slug ?? '');
    const problem = slugProblem(raw);
    if (problem) return { success: true, status: RESERVED_SLUGS.has(raw.trim().toLowerCase()) ? 'reserved' : 'invalid', message: problem };
    const s = raw.trim().toLowerCase();
    if (slugTaken(s, typeof q?.except === 'string' ? q.except : undefined)) return { success: true, status: 'taken', message: 'این آدرس قبلاً استفاده شده است' };
    return { success: true, status: 'free', slug: s };
  });

  app.get('/api/v2/links/fx-rates', { preHandler: requirePerm('links:read') }, async (req) => ({
    success: true,
    data: ratesView(merchantOf(req).id),
    stale_after_hours: STALE_MS / 3600_000,
  }));

  app.put('/api/v2/links/fx-rates', { preHandler: requirePerm('links:manage') }, async (req, reply) => {
    const m = merchantOf(req);
    const b = (req.body || {}) as any;
    let input: Record<string, unknown> = {};
    if (Array.isArray(b.rates)) for (const r of b.rates) input[String(r?.currency || '').toUpperCase()] = r?.rate_toman;
    else if (b.rates && typeof b.rates === 'object') input = Object.fromEntries(Object.entries(b.rates).map(([k, v]) => [k.toUpperCase(), v]));
    else return fail(reply, 422, 'validation', 'نرخ‌ها را وارد کنید');
    const errors: Record<string, string> = {};
    const set: [string, number][] = [];
    const del: string[] = [];
    for (const [c, v] of Object.entries(input)) {
      if (!FX_CODES.includes(c as Currency)) { errors[c] = 'این ارز پشتیبانی نمی‌شود'; continue; }
      if (v === null || v === '' || v === undefined) { del.push(c); continue; }
      const n = round2(parseAmount(v as any, true));
      if (!Number.isFinite(n) || n <= 0 || n > MAX_RATE) errors[c] = `نرخ ${CURRENCIES[c as Currency].name} باید بیشتر از صفر و حداکثر ۱۰۰٬۰۰۰٬۰۰۰ تومان باشد`;
      else set.push([c, n]);
    }
    if (Object.keys(errors).length) return fail(reply, 422, 'validation', Object.values(errors)[0], errors);
    const d = db();
    const now = Date.now();
    const actor = (req as any).actor;
    for (const [c, n] of set) {
      d.prepare(`INSERT INTO link_fx_rates (merchant_id, currency, rate_toman, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(merchant_id, currency) DO UPDATE SET rate_toman = excluded.rate_toman, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
        .run(m.id, c, n, now, actor?.id || null);
    }
    for (const c of del) d.prepare('DELETE FROM link_fx_rates WHERE merchant_id = ? AND currency = ?').run(m.id, c);
    audit(req, m.id, 'links.fx_rates_updated', undefined, { set: Object.fromEntries(set), removed: del });
    return { success: true, data: ratesView(m.id), stale_after_hours: STALE_MS / 3600_000 };
  });

  app.post('/api/v2/links', { preHandler: requirePerm('links:manage') }, async (req, reply) => {
    const m = merchantOf(req);
    const b = aliasAmounts(req.body);
    try {
      const v = normalizeLink(b, null);
      let slug: string;
      if (typeof b.slug === 'string' && b.slug.trim()) {
        const p = slugProblem(b.slug);
        if (p) throw new ValidationError({ slug: p });
        slug = b.slug.trim().toLowerCase();
        if (slugTaken(slug)) return fail(reply, 409, 'slug_taken', 'این آدرس قبلاً استفاده شده است', { slug: 'این آدرس قبلاً استفاده شده است' });
      } else slug = autoSlug(v.title, m.handle);
      if (v.active) checkLimit(m.id, 'links', activeCount(m.id));
      const id = insertLink(m.id, slug, v);
      audit(req, m.id, 'link.created', id, { slug, title: v.title });
      return reply.status(201).send({ success: true, link: oneView(req, findOwn(m.id, id)!) });
    } catch (e) {
      return guard(reply, e);
    }
  });

  app.get('/api/v2/links/:id', { preHandler: requirePerm('links:read') }, async (req, reply) => {
    const l = findOwn(merchantOf(req).id, (req.params as any).id);
    if (!l) return fail(reply, 404, 'not_found', 'لینک پرداخت پیدا نشد');
    const recent = (db()
      .prepare(`SELECT id, customer_name, expected_amount, status, created_at, metadata FROM invoices WHERE merchant_id = ? AND metadata LIKE '%"link_id"%' AND ${LID} = ? ORDER BY created_at DESC LIMIT 10`)
      .all(l.merchant_id, l.id) as any[]).map((r) => {
      let meta: any = {};
      try { meta = JSON.parse(r.metadata || '{}'); } catch { /* ignore */ }
      return {
        id: r.id,
        payer: meta?.payer?.name || '',
        mobile: meta?.payer?.mobile || '',
        amount_rial: Number(r.expected_amount),
        amount_toman: Math.round(Number(r.expected_amount) / 10),
        status: r.status,
        created_at: isoOf(r.created_at),
      };
    });
    return { success: true, link: oneView(req, l), recent_invoices: recent };
  });

  app.patch('/api/v2/links/:id', { preHandler: requirePerm('links:manage') }, async (req, reply) => {
    const m = merchantOf(req);
    const l = findOwn(m.id, (req.params as any).id);
    if (!l) return fail(reply, 404, 'not_found', 'لینک پرداخت پیدا نشد');
    const b = aliasAmounts(req.body);
    try {
      const merged: any = { ...inputOf(l) };
      for (const [k, v] of Object.entries(b)) if (k !== 'collect') merged[k] = v;
      if (b.collect && typeof b.collect === 'object') merged.collect = { ...l.collect, ...b.collect };
      // A mode/currency switch must not inherit amounts typed for the previous unit.
      if (b.currency !== undefined && String(b.currency).toUpperCase() !== l.currency) {
        for (const k of ['amount', 'min_amount', 'max_amount', 'choices']) if (b[k] === undefined) merged[k] = k === 'choices' ? [] : null;
      }
      const v = normalizeLink(merged, l);
      let slug = l.slug;
      if (typeof b.slug === 'string' && b.slug.trim().toLowerCase() !== l.slug) {
        const p = slugProblem(b.slug);
        if (p) throw new ValidationError({ slug: p });
        slug = b.slug.trim().toLowerCase();
        if (slugTaken(slug, l.id)) return fail(reply, 409, 'slug_taken', 'این آدرس قبلاً استفاده شده است', { slug: 'این آدرس قبلاً استفاده شده است' });
      }
      let archivedAt = l.archived_at;
      if (b.archived === false && l.archived_at) archivedAt = null;
      if (b.archived === true && !l.archived_at) archivedAt = Date.now();
      const activeNow = v.active && !archivedAt;
      if (activeNow && !(l.active && !l.archived_at)) checkLimit(m.id, 'links', activeCount(m.id));
      db()
        .prepare(
          `UPDATE link_links SET slug = ?, title = ?, description = ?, amount_mode = ?, currency = ?, amount = ?, min_amount = ?, max_amount = ?, choices = ?,
             collect = ?, max_uses = ?, expires_at = ?, active = ?, success_message = ?, redirect_url = ?, channel = ?, archived_at = ?, updated_at = ?
           WHERE id = ? AND merchant_id = ?`,
        )
        .run(slug, v.title, v.description, v.amount_mode, v.currency, v.amount, v.min_amount, v.max_amount, JSON.stringify(v.choices), JSON.stringify(v.collect),
          v.max_uses, v.expires_at, v.active ? 1 : 0, v.success_message, v.redirect_url, v.channel, archivedAt, Date.now(), l.id, m.id);
      audit(req, m.id, 'link.updated', l.id, { fields: Object.keys(b).slice(0, 20) });
      return { success: true, link: oneView(req, findOwn(m.id, l.id)!) };
    } catch (e) {
      return guard(reply, e);
    }
  });

  app.delete('/api/v2/links/:id', { preHandler: requirePerm('links:manage') }, async (req, reply) => {
    const m = merchantOf(req);
    const l = findOwn(m.id, (req.params as any).id);
    if (!l) return fail(reply, 404, 'not_found', 'لینک پرداخت پیدا نشد');
    const s = statsFor(m.id, l.id).get(l.id) || ZERO;
    if (s.invoices > 0) {
      // Keep the record (and its slug) so past invoices still point at it; it disappears from the public page.
      db().prepare('UPDATE link_links SET active = 0, archived_at = coalesce(archived_at, ?), updated_at = ? WHERE id = ? AND merchant_id = ?').run(Date.now(), Date.now(), l.id, m.id);
      audit(req, m.id, 'link.archived', l.id, { slug: l.slug, invoices: s.invoices });
      return { success: true, archived: true, message: 'این لینک فاکتور ثبت‌شده دارد؛ بایگانی شد تا سابقهٔ فروش حفظ شود' };
    }
    db().prepare('DELETE FROM link_links WHERE id = ? AND merchant_id = ?').run(l.id, m.id);
    db().prepare('DELETE FROM link_views WHERE link_id = ?').run(l.id);
    audit(req, m.id, 'link.deleted', l.id, { slug: l.slug });
    return { success: true, archived: false, message: 'لینک حذف شد' };
  });

  app.post('/api/v2/links/:id/duplicate', { preHandler: requirePerm('links:manage') }, async (req, reply) => {
    const m = merchantOf(req);
    const l = findOwn(m.id, (req.params as any).id);
    if (!l) return fail(reply, 404, 'not_found', 'لینک پرداخت پیدا نشد');
    try {
      const copyTitle = `${l.title} (کپی)`.slice(0, 80);
      const v = normalizeLink({ ...inputOf(l), title: copyTitle, expires_at: l.expires_at && l.expires_at > Date.now() ? l.expires_at : null, active: false }, null);
      const id = insertLink(m.id, autoSlug(l.title, m.handle), v);
      audit(req, m.id, 'link.duplicated', id, { from: l.id });
      return reply.status(201).send({ success: true, link: oneView(req, findOwn(m.id, id)!) });
    } catch (e) {
      return guard(reply, e);
    }
  });

  app.get('/api/v2/links/:id/qr.svg', { preHandler: requirePerm('links:read') }, async (req, reply) => {
    const l = findOwn(merchantOf(req).id, (req.params as any).id);
    if (!l) return fail(reply, 404, 'not_found', 'لینک پرداخت پیدا نشد');
    const svg = await QRCode.toString(`${linkBase(req)}/l/${l.slug}`, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0b1424', light: '#ffffff' } });
    return reply
      .type('image/svg+xml; charset=utf-8')
      .header('Cache-Control', 'private, no-cache')
      .header('Content-Disposition', `inline; filename="bolgram-link-${l.slug}.svg"`)
      .send(svg);
  });

  // ---------------- public

  app.get('/l/:slug', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    let html: string;
    try {
      html = await fs.promises.readFile(path.join(PUBLIC_DIR, 'link.html'), 'utf8');
    } catch {
      return reply.status(404).type('text/plain; charset=utf-8').send('Not found');
    }
    const l = bySlug((req.params as any).slug);
    let meta = '<title>لینک پرداخت | بولگرام</title>';
    if (l) {
      const m = db().prepare('SELECT name, handle FROM merchants WHERE id = ?').get(l.merchant_id) as any;
      const store = m?.name || m?.handle || '';
      const title = `${l.title}${store ? ` | ${store}` : ''}`;
      const desc = (l.description || `پرداخت امن کارت به کارت${store ? ` به ${store}` : ''} با تأیید خودکار`).replace(/\s+/g, ' ').slice(0, 180);
      meta = `<title>${escHtml(title)}</title><meta name="description" content="${escHtml(desc)}"><meta property="og:type" content="website">` +
        `<meta property="og:title" content="${escHtml(title)}"><meta property="og:description" content="${escHtml(desc)}"><meta property="og:url" content="${escHtml(`${linkBase(req)}/l/${l.slug}`)}">`;
    }
    return reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-cache, no-store, must-revalidate')
      .header('X-Robots-Tag', 'noindex')
      .header('Referrer-Policy', 'same-origin')
      .send(html.replace(/<!--LINK_META-->[\s\S]*?<!--\/LINK_META-->/, meta));
  });

  app.get('/api/pub/links/:slug', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const l = bySlug((req.params as any).slug);
    if (!l) return fail(reply, 404, 'not_found', 'لینک پرداخت پیدا نشد');
    const merchant = db().prepare('SELECT id, name, handle, status, brand_logo_url FROM merchants WHERE id = ?').get(l.merchant_id) as any;
    db().prepare('INSERT OR IGNORE INTO link_views (link_id, day, visitor, created_at) VALUES (?, ?, ?, ?)').run(l.id, tehranDay(), visitorOf(req), Date.now());
    reply.header('Cache-Control', 'no-store');
    return publicInfo(l, merchant, statsFor(l.merchant_id, l.id).get(l.id) || ZERO, ratesOf(l.merchant_id));
  });

  app.post('/api/pub/links/:slug/pay', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const first = bySlug((req.params as any).slug);
    if (!first) return fail(reply, 404, 'not_found', 'لینک پرداخت پیدا نشد');
    return withLock(first.id, async () => {
      const l = bySlug(first.slug);
      if (!l) return fail(reply, 404, 'not_found', 'لینک پرداخت پیدا نشد');
      const merchant = db().prepare('SELECT id, name, handle, status FROM merchants WHERE id = ?').get(l.merchant_id) as any;
      const rates = ratesOf(l.merchant_id);
      const s = statsFor(l.merchant_id, l.id).get(l.id) || ZERO;
      const visitor = visitorOf(req);
      const b = (req.body || {}) as any;
      const fx = isFx(l.currency);
      const errors: Record<string, string> = {};

      // payer fields
      const payer: Record<string, string> = {};
      const name = str(b.name, 100), mobileRaw = typeof b.mobile === 'string' ? b.mobile.trim() : '', emailRaw = typeof b.email === 'string' ? b.email.trim() : '';
      const address = str(b.address, 400), note = str(b.note, 400);
      const need = (f: Field, present: boolean) => l.collect[f] === 'required' && !present;
      if (l.collect.name !== 'off') {
        if (need('name', !!name)) errors.name = 'نام و نام خانوادگی را وارد کنید';
        else if (name && (name.length < 2 || name.length > 80)) errors.name = 'نام باید بین ۲ تا ۸۰ حرف باشد';
        else if (name) payer.name = name;
      }
      if (l.collect.mobile !== 'off') {
        const mob = mobileRaw ? normalizeMobile(mobileRaw) : null;
        if (need('mobile', !!mobileRaw)) errors.mobile = 'شمارهٔ موبایل را وارد کنید';
        else if (mobileRaw && !mob) errors.mobile = 'شمارهٔ موبایل معتبر نیست (مثل ۰۹۱۲۱۲۳۴۵۶۷)';
        else if (mob) payer.mobile = mob;
      }
      if (l.collect.email !== 'off') {
        const em = emailRaw ? normalizeEmail(emailRaw) : null;
        if (need('email', !!emailRaw)) errors.email = 'ایمیل را وارد کنید';
        else if (emailRaw && !em) errors.email = 'ایمیل معتبر نیست';
        else if (em) payer.email = em;
      }
      if (l.collect.address !== 'off') {
        if (need('address', !!address)) errors.address = 'آدرس را وارد کنید';
        else if (address && (address.length < 5 || address.length > 300)) errors.address = 'آدرس باید بین ۵ تا ۳۰۰ حرف باشد';
        else if (address) payer.address = address;
      }
      if (l.collect.note !== 'off') {
        if (need('note', !!note)) errors.note = 'توضیحات را وارد کنید';
        else if (note.length > 300) errors.note = 'توضیحات حداکثر ۳۰۰ حرف است';
        else if (note) payer.note = note;
      }

      // amount
      let price: number | null = null; // in link currency
      let choice: { index: number; label: string } | null = null;
      if (l.amount_mode === 'fixed') price = l.amount;
      else if (l.amount_mode === 'choice') {
        const i = typeof b.choice === 'number' ? b.choice : parseAmount(b.choice, false);
        if (!Number.isInteger(i) || i < 0 || i >= l.choices.length) errors.choice = 'یکی از گزینه‌ها را انتخاب کنید';
        else { price = l.choices[i].amount; choice = { index: i, label: l.choices[i].label }; }
      } else {
        const n = parseAmount(b.amount, fx);
        if (b.amount === undefined || b.amount === null || b.amount === '') errors.amount = 'مبلغ را وارد کنید';
        else if (!Number.isFinite(n) || n <= 0) errors.amount = 'مبلغ معتبر نیست';
        else {
          price = fx ? round2(n) : n;
          const unit = fx ? CURRENCIES[l.currency].name : 'تومان';
          const f = (x: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(x);
          if (l.min_amount !== null && price < l.min_amount) errors.amount = `حداقل مبلغ ${f(l.min_amount)} ${unit} است`;
          else if (l.max_amount !== null && price > l.max_amount) errors.amount = `حداکثر مبلغ ${f(l.max_amount)} ${unit} است`;
        }
      }

      const st = publicState(l, merchant, s, rates);
      if (!st.available) return fail(reply, 409, st.reason!, st.message!);
      if (Object.keys(errors).length) return fail(reply, 422, 'validation', Object.values(errors)[0], errors);

      const rate = fx ? rates.get(l.currency)! : null;
      const baseToman = toToman(price, l.currency, rates)!;
      if (!Number.isSafeInteger(baseToman) || baseToman < MIN_TOMAN || baseToman > MAX_TOMAN) {
        const msg = baseToman < MIN_TOMAN ? 'مبلغ پرداخت نباید کمتر از ۱٬۰۰۰ تومان باشد' : 'مبلغ پرداخت نباید بیشتر از ۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان باشد';
        return fail(reply, 422, 'validation', msg, { [l.amount_mode === 'choice' ? 'choice' : 'amount']: msg });
      }

      const now = new Date();
      const d = db();
      // Same visitor, same link, same amount and payer, still open: reuse instead of reserving another unique amount.
      const open = d
        .prepare(
          `SELECT id, expected_amount, expires_at, metadata FROM invoices WHERE merchant_id = ? AND status = 'PENDING' AND expires_at > ?
             AND metadata LIKE '%"link_id"%' AND ${LID} = ? ORDER BY created_at DESC LIMIT 50`,
        )
        .all(l.merchant_id, now.toISOString(), l.id) as any[];
      const mine = open.filter((r) => { try { return JSON.parse(r.metadata).visitor === visitor; } catch { return false; } });
      const same = mine.find((r) => {
        try {
          const md = JSON.parse(r.metadata);
          return md.base_toman === baseToman && (md.payer?.mobile || '') === (payer.mobile || '') && (md.payer?.name || '') === (payer.name || '') &&
            (md.payer?.email || '') === (payer.email || '') && new Date(r.expires_at).getTime() - Date.now() > 10 * 60_000;
        } catch { return false; }
      });
      if (same) {
        return reply.status(200).send({
          success: true, reused: true, invoice_id: same.id, pay_url: `/checkout.html?invoice_id=${encodeURIComponent(same.id)}`,
          amount_rial: Number(same.expected_amount), amount_toman: Math.round(Number(same.expected_amount) / 10), expires_at: same.expires_at,
        });
      }
      if (mine.length >= MAX_OPEN_PER_VISITOR) return fail(reply, 429, 'too_many_open', 'چند پرداخت نیمه‌تمام با این لینک دارید؛ همان‌ها را کامل کنید یا چند دقیقهٔ دیگر دوباره تلاش کنید');

      const invoiceId = 'INV' + crypto.randomBytes(5).toString('hex').toUpperCase();
      let inv;
      try {
        inv = await InvoiceRepository.create({
          merchantId: l.merchant_id,
          invoiceId,
          customerName: (payer.name || l.title).slice(0, 120),
          customerEmail: payer.email,
          amount: baseToman * 10,
          redirectUrl: l.redirect_url || undefined,
          expiresInMinutes: INVOICE_MINUTES,
          source: 'link',
        });
      } catch (e) {
        if (e instanceof GuardError) return fail(reply, 402, e.code, e.message);
        if (e instanceof Error && /unique amount/i.test(e.message)) return fail(reply, 503, 'busy', 'در این لحظه پرداخت‌های زیادی با این مبلغ باز است؛ چند دقیقهٔ دیگر دوباره تلاش کنید');
        throw e;
      }
      const metadata: Record<string, unknown> = {
        link_id: l.id,
        link_slug: l.slug,
        link_title: l.title,
        base_toman: baseToman,
        payer,
        visitor,
        ...(choice ? { choice } : {}),
        ...(fx && rate ? { fx: { currency: l.currency, price, rate_toman: rate.rate_toman, rate_updated_at: new Date(rate.updated_at).toISOString(), toman: baseToman } } : {}),
        ...(l.success_message ? { success_message: l.success_message } : {}),
      };
      const label = [l.title, choice?.label, payer.note].filter(Boolean).join(' — ').slice(0, 200);
      d.prepare('UPDATE invoices SET metadata = ?, channel = ?, note = ? WHERE id = ?').run(JSON.stringify(metadata), l.channel, label, inv.invoice_id);
      return reply.status(201).send({
        success: true,
        invoice_id: inv.invoice_id,
        pay_url: `/checkout.html?invoice_id=${encodeURIComponent(inv.invoice_id)}`,
        amount_rial: inv.amount,
        amount_toman: inv.amount / 10,
        expires_at: inv.expires_at,
      });
    });
  });
}

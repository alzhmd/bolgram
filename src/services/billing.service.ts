import crypto from 'node:crypto';
import { dbService } from '../db/database.js';
import { events, GuardError, registerInvoiceGuard, registerLimitProvider, type LimitKey } from './events.js';

/**
 * Billing domain: fee wallet (ledger in Rial), plans and subscriptions, top-ups and referral rewards.
 * Everything here is synchronous SQLite, so each operation is atomic within the process; ledger writes
 * are additionally idempotent through UNIQUE(kind, ref).
 */
const db = () => (dbService as any).db as import('node:sqlite').DatabaseSync;

export const FREE_PLAN = 'free';
export const DURATIONS: Record<number, number> = { 1: 0, 3: 5, 6: 10, 12: 20 };
export const KIND_LABELS: Record<string, string> = {
  topup: 'شارژ کیف پول',
  bonus: 'هدیهٔ شارژ',
  fee: 'کارمزد تراکنش',
  plan: 'خرید پلن',
  refund: 'بازگشت وجه',
  adjust: 'اصلاح توسط پشتیبانی',
  referral: 'پاداش دعوت',
  signup_bonus: 'هدیهٔ عضویت',
};
export const KINDS = Object.keys(KIND_LABELS);
const DAY = 86_400_000;
const MONTH = 30 * DAY;

// ------------------------------------------------------------------ schema

let schemaReady = false;
export function ensureBillingSchema() {
  if (schemaReady) return;
  const d = db();
  d.exec(`CREATE TABLE IF NOT EXISTS billing_plans (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', monthly_price_toman INTEGER NOT NULL DEFAULT 0,
    fee_percent REAL NOT NULL DEFAULT 0, fee_min_toman INTEGER NOT NULL DEFAULT 0, fee_max_toman INTEGER,
    credit_toman INTEGER NOT NULL DEFAULT 0, limits TEXT NOT NULL DEFAULT '{}', features TEXT NOT NULL DEFAULT '[]',
    sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, highlighted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`);
  d.exec(`CREATE TABLE IF NOT EXISTS billing_subscriptions (
    id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, plan_id TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
    months INTEGER NOT NULL, price_rial INTEGER NOT NULL, created_at INTEGER NOT NULL)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_billsub_merchant ON billing_subscriptions(merchant_id, ends_at)`);
  d.exec(`CREATE TABLE IF NOT EXISTS wallet_ledger (
    id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, kind TEXT NOT NULL, amount_rial INTEGER NOT NULL, balance_after_rial INTEGER NOT NULL,
    ref TEXT, note TEXT, created_at INTEGER NOT NULL)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_wledger_merchant ON wallet_ledger(merchant_id, created_at)`);
  d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_wledger_kind_ref ON wallet_ledger(kind, ref) WHERE ref IS NOT NULL`);
  d.exec(`CREATE TABLE IF NOT EXISTS wallet_balances (merchant_id TEXT PRIMARY KEY, balance_rial INTEGER NOT NULL DEFAULT 0, low_notified_at INTEGER)`);
  d.exec(`CREATE TABLE IF NOT EXISTS wallet_topups (
    id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, amount_rial INTEGER NOT NULL, bonus_rial INTEGER NOT NULL DEFAULT 0, invoice_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, paid_at INTEGER, referral_rial INTEGER NOT NULL DEFAULT 0)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_wtopup_merchant ON wallet_topups(merchant_id, created_at)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_wtopup_invoice ON wallet_topups(invoice_id)`);
  seedPlans();
  schemaReady = true;
}

function seedPlans() {
  const d = db();
  const seeded = d.prepare(`SELECT value FROM system_settings WHERE key = 'billing_plans_seeded'`).get() as any;
  if (seeded) return;
  // Calibrated against typical Iranian card-to-card gateways: free tier with ~1.5% fee, paid tiers trade a monthly fee for lower percentages.
  const seed = [
    { id: 'free', name: 'رایگان', description: 'برای شروع و فروشگاه‌های کوچک', price: 0, pct: 1.5, min: 500, max: 15000, credit: 20000, limits: { cards: 2, links: 3, team: 1, devices: 1 }, features: ['پنل و ربات تلگرام/بله', 'لینک پرداخت', 'پشتیبانی تیکتی'], sort: 1, hl: 0 },
    { id: 'basic', name: 'پایه', description: 'برای فروشگاه‌های اینستاگرامی و تلگرامی', price: 99000, pct: 1, min: 300, max: 10000, credit: 50000, limits: { cards: 5, links: 20, team: 3, devices: 2 }, features: ['همهٔ امکانات پلن رایگان', 'وب‌هوک و API', 'گزارش‌های فروش'], sort: 2, hl: 0 },
    { id: 'pro', name: 'حرفه‌ای', description: 'برای فروشگاه‌های پرفروش', price: 249000, pct: 0.7, min: 200, max: 7000, credit: 100000, limits: { cards: 15, links: 100, team: 10, devices: 5 }, features: ['کارمزد کمتر', 'افزونهٔ ووکامرس', 'پشتیبانی اولویت‌دار'], sort: 3, hl: 1 },
    { id: 'business', name: 'سازمانی', description: 'برای کسب‌وکارهای بزرگ و چندشعبه', price: 699000, pct: 0.4, min: 100, max: 4000, credit: 300000, limits: { cards: null, links: null, team: null, devices: null }, features: ['بدون سقف کارت و دستگاه', 'کمترین کارمزد', 'پشتیبانی اختصاصی'], sort: 4, hl: 0 },
  ];
  const ins = d.prepare(`INSERT OR IGNORE INTO billing_plans (id, name, description, monthly_price_toman, fee_percent, fee_min_toman, fee_max_toman, credit_toman, limits, features, sort, active, highlighted, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
  for (const p of seed) ins.run(p.id, p.name, p.description, p.price, p.pct, p.min, p.max, p.credit, JSON.stringify(p.limits), JSON.stringify(p.features), p.sort, p.hl, Date.now());
  d.prepare(`INSERT OR IGNORE INTO system_settings (key, value) VALUES ('billing_plans_seeded', '1')`).run();
}

// ------------------------------------------------------------------ settings

export interface BillingSettings {
  platform_merchant_id: string;
  topup_min_toman: number;
  bonus_tiers: { min_toman: number; percent: number }[];
  referral_percent: number;
  referral_months: number;
  referral_signup_bonus_toman: number;
  low_balance_toman: number;
}
export const DEFAULT_SETTINGS: BillingSettings = {
  platform_merchant_id: '',
  topup_min_toman: 100_000,
  bonus_tiers: [
    { min_toman: 1_000_000, percent: 5 },
    { min_toman: 3_000_000, percent: 10 },
    { min_toman: 10_000_000, percent: 20 },
  ],
  referral_percent: 10,
  referral_months: 3,
  referral_signup_bonus_toman: 0,
  low_balance_toman: 20_000,
};

export function getSettings(): BillingSettings {
  const row = db().prepare(`SELECT value FROM system_settings WHERE key = 'billing'`).get() as any;
  let saved: any = {};
  try { saved = row ? JSON.parse(row.value) : {}; } catch { /* defaults */ }
  const s = { ...DEFAULT_SETTINGS, ...saved };
  s.bonus_tiers = (Array.isArray(s.bonus_tiers) ? s.bonus_tiers : DEFAULT_SETTINGS.bonus_tiers)
    .map((t: any) => ({ min_toman: Number(t.min_toman), percent: Number(t.percent) }))
    .filter((t: any) => t.min_toman > 0 && t.percent > 0)
    .sort((a: any, b: any) => a.min_toman - b.min_toman);
  return s;
}

/** Validates and stores owner-edited settings; returns { settings } or { errors }. */
export function saveSettings(input: any): { settings?: BillingSettings; errors?: Record<string, string> } {
  const cur = getSettings();
  const errors: Record<string, string> = {};
  const next: BillingSettings = { ...cur };
  const int = (k: keyof BillingSettings, min: number, max: number, label: string) => {
    if (input[k] === undefined) return;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) errors[k] = `${label} باید عددی صحیح بین ${min} و ${max} باشد`;
    else (next as any)[k] = n;
  };
  if (input.platform_merchant_id !== undefined) {
    const id = String(input.platform_merchant_id || '').trim().slice(0, 60);
    if (id && !db().prepare('SELECT 1 FROM merchants WHERE id = ?').get(id)) errors.platform_merchant_id = 'فروشگاهی با این شناسه پیدا نشد';
    else next.platform_merchant_id = id;
  }
  int('topup_min_toman', 1000, 1_000_000_000, 'حداقل شارژ');
  int('referral_months', 1, 60, 'مدت پاداش دعوت (ماه)');
  int('referral_signup_bonus_toman', 0, 100_000_000, 'هدیهٔ عضویت');
  int('low_balance_toman', 0, 1_000_000_000, 'آستانهٔ کم‌بودن موجودی');
  if (input.referral_percent !== undefined) {
    const n = Number(input.referral_percent);
    if (!Number.isFinite(n) || n < 0 || n > 50) errors.referral_percent = 'درصد پاداش باید بین ۰ تا ۵۰ باشد';
    else next.referral_percent = n;
  }
  if (input.bonus_tiers !== undefined) {
    const tiers = Array.isArray(input.bonus_tiers) ? input.bonus_tiers : null;
    const clean = (tiers || []).slice(0, 10).map((t: any) => ({ min_toman: Number(t?.min_toman), percent: Number(t?.percent) }));
    if (!tiers || clean.some((t: any) => !Number.isInteger(t.min_toman) || t.min_toman < 1000 || !(t.percent > 0 && t.percent <= 100))) {
      errors.bonus_tiers = 'هر پله باید حداقل مبلغ (تومان) و درصد بین ۰ تا ۱۰۰ داشته باشد';
    } else next.bonus_tiers = clean.sort((a: any, b: any) => a.min_toman - b.min_toman);
  }
  if (Object.keys(errors).length) return { errors };
  db().prepare(`INSERT INTO system_settings (key, value, updated_at) VALUES ('billing', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(JSON.stringify(next));
  return { settings: getSettings() };
}

export function bonusPercent(toman: number, s = getSettings()): number {
  let p = 0;
  for (const t of s.bonus_tiers) if (toman >= t.min_toman) p = t.percent;
  return p;
}

// ------------------------------------------------------------------ plans

export interface Plan {
  id: string; name: string; description: string; monthly_price_toman: number; fee_percent: number; fee_min_toman: number; fee_max_toman: number | null;
  credit_toman: number; limits: Record<LimitKey, number | null>; features: string[]; sort: number; active: boolean; highlighted: boolean;
}
const planOf = (r: any): Plan => {
  let limits: any = {}, features: any = [];
  try { limits = JSON.parse(r.limits || '{}'); } catch { /* */ }
  try { features = JSON.parse(r.features || '[]'); } catch { /* */ }
  const lim = (k: string) => (limits[k] === null || limits[k] === undefined ? null : Number(limits[k]));
  return {
    id: r.id, name: r.name, description: r.description || '', monthly_price_toman: Number(r.monthly_price_toman), fee_percent: Number(r.fee_percent),
    fee_min_toman: Number(r.fee_min_toman), fee_max_toman: r.fee_max_toman === null || r.fee_max_toman === undefined ? null : Number(r.fee_max_toman),
    credit_toman: Number(r.credit_toman), limits: { cards: lim('cards'), links: lim('links'), team: lim('team'), devices: lim('devices') },
    features: Array.isArray(features) ? features.map(String) : [], sort: Number(r.sort), active: !!r.active, highlighted: !!r.highlighted,
  };
};
export function getPlan(id: string): Plan | null {
  const r = db().prepare('SELECT * FROM billing_plans WHERE id = ?').get(id);
  return r ? planOf(r) : null;
}
export function listPlans(onlyActive: boolean): Plan[] {
  return (db().prepare(`SELECT * FROM billing_plans ${onlyActive ? 'WHERE active = 1' : ''} ORDER BY sort, monthly_price_toman`).all() as any[]).map(planOf);
}

/** Validates a plan body. `create` requires id/name. Returns clean columns or errors. */
export function cleanPlan(b: any, create: boolean): { data?: Record<string, any>; errors?: Record<string, string> } {
  const errors: Record<string, string> = {};
  const data: Record<string, any> = {};
  const has = (k: string) => b[k] !== undefined;
  if (create) {
    const id = String(b.id || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,23}$/.test(id)) errors.id = 'شناسه باید ۲ تا ۲۴ حرف لاتین کوچک، عدد یا خط تیره باشد';
    else data.id = id;
  }
  if (create || has('name')) {
    const n = typeof b.name === 'string' ? b.name.trim().slice(0, 40) : '';
    if (n.length < 2) errors.name = 'نام پلن را وارد کنید'; else data.name = n;
  }
  if (has('description')) data.description = String(b.description ?? '').trim().slice(0, 200);
  const int = (k: string, max: number, label: string, nullable = false) => {
    if (!has(k)) return;
    if (nullable && (b[k] === null || b[k] === '')) { data[k] = null; return; }
    const n = Number(b[k]);
    if (!Number.isInteger(n) || n < 0 || n > max) errors[k] = `${label} باید عددی صحیح و نامنفی باشد`; else data[k] = n;
  };
  int('monthly_price_toman', 1_000_000_000, 'قیمت ماهانه');
  int('fee_min_toman', 100_000_000, 'حداقل کارمزد');
  int('fee_max_toman', 100_000_000, 'سقف کارمزد', true);
  int('credit_toman', 1_000_000_000, 'اعتبار منفی مجاز');
  int('sort', 1000, 'ترتیب');
  if (has('fee_percent')) {
    const n = Number(b.fee_percent);
    if (!Number.isFinite(n) || n < 0 || n > 20) errors.fee_percent = 'درصد کارمزد باید بین ۰ تا ۲۰ باشد'; else data.fee_percent = n;
  }
  if (has('limits')) {
    const l = b.limits && typeof b.limits === 'object' ? b.limits : {};
    const out: any = {};
    for (const k of ['cards', 'links', 'team', 'devices']) {
      const v = l[k];
      if (v === null || v === undefined || v === '') out[k] = null;
      else if (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 100000) out[k] = Number(v);
      else errors.limits = 'سقف‌ها باید عدد صحیح یا خالی (نامحدود) باشند';
    }
    data.limits = JSON.stringify(out);
  }
  if (has('features')) {
    if (!Array.isArray(b.features)) errors.features = 'ویژگی‌ها باید فهرست متن باشند';
    else data.features = JSON.stringify(b.features.map((x: any) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 15));
  }
  if (has('active')) data.active = b.active ? 1 : 0;
  if (has('highlighted')) data.highlighted = b.highlighted ? 1 : 0;
  if (data.fee_min_toman !== undefined && data.fee_max_toman != null && data.fee_max_toman < data.fee_min_toman) errors.fee_max_toman = 'سقف کارمزد از حداقل کمتر است';
  return Object.keys(errors).length ? { errors } : { data };
}

// ------------------------------------------------------------------ subscriptions

export interface Current { plan: Plan; subscription: { id: string; plan_id: string; starts_at: number; ends_at: number; months: number } | null }

/** Resolves the live plan lazily (expired → free) and keeps merchants.plan in sync. */
export function currentPlan(merchantId: string): Current {
  ensureBillingSchema();
  const now = Date.now();
  const sub = db().prepare(`SELECT * FROM billing_subscriptions WHERE merchant_id = ? AND starts_at <= ? AND ends_at > ? ORDER BY ends_at DESC LIMIT 1`).get(merchantId, now, now) as any;
  const plan = (sub && getPlan(sub.plan_id)) || getPlan(FREE_PLAN) || planOf({ id: FREE_PLAN, name: 'رایگان', limits: '{}', features: '[]', monthly_price_toman: 0, fee_percent: 0, fee_min_toman: 0, credit_toman: 0, sort: 0, active: 1 });
  const label = (sub ? plan.id : FREE_PLAN).toUpperCase();
  const m = db().prepare('SELECT plan FROM merchants WHERE id = ?').get(merchantId) as any;
  if (m && m.plan !== label) db().prepare('UPDATE merchants SET plan = ? WHERE id = ?').run(label, merchantId);
  return { plan, subscription: sub && plan.id === sub.plan_id ? sub : null };
}

export class BillingError extends Error {
  constructor(public status: number, public code: string, message: string, public errors?: Record<string, string>) { super(message); }
}

export function subscribe(merchantId: string, planId: string, months: number) {
  ensureBillingSchema();
  if (!(months in DURATIONS)) throw new BillingError(422, 'validation', 'مدت اشتراک باید ۱، ۳، ۶ یا ۱۲ ماه باشد', { months: 'مدت نامعتبر است' });
  const plan = getPlan(planId);
  if (!plan || !plan.active) throw new BillingError(404, 'not_found', 'این پلن پیدا نشد یا فعال نیست');
  if (plan.monthly_price_toman <= 0) throw new BillingError(409, 'free_plan', 'پلن رایگان نیاز به خرید ندارد؛ پس از پایان اشتراک خودکار فعال می‌شود');
  const priceToman = Math.round((plan.monthly_price_toman * months * (100 - DURATIONS[months])) / 100);
  const priceRial = priceToman * 10;
  return tx(() => {
    const bal = balanceOf(merchantId);
    if (bal < priceRial) throw new BillingError(402, 'insufficient_wallet', 'موجودی کیف پول برای خرید این پلن کافی نیست؛ ابتدا کیف پول را شارژ کنید');
    const now = Date.now();
    const cur = currentPlan(merchantId);
    const id = 'sub_' + crypto.randomBytes(8).toString('hex');
    let ends: number;
    if (cur.subscription && cur.subscription.plan_id === plan.id) {
      // renewal: extend the running subscription
      ends = cur.subscription.ends_at + months * MONTH;
      db().prepare('UPDATE billing_subscriptions SET ends_at = ?, months = months + ?, price_rial = price_rial + ? WHERE id = ?').run(ends, months, priceRial, cur.subscription.id);
    } else {
      // switch: the new plan replaces the running one from now
      if (cur.subscription) db().prepare('UPDATE billing_subscriptions SET ends_at = ? WHERE merchant_id = ? AND ends_at > ?').run(now, merchantId, now);
      ends = now + months * MONTH;
      db().prepare(`INSERT INTO billing_subscriptions (id, merchant_id, plan_id, starts_at, ends_at, months, price_rial, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, merchantId, plan.id, now, ends, months, priceRial, now);
    }
    post(merchantId, 'plan', -priceRial, id, `${plan.name} · ${months} ماهه`);
    currentPlan(merchantId);
    return { id, plan, ends_at: ends, price_rial: priceRial, balance_rial: balanceOf(merchantId) };
  });
}

// ------------------------------------------------------------------ ledger

let depth = 0;
/** Nested-safe transaction (savepoints). */
export function tx<T>(fn: () => T): T {
  const name = `sp${depth++}`;
  db().exec(`SAVEPOINT ${name}`);
  try {
    const r = fn();
    db().exec(`RELEASE ${name}`);
    return r;
  } catch (e) {
    db().exec(`ROLLBACK TO ${name}`);
    db().exec(`RELEASE ${name}`);
    throw e;
  } finally {
    depth--;
  }
}

export function balanceOf(merchantId: string): number {
  const r = db().prepare('SELECT balance_rial FROM wallet_balances WHERE merchant_id = ?').get(merchantId) as any;
  return r ? Number(r.balance_rial) : 0;
}

/** Appends a ledger entry and updates the balance. Returns null when (kind, ref) already exists (idempotent). */
export function post(merchantId: string, kind: string, amountRial: number, ref: string | null, note?: string): { id: string; balance_after_rial: number } | null {
  ensureBillingSchema();
  return tx(() => {
    if (ref && db().prepare('SELECT 1 FROM wallet_ledger WHERE kind = ? AND ref = ?').get(kind, ref)) return null;
    const after = balanceOf(merchantId) + amountRial;
    const id = 'wl_' + crypto.randomBytes(8).toString('hex');
    db().prepare(`INSERT INTO wallet_ledger (id, merchant_id, kind, amount_rial, balance_after_rial, ref, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, merchantId, kind, amountRial, after, ref, note || null, Date.now());
    db().prepare(`INSERT INTO wallet_balances (merchant_id, balance_rial) VALUES (?, ?) ON CONFLICT(merchant_id) DO UPDATE SET balance_rial = excluded.balance_rial`).run(merchantId, after);
    return { id, balance_after_rial: after };
  });
}

export function feeFor(plan: Plan, amountRial: number): number {
  let fee = Math.round((amountRial * plan.fee_percent) / 100);
  fee = Math.max(fee, plan.fee_min_toman * 10);
  if (plan.fee_max_toman) fee = Math.min(fee, plan.fee_max_toman * 10);
  return fee;
}

export function walletState(merchantId: string) {
  const { plan, subscription } = currentPlan(merchantId);
  const s = getSettings();
  const balance = balanceOf(merchantId);
  const credit = plan.credit_toman * 10;
  const isPlatform = !!s.platform_merchant_id && s.platform_merchant_id === merchantId;
  return { plan, subscription, balance_rial: balance, credit_rial: credit, blocked: !isPlatform && balance < -credit, low: balance < s.low_balance_toman * 10, settings: s };
}

/** Credits the one-time sign-up gift for referred stores (idempotent). */
export function ensureSignupBonus(merchantId: string) {
  ensureBillingSchema();
  const s = getSettings();
  if (s.referral_signup_bonus_toman <= 0) return;
  const m = db().prepare('SELECT referred_by FROM merchants WHERE id = ?').get(merchantId) as any;
  if (!m?.referred_by) return;
  const r = post(merchantId, 'signup_bonus', s.referral_signup_bonus_toman * 10, merchantId, 'هدیهٔ عضویت با کد دعوت');
  if (r) events.emit('wallet.credited', { merchantId, amount: s.referral_signup_bonus_toman * 10, kind: 'signup_bonus' });
}

// ------------------------------------------------------------------ top-ups, fees, referral

const parseTs = (s: unknown) => new Date(String(s).includes('T') ? String(s) : String(s).replace(' ', 'T') + 'Z').getTime();

function creditTopup(topup: any) {
  const s = getSettings();
  const payer = db().prepare('SELECT referred_by, created_at FROM merchants WHERE id = ?').get(topup.merchant_id) as any;
  const result = tx(() => {
    const fresh = db().prepare('SELECT * FROM wallet_topups WHERE id = ?').get(topup.id) as any;
    if (!fresh || fresh.status === 'paid') return null;
    const now = Date.now();
    post(fresh.merchant_id, 'topup', fresh.amount_rial, fresh.id, 'شارژ کیف پول');
    if (fresh.bonus_rial > 0) post(fresh.merchant_id, 'bonus', fresh.bonus_rial, fresh.id, 'هدیهٔ شارژ');
    let referrer: string | null = null;
    let reward = 0;
    if (payer?.referred_by && s.referral_percent > 0 && now - parseTs(payer.created_at) <= s.referral_months * MONTH
      && db().prepare('SELECT 1 FROM merchants WHERE id = ?').get(payer.referred_by)) {
      reward = Math.floor((fresh.amount_rial * s.referral_percent) / 100);
      if (reward > 0 && post(payer.referred_by, 'referral', reward, fresh.id, 'پاداش دعوت دوست')) referrer = payer.referred_by;
      else reward = 0;
    }
    db().prepare(`UPDATE wallet_topups SET status = 'paid', paid_at = ?, referral_rial = ? WHERE id = ?`).run(now, reward, fresh.id);
    return { fresh, referrer, reward };
  });
  if (!result) return;
  events.emit('wallet.credited', { merchantId: result.fresh.merchant_id, amount: result.fresh.amount_rial + result.fresh.bonus_rial, kind: 'topup' });
  if (result.referrer) events.emit('wallet.credited', { merchantId: result.referrer, amount: result.reward, kind: 'referral' });
}

function onInvoicePaid(e: { merchantId: string; invoiceId: string; amount: number }) {
  ensureBillingSchema();
  const s = getSettings();
  if (s.platform_merchant_id && e.merchantId === s.platform_merchant_id) {
    // The platform's own store never pays fees; its invoices may be wallet top-ups.
    const inv = db().prepare('SELECT metadata FROM invoices WHERE id = ?').get(e.invoiceId) as any;
    let topupId = '';
    try { topupId = String(JSON.parse(inv?.metadata || '{}').topup_id || ''); } catch { /* */ }
    if (!topupId) return;
    const topup = db().prepare('SELECT * FROM wallet_topups WHERE id = ? AND invoice_id = ?').get(topupId, e.invoiceId) as any;
    if (topup) creditTopup(topup);
    return;
  }
  const { plan } = currentPlan(e.merchantId);
  const fee = feeFor(plan, e.amount);
  if (fee <= 0) return;
  const r = post(e.merchantId, 'fee', -fee, e.invoiceId, `کارمزد فاکتور ${e.invoiceId}`);
  if (!r) return;
  if (r.balance_after_rial < s.low_balance_toman * 10) {
    const row = db().prepare('SELECT low_notified_at FROM wallet_balances WHERE merchant_id = ?').get(e.merchantId) as any;
    if (!row?.low_notified_at || Date.now() - Number(row.low_notified_at) >= DAY) {
      db().prepare('UPDATE wallet_balances SET low_notified_at = ? WHERE merchant_id = ?').run(Date.now(), e.merchantId);
      events.emit('wallet.low', { merchantId: e.merchantId, balance: r.balance_after_rial });
    }
  }
}

let wired = false;
/** Subscribes to events and registers guards/limits once per process. */
export function wireBilling() {
  ensureBillingSchema();
  if (wired) return;
  wired = true;
  events.on('invoice.paid', onInvoicePaid);
  registerInvoiceGuard((merchantId) => {
    const s = getSettings();
    if (s.platform_merchant_id && merchantId === s.platform_merchant_id) return;
    const w = walletState(merchantId);
    if (w.blocked) {
      throw new GuardError(402, 'wallet_empty', 'موجودی کیف پول شما تمام شده و سقف اعتبار پلن پر است. برای ساخت فاکتور جدید، از بخش «کیف پول» آن را شارژ کنید.');
    }
  });
  registerLimitProvider((merchantId, key) => {
    const s = getSettings();
    if (s.platform_merchant_id && merchantId === s.platform_merchant_id) return null;
    return currentPlan(merchantId).plan.limits[key] ?? null;
  });
}

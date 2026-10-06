import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { db, merchantOf, fail, paging, csv, tomanOf } from './_kit.js';
import { audit, requirePerm } from '../../services/access.js';
import { events, GuardError } from '../../services/events.js';
import { InvoiceRepository } from '../../db/repositories/invoice.repository.js';
import { publicBase } from '../../bot/bot.service.js';
import {
  BillingError, DURATIONS, KINDS, KIND_LABELS, bonusPercent, cleanPlan, currentPlan, ensureBillingSchema, ensureSignupBonus, getPlan, getSettings,
  listPlans, post, saveSettings, subscribe, walletState, wireBilling, FREE_PLAN, type Plan,
} from '../../services/billing.service.js';

/**
 * Feature plugin "billing": fee wallet, plans/subscriptions, referral rewards.
 * Merchant API under /api/v2 (wallet, plans, referral), owner API under /api/owner, public pricing at /api/pub/plans.
 * DB stores Rial; request amounts are Toman.
 */

const iso = (ms: unknown) => (ms ? new Date(Number(ms)).toISOString() : null);
const t = (rial: number) => Math.round(rial / 10);

const ledgerView = (r: any) => ({
  id: r.id, kind: r.kind, kind_label: KIND_LABELS[r.kind] || r.kind, amount_rial: Number(r.amount_rial), amount_toman: t(r.amount_rial),
  balance_after_rial: Number(r.balance_after_rial), ref: r.ref, note: r.note, created_at: iso(r.created_at),
});
const planView = (p: Plan) => ({
  id: p.id, name: p.name, description: p.description, monthly_price_toman: p.monthly_price_toman, fee_percent: p.fee_percent,
  fee_min_toman: p.fee_min_toman, fee_max_toman: p.fee_max_toman, credit_toman: p.credit_toman, limits: p.limits, features: p.features,
  highlighted: p.highlighted, sort: p.sort,
});
const mask = (h: string) => (h.length <= 3 ? h.slice(0, 1) + '••' : h.slice(0, 2) + '•••' + h.slice(-1));

/** Parses ?from=&to= (ISO date/datetime) into epoch ms; `to` is inclusive of the whole day for date-only values. */
function range(q: any): { from: number; to: number } | null {
  const p = (v: unknown, end: boolean) => {
    if (typeof v !== 'string' || !v) return null;
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + (end ? 'T23:59:59.999Z' : 'T00:00:00Z') : v);
    return isNaN(d.getTime()) ? NaN : d.getTime();
  };
  const from = p(q?.from, false), to = p(q?.to, true);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return { from: from ?? 0, to: to ?? Date.now() + 1000 };
}

function ledgerQuery(merchantId: string, q: any) {
  const where = ['merchant_id = ?'];
  const args: any[] = [merchantId];
  const kinds = String(q?.kind || '').split(',').filter((k) => KINDS.includes(k));
  if (kinds.length) { where.push(`kind IN (${kinds.map(() => '?').join(',')})`); args.push(...kinds); }
  const r = range(q);
  if (r) { where.push('created_at >= ? AND created_at <= ?'); args.push(r.from, r.to); }
  return { where: where.join(' AND '), args, bad: !r };
}

export default async function billingRoutes(app: FastifyInstance) {
  ensureBillingSchema();
  wireBilling();

  // ============================================================ merchant: wallet
  app.get('/api/v2/wallet', { preHandler: requirePerm('wallet:read') }, async (req) => {
    const m = merchantOf(req);
    ensureSignupBonus(m.id);
    const w = walletState(m.id);
    const s = w.settings;
    const ledger = (db().prepare('SELECT * FROM wallet_ledger WHERE merchant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 8').all(m.id) as any[]).map(ledgerView);
    return {
      success: true,
      wallet: {
        balance_rial: w.balance_rial, balance_toman: t(w.balance_rial), credit_rial: w.credit_rial, credit_toman: t(w.credit_rial),
        blocked: w.blocked, low: w.low, low_balance_toman: s.low_balance_toman,
      },
      plan: { ...planView(w.plan), expires_at: iso(w.subscription?.ends_at) },
      topup: { enabled: !!s.platform_merchant_id, min_toman: s.topup_min_toman, bonus_tiers: s.bonus_tiers, presets_toman: [200_000, 500_000, 1_000_000, 3_000_000, 10_000_000].filter((x) => x >= s.topup_min_toman) },
      ledger,
    };
  });

  app.get('/api/v2/wallet/ledger', { preHandler: requirePerm('wallet:read') }, async (req, reply) => {
    const m = merchantOf(req);
    const q = (req.query || {}) as any;
    const f = ledgerQuery(m.id, q);
    if (f.bad) return fail(reply, 422, 'validation', 'بازهٔ تاریخ نامعتبر است');
    const { page, perPage, limit, offset } = paging(q);
    const total = Number((db().prepare(`SELECT count(*) AS n FROM wallet_ledger WHERE ${f.where}`).get(...f.args) as any).n);
    const rows = db().prepare(`SELECT * FROM wallet_ledger WHERE ${f.where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(...f.args, limit, offset) as any[];
    return { success: true, data: rows.map(ledgerView), page, per_page: perPage, total };
  });

  app.get('/api/v2/wallet/ledger.csv', { preHandler: requirePerm('wallet:read') }, async (req, reply) => {
    const m = merchantOf(req);
    const f = ledgerQuery(m.id, req.query);
    if (f.bad) return fail(reply, 422, 'validation', 'بازهٔ تاریخ نامعتبر است');
    const rows = db().prepare(`SELECT * FROM wallet_ledger WHERE ${f.where} ORDER BY created_at DESC, rowid DESC LIMIT 20000`).all(...f.args) as any[];
    return csv(reply, 'wallet-ledger.csv', ['تاریخ (UTC)', 'نوع', 'مبلغ (تومان)', 'مانده (تومان)', 'شناسه مرجع', 'توضیح'],
      rows.map((r) => [iso(r.created_at), KIND_LABELS[r.kind] || r.kind, t(r.amount_rial), t(r.balance_after_rial), r.ref, r.note]));
  });

  app.post('/api/v2/wallet/topups', { preHandler: requirePerm('wallet:manage') }, async (req, reply) => {
    const m = merchantOf(req);
    const s = getSettings();
    const amount = tomanOf((req.body as any)?.amount);
    if (!Number.isSafeInteger(amount) || amount < s.topup_min_toman || amount > 1_000_000_000) {
      const msg = `مبلغ شارژ باید بین ${new Intl.NumberFormat('fa-IR').format(s.topup_min_toman)} تا ${new Intl.NumberFormat('fa-IR').format(1_000_000_000)} تومان باشد`;
      return fail(reply, 422, 'validation', msg, { amount: msg });
    }
    const platform = s.platform_merchant_id ? (db().prepare('SELECT id FROM merchants WHERE id = ?').get(s.platform_merchant_id) as any) : null;
    const hasCard = platform && db().prepare('SELECT 1 FROM payment_methods WHERE merchant_id = ? AND is_active = 1').get(platform.id);
    if (!platform || !hasCard) return fail(reply, 503, 'topup_unavailable', 'شارژ آنلاین کیف پول فعلاً راه‌اندازی نشده است؛ لطفاً بعداً تلاش کنید یا با پشتیبانی تماس بگیرید.');
    const bonusRial = Math.floor((amount * bonusPercent(amount, s)) / 100) * 10;
    const now = Date.now();
    // reuse an identical, still-open top-up instead of piling up invoices
    const open = db().prepare(`SELECT t.id, t.invoice_id, i.expected_amount, i.expires_at FROM wallet_topups t JOIN invoices i ON i.id = t.invoice_id
      WHERE t.merchant_id = ? AND t.status = 'pending' AND t.amount_rial = ? AND i.status = 'PENDING' AND i.expires_at > ? ORDER BY t.created_at DESC LIMIT 1`).get(m.id, amount * 10, new Date().toISOString()) as any;
    const view = (id: string, invoiceId: string, payable: number, expires: string, reused: boolean) => ({
      success: true, reused, topup: { id, amount_rial: amount * 10, bonus_rial: bonusRial, bonus_percent: bonusPercent(amount, s) },
      invoice_id: invoiceId, pay_amount_rial: payable, expires_at: expires,
      pay_path: `/checkout.html?invoice_id=${encodeURIComponent(invoiceId)}`, pay_url: `${publicBase()}/checkout.html?invoice_id=${encodeURIComponent(invoiceId)}`,
    });
    if (open) return view(open.id, open.invoice_id, Number(open.expected_amount), open.expires_at, true);
    const topupId = 'tp_' + crypto.randomBytes(8).toString('hex');
    const invoiceId = 'INV' + crypto.randomBytes(5).toString('hex').toUpperCase();
    let inv;
    try {
      inv = await InvoiceRepository.create({ merchantId: platform.id, invoiceId, customerName: `شارژ کیف پول ${m.handle || m.name}`, amount: amount * 10, expiresInMinutes: 30, source: 'topup' });
    } catch (e) {
      if (e instanceof GuardError) return fail(reply, e.status, e.code, e.message);
      throw e;
    }
    db().prepare('UPDATE invoices SET metadata = ? WHERE id = ?').run(JSON.stringify({ topup_id: topupId, topup_for: m.id }), inv.invoice_id);
    db().prepare(`INSERT INTO wallet_topups (id, merchant_id, amount_rial, bonus_rial, invoice_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
      .run(topupId, m.id, amount * 10, bonusRial, inv.invoice_id, now);
    audit(req, m.id, 'wallet.topup_created', topupId, { amount_toman: amount });
    return reply.status(201).send(view(topupId, inv.invoice_id, inv.amount, inv.expires_at, false));
  });

  // ============================================================ merchant: plans
  app.get('/api/v2/plans', { preHandler: requirePerm('wallet:read') }, async (req) => {
    const m = merchantOf(req);
    ensureSignupBonus(m.id);
    const w = walletState(m.id);
    const count = (sql: string) => { try { return Number((db().prepare(sql).get(m.id) as any).n); } catch { return 0; } };
    return {
      success: true,
      current: {
        plan: planView(w.plan), expires_at: iso(w.subscription?.ends_at), months: w.subscription?.months ?? null,
        usage: {
          cards: count('SELECT count(*) AS n FROM payment_methods WHERE merchant_id = ?'),
          links: count(`SELECT count(*) AS n FROM link_links WHERE merchant_id = ? AND archived_at IS NULL`),
          team: count(`SELECT count(*) AS n FROM team_members WHERE merchant_id = ? AND status != 'removed'`),
          devices: count('SELECT count(*) AS n FROM devices WHERE merchant_id = ?'),
        },
      },
      balance_rial: w.balance_rial,
      discounts: Object.entries(DURATIONS).map(([months, percent]) => ({ months: Number(months), percent })),
      plans: listPlans(true).map(planView),
    };
  });

  app.post('/api/v2/plans/:id/subscribe', { preHandler: requirePerm('wallet:manage') }, async (req, reply) => {
    const m = merchantOf(req);
    const months = Number((req.body as any)?.months ?? 1);
    try {
      const r = subscribe(m.id, String((req.params as any).id), months);
      audit(req, m.id, 'plan.subscribed', r.plan.id, { months, price_toman: t(r.price_rial) });
      events.emit('plan.changed', { merchantId: m.id, planId: r.plan.id, expiresAt: iso(r.ends_at) });
      return { success: true, plan: planView(r.plan), expires_at: iso(r.ends_at), price_rial: r.price_rial, price_toman: t(r.price_rial), balance_rial: r.balance_rial };
    } catch (e) {
      if (e instanceof BillingError) return fail(reply, e.status, e.code, e.message, e.errors);
      throw e;
    }
  });

  // ============================================================ merchant: referral
  app.get('/api/v2/referral', { preHandler: requirePerm('referral:read') }, async (req) => {
    const m = merchantOf(req);
    const s = getSettings();
    const code = m.handle || m.id;
    const rows = db().prepare(`SELECT m.id, m.handle, m.status, m.created_at,
        (SELECT count(*) FROM wallet_topups t WHERE t.merchant_id = m.id AND t.status = 'paid') AS topups,
        (SELECT coalesce(sum(referral_rial),0) FROM wallet_topups t WHERE t.merchant_id = m.id AND t.status = 'paid') AS reward
      FROM merchants m WHERE m.referred_by = ? ORDER BY m.created_at DESC LIMIT 500`).all(m.id) as any[];
    const referred = rows.map((r) => {
      const joined = new Date(String(r.created_at).replace(' ', 'T') + 'Z');
      return {
        handle_masked: mask(String(r.handle || '—')), joined_at: isNaN(joined.getTime()) ? null : joined.toISOString(),
        status: r.status === 'SUSPENDED' ? 'suspended' : Number(r.topups) > 0 ? 'active' : 'pending',
        in_reward_window: !isNaN(joined.getTime()) && Date.now() - joined.getTime() <= s.referral_months * 30 * 86_400_000,
        topups: Number(r.topups), reward_rial: Number(r.reward), reward_toman: t(Number(r.reward)),
      };
    });
    const earned = Number((db().prepare(`SELECT coalesce(sum(amount_rial),0) AS n FROM wallet_ledger WHERE merchant_id = ? AND kind = 'referral'`).get(m.id) as any).n);
    return {
      success: true, code,
      link: `https://bolgram.ir/register?ref=${encodeURIComponent(code)}`,
      panel_link: `/panel/#/register?ref=${encodeURIComponent(code)}`,
      rules: { reward_percent: s.referral_percent, reward_months: s.referral_months, signup_bonus_toman: s.referral_signup_bonus_toman },
      referred,
      totals: { referred: referred.length, active: referred.filter((r) => r.status === 'active').length, earned_rial: earned, earned_toman: t(earned) },
    };
  });

  app.get('/api/v2/referral/qr', { preHandler: requirePerm('referral:read') }, async (req) => {
    const m = merchantOf(req);
    const svg = await QRCode.toString(`https://bolgram.ir/register?ref=${encodeURIComponent(m.handle || m.id)}`, { type: 'svg', margin: 1, width: 220 });
    return { success: true, svg };
  });

  // ============================================================ owner API
  const platformInfo = (id: string) => {
    if (!id) return null;
    const r = db().prepare('SELECT id, handle, name FROM merchants WHERE id = ?').get(id) as any;
    return r ? { id: r.id, handle: r.handle, name: r.name, has_active_card: !!db().prepare('SELECT 1 FROM payment_methods WHERE merchant_id = ? AND is_active = 1').get(id) } : null;
  };

  app.get('/api/owner/billing/settings', async () => {
    const s = getSettings();
    return { success: true, settings: s, platform_merchant: platformInfo(s.platform_merchant_id) };
  });
  app.put('/api/owner/billing/settings', async (req, reply) => {
    const r = saveSettings((req.body || {}) as any);
    if (r.errors) return fail(reply, 422, 'validation', 'تنظیمات نامعتبر است', r.errors);
    audit(req, null, 'billing.settings_updated', 'billing', r.settings as any);
    return { success: true, settings: r.settings, platform_merchant: platformInfo(r.settings!.platform_merchant_id) };
  });

  const ownerPlan = (p: Plan) => ({
    ...planView(p), active: p.active,
    subscribers: Number((db().prepare('SELECT count(*) AS n FROM billing_subscriptions WHERE plan_id = ? AND ends_at > ?').get(p.id, Date.now()) as any).n),
  });
  app.get('/api/owner/plans', async () => ({ success: true, data: listPlans(false).map(ownerPlan) }));
  app.post('/api/owner/plans', async (req, reply) => {
    const c = cleanPlan((req.body || {}) as any, true);
    if (c.errors) return fail(reply, 422, 'validation', 'اطلاعات پلن نامعتبر است', c.errors);
    if (getPlan(c.data!.id)) return fail(reply, 409, 'exists', 'پلنی با این شناسه وجود دارد', { id: 'شناسه تکراری است' });
    const d: Record<string, any> = { monthly_price_toman: 0, fee_percent: 0, fee_min_toman: 0, fee_max_toman: null, credit_toman: 0, limits: '{}', features: '[]', sort: 100, active: 1, highlighted: 0, description: '', ...c.data! };
    db().prepare(`INSERT INTO billing_plans (id, name, description, monthly_price_toman, fee_percent, fee_min_toman, fee_max_toman, credit_toman, limits, features, sort, active, highlighted, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.id, d.name, d.description, d.monthly_price_toman, d.fee_percent, d.fee_min_toman, d.fee_max_toman, d.credit_toman, d.limits, d.features, d.sort, d.active, d.highlighted, Date.now());
    audit(req, null, 'billing.plan_created', d.id);
    return reply.status(201).send({ success: true, plan: ownerPlan(getPlan(d.id)!) });
  });
  app.patch('/api/owner/plans/:id', async (req, reply) => {
    const id = String((req.params as any).id);
    if (!getPlan(id)) return fail(reply, 404, 'not_found', 'پلن پیدا نشد');
    const body = { ...((req.body || {}) as any) };
    delete body.id;
    if (id === FREE_PLAN && body.active === false) return fail(reply, 409, 'protected', 'پلن رایگان همیشه باید فعال بماند');
    const c = cleanPlan(body, false);
    if (c.errors) return fail(reply, 422, 'validation', 'اطلاعات پلن نامعتبر است', c.errors);
    const keys = Object.keys(c.data!);
    if (keys.length) db().prepare(`UPDATE billing_plans SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => c.data![k]), id);
    if (c.data!.highlighted) db().prepare('UPDATE billing_plans SET highlighted = 0 WHERE id != ?').run(id);
    audit(req, null, 'billing.plan_updated', id, c.data);
    return { success: true, plan: ownerPlan(getPlan(id)!) };
  });
  app.delete('/api/owner/plans/:id', async (req, reply) => {
    const id = String((req.params as any).id);
    if (!getPlan(id)) return fail(reply, 404, 'not_found', 'پلن پیدا نشد');
    if (id === FREE_PLAN) return fail(reply, 409, 'protected', 'پلن رایگان قابل حذف نیست');
    const used = Number((db().prepare('SELECT count(*) AS n FROM billing_subscriptions WHERE plan_id = ?').get(id) as any).n);
    if (used) return fail(reply, 409, 'in_use', 'این پلن اشتراک ثبت‌شده دارد؛ به‌جای حذف، آن را غیرفعال کنید.');
    db().prepare('DELETE FROM billing_plans WHERE id = ?').run(id);
    audit(req, null, 'billing.plan_deleted', id);
    return { success: true };
  });

  app.get('/api/owner/wallets', async (req) => {
    const q = (req.query || {}) as any;
    const { page, perPage, limit, offset } = paging(q);
    const term = String(q.q || '').trim().slice(0, 60);
    const where = term ? `WHERE (m.handle LIKE ? OR m.name LIKE ? OR m.phone LIKE ? OR m.id = ?)` : '';
    const args = term ? [`%${term}%`, `%${term}%`, `%${term}%`, term] : [];
    const total = Number((db().prepare(`SELECT count(*) AS n FROM merchants m ${where}`).get(...args) as any).n);
    const rows = db().prepare(`SELECT m.id, m.handle, m.name, m.phone, m.status FROM merchants m ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as any[];
    const data = rows.map((r) => {
      const w = walletState(r.id);
      return {
        merchant_id: r.id, handle: r.handle, name: r.name, phone: r.phone, status: r.status, balance_rial: w.balance_rial, balance_toman: t(w.balance_rial),
        credit_rial: w.credit_rial, plan_id: w.plan.id, plan_name: w.plan.name, plan_expires_at: iso(w.subscription?.ends_at), blocked: w.blocked,
      };
    });
    return { success: true, data, page, per_page: perPage, total };
  });

  app.post('/api/owner/wallets/:merchantId/adjust', async (req, reply) => {
    const id = String((req.params as any).merchantId);
    if (!db().prepare('SELECT 1 FROM merchants WHERE id = ?').get(id)) return fail(reply, 404, 'not_found', 'فروشگاه پیدا نشد');
    const b = (req.body || {}) as any;
    const raw = Number(typeof b.amount_toman === 'string' ? b.amount_toman.replace(/[٬,\s]/g, '') : b.amount_toman);
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 200) : '';
    const errors: Record<string, string> = {};
    if (!Number.isInteger(raw) || raw === 0 || Math.abs(raw) > 1_000_000_000) errors.amount_toman = 'مبلغ باید عددی صحیح و غیرصفر (مثبت یا منفی) باشد';
    if (note.length < 3) errors.note = 'دلیل اصلاح را بنویسید';
    if (Object.keys(errors).length) return fail(reply, 422, 'validation', 'اطلاعات نامعتبر است', errors);
    const r = post(id, 'adjust', raw * 10, null, note)!;
    audit(req, id, 'wallet.adjusted', r.id, { amount_toman: raw, note });
    if (raw > 0) events.emit('wallet.credited', { merchantId: id, amount: raw * 10, kind: 'adjust' });
    return { success: true, balance_rial: r.balance_after_rial, balance_toman: t(r.balance_after_rial) };
  });

  app.get('/api/owner/topups', async (req, reply) => {
    const q = (req.query || {}) as any;
    // lazily expire top-ups whose invoice can no longer be paid
    db().prepare(`UPDATE wallet_topups SET status = 'expired' WHERE status = 'pending' AND invoice_id IN
      (SELECT id FROM invoices WHERE status IN ('EXPIRED','CANCELLED') OR expires_at < ?)`).run(new Date().toISOString());
    const { page, perPage, limit, offset } = paging(q);
    const status = ['pending', 'paid', 'expired'].includes(q.status) ? q.status : '';
    if (q.status && !status) return fail(reply, 422, 'validation', 'وضعیت نامعتبر است');
    const where = status ? 'WHERE t.status = ?' : '';
    const args = status ? [status] : [];
    const total = Number((db().prepare(`SELECT count(*) AS n FROM wallet_topups t ${where}`).get(...args) as any).n);
    const rows = db().prepare(`SELECT t.*, m.handle, m.name FROM wallet_topups t LEFT JOIN merchants m ON m.id = t.merchant_id ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as any[];
    return {
      success: true, page, per_page: perPage, total,
      data: rows.map((r) => ({
        id: r.id, merchant_id: r.merchant_id, handle: r.handle, name: r.name, amount_rial: r.amount_rial, bonus_rial: r.bonus_rial, referral_rial: r.referral_rial,
        invoice_id: r.invoice_id, status: r.status, created_at: iso(r.created_at), paid_at: iso(r.paid_at),
      })),
    };
  });

  app.get('/api/owner/billing/summary', async (req, reply) => {
    const q = (req.query || {}) as any;
    const r = range(q);
    if (!r) return fail(reply, 422, 'validation', 'بازهٔ تاریخ نامعتبر است');
    const from = q.from ? r.from : Date.now() - 30 * 86_400_000;
    const rows = db().prepare(`SELECT kind, coalesce(sum(amount_rial),0) AS total, count(*) AS n FROM wallet_ledger WHERE created_at >= ? AND created_at <= ? GROUP BY kind`).all(from, r.to) as any[];
    const by = (k: string) => rows.find((x) => x.kind === k) || { total: 0, n: 0 };
    const abs = (k: string) => Math.abs(Number(by(k).total));
    const liabilities = Number((db().prepare('SELECT coalesce(sum(balance_rial),0) AS n FROM wallet_balances').get() as any).n);
    return {
      success: true, from: iso(from), to: iso(r.to),
      fees_rial: abs('fee'), fees_count: by('fee').n,
      plan_sales_rial: abs('plan'), plan_sales_count: by('plan').n,
      topups_rial: Number(by('topup').total), topups_count: by('topup').n,
      bonus_rial: Number(by('bonus').total), referral_rial: Number(by('referral').total), signup_bonus_rial: Number(by('signup_bonus').total),
      adjust_rial: Number(by('adjust').total), refund_rial: Number(by('refund').total),
      wallets_total_rial: liabilities,
    };
  });

  // ============================================================ public pricing
  app.get('/api/pub/plans', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return { success: true, data: listPlans(true).map(planView), discounts: Object.entries(DURATIONS).map(([months, percent]) => ({ months: Number(months), percent })) };
  });
}

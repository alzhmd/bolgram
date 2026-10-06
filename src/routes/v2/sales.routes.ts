import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db, merchantOf, actorOf, fail, paging, utcSql, isoOf, tomanOf, str, csv } from './_kit.js';
import { requirePerm, audit, can } from '../../services/access.js';
import { events } from '../../services/events.js';
import { approveDeposit, rejectDeposit, depositCandidates, bankName, StoreError } from '../../services/store.service.js';
import { formatJalali, startOfTehranDay, tehranParts } from '../../parsers/ir/jalali.js';
import { formatToman } from '../../parsers/ir/persian.js';
import { toLatinDigits } from '../../utils/validate.js';

/**
 * Feature plugin "sales": invoice list/detail/cancel/export, held-deposit review and sales reports.
 * Amounts are Rial in the DB and in `*_rial` fields; filters typed by people (`min`, `max`, `q`) are Toman.
 * "Expired" is computed: a PENDING invoice whose expires_at has passed is reported as EXPIRED everywhere.
 */

// ---------------------------------------------------------------- schema + event log

export function ensureSalesSchema() {
  const d = db();
  // Facts the invoices table does not keep: where an invoice came from, how/when it was paid, who cancelled it.
  d.exec(`CREATE TABLE IF NOT EXISTS sales_invoice_meta (
    invoice_id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, created_source TEXT, paid_source TEXT, paid_at INTEGER,
    cancelled_at INTEGER, cancelled_by TEXT, cancel_reason TEXT)`);
  // Who handled a held deposit and what it looked like before (unmatched_sms.status is overwritten on handling).
  d.exec(`CREATE TABLE IF NOT EXISTS sales_deposit_log (
    sms_id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, action TEXT NOT NULL, prior_status TEXT, invoice_id TEXT, reason TEXT,
    actor_id TEXT, actor_name TEXT, at INTEGER NOT NULL)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_sales_inv_merchant_created ON invoices(merchant_id, created_at)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_sales_tx_merchant_created ON transactions(merchant_id, created_at)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_sales_unmatched_assigned ON unmatched_sms(assigned_invoice_id)`);
}

let subscribed = false;
function subscribeEvents() {
  if (subscribed) return;
  subscribed = true;
  events.on('invoice.created', ({ merchantId, invoiceId, source }) => {
    db()
      .prepare(`INSERT INTO sales_invoice_meta (invoice_id, merchant_id, created_source) VALUES (?, ?, ?)
                ON CONFLICT(invoice_id) DO UPDATE SET created_source = coalesce(sales_invoice_meta.created_source, excluded.created_source)`)
      .run(invoiceId, merchantId, source);
  });
  events.on('invoice.paid', ({ merchantId, invoiceId, source }) => {
    db()
      .prepare(`INSERT INTO sales_invoice_meta (invoice_id, merchant_id, paid_source, paid_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(invoice_id) DO UPDATE SET paid_source = excluded.paid_source, paid_at = excluded.paid_at`)
      .run(invoiceId, merchantId, source, Date.now());
  });
}

// ---------------------------------------------------------------- shared helpers

const STATUS_FA: Record<string, string> = { PENDING: 'در انتظار پرداخت', PAID: 'پرداخت‌شده', EXPIRED: 'منقضی', CANCELLED: 'لغوشده' };
const CHANNEL_FA: Record<string, string> = { instagram: 'اینستاگرام', telegram: 'تلگرام', in_person: 'حضوری', website: 'سایت', other: 'سایر', api: 'API و افزونه‌ها' };
const SOURCE_FA: Record<string, string> = { panel: 'از پنل فروشگاه', bot: 'با ربات تلگرام یا بله', api: 'از طریق API یا افزونه', link: 'از لینک پرداخت', topup: 'شارژ کیف پول', other: '' };
const WEEKDAYS_FA = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const DAY = 86_400_000;
const ID_RE = /^[A-Za-z0-9_-]{3,64}$/;

const msIso = (ms: unknown) => (ms === null || ms === undefined || ms === '' ? null : new Date(Number(ms)).toISOString());
const last4 = (card: unknown) => {
  const d = toLatinDigits(String(card ?? '')).replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : null;
};
/** Payer key for "distinct cards": the digits we know (masked middles collapse the same way for the same card). */
const payerKey = (card: unknown) => {
  const d = toLatinDigits(String(card ?? '')).replace(/\D/g, '');
  return d.length >= 4 ? d : null;
};
const bankOf = (id: unknown) => (id ? String(id).toLowerCase() : null);
const channelOf = (c: unknown) => (c ? String(c) : 'api');
const channelName = (c: string) => CHANNEL_FA[c] || CHANNEL_FA.other;
const toman = (rial: number) => Math.round(rial) / 10;
const round1 = (n: number) => Math.round(n * 10) / 10;
/** Excel treats cells starting with = + - @ as formulas: neutralise text typed by people. */
const safeCell = (s: unknown) => {
  const v = String(s ?? '');
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
};
const likeArg = (s: string) => `%${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
const norm = (col: string) => `replace(replace(coalesce(${col}, ''), 'ي', 'ی'), 'ك', 'ک')`;

function effStatus(status: string, expiresAt: string, nowIso: string) {
  if (status === 'PENDING') return String(expiresAt || '') <= nowIso ? 'EXPIRED' : 'PENDING';
  if (status === 'FAILED') return 'EXPIRED';
  return status;
}

/** ISO instant from a query string; undefined when absent, null when malformed. */
function instant(v: unknown): Date | null | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s) || s.length > 40) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

class BadInput extends Error {
  constructor(public field: string, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- invoices: filters + rows

const INVOICE_JOINS = `FROM invoices i
  LEFT JOIN transactions t ON i.status = 'PAID' AND i.trx_id IS NOT NULL AND t.merchant_id = i.merchant_id AND t.trx_id = upper(i.trx_id)
  LEFT JOIN unmatched_sms u ON i.status = 'PAID' AND u.id = (SELECT x.id FROM unmatched_sms x WHERE x.assigned_invoice_id = i.id AND x.status = 'ASSIGNED' ORDER BY x.created_at LIMIT 1)
  LEFT JOIN sales_invoice_meta mt ON mt.invoice_id = i.id`;
const ROW_COLS = `i.id, i.expected_amount, i.status, i.channel, i.note, i.customer_name, i.created_at, i.expires_at, i.trx_id, i.payment_method,
  t.amount AS t_amount, t.created_at AS t_at, t.sender AS t_sender, t.provider AS t_provider,
  u.id AS u_id, u.amount AS u_amount, u.created_at AS u_at, u.provider AS u_provider,
  mt.paid_at AS m_paid_at, mt.cancelled_at AS m_cancelled_at`;
const RECEIVED = `coalesce(t.amount, u.amount, i.expected_amount)`;

const SORTS: Record<string, string> = {
  newest: 'i.created_at DESC, i.rowid DESC',
  oldest: 'i.created_at ASC, i.rowid ASC',
  amount_desc: 'i.expected_amount DESC, i.created_at DESC',
  amount_asc: 'i.expected_amount ASC, i.created_at DESC',
};

/** Builds the WHERE clause for the invoice list/export from the query string (throws BadInput). */
function invoiceFilter(merchantId: string, q: any, nowIso: string) {
  const where = ['i.merchant_id = ?'];
  const params: any[] = [merchantId];
  const status = String(q?.status ?? '').trim().toLowerCase();
  if (status && status !== 'all') {
    if (status === 'pending') { where.push(`i.status = 'PENDING' AND i.expires_at > ?`); params.push(nowIso); }
    else if (status === 'paid') where.push(`i.status = 'PAID'`);
    else if (status === 'expired') { where.push(`(i.status IN ('EXPIRED','FAILED') OR (i.status = 'PENDING' AND i.expires_at <= ?))`); params.push(nowIso); }
    else if (status === 'cancelled') where.push(`i.status = 'CANCELLED'`);
    else throw new BadInput('status', 'وضعیت انتخاب‌شده معتبر نیست');
  }
  const channel = String(q?.channel ?? '').trim().toLowerCase();
  if (channel && channel !== 'all') {
    if (channel === 'api') where.push(`(i.channel IS NULL OR i.channel = '')`);
    else if (/^[a-z_]{2,20}$/.test(channel)) { where.push('i.channel = ?'); params.push(channel); }
    else throw new BadInput('channel', 'کانال فروش معتبر نیست');
  }
  const from = instant(q?.from), to = instant(q?.to);
  if (from === null) throw new BadInput('from', 'تاریخ شروع معتبر نیست');
  if (to === null) throw new BadInput('to', 'تاریخ پایان معتبر نیست');
  if (from && to && to <= from) throw new BadInput('to', 'تاریخ پایان باید بعد از تاریخ شروع باشد');
  if (from) { where.push('i.created_at >= ?'); params.push(utcSql(from)); }
  if (to) { where.push('i.created_at < ?'); params.push(utcSql(to)); }
  for (const [key, op, label] of [['min', '>=', 'حداقل'], ['max', '<=', 'حداکثر']] as const) {
    const raw = q?.[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const v = tomanOf(raw);
    if (!Number.isSafeInteger(v) || v < 0 || v > 10_000_000_000) throw new BadInput(key, `مبلغ ${label} معتبر نیست`);
    where.push(`i.expected_amount ${op} ?`);
    params.push(v * 10);
  }
  const text = str(q?.q, 80);
  if (text) {
    const ors = [`upper(i.id) LIKE upper(?) ESCAPE '\\'`, `${norm('i.note')} LIKE ? ESCAPE '\\'`, `${norm('i.customer_name')} LIKE ? ESCAPE '\\'`, `upper(coalesce(i.trx_id, '')) LIKE upper(?) ESCAPE '\\'`];
    const like = likeArg(text);
    params.push(like, like, like, like);
    // Amount typed in Toman («۲۵۰٬۰۰۰», "250,000"): exact unique amount, or a round base amount plus its unique tail (up to 999 Toman).
    const digits = toLatinDigits(text).replace(/[\s,٬،.]/g, '');
    if (/^\d{3,11}$/.test(digits)) {
      const t = Number(digits);
      if (t % 100 === 0) { ors.push('i.expected_amount BETWEEN ? AND ?'); params.push(t * 10, t * 10 + 9_990); }
      else { ors.push('i.expected_amount = ?'); params.push(t * 10); }
    }
    where.push(`(${ors.join(' OR ')})`);
  }
  const sortKey = String(q?.sort ?? 'newest');
  if (!SORTS[sortKey]) throw new BadInput('sort', 'ترتیب انتخاب‌شده معتبر نیست');
  return { where: where.join(' AND '), params, order: SORTS[sortKey] };
}

function invoiceView(r: any, nowIso: string) {
  const status = effStatus(r.status, r.expires_at, nowIso);
  const paid = r.status === 'PAID';
  const bank = paid ? bankOf(r.payment_method || r.t_provider || r.u_provider) : null;
  const note = r.note || '';
  const name = r.customer_name && r.customer_name !== 'فاکتور' && r.customer_name !== note ? r.customer_name : '';
  return {
    id: r.id,
    amount_rial: Number(r.expected_amount),
    amount_toman: toman(Number(r.expected_amount)),
    received_rial: paid ? Number(r.t_amount ?? r.u_amount ?? r.expected_amount) : null,
    status,
    channel: channelOf(r.channel),
    note,
    customer_name: name,
    created_at: isoOf(r.created_at),
    expires_at: isoOf(r.expires_at),
    paid_at: paid ? isoOf(r.t_at || r.u_at) || msIso(r.m_paid_at) : null,
    cancelled_at: status === 'CANCELLED' ? msIso(r.m_cancelled_at) : null,
    trx_id: paid ? r.trx_id || null : null,
    bank,
    bank_name: bank ? bankName(bank) : null,
    payer_last4: paid ? last4(r.t_sender) : null,
    pay_path: `/checkout.html?invoice_id=${encodeURIComponent(r.id)}`,
  };
}

function loadInvoice(merchantId: string, id: string, extra = '') {
  return db().prepare(`SELECT ${ROW_COLS}${extra} ${INVOICE_JOINS} WHERE i.id = ? AND i.merchant_id = ?`).get(id, merchantId) as any;
}

// ---------------------------------------------------------------- deposits

const DEPOSIT_SQL = `SELECT u.id, u.provider, u.sender, u.amount, u.trx_id, u.raw_sms, u.status, u.assigned_invoice_id, u.created_at,
    dv.device_name, l.prior_status, l.reason AS log_reason, l.actor_name AS log_actor, l.at AS log_at, l.invoice_id AS log_invoice,
    t.is_verified AS t_verified, t.order_id AS t_order, t.sender AS t_sender
  FROM unmatched_sms u JOIN devices dv ON dv.id = u.device_id AND dv.merchant_id = ?
  LEFT JOIN sales_deposit_log l ON l.sms_id = u.id
  LEFT JOIN transactions t ON t.merchant_id = dv.merchant_id AND t.trx_id = upper(u.trx_id)`;
const DEPOSIT_STATUS: Record<string, string> = { open: `('UNMATCHED','SUSPICIOUS')`, rejected: `('REJECTED')`, assigned: `('ASSIGNED')` };

function depositView(r: any) {
  const open = r.status === 'UNMATCHED' || r.status === 'SUSPICIOUS';
  const prior = open ? r.status : r.prior_status || null;
  const bank = bankOf(r.provider);
  const used = open && Number(r.t_verified) === 1;
  return {
    id: r.id,
    status: open ? 'open' : r.status === 'ASSIGNED' ? 'assigned' : 'rejected',
    trusted: prior ? prior !== 'SUSPICIOUS' : null,
    bank,
    bank_name: bank ? bankName(bank) : null,
    amount_rial: Number(r.amount),
    amount_toman: toman(Number(r.amount)),
    trx_id: r.trx_id,
    sender: r.sender || null,
    payer_last4: last4(r.t_sender),
    device_name: r.device_name || null,
    raw_sms: r.raw_sms || '',
    created_at: isoOf(r.created_at),
    invoice_id: r.status === 'ASSIGNED' ? r.assigned_invoice_id || r.log_invoice || null : null,
    reject_reason: r.status === 'REJECTED' ? (r.log_reason ?? String(r.assigned_invoice_id || '').replace(/^rejected:?\s*/, '')) || null : null,
    handled_by: open ? null : r.log_actor || null,
    handled_at: open ? null : msIso(r.log_at),
    already_used: used,
    used_by: used ? r.t_order || null : null,
  };
}

const loadDeposit = (merchantId: string, id: string) => db().prepare(`${DEPOSIT_SQL} WHERE u.id = ?`).get(merchantId, id) as any;

function logDeposit(req: FastifyRequest, merchantId: string, smsId: string, action: 'approved' | 'rejected', prior: string, invoiceId: string | null, reason: string | null) {
  const a = actorOf(req);
  db()
    .prepare(`INSERT OR REPLACE INTO sales_deposit_log (sms_id, merchant_id, action, prior_status, invoice_id, reason, actor_id, actor_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(smsId, merchantId, action, prior, invoiceId, reason, a?.id || null, a?.name || null, Date.now());
}

// ---------------------------------------------------------------- reports

interface Payment { amount: number; at: Date; bank: string | null; payer: string | null; channel: string; invoice_id: string | null; trx_id: string }

/**
 * Money received in [from, to): verified transactions (automatic, customer TrxID, manual approvals made here)
 * plus held deposits assigned to an invoice whose ledger row was never verified (older/bot approvals). Deposit time = SMS time.
 */
function paymentsBetween(merchantId: string, from: Date, to: Date): Payment[] {
  const d = db();
  const a = d
    .prepare(`SELECT t.amount, t.created_at AS at, coalesce(i.payment_method, t.provider) AS bank, t.sender AS payer, t.trx_id, i.id AS invoice_id, i.channel
              FROM transactions t LEFT JOIN invoices i ON i.id = t.order_id AND i.merchant_id = t.merchant_id
              WHERE t.merchant_id = ? AND t.is_verified = 1 AND t.created_at >= ? AND t.created_at < ?`)
    .all(merchantId, utcSql(from), utcSql(to)) as any[];
  const b = d
    .prepare(`SELECT u.amount, u.created_at AS at, coalesce(i.payment_method, u.provider) AS bank, t.sender AS payer, u.trx_id, i.id AS invoice_id, i.channel
              FROM unmatched_sms u JOIN devices dv ON dv.id = u.device_id AND dv.merchant_id = ?
              JOIN invoices i ON i.id = u.assigned_invoice_id AND i.merchant_id = dv.merchant_id AND i.status = 'PAID'
              LEFT JOIN transactions t ON t.merchant_id = dv.merchant_id AND t.trx_id = upper(u.trx_id)
              WHERE u.status = 'ASSIGNED' AND u.created_at >= ? AND u.created_at < ? AND coalesce(t.is_verified, 0) = 0`)
    .all(merchantId, utcSql(from), utcSql(to)) as any[];
  return [...a, ...b].map((r) => ({
    amount: Number(r.amount) || 0,
    at: new Date(isoOf(r.at) as string),
    bank: bankOf(r.bank),
    payer: payerKey(r.payer),
    channel: r.invoice_id ? channelOf(r.channel) : 'api',
    invoice_id: r.invoice_id || null,
    trx_id: r.trx_id,
  }));
}

function createdStats(merchantId: string, from: Date, to: Date) {
  return db()
    .prepare(`SELECT coalesce(nullif(channel, ''), 'api') AS channel, date(created_at, '+210 minutes') AS day, count(*) AS n, sum(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) AS paid
              FROM invoices WHERE merchant_id = ? AND created_at >= ? AND created_at < ? GROUP BY 1, 2`)
    .all(merchantId, utcSql(from), utcSql(to)) as { channel: string; day: string; n: number; paid: number }[];
}

function totalsOf(pay: Payment[], created: { n: number; paid: number }[]) {
  const paid = pay.reduce((s, p) => s + p.amount, 0);
  const createdCount = created.reduce((s, c) => s + Number(c.n), 0);
  const createdPaid = created.reduce((s, c) => s + Number(c.paid), 0);
  return {
    paid_rial: paid,
    paid_count: pay.length,
    avg_ticket_rial: pay.length ? Math.round(paid / pay.length) : 0,
    distinct_payers: new Set(pay.map((p) => p.payer).filter(Boolean)).size,
    created_count: createdCount,
    created_paid_count: createdPaid,
    conversion_pct: createdCount ? round1((createdPaid / createdCount) * 100) : null,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

function reportRange(q: any) {
  const now = new Date();
  let from = instant(q?.from), to = instant(q?.to);
  if (from === null) throw new BadInput('from', 'تاریخ شروع معتبر نیست');
  if (to === null) throw new BadInput('to', 'تاریخ پایان معتبر نیست');
  const today = startOfTehranDay(now);
  if (!to) to = new Date(today.getTime() + DAY);
  if (!from) from = new Date(Math.min(to.getTime(), today.getTime() + DAY) - 30 * DAY);
  if (to <= from) throw new BadInput('to', 'تاریخ پایان باید بعد از تاریخ شروع باشد');
  if (to.getTime() - from.getTime() > 400 * DAY) throw new BadInput('to', 'بازهٔ گزارش حداکثر ۴۰۰ روز است');
  return { from, to };
}

function buildReport(merchantId: string, from: Date, to: Date) {
  const span = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - span);
  const pay = paymentsBetween(merchantId, from, to);
  const created = createdStats(merchantId, from, to);
  const prevPay = paymentsBetween(merchantId, prevFrom, from);
  const prevCreated = createdStats(merchantId, prevFrom, from);

  const days: any[] = [];
  const byDay = new Map<string, any>();
  for (let t = startOfTehranDay(from).getTime(); t < to.getTime(); t += DAY) {
    const start = new Date(Math.max(t, from.getTime()));
    const p = tehranParts(new Date(t));
    const item = { date: `${p.gy}-${pad(p.gm)}-${pad(p.gd)}`, start: start.toISOString(), jalali: `${p.jy}/${pad(p.jm)}/${pad(p.jd)}`, weekday: p.weekday, paid_rial: 0, paid_count: 0, created_count: 0 };
    days.push(item);
    byDay.set(item.date, item);
  }
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, paid_rial: 0, paid_count: 0 }));
  const weekday = WEEKDAYS_FA.map((name, i) => ({ weekday: i, name, paid_rial: 0, paid_count: 0 }));
  const banks = new Map<string, { bank: string; name: string; paid_rial: number; paid_count: number }>();
  const channels = new Map<string, { channel: string; name: string; paid_rial: number; paid_count: number; created_count: number; created_paid_count: number }>();
  const ch = (c: string) => {
    if (!channels.has(c)) channels.set(c, { channel: c, name: channelName(c), paid_rial: 0, paid_count: 0, created_count: 0, created_paid_count: 0 });
    return channels.get(c)!;
  };
  for (const p of pay) {
    const parts = tehranParts(p.at);
    const day = byDay.get(`${parts.gy}-${pad(parts.gm)}-${pad(parts.gd)}`);
    if (day) { day.paid_rial += p.amount; day.paid_count++; }
    hourly[parts.hour].paid_rial += p.amount; hourly[parts.hour].paid_count++;
    weekday[parts.weekday].paid_rial += p.amount; weekday[parts.weekday].paid_count++;
    const bk = p.bank || 'unknown';
    if (!banks.has(bk)) banks.set(bk, { bank: bk, name: p.bank ? bankName(p.bank) : 'نامشخص', paid_rial: 0, paid_count: 0 });
    const b = banks.get(bk)!;
    b.paid_rial += p.amount; b.paid_count++;
    const c = ch(p.channel);
    c.paid_rial += p.amount; c.paid_count++;
  }
  for (const r of created) {
    const day = byDay.get(r.day);
    if (day) day.created_count += Number(r.n);
    const c = ch(r.channel);
    c.created_count += Number(r.n); c.created_paid_count += Number(r.paid);
  }
  const totals = totalsOf(pay, created);
  const share = (v: number) => (totals.paid_rial ? round1((v / totals.paid_rial) * 100) : 0);
  return {
    range: { from: from.toISOString(), to: to.toISOString(), days: days.length },
    previous: { from: prevFrom.toISOString(), to: from.toISOString() },
    totals,
    previous_totals: totalsOf(prevPay, prevCreated),
    daily: days,
    hourly,
    weekday,
    banks: [...banks.values()].sort((a, b) => b.paid_rial - a.paid_rial).map((b) => ({ ...b, share_pct: share(b.paid_rial) })),
    channels: [...channels.values()]
      .sort((a, b) => b.paid_rial - a.paid_rial || b.created_count - a.created_count)
      .map((c) => ({ ...c, share_pct: share(c.paid_rial), conversion_pct: c.created_count ? round1((c.created_paid_count / c.created_count) * 100) : null })),
    _payments: pay,
  };
}

// ---------------------------------------------------------------- routes

export default async function salesRoutes(app: FastifyInstance) {
  ensureSalesSchema();
  subscribeEvents();

  const bad = (reply: any, e: unknown) => {
    if (e instanceof BadInput) return fail(reply, 422, 'validation', e.message, { [e.field]: e.message });
    throw e;
  };

  // ---------- invoices
  app.get('/api/v2/invoices', { preHandler: requirePerm('invoices:read') }, async (req, reply) => {
    const m = merchantOf(req);
    const nowIso = new Date().toISOString();
    let f;
    try { f = invoiceFilter(m.id, req.query, nowIso); } catch (e) { return bad(reply, e); }
    const p = paging(req.query);
    const d = db();
    const sum = d
      .prepare(`SELECT count(*) AS n, sum(CASE WHEN i.status = 'PAID' THEN 1 ELSE 0 END) AS paid_n, coalesce(sum(CASE WHEN i.status = 'PAID' THEN ${RECEIVED} END), 0) AS paid_s
                ${INVOICE_JOINS} WHERE ${f.where}`)
      .get(...f.params) as any;
    const rows = d.prepare(`SELECT ${ROW_COLS} ${INVOICE_JOINS} WHERE ${f.where} ORDER BY ${f.order} LIMIT ? OFFSET ?`).all(...f.params, p.limit, p.offset) as any[];
    return {
      success: true,
      data: rows.map((r) => invoiceView(r, nowIso)),
      page: p.page,
      per_page: p.perPage,
      total: Number(sum.n),
      totals: { count: Number(sum.n), paid_count: Number(sum.paid_n || 0), paid_sum_rial: Number(sum.paid_s || 0) },
    };
  });

  app.get('/api/v2/invoices/export.csv', { preHandler: requirePerm('invoices:manage') }, async (req, reply) => {
    const m = merchantOf(req);
    const nowIso = new Date().toISOString();
    let f;
    try { f = invoiceFilter(m.id, req.query, nowIso); } catch (e) { return bad(reply, e); }
    const rows = db().prepare(`SELECT ${ROW_COLS} ${INVOICE_JOINS} WHERE ${f.where} ORDER BY ${f.order} LIMIT 10000`).all(...f.params) as any[];
    const jal = (iso: string | null) => (iso ? formatJalali(new Date(iso)) : '');
    audit(req, m.id, 'invoices.exported', undefined, { rows: rows.length });
    return csv(
      reply,
      `bolgram-invoices-${formatJalali(new Date(), false).replace(/\//g, '-')}.csv`,
      ['شماره فاکتور', 'تاریخ ساخت', 'مبلغ فاکتور (تومان)', 'مبلغ دریافتی (تومان)', 'وضعیت', 'کانال فروش', 'بابت', 'نام مشتری', 'زمان پرداخت', 'بانک مقصد', 'کد پیگیری', 'کارت پرداخت‌کننده', 'مهلت پرداخت'],
      rows.map((r) => {
        const v = invoiceView(r, nowIso);
        return [
          v.id, jal(v.created_at), v.amount_toman, v.received_rial === null ? '' : toman(v.received_rial), STATUS_FA[v.status] || v.status, channelName(v.channel),
          safeCell(v.note), safeCell(v.customer_name), jal(v.paid_at), v.bank_name || '', safeCell(v.trx_id || ''), v.payer_last4 ? `****${v.payer_last4}` : '', jal(v.expires_at),
        ];
      }),
    );
  });

  app.get('/api/v2/invoices/:id', { preHandler: requirePerm('invoices:read') }, async (req, reply) => {
    const m = merchantOf(req);
    const id = String((req.params as any).id || '');
    const notFound = () => fail(reply, 404, 'not_found', 'این فاکتور پیدا نشد');
    if (!ID_RE.test(id)) return notFound();
    const r = loadInvoice(m.id, id, `, i.customer_email, i.redirect_url, t.raw_sms AS t_raw, t.device_id AS t_device, t.is_verified AS t_verified, u.raw_sms AS u_raw,
      u.device_id AS u_device, u.trx_id AS u_trx, mt.created_source, mt.paid_source, mt.cancelled_by AS m_cancelled_by, mt.cancel_reason AS m_cancel_reason`);
    if (!r) return notFound();
    const nowIso = new Date().toISOString();
    const v = invoiceView(r, nowIso);
    const d = db();
    const logs = d
      .prepare(`SELECT action, actor_name, meta, created_at FROM audit_log WHERE merchant_id = ? AND (target = ? OR (action = 'deposit.approved' AND meta LIKE ?)) ORDER BY created_at`)
      .all(m.id, id, `%"invoice_id":${JSON.stringify(id)}%`) as any[];
    const approval = logs.find((l) => l.action === 'deposit.approved');
    const cancelLog = logs.find((l) => l.action === 'invoice.cancelled');
    const deviceId = r.t_device || r.u_device;
    const device = deviceId ? (d.prepare('SELECT device_name FROM devices WHERE id = ? AND merchant_id = ?').get(deviceId, m.id) as any) : null;
    const paySource = r.u_id ? 'manual' : r.paid_source || (r.t_verified ? 'auto' : null);

    const payment =
      r.status === 'PAID'
        ? {
            trx_id: v.trx_id,
            bank: v.bank,
            bank_name: v.bank_name,
            amount_rial: v.received_rial,
            difference_rial: (v.received_rial ?? v.amount_rial) - v.amount_rial,
            payer_last4: v.payer_last4,
            at: v.paid_at,
            device_name: device?.device_name || null,
            source: paySource,
            approved_by: approval?.actor_name || null,
            approved_at: approval ? msIso(approval.created_at) : null,
          }
        : null;

    const tl: { type: string; at: string | null; title: string; detail?: string; upcoming?: boolean }[] = [];
    tl.push({ type: 'created', at: v.created_at, title: 'فاکتور ساخته شد', detail: [SOURCE_FA[r.created_source] || '', `مبلغ یکتا ${formatToman(v.amount_rial)}`].filter(Boolean).join(' · ') });
    if (payment) {
      const depositAt = isoOf(r.t_at || r.u_at);
      if (depositAt) {
        tl.push({
          type: 'deposit',
          at: depositAt,
          title: `واریز ${formatToman(payment.amount_rial || 0)} رسید`,
          detail: [payment.bank_name ? `به ${payment.bank_name}` : '', payment.payer_last4 ? `از کارت ****${payment.payer_last4}` : '', payment.device_name ? `پیامک از «${payment.device_name}»` : ''].filter(Boolean).join(' · '),
        });
      }
      if (paySource === 'manual') tl.push({ type: 'paid', at: payment.approved_at || msIso(r.m_paid_at) || depositAt, title: 'پرداخت با تأیید دستی ثبت شد', detail: payment.approved_by ? `توسط ${payment.approved_by}` : '' });
      else tl.push({ type: 'paid', at: msIso(r.m_paid_at) || depositAt || v.paid_at, title: 'پرداخت تأیید شد', detail: paySource === 'customer' ? 'با ثبت کد پیگیری توسط مشتری' : 'تطبیق خودکار مبلغ یکتا با پیامک بانک' });
    }
    if (v.status === 'EXPIRED') tl.push({ type: 'expired', at: v.expires_at, title: 'مهلت پرداخت تمام شد', detail: 'واریزی با این مبلغ نرسید' });
    if (v.status === 'CANCELLED') {
      const by = r.m_cancelled_by || cancelLog?.actor_name;
      const reason = r.m_cancel_reason || (() => { try { return cancelLog?.meta ? JSON.parse(cancelLog.meta).reason || '' : ''; } catch { return ''; } })();
      tl.push({ type: 'cancelled', at: v.cancelled_at || (cancelLog ? msIso(cancelLog.created_at) : null), title: 'فاکتور لغو شد', detail: [by ? `توسط ${by}` : '', reason ? `دلیل: ${reason}` : ''].filter(Boolean).join(' · ') });
    }
    if (v.status === 'PENDING') tl.push({ type: 'deadline', at: v.expires_at, title: 'پایان مهلت پرداخت', detail: 'اگر تا این زمان واریز نرسد، فاکتور منقضی می‌شود', upcoming: true });
    const order = (x: { at: string | null; upcoming?: boolean }) => (x.upcoming ? Infinity : x.at ? new Date(x.at).getTime() : 0);
    tl.sort((a, b) => order(a) - order(b));

    const showSms = can(actorOf(req), 'deposits:review');
    return {
      success: true,
      invoice: { ...v, customer_email: r.customer_email || null, redirect_url: r.redirect_url || null, created_source: r.created_source || null },
      payment,
      timeline: tl,
      raw_sms_allowed: showSms,
      raw_sms: showSms && payment ? r.t_raw || r.u_raw || null : null,
      can_cancel: v.status === 'PENDING',
    };
  });

  app.post('/api/v2/invoices/:id/cancel', { preHandler: requirePerm('invoices:manage') }, async (req, reply) => {
    const m = merchantOf(req);
    const id = String((req.params as any).id || '');
    if (!ID_RE.test(id)) return fail(reply, 404, 'not_found', 'این فاکتور پیدا نشد');
    const reason = str((req.body as any)?.reason, 200);
    const nowIso = new Date().toISOString();
    const res = db().prepare(`UPDATE invoices SET status = 'CANCELLED' WHERE id = ? AND merchant_id = ? AND status = 'PENDING' AND expires_at > ?`).run(id, m.id, nowIso);
    if (!Number(res.changes)) {
      const cur = db().prepare('SELECT status, expires_at FROM invoices WHERE id = ? AND merchant_id = ?').get(id, m.id) as any;
      if (!cur) return fail(reply, 404, 'not_found', 'این فاکتور پیدا نشد');
      const st = effStatus(cur.status, cur.expires_at, nowIso);
      const why: Record<string, string> = { PAID: 'این فاکتور پرداخت شده و قابل لغو نیست', EXPIRED: 'مهلت این فاکتور تمام شده و دیگر قابل پرداخت نیست', CANCELLED: 'این فاکتور قبلاً لغو شده است' };
      return fail(reply, 409, 'not_cancellable', why[st] || 'فقط فاکتورهای در انتظار پرداخت قابل لغو هستند');
    }
    const a = actorOf(req);
    db()
      .prepare(`INSERT INTO sales_invoice_meta (invoice_id, merchant_id, cancelled_at, cancelled_by, cancel_reason) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(invoice_id) DO UPDATE SET cancelled_at = excluded.cancelled_at, cancelled_by = excluded.cancelled_by, cancel_reason = excluded.cancel_reason`)
      .run(id, m.id, Date.now(), a?.name || null, reason || null);
    events.emit('invoice.cancelled', { merchantId: m.id, invoiceId: id });
    const r = loadInvoice(m.id, id);
    audit(req, m.id, 'invoice.cancelled', id, { amount_rial: Number(r.expected_amount), ...(reason ? { reason } : {}) });
    return { success: true, invoice: invoiceView(r, new Date().toISOString()) };
  });

  // ---------- held deposits
  app.get('/api/v2/deposits', { preHandler: requirePerm('deposits:review') }, async (req, reply) => {
    const m = merchantOf(req);
    const q = req.query as any;
    const status = String(q?.status || 'open').toLowerCase();
    if (!DEPOSIT_STATUS[status]) return fail(reply, 422, 'validation', 'وضعیت انتخاب‌شده معتبر نیست', { status: 'وضعیت انتخاب‌شده معتبر نیست' });
    const p = paging(q);
    const d = db();
    const counts = d
      .prepare(`SELECT sum(CASE WHEN u.status IN ('UNMATCHED','SUSPICIOUS') THEN 1 ELSE 0 END) AS open, sum(CASE WHEN u.status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected,
                  sum(CASE WHEN u.status = 'ASSIGNED' THEN 1 ELSE 0 END) AS assigned, sum(CASE WHEN u.status = 'SUSPICIOUS' THEN 1 ELSE 0 END) AS suspicious
                FROM unmatched_sms u JOIN devices dv ON dv.id = u.device_id WHERE dv.merchant_id = ?`)
      .get(m.id) as any;
    const rows = d.prepare(`${DEPOSIT_SQL} WHERE u.status IN ${DEPOSIT_STATUS[status]} ORDER BY u.created_at DESC, u.rowid DESC LIMIT ? OFFSET ?`).all(m.id, p.limit, p.offset) as any[];
    const c = { open: Number(counts.open || 0), rejected: Number(counts.rejected || 0), assigned: Number(counts.assigned || 0), suspicious: Number(counts.suspicious || 0) };
    return { success: true, data: rows.map(depositView), page: p.page, per_page: p.perPage, total: c[status as 'open' | 'rejected' | 'assigned'], counts: c };
  });

  app.get('/api/v2/deposits/:id/candidates', { preHandler: requirePerm('deposits:review') }, async (req, reply) => {
    const m = merchantOf(req);
    const id = String((req.params as any).id || '');
    const dep = ID_RE.test(id) ? loadDeposit(m.id, id) : null;
    if (!dep) return fail(reply, 404, 'not_found', 'این واریزی پیدا نشد');
    const c = depositCandidates(m.id, id, 6);
    if (!c) return fail(reply, 409, 'already_handled', 'این واریزی قبلاً رسیدگی شده است');
    const nowIso = new Date().toISOString();
    const ids = c.invoices.map((i: any) => i.id);
    const exp = new Map(
      (ids.length ? (db().prepare(`SELECT id, expires_at FROM invoices WHERE merchant_id = ? AND id IN (${ids.map(() => '?').join(',')})`).all(m.id, ...ids) as any[]) : []).map((r) => [r.id, r.expires_at]),
    );
    return {
      success: true,
      deposit: depositView(dep),
      invoices: c.invoices.map((i: any) => ({
        id: i.id,
        amount_rial: Number(i.expected_amount),
        amount_toman: toman(Number(i.expected_amount)),
        difference_rial: Number(i.expected_amount) - c.amount,
        status: effStatus(i.status, exp.get(i.id), nowIso),
        note: i.note || (i.customer_name && i.customer_name !== 'فاکتور' ? i.customer_name : ''),
        created_at: isoOf(i.created_at),
      })),
    };
  });

  app.post('/api/v2/deposits/:id/approve', { preHandler: requirePerm('deposits:review') }, async (req, reply) => {
    const m = merchantOf(req);
    const id = String((req.params as any).id || '');
    const invoiceId = str((req.body as any)?.invoice_id, 64).toUpperCase();
    const dep = ID_RE.test(id) ? loadDeposit(m.id, id) : null;
    if (!dep) return fail(reply, 404, 'not_found', 'این واریزی پیدا نشد');
    if (!ID_RE.test(invoiceId)) return fail(reply, 422, 'validation', 'شمارهٔ فاکتور را درست وارد کنید', { invoice_id: 'شمارهٔ فاکتور را درست وارد کنید' });
    if (dep.status !== 'UNMATCHED' && dep.status !== 'SUSPICIOUS') return fail(reply, 409, 'already_handled', 'این واریزی قبلاً رسیدگی شده است');
    // One bank deposit pays one invoice: refuse if its ledger row was already used (e.g. the customer entered the TrxID on checkout).
    if (Number(dep.t_verified) === 1) return fail(reply, 409, 'already_used', `این واریز قبلاً برای ${dep.t_order || 'فاکتور دیگری'} ثبت شده و دوباره قابل استفاده نیست`);
    const inv = db().prepare('SELECT id, status, expected_amount FROM invoices WHERE id = ? AND merchant_id = ?').get(invoiceId, m.id) as any;
    if (!inv) return fail(reply, 404, 'invoice_not_found', 'فاکتوری با این شماره در فروشگاه شما پیدا نشد', { invoice_id: 'فاکتوری با این شماره پیدا نشد' });
    if (inv.status === 'PAID') return fail(reply, 409, 'invoice_paid', 'این فاکتور قبلاً پرداخت شده است', { invoice_id: 'این فاکتور قبلاً پرداخت شده است' });
    try {
      await approveDeposit(m.id, id, invoiceId);
    } catch (e) {
      if (e instanceof StoreError) return fail(reply, e.status, e.code, e.message, e.errors);
      throw e;
    }
    // Lock the ledger row to this invoice so the same TrxID can't settle another checkout, and so dashboard totals include it.
    db()
      .prepare(`UPDATE transactions SET is_verified = 1, verified_at = datetime('now'), order_id = ? WHERE merchant_id = ? AND trx_id = upper(?) AND is_verified = 0`)
      .run(invoiceId, m.id, dep.trx_id);
    logDeposit(req, m.id, id, 'approved', dep.status, invoiceId, null);
    audit(req, m.id, 'deposit.approved', id, { invoice_id: invoiceId, amount_rial: Number(dep.amount), invoice_amount_rial: Number(inv.expected_amount), suspicious: dep.status === 'SUSPICIOUS' });
    return { success: true, deposit: depositView(loadDeposit(m.id, id)), invoice: invoiceView(loadInvoice(m.id, invoiceId), new Date().toISOString()) };
  });

  app.post('/api/v2/deposits/:id/reject', { preHandler: requirePerm('deposits:review') }, async (req, reply) => {
    const m = merchantOf(req);
    const id = String((req.params as any).id || '');
    const dep = ID_RE.test(id) ? loadDeposit(m.id, id) : null;
    if (!dep) return fail(reply, 404, 'not_found', 'این واریزی پیدا نشد');
    const reason = str((req.body as any)?.reason, 200);
    if (reason.length < 2) return fail(reply, 422, 'validation', 'دلیل رد را بنویسید', { reason: 'دلیل رد را بنویسید' });
    if (!rejectDeposit(m.id, id, reason)) return fail(reply, 409, 'already_handled', 'این واریزی قبلاً رسیدگی شده است');
    logDeposit(req, m.id, id, 'rejected', dep.status, null, reason);
    audit(req, m.id, 'deposit.rejected', id, { amount_rial: Number(dep.amount), reason, suspicious: dep.status === 'SUSPICIOUS' });
    return { success: true, deposit: depositView(loadDeposit(m.id, id)) };
  });

  // ---------- reports
  app.get('/api/v2/reports', { preHandler: requirePerm('reports:read') }, async (req, reply) => {
    let r;
    try { r = reportRange(req.query); } catch (e) { return bad(reply, e); }
    const { _payments, ...report } = buildReport(merchantOf(req).id, r.from, r.to);
    void _payments;
    return { success: true, ...report };
  });

  app.get('/api/v2/reports/export.csv', { preHandler: requirePerm('reports:read') }, async (req, reply) => {
    const m = merchantOf(req);
    let r;
    try { r = reportRange(req.query); } catch (e) { return bad(reply, e); }
    const kind = String((req.query as any)?.kind || 'daily');
    if (kind !== 'daily' && kind !== 'payments') return fail(reply, 422, 'validation', 'نوع خروجی معتبر نیست', { kind: 'نوع خروجی معتبر نیست' });
    const rep = buildReport(m.id, r.from, r.to);
    const stamp = `${formatJalali(r.from, false)}_${formatJalali(new Date(r.to.getTime() - 1), false)}`.replace(/\//g, '-');
    if (kind === 'payments') {
      const rows = rep._payments.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 10000);
      return csv(
        reply,
        `bolgram-payments-${stamp}.csv`,
        ['زمان واریز', 'مبلغ (تومان)', 'بانک مقصد', 'کارت پرداخت‌کننده', 'کانال فروش', 'شماره فاکتور', 'کد پیگیری'],
        rows.map((p) => [formatJalali(p.at), toman(p.amount), p.bank ? bankName(p.bank) : '', p.payer ? `****${p.payer.slice(-4)}` : '', channelName(p.channel), p.invoice_id || '', safeCell(p.trx_id)]),
      );
    }
    return csv(
      reply,
      `bolgram-report-${stamp}.csv`,
      ['تاریخ', 'روز هفته', 'تعداد پرداخت', 'مبلغ دریافتی (تومان)', 'فاکتور ساخته‌شده'],
      [
        ...rep.daily.map((d: any) => [d.jalali, WEEKDAYS_FA[d.weekday], d.paid_count, toman(d.paid_rial), d.created_count]),
        ['جمع', '', rep.totals.paid_count, toman(rep.totals.paid_rial), rep.totals.created_count],
      ],
    );
  });
}


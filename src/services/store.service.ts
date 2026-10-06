import crypto from 'node:crypto';
import { dbService } from '../db/database.js';
import { InvoiceRepository } from '../db/repositories/invoice.repository.js';
import { toLatinDigits } from '../utils/validate.js';
import { BANKS, bankByBin } from '../parsers/ir/registry.js';
import { encryptCard, decryptCard } from '../utils/card-crypto.js';
import { startOfTehranDay } from '../parsers/ir/jalali.js';

/**
 * Store operations shared by the panel API (/api/v2) and the Telegram/Bale bot:
 * cards, invoices and today's summary. Amounts are stored in Rial.
 */
const db = () => (dbService as any).db as import('node:sqlite').DatabaseSync;

export class StoreError extends Error {
  constructor(public status: number, public code: string, message: string, public errors?: Record<string, string>) {
    super(message);
  }
}

export interface CardView {
  id: string;
  bank: string;
  bank_name: string;
  title: string;
  holder: string;
  last4: string;
  active: boolean;
}

export const CHANNELS = ['instagram', 'telegram', 'in_person', 'website', 'other'] as const;

export function luhnOk(num: string) {
  if (!/^\d{16}$/.test(num)) return false;
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let n = Number(num[15 - i]);
    if (i % 2) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

export const cleanCardNumber = (raw: unknown) => toLatinDigits(String(raw ?? '')).replace(/\D/g, '');
export const cleanName = (raw: unknown) => (typeof raw === 'string' ? raw.trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').slice(0, 80) : '');
export const bankName = (id: string) => BANKS.find((b) => b.id === id)?.nameFa || id;

/** Validation shared by the panel form and the bot conversation. Returns the bank id or throws. */
export function checkCardNumber(num: string): string {
  if (!luhnOk(num)) throw new StoreError(422, 'validation', 'شماره کارت معتبر نیست (۱۶ رقم)', { number: 'شماره کارت معتبر نیست (۱۶ رقم)' });
  const bank = bankByBin(num);
  if (!bank) throw new StoreError(422, 'validation', 'بانک این کارت شناخته نشد', { number: 'بانک این کارت شناخته نشد' });
  return bank;
}

const cardHash = (num: string) => crypto.createHmac('sha256', 'card-index').update(num).digest('hex');

export function cardExists(merchantId: string, num: string) {
  return !!db().prepare('SELECT 1 FROM payment_methods WHERE merchant_id = ? AND card_hash = ?').get(merchantId, cardHash(num));
}

export function listCards(merchantId: string): CardView[] {
  const rows = db().prepare('SELECT * FROM payment_methods WHERE merchant_id = ? ORDER BY sort_order, created_at').all(merchantId) as any[];
  return rows.map((r) => ({
    id: r.id,
    bank: r.provider_type,
    bank_name: bankName(r.provider_type),
    title: r.title,
    holder: r.account_name,
    last4: r.last4 || String(decryptCard(r.account_number) || '').replace(/\D/g, '').slice(-4),
    active: !!r.is_active,
  }));
}

export function addCard(merchantId: string, input: { number: unknown; holder: unknown; label?: unknown }): CardView {
  const num = cleanCardNumber(input.number);
  const errors: Record<string, string> = {};
  let bank = '';
  try { bank = checkCardNumber(num); } catch (e: any) { errors.number = e.message; }
  const holder = cleanName(input.holder);
  if (holder.length < 3) errors.holder = 'نام صاحب کارت را وارد کنید';
  if (Object.keys(errors).length) throw new StoreError(422, 'validation', Object.values(errors)[0], errors);
  if (cardExists(merchantId, num)) throw new StoreError(409, 'validation', 'این کارت قبلاً ثبت شده است', { number: 'این کارت قبلاً ثبت شده است' });
  const info = BANKS.find((x) => x.id === bank)!;
  const id = 'pm_' + crypto.randomBytes(8).toString('hex');
  const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, 40) : info.nameFa;
  db()
    .prepare(`INSERT INTO payment_methods (id, merchant_id, provider_type, title, account_number, account_name, bank_name, theme_color, is_active, last4, card_hash)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(id, merchantId, bank, label, encryptCard(num), holder, info.nameFa, info.color, num.slice(-4), cardHash(num));
  return { id, bank, bank_name: info.nameFa, title: label, holder, last4: num.slice(-4), active: true };
}

export function setCardActive(merchantId: string, id: string, active: boolean): boolean {
  return Number(db().prepare('UPDATE payment_methods SET is_active = ? WHERE id = ? AND merchant_id = ?').run(active ? 1 : 0, id, merchantId).changes) > 0;
}

export function deleteCard(merchantId: string, id: string): boolean {
  return Number(db().prepare('DELETE FROM payment_methods WHERE id = ? AND merchant_id = ?').run(id, merchantId).changes) > 0;
}

export interface InvoiceView {
  id: string;
  amount_rial: number;
  amount_toman: number;
  base_toman: number;
  channel: string;
  note: string;
  expires_at: string;
  pay_path: string;
}

/** Parses a Toman amount typed by a person («۲۵۰٬۰۰۰», "250,000", "250000"). */
export function parseToman(raw: unknown): number {
  return Number(toLatinDigits(String(raw ?? '')).replace(/[^\d]/g, '') || NaN);
}

export async function createInvoice(merchantId: string, input: { amount: unknown; channel?: unknown; note?: unknown }): Promise<InvoiceView> {
  const toman = typeof input.amount === 'number' ? input.amount : parseToman(input.amount);
  if (!Number.isSafeInteger(toman) || toman < 1000 || toman > 1_000_000_000) {
    const msg = 'مبلغ باید بین ۱٬۰۰۰ تا ۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان باشد';
    throw new StoreError(422, 'validation', msg, { amount: msg });
  }
  const cards = db().prepare('SELECT count(*) AS n FROM payment_methods WHERE merchant_id = ? AND is_active = 1').get(merchantId) as any;
  if (!Number(cards.n)) throw new StoreError(409, 'no_card', 'اول یک کارت بانکی فعال اضافه کنید');
  const channel = (CHANNELS as readonly string[]).includes(input.channel as string) ? (input.channel as string) : 'other';
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 200) : '';
  const invoiceId = 'INV' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const inv = await InvoiceRepository.create({ merchantId, invoiceId, customerName: note || 'فاکتور', amount: toman * 10, expiresInMinutes: 30 });
  db().prepare('UPDATE invoices SET channel = ?, note = ? WHERE id = ?').run(channel, note || null, inv.invoice_id);
  return {
    id: inv.invoice_id,
    amount_rial: inv.amount,
    amount_toman: inv.amount / 10,
    base_toman: toman,
    channel,
    note,
    expires_at: inv.expires_at,
    pay_path: `/checkout.html?invoice_id=${encodeURIComponent(inv.invoice_id)}`,
  };
}

const utcSql = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

/** Today's numbers (Tehran day) for the bot home screen. */
export function todaySummary(merchantId: string) {
  const d = db();
  const one = (sql: string, ...p: any[]) => d.prepare(sql).get(...p) as any;
  const dayStart = utcSql(startOfTehranDay());
  const nowIso = new Date().toISOString();
  const today = one(`SELECT coalesce(sum(amount),0) AS s, count(*) AS n FROM transactions WHERE merchant_id = ? AND is_verified = 1 AND created_at >= ?`, merchantId, dayStart);
  const open = one(`SELECT count(*) AS n FROM invoices WHERE merchant_id = ? AND status = 'PENDING' AND expires_at > ?`, merchantId, nowIso);
  const orphan = one(`SELECT count(*) AS n FROM unmatched_sms u JOIN devices dv ON dv.id = u.device_id WHERE dv.merchant_id = ? AND u.status IN ('UNMATCHED','SUSPICIOUS')`, merchantId);
  const dev = one(`SELECT count(*) AS n, sum(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS online FROM devices WHERE merchant_id = ?`, utcSql(new Date(Date.now() - 3 * 60_000)), merchantId);
  const cards = one(`SELECT count(*) AS n FROM payment_methods WHERE merchant_id = ? AND is_active = 1`, merchantId);
  return {
    today_rial: Number(today.s),
    today_count: Number(today.n),
    open_invoices: Number(open.n),
    orphan_deposits: Number(orphan.n),
    devices: Number(dev.n || 0),
    devices_online: Number(dev.online || 0),
    active_cards: Number(cards.n),
  };
}

export function recentPayments(merchantId: string, limit = 10) {
  return db()
    .prepare(`SELECT id, provider, amount, order_id, trx_id, created_at FROM transactions WHERE merchant_id = ? AND is_verified = 1 ORDER BY created_at DESC LIMIT ?`)
    .all(merchantId, limit) as any[];
}

export function recentInvoices(merchantId: string, limit = 8) {
  return db()
    .prepare(`SELECT id, expected_amount, status, note, created_at, expires_at FROM invoices WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(merchantId, limit) as any[];
}

export function openDeposits(merchantId: string, limit = 8) {
  return db()
    .prepare(`SELECT u.id, u.provider, u.amount, u.trx_id, u.status, u.created_at FROM unmatched_sms u JOIN devices dv ON dv.id = u.device_id
              WHERE dv.merchant_id = ? AND u.status IN ('UNMATCHED','SUSPICIOUS') ORDER BY u.created_at DESC LIMIT ?`)
    .all(merchantId, limit) as any[];
}

/** Unpaid invoices from the last 24h closest in amount to a deposit (manual approval candidates). */
export function depositCandidates(merchantId: string, smsId: string, limit = 4) {
  const sms = db()
    .prepare(`SELECT u.amount FROM unmatched_sms u JOIN devices dv ON dv.id = u.device_id WHERE u.id = ? AND dv.merchant_id = ? AND u.status IN ('UNMATCHED','SUSPICIOUS')`)
    .get(smsId, merchantId) as any;
  if (!sms) return null;
  const rows = db()
    .prepare(`SELECT id, expected_amount, note, customer_name, status, created_at FROM invoices
              WHERE merchant_id = ? AND status != 'PAID' AND created_at >= datetime('now', '-1 day')
              ORDER BY abs(expected_amount - ?) ASC, created_at DESC LIMIT ?`)
    .all(merchantId, Number(sms.amount), limit) as any[];
  return { amount: Number(sms.amount), invoices: rows };
}

/** Manual approval of a held deposit against an invoice; fires the merchant webhook like an automatic match. */
export async function approveDeposit(merchantId: string, smsId: string, invoiceId: string) {
  let inv;
  try {
    inv = dbService.assignUnmatchedSmsForMerchant(merchantId, smsId, invoiceId);
  } catch (e: any) {
    throw new StoreError(409, 'conflict', e.message === 'Invoice is already paid' ? 'این فاکتور قبلاً پرداخت شده است' : 'این واریزی یا فاکتور پیدا نشد یا قبلاً رسیدگی شده است');
  }
  if (inv.webhook_url) {
    const { WebhookService } = await import('./webhook.service.js');
    WebhookService.dispatch({
      merchantId,
      invoiceId,
      webhookUrl: inv.webhook_url,
      payload: { invoice_id: invoiceId, status: 'true', provider: inv.provider, trx_id: inv.trx_id, amount: inv.amount, timestamp: new Date().toISOString() },
    }).catch(() => {});
  }
  return inv;
}

export function rejectDeposit(merchantId: string, smsId: string, reason = '') {
  return dbService.rejectUnmatchedSmsForMerchant(merchantId, smsId, reason);
}

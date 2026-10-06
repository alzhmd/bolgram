import crypto from 'node:crypto';
import { dbService } from '../db/database.js';
import { jwtSecret } from '../utils/crypto.js';

/**
 * One-time codes over SMS.IR (https://api.sms.ir/v1/send/verify).
 * Config: SMSIR_API_KEY, SMSIR_TEMPLATE_ID, SMSIR_PARAM_NAME (default CODE).
 * Without SMS.IR config the code is printed to the server log (development only).
 */
export const OTP_TTL_SECONDS = 300;
export const OTP_RESEND_SECONDS = 120;
const MAX_ATTEMPTS = 5;
const MAX_PER_HOUR = 5;

const db = () => (dbService as any).db as import('node:sqlite').DatabaseSync;

function hash(mobile: string, purpose: string, code: string) {
  return crypto.createHmac('sha256', jwtSecret()).update(`${mobile}|${purpose}|${code}`).digest('hex');
}

export class OtpError extends Error {
  constructor(public code: string, message: string, public retryAfter?: number) {
    super(message);
  }
}

async function sendViaSmsIr(mobile: string, code: string): Promise<void> {
  const apiKey = process.env.SMSIR_API_KEY;
  const templateId = process.env.SMSIR_TEMPLATE_ID;
  if (!apiKey || !templateId) {
    if (process.env.NODE_ENV === 'production') throw new OtpError('sms_unavailable', 'ارسال پیامک در حال حاضر ممکن نیست');
    console.log(`[otp:dev] ${mobile} → ${code}`);
    return;
  }
  const res = await fetch('https://api.sms.ir/v1/send/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/plain', 'x-api-key': apiKey },
    body: JSON.stringify({
      mobile,
      templateId: Number(templateId),
      parameters: [{ name: process.env.SMSIR_PARAM_NAME || 'CODE', value: code }],
    }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  const json: any = res ? await res.json().catch(() => null) : null;
  if (!res || !res.ok || json?.status !== 1) {
    console.warn('[otp] SMS.IR error', res?.status, json?.message);
    throw new OtpError('sms_failed', 'ارسال پیامک ناموفق بود. چند لحظه بعد دوباره تلاش کنید');
  }
}

/** Sends a code unless one was sent in the last 2 minutes. `deliver=false` keeps timing identical without sending (unknown numbers). */
export async function sendOtp(mobile: string, purpose: string, deliver = true): Promise<{ resendIn: number; devCode?: string }> {
  const last = db()
    .prepare(`SELECT created_at, (SELECT count(*) FROM otp_codes WHERE mobile = ? AND purpose = ? AND created_at > ?) AS hour FROM otp_codes WHERE mobile = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1`)
    .get(mobile, purpose, Date.now() - 3600_000, mobile, purpose) as any;
  if (last) {
    const wait = Math.ceil((Number(last.created_at) + OTP_RESEND_SECONDS * 1000 - Date.now()) / 1000);
    if (wait > 0) throw new OtpError('otp_wait', 'کد قبلی هنوز معتبر است', wait);
    if (Number(last.hour) >= MAX_PER_HOUR) throw new OtpError('otp_limit', 'تعداد درخواست کد زیاد بوده است. یک ساعت بعد دوباره تلاش کنید', 3600);
  }
  const code = String(crypto.randomInt(10000, 100000));
  db()
    .prepare(`INSERT INTO otp_codes (id, mobile, purpose, code_hash, attempts, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)`)
    .run(crypto.randomUUID(), mobile, purpose, hash(mobile, purpose, code), Date.now() + OTP_TTL_SECONDS * 1000, Date.now());
  if (deliver) await sendViaSmsIr(mobile, code);
  const devCode = process.env.NODE_ENV !== 'production' && !process.env.SMSIR_API_KEY && deliver ? code : undefined;
  return { resendIn: OTP_RESEND_SECONDS, devCode };
}

export function verifyOtp(mobile: string, purpose: string, code: string): boolean {
  const row = db()
    .prepare(`SELECT * FROM otp_codes WHERE mobile = ? AND purpose = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`)
    .get(mobile, purpose) as any;
  if (!row || Number(row.expires_at) < Date.now()) throw new OtpError('otp_expired', 'کد منقضی شده است؛ کد جدید بگیرید');
  if (Number(row.attempts) >= MAX_ATTEMPTS) throw new OtpError('otp_locked', 'تعداد تلاش‌ها تمام شد؛ کد جدید بگیرید');
  const ok = crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(hash(mobile, purpose, code)));
  if (!ok) {
    db().prepare(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?`).run(row.id);
    return false;
  }
  db().prepare(`UPDATE otp_codes SET consumed_at = ? WHERE id = ?`).run(Date.now(), row.id);
  return true;
}

import crypto from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Card numbers are stored AES-256-GCM encrypted ("enc:v1:…"); the panel only ever sees the
 * last four digits and the checkout decrypts for the paying customer. Key: CARD_ENC_KEY
 * (64 hex chars), else derived from JWT_SECRET; in development a key file is created once.
 * Keep the key stable: changing it makes stored card numbers unreadable.
 */
let key: Buffer | null = null;
function cardKey(): Buffer {
  if (key) return key;
  const env = process.env.CARD_ENC_KEY;
  if (env && /^[0-9a-f]{64}$/i.test(env)) return (key = Buffer.from(env, 'hex'));
  if (process.env.JWT_SECRET) return (key = crypto.createHash('sha256').update(`card:${process.env.JWT_SECRET}`).digest());
  if (process.env.NODE_ENV === 'production') throw new Error('CARD_ENC_KEY or JWT_SECRET must be set in production');
  const file = path.resolve(process.cwd(), '.card-key');
  if (!existsSync(file)) writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return (key = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex'));
}

export function encryptCard(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cardKey(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `enc:v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url')}`;
}

/** Plain values (cards added before encryption) pass through unchanged. */
export function decryptCard(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('enc:v1:')) return value;
  try {
    const raw = Buffer.from(value.slice(7), 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', cardKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

import { normalizeText, toEnDigits } from './persian.js';
import { createHash } from 'node:crypto';
const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

/** One trimmed line per line, single spaces, no blank lines, ASCII digits, unified letters. */
export function normalizeSmsBody(body: string): string {
  return normalizeText(String(body ?? ''))
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Canonical sender: case, spaces and punctuation don't matter («Bank Shahr» =
 * «BANK-SHAHR»); numeric senders lose the country prefix and leading zeros so that
 * +98200060, 98200060 and 200060 compare equal.
 */
export function normalizeSender(sender: string | null | undefined): string {
  const s = toEnDigits(String(sender ?? '')).trim().toLowerCase();
  const alnum = s.replace(/[^a-z0-9]/g, '');
  if (/^\d+$/.test(alnum)) {
    let d = alnum;
    if (d.startsWith('0098')) d = d.slice(4);
    else if (d.startsWith('98') && d.length >= 7) d = d.slice(2);
    return d.replace(/^0+/, '');
  }
  return alnum;
}

/** Looks like a personal Iranian mobile number (09xx…) — banks don't send from these (Blu excepted). */
export function isMobileSender(senderNorm: string): boolean {
  return /^9\d{9}$/.test(senderNorm);
}

const SENSITIVE = [
  /رمز/,
  /پویا/,
  /کد\s?(?:تایید|تأیید|ورود|فعال\s?سازی|امنیتی|یکبار|یک\s?بار|احراز)/,
  /یک\s?بار\s?مصرف/,
  /\botp\b/i,
  /one[\s-]?time/i,
  /verification\s?code/i,
  /\bpassword\b/i,
  /\bpasscode\b/i,
  /\bcvv2?\b/i,
];

/** OTPs, dynamic passwords and login codes: never stored, never forwarded. */
export function isSensitiveSms(normalizedBody: string): boolean {
  return SENSITIVE.some((re) => re.test(normalizedBody));
}

export function bodyFingerprint(scope: string, senderOrBank: string, normalizedBody: string, bucket = ''): string {
  return sha256Hex(`${scope}|${senderOrBank}|${normalizedBody}|${bucket}`);
}

/** Parses «1,250,000», «1250000+», «-80,000» into a number (sign handled by the caller). */
export function parseMoney(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const v = raw.replace(/[+\s]/g, '').replace(/,/g, '');
  const neg = v.startsWith('-') || v.endsWith('-');
  const digits = v.replace(/-/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(digits)) return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

export function signOf(raw: string | undefined | null): '+' | '-' | null {
  if (!raw) return null;
  const t = raw.trim();
  if (t.startsWith('+') || t.endsWith('+')) return '+';
  if (t.startsWith('-') || t.endsWith('-')) return '-';
  return null;
}

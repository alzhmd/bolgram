/** Input rules shared by the v2 auth API (the panel repeats them client-side for instant feedback). */
const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';

export function toLatinDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => String(FA.indexOf(d) >= 0 ? FA.indexOf(d) : AR.indexOf(d)));
}

/** 09…, +98…, 0098…, 98…, 9xxxxxxxxx → 09xxxxxxxxx (null when not an Iranian mobile). */
export function normalizeMobile(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let d = toLatinDigits(input).replace(/[\s\-()+.]/g, '');
  if (!/^\d+$/.test(d)) return null;
  if (d.startsWith('0098')) d = d.slice(4);
  else if (d.startsWith('98') && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith('9')) d = '0' + d;
  return /^09\d{9}$/.test(d) ? d : null;
}

export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const e = input.trim().toLowerCase();
  if (!e) return null;
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) && e.length <= 120 ? e : null;
}

export const RESERVED_HANDLES = new Set(
  'admin api panel support pay payment login logout register signup auth www app root help docs blog status mail ftp static assets checkout dashboard billing invoice invoices webhook webhooks test null undefined settings account team about contact terms privacy owner bolgram bot system security'.split(' '),
);

export type HandleProblem = 'length' | 'start' | 'chars' | 'underscore' | 'reserved' | 'persian';

export function handleProblem(raw: string): HandleProblem | null {
  if (/[؀-ۿ]/.test(raw)) return 'persian';
  const h = raw.trim().toLowerCase();
  if (h.length < 3 || h.length > 24) return 'length';
  if (!/^[a-z]/.test(h)) return 'start';
  if (!/^[a-z0-9_]+$/.test(h)) return 'chars';
  if (h.includes('__') || h.endsWith('_')) return 'underscore';
  if (RESERVED_HANDLES.has(h)) return 'reserved';
  return null;
}

const OBVIOUS = new Set(['12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', 'password', 'password1', 'qwerty123', 'qwertyui', '1q2w3e4r', 'iloveyou', 'abcd1234', '12341234', 'aa123456', 'asdfghjk']);

/** Password is never trimmed or normalised; only checked. */
export function passwordProblem(pw: unknown, ctx: { mobile?: string | null; handle?: string | null } = {}): string | null {
  if (typeof pw !== 'string') return 'رمز عبور لازم است';
  if (pw.length < 8) return 'رمز عبور باید حداقل ۸ کاراکتر باشد';
  if (pw.length > 64) return 'رمز عبور حداکثر ۶۴ کاراکتر است';
  const lower = toLatinDigits(pw).toLowerCase();
  if (OBVIOUS.has(lower) || /^(\d)\1+$/.test(lower)) return 'این رمز خیلی ساده است';
  if (ctx.mobile && (lower === ctx.mobile || lower === ctx.mobile.slice(1))) return 'رمز عبور نباید با شماره موبایل یکی باشد';
  if (ctx.handle && lower === ctx.handle) return 'رمز عبور نباید با نام فروشگاه یکی باشد';
  return null;
}

export function handleSuggestions(base: string, isTaken: (h: string) => boolean): string[] {
  const clean = base.toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/_+$/, '').slice(0, 18) || 'shop';
  const cands = [`${clean}_shop`, `${clean}_store`, `${clean}${new Date().getFullYear() % 100}`, `${clean}_ir`, `${clean}_online`, `my_${clean}`];
  return cands.filter((c) => !handleProblem(c) && !isTaken(c)).slice(0, 3);
}

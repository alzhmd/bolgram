import { fromTehranJalali, isValidJalali, tehranParts } from './jalali.js';

export interface DateHint {
  y?: number;
  m: number;
  d: number;
}
export interface TimeHint {
  hh: number;
  mm: number;
  ss?: number;
}

export type TimePrecision = 'minute' | 'day' | 'none';

function expandYear(y: number): number {
  if (y >= 1000) return y;
  // Two-digit Jalali years: 00–79 → 14xx, 80–99 → 13xx
  return y < 80 ? 1400 + y : 1300 + y;
}

/** Reads a date token as written inside a template's `date` group. */
export function parseDateToken(token: string | undefined | null): DateHint | null {
  if (!token) return null;
  const t = token.trim();
  let m = t.match(/^(\d{2,4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (m) return { y: expandYear(Number(m[1])), m: Number(m[2]), d: Number(m[3]) };
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (m) return { m: Number(m[1]), d: Number(m[2]) };
  if (/^\d{8}$/.test(t)) return { y: Number(t.slice(0, 4)), m: Number(t.slice(4, 6)), d: Number(t.slice(6, 8)) };
  if (/^\d{6}$/.test(t)) return { y: expandYear(Number(t.slice(0, 2))), m: Number(t.slice(2, 4)), d: Number(t.slice(4, 6)) };
  if (/^\d{4}$/.test(t)) return { m: Number(t.slice(0, 2)), d: Number(t.slice(2, 4)) };
  return null;
}

export function parseTimeToken(token: string | undefined | null): TimeHint | null {
  if (!token) return null;
  const m = token.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] ? Number(m[3]) : undefined;
  if (hh > 23 || mm > 59 || (ss !== undefined && ss > 59)) return null;
  return { hh, mm, ss };
}

/** Finds a date and a time anywhere in free text (generic parser). */
export function findDateTime(text: string): { date: DateHint | null; time: TimeHint | null } {
  let time: TimeHint | null = null;
  const tm = text.match(/(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?![\d:])/);
  if (tm) time = { hh: Number(tm[1]), mm: Number(tm[2]), ss: tm[3] ? Number(tm[3]) : undefined };

  let date: DateHint | null = null;
  let m = text.match(/(?<![\d,])(1[34]\d{2})[/.-](\d{1,2})[/.-](\d{1,2})(?![\d,])/);
  if (m) date = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  if (!date) {
    m = text.match(/(?<![\d,.])(\d{2})[/.-](\d{1,2})[/.-](\d{1,2})(?![\d,])/);
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) date = { y: expandYear(Number(m[1])), m: Number(m[2]), d: Number(m[3]) };
  }
  if (!date) {
    // MMDD glued to the time: «0705-20:46», «0705 20:46»
    m = text.match(/(?<!\d)(\d{2})(\d{2})\s?[-_ ]\s?(?:[01]?\d|2[0-3]):[0-5]\d/);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2]) >= 1 && Number(m[2]) <= 31) {
      date = { m: Number(m[1]), d: Number(m[2]) };
    }
  }
  if (!date) {
    m = text.match(/(?<![\d/.,])(\d{1,2})[/.](\d{1,2})(?![\d/.,])/);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2]) >= 1 && Number(m[2]) <= 31) {
      date = { m: Number(m[1]), d: Number(m[2]) };
    }
  }
  return { date, time };
}

/**
 * Turns the date/time a bank wrote into an instant. A message always describes
 * the past: a date without a year is the most recent such day up to `reference`
 * (plus a day of clock skew). A time without a date is today's, or yesterday's if
 * that would be in the future.
 */
export function resolveBankTime(
  date: DateHint | null,
  time: TimeHint | null,
  reference: Date,
): { at: Date | null; precision: TimePrecision } {
  const hh = time?.hh ?? 0;
  const mm = time?.mm ?? 0;
  const ss = time?.ss ?? 0;
  const precision: TimePrecision = date || time ? (time ? 'minute' : 'day') : 'none';
  if (!date && !time) return { at: null, precision: 'none' };

  const ref = tehranParts(reference);
  const limit = reference.getTime() + 24 * 3600_000;

  if (date) {
    if (date.y) {
      if (!isValidJalali(date.y, date.m, date.d)) return { at: null, precision: 'none' };
      return { at: fromTehranJalali(date.y, date.m, date.d, hh, mm, ss), precision };
    }
    for (const y of [ref.jy, ref.jy - 1]) {
      if (!isValidJalali(y, date.m, date.d)) continue;
      const at = fromTehranJalali(y, date.m, date.d, hh, mm, ss);
      if (at.getTime() <= limit) return { at, precision };
    }
    return { at: null, precision: 'none' };
  }

  // Time only
  let at = fromTehranJalali(ref.jy, ref.jm, ref.jd, hh, mm, ss);
  if (at.getTime() > reference.getTime() + 10 * 60_000) at = new Date(at.getTime() - 24 * 3600_000);
  return { at, precision: 'minute' };
}

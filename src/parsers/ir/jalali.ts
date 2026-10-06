/**
 * Jalali (Solar Hijri) <-> Gregorian conversion using the break-year table of the
 * official calendar (same algorithm as jalaali-js, Borkowski's method). Verified
 * against ICU's Persian calendar in the test suite.
 */


const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

const div = (a: number, b: number) => ~~(a / b);
const mod = (a: number, b: number) => a - ~~(a / b) * b;

function jalCal(jy: number) {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  if (jy < jp || jy >= BREAKS[bl - 1]) throw new RangeError(`Invalid Jalali year ${jy}`);
  for (let i = 1; i < bl; i++) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number): number {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export function isLeapJalaliYear(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalaliYear(jy) ? 30 : 29;
}

export function isValidJalali(jy: number, jm: number, jd: number): boolean {
  return jy >= -61 && jy <= 3177 && jm >= 1 && jm <= 12 && jd >= 1 && jd <= jalaliMonthLength(jy, jm);
}

export function toGregorian(jy: number, jm: number, jd: number) {
  return d2g(j2d(jy, jm, jd));
}

export function toJalali(gy: number, gm: number, gd: number) {
  return d2j(g2d(gy, gm, gd));
}

// ---------------------------------------------------------------- Tehran wall clock

const offsetMs = () => 210 * 60_000;

export interface WallClock {
  jy: number;
  jm: number;
  jd: number;
  gy: number;
  gm: number;
  gd: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Saturday (شنبه)
}

/** The Iran wall-clock fields of an instant (Iran has no DST since 1401). */
export function tehranParts(date: Date): WallClock {
  const local = new Date(date.getTime() + offsetMs());
  const gy = local.getUTCFullYear();
  const gm = local.getUTCMonth() + 1;
  const gd = local.getUTCDate();
  const j = toJalali(gy, gm, gd);
  return {
    ...j,
    gy,
    gm,
    gd,
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
    weekday: (local.getUTCDay() + 1) % 7,
  };
}

/** Instant for a Jalali wall-clock time in Iran. */
export function fromTehranJalali(jy: number, jm: number, jd: number, hour = 0, minute = 0, second = 0): Date {
  const g = toGregorian(jy, jm, jd);
  return new Date(Date.UTC(g.gy, g.gm - 1, g.gd, hour, minute, second) - offsetMs());
}

export function startOfTehranDay(date: Date = new Date()): Date {
  const p = tehranParts(date);
  return new Date(Date.UTC(p.gy, p.gm - 1, p.gd) - offsetMs());
}

export function startOfTehranMonth(date: Date = new Date()): Date {
  const p = tehranParts(date);
  return fromTehranJalali(p.jy, p.jm, 1);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatJalali(date: Date, withTime = true): string {
  const p = tehranParts(date);
  const d = `${p.jy}/${pad(p.jm)}/${pad(p.jd)}`;
  return withTime ? `${d} ${pad(p.hour)}:${pad(p.minute)}` : d;
}

export const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

/** Minutes since local midnight in Iran, used for account active-hour windows. */
export function tehranMinuteOfDay(date: Date = new Date()): number {
  const p = tehranParts(date);
  return p.hour * 60 + p.minute;
}

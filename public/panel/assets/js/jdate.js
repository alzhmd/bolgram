// Jalali (Persian) calendar for filters and reports. Tehran is UTC+03:30 all year (no DST since 1401).
import { toFa, toLatin } from './core.js';

const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
const div = (a, b) => ~~(a / b);
const mod = (a, b) => a - ~~(a / b) * b;
function jalCal(jy) {
  const gy = jy + 621;
  let leapJ = -14, jp = BREAKS[0], jump = 0;
  for (let i = 1; i < BREAKS.length; i++) { const jm = BREAKS[i]; jump = jm - jp; if (jy < jm) break; leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4); jp = jm; }
  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march: 20 + leapJ - leapG };
}
const g2d = (gy, gm, gd) => div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408 - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1, gm = mod(div(i, 153), 12) + 1;
  return { gy: div(j, 1461) - 100100 + div(8 - gm, 6), gm, gd };
}
const j2d = (jy, jm, jd) => g2d(jalCal(jy).gy, 3, jalCal(jy).march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
function d2j(jdn) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  let k = jdn - g2d(gy, 3, r.march);
  if (k >= 0) { if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 }; k -= 186; } else { jy -= 1; k += 179; if (r.leap === 1) k += 1; }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const OFFSET = 210 * 60_000; // +03:30
export const monthLength = (jy, jm) => (jm <= 6 ? 31 : jm <= 11 ? 30 : jalCal(jy).leap === 0 ? 30 : 29);

/** Instant → Tehran Jalali parts. */
export function toJ(date = new Date()) {
  const t = new Date(new Date(date).getTime() + OFFSET);
  const j = d2j(g2d(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()));
  return { ...j, hour: t.getUTCHours(), minute: t.getUTCMinutes() };
}
/** Tehran wall clock (Jalali) → instant. */
export function fromJ(jy, jm, jd, hour = 0, minute = 0) {
  const g = d2g(j2d(jy, jm, jd));
  return new Date(Date.UTC(g.gy, g.gm - 1, g.gd, hour, minute) - OFFSET);
}
const pad = (n) => String(n).padStart(2, '0');
export const fmtJ = (date) => { const j = toJ(date); return toFa(`${j.jy}/${pad(j.jm)}/${pad(j.jd)}`); };
/** "۱۴۰۵/۰۷/۰۱" or "1405-7-1" → {jy,jm,jd} or null. */
export function parseJ(text) {
  const m = toLatin(text).trim().match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (!m) return null;
  const [jy, jm, jd] = m.slice(1).map(Number);
  if (jm < 1 || jm > 12 || jd < 1 || jd > monthLength(jy, jm)) return null;
  return { jy, jm, jd };
}
export const startOfDay = (d = new Date()) => { const j = toJ(d); return fromJ(j.jy, j.jm, j.jd); };
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);

/** Named ranges in Tehran time: { from, to } instants, `to` exclusive. */
export function preset(id, now = new Date()) {
  const today = startOfDay(now);
  const j = toJ(now);
  switch (id) {
    case 'today': return { from: today, to: addDays(today, 1) };
    case 'yesterday': return { from: addDays(today, -1), to: today };
    case '7d': return { from: addDays(today, -6), to: addDays(today, 1) };
    case '30d': return { from: addDays(today, -29), to: addDays(today, 1) };
    case 'month': return { from: fromJ(j.jy, j.jm, 1), to: addDays(today, 1) };
    case 'lastmonth': { const pm = j.jm === 1 ? 12 : j.jm - 1, py = j.jm === 1 ? j.jy - 1 : j.jy; return { from: fromJ(py, pm, 1), to: fromJ(j.jy, j.jm, 1) }; }
    case 'year': return { from: fromJ(j.jy, 1, 1), to: addDays(today, 1) };
    default: return null;
  }
}
export const PRESETS = [['today', 'امروز'], ['yesterday', 'دیروز'], ['7d', '۷ روز اخیر'], ['30d', '۳۰ روز اخیر'], ['month', 'این ماه'], ['lastmonth', 'ماه قبل'], ['year', 'امسال'], ['custom', 'بازهٔ دلخواه']];

/**
 * Range control: preset <select> + two Jalali inputs for a custom range.
 * onChange({ id, from: Date, to: Date }) fires on valid changes.
 */
export function rangeControl(initial = '7d', onChange) {
  const el = document.createElement('div');
  el.className = 'range-ctl';
  el.innerHTML = `<label class="sr-only" for="rng-p">بازهٔ زمانی</label><select class="input select" id="rng-p">${PRESETS.map(([v, t]) => `<option value="${v}" ${v === initial ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <span class="rng-custom hidden"><input class="input ltr num" id="rng-f" placeholder="۱۴۰۵/۰۱/۰۱" aria-label="از تاریخ" inputmode="numeric"><span class="muted">تا</span><input class="input ltr num" id="rng-t" placeholder="۱۴۰۵/۰۱/۳۱" aria-label="تا تاریخ" inputmode="numeric"></span>`;
  const sel = el.querySelector('#rng-p'), custom = el.querySelector('.rng-custom'), f = el.querySelector('#rng-f'), t = el.querySelector('#rng-t');
  const emitCustom = () => {
    const a = parseJ(f.value), b = parseJ(t.value);
    f.setAttribute('aria-invalid', f.value && !a ? 'true' : 'false');
    t.setAttribute('aria-invalid', t.value && !b ? 'true' : 'false');
    if (a && b) { const from = fromJ(a.jy, a.jm, a.jd), to = addDays(fromJ(b.jy, b.jm, b.jd), 1); if (to > from) onChange({ id: 'custom', from, to }); }
  };
  sel.addEventListener('change', () => {
    custom.classList.toggle('hidden', sel.value !== 'custom');
    if (sel.value === 'custom') { const r = preset('30d'); f.value ||= fmtJ(r.from); t.value ||= fmtJ(new Date()); emitCustom(); }
    else onChange({ id: sel.value, ...preset(sel.value) });
  });
  f.addEventListener('change', emitCustom); t.addEventListener('change', emitCustom);
  el.value = () => (sel.value === 'custom' ? null : { id: sel.value, ...preset(sel.value) });
  return el;
}

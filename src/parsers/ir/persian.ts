const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Converts Persian/Arabic-Indic digits to ASCII. */
export function toEnDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const p = PERSIAN_DIGITS.indexOf(ch);
    if (p >= 0) {
      out += String(p);
      continue;
    }
    const a = ARABIC_DIGITS.indexOf(ch);
    out += a >= 0 ? String(a) : ch;
  }
  return out;
}

export function toFaDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

// Bidi controls, zero-width marks and the BOM. ZWNJ (U+200C) is handled separately.
const BIDI_RE = /[​‍-‏‪-‮⁦-⁩﻿؜]/g;

/** Unifies Arabic/Persian letter variants and invisible characters. */
export function normalizeLetters(input: string): string {
  return input
    .replace(BIDI_RE, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/[أإ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ـ/g, '') // tatweel
    .replace(/[ً-ْ]/g, ''); // harakat
}

/**
 * Canonical form used everywhere a human-written Persian string is compared:
 * ASCII digits, unified letters, ASCII separators, no invisible characters.
 */
export function normalizeText(input: string): string {
  return toEnDigits(normalizeLetters(input))
    .replace(/‌/g, ' ')
    .replace(/[٬،]/g, ',') // Persian thousands separator, Arabic comma
    .replace(/٫/g, '.') // Persian decimal separator
    .replace(/[：﹕]/g, ':')
    .replace(/[−–—‒]/g, '-') // minus/dashes
    .replace(/＋/g, '+');
}

export function formatNumberFa(n: number): string {
  return new Intl.NumberFormat('fa-IR').format(n);
}

/** Rial amount formatted as Toman with Persian digits, e.g. «۲۵۰٬۰۰۰ تومان». */
export function formatToman(rial: number): string {
  const toman = rial / 10;
  return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(toman)} تومان`;
}

export function formatRial(rial: number): string {
  return `${formatNumberFa(rial)} ریال`;
}

export function maskCard(card: string | null | undefined): string | null {
  if (!card) return null;
  const d = card.replace(/\D/g, '');
  if (d.length < 10) return d;
  return `${d.slice(0, 6)}******${d.slice(-4)}`;
}

export function formatCard(card: string): string {
  return card.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1-');
}

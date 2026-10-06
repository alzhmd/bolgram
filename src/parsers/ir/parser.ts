import { isSensitiveSms, normalizeSender, normalizeSmsBody, parseMoney, signOf } from './normalize.js';
import { findDateTime, parseDateToken, parseTimeToken, resolveBankTime, type TimePrecision } from './dates.js';
import type { CompiledTemplate } from './templates.js';
import { normalizeText } from './persian.js';

export interface ParserBank {
  id: string;
  senders: string[];
  keywords: string[];
  notificationPackages: string[];
}

export interface ParseContext {
  banks: ParserBank[];
  templates: CompiledTemplate[];
  /** Merchant-level trusted senders (added from the review queue). */
  trustedSenders?: Array<{ sender: string; bankId: string }>;
}

export interface ParseInput {
  sender: string;
  body: string;
  receivedAt: Date;
  packageName?: string | null;
}

export type Direction = 'credit' | 'debit';

export interface ParseResult {
  kind: 'transaction' | 'sensitive' | 'non_transaction' | 'empty';
  normalizedBody: string;
  senderNorm: string;
  bankId: string | null;
  bankSource: 'package' | 'sender' | 'merchant_trust' | 'template' | 'text' | null;
  senderTrusted: boolean;
  direction: Direction | null;
  amount: number | null;
  balance: number | null;
  account: string | null;
  card: string | null;
  payerCard: string | null;
  payerName: string | null;
  reference: string | null;
  description: string | null;
  bankTime: Date | null;
  bankTimePrecision: TimePrecision;
  templateId: string | null;
  confidence: number;
  problems: string[];
}

const CREDIT_WORDS = ['واریز', 'نشست', 'دریافت', 'بستانکار', 'سود', 'برگشت', 'به حساب شما', 'افزایش'];
const DEBIT_WORDS = ['برداشت', 'خرید', 'پرداخت', 'پرید', 'کسر', 'بدهکار', 'قسط', 'کارمزد', 'از حساب شما', 'انتقال از', 'حواله'];

/** The earliest movement word in the text decides («واریز … بابت پرداخت» is a credit). */
export function directionFromWords(text: string): Direction | null {
  let best: { i: number; d: Direction } | null = null;
  for (const w of CREDIT_WORDS) {
    const i = text.indexOf(w);
    if (i >= 0 && (!best || i < best.i)) best = { i, d: 'credit' };
  }
  for (const w of DEBIT_WORDS) {
    const i = text.indexOf(w);
    if (i >= 0 && (!best || i < best.i)) best = { i, d: 'debit' };
  }
  return best?.d ?? null;
}

function cleanAccount(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const v = raw.replace(/[^\d*]/g, '');
  return v.length >= 3 ? v : null;
}

function cleanCard(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const v = raw.replace(/[xX]/g, '*').replace(/[^\d*]/g, '');
  return v.replace(/\*/g, '').length >= 4 ? v : null;
}

const senderIndexCache = new WeakMap<ParseContext, Map<string, string[]>>();
function senderIndex(ctx: ParseContext): Map<string, string[]> {
  let idx = senderIndexCache.get(ctx);
  if (!idx) {
    idx = new Map();
    for (const b of ctx.banks) {
      for (const s of b.senders) {
        const n = normalizeSender(s);
        if (!n) continue;
        const list = idx.get(n) ?? [];
        if (!list.includes(b.id)) list.push(b.id);
        idx.set(n, list);
      }
    }
    senderIndexCache.set(ctx, idx);
  }
  return idx;
}

function keywordRegex(word: string): RegExp {
  const esc = normalizeText(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<!\\p{L})${esc}(?!\\p{L})`, 'u');
}
const kwCache = new Map<string, RegExp>();

export function bankFromText(text: string, banks: ParserBank[], restrictTo?: string[]): string | null {
  let best: { id: string; len: number } | null = null;
  for (const b of banks) {
    if (restrictTo && !restrictTo.includes(b.id)) continue;
    for (const k of b.keywords) {
      let re = kwCache.get(k);
      if (!re) {
        re = keywordRegex(k);
        kwCache.set(k, re);
      }
      if (re.test(text) && (!best || k.length > best.len)) best = { id: b.id, len: k.length };
    }
  }
  return best?.id ?? null;
}

const REF_RE =
  /(?:شماره\s?)?(?:پیگیری|رهگیری|مرجع|ارجاع|سند|trace|ref(?:erence)?)\s?(?:no\.?|شماره)?\s?:?\s?([A-Za-z0-9]{5,30})/i;
const PAYER_CARD_RE = /(?:از\s?کارت|کارت\s?مبدا|مبدا|از)\s?:?\s?(\d{4,6}[*xX]{2,}\d{2,4}|\d{16})/;
const PAYER_NAME_RE = /(?:از\s?طرف|واریز\s?کننده|نام\s?واریز\s?کننده|فرستنده)\s?:?\s?([^\n\d:،,]{3,40})/;
const CARD_RE = /کارت\s?:?\s?(\d{0,6}[*xX]{2,}\d{2,4}|\d{16}|\d{4})(?!\d)/;
const ACCOUNT_RE = /(?:شماره\s?)?(?:حساب|سپرده)\s?:?\s?([\d*][\d*./-]{3,30})/;
const BALANCE_RE = /(?:باقی\s?مانده|مانده|موجودی)(?:\s?(?:حساب|کارت|قابل\s?برداشت))?\s?:?\s?(-?\d[\d,]*(?:\.\d+)?-?)/;
const MONEY_RE = /(?<![\d/:.,*])([+-]?)\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?([+-]?)(?![\d/:*])/g;
const MOVE_HINT = /(?:مبلغ|واریز|برداشت|انتقال|خرید|پرداخت|نشست|پرید|دریافت|تراکنش|پایا|ساتنا|پل)/;

interface Extracted {
  amount: number | null;
  direction: Direction | null;
  balance: number | null;
  account: string | null;
  card: string | null;
  payerCard: string | null;
  payerName: string | null;
  reference: string | null;
  description: string | null;
  date: ReturnType<typeof findDateTime>['date'];
  time: ReturnType<typeof findDateTime>['time'];
  toman: boolean;
}

function stripNonMoney(segment: string): string {
  return segment
    .replace(/(?<!\d)1[34]\d{2}[/.-]\d{1,2}[/.-]\d{1,2}(?!\d)/g, ' ')
    .replace(/(?<![\d,])\d{2}[/.-]\d{1,2}[/.-]\d{1,2}(?![\d,])/g, ' ')
    .replace(/(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)/g, ' ')
    .replace(/(?<![\d,])\d{4}\s?[-_]\s?(?=\s|$)/g, ' ')
    .replace(/\d*[*xX]{2,}\d*/g, ' ')
    .replace(/(?<![\d,])\d+(?:[./-]\d+){1,}(?![\d,])/g, (m) => (/^\d{1,3}(?:,\d{3})+$/.test(m) ? m : ' '))
    .replace(/(?<![\d,])\d{1,2}[/.]\d{1,2}(?![\d,])/g, ' ');
}

/** Format-agnostic extraction for banks/shapes without a template. */
export function genericExtract(text: string): Extracted {
  const { date, time } = findDateTime(text);
  const balanceMatch = text.match(BALANCE_RE);
  const accountMatch = text.match(ACCOUNT_RE);
  const firstLine = text.split('\n')[0] ?? '';
  const accountFromFirstLine = /^[\d*][\d*./-]{4,30}$/.test(firstLine) && !/,/.test(firstLine) ? firstLine : null;

  const segments = text
    .split('\n')
    .flatMap((l) => l.split(/(?=باقی\s?مانده|مانده|موجودی)/))
    .map((s) => s.trim())
    .filter(Boolean);

  let best: { score: number; value: number; sign: '+' | '-' | null; seg: string; order: number } | null = null;
  let order = 0;
  for (const seg of segments) {
    if (/^(?:باقی\s?مانده|مانده|موجودی)/.test(seg)) continue;
    if (accountFromFirstLine && seg === accountFromFirstLine) continue;
    const scan = stripNonMoney(seg.replace(ACCOUNT_RE, ' ').replace(REF_RE, ' '));
    const hasHint = MOVE_HINT.test(seg) || directionFromWords(seg) !== null;
    MONEY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MONEY_RE.exec(scan))) {
      const raw = m[2];
      const digits = raw.replace(/[,.]/g, '');
      if (!raw.includes(',') && digits.length >= 10) continue; // account-like
      const value = Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(value) || value <= 0) continue;
      const sign = (m[1] || m[3] || null) as '+' | '-' | null;
      const after = scan.slice(m.index + m[0].length, m.index + m[0].length + 8);
      let score = 0;
      if (hasHint) score += 3;
      if (sign) score += 2;
      if (raw.includes(',')) score += 1;
      if (/^\s?(?:ریال|تومان)/.test(after)) score += 1;
      if (score < 2) continue;
      order++;
      if (!best || score > best.score || (score === best.score && value > best.value && best.seg === seg)) {
        best = { score, value, sign, seg, order };
      }
    }
  }

  let direction: Direction | null = null;
  if (best) {
    if (best.sign) direction = best.sign === '+' ? 'credit' : 'debit';
    else direction = directionFromWords(best.seg) ?? directionFromWords(text.replace(BALANCE_RE, ''));
  }

  const card = text.match(CARD_RE)?.[1] ?? null;
  const payerCard = text.match(PAYER_CARD_RE)?.[1] ?? null;
  return {
    amount: best ? best.value : null,
    direction,
    balance: balanceMatch ? parseMoney(balanceMatch[1]) : null,
    account: cleanAccount(accountMatch?.[1] ?? accountFromFirstLine),
    card: cleanCard(card),
    payerCard: cleanCard(payerCard),
    payerName: text.match(PAYER_NAME_RE)?.[1]?.trim() ?? null,
    reference: text.match(REF_RE)?.[1] ?? null,
    description: null,
    date,
    time,
    toman: best ? /تومان/.test(best.seg) : false,
  };
}

function empty(text: string, senderNorm: string): ParseResult {
  return {
    kind: 'non_transaction',
    normalizedBody: text,
    senderNorm,
    bankId: null,
    bankSource: null,
    senderTrusted: false,
    direction: null,
    amount: null,
    balance: null,
    account: null,
    card: null,
    payerCard: null,
    payerName: null,
    reference: null,
    description: null,
    bankTime: null,
    bankTimePrecision: 'none',
    templateId: null,
    confidence: 0,
    problems: [],
  };
}

function applyTemplate(t: CompiledTemplate, text: string): Extracted | null {
  const m = t.regex.exec(text);
  const g = m?.groups;
  if (!g?.amount) return null;
  const rawAmount = g.amount;
  const value = parseMoney(rawAmount);
  if (value === null || value === 0) return null;
  const sign = signOf(rawAmount);
  let direction: Direction | null = null;
  if (t.direction === 'credit' || t.direction === 'debit') direction = t.direction;
  else if (sign) direction = sign === '+' ? 'credit' : 'debit';
  else if (g.kind) direction = directionFromWords(g.kind);
  if (!direction && t.direction === 'keyword') direction = directionFromWords(text.replace(BALANCE_RE, ''));
  if (!direction) return null;
  return {
    amount: Math.abs(value),
    direction,
    balance: parseMoney(g.balance),
    account: cleanAccount(g.account),
    card: cleanCard(g.card),
    payerCard: null,
    payerName: null,
    reference: g.ref ?? text.match(REF_RE)?.[1] ?? null,
    description: g.desc?.trim() || (g.kind && !CREDIT_WORDS.includes(g.kind.trim()) ? g.kind.trim() : null),
    date: parseDateToken(g.date),
    time: parseTimeToken(g.time),
    toman: t.unit === 'toman',
  };
}

/**
 * Reads one bank message. Never throws: unreadable input comes back as
 * `non_transaction` with the reasons in `problems`.
 */
export function parseBankMessage(input: ParseInput, ctx: ParseContext): ParseResult {
  const text = normalizeSmsBody(input.body);
  const senderNorm = normalizeSender(input.packageName || input.sender);
  if (!text) return { ...empty('', senderNorm), kind: 'empty', problems: ['empty message'] };
  if (isSensitiveSms(text)) {
    return { ...empty('', senderNorm), kind: 'sensitive', problems: ['one-time password or login code'] };
  }

  let bankIds: string[] = [];
  let source: ParseResult['bankSource'] = null;
  if (input.packageName) {
    bankIds = ctx.banks.filter((b) => b.notificationPackages.includes(input.packageName!)).map((b) => b.id);
    if (bankIds.length) source = 'package';
  }
  if (!bankIds.length) {
    bankIds = senderIndex(ctx).get(senderNorm) ?? [];
    if (bankIds.length) source = 'sender';
  }
  if (!bankIds.length && ctx.trustedSenders?.length) {
    bankIds = ctx.trustedSenders.filter((t) => normalizeSender(t.sender) === senderNorm).map((t) => t.bankId);
    if (bankIds.length) source = 'merchant_trust';
  }
  const trusted = bankIds.length > 0;

  const candidates = (trusted ? ctx.templates.filter((t) => bankIds.includes(t.bankId)) : ctx.templates)
    .slice()
    .sort((a, b) => a.priority - b.priority);

  let extracted: Extracted | null = null;
  let templateId: string | null = null;
  let templateBank: string | null = null;
  for (const t of candidates) {
    const r = applyTemplate(t, text);
    if (r) {
      extracted = r;
      templateId = t.id;
      templateBank = t.bankId;
      break;
    }
  }

  const problems: string[] = [];
  if (!extracted) extracted = genericExtract(text);

  let bankId: string | null = null;
  let bankSource: ParseResult['bankSource'] = source;
  if (trusted) {
    bankId = templateBank && bankIds.includes(templateBank) ? templateBank : bankIds.length === 1 ? bankIds[0] : bankFromText(text, ctx.banks, bankIds) ?? bankIds[0];
  } else if (templateBank) {
    bankId = templateBank;
    bankSource = 'template';
  } else {
    bankId = bankFromText(text, ctx.banks);
    bankSource = bankId ? 'text' : null;
  }

  const result = empty(text, senderNorm);
  result.bankId = bankId;
  result.bankSource = bankSource;
  result.senderTrusted = trusted;
  result.templateId = templateId;

  if (extracted.amount === null) problems.push('no amount found');
  if (extracted.amount !== null && !extracted.direction) problems.push('could not tell money in from money out');
  if (!trusted) problems.push('sender is not a known bank sender');

  const { at, precision } = resolveBankTime(extracted.date, extracted.time, input.receivedAt);
  const mul = extracted.toman ? 10 : 1;
  result.amount = extracted.amount !== null ? Math.round(extracted.amount * mul) : null;
  result.balance = extracted.balance !== null ? Math.round(extracted.balance * mul) : null;
  result.direction = extracted.direction;
  result.account = extracted.account;
  result.card = extracted.card;
  result.payerCard = extracted.payerCard;
  result.payerName = extracted.payerName;
  result.reference = extracted.reference;
  result.description = extracted.description;
  result.bankTime = at;
  result.bankTimePrecision = precision;
  result.problems = problems;

  if (result.amount !== null && result.amount > 0 && result.direction) {
    result.kind = 'transaction';
    if (templateId) {
      result.confidence = 0.97;
    } else {
      let c = 0.45;
      if (result.balance !== null) c += 0.15;
      if (precision === 'minute') c += 0.15;
      else if (precision === 'day') c += 0.05;
      if (bankId) c += 0.1;
      if (result.account || result.card) c += 0.05;
      result.confidence = Math.min(0.85, Math.round(c * 100) / 100);
    }
  } else {
    result.kind = 'non_transaction';
    result.confidence = 0;
  }
  return result;
}

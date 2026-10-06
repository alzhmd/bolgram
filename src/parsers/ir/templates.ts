/**
 * Strict, anchored templates for the shapes Iranian banks actually send (real
 * messages with numbers changed). They run on the normalised body (ASCII digits,
 * unified letters, one trimmed line per line). Named groups:
 *   amount (required), balance, account, card, date, time, kind, desc, ref
 *
 * A template that matches gives a high-confidence parse; anything else falls back to
 * the generic extractor. Admins can add templates at runtime (sms_templates table)
 * for new shapes without shipping a release.
 */
export type DirectionRule =
  | 'sign' // the amount's sign decides (+ in, - out)
  | 'credit'
  | 'debit'
  | 'keyword'; // the `kind` group / text decides, sign wins when present

export interface SmsTemplate {
  id: string;
  bankId: string;
  pattern: string;
  direction: DirectionRule;
  unit: 'rial' | 'toman';
  priority: number;
  builtin: boolean;
  sample?: string;
}

const AMT = String.raw`[+-]?\d[\d,]*(?:\.\d+)?[+-]?`;
const BAL = String.raw`-?\d[\d,]*(?:\.\d+)?-?`;
const DATE = String.raw`(?:\d{2,4}[/.-])?\d{1,2}[/.-]\d{1,2}`;
const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2})?`;
const ACC = String.raw`[\d*][\d*./-]{3,30}`;

export const BUILTIN_TEMPLATES: SmsTemplate[] = [
  {
    id: 'mellat-v1',
    bankId: 'mellat',
    direction: 'keyword',
    unit: 'rial',
    priority: 10,
    builtin: true,
    pattern: String.raw`^(?:بانک ملت\n)?حساب\s?:?\s?(?<account>${ACC})\n(?<kind>[^\d\n+-]+?)\s?:?\s?(?<amount>${AMT})(?:\s?ریال)?\nمانده\s?:?\s?(?<balance>${BAL})(?:\s?ریال)?\n(?<date>${DATE})\s?[-_ ]\s?(?<time>${TIME})$`,
    sample: 'حساب1848394556\nواریز31,500,000\nمانده31,894,014\n05/06/28-13:57',
  },
  {
    id: 'melli-v1',
    bankId: 'melli',
    direction: 'sign',
    unit: 'rial',
    priority: 10,
    builtin: true,
    pattern: String.raw`^بانک ملی ایران\n(?<kind>[^\d\n:+-]+?)\s?:\s?(?<amount>${AMT})\nحساب\s?:\s?(?<account>${ACC})\nمانده\s?:\s?(?<balance>${BAL})\n(?<date>\d{4}|${DATE})\s?[-_ ]\s?(?<time>${TIME})$`,
    sample: 'بانک ملی ایران\nانتقال:25,000,000+\nحساب:10000\nمانده:198,088,329\n0625-19:42',
  },
  {
    id: 'tejarat-v1',
    bankId: 'tejarat',
    direction: 'keyword',
    unit: 'rial',
    priority: 10,
    builtin: true,
    pattern: String.raw`^\*?\s?بانک تجارت\s?\*?\nحساب\s?:\s?(?<account>${ACC})\n(?<kind>[^\d\n:+-]+?)\s?:\s?(?<amount>${AMT})\s?ریال\n(?:از طریق\s?:\s?(?<desc>[^\n]+)\n)?مانده\s?:\s?(?<balance>${BAL})\s?ریال\n(?<date>${DATE})\s(?<time>${TIME})$`,
    sample: '*بانک تجارت*\nحساب: 0177002186043\nواریز: 5,000,000 ریال\nاز طریق: شتاب\nمانده: 24,562,460 ریال\n1405/07/05\n18:39',
  },
  {
    id: 'pasargad-v1',
    bankId: 'pasargad',
    direction: 'sign',
    unit: 'rial',
    priority: 10,
    builtin: true,
    pattern: String.raw`^(?<account>\d[\d.*]{4,30})\n(?<amount>${AMT})\n(?<date>${DATE})_(?<time>${TIME})\nمانده\s?:\s?(?<balance>${BAL})$`,
    sample: '232.800.1442198.1\n+80,000\n06/16_19:45\nمانده: 31,516,369',
  },
  {
    id: 'resalat-v1',
    bankId: 'resalat',
    direction: 'sign',
    unit: 'rial',
    priority: 10,
    builtin: true,
    pattern: String.raw`^(?<account>\d[\d.*]{4,30})\n(?<amount>${AMT})\n(?<date>${DATE})_(?<time>${TIME})\nمانده\s?:\s?(?<balance>${BAL})$`,
    sample: '10.3372914.1\n+4,692,800\n07/11_22:01\nمانده: 433,121,042',
  },
  {
    id: 'parsian-v1',
    bankId: 'parsian',
    direction: 'sign',
    unit: 'rial',
    priority: 10,
    builtin: true,
    pattern: String.raw`^(?<account>${ACC})\nمبلغ\s?:\s?(?<amount>${AMT})\nمانده\s?:\s?(?<balance>${BAL})\n(?<date>${DATE})\n(?<time>${TIME})$`,
    sample: '30101540968603\nمبلغ:2,582,800,000+\nمانده:2,616,820,545\n07/04\n09:22',
  },
  {
    id: 'blu-v1',
    bankId: 'blu',
    direction: 'keyword',
    unit: 'rial',
    priority: 10,
    builtin: true,
    pattern: String.raw`^بلو\n(?<kind>[^\n]+)\n[^\n]*?(?<amount>${AMT})\s?ریال[^\n]*\nموجودی\s?:\s?(?<balance>${BAL})\s?ریال\n(?<time>${TIME})\n(?<date>${DATE})$`,
    sample: 'بلو\nواریز پول\nسینا عزیز، 2,500,000 ریال به حساب شما نشست.\nموجودی: 104,451,226 ریال\n18:23\n1405.07.03',
  },
  {
    id: 'shahr-v1',
    bankId: 'shahr',
    direction: 'keyword',
    unit: 'rial',
    priority: 10,
    builtin: true,
    pattern: String.raw`^\*?\s?بانک شهر\s?\*?\n(?:(?<desc>[^\n:]+)\n)?(?<kind>[^\n:]+?)\s?(?:به|از)?\s?:\s?(?<account>${ACC})\nمبلغ\s?:\s?(?<amount>${AMT})\s?ریال\nموجودی\s?:\s?(?<balance>${BAL})\s?ریال\n(?<date>${DATE})\s(?<time>${TIME})$`,
    sample: '*بانک شهر*\nواریز به:700814110204\nمبلغ:3,770,000ریال\nموجودی:89,371,480ریال\n1405/07/1 00:41:16',
  },
  {
    id: 'mehr-iran-v1',
    bankId: 'mehr-iran',
    direction: 'sign',
    unit: 'rial',
    priority: 10,
    builtin: true,
    pattern: String.raw`^(?<account>${ACC})\n(?<amount>${AMT})\n(?<date>${DATE})\s?-\s?(?<time>${TIME})\nمانده\s?:\s?(?<balance>${BAL})$`,
    sample: '300362322544\n5,000,000+\n1405/7/11-14:40\nمانده:7,239,695',
  },
  {
    id: 'khavarmianeh-v1',
    bankId: 'khavarmianeh',
    direction: 'sign',
    unit: 'rial',
    priority: 10,
    builtin: true,
    pattern: String.raw`^بانک خاورمیانه\n(?<account>\d[\d/*]{4,30})\n(?<amount>${AMT})\n(?<date>${DATE})\s(?<time>${TIME})\nمانده\s?:?\s?(?<balance>${BAL})(?:\n(?<desc>[^\n]+))?$`,
    sample: 'بانک خاورمیانه\n838/000115456\n+200,000,000\n07/08\n15:57\nمانده 208,536,365',
  },
];

export interface CompiledTemplate extends SmsTemplate {
  regex: RegExp;
}

export function compileTemplate(t: SmsTemplate): CompiledTemplate | null {
  try {
    return { ...t, regex: new RegExp(t.pattern, 'u') };
  } catch {
    return null;
  }
}

export function validateTemplatePattern(pattern: string): string | null {
  try {
    const re = new RegExp(pattern, 'u');
    if (!pattern.includes('(?<amount>')) return 'الگو باید گروه نام‌دار amount داشته باشد';
    if (!pattern.startsWith('^') || !pattern.endsWith('$')) return 'الگو باید با ^ شروع و با $ تمام شود';
    void re;
    return null;
  } catch (e: any) {
    return `الگوی نامعتبر: ${e.message}`;
  }
}

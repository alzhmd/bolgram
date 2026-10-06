import crypto from 'node:crypto';
import { dbService } from '../db/database.js';
import { jwtSecret } from '../utils/crypto.js';
import { encryptCard, decryptCard } from '../utils/card-crypto.js';
import { formatNumberFa, toFaDigits } from '../parsers/ir/persian.js';
import { formatJalali } from '../parsers/ir/jalali.js';
import * as store from '../services/store.service.js';
import { BotApi, BotApiError, type Platform } from './api.js';
import { toPlain, toRichMessage, type Btn, type Caps, type Part, type View } from './view.js';

/**
 * Merchant bot for Telegram and Bale: link a chat to a store with a one-time code from the
 * panel, then create invoices, manage cards, read today's sales, review held deposits and
 * receive payment alerts. Telegram gets rich messages; Bale gets text + inline keyboard.
 */
export const SERVICE_NAME = 'بولگرام';
const db = () => (dbService as any).db as import('node:sqlite').DatabaseSync;

const CAPS: Record<Platform, Caps> = {
  telegram: { rich: true, copy: true, style: true },
  bale: { rich: false, copy: false, style: false },
};
const STATE_TTL_MS = 15 * 60_000;
const LINK_TTL_MS = 10 * 60_000;

export function ensureBotSchema() {
  const d = db();
  d.exec(`CREATE TABLE IF NOT EXISTS bot_links (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, platform TEXT NOT NULL, chat_id TEXT NOT NULL,
          user_id TEXT, username TEXT, first_name TEXT, notify INTEGER NOT NULL DEFAULT 1, token_version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`);
  d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_bot_links_chat ON bot_links(platform, chat_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_bot_links_merchant ON bot_links(merchant_id)`);
  d.exec(`CREATE TABLE IF NOT EXISTS bot_link_codes (code_hash TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`);
  d.exec(`CREATE TABLE IF NOT EXISTS bot_sessions (platform TEXT NOT NULL, chat_id TEXT NOT NULL, state TEXT, data TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (platform, chat_id))`);
}

// ---------------------------------------------------------------- registry & URLs

const bots = new Map<Platform, BotApi>();
const usernames = new Map<Platform, string>();
const richOffUntil = new Map<Platform, number>();

export function registerBot(api: BotApi, username?: string) {
  bots.set(api.platform, api);
  if (username) usernames.set(api.platform, username);
}
export function unregisterBots() {
  bots.clear();
  usernames.clear();
  richOffUntil.clear();
}
export const botConfigured = (p: Platform) => bots.has(p);
export const botUsername = (p: Platform) => usernames.get(p) || null;

export function publicBase(): string {
  return (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/+$/, '');
}
/** Telegram rejects buttons pointing at localhost/plain http; those links stay in the text only. */
const buttonUrl = (u: string) => (/^https:\/\/[^/]*\.[^/]/.test(u) && !/^https:\/\/(localhost|127\.|0\.0\.0\.0)/.test(u) ? u : undefined);
const panelUrl = (path = '') => `${publicBase()}/panel/${path ? '#' + path : ''}`;
const payUrl = (pathOrId: string) => `${publicBase()}${pathOrId.startsWith('/') ? pathOrId : `/checkout.html?invoice_id=${encodeURIComponent(pathOrId)}`}`;

// ---------------------------------------------------------------- formatting

const fa = (v: number | string) => toFaDigits(String(v));
const toman = (rial: number) => `${formatNumberFa(Math.round(Number(rial) / 10))} تومان`;
const parseTs = (s: unknown) => {
  const str = String(s || '');
  return new Date(str.includes('T') ? str : str.replace(' ', 'T') + 'Z');
};
const when = (s: unknown) => fa(formatJalali(parseTs(s)));
const clock = (s: unknown) => fa(formatJalali(parseTs(s)).slice(-5));
const STATUS: Record<string, string> = { PENDING: '⏳ در انتظار', PAID: '✅ پرداخت شد', EXPIRED: '⌛️ منقضی', CANCELLED: '✖️ لغو' };
const invoiceStatus = (r: any) => (r.status === 'PENDING' && parseTs(r.expires_at).getTime() < Date.now() ? STATUS.EXPIRED : STATUS[r.status] || r.status);
const cut = (t: string, n = 24) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
const storeName = (m: any) => m?.name || (m?.handle ? `@${m.handle}` : 'فروشگاه');

// ---------------------------------------------------------------- links, codes, sessions

interface LinkRow {
  id: string;
  merchant_id: string;
  platform: Platform;
  chat_id: string;
  notify: number;
  token_version: number;
  created_at: number;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, no 0/O/1/I
const codeHash = (code: string) => crypto.createHmac('sha256', jwtSecret()).update(`bot-link|${code}`).digest('hex');
const normalizeCode = (raw: string) => toFaDigits(raw).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).toUpperCase().replace(/[^A-Z0-9]/g, '');

export function createLinkCode(merchantId: string) {
  const d = db();
  const now = Date.now();
  d.prepare('DELETE FROM bot_link_codes WHERE expires_at < ? OR merchant_id = ?').run(now, merchantId);
  const code = Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % 32]).join('');
  d.prepare('INSERT INTO bot_link_codes (code_hash, merchant_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(codeHash(code), merchantId, now + LINK_TTL_MS, now);
  const start = `link_${code}`;
  const tg = botUsername('telegram');
  const bale = botUsername('bale');
  return {
    code,
    expires_at: new Date(now + LINK_TTL_MS).toISOString(),
    telegram_url: tg ? `https://t.me/${tg}?start=${start}` : null,
    bale_url: bale ? `https://ble.ir/${bale}?start=${start}` : null,
  };
}

function consumeLinkCode(raw: string): string | null {
  const code = normalizeCode(raw);
  if (code.length !== 8) return null;
  const d = db();
  const row = d.prepare('SELECT merchant_id FROM bot_link_codes WHERE code_hash = ? AND expires_at > ?').get(codeHash(code), Date.now()) as any;
  if (!row) return null;
  d.prepare('DELETE FROM bot_link_codes WHERE code_hash = ?').run(codeHash(code));
  return row.merchant_id;
}

/** Brute-force guard for typed link codes: 5 wrong codes lock the chat for 15 minutes. */
function linkGuard(key: string, failed?: boolean): boolean {
  const d = db();
  const now = Date.now();
  const row = d.prepare('SELECT count, locked_until FROM auth_failures WHERE key = ?').get(key) as any;
  if (row?.locked_until && Number(row.locked_until) > now) return false;
  if (failed) {
    const count = (row && !row.locked_until ? Number(row.count) : 0) + 1;
    const locked = count >= 5 ? now + 15 * 60_000 : null;
    d.prepare(`INSERT INTO auth_failures (key, count, locked_until, updated_at) VALUES (?, ?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET count = excluded.count, locked_until = excluded.locked_until, updated_at = excluded.updated_at`)
      .run(key, locked ? 0 : count, locked, now);
  }
  return true;
}

function linkFor(platform: Platform, chatId: string): { link: LinkRow; merchant: any } | null {
  const d = db();
  const link = d.prepare('SELECT * FROM bot_links WHERE platform = ? AND chat_id = ?').get(platform, chatId) as any;
  if (!link) return null;
  const merchant = d.prepare('SELECT * FROM merchants WHERE id = ?').get(link.merchant_id) as any;
  // A password reset (token_version bump) or a removed/blocked store ends the bot session too.
  if (!merchant || Number(merchant.token_version || 0) !== Number(link.token_version) || (merchant.status && merchant.status !== 'ACTIVE')) {
    d.prepare('DELETE FROM bot_links WHERE id = ?').run(link.id);
    return null;
  }
  return { link, merchant };
}

export function listLinks(merchantId: string) {
  return (db().prepare('SELECT * FROM bot_links WHERE merchant_id = ? ORDER BY created_at').all(merchantId) as any[]).map((l) => ({
    id: l.id,
    platform: l.platform,
    username: l.username,
    name: l.first_name,
    notify: !!l.notify,
    created_at: new Date(Number(l.created_at)).toISOString(),
  }));
}
export function unlink(merchantId: string, id: string) {
  return Number(db().prepare('DELETE FROM bot_links WHERE id = ? AND merchant_id = ?').run(id, merchantId).changes) > 0;
}
export function setLinkNotify(merchantId: string, id: string, notify: boolean) {
  return Number(db().prepare('UPDATE bot_links SET notify = ? WHERE id = ? AND merchant_id = ?').run(notify ? 1 : 0, id, merchantId).changes) > 0;
}

function getState(platform: Platform, chatId: string): { state: string | null; data: any } {
  const row = db().prepare('SELECT state, data, updated_at FROM bot_sessions WHERE platform = ? AND chat_id = ?').get(platform, chatId) as any;
  if (!row || Number(row.updated_at) < Date.now() - STATE_TTL_MS) return { state: null, data: {} };
  return { state: row.state, data: row.data ? JSON.parse(row.data) : {} };
}
function setState(platform: Platform, chatId: string, state: string | null, data: any = {}) {
  db()
    .prepare(`INSERT INTO bot_sessions (platform, chat_id, state, data, updated_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(platform, chat_id) DO UPDATE SET state = excluded.state, data = excluded.data, updated_at = excluded.updated_at`)
    .run(platform, chatId, state, JSON.stringify(data), Date.now());
}

// ---------------------------------------------------------------- sending

interface Ctx {
  api: BotApi;
  chatId: string;
  messageId?: number;
  hit?: { link: LinkRow; merchant: any } | null;
}

async function show(api: BotApi, chatId: string, view: View, editId?: number) {
  const caps = CAPS[api.platform];
  const rich = caps.rich && (richOffUntil.get(api.platform) || 0) < Date.now();
  if (editId) {
    try {
      if (rich) await api.call('editMessageText', { chat_id: chatId, message_id: editId, rich_message: toRichMessage(view) });
      else {
        const { text, keyboard } = toPlain(view, caps);
        await api.call('editMessageText', { chat_id: chatId, message_id: editId, text, reply_markup: { inline_keyboard: keyboard } });
      }
      return;
    } catch (e) {
      if (e instanceof BotApiError && /not modified/i.test(e.description)) return;
      // Too old to edit, deleted, or a different message kind: send a fresh one below.
    }
  }
  if (rich) {
    try {
      await api.call('sendRichMessage', { chat_id: chatId, rich_message: toRichMessage(view) });
      return;
    } catch (e) {
      if (!(e instanceof BotApiError) || e.code === 429 || e.code === 403) throw e;
      // An API server or relay without rich messages: use text for a while instead of failing.
      console.warn(`[bot] rich message rejected (${e.description}); sending text for 10 minutes`);
      richOffUntil.set(api.platform, Date.now() + 10 * 60_000);
    }
  }
  const { text, keyboard } = toPlain(view, caps);
  await api.call('sendMessage', { chat_id: chatId, text, ...(keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}) });
}

const B = (text: string, data: string, tone?: Btn['tone']): Btn => ({ text, data, ...(tone ? { tone } : {}) });
const homeRow = (): Part => ({ t: 'buttons', row: [B('🏠 منوی اصلی', 'home')] });
const errorView = (title: string, text: string, retry?: Btn): View => [
  { t: 'h', text: `⚠️ ${title}`, size: 3 },
  { t: 'p', line: text },
  { t: 'buttons', row: [...(retry ? [retry] : []), B('🏠 منوی اصلی', 'home')] },
];

// ---------------------------------------------------------------- screens

function welcomeView(): View {
  const url = buttonUrl(panelUrl('/bots'));
  return [
    { t: 'h', text: `👋 به ربات ${SERVICE_NAME} خوش آمدید`, size: 2 },
    { t: 'p', line: 'فاکتور کارت‌به‌کارت با مبلغ یکتا بسازید، کارت‌ها را مدیریت کنید و هر پرداخت تأییدشده را همان لحظه ببینید.' },
    { t: 'list', items: ['🧾 ساخت فاکتور و لینک پرداخت در چند ثانیه', '💳 افزودن، خاموش و روشن کردن کارت‌ها', '🔔 اعلان فوری پرداخت‌های تأییدشده', '📥 رسیدگی به واریزی‌های بی‌صاحب'] },
    { t: 'p', line: ['برای اتصال: پنل ', { b: SERVICE_NAME }, ' ← ', { b: 'ربات تلگرام و بله' }, ' ← «دریافت کد اتصال»؛ بعد کد ۸ حرفی را همین‌جا بفرستید.'] },
    ...(url ? [{ t: 'buttons', row: [{ text: '🌐 باز کردن پنل', url, tone: 'primary' }] } as Part] : []),
  ];
}

function homeView(m: any): View {
  const s = store.todaySummary(m.id);
  const parts: View = [
    { t: 'h', text: `🏪 ${storeName(m)}`, size: 2 },
    { t: 'p', line: ['فروش امروز ', { mark: toman(s.today_rial) }, ' در ', { b: fa(s.today_count) }, ' پرداخت'] },
    {
      t: 'table',
      rows: [
        ['🧾 فاکتور باز', fa(s.open_invoices)],
        ['📥 واریزی بی‌صاحب', fa(s.orphan_deposits)],
        ['📱 گوشی آنلاین', s.devices ? `${fa(s.devices_online)} از ${fa(s.devices)}` : 'وصل نشده'],
        ['💳 کارت فعال', fa(s.active_cards)],
      ],
    },
  ];
  if (!s.active_cards) parts.push({ t: 'p', line: ['⚠️ ', { b: 'کارت فعالی ندارید' }, '؛ بدون کارت فاکتور ساخته نمی‌شود.'] });
  if (s.devices && !s.devices_online) parts.push({ t: 'p', line: ['📵 ', { b: 'گوشی دریافت پیامک آفلاین است' }, '؛ تأیید خودکار تا وصل شدن دوباره متوقف است.'] });
  const panel = buttonUrl(panelUrl());
  parts.push(
    { t: 'buttons', row: [B('🧾 فاکتور جدید', 'inv:new', 'primary'), B('💳 کارت‌ها', 'cards')] },
    { t: 'buttons', row: [B('📊 پرداخت‌ها', 'rep'), B(`📥 واریزی‌ها${s.orphan_deposits ? ` (${fa(s.orphan_deposits)})` : ''}`, 'dep', s.orphan_deposits ? 'danger' : undefined), B('🗂 فاکتورها', 'inv:list')] },
    { t: 'buttons', row: [B('⚙️ تنظیمات', 'set'), ...(panel ? [{ text: '🌐 پنل', url: panel }] : [])] },
    { t: 'footer', text: `${SERVICE_NAME} · ${when(new Date().toISOString())}` },
  );
  return parts;
}

function cardsView(m: any, note?: string): View {
  const cards = store.listCards(m.id);
  const parts: View = [{ t: 'h', text: '💳 کارت‌های فروشگاه', size: 2 }];
  if (note) parts.push({ t: 'p', line: [{ b: note }] });
  if (!cards.length) parts.push({ t: 'p', line: 'هنوز کارتی ثبت نکرده‌اید. اولین کارت را اضافه کنید تا مشتری بتواند به آن واریز کند.' });
  else {
    parts.push({ t: 'table', head: ['بانک', 'کارت', 'صاحب کارت', 'وضعیت'], rows: cards.map((c) => [c.bank_name, `•••• ${fa(c.last4)}`, c.holder || '—', c.active ? '🟢 فعال' : '⚪️ خاموش']) });
    for (const c of cards.slice(0, 12)) {
      parts.push({ t: 'buttons', row: [B(`${c.active ? '⏸ خاموش' : '▶️ روشن'} · ${fa(c.last4)}`, `card:t:${c.id}`, c.active ? undefined : 'success'), B(`🗑 حذف · ${fa(c.last4)}`, `card:d:${c.id}`, 'danger')] });
    }
  }
  parts.push(
    { t: 'quote', text: 'شمارهٔ کامل کارت رمزنگاری‌شده ذخیره می‌شود و همه‌جا فقط ۴ رقم آخر نشان داده می‌شود. اگر کارتی هم‌بانکِ مشتری داشته باشید، همان به او نمایش داده می‌شود تا واریز سریع‌تر انجام شود.', credit: 'امنیت کارت‌ها' },
    { t: 'buttons', row: [B('➕ افزودن کارت', 'card:add', 'success'), B('🏠 منوی اصلی', 'home')] },
  );
  return parts;
}

const cardPrompt = (err?: string): View => [
  { t: 'h', text: '➕ افزودن کارت', size: 2 },
  ...(err ? [{ t: 'p', line: ['❌ ', { b: err }] } as Part] : []),
  { t: 'p', line: 'شمارهٔ ۱۶ رقمی کارت را بفرستید؛ فاصله، خط تیره و ارقام فارسی مشکلی ندارد.' },
  { t: 'p', line: '🔒 پیام شما بلافاصله بعد از خواندن از گفتگو پاک می‌شود.' },
  { t: 'buttons', row: [B('انصراف', 'cards', 'danger')] },
];

const holderPrompt = (bank: string, last4: string, err?: string): View => [
  { t: 'h', text: '👤 نام صاحب کارت', size: 2 },
  { t: 'p', line: ['کارت ', { b: `${bank} •••• ${fa(last4)}` }, ' شناسایی شد.'] },
  ...(err ? [{ t: 'p', line: ['❌ ', { b: err }] } as Part] : []),
  { t: 'p', line: 'نام صاحب کارت را همان‌طور که در بانک ثبت شده بفرستید تا مشتری مطمئن واریز کند.' },
  { t: 'buttons', row: [B('✏️ کارت دیگر', 'card:add'), B('انصراف', 'cards', 'danger')] },
];

const QUICK = [50_000, 100_000, 200_000, 500_000, 1_000_000];
const shortToman = (t: number) => (t >= 1_000_000 ? `${fa(t / 1_000_000)} میلیون` : `${fa(t / 1000)} هزار`);

const amountPrompt = (err?: string): View => [
  { t: 'h', text: '🧾 فاکتور جدید', size: 2 },
  ...(err ? [{ t: 'p', line: ['❌ ', { b: err }] } as Part] : []),
  { t: 'p', line: ['مبلغ را به ', { b: 'تومان' }, ' بفرستید. توضیح هم می‌توانید بعد از مبلغ بنویسید؛ مثل ', { code: '۲۵۰۰۰۰ کفش ورزشی' }] },
  { t: 'p', line: 'یا یکی از مبلغ‌های آماده را بزنید:' },
  { t: 'buttons', row: QUICK.map((t) => B(shortToman(t), `inv:q:${t}`)) },
  { t: 'buttons', row: [B('انصراف', 'home', 'danger')] },
];

function invoiceView(inv: store.InvoiceView): View {
  const link = payUrl(inv.pay_path);
  const until = clock(inv.expires_at);
  const extra = inv.amount_toman - inv.base_toman;
  const forCustomer = `مبلغ ${formatNumberFa(inv.amount_toman)} تومان را از این لینک پرداخت کنید:\n${link}\nلطفاً دقیقاً همین مبلغ را واریز کنید تا پرداخت خودکار تأیید شود. لینک تا ساعت ${until} معتبر است.`;
  const open = buttonUrl(link);
  const parts: View = [
    { t: 'h', text: '✅ فاکتور ساخته شد', size: 2 },
    { t: 'p', line: ['مبلغ قابل پرداخت: ', { mark: toman(inv.amount_rial) }] },
    {
      t: 'table',
      rows: [
        ['مبلغ پایه', `${formatNumberFa(inv.base_toman)} تومان`],
        ['رقم یکتا', extra ? `+${formatNumberFa(extra)} تومان` : 'ندارد'],
        ['اعتبار تا', `ساعت ${until}`],
        ['شناسه', inv.id],
        ...(inv.note ? [['توضیح', inv.note]] : []),
      ],
    },
    { t: 'p', line: ['🔗 ', { code: link }, ' ', { btn: { text: '📋 کپی لینک', copy: link } }] },
    { t: 'quote', text: forCustomer, credit: 'متن آماده برای مشتری' },
    { t: 'buttons', row: [...(forCustomer.length <= 256 ? [{ text: '📋 کپی متن مشتری', copy: forCustomer, tone: 'primary' } as Btn] : []), ...(open ? [{ text: '🔗 باز کردن صفحهٔ پرداخت', url: open } as Btn] : [])] },
    { t: 'buttons', row: [B('🧾 فاکتور دیگر', 'inv:new', 'success'), B('🏠 منوی اصلی', 'home')] },
  ];
  return parts.filter((p) => p.t !== 'buttons' || p.row.length);
}

function invoicesView(m: any): View {
  const rows = store.recentInvoices(m.id, 10);
  return [
    { t: 'h', text: '🗂 آخرین فاکتورها', size: 2 },
    rows.length
      ? { t: 'table', head: ['مبلغ', 'وضعیت', 'زمان', 'توضیح'], rows: rows.map((r) => [toman(r.expected_amount), invoiceStatus(r), when(r.created_at), r.note ? cut(r.note) : '—']) }
      : { t: 'p', line: 'هنوز فاکتوری نساخته‌اید.' },
    { t: 'buttons', row: [B('🧾 فاکتور جدید', 'inv:new', 'primary'), B('🔄 بروزرسانی', 'inv:list'), B('🏠 منو', 'home')] },
  ];
}

function paymentsView(m: any): View {
  const s = store.todaySummary(m.id);
  const rows = store.recentPayments(m.id, 10);
  return [
    { t: 'h', text: '📊 پرداخت‌های تأییدشده', size: 2 },
    { t: 'p', line: ['امروز: ', { mark: toman(s.today_rial) }, ' در ', { b: fa(s.today_count) }, ' پرداخت'] },
    rows.length
      ? { t: 'table', head: ['زمان', 'مبلغ', 'بانک', 'فاکتور'], rows: rows.map((r) => [when(r.created_at), toman(r.amount), store.bankName(String(r.provider || '').toLowerCase()), r.order_id || '—']), caption: '۱۰ پرداخت آخر' }
      : { t: 'p', line: 'هنوز پرداخت تأییدشده‌ای ندارید.' },
    { t: 'buttons', row: [B('🔄 بروزرسانی', 'rep'), B('🏠 منوی اصلی', 'home')] },
  ];
}

function depositsView(m: any, note?: string): View {
  const rows = store.openDeposits(m.id, 8);
  const parts: View = [{ t: 'h', text: '📥 واریزی‌های بی‌صاحب', size: 2 }];
  if (note) parts.push({ t: 'p', line: [{ b: note }] });
  if (!rows.length) parts.push({ t: 'p', line: '✨ واریزی منتظر بررسی ندارید.' });
  else {
    parts.push(
      { t: 'table', head: ['#', 'مبلغ', 'بانک', 'زمان', 'وضعیت'], rows: rows.map((r, i) => [fa(i + 1), toman(r.amount), store.bankName(String(r.provider || '').toLowerCase()), when(r.created_at), r.status === 'SUSPICIOUS' ? '⚠️ مشکوک' : '❔ بدون فاکتور']) },
      { t: 'buttons', row: rows.map((r, i) => B(`بررسی #${fa(i + 1)}`, `dep:o:${r.id}`)) },
      { t: 'quote', text: 'این واریزها فاکتور هم‌مبلغ نداشتند یا پیامکشان از فرستندهٔ ناشناس آمده است. پیش از تأیید، واریز را در اپ بانک خودتان ببینید؛ پیامک جعلی رایج‌ترین روش کلاهبرداری است.', credit: 'هشدار امنیتی' },
    );
  }
  parts.push({ t: 'buttons', row: [B('🔄 بروزرسانی', 'dep'), B('🏠 منوی اصلی', 'home')] });
  return parts;
}

function depositView(m: any, smsId: string): View | null {
  const c = store.depositCandidates(m.id, smsId);
  if (!c) return null;
  const parts: View = [
    { t: 'h', text: '🔎 بررسی واریزی', size: 2 },
    { t: 'p', line: ['مبلغ واریز: ', { mark: toman(c.amount) }] },
  ];
  if (c.invoices.length) {
    parts.push(
      { t: 'table', head: ['#', 'مبلغ فاکتور', 'اختلاف', 'وضعیت'], rows: c.invoices.map((r, i) => [fa(i + 1), toman(r.expected_amount), r.expected_amount === c.amount ? 'برابر' : toman(Math.abs(r.expected_amount - c.amount)), invoiceStatus(r)]), caption: 'نزدیک‌ترین فاکتورهای پرداخت‌نشدهٔ ۲۴ ساعت اخیر' },
      { t: 'buttons', row: c.invoices.map((r, i) => B(`✅ وصل به #${fa(i + 1)}`, `dep:a:${r.id}`, 'success')) },
    );
  } else parts.push({ t: 'p', line: 'فاکتور پرداخت‌نشده‌ای در ۲۴ ساعت اخیر پیدا نشد.' });
  parts.push({ t: 'buttons', row: [B('🚫 رد واریزی', 'dep:r', 'danger'), B('↩️ بازگشت', 'dep')] });
  return parts;
}

function settingsView(m: any, link: LinkRow): View {
  return [
    { t: 'h', text: '⚙️ تنظیمات ربات', size: 2 },
    { t: 'table', rows: [['فروشگاه', storeName(m)], ['اعلان پرداخت', link.notify ? '🔔 روشن' : '🔕 خاموش'], ['متصل از', when(new Date(Number(link.created_at)).toISOString())]] },
    { t: 'buttons', row: [B(link.notify ? '🔕 خاموش کردن اعلان' : '🔔 روشن کردن اعلان', 'set:n', link.notify ? undefined : 'success'), B('🔌 قطع اتصال', 'set:u', 'danger')] },
    homeRow(),
  ];
}

const confirmView = (title: string, text: string, yes: Btn, back: string): View => [
  { t: 'h', text: title, size: 3 },
  { t: 'p', line: text },
  { t: 'buttons', row: [yes, B('انصراف', back)] },
];

// ---------------------------------------------------------------- update handling

export async function handleUpdate(api: BotApi, update: any) {
  if (update.callback_query) return onCallback(api, update.callback_query);
  if (update.message) return onMessage(api, update.message);
}

async function onMessage(api: BotApi, msg: any) {
  if (msg.chat?.type !== 'private') return; // management happens in private chats only
  const chatId = String(msg.chat.id);
  const text: string = String(msg.text || '').trim();
  const hit = linkFor(api.platform, chatId);
  const [cmd, arg] = text.split(/\s+/, 2);
  const command = cmd.startsWith('/') ? cmd.slice(1).split('@')[0].toLowerCase() : '';

  if (command === 'start' && arg?.startsWith('link_')) return tryLink(api, msg, arg.slice(5), hit);
  if (!hit) {
    if (/^[A-Za-z0-9۰-۹]{4}[\s-]?[A-Za-z0-9۰-۹]{4}$/.test(text) || command === 'link') return tryLink(api, msg, command === 'link' ? arg || '' : text, hit);
    return show(api, chatId, welcomeView());
  }
  const m = hit.merchant;
  if (command) {
    setState(api.platform, chatId, null);
    if (command === 'cards') return show(api, chatId, cardsView(m));
    if (command === 'invoice' || command === 'new') { setState(api.platform, chatId, 'inv_amount'); return show(api, chatId, amountPrompt()); }
    if (command === 'report') return show(api, chatId, paymentsView(m));
    if (command === 'deposits') return show(api, chatId, depositsView(m));
    return show(api, chatId, homeView(m));
  }

  const { state, data } = getState(api.platform, chatId);
  const looksLikeCard = /^[\d۰-۹\s-]{16,23}$/.test(text) && store.luhnOk(store.cleanCardNumber(text));
  if (state === 'card_number' || looksLikeCard) {
    const num = store.cleanCardNumber(text);
    api.call('deleteMessage', { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
    let bank: string;
    try { bank = store.checkCardNumber(num); } catch (e: any) { return show(api, chatId, cardPrompt(e.message)); }
    if (store.cardExists(m.id, num)) return show(api, chatId, cardPrompt('این کارت قبلاً ثبت شده است'));
    setState(api.platform, chatId, 'card_holder', { enc: encryptCard(num), bank });
    return show(api, chatId, holderPrompt(store.bankName(bank), num.slice(-4)));
  }
  if (state === 'card_holder' && data.enc) {
    const num = decryptCard(data.enc) || '';
    const holder = store.cleanName(text);
    if (holder.length < 3 || /\d/.test(holder)) return show(api, chatId, holderPrompt(store.bankName(data.bank), num.slice(-4), 'نام صاحب کارت را با حروف بنویسید'));
    setState(api.platform, chatId, 'card_confirm', { ...data, holder });
    return show(api, chatId, [
      { t: 'h', text: '✅ تأیید اطلاعات کارت', size: 2 },
      { t: 'table', rows: [['بانک', store.bankName(data.bank)], ['کارت', `${fa(num.slice(0, 4))} •••• •••• ${fa(num.slice(-4))}`], ['صاحب کارت', holder]] },
      { t: 'buttons', row: [B('✅ ثبت کارت', 'card:save', 'success'), B('✏️ از نو', 'card:add'), B('انصراف', 'cards', 'danger')] },
    ]);
  }
  // An amount works anywhere: "250000" or "۲۵۰٬۰۰۰ کفش" makes an invoice right away.
  const am = text.match(/^([\d۰-۹٬,،.\s]+)(?:\s*تومان)?\s*(.*)$/s);
  if (am && store.parseToman(am[1]) > 0) return makeInvoice(api, chatId, m, store.parseToman(am[1]), am[2]);
  if (state === 'inv_amount') return show(api, chatId, amountPrompt('مبلغ را با عدد بفرستید؛ مثلاً ۲۵۰۰۰۰'));
  return show(api, chatId, homeView(m));
}

async function makeInvoice(api: BotApi, chatId: string, m: any, amount: number, note = '', editId?: number) {
  try {
    const inv = await store.createInvoice(m.id, { amount, note: note.trim(), channel: api.platform === 'bale' ? 'other' : 'telegram', source: 'bot' });
    setState(api.platform, chatId, null);
    return show(api, chatId, invoiceView(inv), editId);
  } catch (e) {
    if (e instanceof store.StoreError && e.code === 'no_card') return show(api, chatId, errorView('کارت فعال ندارید', e.message, B('➕ افزودن کارت', 'card:add', 'success')), editId);
    if (e instanceof store.StoreError) return show(api, chatId, amountPrompt(e.message), editId);
    throw e;
  }
}

async function tryLink(api: BotApi, msg: any, code: string, hit: { link: LinkRow; merchant: any } | null) {
  const chatId = String(msg.chat.id);
  const guardKey = `botlink:${api.platform}:${chatId}`;
  if (!linkGuard(guardKey)) return show(api, chatId, errorView('تلاش‌های زیاد', 'چند کد نادرست فرستاده شد. ۱۵ دقیقهٔ دیگر دوباره امتحان کنید.'));
  const merchantId = consumeLinkCode(code);
  if (!merchantId) {
    linkGuard(guardKey, true);
    return show(api, chatId, errorView('کد اتصال معتبر نیست', 'کد اشتباه است یا بیش از ۱۰ دقیقه از ساختش گذشته. از پنل یک کد تازه بگیرید و همین‌جا بفرستید.'));
  }
  const d = db();
  const m = d.prepare('SELECT * FROM merchants WHERE id = ?').get(merchantId) as any;
  if (!m) return show(api, chatId, welcomeView());
  d.prepare('DELETE FROM bot_links WHERE platform = ? AND chat_id = ?').run(api.platform, chatId);
  d.prepare(`INSERT INTO bot_links (id, merchant_id, platform, chat_id, user_id, username, first_name, notify, token_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .run('bl_' + crypto.randomBytes(8).toString('hex'), m.id, api.platform, chatId, String(msg.from?.id ?? ''), msg.from?.username || null, msg.from?.first_name || null, Number(m.token_version || 0), Date.now());
  setState(api.platform, chatId, null);
  const moved = hit && hit.merchant.id !== m.id ? ` (اتصال قبلی به ${storeName(hit.merchant)} برداشته شد)` : '';
  return show(api, chatId, [
    { t: 'h', text: '🎉 اتصال برقرار شد', size: 2 },
    { t: 'p', line: ['این گفتگو به فروشگاه ', { b: storeName(m) }, ` وصل شد${moved}. از این به بعد هر پرداخت تأییدشده همین‌جا اعلام می‌شود.`] },
    { t: 'buttons', row: [B('🏠 منوی اصلی', 'home', 'primary'), B('🧾 اولین فاکتور', 'inv:new', 'success')] },
  ]);
}

async function onCallback(api: BotApi, cq: any) {
  const chatId = String(cq.message?.chat?.id ?? cq.from?.id ?? '');
  const messageId: number | undefined = cq.message?.message_id;
  const data: string = String(cq.data || '');
  let toast = '';
  try {
    if (!chatId || (cq.message?.chat?.type && cq.message.chat.type !== 'private')) return;
    const hit = linkFor(api.platform, chatId);
    if (!hit) return show(api, chatId, welcomeView(), messageId);
    const m = hit.merchant;
    const [scope, action, id] = data.split(':');
    const p = api.platform;
    const view = (v: View) => show(api, chatId, v, messageId);

    if (data === 'home') { setState(p, chatId, null); return view(homeView(m)); }
    if (data === 'cards') { setState(p, chatId, null); return view(cardsView(m)); }
    if (data === 'card:add') { setState(p, chatId, 'card_number'); return view(cardPrompt()); }
    if (data === 'card:save') {
      const st = getState(p, chatId);
      if (st.state !== 'card_confirm' || !st.data.enc) return view(cardsView(m, 'زمان ثبت تمام شد؛ دوباره کارت را بفرستید.'));
      try {
        const c = store.addCard(m.id, { number: decryptCard(st.data.enc), holder: st.data.holder });
        setState(p, chatId, null);
        toast = 'کارت ثبت شد ✅';
        return view(cardsView(m, `کارت ${c.bank_name} •••• ${fa(c.last4)} اضافه شد.`));
      } catch (e: any) {
        setState(p, chatId, 'card_number');
        return view(cardPrompt(e.message));
      }
    }
    if (scope === 'card' && action === 't' && id) {
      const card = store.listCards(m.id).find((c) => c.id === id);
      if (card) { store.setCardActive(m.id, id, !card.active); toast = card.active ? 'کارت خاموش شد' : 'کارت روشن شد'; }
      return view(cardsView(m));
    }
    if (scope === 'card' && action === 'd' && id) {
      const card = store.listCards(m.id).find((c) => c.id === id);
      if (!card) return view(cardsView(m));
      const lastActive = card.active && store.listCards(m.id).filter((c) => c.active).length === 1;
      return view(confirmView('🗑 حذف کارت', `کارت ${card.bank_name} •••• ${fa(card.last4)} حذف شود؟${lastActive ? ' این آخرین کارت فعال است و بعد از حذف فاکتور جدید ساخته نمی‌شود.' : ''}`, B('بله، حذف شود', `card:dd:${id}`, 'danger'), 'cards'));
    }
    if (scope === 'card' && action === 'dd' && id) {
      toast = store.deleteCard(m.id, id) ? 'کارت حذف شد' : '';
      return view(cardsView(m));
    }
    if (data === 'inv:new') { setState(p, chatId, 'inv_amount'); return view(amountPrompt()); }
    if (scope === 'inv' && action === 'q' && id) return makeInvoice(api, chatId, m, Number(id), '', messageId);
    if (data === 'inv:list') return view(invoicesView(m));
    if (data === 'rep') return view(paymentsView(m));
    if (data === 'dep') { setState(p, chatId, null); return view(depositsView(m)); }
    if (scope === 'dep' && action === 'o' && id) {
      const v = depositView(m, id);
      if (!v) return view(depositsView(m, 'این واریزی قبلاً رسیدگی شده است.'));
      setState(p, chatId, 'deposit', { sms: id });
      return view(v);
    }
    if (scope === 'dep' && (action === 'a' || action === 'r' || action === 'rr')) {
      const st = getState(p, chatId);
      const sms = st.state === 'deposit' ? st.data.sms : null;
      if (!sms) return view(depositsView(m));
      if (action === 'r') return view(confirmView('🚫 رد واریزی', 'این واریزی رد شود؟ رد کردن یعنی واریز را در حساب بانکی خود نمی‌بینید یا جعلی است.', B('بله، رد شود', 'dep:rr', 'danger'), `dep:o:${sms}`));
      setState(p, chatId, null);
      if (action === 'rr') {
        toast = store.rejectDeposit(m.id, sms, 'bot') ? 'واریزی رد شد' : '';
        return view(depositsView(m));
      }
      try {
        await store.approveDeposit(m.id, sms, id);
        toast = 'فاکتور پرداخت‌شده ثبت شد ✅';
        return view(depositsView(m, 'واریزی به فاکتور وصل شد و وب‌هوک فروشگاه ارسال شد.'));
      } catch (e: any) {
        return view(depositsView(m, e.message));
      }
    }
    if (data === 'set') return view(settingsView(m, hit.link));
    if (data === 'set:n') {
      setLinkNotify(m.id, hit.link.id, !hit.link.notify);
      toast = hit.link.notify ? 'اعلان‌ها خاموش شد' : 'اعلان‌ها روشن شد';
      return view(settingsView(m, { ...hit.link, notify: hit.link.notify ? 0 : 1 }));
    }
    if (data === 'set:u') return view(confirmView('🔌 قطع اتصال', `اتصال این گفتگو به ${storeName(m)} قطع شود؟ برای اتصال دوباره کد تازه از پنل لازم است.`, B('بله، قطع شود', 'set:uu', 'danger'), 'set'));
    if (data === 'set:uu') {
      unlink(m.id, hit.link.id);
      return view([{ t: 'h', text: '🔌 اتصال قطع شد', size: 3 }, { t: 'p', line: 'برای اتصال دوباره، از پنل کد تازه بگیرید و اینجا بفرستید.' }]);
    }
    return view(homeView(m));
  } finally {
    api.call('answerCallbackQuery', { callback_query_id: cq.id, ...(toast ? { text: toast } : {}) }).catch(() => {});
  }
}

// ---------------------------------------------------------------- alerts

async function broadcast(merchantId: string, view: View) {
  const links = db().prepare('SELECT * FROM bot_links WHERE merchant_id = ? AND notify = 1').all(merchantId) as any[];
  await Promise.all(
    links.map(async (l) => {
      const api = bots.get(l.platform);
      if (!api || !linkFor(l.platform, l.chat_id)) return;
      await show(api, l.chat_id, view).catch((e) => console.warn('[bot] alert failed', l.platform, e.message));
    }),
  );
}

export function notifyPayment(merchantId: string, p: { amount: number; provider: string; invoiceId: string; trxId?: string; customerName?: string }) {
  if (!bots.size) return Promise.resolve();
  return broadcast(merchantId, [
    { t: 'h', text: '✅ پرداخت تأیید شد', size: 2 },
    { t: 'p', line: [{ mark: toman(p.amount) }, ' به حساب شما واریز و فاکتور پرداخت‌شده ثبت شد.'] },
    {
      t: 'table',
      rows: [
        ['بانک', store.bankName(String(p.provider || '').toLowerCase())],
        ['فاکتور', p.invoiceId],
        ...(p.customerName && p.customerName !== 'فاکتور' ? [['توضیح', p.customerName]] : []),
        ...(p.trxId ? [['شناسه تراکنش', p.trxId]] : []),
        ['زمان', when(new Date().toISOString())],
      ],
    },
    { t: 'buttons', row: [B('🗂 فاکتورها', 'inv:list'), B('🏠 منو', 'home')] },
  ]);
}

export function notifyHeldDeposit(merchantId: string, p: { amount: number; provider: string; suspicious: boolean }) {
  if (!bots.size) return Promise.resolve();
  return broadcast(merchantId, [
    { t: 'h', text: p.suspicious ? '⚠️ واریزی از فرستندهٔ ناشناس' : '📥 واریزی بدون فاکتور', size: 2 },
    { t: 'p', line: [{ b: toman(p.amount) }, ` (${store.bankName(String(p.provider || '').toLowerCase())}) `, p.suspicious ? 'خودکار تأیید نشد چون پیامکش از شمارهٔ رسمی بانک نیامده است.' : 'فاکتور باز هم‌مبلغی نداشت.'] },
    { t: 'p', line: 'اول واریز را در اپ بانک ببینید، بعد به فاکتور وصلش کنید یا ردش کنید.' },
    { t: 'buttons', row: [B('🔎 بررسی واریزی‌ها', 'dep', 'primary')] },
  ]);
}

// ---------------------------------------------------------------- transport

let running = false;
// Bale's API is a Telegram subset; send it only the parameters it documents.
const onlyTelegram = (api: BotApi) => (api.platform === 'telegram' ? { allowed_updates: ['message', 'callback_query'] } : {});

/** Long polling (default; works without a public HTTPS address). Set BOT_MODE=webhook to receive updates at /api/v1/bot/:platform/:secret instead. */
export async function startBots(apis: BotApi[]) {
  ensureBotSchema();
  const mode = (process.env.BOT_MODE || 'polling').toLowerCase();
  if (mode === 'off') return;
  running = true;
  for (const api of apis) {
    const envName = process.env[api.platform === 'telegram' ? 'TELEGRAM_BOT_USERNAME' : 'BALE_BOT_USERNAME'];
    const me = await api.call('getMe').catch((e) => (console.warn(`[bot] ${api.platform} getMe failed:`, e.message), null));
    registerBot(api, envName || me?.username);
    api
      .call('setMyCommands', {
        commands: [
          { command: 'start', description: 'منوی اصلی' },
          { command: 'invoice', description: 'فاکتور جدید' },
          { command: 'cards', description: 'کارت‌ها' },
          { command: 'report', description: 'پرداخت‌های تأییدشده' },
          { command: 'deposits', description: 'واریزی‌های بی‌صاحب' },
        ],
      })
      .catch(() => {});
    if (mode === 'webhook') {
      const secret = process.env.BOT_WEBHOOK_SECRET;
      if (!secret) { console.warn('[bot] BOT_WEBHOOK_SECRET is required for webhook mode'); continue; }
      await api
        .call('setWebhook', { url: `${publicBase()}/api/v1/bot/${api.platform}/${secret}`, ...onlyTelegram(api), ...(api.platform === 'telegram' ? { secret_token: secret } : {}) })
        .catch((e) => console.warn(`[bot] ${api.platform} setWebhook failed:`, e.message));
    } else void poll(api);
  }
}

export function stopBots() {
  running = false;
}

async function poll(api: BotApi) {
  await api.call('deleteWebhook', { drop_pending_updates: false }).catch(() => {});
  let offset = 0;
  let backoff = 1000;
  while (running) {
    try {
      const updates = await api.call<any[]>('getUpdates', { offset, timeout: 25, ...onlyTelegram(api) }, 35_000);
      backoff = 1000;
      for (const u of updates) {
        offset = u.update_id + 1;
        await handleUpdate(api, u).catch((e) => console.error(`[bot] ${api.platform} update failed:`, e));
      }
    } catch (e: any) {
      if (!running) break;
      console.warn(`[bot] ${api.platform} getUpdates:`, e.message);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
}

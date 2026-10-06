import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { db, merchantOf, actorOf, fail, paging, str, isoOf } from './_kit.js';
import { audit, requirePerm } from '../../services/access.js';
import { events } from '../../services/events.js';
import { publicBase } from '../../bot/bot.service.js';
import { formatJalali } from '../../parsers/ir/jalali.js';
import { normalizeMobile, toLatinDigits } from '../../utils/validate.js';
import { readUpload, saveDataUrl, UploadError, UPLOAD_DIR } from '../../utils/uploads.js';

/**
 * Feature plugin "community": support tickets, store review, trust badge (identity verification)
 * and their owner/public endpoints. See docs/dev/PANEL_CONVENTIONS.md.
 */

// ------------------------------------------------------------------ validators (exported for tests)

const digitsOf = (v: unknown) => toLatinDigits(String(v ?? '')).replace(/[\s\-]/g, '');

/** کد ملی: 10 digits, not all equal, official mod-11 checksum. */
export function isValidNationalCode(input: unknown): boolean {
  const s = digitsOf(input);
  if (!/^\d{10}$/.test(s) || /^(\d)\1{9}$/.test(s)) return false;
  const d = s.split('').map(Number);
  const sum = d.slice(0, 9).reduce((a, x, i) => a + x * (10 - i), 0);
  const r = sum % 11;
  return d[9] === (r < 2 ? r : 11 - r);
}

/** شناسه ملی اشخاص حقوقی: 11 digits with the official checksum (tens digit + 2 offset). */
export function isValidCompanyId(input: unknown): boolean {
  const s = digitsOf(input);
  if (!/^\d{11}$/.test(s) || /^(\d)\1{10}$/.test(s)) return false;
  const d = s.split('').map(Number);
  const coef = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17];
  const off = d[9] + 2;
  const sum = coef.reduce((a, c, i) => a + (d[i] + off) * c, 0);
  let r = sum % 11;
  if (r === 10) r = 0;
  return r === d[10];
}

// ------------------------------------------------------------------ constants & helpers

const CATEGORIES = ['payment', 'technical', 'billing', 'account', 'other'] as const;
const PRIORITIES = ['normal', 'high', 'urgent'] as const;
const TICKET_STATUSES = ['open', 'answered', 'waiting', 'closed'] as const;
const REVIEW_STATUSES = ['pending', 'approved', 'hidden'] as const;
const TRUST_STATUSES = ['draft', 'pending', 'approved', 'rejected'] as const;
const DOC_KINDS = ['national_card', 'business_license', 'other'] as const;
const FILE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const FILE_MAX = 5 * 1024 * 1024;
const UPLOAD_LIMIT = { bodyLimit: 8 * 1024 * 1024 };
const ADMIN_NAME = 'پشتیبانی بولگرام';
const SAFE_FILE = /^[a-f0-9]{24}\.(png|jpg|webp|pdf)$/;

const PUBLIC_DIR = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cands = [path.resolve(here, '../../../public'), path.resolve(here, '../../public'), path.resolve(process.cwd(), 'public')];
  return cands.find((c) => fs.existsSync(path.join(c, 'trust.html'))) || cands[cands.length - 1];
})();

const rid = (p: string) => p + crypto.randomBytes(8).toString('hex');
const msIso = (ms: unknown) => (ms ? new Date(Number(ms)).toISOString() : null);
const inList = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === 'string' && (list as readonly string[]).includes(v);
const escXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

interface Attachment { file: string; name: string; mime: string; size: number }

function removeFiles(files: string[]) {
  for (const f of files) {
    if (!SAFE_FILE.test(f)) continue;
    try { fs.unlinkSync(path.join(UPLOAD_DIR, 'private', f)); } catch { /* already gone */ }
  }
}

/** Saves up to 3 private attachments from [{ name, data_url }]; throws UploadError (and cleans up) on any bad one. */
function saveAttachments(raw: unknown): Attachment[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new UploadError('پیوست‌ها معتبر نیستند');
  if (raw.length > 3) throw new UploadError('حداکثر ۳ پیوست مجاز است');
  const saved: Attachment[] = [];
  try {
    for (const a of raw) {
      const dataUrl = typeof a === 'string' ? a : a?.data_url ?? a?.dataUrl;
      const r = saveDataUrl(dataUrl, { visibility: 'private', maxBytes: FILE_MAX, allow: FILE_MIMES });
      const ext = r.mime === 'application/pdf' ? 'pdf' : r.mime.split('/')[1].replace('jpeg', 'jpg');
      saved.push({ file: r.file, name: (typeof a === 'object' && str(a?.name, 100)) || `پیوست-${saved.length + 1}.${ext}`, mime: r.mime, size: r.size });
    }
  } catch (e) {
    removeFiles(saved.map((s) => s.file));
    throw e;
  }
  return saved;
}

function sendFile(reply: FastifyReply, file: string, name: string | undefined) {
  const f = SAFE_FILE.test(file) ? readUpload(file, 'private') : null;
  if (!f) return fail(reply, 404, 'not_found', 'فایل پیدا نشد');
  return reply
    .type(f.mime)
    .header('Cache-Control', 'private, no-store')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:")
    .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name || file)}`)
    .send(f.buf);
}

function storeInfo(m: any) {
  return { id: m.id, name: m.name || m.handle, handle: m.handle, phone: m.phone || null };
}

// ------------------------------------------------------------------ schema

function ensureCommunitySchema() {
  const d = db();
  d.exec(`CREATE TABLE IF NOT EXISTS ticket_threads (
    id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, subject TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'other',
    priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'open', created_by TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_reply_at INTEGER,
    last_admin_at INTEGER, merchant_seen_at INTEGER, first_response_at INTEGER)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_ticket_threads_m ON ticket_threads(merchant_id, updated_at)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_ticket_threads_s ON ticket_threads(status, updated_at)`);
  d.exec(`CREATE TABLE IF NOT EXISTS ticket_messages (
    id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, author_kind TEXT NOT NULL, author_name TEXT, body TEXT NOT NULL,
    attachments TEXT, created_at INTEGER NOT NULL)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_ticket_messages_t ON ticket_messages(ticket_id, created_at)`);
  d.exec(`CREATE TABLE IF NOT EXISTS store_reviews (
    merchant_id TEXT PRIMARY KEY, rating INTEGER NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    show_name INTEGER NOT NULL DEFAULT 1, reply TEXT, replied_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_store_reviews_s ON store_reviews(status, updated_at)`);
  d.exec(`CREATE TABLE IF NOT EXISTS trust_requests (
    merchant_id TEXT PRIMARY KEY, business_name TEXT, business_type TEXT NOT NULL DEFAULT 'individual', owner_name TEXT,
    national_code TEXT, company_national_id TEXT, website TEXT, instagram TEXT, phone TEXT, address TEXT,
    documents TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'draft', note TEXT,
    submitted_at INTEGER, decided_at INTEGER, decided_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_trust_requests_s ON trust_requests(status, submitted_at)`);
  // guarded column additions (older dev databases)
  const addCol = (table: string, col: string, ddl: string) => {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as any[];
    if (!cols.some((c) => c.name === col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  };
  addCol('ticket_threads', 'last_admin_at', 'INTEGER');
  addCol('ticket_threads', 'merchant_seen_at', 'INTEGER');
  addCol('ticket_threads', 'first_response_at', 'INTEGER');
  addCol('store_reviews', 'show_name', 'INTEGER NOT NULL DEFAULT 1');
}

// ------------------------------------------------------------------ tickets

const parseAtt = (s: unknown): Attachment[] => {
  try { const v = JSON.parse(String(s || '[]')); return Array.isArray(v) ? v : []; } catch { return []; }
};

function messageOut(m: any, base: string) {
  return {
    id: m.id,
    author_kind: m.author_kind,
    author_name: m.author_name,
    body: m.body,
    created_at: msIso(m.created_at),
    attachments: parseAtt(m.attachments).map((a) => ({ ...a, url: `${base}/${a.file}` })),
  };
}

function threadOut(t: any, extra: Record<string, unknown> = {}) {
  return {
    id: t.id,
    subject: t.subject,
    category: t.category,
    priority: t.priority,
    status: t.status,
    created_by: t.created_by,
    created_at: msIso(t.created_at),
    updated_at: msIso(t.updated_at),
    last_reply_at: msIso(t.last_reply_at),
    unread: !!t.last_admin_at && Number(t.last_admin_at) > Number(t.merchant_seen_at || 0),
    ...extra,
  };
}

const messagesOf = (ticketId: string) => db().prepare(`SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at, rowid`).all(ticketId) as any[];

function validateTicketBody(b: any): { errors: Record<string, string>; body: string } {
  const errors: Record<string, string> = {};
  const body = str(b?.body, 5000);
  if (body.length < 2) errors.body = 'متن پیام را بنویسید';
  return { errors, body };
}

function addMessage(ticketId: string, kind: 'store' | 'admin', author: string, body: string, attachments: Attachment[], now: number) {
  const id = rid('tkm_');
  db().prepare(`INSERT INTO ticket_messages (id, ticket_id, author_kind, author_name, body, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, ticketId, kind, author, body, JSON.stringify(attachments), now);
  return id;
}

const ticketOf = (merchantId: string, id: string) =>
  db().prepare(`SELECT * FROM ticket_threads WHERE id = ? AND merchant_id = ?`).get(String(id).slice(0, 60), merchantId) as any;

// ------------------------------------------------------------------ trust helpers

const TRUST_FIELDS = ['business_name', 'business_type', 'owner_name', 'national_code', 'company_national_id', 'website', 'instagram', 'phone', 'address'] as const;

function normWebsite(v: string): string | null {
  let s = v.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') || u.username || u.password) return null;
    return (u.origin + (u.pathname === '/' ? '' : u.pathname)).slice(0, 200);
  } catch { return null; }
}
function normInstagram(v: string): string | null {
  let s = v.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
  if (!s) return '';
  s = s.toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(s) ? s : null;
}
function normPhone(v: string): string | null {
  const s = digitsOf(v).replace(/[()+.]/g, '');
  if (!s) return '';
  const mob = normalizeMobile(s);
  if (mob) return mob;
  return /^0\d{10}$/.test(s) ? s : null; // landline with area code
}

function trustOut(r: any, withIds = true) {
  if (!r) return null;
  const docs = parseDocs(r.documents);
  return {
    merchant_id: r.merchant_id,
    status: r.status as string,
    business_name: r.business_name || '',
    business_type: r.business_type || 'individual',
    owner_name: r.owner_name || '',
    national_code: withIds ? r.national_code || '' : undefined,
    company_national_id: withIds ? r.company_national_id || '' : undefined,
    website: r.website || '',
    instagram: r.instagram || '',
    phone: r.phone || '',
    address: r.address || '',
    documents: docs,
    note: r.note || null,
    submitted_at: msIso(r.submitted_at),
    decided_at: msIso(r.decided_at),
  };
}
const parseDocs = (s: unknown): { kind: string; file: string; name?: string; mime?: string; size?: number }[] => {
  try { const v = JSON.parse(String(s || '[]')); return Array.isArray(v) ? v : []; } catch { return []; }
};

/** Field-level validation. `complete` = what is needed to submit for review. */
function validateTrust(r: Record<string, any>, complete: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  const company = r.business_type === 'company';
  if (!inList(['individual', 'company'] as const, r.business_type)) e.business_type = 'نوع کسب‌وکار را انتخاب کنید';
  if (r.national_code && !isValidNationalCode(r.national_code)) e.national_code = 'کد ملی معتبر نیست؛ ده رقم را دوباره بررسی کنید';
  if (company && r.company_national_id && !isValidCompanyId(r.company_national_id)) e.company_national_id = 'شناسه ملی معتبر نیست؛ یازده رقم را دوباره بررسی کنید';
  if (r.business_name && r.business_name.length < 2) e.business_name = 'نام کسب‌وکار خیلی کوتاه است';
  if (r.owner_name && r.owner_name.length < 3) e.owner_name = 'نام و نام خانوادگی را کامل بنویسید';
  if (!complete) return e;
  if (!r.business_name) e.business_name = 'نام کسب‌وکار را بنویسید';
  if (!r.owner_name) e.owner_name = company ? 'نام مدیرعامل یا نماینده را بنویسید' : 'نام و نام خانوادگی صاحب کسب‌وکار را بنویسید';
  if (!r.national_code) e.national_code = 'کد ملی را وارد کنید';
  if (company && !r.company_national_id) e.company_national_id = 'شناسه ملی شرکت را وارد کنید';
  if (!r.phone) e.phone = 'شمارهٔ تماس را وارد کنید';
  if (!r.address || r.address.length < 10) e.address = 'نشانی کامل را بنویسید';
  if (!r.website && !r.instagram) e.website = 'حداقل یکی از آدرس وب‌سایت یا اینستاگرام را وارد کنید';
  const kinds = parseDocs(r.documents).map((d) => d.kind);
  if (!kinds.includes('national_card')) e.documents = 'تصویر کارت ملی (روی کارت) را بارگذاری کنید';
  else if (company && !kinds.includes('business_license')) e.documents = 'تصویر روزنامهٔ رسمی یا جواز کسب را بارگذاری کنید';
  return e;
}

// public badge ----------------------------------------------------------

const maskHandle = (h: string) => (h.length <= 4 ? h[0] + '***' : `${h.slice(0, 2)}***${h.slice(-2)}`);

function badgeSvg(opts: { verified: boolean; handle?: string }) {
  const W = 232, H = 64;
  const ok = opts.verified;
  const c1 = ok ? '#0f766e' : '#64748b';
  const c2 = ok ? '#15803d' : '#94a3b8';
  const title = ok ? 'نماد اعتماد بولگرام — فروشگاه تأییدشده' : 'نماد اعتماد بولگرام — تأیید نشده';
  const sub = ok ? 'هویت فروشگاه تأیید شده است' : 'هنوز تأیید نشده';
  const handle = ok && opts.handle ? `<text x="${W - 56}" y="52" text-anchor="end" font-size="9.5" fill="#d1fae5" font-family="Tahoma,Arial,sans-serif" direction="ltr">${escXml(opts.handle)}</text>` : '';
  const shield = ok
    ? `<path d="M0-15l14 6v9c0 9-6 15-14 18-8-3-14-9-14-18v-9z" fill="#ffffff" fill-opacity=".16" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M-6 1l4.5 4.5L7-5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="M0-15l14 6v9c0 9-6 15-14 18-8-3-14-9-14-18v-9z" fill="#ffffff" fill-opacity=".14" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M0-5v8M0 8v.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escXml(title)}" direction="rtl">
<title>${escXml(title)}</title>
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="14" fill="url(#g)"/>
<g transform="translate(${W - 30} 32)">${shield}</g>
<text x="${W - 56}" y="25" text-anchor="end" font-size="14" font-weight="700" fill="#ffffff" font-family="Vazirmatn,Tahoma,Arial,sans-serif">نماد اعتماد بولگرام</text>
<text x="${W - 56}" y="41" text-anchor="end" font-size="10.5" fill="#ecfdf5" font-family="Vazirmatn,Tahoma,Arial,sans-serif">${sub}</text>
${handle}
<text x="14" y="36" font-size="11" font-weight="700" fill="#ffffff" fill-opacity=".85" font-family="Tahoma,Arial,sans-serif" direction="ltr">Bolgram</text>
</svg>`;
}

// ------------------------------------------------------------------ plugin

export default async function communityRoutes(app: FastifyInstance) {
  ensureCommunitySchema();
  const d = db();
  const rl = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

  // ================= support: merchant =================

  app.get('/api/v2/support/summary', { preHandler: requirePerm('support:use') }, async (req) => {
    const m = merchantOf(req);
    const r = d.prepare(`SELECT
        SUM(CASE WHEN status != 'closed' THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN last_admin_at IS NOT NULL AND last_admin_at > COALESCE(merchant_seen_at, 0) THEN 1 ELSE 0 END) AS unread
      FROM ticket_threads WHERE merchant_id = ?`).get(m.id) as any;
    return { success: true, open: Number(r.open || 0), unread: Number(r.unread || 0) };
  });

  app.get('/api/v2/support/tickets', { preHandler: requirePerm('support:use') }, async (req) => {
    const m = merchantOf(req);
    const q = (req.query || {}) as any;
    const { page, perPage, limit, offset } = paging(q);
    const where = ['merchant_id = ?'];
    const args: any[] = [m.id];
    if (inList(TICKET_STATUSES, q.status)) { where.push('status = ?'); args.push(q.status); }
    else if (q.status === 'active') where.push(`status != 'closed'`);
    const total = (d.prepare(`SELECT COUNT(*) c FROM ticket_threads WHERE ${where.join(' AND ')}`).get(...args) as any).c;
    const rows = d.prepare(`SELECT t.*, (SELECT COUNT(*) FROM ticket_messages x WHERE x.ticket_id = t.id) AS message_count
        FROM ticket_threads t WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as any[];
    return { success: true, data: rows.map((t) => threadOut(t, { message_count: Number(t.message_count) })), page, per_page: perPage, total };
  });

  app.post('/api/v2/support/tickets', { preHandler: requirePerm('support:use'), ...UPLOAD_LIMIT, ...rl(20) }, async (req, reply) => {
    const m = merchantOf(req);
    const b = (req.body || {}) as any;
    const { errors, body } = validateTicketBody(b);
    const subject = str(b.subject, 120);
    if (subject.length < 3) errors.subject = 'موضوع را بنویسید (حداقل ۳ حرف)';
    const category = b.category === undefined ? 'other' : b.category;
    const priority = b.priority === undefined ? 'normal' : b.priority;
    if (!inList(CATEGORIES, category)) errors.category = 'دستهٔ نامعتبر';
    if (!inList(PRIORITIES, priority)) errors.priority = 'اولویت نامعتبر';
    if (Object.keys(errors).length) return fail(reply, 422, 'validation', 'اطلاعات تیکت کامل نیست', errors);
    const open = (d.prepare(`SELECT COUNT(*) c FROM ticket_threads WHERE merchant_id = ? AND status != 'closed'`).get(m.id) as any).c;
    if (open >= 20) return fail(reply, 409, 'too_many_open', 'تعداد تیکت‌های باز شما زیاد است؛ ابتدا تیکت‌های قبلی را ببندید');
    let atts: Attachment[];
    try { atts = saveAttachments(b.attachments); } catch (e) {
      if (e instanceof UploadError) return fail(reply, 422, 'invalid_attachment', e.message, { attachments: e.message });
      throw e;
    }
    const now = Date.now();
    const id = rid('tk_');
    const actor = actorOf(req);
    d.prepare(`INSERT INTO ticket_threads (id, merchant_id, subject, category, priority, status, created_by, created_at, updated_at, last_reply_at, merchant_seen_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`).run(id, m.id, subject, category, priority, actor.name, now, now, now, now);
    addMessage(id, 'store', actor.name, body, atts, now);
    audit(req, m.id, 'ticket.created', id, { subject });
    const t = ticketOf(m.id, id);
    return reply.status(201).send({ success: true, ticket: threadOut(t), messages: messagesOf(id).map((x) => messageOut(x, `/api/v2/support/tickets/${id}/attachments`)) });
  });

  app.get('/api/v2/support/tickets/:id', { preHandler: requirePerm('support:use') }, async (req, reply) => {
    const m = merchantOf(req);
    const t = ticketOf(m.id, (req.params as any).id);
    if (!t) return fail(reply, 404, 'not_found', 'تیکت پیدا نشد');
    const now = Date.now();
    d.prepare(`UPDATE ticket_threads SET merchant_seen_at = ? WHERE id = ?`).run(now, t.id);
    t.merchant_seen_at = now;
    return { success: true, ticket: threadOut(t), messages: messagesOf(t.id).map((x) => messageOut(x, `/api/v2/support/tickets/${t.id}/attachments`)) };
  });

  app.post('/api/v2/support/tickets/:id/reply', { preHandler: requirePerm('support:use'), ...UPLOAD_LIMIT, ...rl(60) }, async (req, reply) => {
    const m = merchantOf(req);
    const t = ticketOf(m.id, (req.params as any).id);
    if (!t) return fail(reply, 404, 'not_found', 'تیکت پیدا نشد');
    if (t.status === 'closed') return fail(reply, 409, 'closed', 'این تیکت بسته شده است؛ برای ادامه آن را دوباره باز کنید');
    const b = (req.body || {}) as any;
    const { errors, body } = validateTicketBody(b);
    if (Object.keys(errors).length) return fail(reply, 422, 'validation', 'متن پیام را بنویسید', errors);
    let atts: Attachment[];
    try { atts = saveAttachments(b.attachments); } catch (e) {
      if (e instanceof UploadError) return fail(reply, 422, 'invalid_attachment', e.message, { attachments: e.message });
      throw e;
    }
    const now = Date.now();
    addMessage(t.id, 'store', actorOf(req).name, body, atts, now);
    d.prepare(`UPDATE ticket_threads SET status = 'open', updated_at = ?, last_reply_at = ?, merchant_seen_at = ? WHERE id = ?`).run(now, now, now, t.id);
    return reply.status(201).send({ success: true, ticket: threadOut(ticketOf(m.id, t.id)), messages: messagesOf(t.id).map((x) => messageOut(x, `/api/v2/support/tickets/${t.id}/attachments`)) });
  });

  for (const action of ['close', 'reopen'] as const) {
    app.post(`/api/v2/support/tickets/:id/${action}`, { preHandler: requirePerm('support:use') }, async (req, reply) => {
      const m = merchantOf(req);
      const t = ticketOf(m.id, (req.params as any).id);
      if (!t) return fail(reply, 404, 'not_found', 'تیکت پیدا نشد');
      const now = Date.now();
      if (action === 'close') d.prepare(`UPDATE ticket_threads SET status = 'closed', updated_at = ? WHERE id = ?`).run(now, t.id);
      else {
        // back to the state the conversation was in: answered if support spoke last, otherwise open
        const last = d.prepare(`SELECT author_kind FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(t.id) as any;
        d.prepare(`UPDATE ticket_threads SET status = ?, updated_at = ? WHERE id = ?`).run(last?.author_kind === 'admin' ? 'answered' : 'open', now, t.id);
      }
      return { success: true, ticket: threadOut(ticketOf(m.id, t.id)) };
    });
  }

  app.get('/api/v2/support/tickets/:id/attachments/:file', { preHandler: requirePerm('support:use') }, async (req, reply) => {
    const m = merchantOf(req);
    const { id, file } = req.params as any;
    const t = ticketOf(m.id, id);
    if (!t) return fail(reply, 404, 'not_found', 'تیکت پیدا نشد');
    const att = messagesOf(t.id).flatMap((x) => parseAtt(x.attachments)).find((a) => a.file === file);
    if (!att) return fail(reply, 404, 'not_found', 'فایل پیدا نشد');
    return sendFile(reply, att.file, att.name);
  });

  // ================= support: owner =================

  app.get('/api/owner/tickets/stats', async () => {
    const r = d.prepare(`SELECT
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS waiting,
        SUM(CASE WHEN status = 'answered' THEN 1 ELSE 0 END) AS answered,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed,
        AVG(CASE WHEN first_response_at IS NOT NULL THEN first_response_at - created_at END) AS avg_first
      FROM ticket_threads`).get() as any;
    const avg = r.avg_first === null || r.avg_first === undefined ? null : Math.round(Number(r.avg_first) / 1000);
    return {
      success: true,
      open: Number(r.open || 0), waiting: Number(r.waiting || 0), answered: Number(r.answered || 0), closed: Number(r.closed || 0),
      avg_first_response_seconds: avg,
    };
  });

  app.get('/api/owner/tickets', async (req) => {
    const q = (req.query || {}) as any;
    const { page, perPage, limit, offset } = paging(q);
    const where: string[] = ['1=1'];
    const args: any[] = [];
    if (inList(TICKET_STATUSES, q.status)) { where.push('t.status = ?'); args.push(q.status); }
    else if (q.status === 'active') where.push(`t.status != 'closed'`);
    const term = str(q.q, 80);
    if (term) {
      const like = `%${term.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
      where.push(`(t.subject LIKE ? ESCAPE '\\' OR t.id LIKE ? ESCAPE '\\' OR m.handle LIKE ? ESCAPE '\\' OR m.name LIKE ? ESCAPE '\\' OR m.phone LIKE ? ESCAPE '\\')`);
      args.push(like, like, like, like, like);
    }
    const from = `FROM ticket_threads t JOIN merchants m ON m.id = t.merchant_id WHERE ${where.join(' AND ')}`;
    const total = (d.prepare(`SELECT COUNT(*) c ${from}`).get(...args) as any).c;
    const rows = d.prepare(`SELECT t.*, m.name AS m_name, m.handle AS m_handle, m.phone AS m_phone, m.id AS m_id,
        (SELECT COUNT(*) FROM ticket_messages x WHERE x.ticket_id = t.id) AS message_count,
        (SELECT MAX(created_at) FROM ticket_messages x WHERE x.ticket_id = t.id AND x.author_kind = 'store') AS last_store_at
      ${from}
      ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'waiting' THEN 1 WHEN 'answered' THEN 2 ELSE 3 END,
               CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, t.updated_at DESC
      LIMIT ? OFFSET ?`).all(...args, limit, offset) as any[];
    const now = Date.now();
    return {
      success: true,
      data: rows.map((t) => ({
        ...threadOut(t, { message_count: Number(t.message_count) }),
        store: storeInfo({ id: t.m_id, name: t.m_name, handle: t.m_handle, phone: t.m_phone }),
        waiting_seconds: t.status === 'open' && t.last_store_at ? Math.max(0, Math.round((now - Number(t.last_store_at)) / 1000)) : null,
      })),
      page, per_page: perPage, total,
    };
  });

  const ownerTicket = (id: string) => d.prepare(`SELECT * FROM ticket_threads WHERE id = ?`).get(String(id).slice(0, 60)) as any;

  app.get('/api/owner/tickets/:id', async (req, reply) => {
    const t = ownerTicket((req.params as any).id);
    if (!t) return fail(reply, 404, 'not_found', 'تیکت پیدا نشد');
    const m = d.prepare(`SELECT id, name, handle, phone, email, plan, status, created_at FROM merchants WHERE id = ?`).get(t.merchant_id) as any;
    return {
      success: true,
      ticket: threadOut(t),
      store: m ? { ...storeInfo(m), email: m.email || null, plan: m.plan || null, status: m.status, created_at: isoOf(m.created_at) } : null,
      messages: messagesOf(t.id).map((x) => messageOut(x, `/api/owner/tickets/${t.id}/attachments`)),
    };
  });

  app.post('/api/owner/tickets/:id/reply', { ...UPLOAD_LIMIT }, async (req, reply) => {
    const t = ownerTicket((req.params as any).id);
    if (!t) return fail(reply, 404, 'not_found', 'تیکت پیدا نشد');
    const b = (req.body || {}) as any;
    const { errors, body } = validateTicketBody(b);
    if (Object.keys(errors).length) return fail(reply, 422, 'validation', 'متن پاسخ را بنویسید', errors);
    let atts: Attachment[];
    try { atts = saveAttachments(b.attachments); } catch (e) {
      if (e instanceof UploadError) return fail(reply, 422, 'invalid_attachment', e.message, { attachments: e.message });
      throw e;
    }
    const now = Date.now();
    addMessage(t.id, 'admin', ADMIN_NAME, body, atts, now);
    d.prepare(`UPDATE ticket_threads SET status = 'answered', updated_at = ?, last_reply_at = ?, last_admin_at = ?, first_response_at = COALESCE(first_response_at, ?) WHERE id = ?`)
      .run(now, now, now, now, t.id);
    events.emit('ticket.replied', { merchantId: t.merchant_id, ticketId: t.id, subject: t.subject });
    audit(req, t.merchant_id, 'ticket.admin_reply', t.id);
    return reply.status(201).send({ success: true, ticket: threadOut(ownerTicket(t.id)), messages: messagesOf(t.id).map((x) => messageOut(x, `/api/owner/tickets/${t.id}/attachments`)) });
  });

  app.patch('/api/owner/tickets/:id', async (req, reply) => {
    const t = ownerTicket((req.params as any).id);
    if (!t) return fail(reply, 404, 'not_found', 'تیکت پیدا نشد');
    const b = (req.body || {}) as any;
    const errors: Record<string, string> = {};
    if (b.status !== undefined && !inList(TICKET_STATUSES, b.status)) errors.status = 'وضعیت نامعتبر';
    if (b.priority !== undefined && !inList(PRIORITIES, b.priority)) errors.priority = 'اولویت نامعتبر';
    if (Object.keys(errors).length) return fail(reply, 422, 'validation', 'مقدار نامعتبر', errors);
    d.prepare(`UPDATE ticket_threads SET status = ?, priority = ?, updated_at = ? WHERE id = ?`).run(b.status ?? t.status, b.priority ?? t.priority, Date.now(), t.id);
    return { success: true, ticket: threadOut(ownerTicket(t.id)) };
  });

  app.get('/api/owner/tickets/:id/attachments/:file', async (req, reply) => {
    const { id, file } = req.params as any;
    const t = ownerTicket(id);
    if (!t) return fail(reply, 404, 'not_found', 'تیکت پیدا نشد');
    const att = messagesOf(t.id).flatMap((x) => parseAtt(x.attachments)).find((a) => a.file === file);
    if (!att) return fail(reply, 404, 'not_found', 'فایل پیدا نشد');
    return sendFile(reply, att.file, att.name);
  });

  // ================= review =================

  const reviewOut = (r: any) =>
    r && {
      rating: r.rating,
      text: r.body,
      status: r.status as string,
      show_name: !!r.show_name,
      reply: r.reply || null,
      replied_at: msIso(r.replied_at),
      created_at: msIso(r.created_at),
      updated_at: msIso(r.updated_at),
    };

  app.get('/api/v2/review', { preHandler: requirePerm('review:write') }, async (req) => {
    const r = d.prepare(`SELECT * FROM store_reviews WHERE merchant_id = ?`).get(merchantOf(req).id) as any;
    return { success: true, review: reviewOut(r) || null };
  });

  app.put('/api/v2/review', { preHandler: requirePerm('review:write') }, async (req, reply) => {
    const m = merchantOf(req);
    const b = (req.body || {}) as any;
    const errors: Record<string, string> = {};
    const rating = Number(toLatinDigits(String(b.rating ?? '')));
    const text = str(b.text, 1000);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = 'امتیاز را از ۱ تا ۵ انتخاب کنید';
    if (text.length < 10) errors.text = 'نظر شما باید حداقل ۱۰ حرف باشد';
    if (typeof b.text === 'string' && b.text.trim().length > 1000) errors.text = 'نظر شما نباید بیشتر از ۱۰۰۰ حرف باشد';
    if (Object.keys(errors).length) return fail(reply, 422, 'validation', 'نظر کامل نیست', errors);
    const prev = d.prepare(`SELECT * FROM store_reviews WHERE merchant_id = ?`).get(m.id) as any;
    const now = Date.now();
    const showName = b.show_name === undefined ? (prev ? prev.show_name : 1) : b.show_name ? 1 : 0;
    if (prev) {
      // editing sends it back to moderation, except a hidden review which stays hidden
      d.prepare(`UPDATE store_reviews SET rating = ?, body = ?, show_name = ?, status = ?, updated_at = ? WHERE merchant_id = ?`)
        .run(rating, text, showName, prev.status === 'hidden' ? 'hidden' : 'pending', now, m.id);
    } else {
      d.prepare(`INSERT INTO store_reviews (merchant_id, rating, body, status, show_name, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)`)
        .run(m.id, rating, text, showName, now, now);
    }
    return { success: true, review: reviewOut(d.prepare(`SELECT * FROM store_reviews WHERE merchant_id = ?`).get(m.id)) };
  });

  app.get('/api/owner/reviews', async (req) => {
    const q = (req.query || {}) as any;
    const { page, perPage, limit, offset } = paging(q);
    const where = inList(REVIEW_STATUSES, q.status) ? 'WHERE r.status = ?' : '';
    const args = where ? [q.status] : [];
    const total = (d.prepare(`SELECT COUNT(*) c FROM store_reviews r ${where}`).get(...args) as any).c;
    const rows = d.prepare(`SELECT r.*, m.name AS m_name, m.handle AS m_handle, m.phone AS m_phone, m.id AS m_id FROM store_reviews r JOIN merchants m ON m.id = r.merchant_id
      ${where} ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.updated_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as any[];
    const counts = Object.fromEntries((d.prepare(`SELECT status, COUNT(*) c FROM store_reviews GROUP BY status`).all() as any[]).map((x) => [x.status, Number(x.c)]));
    return {
      success: true,
      data: rows.map((r) => ({ ...reviewOut(r), id: r.merchant_id, store: storeInfo({ id: r.m_id, name: r.m_name, handle: r.m_handle, phone: r.m_phone }) })),
      counts: { pending: counts.pending || 0, approved: counts.approved || 0, hidden: counts.hidden || 0 },
      page, per_page: perPage, total,
    };
  });

  app.patch('/api/owner/reviews/:id', async (req, reply) => {
    const id = String((req.params as any).id).slice(0, 60);
    const r = d.prepare(`SELECT * FROM store_reviews WHERE merchant_id = ?`).get(id) as any;
    if (!r) return fail(reply, 404, 'not_found', 'نظر پیدا نشد');
    const b = (req.body || {}) as any;
    const errors: Record<string, string> = {};
    if (b.status !== undefined && !inList(REVIEW_STATUSES, b.status)) errors.status = 'وضعیت نامعتبر';
    if (b.reply !== undefined && b.reply !== null && typeof b.reply !== 'string') errors.reply = 'پاسخ نامعتبر';
    if (typeof b.reply === 'string' && b.reply.trim().length > 1000) errors.reply = 'پاسخ نباید بیشتر از ۱۰۰۰ حرف باشد';
    if (Object.keys(errors).length) return fail(reply, 422, 'validation', 'مقدار نامعتبر', errors);
    const now = Date.now();
    let replyText = r.reply, repliedAt = r.replied_at;
    if (b.reply !== undefined) {
      replyText = b.reply ? str(b.reply, 1000) || null : null;
      repliedAt = replyText ? now : null;
    }
    d.prepare(`UPDATE store_reviews SET status = ?, reply = ?, replied_at = ? WHERE merchant_id = ?`).run(b.status ?? r.status, replyText, repliedAt, id);
    audit(req, id, 'review.moderated', id, { status: b.status ?? r.status });
    return { success: true, review: { ...reviewOut(d.prepare(`SELECT * FROM store_reviews WHERE merchant_id = ?`).get(id)), id } };
  });

  app.get('/api/pub/reviews', rl(60), async (req, reply) => {
    const q = (req.query || {}) as any;
    const lim = Math.min(50, Math.max(1, Number(q.limit) || 12));
    const rows = d.prepare(`SELECT r.*, m.name AS m_name, m.handle AS m_handle FROM store_reviews r JOIN merchants m ON m.id = r.merchant_id
      WHERE r.status = 'approved' ORDER BY r.updated_at DESC LIMIT ?`).all(lim) as any[];
    const sum = d.prepare(`SELECT COUNT(*) c, AVG(rating) a FROM store_reviews WHERE status = 'approved'`).get() as any;
    return reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Cache-Control', 'public, max-age=120')
      .send({
        success: true,
        summary: { count: Number(sum.c), average: sum.a === null ? null : Math.round(Number(sum.a) * 10) / 10 },
        data: rows.map((r) => ({
          name: r.show_name ? r.m_name || r.m_handle : maskHandle(String(r.m_handle || 'store')),
          rating: r.rating,
          text: r.body,
          reply: r.reply || null,
          date: msIso(r.updated_at),
        })),
      });
  });

  // ================= trust: merchant =================

  const trustRow = (mid: string) => d.prepare(`SELECT * FROM trust_requests WHERE merchant_id = ?`).get(mid) as any;
  const embedOf = (handle: string) => {
    const base = publicBase();
    const url = `${base}/trust/${handle}`;
    const badge = `${base}/api/pub/trust/${handle}/badge.svg`;
    return { page_url: url, badge_url: badge, html: `<a href="${url}" target="_blank" rel="noopener"><img src="${badge}" alt="نماد اعتماد بولگرام"></a>` };
  };
  const trustPayload = (m: any, r: any) => ({
    success: true,
    status: r ? r.status : 'none',
    request: trustOut(r),
    embed: r?.status === 'approved' ? embedOf(m.handle) : null,
    default_phone: m.phone || '',
  });

  app.get('/api/v2/trust', { preHandler: requirePerm('trust:manage') }, async (req) => {
    const m = merchantOf(req);
    return trustPayload(m, trustRow(m.id));
  });

  /** Normalises and validates posted fields; returns the cleaned record. */
  function cleanTrust(b: any, base: any) {
    const e: Record<string, string> = {};
    const out: Record<string, any> = {};
    for (const f of TRUST_FIELDS) out[f] = base ? base[f] || '' : '';
    if (b.business_type !== undefined) out.business_type = b.business_type;
    for (const f of ['business_name', 'owner_name'] as const) if (b[f] !== undefined) out[f] = str(b[f], 100);
    if (b.address !== undefined) out.address = str(b.address, 300);
    if (b.national_code !== undefined) out.national_code = digitsOf(b.national_code).slice(0, 10);
    if (b.company_national_id !== undefined) out.company_national_id = digitsOf(b.company_national_id).slice(0, 11);
    if (b.website !== undefined) { const w = normWebsite(str(b.website, 200)); if (w === null) e.website = 'آدرس وب‌سایت معتبر نیست (مثلاً https://example.ir)'; else out.website = w; }
    if (b.instagram !== undefined) { const i = normInstagram(str(b.instagram, 100)); if (i === null) e.instagram = 'شناسهٔ اینستاگرام معتبر نیست'; else out.instagram = i; }
    if (b.phone !== undefined) { const p = normPhone(str(b.phone, 30)); if (p === null) e.phone = 'شمارهٔ تماس معتبر نیست (موبایل یا تلفن با کد شهر)'; else out.phone = p; }
    if (out.business_type !== 'company') out.company_national_id = '';
    return { out, e };
  }

  const editableTrust = (r: any) => !r || r.status === 'draft' || r.status === 'rejected';

  app.put('/api/v2/trust', { preHandler: requirePerm('trust:manage') }, async (req, reply) => {
    const m = merchantOf(req);
    const r = trustRow(m.id);
    if (!editableTrust(r)) return fail(reply, 409, 'locked', r.status === 'pending' ? 'درخواست شما در حال بررسی است و تا اعلام نتیجه قابل ویرایش نیست' : 'درخواست شما تأیید شده است');
    const { out, e } = cleanTrust((req.body || {}) as any, r);
    Object.assign(e, validateTrust({ ...out, documents: r?.documents }, false), e);
    if (Object.keys(e).length) return fail(reply, 422, 'validation', 'برخی اطلاعات درست نیست', e);
    const now = Date.now();
    if (r) {
      d.prepare(`UPDATE trust_requests SET business_name=?, business_type=?, owner_name=?, national_code=?, company_national_id=?, website=?, instagram=?, phone=?, address=?, status='draft', updated_at=? WHERE merchant_id=?`)
        .run(out.business_name, out.business_type, out.owner_name, out.national_code, out.company_national_id, out.website, out.instagram, out.phone, out.address, now, m.id);
    } else {
      d.prepare(`INSERT INTO trust_requests (merchant_id, business_name, business_type, owner_name, national_code, company_national_id, website, instagram, phone, address, documents, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'draft', ?, ?)`)
        .run(m.id, out.business_name, out.business_type, out.owner_name, out.national_code, out.company_national_id, out.website, out.instagram, out.phone, out.address, now, now);
    }
    return trustPayload(m, trustRow(m.id));
  });

  app.post('/api/v2/trust/submit', { preHandler: requirePerm('trust:manage'), ...rl(10) }, async (req, reply) => {
    const m = merchantOf(req);
    const r = trustRow(m.id);
    if (!r) return fail(reply, 422, 'validation', 'ابتدا اطلاعات کسب‌وکار را وارد کنید', { business_name: 'اطلاعات کسب‌وکار را وارد کنید' });
    if (!editableTrust(r)) return fail(reply, 409, 'locked', r.status === 'pending' ? 'درخواست شما قبلاً ثبت شده و در حال بررسی است' : 'درخواست شما قبلاً تأیید شده است');
    const e = validateTrust(r, true);
    if (Object.keys(e).length) return fail(reply, 422, 'validation', 'برای ارسال، اطلاعات را کامل کنید', e);
    const now = Date.now();
    d.prepare(`UPDATE trust_requests SET status='pending', submitted_at=?, note=NULL, decided_at=NULL, decided_by=NULL, updated_at=? WHERE merchant_id=?`).run(now, now, m.id);
    audit(req, m.id, 'trust.submitted', m.id);
    return trustPayload(m, trustRow(m.id));
  });

  app.post('/api/v2/trust/documents', { preHandler: requirePerm('trust:manage'), ...UPLOAD_LIMIT, ...rl(20) }, async (req, reply) => {
    const m = merchantOf(req);
    const b = (req.body || {}) as any;
    const r = trustRow(m.id);
    if (!editableTrust(r)) return fail(reply, 409, 'locked', 'در حال حاضر امکان تغییر مدارک وجود ندارد');
    if (!inList(DOC_KINDS, b.kind)) return fail(reply, 422, 'validation', 'نوع مدرک را انتخاب کنید', { kind: 'نوع مدرک نامعتبر است' });
    const docs = parseDocs(r?.documents);
    if (docs.length >= 6) return fail(reply, 422, 'validation', 'حداکثر ۶ مدرک مجاز است', { documents: 'حداکثر ۶ مدرک مجاز است' });
    let saved;
    try { saved = saveDataUrl(b.data_url ?? b.dataUrl, { visibility: 'private', maxBytes: FILE_MAX, allow: FILE_MIMES }); } catch (e) {
      if (e instanceof UploadError) return fail(reply, 422, 'invalid_attachment', e.message, { documents: e.message });
      throw e;
    }
    // one document per fixed kind: a new national card / license replaces the previous one
    const keep = b.kind === 'other' ? docs : docs.filter((x) => x.kind !== b.kind);
    removeFiles(docs.filter((x) => !keep.includes(x)).map((x) => x.file));
    keep.push({ kind: b.kind, file: saved.file, name: str(b.name, 100) || undefined, mime: saved.mime, size: saved.size });
    const now = Date.now();
    if (r) d.prepare(`UPDATE trust_requests SET documents = ?, status = 'draft', updated_at = ? WHERE merchant_id = ?`).run(JSON.stringify(keep), now, m.id);
    else d.prepare(`INSERT INTO trust_requests (merchant_id, documents, status, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?)`).run(m.id, JSON.stringify(keep), now, now);
    return reply.status(201).send(trustPayload(m, trustRow(m.id)));
  });

  app.delete('/api/v2/trust/documents/:file', { preHandler: requirePerm('trust:manage') }, async (req, reply) => {
    const m = merchantOf(req);
    const r = trustRow(m.id);
    const file = String((req.params as any).file);
    if (!r || !parseDocs(r.documents).some((x) => x.file === file)) return fail(reply, 404, 'not_found', 'مدرک پیدا نشد');
    if (!editableTrust(r)) return fail(reply, 409, 'locked', 'در حال حاضر امکان تغییر مدارک وجود ندارد');
    d.prepare(`UPDATE trust_requests SET documents = ?, status = 'draft', updated_at = ? WHERE merchant_id = ?`)
      .run(JSON.stringify(parseDocs(r.documents).filter((x) => x.file !== file)), Date.now(), m.id);
    removeFiles([file]);
    return trustPayload(m, trustRow(m.id));
  });

  app.get('/api/v2/trust/documents/:file', { preHandler: requirePerm('trust:manage') }, async (req, reply) => {
    const m = merchantOf(req);
    const r = trustRow(m.id);
    const doc = r && parseDocs(r.documents).find((x) => x.file === (req.params as any).file);
    if (!doc) return fail(reply, 404, 'not_found', 'مدرک پیدا نشد');
    return sendFile(reply, doc.file, doc.name);
  });

  // ================= trust: owner =================

  const docsOut = (mid: string, r: any) => parseDocs(r.documents).map((x) => ({ ...x, url: `/api/owner/trust/${mid}/documents/${x.file}` }));

  app.get('/api/owner/trust', async (req) => {
    const q = (req.query || {}) as any;
    const { page, perPage, limit, offset } = paging(q);
    const where = [`r.status != 'draft'`];
    const args: any[] = [];
    if (inList(TRUST_STATUSES, q.status) && q.status !== 'draft') { where.push('r.status = ?'); args.push(q.status); }
    const term = str(q.q, 80);
    if (term) {
      const like = `%${term.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
      where.push(`(m.handle LIKE ? ESCAPE '\\' OR m.name LIKE ? ESCAPE '\\' OR r.business_name LIKE ? ESCAPE '\\')`);
      args.push(like, like, like);
    }
    const from = `FROM trust_requests r JOIN merchants m ON m.id = r.merchant_id WHERE ${where.join(' AND ')}`;
    const total = (d.prepare(`SELECT COUNT(*) c ${from}`).get(...args) as any).c;
    const rows = d.prepare(`SELECT r.*, m.name AS m_name, m.handle AS m_handle, m.phone AS m_phone, m.id AS m_id ${from}
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, COALESCE(r.submitted_at, r.updated_at) DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as any[];
    const counts = Object.fromEntries((d.prepare(`SELECT status, COUNT(*) c FROM trust_requests GROUP BY status`).all() as any[]).map((x) => [x.status, Number(x.c)]));
    return {
      success: true,
      data: rows.map((r) => ({
        merchant_id: r.merchant_id, status: r.status, business_name: r.business_name, business_type: r.business_type, owner_name: r.owner_name,
        submitted_at: msIso(r.submitted_at), decided_at: msIso(r.decided_at), store: storeInfo({ id: r.m_id, name: r.m_name, handle: r.m_handle, phone: r.m_phone }),
      })),
      counts: { pending: counts.pending || 0, approved: counts.approved || 0, rejected: counts.rejected || 0 },
      page, per_page: perPage, total,
    };
  });

  app.get('/api/owner/trust/:merchantId', async (req, reply) => {
    const mid = String((req.params as any).merchantId).slice(0, 60);
    const r = trustRow(mid);
    const m = d.prepare(`SELECT id, name, handle, phone, email, created_at FROM merchants WHERE id = ?`).get(mid) as any;
    if (!r || !m) return fail(reply, 404, 'not_found', 'درخواست پیدا نشد');
    return { success: true, request: { ...trustOut(r), documents: docsOut(mid, r), decided_by: r.decided_by || null }, store: { ...storeInfo(m), email: m.email || null, created_at: isoOf(m.created_at) } };
  });

  app.get('/api/owner/trust/:merchantId/documents/:file', async (req, reply) => {
    const { merchantId, file } = req.params as any;
    const r = trustRow(String(merchantId).slice(0, 60));
    const doc = r && parseDocs(r.documents).find((x) => x.file === file);
    if (!doc) return fail(reply, 404, 'not_found', 'مدرک پیدا نشد');
    return sendFile(reply, doc.file, doc.name);
  });

  app.post('/api/owner/trust/:merchantId/decide', async (req, reply) => {
    const mid = String((req.params as any).merchantId).slice(0, 60);
    const r = trustRow(mid);
    if (!r || r.status === 'draft') return fail(reply, 404, 'not_found', 'درخواست ثبت‌شده‌ای پیدا نشد');
    const b = (req.body || {}) as any;
    if (typeof b.approved !== 'boolean') return fail(reply, 422, 'validation', 'تصمیم مشخص نیست', { approved: 'تأیید یا رد را مشخص کنید' });
    const note = str(b.note, 500);
    if (!b.approved && note.length < 3) return fail(reply, 422, 'validation', 'دلیل رد درخواست را برای فروشنده بنویسید', { note: 'دلیل رد را بنویسید' });
    const now = Date.now();
    const by = String((req as any).admin?.email || 'admin');
    d.prepare(`UPDATE trust_requests SET status = ?, note = ?, decided_at = ?, decided_by = ?, updated_at = ? WHERE merchant_id = ?`)
      .run(b.approved ? 'approved' : 'rejected', note || null, now, by, now, mid);
    audit(req, mid, b.approved ? 'trust.approved' : 'trust.rejected', mid, { note: note || undefined });
    events.emit('trust.decided', { merchantId: mid, approved: b.approved, note: note || undefined });
    return { success: true, request: { ...trustOut(trustRow(mid)), documents: docsOut(mid, trustRow(mid)) } };
  });

  // ================= trust: public =================

  const publicTrust = (handleRaw: unknown) => {
    const handle = String(handleRaw || '').toLowerCase().slice(0, 40);
    const m = /^[a-z0-9][a-z0-9-]*$/.test(handle) ? (d.prepare(`SELECT id, name, handle FROM merchants WHERE LOWER(handle) = ?`).get(handle) as any) : null;
    const r = m ? trustRow(m.id) : null;
    return { handle, m, r: r && r.status === 'approved' ? r : null };
  };

  app.get('/trust/:handle', rl(60), async (_req, reply) => {
    let html: string;
    try { html = await fs.promises.readFile(path.join(PUBLIC_DIR, 'trust.html'), 'utf8'); } catch { return reply.status(404).type('text/plain; charset=utf-8').send('Not found'); }
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').header('Referrer-Policy', 'same-origin').send(html);
  });

  app.get('/api/pub/trust/:handle', rl(60), async (req, reply) => {
    const { handle, m, r } = publicTrust((req.params as any).handle);
    reply.header('Access-Control-Allow-Origin', '*').header('Cache-Control', 'public, max-age=60');
    if (!m || !r) return { success: true, verified: false, handle, store: m ? { name: m.name || m.handle, handle: m.handle } : null };
    return {
      success: true,
      verified: true,
      handle: m.handle,
      store: { name: r.business_name || m.name || m.handle, handle: m.handle },
      business_type: r.business_type,
      website: r.website || null,
      instagram: r.instagram || null,
      verified_at: msIso(r.decided_at),
      verified_at_fa: r.decided_at ? formatJalali(new Date(Number(r.decided_at)), false) : null,
      issuer: 'بولگرام',
    };
  });

  app.get('/api/pub/trust/:handle/badge.svg', rl(120), async (req, reply) => {
    const { m, r } = publicTrust((req.params as any).handle);
    return reply
      .type('image/svg+xml; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .header('Access-Control-Allow-Origin', '*')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .send(badgeSvg({ verified: !!(m && r), handle: m?.handle }));
  });
}

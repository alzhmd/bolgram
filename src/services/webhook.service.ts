import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { CryptoUtil, merchantWebhookSecret } from '../utils/crypto.js';
import { dbService } from '../db/database.js';

/**
 * Signed webhooks with a persistent delivery log and retry queue.
 *
 * Every HTTP attempt is one row in `webhook_deliveries` (rows of one delivery share `delivery_id`,
 * which is also sent as X-Bolgram-Delivery). A failed attempt that will be retried carries
 * `next_retry_at`; the worker (`processDueRetries`) picks it up, so retries survive restarts.
 * Policy: up to 6 attempts, after failures wait 1 min, 10 min, 1 h, 6 h, 16 h (about 23 h in total).
 */
export interface WebhookPayload {
  invoice_id: string;
  status: 'true' | 'false';
  event?: string;
  provider?: string;
  trx_id?: string;
  amount?: number;
  timestamp?: string;
  metadata?: unknown;
  [extra: string]: unknown;
}

export const MAX_ATTEMPTS = 6;
export const RETRY_DELAYS_S = [60, 600, 3600, 21600, 57600];
export const SECRET_GRACE_MS = 24 * 3600_000;
const TIMEOUT_MS = 8000;

const db = () => {
  ensureWebhookSchema();
  return (dbService as any).db as import('node:sqlite').DatabaseSync;
};

let schemaReady = false;
export function ensureWebhookSchema() {
  if (schemaReady) return;
  const d = (dbService as any).db as import('node:sqlite').DatabaseSync;
  const cols = new Set((d.prepare('PRAGMA table_info(merchants)').all() as any[]).map((c) => c.name));
  for (const [n, t] of [
    ['webhook_secret', 'TEXT'],
    ['webhook_secret_prev', 'TEXT'],
    ['webhook_secret_prev_until', 'INTEGER'],
    ['api_key_last_used', 'INTEGER'],
    ['support_phone', 'TEXT'],
    ['support_telegram', 'TEXT'],
    ['support_instagram', 'TEXT'],
    ['website', 'TEXT'],
  ]) if (!cols.has(n)) d.exec(`ALTER TABLE merchants ADD COLUMN ${n} ${t}`);
  d.exec(`CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL, merchant_id TEXT NOT NULL, event TEXT NOT NULL, invoice_id TEXT, url TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'store', request_body TEXT NOT NULL, request_headers TEXT, status TEXT NOT NULL, http_status INTEGER,
    duration_ms INTEGER, attempt INTEGER NOT NULL DEFAULT 1, max_attempts INTEGER NOT NULL DEFAULT 6, response_body TEXT, error TEXT,
    next_retry_at INTEGER, created_at INTEGER NOT NULL)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_wd_merchant ON webhook_deliveries(merchant_id, created_at)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_wd_retry ON webhook_deliveries(next_retry_at) WHERE next_retry_at IS NOT NULL`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_wd_delivery ON webhook_deliveries(delivery_id)`);
  schemaReady = true;
}

// ------------------------------------------------------------- URL safety (SSRF)

function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const [a, b, c, d] = v4[1].split('.').map(Number);
    s = s.slice(0, -v4[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const fill = tail === undefined ? 0 : 8 - h.length - t.length;
  if (fill < 0 || (tail === undefined && h.length !== 8)) return null;
  const parts = [...h, ...Array(fill).fill('0'), ...t].map((x) => parseInt(x || '0', 16));
  return parts.length === 8 && parts.every((x) => Number.isFinite(x)) ? parts : null;
}

export function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (v === 6) {
    const g = expandV6(ip);
    if (!g) return true;
    if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
      // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible forms: judge the embedded IPv4
      if (g[5] === 0xffff || g[6] !== 0 || g[7] > 1) return isPrivateAddress(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
    }
    if (g.every((x, i) => (i === 7 ? x <= 1 : x === 0))) return true; // :: and ::1
    return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00;
  }
  return false;
}

const isProd = () => process.env.NODE_ENV === 'production';
const bareHost = (h: string) => h.replace(/^\[|\]$/g, '').toLowerCase();
const localhostLike = (h: string) => h === 'localhost' || h.endsWith('.localhost') || (net.isIP(h) !== 0 && isPrivateAddress(h) && (h === '::1' || h.startsWith('127.')));

/** https is required; plain http only for localhost outside production; private/loopback/link-local targets are refused in production. */
export function validateWebhookUrl(raw: unknown, opts: { production?: boolean } = {}): { ok: true; url: string } | { ok: false; message: string } {
  const production = opts.production ?? isProd();
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text || text.length > 500) return { ok: false, message: 'آدرس وب‌هوک معتبر نیست' };
  let u: URL;
  try { u = new URL(text); } catch { return { ok: false, message: 'آدرس وب‌هوک معتبر نیست' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, message: 'آدرس باید با https شروع شود' };
  if (u.username || u.password) return { ok: false, message: 'آدرس نباید شامل نام کاربری و رمز باشد' };
  const host = bareHost(u.hostname);
  const local = localhostLike(host);
  if (production) {
    if (u.protocol !== 'https:') return { ok: false, message: 'در محیط واقعی فقط آدرس https پذیرفته می‌شود' };
    const internal = local || (net.isIP(host) !== 0 && isPrivateAddress(host)) || !host.includes('.') && net.isIP(host) === 0 || /\.(local|internal|lan|home|corp|intranet)$/.test(host);
    if (internal) return { ok: false, message: 'آدرس‌های داخلی و شبکهٔ خصوصی مجاز نیستند' };
  } else if (u.protocol === 'http:' && !local) {
    return { ok: false, message: 'آدرس باید با https شروع شود (http فقط برای localhost مجاز است)' };
  }
  return { ok: true, url: u.toString() };
}

async function assertPublicDns(url: string) {
  const host = bareHost(new URL(url).hostname);
  if (net.isIP(host)) return;
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('آدرس به شبکهٔ داخلی اشاره می‌کند و مسدود شد');
}

// ------------------------------------------------------------- secrets

export interface SigningSecrets { active: string; previous: string | null; previousUntil: number | null; custom: boolean }

/** Current secret (random per-store after the first rotation, otherwise the derived one) and the previous one while its 24 h grace lasts. */
export function webhookSecrets(merchantId: string): SigningSecrets {
  const m = db().prepare('SELECT webhook_secret, webhook_secret_prev, webhook_secret_prev_until FROM merchants WHERE id = ?').get(merchantId) as any;
  const until = Number(m?.webhook_secret_prev_until || 0);
  const prevValid = !!m?.webhook_secret_prev && until > Date.now();
  return {
    active: m?.webhook_secret || merchantWebhookSecret(merchantId),
    previous: prevValid ? m.webhook_secret_prev : null,
    previousUntil: prevValid ? until : null,
    custom: !!m?.webhook_secret,
  };
}

/** New random secret; the one in use until now stays valid (and is sent as a second signature) for 24 h. */
export function rotateWebhookSecret(merchantId: string): { secret: string; previousUntil: number } {
  const old = webhookSecrets(merchantId).active;
  const secret = CryptoUtil.generateSecret('whsec');
  const until = Date.now() + SECRET_GRACE_MS;
  db().prepare('UPDATE merchants SET webhook_secret = ?, webhook_secret_prev = ?, webhook_secret_prev_until = ? WHERE id = ?').run(secret, old, until, merchantId);
  return { secret, previousUntil: until };
}

export const signHeader = (secrets: string[], body: string, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},` + secrets.map((s) => `v1=${crypto.createHmac('sha256', s).update(`${t}.${body}`).digest('hex')}`).join(',');

// ------------------------------------------------------------- delivery

interface AttemptInput {
  deliveryId: string;
  merchantId: string;
  invoiceId: string;
  event: string;
  url: string;
  body: string;
  attempt: number;
  maxAttempts: number;
  kind: 'store' | 'invoice' | 'test' | 'resend';
  secrets?: string[];
}
export interface AttemptResult { rowId: string; success: boolean; status?: number; error?: string; nextRetryAt: number | null; durationMs: number }

async function runAttempt(a: AttemptInput): Promise<AttemptResult> {
  const sec = webhookSecrets(a.merchantId);
  const secrets = a.secrets || [sec.active, ...(sec.previous ? [sec.previous] : [])];
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Bolgram-Webhooks/1.0',
    'X-Bolgram-Signature': signHeader(secrets, a.body),
    'X-Bolgram-Delivery': a.deliveryId,
    'X-Bolgram-Invoice-Id': a.invoiceId,
    'X-Bolgram-Event': a.event,
    // Legacy (upstream-compatible) signature over the body only
  };
  const started = Date.now();
  let status: number | undefined;
  let responseBody = '';
  let error: string | undefined;
  let permanent = false;
  const check = validateWebhookUrl(a.url);
  if (!check.ok) {
    error = check.message;
    permanent = true;
  } else {
    try {
      if (isProd()) await assertPublicDns(a.url);
      const res = await fetch(a.url, { method: 'POST', headers, body: a.body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
      status = res.status;
      responseBody = (await res.text().catch(() => '')).slice(0, 2000);
      if (res.status >= 300 && res.status < 400) error = 'ریدایرکت پشتیبانی نمی‌شود؛ آدرس نهایی را ثبت کنید';
      else if (!res.ok) error = `پاسخ ${res.status} از سرور شما`;
    } catch (e: any) {
      error = e?.name === 'TimeoutError' ? 'پاسخی در ۸ ثانیه نرسید' : String(e?.cause?.code || e?.message || e);
    }
  }
  const success = !error;
  const nextRetryAt = !success && !permanent && a.attempt < a.maxAttempts ? Date.now() + RETRY_DELAYS_S[Math.min(a.attempt - 1, RETRY_DELAYS_S.length - 1)] * 1000 : null;
  const rowId = 'wd_' + crypto.randomBytes(8).toString('hex');
  const durationMs = Date.now() - started;
  db()
    .prepare(`INSERT INTO webhook_deliveries (id, delivery_id, merchant_id, event, invoice_id, url, kind, request_body, request_headers, status, http_status, duration_ms, attempt, max_attempts, response_body, error, next_retry_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(rowId, a.deliveryId, a.merchantId, a.event, a.invoiceId, a.url, a.kind, a.body, JSON.stringify(headers), success ? 'DELIVERED' : 'FAILED', status ?? null, durationMs, a.attempt, a.maxAttempts, responseBody || null, error || null, nextRetryAt, Date.now());
  if (!success) console.warn(`[webhook] attempt ${a.attempt}/${a.maxAttempts} failed ${a.url} (${a.invoiceId}): ${error}`);
  return { rowId, success, status, error, nextRetryAt, durationMs };
}

export class WebhookService {
  /** Sends the first attempt now; failures are queued for persistent retries. */
  public static async dispatch(params: {
    merchantId: string;
    invoiceId: string;
    webhookUrl: string;
    webhookSecret?: string;
    payload: WebhookPayload;
    event?: string;
    kind?: 'store' | 'invoice' | 'test' | 'resend';
    maxRetries?: number;
  }): Promise<{ success: boolean; status?: number; signature: string; attempts: number; error?: string; deliveryId: string; rowId: string }> {
    const event = params.event || params.payload.event || 'invoice.paid';
    const payload: WebhookPayload = { event, ...params.payload };
    if (payload.metadata === undefined && params.invoiceId) {
      try {
        const r = db().prepare('SELECT metadata FROM invoices WHERE id = ? AND merchant_id = ?').get(params.invoiceId, params.merchantId) as any;
        if (r?.metadata) payload.metadata = JSON.parse(r.metadata);
      } catch { /* metadata is optional */ }
    }
    const body = JSON.stringify(payload);
    const deliveryId = crypto.randomUUID();
    const secrets = params.webhookSecret ? [params.webhookSecret] : undefined;
    const r = await runAttempt({
      deliveryId, merchantId: params.merchantId, invoiceId: params.invoiceId, event, url: params.webhookUrl, body,
      attempt: 1, maxAttempts: params.maxRetries ?? MAX_ATTEMPTS, kind: params.kind || 'invoice', secrets,
    });
    return {
      success: r.success, status: r.status, error: r.error, attempts: 1, deliveryId, rowId: r.rowId,
      signature: CryptoUtil.signWebhook(body, params.webhookSecret || webhookSecrets(params.merchantId).active),
    };
  }

  /** Replays a stored request body as a new delivery (manual resend). */
  public static async resend(merchantId: string, rowId: string) {
    const row = db().prepare('SELECT * FROM webhook_deliveries WHERE id = ? AND merchant_id = ?').get(rowId, merchantId) as any;
    if (!row) return null;
    const m = db().prepare('SELECT webhook_url FROM merchants WHERE id = ?').get(merchantId) as any;
    const url = row.kind === 'store' && m?.webhook_url ? m.webhook_url : row.url;
    const deliveryId = crypto.randomUUID();
    const r = await runAttempt({ deliveryId, merchantId, invoiceId: row.invoice_id || '', event: row.event, url, body: row.request_body, attempt: 1, maxAttempts: MAX_ATTEMPTS, kind: 'resend' });
    return { deliveryId, ...r };
  }
}

/** Runs due retries once; returns how many attempts were made. */
export async function processDueRetries(now = Date.now()): Promise<number> {
  const due = db().prepare('SELECT * FROM webhook_deliveries WHERE next_retry_at IS NOT NULL AND next_retry_at <= ? ORDER BY next_retry_at LIMIT 20').all(now) as any[];
  let n = 0;
  for (const row of due) {
    // lease: another worker (or a crash) re-queues it after 5 minutes at the latest
    const claim = db().prepare('UPDATE webhook_deliveries SET next_retry_at = ? WHERE id = ? AND next_retry_at = ?').run(now + 300_000, row.id, row.next_retry_at);
    if (Number(claim.changes) !== 1) continue;
    const m = db().prepare('SELECT webhook_url FROM merchants WHERE id = ?').get(row.merchant_id) as any;
    const url = row.kind === 'store' && m?.webhook_url ? m.webhook_url : row.url;
    try {
      await runAttempt({ deliveryId: row.delivery_id, merchantId: row.merchant_id, invoiceId: row.invoice_id || '', event: row.event, url, body: row.request_body, attempt: Number(row.attempt) + 1, maxAttempts: Number(row.max_attempts), kind: row.kind });
      n++;
    } finally {
      db().prepare('UPDATE webhook_deliveries SET next_retry_at = NULL WHERE id = ?').run(row.id);
    }
  }
  return n;
}

let worker: NodeJS.Timeout | null = null;
export function startWebhookWorker() {
  if (worker) return;
  worker = setInterval(() => processDueRetries().catch((e) => console.error('[webhook] retry worker:', e)), 30_000);
  worker.unref();
  setTimeout(() => processDueRetries().catch(() => {}), 5000).unref();
}

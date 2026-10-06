import type { FastifyInstance, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { db, fail, merchantOf, actorOf, paging, isoOf, str } from './_kit.js';
import { audit, requirePerm } from '../../services/access.js';
import { events } from '../../services/events.js';
import { CryptoUtil } from '../../utils/crypto.js';
import { normalizeEmail, normalizeMobile, passwordProblem, toLatinDigits } from '../../utils/validate.js';
import { saveDataUrl, UploadError } from '../../utils/uploads.js';
import { sendOtp, verifyOtp, OtpError } from '../../services/otp.service.js';
import {
  WebhookService, ensureWebhookSchema, processDueRetries, rotateWebhookSecret, startWebhookWorker, validateWebhookUrl, webhookSecrets,
  MAX_ATTEMPTS, RETRY_DELAYS_S,
} from '../../services/webhook.service.js';
import { createIntegrationKey, ensureApiKeySchema, listIntegrationKeys, MAX_ACTIVE_KEYS, revokeIntegrationKey } from '../../services/merchant.service.js';

/** Feature plugin "integrations": webhooks, API keys, plugins, store settings, checkout brand (see docs/dev/PANEL_CONVENTIONS.md). */

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../integrations/woocommerce/bolgram-gateway');
export const WOO_VERSION = '1.0.0';
export const WEBHOOK_EVENTS = ['invoice.paid', 'ping'];

export function ensureIntegrationsSchema() {
  ensureWebhookSchema();
  ensureApiKeySchema();
  db().exec(`CREATE TABLE IF NOT EXISTS integration_paid_log (invoice_id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, paid_at INTEGER NOT NULL)`);
  db().exec(`CREATE TABLE IF NOT EXISTS api_usage_daily (merchant_id TEXT NOT NULL, day TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (merchant_id, day))`);
}

const isoMs = (v: unknown) => (v ? new Date(Number(v)).toISOString() : null);
const httpUrl = (v: unknown) => { try { const u = new URL(String(v)); return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null; } catch { return null; } };

export function serverUrl(req: FastifyRequest): string {
  const env = process.env.PUBLIC_BASE_URL;
  if (env) return env.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || req.protocol || 'http';
  return `${proto}://${req.headers.host || 'localhost:4000'}`;
}

// ------------------------------------------------------------- zip (stored method)

export function buildZip(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = zlib.crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18); local.writeUInt32LE(f.data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, f.data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE((3 << 8) | 20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(f.data.length, 20); c.writeUInt32LE(f.data.length, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE((0o100644 << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + f.data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

function pluginFiles(base: string): { name: string; data: Buffer }[] {
  const out: { name: string; data: Buffer }[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, `${rel}${e.name}/`);
      else if (e.isFile()) {
        let data = fs.readFileSync(p);
        if (/\.(php|txt|md|js|css)$/.test(e.name)) data = Buffer.from(data.toString('utf8').replaceAll('__BOLGRAM_SERVER_URL__', base), 'utf8');
        out.push({ name: `bolgram-gateway/${rel}${e.name}`, data });
      }
    }
  };
  walk(PLUGIN_DIR, '');
  return out;
}

// ------------------------------------------------------------- helpers

const secretMask = (s: string) => `${s.slice(0, 6)}${'•'.repeat(12)}${s.slice(-4)}`;
const SUMMARY = (r: any) => ({
  id: r.id,
  delivery_id: r.delivery_id,
  event: r.event,
  invoice_id: r.invoice_id || null,
  url: r.url,
  kind: r.kind,
  status: r.status === 'DELIVERED' ? 'delivered' : r.next_retry_at ? 'retrying' : 'failed',
  http_status: r.http_status ?? null,
  duration_ms: r.duration_ms ?? null,
  attempt: Number(r.attempt),
  max_attempts: Number(r.max_attempts),
  error: r.error || null,
  next_retry_at: isoMs(r.next_retry_at),
  created_at: isoMs(r.created_at),
});
const DETAIL = (r: any) => ({
  ...SUMMARY(r),
  request_body: r.request_body,
  request_headers: (() => { try { return JSON.parse(r.request_headers || '{}'); } catch { return {}; } })(),
  response_body: r.response_body || null,
});

const pwFails = new Map<string, { n: number; until: number }>();
function pwLocked(key: string) {
  const f = pwFails.get(key);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
function pwFail(key: string) {
  const f = pwFails.get(key) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 5) { f.until = Date.now() + 10 * 60_000; f.n = 0; }
  pwFails.set(key, f);
}

let wired = false;

export default async function integrationsRoutes(app: FastifyInstance) {
  ensureIntegrationsSchema();

  if (!wired) {
    wired = true;
    startWebhookWorker();
    events.on('invoice.paid', async ({ merchantId, invoiceId, amount, provider, trxId }) => {
      db().prepare('INSERT OR IGNORE INTO integration_paid_log (invoice_id, merchant_id, paid_at) VALUES (?, ?, ?)').run(invoiceId, merchantId, Date.now());
      // Invoices that carry their own webhook_url are delivered by the payment services; everything else goes to the store URL.
      const inv = db().prepare('SELECT webhook_url FROM invoices WHERE id = ?').get(invoiceId) as any;
      if (inv?.webhook_url) return;
      const m = db().prepare('SELECT webhook_url FROM merchants WHERE id = ?').get(merchantId) as any;
      if (!m?.webhook_url) return;
      await WebhookService.dispatch({
        merchantId, invoiceId, webhookUrl: m.webhook_url, kind: 'store', event: 'invoice.paid',
        payload: { invoice_id: invoiceId, status: 'true', provider: String(provider || '').toLowerCase(), trx_id: trxId, amount, timestamp: new Date().toISOString() },
      });
    });
  }

  // ============================================================= webhooks

  const perm = requirePerm('webhooks:manage');

  app.get('/api/v2/webhooks/settings', { preHandler: perm }, async (req) => {
    const m = merchantOf(req);
    const s = webhookSecrets(m.id);
    const since = Date.now() - 86400_000;
    const count = (where: string) => Number((db().prepare(`SELECT count(*) c FROM webhook_deliveries WHERE merchant_id = ? AND ${where}`).get(m.id, since) as any).c);
    return {
      success: true,
      webhook_url: m.webhook_url || '',
      secret: { masked: secretMask(s.active), kind: s.custom ? 'custom' : 'derived', previous_valid_until: isoMs(s.previousUntil) },
      events: WEBHOOK_EVENTS,
      retry_policy: { max_attempts: MAX_ATTEMPTS, delays_seconds: RETRY_DELAYS_S },
      stats: {
        delivered_24h: count(`status = 'DELIVERED' AND created_at > ?`),
        failed_24h: count(`status = 'FAILED' AND created_at > ?`),
        pending_retries: Number((db().prepare('SELECT count(*) c FROM webhook_deliveries WHERE merchant_id = ? AND next_retry_at IS NOT NULL').get(m.id) as any).c),
      },
    };
  });

  app.put('/api/v2/webhooks/settings', { preHandler: perm }, async (req, reply) => {
    const m = merchantOf(req);
    const raw = str(((req.body || {}) as any).webhook_url, 500);
    if (raw) {
      const v = validateWebhookUrl(raw);
      if (!v.ok) return fail(reply, 422, 'validation', v.message, { webhook_url: v.message });
      db().prepare('UPDATE merchants SET webhook_url = ? WHERE id = ?').run(v.url, m.id);
      audit(req, m.id, 'webhook.url_set', undefined, { url: v.url });
      return { success: true, webhook_url: v.url };
    }
    db().prepare('UPDATE merchants SET webhook_url = NULL WHERE id = ?').run(m.id);
    audit(req, m.id, 'webhook.url_cleared');
    return { success: true, webhook_url: '' };
  });

  app.get('/api/v2/webhooks/secret', { preHandler: perm }, async (req) => {
    const m = merchantOf(req);
    const s = webhookSecrets(m.id);
    audit(req, m.id, 'webhook.secret_revealed');
    return { success: true, secret: s.active, previous_secret: s.previous, previous_valid_until: isoMs(s.previousUntil) };
  });

  app.post('/api/v2/webhooks/rotate-secret', { preHandler: perm }, async (req) => {
    const m = merchantOf(req);
    const r = rotateWebhookSecret(m.id);
    audit(req, m.id, 'webhook.secret_rotated');
    return { success: true, secret: r.secret, previous_valid_until: isoMs(r.previousUntil) };
  });

  app.post('/api/v2/webhooks/test', { preHandler: perm, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const m = db().prepare('SELECT * FROM merchants WHERE id = ?').get(merchantOf(req).id) as any;
    if (!m.webhook_url) return fail(reply, 422, 'no_webhook_url', 'ابتدا آدرس وب‌هوک را ذخیره کنید');
    const r = await WebhookService.dispatch({
      merchantId: m.id, invoiceId: 'INV_TEST', webhookUrl: m.webhook_url, kind: 'test', event: 'ping', maxRetries: 1,
      // status "false": a receiver that only checks the flag must never treat a ping as a payment
      payload: { event: 'ping', invoice_id: 'INV_TEST', status: 'false', provider: 'test', trx_id: 'TEST0000', amount: 100000, timestamp: new Date().toISOString(), test: true },
    });
    const row = db().prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(r.rowId);
    return { success: true, ok: r.success, delivery: DETAIL(row) };
  });

  app.get('/api/v2/webhooks/deliveries', { preHandler: perm }, async (req) => {
    const m = merchantOf(req);
    const q = req.query as any;
    const p = paging(q);
    const where = ['merchant_id = ?'];
    if (q.status === 'delivered') where.push(`status = 'DELIVERED'`);
    else if (q.status === 'failed') where.push(`status = 'FAILED'`);
    else if (q.status === 'pending') where.push(`next_retry_at IS NOT NULL`);
    const w = where.join(' AND ');
    const total = Number((db().prepare(`SELECT count(*) c FROM webhook_deliveries WHERE ${w}`).get(m.id) as any).c);
    const rows = db().prepare(`SELECT * FROM webhook_deliveries WHERE ${w} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(m.id, p.limit, p.offset) as any[];
    return { success: true, data: rows.map(SUMMARY), page: p.page, per_page: p.perPage, total };
  });

  app.get('/api/v2/webhooks/deliveries/:id', { preHandler: perm }, async (req, reply) => {
    const m = merchantOf(req);
    const row = db().prepare('SELECT * FROM webhook_deliveries WHERE id = ? AND merchant_id = ?').get(String((req.params as any).id), m.id) as any;
    if (!row) return fail(reply, 404, 'not_found', 'ارسال پیدا نشد');
    const attempts = db().prepare('SELECT * FROM webhook_deliveries WHERE delivery_id = ? AND merchant_id = ? ORDER BY attempt').all(row.delivery_id, m.id) as any[];
    return { success: true, delivery: DETAIL(row), attempts: attempts.map(SUMMARY) };
  });

  app.post('/api/v2/webhooks/deliveries/:id/resend', { preHandler: perm, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const m = merchantOf(req);
    const r = await WebhookService.resend(m.id, String((req.params as any).id));
    if (!r) return fail(reply, 404, 'not_found', 'ارسال پیدا نشد');
    audit(req, m.id, 'webhook.resent', String((req.params as any).id));
    const row = db().prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(r.rowId);
    return { success: true, ok: r.success, delivery: DETAIL(row) };
  });

  // ============================================================= API keys

  const keyPerm = requirePerm('api:manage');
  const legacyOf = (m: any) => {
    const k = String(m.api_key || '');
    if (!k || k.startsWith('revoked_')) return null;
    return { name: 'کلید قدیمی', prefix: k.slice(0, 8), masked: `${k.slice(0, 8)}${'•'.repeat(12)}`, last_used_at: isoMs(m.api_key_last_used) };
  };

  app.get('/api/v2/api-keys', { preHandler: keyPerm }, async (req) => {
    const m = db().prepare('SELECT * FROM merchants WHERE id = ?').get(merchantOf(req).id) as any;
    const data = listIntegrationKeys(m.id).map((k) => ({ ...k, created_at: isoMs(k.created_at), last_used_at: isoMs(k.last_used_at), revoked_at: isoMs(k.revoked_at) }));
    return { success: true, data, legacy: legacyOf(m), max_active: MAX_ACTIVE_KEYS, server_url: serverUrl(req) };
  });

  app.post('/api/v2/api-keys', { preHandler: keyPerm }, async (req, reply) => {
    const m = merchantOf(req);
    const b = (req.body || {}) as any;
    const name = str(b.name, 40);
    const env = b.environment === 'test' ? 'test' : 'live';
    if (name.length < 2) return fail(reply, 422, 'validation', 'نام کلید را بنویسید (حداقل ۲ حرف)', { name: 'نام کلید را بنویسید (حداقل ۲ حرف)' });
    const active = listIntegrationKeys(m.id).filter((k) => k.status === 'active').length;
    if (active >= MAX_ACTIVE_KEYS) return fail(reply, 409, 'key_limit', `حداکثر ${MAX_ACTIVE_KEYS} کلید فعال مجاز است؛ کلیدهای بلااستفاده را باطل کنید`);
    const { row, secret } = createIntegrationKey(m.id, name, env, actorOf(req).id);
    audit(req, m.id, 'apikey.created', row.id, { name, env });
    reply.status(201);
    return { success: true, key: { ...row, created_at: isoMs(row.created_at) }, secret };
  });

  app.delete('/api/v2/api-keys/:id', { preHandler: keyPerm }, async (req, reply) => {
    const m = merchantOf(req);
    const id = String((req.params as any).id);
    if (id === 'legacy') return fail(reply, 404, 'not_found', 'کلید پیدا نشد');
    if (!revokeIntegrationKey(m.id, id)) return fail(reply, 404, 'not_found', 'کلید پیدا نشد یا قبلاً باطل شده است');
    audit(req, m.id, 'apikey.revoked', id);
    return { success: true };
  });

  app.get('/api/v2/api-keys/legacy/reveal', { preHandler: keyPerm }, async (req, reply) => {
    const m = db().prepare('SELECT api_key FROM merchants WHERE id = ?').get(merchantOf(req).id) as any;
    if (!legacyOf(m)) return fail(reply, 404, 'not_found', 'کلید قدیمی وجود ندارد');
    audit(req, merchantOf(req).id, 'apikey.legacy_revealed');
    return { success: true, key: m.api_key };
  });

  app.post('/api/v2/api-keys/legacy/rotate', { preHandler: keyPerm }, async (req) => {
    const m = merchantOf(req);
    const key = `live_sk_${crypto.randomBytes(24).toString('hex')}`;
    db().prepare('UPDATE merchants SET api_key = ?, api_key_last_used = NULL WHERE id = ?').run(key, m.id);
    audit(req, m.id, 'apikey.legacy_rotated');
    return { success: true, key };
  });

  app.delete('/api/v2/api-keys/legacy', { preHandler: keyPerm }, async (req) => {
    const m = merchantOf(req);
    db().prepare('UPDATE merchants SET api_key = ? WHERE id = ?').run(`revoked_${crypto.randomBytes(16).toString('hex')}`, m.id);
    audit(req, m.id, 'apikey.legacy_revoked');
    return { success: true };
  });

  // ============================================================= plugins

  app.get('/api/v2/plugins/woocommerce.zip', { preHandler: keyPerm }, async (req, reply) => {
    if (!fs.existsSync(PLUGIN_DIR)) return fail(reply, 404, 'not_found', 'فایل افزونه روی سرور موجود نیست');
    const zip = buildZip(pluginFiles(serverUrl(req)));
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="bolgram-gateway-${WOO_VERSION}.zip"`)
      .header('Cache-Control', 'no-store')
      .send(zip);
  });

  // ============================================================= settings

  const profileOf = (m: any) => ({
    name: m.name || '',
    handle: m.handle || '',
    logo_url: m.brand_logo_url || null,
    support_phone: m.support_phone || '',
    support_telegram: m.support_telegram || '',
    support_instagram: m.support_instagram || '',
    website: m.website || '',
    mobile: m.phone || null,
    mobile_verified: !!m.mobile_verified,
    email: m.email || null,
    created_at: isoOf(m.created_at),
  });
  const fresh = (id: string) => db().prepare('SELECT * FROM merchants WHERE id = ?').get(id) as any;
  const settingsPerm = requirePerm('settings:manage');

  app.get('/api/v2/settings/profile', async (req) => {
    const a = actorOf(req);
    return { success: true, profile: profileOf(fresh(merchantOf(req).id)), actor: { kind: a.kind, name: a.name, role: a.role }, can_manage: a.perms.includes('settings:manage') };
  });

  app.put('/api/v2/settings/profile', { preHandler: settingsPerm, bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const m = merchantOf(req);
    const b = (req.body || {}) as any;
    const errors: Record<string, string> = {};
    const set: Record<string, string | null> = {};
    if (b.name !== undefined) {
      const name = str(b.name, 60);
      if (name.length < 2) errors.name = 'نام فروشگاه حداقل ۲ حرف باشد';
      else set.name = name;
    }
    if (b.support_phone !== undefined) {
      const raw = toLatinDigits(String(b.support_phone ?? '')).replace(/[\s\-()]/g, '');
      if (!raw) set.support_phone = null;
      else if (normalizeMobile(raw)) set.support_phone = normalizeMobile(raw);
      else if (/^0\d{9,11}$/.test(raw)) set.support_phone = raw;
      else errors.support_phone = 'شمارهٔ تماس معتبر نیست (مثل ۰۹۱۲… یا ۰۲۱…)';
    }
    if (b.support_telegram !== undefined) {
      const raw = str(b.support_telegram, 80).replace(/^(https?:\/\/)?(t\.me|telegram\.me)\//i, '').replace(/^@/, '');
      if (!raw) set.support_telegram = null;
      else if (/^[A-Za-z0-9_]{4,32}$/.test(raw)) set.support_telegram = raw;
      else errors.support_telegram = 'شناسهٔ تلگرام معتبر نیست (فقط حروف انگلیسی، عدد و _)';
    }
    if (b.support_instagram !== undefined) {
      const raw = str(b.support_instagram, 80).replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '').replace(/[/?].*$/, '').replace(/^@/, '');
      if (!raw) set.support_instagram = null;
      else if (/^[A-Za-z0-9._]{1,30}$/.test(raw)) set.support_instagram = raw;
      else errors.support_instagram = 'شناسهٔ اینستاگرام معتبر نیست';
    }
    if (b.website !== undefined) {
      const raw = str(b.website, 200);
      if (!raw) set.website = null;
      else {
        const u = httpUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        if (u && u.length <= 200 && new URL(u).hostname.includes('.')) set.website = u;
        else errors.website = 'آدرس وب‌سایت معتبر نیست';
      }
    }
    if (b.remove_logo === true) set.brand_logo_url = null;
    else if (b.logo_data_url !== undefined && b.logo_data_url !== null && b.logo_data_url !== '') {
      try {
        set.brand_logo_url = saveDataUrl(b.logo_data_url, { visibility: 'public', maxBytes: 1024 * 1024, allow: ['image/png', 'image/jpeg', 'image/webp'] }).url;
      } catch (e) {
        if (!(e instanceof UploadError)) throw e;
        errors.logo = e.message;
      }
    }
    if (Object.keys(errors).length) return fail(reply, 422, 'validation', Object.values(errors)[0], errors);
    const keys = Object.keys(set);
    if (keys.length) {
      db().prepare(`UPDATE merchants SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => set[k]), m.id);
      audit(req, m.id, 'settings.profile_updated', undefined, { fields: keys });
    }
    return { success: true, profile: profileOf(fresh(m.id)) };
  });

  async function newToken(m: any, remember: boolean, staff?: any) {
    const { issueToken } = await import('../v2.routes.js');
    return issueToken(m, remember, staff);
  }
  const staffRow = (req: FastifyRequest) => {
    const a = actorOf(req);
    return a.kind === 'staff' ? (db().prepare('SELECT * FROM team_members WHERE id = ? AND merchant_id = ?').get(a.id, merchantOf(req).id) as any) : null;
  };

  app.post('/api/v2/settings/password', async (req, reply) => {
    const m = fresh(merchantOf(req).id);
    const b = (req.body || {}) as any;
    const staff = staffRow(req);
    const key = `${m.id}:${actorOf(req).id}`;
    const wait = pwLocked(key);
    if (wait) return reply.status(429).send({ success: false, error: 'locked', message: 'تلاش‌های ناموفق زیاد بود؛ کمی بعد دوباره امتحان کنید', retry_after: wait });
    const hash = staff ? staff.password_hash : m.password_hash;
    const current = typeof b.current_password === 'string' ? b.current_password : '';
    if (!hash || !current || !CryptoUtil.verifyPassword(current, hash)) {
      pwFail(key);
      return fail(reply, 422, 'wrong_password', 'رمز فعلی درست نیست', { current_password: 'رمز فعلی درست نیست' });
    }
    const problem = passwordProblem(b.new_password, { mobile: staff?.mobile || m.phone, handle: m.handle });
    if (problem) return fail(reply, 422, 'validation', problem, { new_password: problem });
    if (b.new_password === current) return fail(reply, 422, 'validation', 'رمز جدید با رمز فعلی یکی است', { new_password: 'رمز جدید با رمز فعلی یکی است' });
    pwFails.delete(key);
    const newHash = CryptoUtil.hashPassword(b.new_password);
    let token: string;
    if (staff) {
      db().prepare('UPDATE team_members SET password_hash = ?, token_version = coalesce(token_version, 0) + 1 WHERE id = ?').run(newHash, staff.id);
      token = await newToken(m, b.remember === true, db().prepare('SELECT * FROM team_members WHERE id = ?').get(staff.id));
    } else {
      db().prepare('UPDATE merchants SET password_hash = ?, token_version = coalesce(token_version, 0) + 1 WHERE id = ?').run(newHash, m.id);
      token = await newToken(fresh(m.id), b.remember === true);
    }
    audit(req, m.id, 'settings.password_changed');
    return { success: true, token, message: 'رمز تغییر کرد و از بقیهٔ دستگاه‌ها خارج شدید' };
  });

  app.post('/api/v2/settings/logout-all', async (req) => {
    const m = fresh(merchantOf(req).id);
    const b = (req.body || {}) as any;
    const staff = staffRow(req);
    let token: string;
    if (staff) {
      db().prepare('UPDATE team_members SET token_version = coalesce(token_version, 0) + 1 WHERE id = ?').run(staff.id);
      token = await newToken(m, b.remember === true, db().prepare('SELECT * FROM team_members WHERE id = ?').get(staff.id));
    } else {
      db().prepare('UPDATE merchants SET token_version = coalesce(token_version, 0) + 1 WHERE id = ?').run(m.id);
      token = await newToken(fresh(m.id), b.remember === true);
    }
    audit(req, m.id, 'settings.logout_all');
    return { success: true, token };
  });

  app.post('/api/v2/settings/mobile/send', { preHandler: settingsPerm }, async (req, reply) => {
    const m = merchantOf(req);
    const mobile = normalizeMobile(((req.body || {}) as any).mobile);
    if (!mobile) return fail(reply, 422, 'validation', 'شمارهٔ موبایل معتبر نیست', { mobile: 'شمارهٔ موبایل معتبر نیست' });
    if (mobile === m.phone) return fail(reply, 422, 'validation', 'این شماره همین حالا شمارهٔ حساب شماست', { mobile: 'این شماره همین حالا شمارهٔ حساب شماست' });
    if (db().prepare('SELECT 1 FROM merchants WHERE phone = ? AND id != ?').get(mobile, m.id)) return fail(reply, 409, 'mobile_taken', 'این شماره برای حساب دیگری ثبت شده است', { mobile: 'این شماره برای حساب دیگری ثبت شده است' });
    try {
      const r = await sendOtp(mobile, 'change_mobile');
      return { success: true, resend_in: r.resendIn, dev_code: r.devCode };
    } catch (e) {
      if (e instanceof OtpError) return reply.status(e.code === 'otp_wait' || e.code === 'otp_limit' ? 429 : 503).send({ success: false, error: e.code, message: e.message, retry_after: e.retryAfter });
      throw e;
    }
  });

  app.post('/api/v2/settings/mobile/verify', { preHandler: settingsPerm }, async (req, reply) => {
    const m = merchantOf(req);
    const b = (req.body || {}) as any;
    const mobile = normalizeMobile(b.mobile);
    const code = toLatinDigits(String(b.code ?? '')).trim();
    if (!mobile || !/^\d{5}$/.test(code)) return fail(reply, 422, 'validation', 'شماره و کد پنج‌رقمی را وارد کنید', { code: 'کد پنج‌رقمی را وارد کنید' });
    try {
      if (!verifyOtp(mobile, 'change_mobile', code)) return fail(reply, 400, 'otp_invalid', 'کد درست نیست', { code: 'کد درست نیست' });
    } catch (e) {
      if (e instanceof OtpError) return fail(reply, 400, e.code, e.message, { code: e.message });
      throw e;
    }
    if (db().prepare('SELECT 1 FROM merchants WHERE phone = ? AND id != ?').get(mobile, m.id)) return fail(reply, 409, 'mobile_taken', 'این شماره برای حساب دیگری ثبت شده است');
    db().prepare('UPDATE merchants SET phone = ?, mobile_verified = 1 WHERE id = ?').run(mobile, m.id);
    audit(req, m.id, 'settings.mobile_changed', undefined, { from: m.phone, to: mobile });
    return { success: true, profile: profileOf(fresh(m.id)) };
  });

  app.put('/api/v2/settings/email', { preHandler: settingsPerm }, async (req, reply) => {
    const m = fresh(merchantOf(req).id);
    const b = (req.body || {}) as any;
    const key = `${m.id}:email`;
    if (pwLocked(key)) return fail(reply, 429, 'locked', 'تلاش‌های ناموفق زیاد بود؛ کمی بعد دوباره امتحان کنید');
    if (!m.password_hash || typeof b.password !== 'string' || !CryptoUtil.verifyPassword(b.password, m.password_hash)) {
      pwFail(key);
      return fail(reply, 422, 'wrong_password', 'رمز عبور درست نیست', { password: 'رمز عبور درست نیست' });
    }
    if (b.email === '' || b.email === null) {
      db().prepare('UPDATE merchants SET email = NULL WHERE id = ?').run(m.id);
    } else {
      const email = normalizeEmail(b.email);
      if (!email) return fail(reply, 422, 'validation', 'ایمیل معتبر نیست', { email: 'ایمیل معتبر نیست' });
      if (db().prepare('SELECT 1 FROM merchants WHERE lower(email) = ? AND id != ?').get(email, m.id)) return fail(reply, 409, 'email_taken', 'این ایمیل برای حساب دیگری ثبت شده است', { email: 'این ایمیل برای حساب دیگری ثبت شده است' });
      db().prepare('UPDATE merchants SET email = ? WHERE id = ?').run(email, m.id);
    }
    pwFails.delete(key);
    audit(req, m.id, 'settings.email_changed');
    return { success: true, profile: profileOf(fresh(m.id)) };
  });

  app.get('/api/v2/settings/export', { preHandler: settingsPerm, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const m = fresh(merchantOf(req).id);
    const all = (sql: string, ...args: any[]) => db().prepare(sql).all(...args) as any[];
    const data = {
      exported_at: new Date().toISOString(),
      service: 'بولگرام',
      store: { ...profileOf(m), id: m.id, plan: m.plan || 'FREE', webhook_url: m.webhook_url || null },
      cards: all('SELECT id, title, provider_type AS bank, account_name AS holder, last4, is_active FROM payment_methods WHERE merchant_id = ?', m.id),
      invoices: all('SELECT id, expected_amount AS amount_rial, status, trx_id, payment_method, channel, note, customer_name, metadata, created_at, expires_at FROM invoices WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 20000', m.id),
      transactions: all('SELECT provider, trx_id, amount AS amount_rial, sender, is_verified, order_id, created_at FROM transactions WHERE merchant_id = ? ORDER BY id DESC LIMIT 20000', m.id),
      devices: all('SELECT id, device_name, device_model, status, last_seen FROM devices WHERE merchant_id = ?', m.id),
      team: all('SELECT id, name, mobile, email, role, status FROM team_members WHERE merchant_id = ?', m.id),
      api_keys: listIntegrationKeys(m.id).map((k) => ({ name: k.name, environment: k.environment, prefix: k.prefix, status: k.status, created_at: isoMs(k.created_at), last_used_at: isoMs(k.last_used_at) })),
    };
    audit(req, m.id, 'settings.exported');
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="bolgram-export-${m.handle || m.id}.json"`)
      .send(JSON.stringify(data, null, 2));
  });

  // ============================================================= public: checkout brand

  app.get('/api/pub/checkout/:invoiceId/brand', { config: { rateLimit: { max: 90, timeWindow: '1 minute' } } }, async (req, reply) => {
    const id = String((req.params as any).invoiceId || '').slice(0, 64);
    const inv = db().prepare('SELECT id, merchant_id, expected_amount, status, trx_id, expires_at, redirect_url, cancel_url, created_at FROM invoices WHERE id = ?').get(id) as any;
    if (!inv) return reply.status(404).send({ success: false, error: 'not_found', message: 'فاکتور پیدا نشد' });
    const m = db().prepare('SELECT name, handle, brand_logo_url, support_phone, support_telegram, support_instagram, website FROM merchants WHERE id = ?').get(inv.merchant_id) as any;
    let status = String(inv.status);
    const exp = new Date(inv.expires_at).getTime();
    if (status === 'PENDING' && exp && exp < Date.now()) status = 'EXPIRED';
    let paidAt: string | null = null;
    if (status === 'PAID') {
      const log = db().prepare('SELECT paid_at FROM integration_paid_log WHERE invoice_id = ?').get(inv.id) as any;
      const tx = (db().prepare('SELECT coalesce(verified_at, created_at) AS t FROM transactions WHERE merchant_id = ? AND (order_id = ? OR trx_id = ?) ORDER BY id DESC LIMIT 1').get(inv.merchant_id, inv.id, inv.trx_id || '') as any)?.t;
      paidAt = log ? new Date(Number(log.paid_at)).toISOString() : isoOf(tx);
    }
    const logo = m?.brand_logo_url && (String(m.brand_logo_url).startsWith('/uploads/') || String(m.brand_logo_url).startsWith('https://')) ? m.brand_logo_url : null;
    reply.header('Cache-Control', 'no-store');
    return {
      success: true,
      store: {
        name: m?.name || 'فروشگاه',
        handle: m?.handle || null,
        logo_url: logo,
        support_phone: m?.support_phone || null,
        support_telegram: m?.support_telegram || null,
        support_instagram: m?.support_instagram || null,
        website: m?.website ? httpUrl(m.website) : null,
      },
      invoice: {
        id: inv.id,
        status,
        amount_rial: Math.round(Number(inv.expected_amount)),
        amount_toman: Math.round(Number(inv.expected_amount) / 10),
        expires_at: isoOf(inv.expires_at),
        paid_at: paidAt,
        tracking_code: inv.trx_id || inv.id,
        redirect_url: httpUrl(inv.redirect_url),
        cancel_url: httpUrl(inv.cancel_url),
      },
    };
  });

  // ============================================================= owner API

  app.get('/api/owner/webhooks/failures', async (req) => {
    const p = paging(req.query);
    const total = Number((db().prepare(`SELECT count(*) c FROM webhook_deliveries WHERE status = 'FAILED'`).get() as any).c);
    const rows = db()
      .prepare(`SELECT w.*, m.name AS store_name, m.handle AS store_handle FROM webhook_deliveries w LEFT JOIN merchants m ON m.id = w.merchant_id
                WHERE w.status = 'FAILED' ORDER BY w.created_at DESC, w.rowid DESC LIMIT ? OFFSET ?`)
      .all(p.limit, p.offset) as any[];
    const since = Date.now() - 86400_000;
    const c = (s: string) => Number((db().prepare(`SELECT count(*) c FROM webhook_deliveries WHERE status = ? AND created_at > ?`).get(s, since) as any).c);
    return {
      success: true,
      data: rows.map((r) => ({ ...SUMMARY(r), merchant_id: r.merchant_id, store_name: r.store_name || null, store_handle: r.store_handle || null })),
      page: p.page, per_page: p.perPage, total,
      summary: { failed_24h: c('FAILED'), delivered_24h: c('DELIVERED'), pending_retries: Number((db().prepare('SELECT count(*) c FROM webhook_deliveries WHERE next_retry_at IS NOT NULL').get() as any).c) },
    };
  });

  app.get('/api/owner/api-usage', async (req) => {
    const q = req.query as any;
    const days = Math.min(90, Math.max(1, Number(q.days) || 14));
    const p = paging(q);
    const from = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
    const total = Number((db().prepare('SELECT count(DISTINCT merchant_id) c FROM api_usage_daily WHERE day >= ?').get(from) as any).c);
    const stores = db()
      .prepare(`SELECT u.merchant_id, sum(u.calls) AS calls, m.name, m.handle, m.api_key_last_used
                FROM api_usage_daily u LEFT JOIN merchants m ON m.id = u.merchant_id WHERE u.day >= ? GROUP BY u.merchant_id ORDER BY calls DESC LIMIT ? OFFSET ?`)
      .all(from, p.limit, p.offset) as any[];
    const data = stores.map((s) => {
      const perDay = db().prepare('SELECT day, calls FROM api_usage_daily WHERE merchant_id = ? AND day >= ? ORDER BY day').all(s.merchant_id, from) as any[];
      const last = (db().prepare('SELECT max(last_used_at) t FROM integration_api_keys WHERE merchant_id = ?').get(s.merchant_id) as any)?.t;
      return {
        merchant_id: s.merchant_id, store_name: s.name || null, store_handle: s.handle || null, calls: Number(s.calls),
        days: perDay.map((d) => ({ day: d.day, calls: Number(d.calls) })),
        last_used_at: isoMs(Math.max(Number(last || 0), Number(s.api_key_last_used || 0)) || null),
        active_keys: Number((db().prepare(`SELECT count(*) c FROM integration_api_keys WHERE merchant_id = ? AND status = 'active'`).get(s.merchant_id) as any).c),
      };
    });
    return { success: true, from, days, data, page: p.page, per_page: p.perPage, total };
  });
}

export { processDueRetries };

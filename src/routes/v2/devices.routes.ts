import type { FastifyInstance, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { db, fail, isoOf, merchantOf, str, utcSql } from './_kit.js';
import { audit, requirePerm, actorOf } from '../../services/access.js';
import { GuardError, checkLimit, events } from '../../services/events.js';
import { bankName } from '../../services/store.service.js';
import { startOfTehranDay } from '../../parsers/ir/jalali.js';
import { DeviceService, ONLINE_WINDOW_MS, appLatest, ensureDeviceSchema, parseUtc } from '../../services/device.service.js';

/** Public base URL of this server (env PUBLIC_BASE_URL, else derived from the request). */
function baseOf(req: FastifyRequest): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}

const parseJson = (s: unknown) => {
  if (!s || typeof s !== 'string') return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

function describe(row: any, now = Date.now()) {
  const seen = parseUtc(row.last_seen);
  const ios = row.kind === 'ios_shortcut';
  const today = utcSql(startOfTehranDay(new Date(now)));
  const d = db();
  const smsToday = Number((d.prepare(`SELECT count(*) AS n FROM transactions WHERE device_id = ? AND created_at >= ?`).get(row.id, today) as any).n);
  const last = d.prepare(`SELECT provider, created_at FROM transactions WHERE device_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`).get(row.id) as any;
  const banks = (d.prepare(`SELECT DISTINCT provider FROM (SELECT provider FROM transactions WHERE device_id = ? UNION SELECT provider FROM unmatched_sms WHERE device_id = ?)`).all(row.id, row.id) as any[])
    .map((r) => r.provider)
    .filter((p) => p && p !== 'UNKNOWN');
  const slots = parseJson(row.sim_slots);
  return {
    id: row.id,
    name: row.device_name,
    kind: ios ? 'ios_shortcut' : 'android',
    online: ios ? null : seen !== null && now - seen <= ONLINE_WINDOW_MS,
    last_seen: isoOf(row.last_seen),
    seconds_since_seen: seen === null ? null : Math.max(0, Math.round((now - seen) / 1000)),
    battery_level: row.battery_level ?? null,
    charging: row.is_charging === null || row.is_charging === undefined ? null : Number(row.is_charging) === 1,
    model: row.device_model || null,
    android_version: row.android_version || null,
    app_version: row.app_version || null,
    sim: { number: row.sim_number || null, slots: Array.isArray(slots) ? slots : [] },
    sms_today: smsToday,
    last_sms_at: last ? isoOf(last.created_at) : null,
    last_sms_bank: last ? last.provider : null,
    last_sms_bank_name: last ? bankName(last.provider) : null,
    banks: banks.map((id) => ({ id, name: bankName(id) })),
    created_at: isoOf(row.created_at),
  };
}

/**
 * One tick of the device monitor: emits device.offline / device.online when the reachability of a phone
 * changes. State is persisted so a restart never repeats an alert. Exported for tests (injectable clock).
 */
export function runDeviceMonitor(now = Date.now()) {
  ensureDeviceSchema();
  const d = db();
  const rows = d
    .prepare(`SELECT id, merchant_id, device_name, last_seen FROM devices WHERE revoked_at IS NULL AND COALESCE(kind, 'android') = 'android' AND last_seen IS NOT NULL`)
    .all() as any[];
  for (const r of rows) {
    const seen = parseUtc(r.last_seen);
    if (seen === null) continue;
    const online = now - seen <= ONLINE_WINDOW_MS ? 1 : 0;
    const prev = d.prepare('SELECT online FROM device_state WHERE device_id = ?').get(r.id) as any;
    if (!prev) {
      d.prepare('INSERT INTO device_state (device_id, online, changed_at) VALUES (?, ?, ?)').run(r.id, online, now);
      continue;
    }
    if (Number(prev.online) === online) continue;
    d.prepare('UPDATE device_state SET online = ?, changed_at = ? WHERE device_id = ?').run(online, now, r.id);
    events.emit(online ? 'device.online' : 'device.offline', { merchantId: r.merchant_id, deviceId: r.id, name: r.device_name });
  }
}

/** Feature plugin "devices" (see docs/dev/PANEL_CONVENTIONS.md). */
export default async function devicesRoutes(app: FastifyInstance) {
  ensureDeviceSchema();

  const timer = setInterval(() => {
    try {
      runDeviceMonitor();
    } catch (e) {
      app.log.warn({ err: e }, 'device monitor failed');
    }
  }, 60_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));

  const own = (req: FastifyRequest, id: string) =>
    db().prepare('SELECT * FROM devices WHERE id = ? AND merchant_id = ? AND revoked_at IS NULL').get(id, merchantOf(req).id) as any;

  const limitOrFail = (req: FastifyRequest, reply: any) => {
    try {
      checkLimit(merchantOf(req).id, 'devices', DeviceService.activeCount(merchantOf(req).id));
      return false;
    } catch (e) {
      if (e instanceof GuardError) {
        fail(reply, e.status, e.code, e.message);
        return true;
      }
      throw e;
    }
  };

  // ---- public: latest Android build (env driven; empty fields when unset)
  app.get('/api/pub/app/latest', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return appLatest();
  });

  // ---- list
  app.get('/api/v2/devices', { preHandler: requirePerm('devices:read') }, async (req) => {
    const rows = db().prepare(`SELECT * FROM devices WHERE merchant_id = ? AND revoked_at IS NULL ORDER BY COALESCE(last_seen, created_at) DESC`).all(merchantOf(req).id) as any[];
    const now = Date.now();
    return { success: true, data: rows.map((r) => describe(r, now)) };
  });

  // ---- recent forwarded SMS of one device (matched payments + held deposits)
  app.get('/api/v2/devices/:id/sms', { preHandler: requirePerm('devices:read') }, async (req, reply) => {
    const dev = own(req, (req.params as any).id);
    if (!dev) return fail(reply, 404, 'not_found', 'دستگاه پیدا نشد');
    const limit = Math.min(100, Math.max(1, Number((req.query as any)?.limit) || 30));
    const d = db();
    const tx = d.prepare(`SELECT id, provider, trx_id, amount, order_id, is_verified, created_at FROM transactions WHERE device_id = ? AND merchant_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`).all(dev.id, dev.merchant_id, limit) as any[];
    const held = d.prepare(`SELECT id, provider, trx_id, amount, status, assigned_invoice_id, created_at FROM unmatched_sms WHERE device_id = ? ORDER BY created_at DESC LIMIT ?`).all(dev.id, limit) as any[];
    const heldBy = new Map(held.map((h) => [h.trx_id, h]));
    const seen = new Set<string>();
    const items: any[] = [];
    const item = (o: any) => ({ ...o, bank_name: bankName(o.bank), amount_toman: Math.round(o.amount_rial / 10) });
    for (const t of tx) {
      seen.add(t.trx_id);
      const h = heldBy.get(t.trx_id);
      const matched = !!t.order_id;
      items.push(item({
        id: `tx_${t.id}`, kind: matched ? 'matched' : 'held', at: isoOf(t.created_at), bank: t.provider, trx_id: t.trx_id, amount_rial: Number(t.amount),
        invoice_id: t.order_id || h?.assigned_invoice_id || null, status: matched ? 'matched' : h ? String(h.status).toLowerCase() : 'recorded',
      }));
    }
    for (const h of held) {
      if (seen.has(h.trx_id)) continue;
      items.push(item({ id: h.id, kind: 'held', at: isoOf(h.created_at), bank: h.provider, trx_id: h.trx_id, amount_rial: Number(h.amount), invoice_id: h.assigned_invoice_id || null, status: String(h.status).toLowerCase() }));
    }
    items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return { success: true, data: items.slice(0, limit) };
  });

  // ---- pairing
  app.post('/api/v2/devices/pair', { preHandler: requirePerm('devices:manage') }, async (req, reply) => {
    if (limitOrFail(req, reply)) return;
    const m = merchantOf(req);
    const { code, expiresAt } = DeviceService.issuePairCode(m.id, actorOf(req).id);
    const base = baseOf(req);
    const payload = `bolgram://pair?s=${encodeURIComponent(base)}&c=${code}`;
    const svg = await QRCode.toString(payload, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#040810', light: '#ffffff' } });
    audit(req, m.id, 'device.pair_code', code.slice(0, 2) + '******');
    return reply.status(201).send({ success: true, code, expires_at: new Date(expiresAt).toISOString(), expires_in: Math.round((expiresAt - Date.now()) / 1000), server: base, qr_payload: payload, qr_svg: svg });
  });

  app.get('/api/v2/devices/pair/:code', { preHandler: requirePerm('devices:read') }, async (req) => {
    const row = DeviceService.pairCodeRow(DeviceService.normalizeCode((req.params as any).code));
    if (!row || row.merchant_id !== merchantOf(req).id) return { success: true, status: 'expired' };
    if (row.used_at) {
      const dev = row.device_id ? (own(req, row.device_id) as any) : null;
      return { success: true, status: 'paired', device: dev ? describe(dev) : null };
    }
    return { success: true, status: row.expires_at > Date.now() ? 'pending' : 'expired', expires_in: Math.max(0, Math.round((row.expires_at - Date.now()) / 1000)) };
  });

  // ---- iPhone Shortcut device
  const shortcutInfo = (req: FastifyRequest, token: string) => {
    const base = baseOf(req);
    return {
      ingest_url: `${base}/api/v1/device/sms/ingest`,
      header_name: 'X-Device-Token',
      token,
      body_example: { sender: 'Bank Mellat', body: 'متن پیامک' },
    };
  };
  app.post('/api/v2/devices/shortcut', { preHandler: requirePerm('devices:manage') }, async (req, reply) => {
    if (limitOrFail(req, reply)) return;
    const m = merchantOf(req);
    const name = str((req.body as any)?.name, 60) || 'آیفون (شورتکات)';
    const { id, token } = DeviceService.createDevice({ merchantId: m.id, name, kind: 'ios_shortcut' });
    audit(req, m.id, 'device.shortcut_created', id);
    const row = own(req, id);
    return reply.status(201).send({ success: true, device: describe(row), ...shortcutInfo(req, token) });
  });
  app.get('/api/v2/devices/:id/shortcut', { preHandler: requirePerm('devices:manage') }, async (req, reply) => {
    const dev = own(req, (req.params as any).id);
    if (!dev || dev.kind !== 'ios_shortcut') return fail(reply, 404, 'not_found', 'دستگاه شورتکات پیدا نشد');
    return { success: true, ...shortcutInfo(req, dev.device_token) };
  });

  // ---- rename / revoke
  app.patch('/api/v2/devices/:id', { preHandler: requirePerm('devices:manage') }, async (req, reply) => {
    const dev = own(req, (req.params as any).id);
    if (!dev) return fail(reply, 404, 'not_found', 'دستگاه پیدا نشد');
    const name = str((req.body as any)?.name, 60);
    if (name.length < 2) return fail(reply, 422, 'validation', 'نام دستگاه را وارد کنید', { name: 'نام دستگاه حداقل ۲ حرف باشد' });
    db().prepare('UPDATE devices SET device_name = ? WHERE id = ?').run(name, dev.id);
    audit(req, dev.merchant_id, 'device.renamed', dev.id);
    return { success: true, device: describe(own(req, dev.id)) };
  });

  app.delete('/api/v2/devices/:id', { preHandler: requirePerm('devices:manage') }, async (req, reply) => {
    const dev = own(req, (req.params as any).id);
    if (!dev) return fail(reply, 404, 'not_found', 'دستگاه پیدا نشد');
    DeviceService.revoke(dev.id, dev.merchant_id);
    audit(req, dev.merchant_id, 'device.revoked', dev.id, { name: dev.device_name });
    return { success: true };
  });
}

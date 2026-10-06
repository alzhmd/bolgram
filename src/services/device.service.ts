import crypto from 'node:crypto';
import { dbService } from '../db/database.js';
import { MerchantRepository, MerchantEntity } from '../db/repositories/merchant.repository.js';
import type { DeviceEntity } from '../db/repositories/device.repository.js';
import { BANKS } from '../parsers/ir/registry.js';

const db = () => (dbService as any).db as import('node:sqlite').DatabaseSync;

export const ONLINE_WINDOW_MS = 3 * 60_000;
export const PAIR_TTL_MS = 10 * 60_000;
const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type DeviceKind = 'android' | 'ios_shortcut';

let schemaReady: unknown = null;
/** Idempotent schema for paired phones (pair codes, kind, revoke, monitor state). Safe to call on every request path. */
export function ensureDeviceSchema() {
  const d = db();
  if (schemaReady === d) return;
  const cols = new Set((d.prepare('PRAGMA table_info(devices)').all() as any[]).map((c) => c.name));
  const add = (name: string, type: string) => {
    if (!cols.has(name)) d.exec(`ALTER TABLE devices ADD COLUMN ${name} ${type}`);
  };
  add('kind', "TEXT DEFAULT 'android'");
  add('revoked_at', 'TEXT');
  add('app_version', 'TEXT');
  add('created_at', 'TEXT');
  d.exec(`
    CREATE TABLE IF NOT EXISTS device_pair_codes (
      code TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      device_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_device_pair_merchant ON device_pair_codes(merchant_id);
    CREATE TABLE IF NOT EXISTS device_state (
      device_id TEXT PRIMARY KEY,
      online INTEGER NOT NULL,
      changed_at INTEGER NOT NULL
    );
  `);
  schemaReady = d;
}

/** Tokens arrive as `X-Device-Token`, `Authorization: Bearer` (Shortcuts / app) or, for the legacy app, in the body. */
export function tokenFromRequest(headers: Record<string, any>, ...fallbacks: unknown[]): string {
  const h = headers['x-device-token'];
  if (typeof h === 'string' && h.trim()) return h.trim().slice(0, 200);
  const a = headers.authorization;
  if (typeof a === 'string' && /^bearer\s+/i.test(a)) return a.replace(/^bearer\s+/i, '').trim().slice(0, 200);
  for (const f of fallbacks) if (typeof f === 'string' && f.trim()) return f.trim().slice(0, 200);
  return '';
}

export interface AppLatest {
  version: string;
  apk_url: string;
  sha256: string;
  min_android: string;
}
export function appLatest(): AppLatest {
  const e = process.env;
  return {
    version: (e.ANDROID_APP_VERSION || '').trim(),
    apk_url: (e.ANDROID_APK_URL || '').trim(),
    sha256: (e.ANDROID_APK_SHA256 || '').trim().toLowerCase(),
    min_android: '6.0',
  };
}

/** Trusted Iranian bank SMS sender identifiers (the app filters locally with these). */
export function bankSenders() {
  const banks = BANKS.filter((b) => b.senders.length).map((b) => ({ id: b.id, name: b.nameFa, senders: b.senders }));
  const flat = Array.from(new Set(banks.flatMap((b) => b.senders)));
  return { banks, senders: flat };
}

export const parseUtc = (s: unknown): number | null => {
  if (!s) return null;
  const str = String(s);
  const t = new Date(str.includes('T') ? str : str.replace(' ', 'T') + 'Z').getTime();
  return Number.isNaN(t) ? null : t;
};

export class DeviceService {
  public static async authenticateDevice(token: string): Promise<{
    authenticated: boolean;
    device?: DeviceEntity;
    merchant?: MerchantEntity;
    error?: string;
  }> {
    ensureDeviceSchema();
    const t = typeof token === 'string' ? token.trim() : '';
    const row = t && t.length <= 200 ? (db().prepare('SELECT * FROM devices WHERE device_token = ? AND revoked_at IS NULL').get(t) as any) : null;
    if (!row) return { authenticated: false, error: 'Device not registered or invalid token' };
    if (row.status === 'SUSPENDED') return { authenticated: false, error: 'Device is suspended' };
    const merchant = await MerchantRepository.findById(row.merchant_id);
    if (!merchant || (merchant as any).status === 'SUSPENDED') return { authenticated: false, error: 'Merchant account not found or suspended' };
    const device = { ...row, device_token_hash: '', status: 'ONLINE' } as DeviceEntity;
    return { authenticated: true, device, merchant };
  }

  public static async recordHeartbeat(token: string, telemetry?: any): Promise<void> {
    ensureDeviceSchema();
    const t = telemetry || {};
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const txt = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
    const level = num(t.battery_level);
    db()
      .prepare(
        `UPDATE devices SET last_seen = datetime('now'), status = 'ONLINE',
           device_model = COALESCE(?, device_model), android_version = COALESCE(?, android_version), app_version = COALESCE(?, app_version),
           battery_level = COALESCE(?, battery_level), battery_temp = COALESCE(?, battery_temp), is_charging = COALESCE(?, is_charging),
           charger_type = COALESCE(?, charger_type), free_ram_mb = COALESCE(?, free_ram_mb), sim_slots = COALESCE(?, sim_slots), sim_number = COALESCE(?, sim_number)
         WHERE device_token = ? AND revoked_at IS NULL`,
      )
      .run(
        txt(t.device_model, 80),
        txt(t.android_version, 40),
        txt(t.app_version, 40),
        level === null ? null : Math.max(0, Math.min(100, Math.round(level))),
        num(t.battery_temp ?? t.battery_temperature),
        typeof t.is_charging === 'boolean' ? (t.is_charging ? 1 : 0) : null,
        txt(t.charger_type, 20),
        num(t.free_ram_mb),
        Array.isArray(t.sim_slots) ? JSON.stringify(t.sim_slots).slice(0, 2000) : null,
        txt(t.sim_number, 30),
        token.trim(),
      );
  }

  public static activeCount(merchantId: string): number {
    ensureDeviceSchema();
    return Number((db().prepare('SELECT count(*) AS n FROM devices WHERE merchant_id = ? AND revoked_at IS NULL').get(merchantId) as any).n);
  }

  public static createDevice(p: { merchantId: string; name: string; kind?: DeviceKind; model?: string | null; androidVersion?: string | null; appVersion?: string | null }) {
    ensureDeviceSchema();
    const id = 'dev_' + crypto.randomBytes(6).toString('hex');
    const token = 'bgd_' + crypto.randomBytes(24).toString('hex');
    db()
      .prepare(
        `INSERT INTO devices (id, merchant_id, device_token, device_name, status, last_seen, kind, device_model, android_version, app_version, created_at)
         VALUES (?, ?, ?, ?, 'OFFLINE', NULL, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(id, p.merchantId, token, p.name, p.kind || 'android', p.model || null, p.androidVersion || null, p.appVersion || null);
    return { id, token };
  }

  /** Soft revoke: the token stops working at once but forwarded deposits keep their history. */
  public static revoke(id: string, merchantId: string): boolean {
    ensureDeviceSchema();
    const r = db()
      .prepare(`UPDATE devices SET revoked_at = datetime('now'), device_token = 'revoked_' || id || '_' || ?, status = 'OFFLINE' WHERE id = ? AND merchant_id = ? AND revoked_at IS NULL`)
      .run(crypto.randomBytes(8).toString('hex'), id, merchantId);
    db().prepare('DELETE FROM device_state WHERE device_id = ?').run(id);
    return Number(r.changes) > 0;
  }

  public static normalizeCode(raw: unknown): string {
    return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  }

  public static issuePairCode(merchantId: string, createdBy: string | null, now = Date.now()) {
    ensureDeviceSchema();
    db().prepare('UPDATE device_pair_codes SET expires_at = ? WHERE merchant_id = ? AND used_at IS NULL AND expires_at > ?').run(now, merchantId, now);
    for (let i = 0; i < 5; i++) {
      let code = '';
      for (let j = 0; j < 8; j++) code += PAIR_ALPHABET[crypto.randomInt(PAIR_ALPHABET.length)];
      try {
        db().prepare('INSERT INTO device_pair_codes (code, merchant_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(code, merchantId, createdBy, now, now + PAIR_TTL_MS);
        return { code, expiresAt: now + PAIR_TTL_MS };
      } catch {
        /* collision: retry */
      }
    }
    throw new Error('pair code generation failed');
  }

  public static pairCodeRow(code: string) {
    ensureDeviceSchema();
    return db().prepare('SELECT * FROM device_pair_codes WHERE code = ?').get(code) as any;
  }

  /** Atomically consumes a code. Returns the merchant id, or null if unknown / used / expired. */
  public static consumePairCode(code: string, now = Date.now()): string | null {
    ensureDeviceSchema();
    const c = this.normalizeCode(code);
    if (c.length !== 8) return null;
    const r = db().prepare('UPDATE device_pair_codes SET used_at = ? WHERE code = ? AND used_at IS NULL AND expires_at > ?').run(now, c, now);
    if (Number(r.changes) === 0) return null;
    return (this.pairCodeRow(c) as any).merchant_id as string;
  }

  public static linkPairCode(code: string, deviceId: string) {
    db().prepare('UPDATE device_pair_codes SET device_id = ? WHERE code = ?').run(deviceId, this.normalizeCode(code));
  }

  // ---- helpers kept for the legacy merchant routes
  public static async registerDevice(params: { merchantId: string; deviceName: string; deviceModel?: string; androidVersion?: string; mfsProvider?: string }) {
    const { id, token } = this.createDevice({ merchantId: params.merchantId, name: params.deviceName, model: params.deviceModel, androidVersion: params.androidVersion });
    const device = db().prepare('SELECT * FROM devices WHERE id = ?').get(id) as any;
    return { device: { ...device, device_token_hash: '' } as DeviceEntity, token };
  }

  public static async listMerchantDevices(merchantId: string): Promise<DeviceEntity[]> {
    ensureDeviceSchema();
    return db().prepare('SELECT * FROM devices WHERE merchant_id = ? AND revoked_at IS NULL ORDER BY last_seen DESC').all(merchantId) as any;
  }

  public static async removeDevice(deviceId: string, merchantId: string): Promise<boolean> {
    return this.revoke(deviceId, merchantId);
  }
}

import { MerchantRepository, MerchantEntity } from '../db/repositories/merchant.repository.js';
import { ApiKeyRepository, ApiKeyEntity } from '../db/repositories/api-key.repository.js';
import { InvoiceRepository, InvoiceEntity } from '../db/repositories/invoice.repository.js';
import { TransactionRepository, TransactionEntity } from '../db/repositories/transaction.repository.js';
import { DeviceRepository, DeviceEntity } from '../db/repositories/device.repository.js';
import { dbService } from '../db/database.js';
import { CryptoUtil } from '../utils/crypto.js';
import crypto from 'node:crypto';
import { ensureWebhookSchema } from './webhook.service.js';

const sql = () => {
  ensureApiKeySchema();
  return (dbService as any).db as import('node:sqlite').DatabaseSync;
};

let keySchemaReady = false;
/** Named API keys: only the sha256 hash and a visible prefix are stored; the secret is shown once at creation. */
export function ensureApiKeySchema() {
  if (keySchemaReady) return;
  ensureWebhookSchema();
  const d = (dbService as any).db as import('node:sqlite').DatabaseSync;
  d.exec(`CREATE TABLE IF NOT EXISTS integration_api_keys (
    id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, name TEXT NOT NULL, environment TEXT NOT NULL DEFAULT 'live',
    prefix TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER, created_by TEXT)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_iak_merchant ON integration_api_keys(merchant_id)`);
  d.exec(`CREATE TABLE IF NOT EXISTS api_usage_daily (merchant_id TEXT NOT NULL, day TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (merchant_id, day))`);
  keySchemaReady = true;
}

export interface ApiKeyRow { id: string; name: string; environment: 'live' | 'test'; prefix: string; status: 'active' | 'revoked'; created_at: number; last_used_at: number | null; revoked_at: number | null }
export const MAX_ACTIVE_KEYS = 10;
const TOUCH_MS = 30_000;

export function listIntegrationKeys(merchantId: string): ApiKeyRow[] {
  return sql().prepare('SELECT id, name, environment, prefix, status, created_at, last_used_at, revoked_at FROM integration_api_keys WHERE merchant_id = ? ORDER BY created_at DESC').all(merchantId) as any;
}

export function createIntegrationKey(merchantId: string, name: string, environment: 'live' | 'test', createdBy?: string): { row: ApiKeyRow; secret: string } {
  const secret = `${environment}_sk_${crypto.randomBytes(24).toString('hex')}`;
  const id = 'ak_' + crypto.randomBytes(8).toString('hex');
  const prefix = secret.slice(0, 12);
  sql().prepare('INSERT INTO integration_api_keys (id, merchant_id, name, environment, prefix, key_hash, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, merchantId, name, environment, prefix, CryptoUtil.hashToken(secret), 'active', Date.now(), createdBy || null);
  return { row: { id, name, environment, prefix, status: 'active', created_at: Date.now(), last_used_at: null, revoked_at: null }, secret };
}

export function revokeIntegrationKey(merchantId: string, id: string): boolean {
  return Number(sql().prepare("UPDATE integration_api_keys SET status = 'revoked', revoked_at = ? WHERE id = ? AND merchant_id = ? AND status = 'active'").run(Date.now(), id, merchantId).changes) === 1;
}

export class MerchantService {
  public static async authenticateApiKey(rawApiKey: string): Promise<{
    authenticated: boolean;
    merchant?: MerchantEntity;
    apiKeyEntity?: ApiKeyEntity;
    error?: string;
  }> {
    const raw = typeof rawApiKey === 'string' ? rawApiKey.trim() : '';
    if (!raw || raw.length > 200) return { authenticated: false, error: 'Invalid API Key' };
    const hash = CryptoUtil.hashToken(raw);
    const named = sql().prepare('SELECT * FROM integration_api_keys WHERE key_hash = ?').get(hash) as any;
    let keyRecord: ApiKeyEntity | null = null;
    if (named) {
      if (named.status !== 'active') return { authenticated: false, error: 'Invalid API Key' };
      if (!named.last_used_at || Date.now() - Number(named.last_used_at) > TOUCH_MS) sql().prepare('UPDATE integration_api_keys SET last_used_at = ? WHERE id = ?').run(Date.now(), named.id);
      keyRecord = {
        id: named.id, merchant_id: named.merchant_id, key_prefix: named.prefix, key_hash: hash, name: named.name,
        environment: named.environment === 'test' ? 'sandbox' : 'production', status: 'active', last_used_at: named.last_used_at ? new Date(named.last_used_at).toISOString() : null,
      };
    } else {
      const legacy = sql().prepare('SELECT id, api_key_last_used FROM merchants WHERE api_key = ?').get(raw) as any;
      if (legacy && (!legacy.api_key_last_used || Date.now() - Number(legacy.api_key_last_used) > TOUCH_MS)) sql().prepare('UPDATE merchants SET api_key_last_used = ? WHERE id = ?').run(Date.now(), legacy.id);
      keyRecord = await ApiKeyRepository.findByKey(raw);
    }
    if (!keyRecord) {
      return { authenticated: false, error: 'Invalid API Key' };
    }

    const merchant = await MerchantRepository.findById(keyRecord.merchant_id);
    if (!merchant || merchant.status !== 'ACTIVE') {
      return { authenticated: false, error: 'Merchant account is not active' };
    }

    sql().prepare('INSERT INTO api_usage_daily (merchant_id, day, calls) VALUES (?, ?, 1) ON CONFLICT(merchant_id, day) DO UPDATE SET calls = calls + 1').run(keyRecord.merchant_id, new Date().toISOString().slice(0, 10));
    return { authenticated: true, merchant, apiKeyEntity: keyRecord };
  }

  public static async getMerchantStats(merchantId: string) {
    // Collect stats from transactions & devices
    const txs = await TransactionRepository.listRecent(merchantId, 100);
    const devices = await DeviceRepository.listByMerchant(merchantId);

    const todayDate = new Date().toISOString().slice(0, 10);
    const todayTxs = txs.filter((t) => t.created_at?.startsWith(todayDate));

    const todayRevenue = todayTxs.reduce((sum, t) => sum + (t.status === 'COMPLETED' ? t.amount : 0), 0);
    const totalVerified = txs.filter((t) => t.status === 'COMPLETED').length;

    return {
      todayRevenue,
      todayCount: todayTxs.length,
      totalVerified,
      devices,
    };
  }

  public static async getInvoices(merchantId: string, limit: number = 50): Promise<InvoiceEntity[]> {
    return InvoiceRepository.listByMerchant(merchantId, limit);
  }

  public static async getTransactions(merchantId: string, limit: number = 50): Promise<TransactionEntity[]> {
    return TransactionRepository.listRecent(merchantId, limit);
  }

  public static async getApiKeys(merchantId: string): Promise<ApiKeyEntity[]> {
    return ApiKeyRepository.listByMerchant(merchantId);
  }

  public static async generateApiKey(
    merchantId: string,
    name: string,
    environment: 'production' | 'sandbox' = 'production'
  ): Promise<{ key: string; entity: ApiKeyEntity }> {
    const prefix = environment === 'production' ? 'live_sk_' : 'sand_sk_';
    const randomHex = CryptoUtil.generateToken(20);
    const rawKey = `${prefix}${randomHex}`;
    const { entity, rawKey: generatedKey } = await ApiKeyRepository.create({
      merchantId,
      name,
      rawApiKey: rawKey,
      environment,
    });
    return { key: generatedKey, entity };
  }
}

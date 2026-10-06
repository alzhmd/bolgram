import { getSupabaseClient, isSupabaseConfigured } from '../supabase.js';
import { CryptoUtil } from '../../utils/crypto.js';
import { dbService } from '../database.js';

export interface ApiKeyEntity {
  id: string;
  merchant_id: string;
  key_prefix: string;
  key_hash: string;
  name: string;
  secret_key?: string;
  environment?: 'production' | 'sandbox';
  status: 'active' | 'revoked';
  last_used_at?: string | null;
  created_at?: string;
  revoked_at?: string | null;
}

export class ApiKeyRepository {
  public static async findByKey(rawApiKey: string): Promise<ApiKeyEntity | null> {
    const trimmedKey = rawApiKey.trim();
    const keyHash = CryptoUtil.hashToken(trimmedKey);
    const supabase = getSupabaseClient();

    if (supabase && isSupabaseConfigured()) {
      // Check by key_hash or exact secret_key
      const { data, error } = await supabase
        .from('merchant_api_keys')
        .select('*')
        .or(`key_hash.eq.${keyHash},secret_key.eq.${trimmedKey}`)
        .eq('status', 'active')
        .maybeSingle();

      if (!error && data) {
        supabase
          .from('merchant_api_keys')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', data.id)
          .then();

        return data as ApiKeyEntity;
      }
    }

    // SQLite check: by api_keys table or merchants table
    try {
      const allRows = dbService.getAllApiKeys('');
      const matched = allRows.find((k: any) => k.secret_key === trimmedKey && k.status === 'active');
      if (matched) {
        return {
          id: matched.id,
          merchant_id: matched.merchant_id,
          key_prefix: matched.key_prefix,
          key_hash: CryptoUtil.hashToken(matched.secret_key),
          name: matched.name,
          secret_key: matched.secret_key,
          environment: (matched.environment as any) || 'production',
          status: 'active',
        };
      }
    } catch {}

    const localMerchant = dbService.getMerchantByApiKey(trimmedKey);
    if (localMerchant) {
      let merchantId = localMerchant.id;
      if (localMerchant.id === 'm_demo_101') merchantId = '00000000-0000-0000-0000-000000000101';
      else if (localMerchant.id === 'm_payflow_sandbox') merchantId = '00000000-0000-0000-0000-000000000999';

      return {
        id: 'key_' + localMerchant.id,
        merchant_id: merchantId,
        key_prefix: trimmedKey.substring(0, 8),
        key_hash: keyHash,
        name: 'Primary Live Key',
        secret_key: trimmedKey,
        environment: trimmedKey.startsWith('sandbox_') || trimmedKey.startsWith('sand_') ? 'sandbox' : 'production',
        status: 'active',
      };
    }

    return null;
  }

  public static async create(params: {
    merchantId: string;
    name: string;
    rawApiKey: string;
    environment?: 'production' | 'sandbox';
  }): Promise<{ entity: ApiKeyEntity; rawKey: string }> {
    const keyPrefix = params.rawApiKey.substring(0, 8);
    const keyHash = CryptoUtil.hashToken(params.rawApiKey);
    const environment = params.environment || (params.rawApiKey.startsWith('sand_') ? 'sandbox' : 'production');
    const supabase = getSupabaseClient();

    let createdEntity: ApiKeyEntity | null = null;

    if (supabase && isSupabaseConfigured()) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.merchantId);
      const targetMerchantId = isUuid ? params.merchantId : '00000000-0000-0000-0000-000000000101';

      const { data, error } = await supabase
        .from('merchant_api_keys')
        .insert({
          merchant_id: targetMerchantId,
          key_prefix: keyPrefix,
          key_hash: keyHash,
          name: params.name,
          secret_key: params.rawApiKey,
          environment: environment,
          status: 'active',
        })
        .select()
        .single();

      if (!error && data) {
        createdEntity = data as ApiKeyEntity;
      }
    }

    if (!createdEntity) {
      createdEntity = {
        id: 'key_' + Math.random().toString(36).substring(2, 9),
        merchant_id: params.merchantId,
        key_prefix: keyPrefix,
        key_hash: keyHash,
        name: params.name,
        secret_key: params.rawApiKey,
        environment: environment,
        status: 'active',
        created_at: new Date().toISOString(),
      };
    }

    // Always mirror to SQLite database for resilience
    try {
      dbService.insertApiKey({
        id: createdEntity.id,
        merchant_id: params.merchantId,
        name: params.name,
        key_prefix: keyPrefix,
        secret_key: params.rawApiKey,
        environment: environment,
        status: 'active',
      });
    } catch {}

    return { entity: createdEntity, rawKey: params.rawApiKey };
  }

  public static async listByMerchant(merchantId: string): Promise<ApiKeyEntity[]> {
    const supabase = getSupabaseClient();
    let supabaseKeys: ApiKeyEntity[] = [];

    if (supabase && isSupabaseConfigured()) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(merchantId);
      if (isUuid) {
        const { data, error } = await supabase
          .from('merchant_api_keys')
          .select('*')
          .eq('merchant_id', merchantId)
          .order('created_at', { ascending: false });

        if (!error && data && data.length > 0) {
          supabaseKeys = data as ApiKeyEntity[];
        }
      }
    }

    // Local keys from SQLite
    const localKeys = dbService.getAllApiKeys(merchantId);
    const localMerchant = dbService.getMerchantById(merchantId);

    // Merge Supabase keys with SQLite secret_key if missing
    if (supabaseKeys.length > 0) {
      return supabaseKeys.map(k => {
        let secret = k.secret_key;
        if (!secret) {
          const match = localKeys.find((lk: any) => lk.id === k.id || lk.key_prefix === k.key_prefix);
          secret = match?.secret_key || localMerchant?.api_key || `${k.key_prefix}${k.key_hash.slice(0, 24)}`;
        }
        const resolvedSecret = secret || `${k.key_prefix}sec_${Math.random().toString(36).slice(2, 14)}`;
        return {
          ...k,
          secret_key: resolvedSecret,
          environment: k.environment || (resolvedSecret.startsWith('sand_') ? 'sandbox' : 'production'),
        };
      });
    }

    if (localKeys.length > 0) {
      return localKeys.map((k: any) => ({
        id: k.id,
        merchant_id: k.merchant_id,
        key_prefix: k.key_prefix,
        key_hash: CryptoUtil.hashToken(k.secret_key),
        name: k.name,
        secret_key: k.secret_key,
        environment: (k.environment as any) || 'production',
        status: k.status as 'active',
        last_used_at: k.last_used,
        created_at: k.created_at,
      }));
    }

    // Default fallback if no keys exist yet
    const fallbackKey = localMerchant?.api_key || `live_sk_${CryptoUtil.generateToken(24)}`;
    return [{
      id: 'key_default_' + merchantId.slice(-6),
      merchant_id: merchantId,
      key_prefix: fallbackKey.substring(0, 8),
      key_hash: CryptoUtil.hashToken(fallbackKey),
      name: 'Default Live Key',
      secret_key: fallbackKey,
      environment: 'production',
      status: 'active',
      created_at: new Date().toISOString(),
    }];
  }

  public static async revoke(keyId: string, merchantId: string): Promise<boolean> {
    const supabase = getSupabaseClient();
    if (supabase && isSupabaseConfigured()) {
      await supabase
        .from('merchant_api_keys')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('id', keyId);
    }

    try {
      dbService.revokeApiKey(keyId, merchantId);
    } catch {}

    return true;
  }
}

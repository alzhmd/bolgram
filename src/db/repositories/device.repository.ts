import { getSupabaseClient, isSupabaseConfigured } from '../supabase.js';
import { CryptoUtil } from '../../utils/crypto.js';
import { dbService } from '../database.js';

export interface DeviceEntity {
  id: string;
  merchant_id: string;
  device_name: string;
  device_token_hash: string;
  device_model?: string | null;
  android_version?: string | null;
  mfs_provider?: string | null;
  status: 'ONLINE' | 'OFFLINE' | 'SUSPENDED';
  last_seen_at?: string | null;
  last_seen?: string | null;
  sim_number?: string | null;
  battery_level?: number | null;
  battery_temp?: number | null;
  is_charging?: boolean | null;
  charger_type?: string | null;
  free_ram_mb?: number | null;
  sim_slots?: any;
  sms_count?: number;
  created_at?: string;
  updated_at?: string;
}

export class DeviceRepository {
  public static async findByToken(token: string): Promise<DeviceEntity | null> {
    const tokenHash = CryptoUtil.hashToken(token);
    const supabase = getSupabaseClient();

    if (supabase && isSupabaseConfigured()) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
      let query = supabase.from('devices').select('*');
      if (isUuid) {
        query = query.or(`device_token_hash.eq.${tokenHash},id.eq.${token}`);
      } else {
        query = query.eq('device_token_hash', tokenHash);
      }
      const { data, error } = await query.maybeSingle();

      if (!error && data) {
        return data as DeviceEntity;
      }
    }

    // Local SQLite fallback
    const local = dbService.getDeviceByToken(token);
    if (local) {
      return {
        id: local.id,
        merchant_id: local.merchant_id,
        device_name: local.device_name,
        device_token_hash: tokenHash,
        status: 'ONLINE',
      };
    }

    return null;
  }

  public static async create(params: {
    merchantId: string;
    deviceName: string;
    rawToken: string;
    deviceModel?: string;
    androidVersion?: string;
    mfsProvider?: string;
  }): Promise<{ entity: DeviceEntity; rawToken: string }> {
    const tokenHash = CryptoUtil.hashToken(params.rawToken);
    const supabase = getSupabaseClient();

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.merchantId);
    const targetMerchantId = isUuid ? params.merchantId : '00000000-0000-0000-0000-000000000101';

    if (supabase && isSupabaseConfigured()) {
      try {
        const { data, error } = await supabase
          .from('devices')
          .insert({
            merchant_id: targetMerchantId,
            device_name: params.deviceName,
            device_token_hash: tokenHash,
            device_model: params.deviceModel || null,
            android_version: params.androidVersion || null,
            mfs_provider: params.mfsProvider || 'ALL',
            status: (params as any).status || 'OFFLINE',
          })
          .select()
          .single();

        if (!error && data) {
          return { entity: data as DeviceEntity, rawToken: params.rawToken };
        }
      } catch (err) {
        // Fall back to local SQLite store
      }
    }

    // Local fallback
    const id = 'dev_' + Math.random().toString(36).substring(2, 9);
    dbService.addDevice({
      id,
      merchantId: params.merchantId,
      deviceName: params.deviceName,
      simNumber: '01700000000',
      deviceToken: params.rawToken,
    });

    const entity: DeviceEntity = {
      id,
      merchant_id: params.merchantId,
      device_name: params.deviceName,
      device_token_hash: tokenHash,
      status: (params as any).status || 'OFFLINE',
      created_at: new Date().toISOString(),
    };
    return { entity, rawToken: params.rawToken };
  }

  public static async updateHeartbeat(deviceIdOrToken: string, telemetry?: any): Promise<void> {
    const supabase = getSupabaseClient();
    if (supabase && isSupabaseConfigured()) {
      const tokenHash = CryptoUtil.hashToken(deviceIdOrToken);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceIdOrToken);
      try {
        const updatePayload: Record<string, any> = {
          last_seen_at: new Date().toISOString(),
          status: 'ONLINE',
          updated_at: new Date().toISOString(),
        };
        if (telemetry?.device_model) updatePayload.device_model = telemetry.device_model;
        if (telemetry?.android_version) updatePayload.android_version = telemetry.android_version;
        if (telemetry?.device_name) updatePayload.device_name = telemetry.device_name;

        let query = supabase.from('devices').update(updatePayload);
        if (isUuid) {
          query = query.or(`id.eq.${deviceIdOrToken},device_token_hash.eq.${tokenHash}`);
        } else {
          query = query.eq('device_token_hash', tokenHash);
        }
        await query;
      } catch (_) {}
    }

    dbService.updateDeviceHeartbeat(deviceIdOrToken, telemetry);
  }

  public static async listByMerchant(merchantId: string): Promise<DeviceEntity[]> {
    const supabase = getSupabaseClient();
    if (supabase && isSupabaseConfigured()) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(merchantId);
      const targetMerchantId = isUuid ? merchantId : '00000000-0000-0000-0000-000000000101';

      try {
        const { data, error } = await supabase
          .from('devices')
          .select('*')
          .eq('merchant_id', targetMerchantId)
          .order('created_at', { ascending: false });

        const deviceList = (!error && data && data.length > 0) ? data : [];

        if (deviceList.length > 0) {
          return deviceList.map((d: any) => {
            let localDev: any = null;
            try {
              localDev = dbService.getDeviceByToken(d.id);
            } catch (_) {}

            return {
              id: d.id,
              merchant_id: merchantId,
              device_name: d.device_name || localDev?.device_name || 'SyncPay Device',
              device_token_hash: d.device_token_hash,
              status: d.status as any,
              last_seen: d.last_seen_at || localDev?.last_seen,
              last_seen_at: d.last_seen_at || localDev?.last_seen,
              sim_number: d.sim_number || localDev?.sim_number || null,
              device_model: d.device_model || localDev?.device_model || null,
              android_version: d.android_version || localDev?.android_version || null,
              battery_level: (localDev?.battery_level !== undefined && localDev?.battery_level !== null) ? localDev.battery_level : (d.battery_level !== undefined ? d.battery_level : null),
              battery_temp: (localDev?.battery_temp !== undefined && localDev?.battery_temp !== null) ? localDev.battery_temp : (d.battery_temp !== undefined ? d.battery_temp : null),
              is_charging: localDev?.is_charging !== undefined ? (localDev.is_charging === 1 || localDev.is_charging === true) : (d.is_charging === 1 || d.is_charging === true),
              charger_type: localDev?.charger_type || d.charger_type || null,
              free_ram_mb: localDev?.free_ram_mb || d.free_ram_mb || null,
              sim_slots: localDev?.sim_slots ? (typeof localDev.sim_slots === 'string' ? (() => { try { return JSON.parse(localDev.sim_slots); } catch (_) { return null; } })() : localDev.sim_slots) : (typeof d.sim_slots === 'string' ? (() => { try { return JSON.parse(d.sim_slots); } catch (_) { return null; } })() : (d.sim_slots || null)),
              sms_count: localDev?.sms_count || d.sms_count || 0,
            };
          }) as DeviceEntity[];
        }
      } catch (_) {}
    }

    const localDevices = dbService.getAllDevices(merchantId);
    return localDevices.map((d: any) => ({
      id: d.id,
      merchant_id: d.merchant_id,
      device_name: d.device_name,
      device_token_hash: CryptoUtil.hashToken(d.device_token || d.id),
      status: d.status as any,
      last_seen: d.last_seen,
      last_seen_at: d.last_seen,
      sim_number: d.sim_number,
      device_model: d.device_model || null,
      android_version: d.android_version || null,
      battery_level: d.battery_level !== undefined ? d.battery_level : null,
      battery_temp: d.battery_temp !== undefined ? d.battery_temp : null,
      is_charging: d.is_charging === 1 || d.is_charging === true,
      charger_type: d.charger_type || null,
      free_ram_mb: d.free_ram_mb || null,
      sim_slots: typeof d.sim_slots === 'string' ? (() => { try { return JSON.parse(d.sim_slots); } catch (_) { return null; } })() : (d.sim_slots || null),
      sms_count: d.sms_count || 0,
    }));
  }

  public static async delete(id: string, merchantId: string): Promise<boolean> {
    const supabase = getSupabaseClient();
    if (supabase && isSupabaseConfigured()) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(merchantId);
      const targetMerchantId = isUuid ? merchantId : '00000000-0000-0000-0000-000000000101';
      try {
        const { error } = await supabase
          .from('devices')
          .delete()
          .eq('id', id)
          .eq('merchant_id', targetMerchantId);

        if (!error) return true;
      } catch (_) {}
    }

    dbService.deleteDevice(id, merchantId);
    return true;
  }
}

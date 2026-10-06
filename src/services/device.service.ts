import { DeviceRepository, DeviceEntity } from '../db/repositories/device.repository.js';
import { MerchantRepository, MerchantEntity } from '../db/repositories/merchant.repository.js';

export class DeviceService {
  public static async authenticateDevice(deviceTokenOrId: string): Promise<{
    authenticated: boolean;
    device?: DeviceEntity;
    merchant?: MerchantEntity;
    error?: string;
  }> {
    const device = await DeviceRepository.findByToken(deviceTokenOrId);
    if (!device) {
      return { authenticated: false, error: 'Device not registered or invalid token' };
    }

    if (device.status === 'SUSPENDED') {
      return { authenticated: false, error: 'Device is suspended' };
    }

    const merchant = await MerchantRepository.findById(device.merchant_id);
    if (!merchant) {
      return { authenticated: false, error: 'Merchant account not found or suspended' };
    }

    return { authenticated: true, device, merchant };
  }

  public static async recordHeartbeat(tokenOrId: string, telemetry?: any): Promise<void> {
    await DeviceRepository.updateHeartbeat(tokenOrId, telemetry);
  }

  public static async registerDevice(params: {
    merchantId: string;
    deviceName: string;
    deviceModel?: string;
    androidVersion?: string;
    mfsProvider?: string;
  }): Promise<{ device: DeviceEntity; token: string }> {
    const rawToken = 'token_' + Math.random().toString(36).substring(2, 14);
    const { entity, rawToken: token } = await DeviceRepository.create({
      merchantId: params.merchantId,
      deviceName: params.deviceName,
      rawToken,
      deviceModel: params.deviceModel,
      androidVersion: params.androidVersion,
      mfsProvider: params.mfsProvider,
    });

    return { device: entity, token };
  }

  public static async listMerchantDevices(merchantId: string): Promise<DeviceEntity[]> {
    return DeviceRepository.listByMerchant(merchantId);
  }

  public static async removeDevice(deviceId: string, merchantId: string): Promise<boolean> {
    return DeviceRepository.delete(deviceId, merchantId);
  }
}

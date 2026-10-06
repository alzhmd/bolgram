import { MerchantRepository, MerchantEntity } from '../db/repositories/merchant.repository.js';
import { ApiKeyRepository, ApiKeyEntity } from '../db/repositories/api-key.repository.js';
import { InvoiceRepository, InvoiceEntity } from '../db/repositories/invoice.repository.js';
import { TransactionRepository, TransactionEntity } from '../db/repositories/transaction.repository.js';
import { DeviceRepository, DeviceEntity } from '../db/repositories/device.repository.js';
import { dbService } from '../db/database.js';
import { CryptoUtil } from '../utils/crypto.js';

export class MerchantService {
  public static async authenticateApiKey(rawApiKey: string): Promise<{
    authenticated: boolean;
    merchant?: MerchantEntity;
    apiKeyEntity?: ApiKeyEntity;
    error?: string;
  }> {
    const keyRecord = await ApiKeyRepository.findByKey(rawApiKey);
    if (!keyRecord) {
      return { authenticated: false, error: 'Invalid API Key' };
    }

    const merchant = await MerchantRepository.findById(keyRecord.merchant_id);
    if (!merchant || merchant.status !== 'ACTIVE') {
      return { authenticated: false, error: 'Merchant account is not active' };
    }

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

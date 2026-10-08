import { dbService, TransactionRecord } from '../database.js';

export interface TransactionEntity {
  id: string;
  merchant_id: string;
  invoice_id?: string | null;
  device_id?: string | null;
  provider: string;
  trx_id: string;
  sender_number?: string | null;
  amount: number;
  raw_sms: string;
  transaction_time?: string;
  status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'REFUNDED';
  created_at?: string;
}

export class TransactionRepository {
  public static async insert(params: {
    merchantId: string;
    deviceId?: string;
    invoiceId?: string;
    provider: string;
    trxId: string;
    amount: number;
    senderNumber?: string;
    rawSms: string;
    status?: 'COMPLETED' | 'PENDING' | 'FAILED' | 'REFUNDED';
    simSlot?: number;
    carrier?: string;
    source?: string;
  }): Promise<{ success: boolean; isDuplicate?: boolean; id?: string }> {
    const upperTrxId = params.trxId.toUpperCase();


    // Local SQLite fallback
    const localResult = dbService.insertTransaction({
      merchantId: params.merchantId,
      deviceId: params.deviceId || 'dev_phone_1',
      provider: params.provider,
      trxId: upperTrxId,
      amount: params.amount,
      sender: params.senderNumber,
      rawSms: params.rawSms,
      simSlot: params.simSlot,
      carrier: params.carrier,
      source: params.source,
    });

    if (localResult.isDuplicate) {
      return { success: false, isDuplicate: true };
    }

    return { success: true, id: String(localResult.id) };
  }

  public static async findByTrxId(merchantId: string, trxId: string): Promise<TransactionEntity | null> {
    const upperTrxId = trxId.toUpperCase();


    const local = dbService.findTransactionByTrxId(merchantId, upperTrxId);

    if (local) {
      return {
        id: String(local.id),
        merchant_id: local.merchant_id,
        provider: local.provider,
        trx_id: local.trx_id,
        amount: local.amount,
        sender_number: local.sender || null,
        raw_sms: local.raw_sms,
        status: local.is_verified === 1 ? 'COMPLETED' : 'PENDING',
        created_at: local.created_at,
      };
    }

    return null;
  }

  public static async verifyAndLock(
    merchantId: string,
    trxId: string,
    expectedAmount: number,
    orderId: string
  ): Promise<{ success: boolean; reason?: string; transaction?: TransactionEntity }> {
    const upperTrxId = trxId.toUpperCase();
    const trx = await this.findByTrxId(merchantId, upperTrxId);

    if (!trx) {
      return { success: false, reason: 'Transaction ID not found. Ensure money has been sent.' };
    }

    if (trx.status === 'COMPLETED') {
      // In local SQLite, check is_verified
      let local = dbService.findTransactionByTrxId(merchantId, upperTrxId);
      if (!local && trx.merchant_id) {
        local = dbService.findTransactionByTrxId(trx.merchant_id, upperTrxId);
      }
      if (local && local.is_verified === 1) {
        return { success: false, reason: 'This Transaction ID has already been used for another order.' };
      }
    }

    if (Math.abs(trx.amount - expectedAmount) > 0.01) {
      return {
        success: false,
        reason: `مبلغ مطابقت ندارد: انتظار ${expectedAmount} ریال، دریافت ${trx.amount} ریال`,
      };
    }

    // Local SQLite fallback
    let localRes = dbService.verifyAndLockTransaction(merchantId, upperTrxId, expectedAmount, orderId);
    if (!localRes.success && trx.merchant_id !== merchantId) {
      localRes = dbService.verifyAndLockTransaction(trx.merchant_id, upperTrxId, expectedAmount, orderId);
    }

    if (!localRes.success) {
      return { success: false, reason: localRes.reason };
    }

    return {
      success: true,
      transaction: {
        id: String(localRes.transaction!.id),
        merchant_id: localRes.transaction!.merchant_id,
        provider: localRes.transaction!.provider,
        trx_id: localRes.transaction!.trx_id,
        amount: localRes.transaction!.amount,
        sender_number: localRes.transaction!.sender || null,
        raw_sms: localRes.transaction!.raw_sms,
        status: 'COMPLETED',
      },
    };
  }

  public static async listRecent(merchantId: string, limit: number = 50): Promise<TransactionEntity[]> {

    const locals = dbService.getRecentTransactions(merchantId, limit);
    return locals.map((l) => ({
      id: String(l.id),
      merchant_id: l.merchant_id,
      provider: l.provider,
      trx_id: l.trx_id,
      amount: l.amount,
      sender_number: l.sender || null,
      raw_sms: l.raw_sms,
      status: l.is_verified === 1 ? 'COMPLETED' : 'PENDING',
      created_at: l.created_at,
    }));
  }
}

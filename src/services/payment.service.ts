import { InvoiceRepository, InvoiceEntity } from '../db/repositories/invoice.repository.js';
import { TransactionRepository } from '../db/repositories/transaction.repository.js';
import { WebhookService } from './webhook.service.js';
import { TelegramService } from './telegram.service.js';

export interface CreateInvoiceParams {
  merchantId: string;
  customerName?: string;
  customerEmail?: string;
  amount: number;
  metadata?: Record<string, any>;
  redirectUrl: string;
  cancelUrl?: string;
  webhookUrl?: string;
  expiresInMinutes?: number;
}

export class PaymentService {
  public static async createInvoice(params: CreateInvoiceParams): Promise<{
    invoice: InvoiceEntity;
    payment_url: string;
  }> {
    const invoiceId = 'PF' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();

    const invoice = await InvoiceRepository.create({
      merchantId: params.merchantId,
      invoiceId,
      customerName: params.customerName || 'Valued Customer',
      customerEmail: params.customerEmail,
      amount: params.amount,
      redirectUrl: params.redirectUrl,
      webhookUrl: params.webhookUrl,
      expiresInMinutes: params.expiresInMinutes || 30,
    });

    return {
      invoice,
      payment_url: `/checkout?invoice_id=${invoice.invoice_id}`,
    };
  }

  public static async verifyInvoice(invoiceId: string, merchantId: string): Promise<{
    found: boolean;
    invoice?: InvoiceEntity;
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
  }> {
    const invoice = await InvoiceRepository.findByInvoiceId(invoiceId);
    if (!invoice || invoice.merchant_id !== merchantId) {
      return { found: false, status: 'FAILED' };
    }

    const statusMap: Record<string, 'PENDING' | 'COMPLETED' | 'FAILED'> = {
      PAID: 'COMPLETED',
      PENDING: 'PENDING',
      EXPIRED: 'FAILED',
      FAILED: 'FAILED',
    };

    return {
      found: true,
      invoice,
      status: statusMap[invoice.status] || 'PENDING',
    };
  }

  public static async settleCheckout(params: {
    merchantId: string;
    trxId: string;
    amount: number;
    orderId: string;
    invoiceId?: string;
    webhookSecret?: string;
  }): Promise<{
    success: boolean;
    reason?: string;
    invoice?: InvoiceEntity;
    transaction?: any;
    redirect_url?: string | null;
  }> {
    const lockResult = await TransactionRepository.verifyAndLock(
      params.merchantId,
      params.trxId,
      params.amount,
      params.orderId
    );

    if (!lockResult.success) {
      return { success: false, reason: lockResult.reason };
    }

    let invoice: InvoiceEntity | undefined;
    if (params.invoiceId) {
      await InvoiceRepository.updateStatus(
        params.invoiceId,
        'PAID',
        params.trxId,
        lockResult.transaction?.provider?.toLowerCase()
      );
      const found = await InvoiceRepository.findByInvoiceId(params.invoiceId);
      if (found) invoice = found;

      // Dispatch webhook with resilient retries
      if (invoice?.webhook_url) {
        WebhookService.dispatch({
          merchantId: params.merchantId,
          invoiceId: invoice.invoice_id,
          webhookUrl: invoice.webhook_url,
          webhookSecret: params.webhookSecret,
          payload: {
            invoice_id: invoice.invoice_id,
            status: 'true',
            provider: lockResult.transaction?.provider?.toLowerCase() || 'mfs',
            trx_id: params.trxId.toUpperCase(),
            amount: params.amount,
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Asynchronous Telegram payment alert notification
      TelegramService.sendPaymentAlert({
        amount: params.amount,
        provider: lockResult.transaction?.provider || 'bKash',
        trxId: params.trxId,
        invoiceId: invoice?.invoice_id || params.invoiceId || 'N/A',
        customerName: invoice?.customer_name,
        merchantName: invoice?.merchant_id,
      }).catch((err) => console.warn('[TelegramAlert] Skipped:', err.message));
    }

    return {
      success: true,
      invoice,
      transaction: lockResult.transaction,
      redirect_url: invoice?.redirect_url || null,
    };
  }
}

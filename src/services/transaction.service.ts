import { TransactionRepository, TransactionEntity } from '../db/repositories/transaction.repository.js';
import { InvoiceRepository, InvoiceEntity } from '../db/repositories/invoice.repository.js';
import { MfsParser, ParsedMfsResult } from '../parsers/mfs.parser.js';
import { WebhookService } from './webhook.service.js';
import { TelegramService } from './telegram.service.js';
import { notifyHeldDeposit, notifyPayment } from '../bot/bot.service.js';
import { events } from './events.js';

export interface IngestSmsParams {
  merchantId: string;
  deviceId: string;
  sms: string;
  sender?: string;
  webhookSecret?: string;
  simSlot?: number;
  carrier?: string;
  source?: string;
}

export interface IngestResult {
  success: boolean;
  stepFailed?: string;
  error?: string;
  isDuplicate?: boolean;
  parsed?: ParsedMfsResult;
  transaction?: TransactionEntity;
  matchedInvoice?: InvoiceEntity;
}

export class TransactionService {
  public static async ingestSms(params: IngestSmsParams): Promise<IngestResult> {
    // 1. MFS Regex Parsing
    const parsed = MfsParser.parse(params.sender || '', params.sms);
    if (!parsed.success) {
      return {
        success: false,
        stepFailed: 'Step 5: MFS Regex Parsing',
        error: 'SMS does not match any recognized MFS format',
      };
    }

    // 2. Financial Integrity Check
    if (!parsed.amount || parsed.amount <= 0 || !parsed.trxId) {
      return {
        success: false,
        stepFailed: 'Step 6/7: Financial Integrity Check',
        error: 'Invalid amount or missing TrxID in SMS',
      };
    }

    // 3. Ledger Insertion with Anti-Replay Duplicate Check
    const insertResult = await TransactionRepository.insert({
      merchantId: params.merchantId,
      deviceId: params.deviceId,
      provider: parsed.provider,
      trxId: parsed.trxId,
      amount: parsed.amount,
      senderNumber: parsed.sender,
      rawSms: params.sms,
      simSlot: params.simSlot,
      carrier: params.carrier,
      source: params.source,
    });

    if (insertResult.isDuplicate) {
      return {
        success: true,
        isDuplicate: true,
        parsed,
        error: 'Transaction already recorded in ledger. Double-spend blocked.',
      };
    }

    // 4. Auto-match matching pending invoice
    let matchedInvoice: InvoiceEntity | undefined;
    const pendingInvoices = await InvoiceRepository.findPendingByMerchantAndAmount(
      params.merchantId,
      parsed.amount
    );

    if (pendingInvoices.length > 0 && (parsed.trusted !== false || process.env.ALLOW_UNTRUSTED_SENDERS === 'true')) {
      const invoice = pendingInvoices[0];
      const lockRes = await TransactionRepository.verifyAndLock(
        params.merchantId,
        parsed.trxId,
        parsed.amount,
        invoice.invoice_id
      );

      if (lockRes.success) {
        await InvoiceRepository.updateStatus(
          invoice.invoice_id,
          'PAID',
          parsed.trxId,
          parsed.provider.toLowerCase()
        );
        matchedInvoice = invoice;
        TelegramService.sendPaymentAlert({
          amount: parsed.amount,
          provider: parsed.provider,
          trxId: parsed.trxId,
          invoiceId: invoice.invoice_id,
          customerName: invoice.customer_name,
        }).catch(() => {});
        events.emit('invoice.paid', { merchantId: params.merchantId, invoiceId: invoice.invoice_id, amount: parsed.amount, provider: parsed.provider, trxId: parsed.trxId, source: 'auto' });
        notifyPayment(params.merchantId, { amount: parsed.amount, provider: parsed.provider, invoiceId: invoice.invoice_id, trxId: parsed.trxId, customerName: invoice.customer_name }).catch(() => {});

        // Dispatch HMAC Webhook if URL configured
        if (invoice.webhook_url) {
          WebhookService.dispatch({
            merchantId: params.merchantId,
            invoiceId: invoice.invoice_id,
            webhookUrl: invoice.webhook_url,
            webhookSecret: params.webhookSecret,
            payload: {
              invoice_id: invoice.invoice_id,
              status: 'true',
              provider: parsed.provider.toLowerCase(),
              trx_id: parsed.trxId,
              amount: parsed.amount,
              timestamp: new Date().toISOString(),
            },
          });
        }
      }
    }

    if (!matchedInvoice) {
      // Unknown deposit (no open invoice with this amount) or untrusted sender: hold for manual review.
      const { dbService } = await import('../db/database.js');
      const held = dbService.insertUnmatchedSms({
        deviceId: params.deviceId,
        provider: parsed.provider,
        sender: params.sender,
        amount: parsed.amount,
        trxId: parsed.trxId,
        rawSms: params.sms,
        status: parsed.trusted === false ? 'SUSPICIOUS' : 'UNMATCHED',
      });
      if (held) events.emit('deposit.held', { merchantId: params.merchantId, amount: parsed.amount, provider: parsed.provider, suspicious: parsed.trusted === false });
      if (held) notifyHeldDeposit(params.merchantId, { amount: parsed.amount, provider: parsed.provider, suspicious: parsed.trusted === false }).catch(() => {});
    }

    return {
      success: true,
      parsed,
      matchedInvoice,
    };
  }
}

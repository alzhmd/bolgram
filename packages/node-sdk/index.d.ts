export interface SyncPayConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface CreateInvoiceParams {
  amount: number;
  order_id: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  callback_url?: string;
  success_url?: string;
  cancel_url?: string;
}

export interface InvoiceResponse {
  success: boolean;
  data: {
    invoice_id: string;
    amount: number;
    payment_url: string;
    qr_code?: string;
    order_id: string;
    expires_at: string;
  };
}

export interface VerifyResponse {
  success: boolean;
  data: {
    trx_id: string;
    amount: number;
    provider: 'bKash' | 'Nagad' | 'Rocket' | 'Upay';
    status: 'PAID' | 'PENDING' | 'FAILED';
    verified: boolean;
  };
}

export class SyncPayClient {
  constructor(config?: string | SyncPayConfig);
  createInvoice(params: CreateInvoiceParams): Promise<InvoiceResponse>;
  verifyTransaction(trxId: string): Promise<VerifyResponse>;
  getTransactions(): Promise<any>;
  getDevices(): Promise<any>;
}

export default SyncPayClient;

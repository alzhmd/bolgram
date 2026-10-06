import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { PaymentService } from '../services/payment.service.js';
import { MerchantService } from '../services/merchant.service.js';
import { InvoiceRepository } from '../db/repositories/invoice.repository.js';
import { MerchantRepository } from '../db/repositories/merchant.repository.js';
import { fraudShield, recordFailedVerification, clearVerificationAttempts } from '../middleware/fraud-shield.js';

// API Key extractor supporting Bolgram / Bolgram headers, query params, or body
function extractApiKey(request: FastifyRequest): string | undefined {
  const headerKey = request.headers['syncpay-api-key'] || request.headers['payflow-api-key'] || request.headers['x-api-key'] || request.headers['zini-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) {
    return headerKey.trim();
  }
  const authHeader = request.headers.authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token.startsWith('live_') || token.startsWith('sand_') || token.startsWith('zini_')) {
      return token;
    }
  }
  const query = request.query as Record<string, string | undefined>;
  if (query?.apikey && query.apikey.trim()) {
    return query.apikey.trim();
  }
  const body = request.body as Record<string, any> | undefined;
  if (body?.api_key && typeof body.api_key === 'string' && body.api_key.trim()) {
    return body.api_key.trim();
  }
  return undefined;
}

// Centralized payment URL resolver supporting custom merchant domains and brand slugs
async function resolvePaymentUrl(request: FastifyRequest, merchantId: string, invoiceId: string): Promise<string> {
  const host = request.headers.host || 'localhost:4000';
  const protocol = (request.headers['x-forwarded-proto'] as string) || request.protocol || 'http';
  let paymentUrl = `${protocol}://${host}/checkout?invoice_id=${invoiceId}`;
  try {
    const fullMerchant = await MerchantRepository.findById(merchantId);
    if (fullMerchant?.custom_domain && fullMerchant.has_custom_domain) {
      paymentUrl = `https://${fullMerchant.custom_domain}/checkout?invoice_id=${invoiceId}`;
    } else if (fullMerchant?.brand_slug) {
      paymentUrl = `${protocol}://${host}/pay/${fullMerchant.brand_slug}?invoice_id=${invoiceId}`;
    }
  } catch {}
  return paymentUrl;
}

// Request Validation Schemas
const payflowCreateInvoiceSchema = z.object({
  cus_name: z.string().optional(),
  cus_email: z.string().email('Invalid email address format').optional().or(z.literal('')),
  amount: z.number().positive('amount must be greater than 0'),
  metadata: z.record(z.any()).optional().refine((val) => {
    if (!val) return true;
    return JSON.stringify(val).length <= 1024;
  }, 'metadata must be valid JSON and stay within 1 KB'),
  redirect_url: z.string().url('redirect_url must be a valid URL'),
  cancel_url: z.string().url('cancel_url must be a valid URL').optional().or(z.literal('')),
  webhook_url: z.string().url('webhook_url must be a valid URL').optional().or(z.literal('')),
});

const payflowVerifyInvoiceSchema = z.object({
  invoice_id: z.string().min(1, 'invoice_id is required'),
});

const legacyCreateInvoiceSchema = z.object({
  api_key: z.string().optional(),
  customer_name: z.string().default('Valued Customer'),
  expected_amount: z.number().positive(),
  provider: z.string().max(40).default('card'),
  order_id: z.string().optional(),
});

const legacyVerifySchema = z.object({
  api_key: z.string().optional(),
  trx_id: z.string().min(4),
  expected_amount: z.number().positive(),
  order_id: z.string().optional(),
  invoice_id: z.string().optional(),
});

export async function paymentRoutes(fastify: FastifyInstance) {
  // ==========================================
  // 1. Bolgram Standard API: Create Invoice
  // POST /v1/payment/create & /api/v1/payment/create
  // ==========================================
  const handlePayflowCreateInvoice = async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return reply.status(401).send({
        status: false,
        message: 'Missing API key. Please provide syncpay-api-key header or ?apikey query parameter.',
      });
    }

    const authResult = await MerchantService.authenticateApiKey(apiKey);
    if (!authResult.authenticated || !authResult.merchant) {
      return reply.status(401).send({
        status: false,
        message: 'Invalid API Key. Only active merchant brands are allowed.',
      });
    }

    const parseResult = payflowCreateInvoiceSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        status: false,
        message: 'Validation failed.',
        errors: parseResult.error.errors,
      });
    }

    const { cus_name, cus_email, amount, metadata, redirect_url, cancel_url, webhook_url } = parseResult.data;

    const { invoice } = await PaymentService.createInvoice({
      merchantId: authResult.merchant.id,
      customerName: cus_name,
      customerEmail: cus_email || undefined,
      amount,
      metadata,
      redirectUrl: redirect_url,
      cancelUrl: cancel_url || undefined,
      webhookUrl: webhook_url || undefined,
    });

    const payment_url = await resolvePaymentUrl(request, authResult.merchant.id, invoice.invoice_id);

    return reply.status(201).send({
      status: true,
      message: 'Invoice created successfully.',
      invoice_id: invoice.invoice_id,
      payment_url,
    });
  };

  fastify.post('/v1/payment/create', handlePayflowCreateInvoice);
  fastify.post('/api/v1/payment/create', handlePayflowCreateInvoice);

  // ==========================================
  // 2. Bolgram Standard API: Verify Invoice
  // POST /v1/payment/verify & /api/v1/payment/verify
  // ==========================================
  const handlePayflowVerifyInvoice = async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return reply.status(401).send({
        status: false,
        message: 'Missing API key. Please provide syncpay-api-key header or ?apikey parameter.',
      });
    }

    const authResult = await MerchantService.authenticateApiKey(apiKey);
    if (!authResult.authenticated || !authResult.merchant) {
      return reply.status(401).send({
        status: false,
        message: 'Invalid API Key.',
      });
    }

    const parseResult = payflowVerifyInvoiceSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        status: false,
        message: 'Validation failed.',
        errors: parseResult.error.errors,
      });
    }

    const { invoice_id } = parseResult.data;
    const verifyResult = await PaymentService.verifyInvoice(invoice_id, authResult.merchant.id);

    if (!verifyResult.found || !verifyResult.invoice) {
      return reply.status(404).send({
        status: false,
        message: 'Invoice not found or does not belong to this merchant.',
      });
    }

    const invoice = verifyResult.invoice;
    return reply.send({
      cus_name: invoice.customer_name,
      cus_email: (invoice as any).customer_email || 'customer@example.com',
      amount: invoice.amount,
      invoice_id: invoice.invoice_id,
      payment_method: (invoice as any).payment_method || 'card',
      transaction_id: (invoice as any).trx_id || null,
      status: verifyResult.status,
    });
  };

  fastify.post('/v1/payment/verify', handlePayflowVerifyInvoice);
  fastify.post('/api/v1/payment/verify', handlePayflowVerifyInvoice);

  // ==========================================
  // 3. Checkout Settlement Endpoint
  // ==========================================
  fastify.post('/api/v1/payments/verify', { preHandler: [fraudShield] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = legacyVerifySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: 'Validation failed',
        details: parseResult.error.errors,
      });
    }

    const apiKey = extractApiKey(request);
    const { trx_id, expected_amount, order_id, invoice_id } = parseResult.data;

    let invoice: any;
    if (invoice_id) {
      invoice = await InvoiceRepository.findByInvoiceId(invoice_id);
    }

    let merchantId: string | undefined;
    if (apiKey) {
      const auth = await MerchantService.authenticateApiKey(apiKey);
      if (auth.authenticated) merchantId = auth.merchant?.id;
    } else if (invoice) {
      merchantId = invoice.merchant_id;
    }

    if (!merchantId) {
      return reply.status(401).send({ success: false, error: 'Invalid or missing API Key' });
    }

    const effectiveAmount = invoice ? invoice.amount : expected_amount;
    const effectiveOrderId = order_id || (invoice ? invoice.invoice_id : 'ORD_' + trx_id);

    const settleResult = await PaymentService.settleCheckout({
      merchantId,
      trxId: trx_id,
      amount: effectiveAmount,
      orderId: effectiveOrderId,
      invoiceId: invoice?.invoice_id,
    });

    if (!settleResult.success) {
      recordFailedVerification(request);
      return reply.status(400).send({
        success: false,
        verified: false,
        message: settleResult.reason,
      });
    }

    clearVerificationAttempts(request);

    return reply.send({
      success: true,
      verified: true,
      message: 'Payment verified successfully and locked.',
      redirect_url: settleResult.redirect_url,
      data: {
        trx_id: trx_id.toUpperCase(),
        amount: effectiveAmount,
        provider: settleResult.transaction?.provider || 'bKash',
        order_id: effectiveOrderId,
        invoice_id: invoice_id || null,
      },
    });
  });

  // ==========================================
  // 4. Legacy Create Invoice
  // ==========================================
  fastify.post('/api/v1/payments/create-invoice', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = legacyCreateInvoiceSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed' });
    }

    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return reply.status(401).send({ success: false, error: 'Missing API Key' });
    }

    const auth = await MerchantService.authenticateApiKey(apiKey);
    if (!auth.authenticated || !auth.merchant) {
      return reply.status(401).send({ success: false, error: 'Invalid API Key' });
    }

    const { customer_name, expected_amount, provider } = parseResult.data;
    const { invoice } = await PaymentService.createInvoice({
      merchantId: auth.merchant.id,
      customerName: customer_name,
      amount: expected_amount,
      redirectUrl: 'http://localhost:4000/success',
    });

    const checkout_url = await resolvePaymentUrl(request, auth.merchant.id, invoice.invoice_id);

    return reply.status(201).send({
      success: true,
      invoice_id: invoice.invoice_id,
      expected_amount: invoice.amount,
      provider: provider || 'bKash',
      expires_at: invoice.expires_at,
      checkout_url,
    });
  });

  // ==========================================
  // 5. Query Invoice Details by ID
  // ==========================================
  fastify.get('/api/v1/payments/invoice/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const invoice = await InvoiceRepository.findByInvoiceId(request.params.id);
    if (!invoice) {
      return reply.status(404).send({ success: false, error: 'Invoice not found' });
    }

    // Enrich response with merchant name for checkout header branding
    let merchant_name: string | null = null;
    let merchant_logo_url: string | null = null;
    if (invoice.merchant_id) {
      try {
        const { dbService } = await import('../db/database.js');
        const merchant = dbService.getMerchantById(invoice.merchant_id);
        if (merchant) {
          merchant_name = merchant.name || null;
        }
      } catch (_) {}
    }

    return reply.send({ success: true, invoice: { ...invoice, merchant_name, merchant_logo_url } });
  });

  // ==========================================
  // 5b. Real-Time Server-Sent Events (SSE) Stream
  // ==========================================
  fastify.get('/api/v1/payments/events/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const invoiceId = request.params.id;
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');

    const invoice = await InvoiceRepository.findByInvoiceId(invoiceId);
    if (!invoice) {
      reply.raw.write(`data: ${JSON.stringify({ error: 'Invoice not found' })}\n\n`);
      reply.raw.end();
      return;
    }

    reply.raw.write(`data: ${JSON.stringify({ status: invoice.status, invoice })}\n\n`);

    if (invoice.status === 'PAID' || invoice.status === 'EXPIRED') {
      reply.raw.end();
      return;
    }

    let closed = false;
    request.raw.on('close', () => {
      closed = true;
    });

    const interval = setInterval(async () => {
      if (closed) {
        clearInterval(interval);
        return;
      }
      try {
        const current = await InvoiceRepository.findByInvoiceId(invoiceId);
        if (current) {
          reply.raw.write(`data: ${JSON.stringify({ status: current.status, invoice: current })}\n\n`);
          if (current.status === 'PAID' || current.status === 'EXPIRED') {
            clearInterval(interval);
            reply.raw.end();
          }
        }
      } catch {
        clearInterval(interval);
        reply.raw.end();
      }
    }, 1000);
  });

  // ==========================================
  // 6. Generate QR Code for Checkout
  // ==========================================
  fastify.get('/api/v1/payment/qr', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { data?: string; size?: string; raw?: string; format?: string };
    const text = query.data || '01580397069';
    const size = parseInt(query.size || '280', 10);
    try {
      const acceptsImage = request.headers.accept?.includes('image/') || query.raw === '1' || query.format === 'image';
      if (acceptsImage) {
        const buffer = await QRCode.toBuffer(text, {
          margin: 1,
          width: size,
          color: { dark: '#111827', light: '#ffffff' },
        });
        return reply.type('image/png').send(buffer);
      }

      const dataUrl = await QRCode.toDataURL(text, {
        margin: 1,
        width: size,
        color: { dark: '#111827', light: '#ffffff' },
      });
      return reply.send({ success: true, qr: dataUrl });
    } catch (e: any) {
      return reply.status(500).send({ success: false, error: e.message });
    }
  });

  // ==========================================
  // 7. Get Active Payment Methods for Checkout
  // ==========================================
  fastify.get('/api/v1/payments/methods', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { invoice_id?: string; merchant_id?: string };
    let merchantId = query.merchant_id;

    if (query.invoice_id) {
      const invoice = await InvoiceRepository.findByInvoiceId(query.invoice_id);
      if (invoice && invoice.merchant_id) {
        merchantId = invoice.merchant_id;
      }
    }

    if (!merchantId) {
      merchantId = '00000000-0000-0000-0000-000000000101';
    }

    try {
      const { dbService } = await import('../db/database.js');
      // Never fall back to demo cards: a customer must only ever see the merchant's own cards.
      const methods = dbService.getPaymentMethods(merchantId, true);
      return reply.send({ success: true, methods });
    } catch (e: any) {
      return reply.status(500).send({ success: false, error: e.message });
    }
  });
}

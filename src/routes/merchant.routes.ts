import { randomBytes } from 'node:crypto';
import { merchantAuthHook } from '../middleware/auth.js';
import { merchantWebhookSecret } from '../utils/crypto.js';
import { WebhookService } from '../services/webhook.service.js';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import QRCode from 'qrcode';
import { MerchantService } from '../services/merchant.service.js';
import { DeviceService } from '../services/device.service.js';
import { TransactionService } from '../services/transaction.service.js';
import { EmailService } from '../services/email.service.js';
import { dbService } from '../db/database.js';
import { CryptoUtil } from '../utils/crypto.js';
import { MerchantRepository } from '../db/repositories/merchant.repository.js';

export async function merchantRoutes(fastify: FastifyInstance) {
  const DEMO_17DIGIT_MERCHANT_ID = '01711000000260923';
  const DEMO_MERCHANT_ID = '01711000000260923';
  const LEGACY_UUID_MERCHANT_ID = '00000000-0000-0000-0000-000000000101';
  const FALLBACK_MERCHANT_ID = 'm_demo_101';

  fastify.addHook('onRequest', merchantAuthHook);

  // Set by merchantAuthHook from a verified JWT or API key; headers are never trusted.
  function resolveMerchantId(request: FastifyRequest): string {
    const id = (request as any).merchantId as string | undefined;
    if (!id) throw new Error('Unauthenticated');
    return id;
  }


  function resolveAuthMerchantId(request: FastifyRequest): string {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { valid, payload } = CryptoUtil.verifyJwt(token);
      if (valid && payload?.id) {
        return payload.id;
      }
    }
    return resolveMerchantId(request);
  }

  // Get merchant dashboard stats
  fastify.get('/api/v1/merchant/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const merchantId = resolveMerchantId(request);
    const stats = await MerchantService.getMerchantStats(merchantId);
    return reply.send({
      success: true,
      data: stats || {
        todayRevenue: 0,
        todayCount: 0,
        totalVerified: 0,
        pendingCount: 0,
        failedCount: 0,
        devices: [],
      },
    });
  });

  // Get recent transactions feed
  fastify.get('/api/v1/merchant/transactions', async (request: FastifyRequest, reply: FastifyReply) => {
    const merchantId = resolveMerchantId(request);
    const txs = await MerchantService.getTransactions(merchantId, 50);
    return reply.send({ success: true, data: txs || [] });
  });

  // Simulate an incoming SMS (for dashboard test trigger)
  fastify.post('/api/v1/merchant/simulate-sms', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      provider?: 'bKash' | 'Nagad' | 'Rocket' | 'Upay';
      amount?: number;
      sender?: string;
      trx_id?: string;
      merchant_id?: string;
    };

    const provider = body.provider || 'bKash';
    const amount = body.amount || 1500;
    const sender = body.sender || '01712345678';
    const trxId = body.trx_id || ('TRX' + Math.random().toString(36).substring(2, 8).toUpperCase());
    const targetMerchantId = body.merchant_id || resolveMerchantId(request);

    let rawSms = '';
    let senderAddress = '';

    if (provider === 'bKash') {
      senderAddress = 'bKash';
      rawSms = `You have received Tk ${amount.toFixed(2)} from ${sender}. Fee Tk 0.00. Balance Tk 15,200.00. TrxID ${trxId} at ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
    } else if (provider === 'Nagad') {
      senderAddress = '16167';
      rawSms = `Received Amount: Tk ${amount.toFixed(2)} from ${sender}. TxnID: ${trxId}. Balance: Tk 18,400.00`;
    } else if (provider === 'Upay') {
      senderAddress = '16268';
      rawSms = `You have received Tk ${amount.toFixed(2)} from ${sender}. Fee Tk 0.00. Balance Tk 5,200.00. TrxID ${trxId} at ${new Date().toLocaleDateString()}`;
    } else {
      senderAddress = '16216';
      rawSms = `Tk ${amount.toFixed(2)} received from ${sender}. TxnId: ${trxId}. Balance: Tk 5,200.00`;
    }

    const ingest = await TransactionService.ingestSms({
      merchantId: targetMerchantId,
      deviceId: '00000000-0000-0000-0000-000000000001',
      sms: rawSms,
      sender: senderAddress,
    });

    return reply.status(201).send({
      success: true,
      message: 'Simulated SMS ingested into system',
      isDuplicate: ingest.isDuplicate || false,
      transaction: {
        provider,
        trx_id: trxId,
        amount,
        sender,
        raw_sms: rawSms,
      },
    });
  });

  // Get merchant invoices
  fastify.get('/api/v1/merchant/invoices', async (request: FastifyRequest, reply: FastifyReply) => {
    const merchantId = resolveMerchantId(request);
    const invoices = await MerchantService.getInvoices(merchantId, 100);
    return reply.send({ success: true, data: invoices || [] });
  });

  // Get merchant devices
  fastify.get('/api/v1/merchant/devices', async (request: FastifyRequest, reply: FastifyReply) => {
    const merchantId = resolveAuthMerchantId(request);
    const devices = await DeviceService.listMerchantDevices(merchantId);
    return reply.send({ success: true, data: devices || [] });
  });

  const PLAN_DEVICE_LIMITS: Record<string, number> = {
    FREE: 1,
    STARTER: 1,
    PRO: 2,
    BUSINESS: 3,
    ENTERPRISE: 5,
    AGENCY: 4,
    ELITE: 10,
    GROWTH: 20,
    SCALE: 30,
    MEGA: 50,
  };

  // Register new device
  fastify.post('/api/v1/merchant/devices', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { device_name?: string; sim_number?: string; merchant_id?: string };
    const merchantId = body.merchant_id || resolveMerchantId(request);
    const deviceName = body.device_name || 'Android Forwarder';

    try {
      const merchant = await MerchantRepository.findById(merchantId);
      const plan = (merchant?.plan || 'STARTER').toUpperCase();
      const limit = PLAN_DEVICE_LIMITS[plan] || 5;
      const existingDevices = await DeviceService.listMerchantDevices(merchantId);

      if (existingDevices && existingDevices.length >= limit) {
        return reply.status(403).send({
          success: false,
          error: `Device limit reached. Your ${plan} plan allows up to ${limit} device(s). Please upgrade your plan.`,
          limit,
          current: existingDevices.length,
        });
      }
    } catch (e: any) {
      fastify.log.warn(`Device limit verification notice: ${e.message}`);
    }

    const { device, token } = await DeviceService.registerDevice({
      merchantId,
      deviceName,
    });

    return reply.status(201).send({ success: true, data: device, token });
  });

  // Delete device
  fastify.delete('/api/v1/merchant/devices/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const deviceId = request.params.id;
    const merchantId = resolveMerchantId(request);
    try {
      await DeviceService.removeDevice(deviceId, merchantId);
    } catch (e: any) {
      fastify.log.warn(`Failed removing device from merchantId ${merchantId}: ${e.message}`);
    }
    if (merchantId === DEMO_MERCHANT_ID || merchantId === FALLBACK_MERCHANT_ID) {
      try {
        await DeviceService.removeDevice(deviceId, FALLBACK_MERCHANT_ID);
      } catch (e: any) {
        fastify.log.warn(`Failed removing device from FALLBACK_MERCHANT_ID: ${e.message}`);
      }
    }
    try {
      dbService.deleteDevice(deviceId, merchantId);
    } catch (e: any) {
      fastify.log.warn(`Failed removing device from dbService: ${e.message}`);
    }
    return reply.send({ success: true, message: 'Device deleted successfully' });
  });

  // Get merchant API keys
  fastify.get('/api/v1/merchant/api-keys', async (request: FastifyRequest, reply: FastifyReply) => {
    const merchantId = resolveMerchantId(request);
    const keys = await MerchantService.getApiKeys(merchantId);
    return reply.send({ success: true, data: keys || [] });
  });

  // Generate new API key
  fastify.post('/api/v1/merchant/api-keys', async (request: FastifyRequest, reply: FastifyReply) => {
    const merchantId = resolveMerchantId(request);
    const body = (request.body as { name?: string; environment?: 'production' | 'sandbox' }) || {};
    const name = body.name?.trim() || 'Website Integration Key';
    const env = body.environment === 'sandbox' ? 'sandbox' : 'production';
    const { key, entity } = await MerchantService.generateApiKey(merchantId, name, env);
    return reply.status(201).send({ success: true, data: { ...entity, secret_key: key } });
  });

  // Revoke API key
  fastify.post('/api/v1/merchant/api-keys/:id/revoke', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const merchantId = resolveMerchantId(request);
    const keyId = request.params.id;
    const { ApiKeyRepository } = await import('../db/repositories/api-key.repository.js');
    await ApiKeyRepository.revoke(keyId, merchantId);
    return reply.send({ success: true, message: 'API key revoked successfully' });
  });

  fastify.delete('/api/v1/merchant/api-keys/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const merchantId = resolveMerchantId(request);
    const keyId = request.params.id;
    const { ApiKeyRepository } = await import('../db/repositories/api-key.repository.js');
    await ApiKeyRepository.revoke(keyId, merchantId);
    return reply.send({ success: true, message: 'API key revoked successfully' });
  });

  // Unified Merchant Credentials (Merchant ID, API Key, Webhook Secret)
  fastify.get('/api/v1/merchant/credentials', async (request: FastifyRequest, reply: FastifyReply) => {
    const merchantId = resolveMerchantId(request);
    const keys = await MerchantService.getApiKeys(merchantId);
    const primaryKey = keys && keys.length > 0 ? keys[0] : null;
    const merchant = await MerchantRepository.findById(merchantId);
    const webhookSecret = merchantWebhookSecret(merchantId);

    return reply.send({
      success: true,
      data: {
        merchant_id: merchantId,
        api_key: primaryKey?.secret_key || (merchant as any)?.api_key || 'live_sk_no78zeijjjdrjmfe2tmmmi',
        webhook_secret: webhookSecret,
        webhook_url: merchant?.webhook_url || '',
        business_name: merchant?.business_name || 'My Store',
        environment: primaryKey?.environment || 'production',
      },
    });
  });

  // Unknown / suspicious deposits (no matching invoice, untrusted sender): manual review queue
  fastify.get('/api/v1/merchant/unmatched', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ success: true, data: dbService.getUnmatchedSmsForMerchant(resolveMerchantId(request)) });
  });

  fastify.post('/api/v1/merchant/unmatched/:id/assign', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const merchantId = resolveMerchantId(request);
    const { invoiceId } = (request.body || {}) as { invoiceId?: string };
    if (!invoiceId) return reply.status(400).send({ success: false, error: 'invoiceId is required' });
    try {
      const inv = dbService.assignUnmatchedSmsForMerchant(merchantId, request.params.id, invoiceId);
      if (inv.webhook_url) {
        WebhookService.dispatch({
          merchantId,
          invoiceId,
          webhookUrl: inv.webhook_url,
          payload: { invoice_id: invoiceId, status: 'true', provider: inv.provider, trx_id: inv.trx_id, amount: inv.amount, timestamp: new Date().toISOString() },
        }).catch(() => {});
      }
      return reply.send({ success: true, data: { invoice_id: invoiceId, status: 'PAID' } });
    } catch (e: any) {
      return reply.status(409).send({ success: false, error: e.message });
    }
  });

  fastify.post('/api/v1/merchant/unmatched/:id/reject', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { reason } = (request.body || {}) as { reason?: string };
    const ok = dbService.rejectUnmatchedSmsForMerchant(resolveMerchantId(request), request.params.id, reason || '');
    return ok ? reply.send({ success: true }) : reply.status(404).send({ success: false, error: 'Not found' });
  });

  // Get chart data
  fastify.get('/api/v1/merchant/chart-data', async (request: FastifyRequest, reply: FastifyReply) => {
    const merchantId = resolveMerchantId(request);
    const query = request.query as { days?: string };
    const days = parseInt(query.days || '7', 10);
    const chartData = dbService.getChartData(merchantId, days);
    return reply.send({ success: true, data: chartData || [] });
  });

  // Device Pairing QR Code Generation
  fastify.get('/api/v1/merchant/devices/:id/qr', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    let deviceId = request.params.id;
    const merchantId = resolveMerchantId(request);
    let dev: any = null;

    try {
      const devices = (await DeviceService.listMerchantDevices(merchantId)) || [];
      if (deviceId === 'primary' || deviceId === 'auto' || deviceId === 'default') {
        dev = devices[0];
      } else {
        dev = devices.find(d => d.id === deviceId) || devices[0];
      }
    } catch (e: any) {
      fastify.log.warn(`DeviceService.listMerchantDevices error: ${e.message}`);
    }

    if (!dev) {
      try {
        const { device, token: rawToken } = await DeviceService.registerDevice({
          merchantId,
          deviceName: 'Android Forwarder 1',
        });
        dev = { ...device, device_token: rawToken };
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          error: `Failed to initialize device for pairing: ${err.message}`,
        });
      }
    }

    const token = dev ? (dev as any).device_token || dev.id : deviceId;
    const host = request.headers.host || 'bolgram.ir';
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    const protocol = request.headers['x-forwarded-proto'] || (isLocal ? 'http' : 'https');
    const serverUrl = isLocal ? 'http://10.10.26.121:4000' : `${protocol}://${host}`;

    let payloadMerchantId = dev?.merchant_id || merchantId || DEMO_MERCHANT_ID;
    if (payloadMerchantId === LEGACY_UUID_MERCHANT_ID || payloadMerchantId === FALLBACK_MERCHANT_ID) {
      payloadMerchantId = DEMO_17DIGIT_MERCHANT_ID;
    }

    let merchantBusinessName = 'Bolgram Merchant Store';
    try {
      const merchant = await MerchantRepository.findById(payloadMerchantId);
      if (merchant?.business_name) {
        merchantBusinessName = merchant.business_name;
      }
    } catch (_) {}

    const pairingPayload = {
      backend_url: serverUrl,
      merchant_id: payloadMerchantId,
      merchant_name: merchantBusinessName,
      business_name: merchantBusinessName,
      device_id: dev?.id || deviceId,
      device_token: token,
      device_name: dev?.device_name || 'Bolgram Device',
    };

    try {
      const qrDataUrl = await QRCode.toDataURL(JSON.stringify(pairingPayload), {
        margin: 2,
        width: 320,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      });

      return reply.send({
        success: true,
        qr_code: qrDataUrl,
        payload: pairingPayload,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // Merchant Subscription Package & Website Quotas
  fastify.get('/api/v1/merchant/subscription', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      success: true,
      data: {
        plan_name: 'Growth Merchant Plan',
        tier: 'PRO',
        status: 'ACTIVE',
        billing_cycle: 'Monthly',
        renews_at: '2026-10-19',
        quotas: {
          websites: {
            allowed: 5,
            connected: 2,
            available: 3,
            percent: 40,
          },
          devices: {
            allowed: 3,
            connected: 1,
            available: 2,
            percent: 33,
          },
          monthly_volume_bdt: {
            allowed: 500000,
            used: 48500,
            available: 451500,
            percent: 9.7,
          },
          api_rate_limit: '120 req / min',
          webhook_sla: '99.99%',
        },
        connected_websites: [
          {
            id: 'site_1',
            name: 'Primary E-commerce Store',
            domain: 'https://mystore-bd.com',
            platform: 'WooCommerce',
            webhook_url: 'https://mystore-bd.com/wp-json/payflow/v1/webhook',
            status: 'ACTIVE',
            created_at: '2026-08-15',
          },
          {
            id: 'site_2',
            name: 'EdTech Portal',
            domain: 'https://learncourses.io',
            platform: 'Next.js Custom',
            webhook_url: 'https://learncourses.io/api/payflow-webhook',
            status: 'ACTIVE',
            created_at: '2026-09-02',
          },
        ],
      },
    });
  });

  // Connect new website under package quota
  fastify.post('/api/v1/merchant/websites', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { name: string; domain: string; platform?: string; webhook_url?: string };
    if (!body.domain) {
      return reply.status(400).send({ success: false, error: 'Website domain is required' });
    }
    const newSite = {
      id: 'site_' + Math.random().toString(36).substring(2, 8),
      name: body.name || body.domain,
      domain: body.domain,
      platform: body.platform || 'Custom Web',
      webhook_url: body.webhook_url || `${body.domain}/api/webhook`,
      status: 'ACTIVE',
      created_at: new Date().toISOString().split('T')[0],
    };
    return reply.status(201).send({ success: true, data: newSite, message: 'Website connected to Bolgram gateway' });
  });

  // ==========================================
  // Merchant Payment Methods & Instruction Management
  // ==========================================
  fastify.get('/api/v1/merchant/payment-methods', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const merchantId = resolveMerchantId(request);
      const methods = dbService.getPaymentMethods(merchantId, false);
      return reply.send({ success: true, data: methods });
    } catch (e: any) {
      return reply.status(500).send({ success: false, error: e.message });
    }
  });

  fastify.post('/api/v1/merchant/payment-methods', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const merchantId = resolveMerchantId(request);
      const body = request.body as any;
      if (!body.title || !body.account_number || !body.provider_type) {
        return reply.status(400).send({
          success: false,
          error: 'Missing required fields: title, provider_type, account_number are required',
        });
      }

      const method = dbService.upsertPaymentMethod({
        id: body.id,
        merchant_id: merchantId,
        provider_type: body.provider_type,
        title: body.title,
        badge: body.badge,
        account_number: body.account_number,
        account_name: body.account_name,
        bank_name: body.bank_name,
        branch_name: body.branch_name,
        routing_number: body.routing_number,
        sender_label: body.sender_label,
        trx_label: body.trx_label,
        instructions: body.instructions,
        theme_color: body.theme_color,
        is_active: body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1,
        sort_order: body.sort_order !== undefined ? Number(body.sort_order) : 0,
        qr_code_url: body.qr_code_url !== undefined ? body.qr_code_url : undefined,
      });

      return reply.send({
        success: true,
        data: method,
        message: 'Payment channel updated successfully',
      });
    } catch (e: any) {
      return reply.status(500).send({ success: false, error: e.message });
    }
  });

  fastify.patch('/api/v1/merchant/payment-methods/:id/toggle', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const merchantId = resolveMerchantId(request);
      const body = request.body as { is_active: boolean };
      const res = dbService.togglePaymentMethod(request.params.id, merchantId, body.is_active);
      return reply.send({ success: true, data: res });
    } catch (e: any) {
      return reply.status(500).send({ success: false, error: e.message });
    }
  });

  fastify.delete('/api/v1/merchant/payment-methods/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const merchantId = resolveMerchantId(request);
      const res = dbService.deletePaymentMethod(request.params.id, merchantId);
      return reply.send({ success: true, data: res, message: 'Payment method removed' });
    } catch (e: any) {
      return reply.status(500).send({ success: false, error: e.message });
    }
  });

  // Merchant Auth: Register
  fastify.post('/api/v1/merchant/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { name?: string; email?: string; business_name?: string; password?: string; phone?: string };
    if (!body.name || !body.email || !body.password) {
      return reply.status(400).send({ success: false, error: 'Name, email, and password are required' });
    }
    if (body.password.length < 6) {
      return reply.status(400).send({ success: false, error: 'Password must be at least 6 characters' });
    }

    const email = body.email.trim().toLowerCase();
    const existing = await MerchantRepository.findByEmail(email);
    if (existing) {
      return reply.status(409).send({ success: false, error: 'A merchant account with this email already exists' });
    }

    const passwordHash = CryptoUtil.hashPassword(body.password);
    const cleanPhone = (body.phone || '01700000000').replace(/\D/g, '').slice(-11).padStart(11, '0');
    const d = new Date();
    const dateStr = String(d.getFullYear()).slice(-2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    void cleanPhone; void dateStr;
    const id = 'm_' + randomBytes(9).toString('hex');
    const apiKey = 'live_sk_' + randomBytes(24).toString('hex');
    const businessName = body.business_name || body.name + ' Store';

    // 1. Sync to Supabase (if available)
    try {
      await MerchantRepository.create({
        id,
        business_name: businessName,
        email,
        phone: body.phone,
        password_hash: passwordHash,
      });

      const { ApiKeyRepository } = await import('../db/repositories/api-key.repository.js');
      await ApiKeyRepository.create({
        merchantId: id,
        name: 'Default Live Key',
        rawApiKey: apiKey,
      });
    } catch (e: any) {
      console.warn('Supabase merchant create notice:', e?.message);
    }

    // 2. Always persist into local SQLite database for instant Admin Panel visibility
    try {
      dbService.insertMerchant({
        id,
        name: businessName,
        api_key: apiKey,
        webhook_url: '',
        email,
        phone: body.phone || '',
        status: 'ACTIVE',
        plan: 'FREE',
        payment_status: 'FREE',
        password_hash: passwordHash,
      });
    } catch (e: any) {
      console.warn('Local SQLite insertMerchant notice:', e?.message);
    }

    // 3. Dispatch Welcome Email asynchronously
    EmailService.sendMerchantWelcomeEmail({
      to: email,
      businessName,
      merchantName: body.name,
      apiKey,
      loginUrl: 'https://bolgram.ir/dashboard',
    }).catch((err: any) => console.warn('[MerchantRoute] Welcome email notice:', err?.message));

    const token = CryptoUtil.signJwt({
      id,
      email,
      name: businessName,
      role: 'merchant',
    });

    return reply.status(201).send({
      success: true,
      merchant: {
        id,
        name: businessName,
        email,
        phone: body.phone || '',
        status: 'ACTIVE',
        plan: 'FREE',
        payment_status: 'FREE',
        api_key: apiKey,
      },
      token,
      message: 'Merchant account registered successfully',
    });
  });

  // Merchant Auth: Login
  fastify.post('/api/v1/merchant/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return reply.status(400).send({ success: false, error: 'Email and password are required' });
    }

    const email = body.email.trim().toLowerCase();
    const merchant = await MerchantRepository.findByEmail(email);

    if (!merchant) {
      return reply.status(401).send({ success: false, error: 'Invalid email or password' });
    }

    if (merchant.password_hash) {
      const valid = CryptoUtil.verifyPassword(body.password, merchant.password_hash);
      if (!valid) {
        return reply.status(401).send({ success: false, error: 'Invalid email or password' });
      }
    } else {
      return reply.status(401).send({ success: false, error: 'Invalid email or password' });
    }

    let apiKey = (merchant as any).api_key || 'live_sk_no78zeijjjdrjmfe2tmmmi';
    try {
      const { ApiKeyRepository } = await import('../db/repositories/api-key.repository.js');
      const keys = await ApiKeyRepository.listByMerchant(merchant.id);
      if (keys && keys.length > 0 && keys[0].secret_key) {
        apiKey = keys[0].secret_key;
      }
    } catch {}

    const token = CryptoUtil.signJwt({
      id: merchant.id,
      email: merchant.email,
      name: merchant.business_name,
      role: 'merchant',
    });

    return reply.send({
      success: true,
      merchant: {
        id: merchant.id,
        name: merchant.business_name,
        email: merchant.email,
        phone: merchant.phone || '',
        status: merchant.status || 'ACTIVE',
        plan: merchant.plan || 'FREE',
        payment_status: merchant.payment_status || 'FREE',
        payment_note: merchant.payment_note || '',
        api_key: apiKey,
      },
      token,
      message: 'Authentication successful',
    });
  });

  // Merchant Auth: Direct Google OAuth (No Supabase dependency)
  fastify.post('/api/v1/merchant/auth/google', async (_request: FastifyRequest, reply: FastifyReply) => {
    // Upstream trusted the posted email without verifying a Google ID token. Disabled.
    return reply.status(410).send({ success: false, error: 'Google sign-in is disabled' });
  });
  // Merchant Auth: Current User (Session verification)
  fastify.get('/api/v1/merchant/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ success: false, error: 'Authorization token required' });
    }
    const token = authHeader.substring(7);
    const { valid, payload } = CryptoUtil.verifyJwt(token);
    if (!valid || !payload) {
      return reply.status(401).send({ success: false, error: 'Invalid or expired session token' });
    }
    const merchant = await MerchantRepository.findById(payload.id);
    return reply.send({
      success: true,
      user: payload,
      merchant: merchant || null,
    });
  });

  // ==========================================
  // Merchant Branding & Custom Domain Endpoints
  // ==========================================

  // 1. Get current merchant branding configuration
  fastify.get('/api/v1/merchant/branding', async (request: FastifyRequest, reply: FastifyReply) => {
    const merchantId = resolveAuthMerchantId(request);

    const merchant = await MerchantRepository.findById(merchantId);
    if (!merchant) {
      return reply.status(404).send({ success: false, error: 'Merchant account not found' });
    }

    const currentPlan = (merchant.plan || 'starter').toLowerCase();
    const canUseCustomDomain = ['enterprise', 'ultra', 'growth', 'scale', 'mega'].includes(currentPlan) || Boolean(merchant.has_custom_domain);
    const canUseBrandSlug = ['standard', 'pro', 'business', 'agency', 'elite', 'enterprise', 'ultra', 'growth', 'scale', 'mega'].includes(currentPlan) || Boolean(merchant.has_custom_domain);

    const host = request.headers.host || 'localhost:4000';
    const protocol = (request.headers['x-forwarded-proto'] as string) || request.protocol || 'http';

    return reply.send({
      success: true,
      data: {
        merchant_id: merchant.id,
        business_name: merchant.business_name,
        brand_slug: merchant.brand_slug || '',
        custom_domain: merchant.custom_domain || '',
        has_custom_domain: Boolean(merchant.has_custom_domain),
        brand_logo_url: merchant.brand_logo_url || '',
        plan: merchant.plan || 'starter',
        can_use_slug: canUseBrandSlug,
        can_use_custom_domain: canUseCustomDomain,
        branded_checkout_url: merchant.brand_slug ? `${protocol}://${host}/pay/${merchant.brand_slug}` : `${protocol}://${host}/checkout`,
        custom_domain_checkout_url: merchant.custom_domain ? `https://${merchant.custom_domain}/checkout` : null,
        dns_cname_target: 'cname.bolgram.ir',
      },
    });
  });

  // 2. Save or update merchant branding configuration
  fastify.post('/api/v1/merchant/branding', async (request: FastifyRequest, reply: FastifyReply) => {
    const merchantId = resolveAuthMerchantId(request);

    const merchant = await MerchantRepository.findById(merchantId);
    if (!merchant) {
      return reply.status(404).send({ success: false, error: 'Merchant not found' });
    }

    const body = request.body as {
      brand_slug?: string;
      custom_domain?: string;
      brand_logo_url?: string;
    };

    let cleanSlug = body.brand_slug !== undefined ? body.brand_slug.toLowerCase().trim() : undefined;
    if (cleanSlug) {
      cleanSlug = cleanSlug.replace(/[^a-z0-9-_]/g, '');
      if (cleanSlug.length < 3) {
        return reply.status(400).send({ success: false, error: 'Store Slug must be at least 3 characters long (letters, numbers, hyphens).' });
      }

      // Check for reserved words
      const reserved = ['checkout', 'pay', 'api', 'admin', 'dashboard', 'login', 'docs', 'app', 'download', 'v1'];
      if (reserved.includes(cleanSlug)) {
        return reply.status(400).send({ success: false, error: `Slug "${cleanSlug}" is reserved. Please choose another name.` });
      }

      // Check uniqueness
      const existing = await MerchantRepository.findBySlug(cleanSlug);
      if (existing && existing.id !== merchant.id) {
        return reply.status(409).send({ success: false, error: `The store slug "${cleanSlug}" is already taken by another merchant.` });
      }
    }

    let cleanDomain = body.custom_domain !== undefined ? body.custom_domain.toLowerCase().trim().replace(/https?:\/\//, '').replace(/\/.*$/, '') : undefined;
    if (cleanDomain) {
      const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,10}(:[0-9]{1,5})?$/;
      if (!domainRegex.test(cleanDomain)) {
        return reply.status(400).send({ success: false, error: 'Invalid domain format. Example: pay.yourstore.com' });
      }

      const existingDomain = await MerchantRepository.findByDomain(cleanDomain);
      if (existingDomain && existingDomain.id !== merchant.id) {
        return reply.status(409).send({ success: false, error: `The custom domain "${cleanDomain}" is already registered.` });
      }
    }

    const currentPlan = (merchant.plan || 'starter').toLowerCase();
    const canUseCustomDomain = ['enterprise', 'ultra', 'growth', 'scale', 'mega'].includes(currentPlan) || Boolean(merchant.has_custom_domain);

    await MerchantRepository.updateBranding(merchant.id, {
      brand_slug: cleanSlug,
      custom_domain: cleanDomain,
      brand_logo_url: body.brand_logo_url,
      has_custom_domain: canUseCustomDomain ? 1 : 0,
    });

    const host = request.headers.host || 'localhost:4000';
    const protocol = (request.headers['x-forwarded-proto'] as string) || request.protocol || 'http';

    return reply.send({
      success: true,
      message: 'Branding & custom domain configuration saved successfully!',
      data: {
        brand_slug: cleanSlug || '',
        custom_domain: cleanDomain || '',
        branded_checkout_url: cleanSlug ? `${protocol}://${host}/pay/${cleanSlug}` : `${protocol}://${host}/checkout`,
        custom_domain_checkout_url: cleanDomain ? `https://${cleanDomain}/checkout` : null,
      },
    });
  });

  // 3. Public Lookup for Checkout Branding (by slug or domain)
  fastify.get('/api/v1/merchant/brand-info', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { slug?: string; domain?: string };
    let merchant: any = null;

    if (query.slug) {
      merchant = await MerchantRepository.findBySlug(query.slug);
    } else if (query.domain) {
      merchant = await MerchantRepository.findByDomain(query.domain);
    }

    if (!merchant) {
      return reply.status(404).send({ success: false, error: 'Branded store not found' });
    }

    return reply.send({
      success: true,
      data: {
        merchant_id: merchant.id,
        business_name: merchant.business_name,
        brand_slug: merchant.brand_slug,
        brand_logo_url: merchant.brand_logo_url || null,
        support_phone: merchant.phone || null,
      },
    });
  });
}

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DeviceService, appLatest, bankSenders, ensureDeviceSchema, tokenFromRequest } from '../services/device.service.js';
import { TransactionService } from '../services/transaction.service.js';
import { GuardError, checkLimit } from '../services/events.js';
import { dbService } from '../db/database.js';

const db = () => (dbService as any).db as import('node:sqlite').DatabaseSync;

/**
 * Ingest payload. The Android app sends `{ sms, sender }` (token in the `X-Device-Token` header or, for
 * older builds, in `device_id`). iPhone Shortcuts send `{ sender, body }` with the same header.
 */
const ingestSchema = z.object({
  device_id: z.string().max(200).optional(),
  device_token: z.string().max(200).optional(),
  sms: z.string().max(4000).optional(),
  body: z.string().max(4000).optional(),
  text: z.string().max(4000).optional(),
  message: z.string().max(4000).optional(),
  sender: z.string().max(80).optional(),
  received_at: z.string().max(60).optional(),
  sim_slot: z.number().optional(),
  carrier: z.string().max(60).optional(),
  source: z.string().max(40).optional(),
});

const legacySyncSchema = z.object({
  device_token: z.string(),
  sender: z.string().optional(),
  raw_sms: z.string(),
  sim_slot: z.number().optional(),
  carrier: z.string().optional(),
  source: z.string().optional(),
});

const heartbeatSchema = z.object({
  device_token: z.string().optional(),
  device_id: z.string().optional(),
  battery_level: z.number().optional(),
  battery_temp: z.number().optional(),
  is_charging: z.boolean().optional(),
  charger_type: z.string().optional(),
  free_ram_mb: z.number().optional(),
  sim_slots: z.any().optional(),
  device_name: z.string().optional(),
  device_model: z.string().optional(),
  android_version: z.string().optional(),
  app_version: z.string().optional(),
  sim_number: z.string().optional(),
});

const pairSchema = z.object({
  code: z.string().min(4).max(20),
  device_name: z.string().max(80).optional(),
  device_model: z.string().max(80).optional(),
  android_version: z.string().max(40).optional(),
  app_version: z.string().max(40).optional(),
});

export async function deviceRoutes(fastify: FastifyInstance) {
  ensureDeviceSchema();

  /**
   * Pairing: the app exchanges the one-time code from the panel (typed or scanned from the QR)
   * for a long-lived device token. Public, strictly rate limited.
   * POST /api/v1/device/pair
   */
  fastify.post('/api/v1/device/pair', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = pairSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: 'invalid_payload', message: 'کد اتصال معتبر نیست' });
    const b = parsed.data;
    const code = DeviceService.normalizeCode(b.code);
    const row = code.length === 8 ? DeviceService.pairCodeRow(code) : null;
    if (!row || row.used_at || row.expires_at <= Date.now()) {
      return reply.status(404).send({ success: false, error: 'invalid_code', message: 'کد اتصال اشتباه است یا منقضی شده؛ در پنل کد جدید بسازید' });
    }
    try {
      checkLimit(row.merchant_id, 'devices', DeviceService.activeCount(row.merchant_id));
    } catch (e) {
      if (e instanceof GuardError) return reply.status(e.status).send({ success: false, error: e.code, message: e.message });
      throw e;
    }
    const merchantId = DeviceService.consumePairCode(code);
    if (!merchantId) return reply.status(404).send({ success: false, error: 'invalid_code', message: 'کد اتصال اشتباه است یا منقضی شده؛ در پنل کد جدید بسازید' });
    const model = (b.device_model || '').trim() || null;
    const name = (b.device_name || '').trim().slice(0, 60) || model || 'گوشی اندروید';
    const { id, token } = DeviceService.createDevice({ merchantId, name, kind: 'android', model, androidVersion: b.android_version || null, appVersion: b.app_version || null });
    DeviceService.linkPairCode(code, id);
    const m = db().prepare('SELECT name, handle FROM merchants WHERE id = ?').get(merchantId) as any;
    return reply.status(201).send({
      success: true,
      device_id: id,
      device_token: token,
      device_name: name,
      merchant_name: m?.name || m?.handle || '',
    });
  });

  /** Trusted bank SMS senders so the app can filter locally. GET /api/v1/device/senders */
  fastify.get('/api/v1/device/senders', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await DeviceService.authenticateDevice(tokenFromRequest(request.headers as any));
    if (!auth.authenticated) return reply.status(401).send({ success: false, error: 'unauthorized', message: 'توکن دستگاه معتبر نیست' });
    return reply.send({ success: true, ...bankSenders() });
  });

  /**
   * Ingestion API (9-step verification + instant invoice matching)
   * POST /api/v1/device/sms/ingest
   */
  fastify.post('/api/v1/device/sms/ingest', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = ingestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        step_failed: 'Payload Validation',
        errors: parseResult.error.issues,
      });
    }

    const data = parseResult.data;
    const sms = data.sms ?? data.body ?? data.text ?? data.message ?? '';
    const token = tokenFromRequest(request.headers as any, data.device_id, data.device_token);
    if (!sms.trim()) {
      return reply.status(400).send({ success: false, step_failed: 'Payload Validation', error: 'sms body is required' });
    }
    if (!token) {
      return reply.status(401).send({ success: false, step_failed: 'Step 1: Device Authentication', error: 'Device token missing' });
    }

    // STEP 1, 2 & 3: Device valid, active and belongs to active merchant?
    const auth = await DeviceService.authenticateDevice(token);
    if (!auth.authenticated || !auth.device || !auth.merchant) {
      const isUnregistered = auth.error?.includes('not registered') || auth.error?.includes('invalid token');
      return reply.status(isUnregistered ? 401 : 403).send({
        success: false,
        step_failed: isUnregistered ? 'Step 1: Device Authentication' : 'Step 3: Merchant Verification',
        error: auth.error,
      });
    }

    // Shortcut devices have no heartbeat: every forwarded SMS counts as a sign of life.
    await DeviceService.recordHeartbeat(token);

    const ingest = await TransactionService.ingestSms({
      merchantId: auth.merchant.id,
      deviceId: auth.device.id,
      sms,
      sender: data.sender,
      webhookSecret: (auth.merchant as any).webhook_secret,
      simSlot: data.sim_slot,
      carrier: data.carrier,
      source: data.source || ((auth.device as any).kind === 'ios_shortcut' ? 'ios_shortcut' : undefined),
    });

    if (ingest.isDuplicate) {
      return reply.status(200).send({
        success: true,
        step: 'Step 4/9: Anti-Replay Duplicate Protection',
        isDuplicate: true,
        message: 'Transaction already recorded in ledger. Double-spend blocked.',
        trxId: ingest.parsed?.trxId,
      });
    }

    if (!ingest.success) {
      return reply.status(422).send({
        success: false,
        step_failed: ingest.stepFailed,
        error: ingest.error,
      });
    }

    return reply.status(201).send({
      success: true,
      message: 'Transaction successfully ingested and ledger updated',
      transaction: {
        provider: ingest.parsed?.provider,
        trx_id: ingest.parsed?.trxId,
        amount: ingest.parsed?.amount,
        sender: ingest.parsed?.sender,
      },
      matched_invoice_id: ingest.matchedInvoice?.invoice_id || null,
    });
  });

  /**
   * Backward-compatible legacy sync route
   */
  fastify.post('/api/v1/device/sync', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = legacySyncSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ success: false, error: 'Invalid payload structure' });
    }

    const { device_token, sender, raw_sms } = parseResult.data;
    const auth = await DeviceService.authenticateDevice(device_token);
    if (!auth.authenticated || !auth.device || !auth.merchant) {
      return reply.status(401).send({ success: false, error: 'Unauthorized device token' });
    }

    await DeviceService.recordHeartbeat(device_token);

    const ingest = await TransactionService.ingestSms({
      merchantId: auth.merchant.id,
      deviceId: auth.device.id,
      sms: raw_sms.slice(0, 4000),
      sender,
      simSlot: parseResult.data.sim_slot,
      carrier: parseResult.data.carrier,
      source: parseResult.data.source,
    });

    if (!ingest.success && !ingest.isDuplicate) {
      return reply.status(422).send({ success: false, error: ingest.error || 'Unrecognized SMS' });
    }

    return reply.status(ingest.isDuplicate ? 200 : 201).send({
      success: true,
      isDuplicate: ingest.isDuplicate || false,
      trxId: ingest.parsed?.trxId,
      amount: ingest.parsed?.amount,
    });
  });

  /**
   * Device heartbeat: hardware telemetry from the app (token in header, or body for older builds).
   */
  fastify.post('/api/v1/device/heartbeat', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = heartbeatSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid heartbeat payload structure',
        errors: parseResult.error.issues,
      });
    }

    const data = parseResult.data;
    const token = tokenFromRequest(request.headers as any, data.device_token, data.device_id);
    if (!token) {
      return reply.status(400).send({ success: false, error: 'device_token or device_id required' });
    }

    const auth = await DeviceService.authenticateDevice(token);
    if (!auth.authenticated || !auth.device) {
      return reply.status(401).send({ success: false, error: 'Device not found' });
    }

    // The device name is owned by the merchant (rename in the panel); telemetry never overwrites it.
    await DeviceService.recordHeartbeat(token, {
      battery_level: data.battery_level,
      battery_temp: data.battery_temp,
      is_charging: data.is_charging,
      charger_type: data.charger_type,
      free_ram_mb: data.free_ram_mb,
      sim_slots: data.sim_slots,
      device_model: data.device_model,
      android_version: data.android_version,
      app_version: data.app_version,
      sim_number: data.sim_number,
    });

    return reply.send({
      success: true,
      status: 'ONLINE',
      device_name: auth.device.device_name,
      merchant_name: (auth.merchant as any)?.name || '',
      commands: [],
    });
  });

  /** App update metadata (same data as /api/pub/app/latest). GET /api/v1/app/version */
  fastify.get('/api/v1/app/version', async (_request: FastifyRequest, reply: FastifyReply) => {
    const a = appLatest();
    return reply.send({
      success: true,
      app_name: 'بولگرام',
      package_name: 'ir.bolgram.forwarder',
      latest_version: a.version,
      download_url: a.apk_url,
      sha256: a.sha256,
      min_android: a.min_android,
    });
  });
}

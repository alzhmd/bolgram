import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DeviceService } from '../services/device.service.js';
import { TransactionService } from '../services/transaction.service.js';

const ingestSchema = z.object({
  device_id: z.string().min(1, 'device_id is required'),
  sms: z.string().min(1, 'sms body is required'),
  sender: z.string().optional(),
  received_at: z.string().optional(),
  sim_slot: z.number().optional(),
  carrier: z.string().optional(),
  source: z.string().optional(),
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
  sim_number: z.string().optional(),
});

export async function deviceRoutes(fastify: FastifyInstance) {
  /**
   * Android Forwarder Ingestion API:
   * Enforces 9-Step Verification & Instant Invoice Matching
   * POST /api/v1/device/sms/ingest
   */
  fastify.post('/api/v1/device/sms/ingest', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = ingestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        step_failed: 'Payload Validation',
        errors: parseResult.error.errors,
      });
    }

    const { device_id, sms, sender, sim_slot, carrier, source } = parseResult.data;

    // STEP 1, 2 & 3: Device valid, active and belongs to active merchant?
    const auth = await DeviceService.authenticateDevice(device_id);
    if (!auth.authenticated || !auth.device || !auth.merchant) {
      const isUnregistered = auth.error?.includes('not registered') || auth.error?.includes('invalid token');
      return reply.status(isUnregistered ? 401 : 403).send({
        success: false,
        step_failed: isUnregistered ? 'Step 1: Device Authentication' : 'Step 3: Merchant Verification',
        error: auth.error,
      });
    }

    // Update heartbeat
    await DeviceService.recordHeartbeat(device_id);

    // Run Ingestion Pipeline (Step 4 through 9)
    const ingest = await TransactionService.ingestSms({
      merchantId: auth.merchant.id,
      deviceId: auth.device.id,
      sms,
      sender,
      webhookSecret: (auth.merchant as any).webhook_secret,
      simSlot: sim_slot,
      carrier,
      source,
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
        raw: sms,
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
      sms: raw_sms,
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
   * Device Heartbeat Endpoint
   * Ingests hardware telemetry and dispatches remote commands
   */
  fastify.post('/api/v1/device/heartbeat', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = heartbeatSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid heartbeat payload structure',
        errors: parseResult.error.errors,
      });
    }

    const data = parseResult.data;
    const token = data.device_token || data.device_id;
    if (!token) {
      return reply.status(400).send({ success: false, error: 'device_token or device_id required' });
    }

    const auth = await DeviceService.authenticateDevice(token);
    if (!auth.authenticated || !auth.device) {
      return reply.status(401).send({ success: false, error: 'Device not found' });
    }

    // Persist hardware telemetry
    await DeviceService.recordHeartbeat(token, {
      battery_level: data.battery_level,
      battery_temp: data.battery_temp,
      is_charging: data.is_charging,
      charger_type: data.charger_type,
      free_ram_mb: data.free_ram_mb,
      sim_slots: data.sim_slots,
      device_name: data.device_name,
      device_model: data.device_model,
      android_version: data.android_version,
      sim_number: data.sim_number,
    });

    return reply.send({
      success: true,
      status: 'ONLINE',
      device_name: auth.device.device_name,
      commands: [], // Remote command array (e.g. RESYNC_SMS)
    });
  });

  /**
   * App Auto-Update Metadata Endpoint
   * GET /api/v1/app/version
   */
  fastify.get('/api/v1/app/version', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      success: true,
      app_name: 'SyncPay Agent',
      package_name: 'dev.jahidulislam.syncpay',
      developer: 'Jahidul Islam',
      developer_url: 'https://jahidulislam.dev',
      latest_version: '1.2.0',
      version_code: 2,
      min_supported_version: '1.0.0',
      force_update: false,
      download_url: 'https://syncpaybd.site/downloads/syncpay-forwarder-arm64.apk',
      file_size_bytes: 31548842,
      file_size_formatted: '29 MB',
      release_date: '2026-09-19',
      changelog: '• Real-time bKash, Nagad, Rocket, Upay SMS verification\n• New In-App 1-Click Auto Update & Downloader\n• Enhanced background sync service stability\n• Battery optimization and disconnect prevention',
      changelog_bn: '• বিকাশ, নগদ, রকেট ও উপায় এসএমএস অটো ভেরিফিকেশন\n• অ্যাপের ভেতরেই ১-ক্লিক অটো আপডেট ও ইনস্টলেশন\n• ব্যাকগ্রাউন্ড সার্ভিস ও ব্যাটারি অপটিমাইজেশন উন্নত করা হয়েছে\n• নিরবচ্ছিন্ন কানেকশন ও বাগ ফিক্স'
    });
  });
}

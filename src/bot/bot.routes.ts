import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { botsFromEnv, type Platform } from './api.js';
import { handleUpdate } from './bot.service.js';

/** Webhook transport (BOT_MODE=webhook): POST /api/v1/bot/:platform/:secret. Polling needs no route. */
export async function botRoutes(app: FastifyInstance) {
  const bots = new Map(botsFromEnv().map((b) => [b.platform, b] as const));
  app.post('/api/v1/bot/:platform/:secret', async (req, reply) => {
    const { platform, secret } = req.params as { platform: Platform; secret: string };
    const expected = process.env.BOT_WEBHOOK_SECRET || '';
    const ok = !!expected && secret.length === expected.length && crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected));
    const header = req.headers['x-telegram-bot-api-secret-token'];
    const api = bots.get(platform);
    if (!ok || !api || (platform === 'telegram' && header !== expected)) return reply.status(404).send({ ok: false });
    handleUpdate(api, req.body).catch((e) => console.error('[bot] webhook update failed:', e));
    return { ok: true };
  });
}

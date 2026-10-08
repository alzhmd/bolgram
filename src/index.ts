import { v2Routes } from './routes/v2.routes.js';
import { botRoutes } from './bot/bot.routes.js';
import { readUpload } from './utils/uploads.js';
import { startBots } from './bot/bot.service.js';
import { botsFromEnv } from './bot/api.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import rateLimit from '@fastify/rate-limit';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { deviceRoutes } from './routes/device.routes.js';
import { paymentRoutes } from './routes/payment.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Client IPs: behind a reverse proxy (Caddy/Nginx) X-Forwarded-For is trusted only from the proxy.
 * TRUST_PROXY: unset = proxies on this machine (loopback); "true" = any; or a comma list of IPs/CIDRs (e.g. Docker network).
 */
const trustProxy = process.env.TRUST_PROXY ? (process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY) : 'loopback';
const server = Fastify({ logger: true, trustProxy });

server.setValidatorCompiler(validatorCompiler);
server.setSerializerCompiler(serializerCompiler);

await server.register(cors, { origin: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });

// Rate limiting per client IP (req.ip honours TRUST_PROXY; spoofed X-Forwarded-For from clients is ignored).
await server.register(rateLimit, {
  max: 120,
  timeWindow: '1 minute',
  allowList: ['127.0.0.1', '::1'],
  keyGenerator: (req) => req.ip,
  errorResponseBuilder: (_req, context) => ({
    statusCode: 429,
    error: 'too_many_requests',
    message: `تعداد درخواست‌ها زیاد است؛ ${Math.ceil(context.ttl / 1000)} ثانیهٔ دیگر دوباره تلاش کنید`,
  }),
});

// Allow empty json body gracefully without FST_ERR_CTP_EMPTY_JSON_BODY
server.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  if (!body || typeof body !== 'string' || body.trim() === '') {
    done(null, {});
    return;
  }
  try {
    const json = JSON.parse(body);
    done(null, json);
  } catch (err: any) {
    err.statusCode = 400;
    done(err, undefined);
  }
});

// Register API Route Modules
await server.register(deviceRoutes);
await server.register(paymentRoutes);
await server.register(v2Routes);
await server.register(botRoutes);

server.get('/health', async () => ({ status: 'ok', uptime_s: Math.round(process.uptime()) }));

const publicDir = fs.existsSync(path.resolve(__dirname, '../public'))
  ? path.resolve(__dirname, '../public')
  : fs.existsSync(path.resolve(__dirname, 'public'))
    ? path.resolve(__dirname, 'public')
    : path.resolve(process.cwd(), 'public');

await server.register(fastifyStatic, {
  root: publicDir,
  prefix: '/',
  index: false,
});

// Merchant panel (single page app with hash routes)
server.get('/panel', async (_req, reply) => reply.redirect('/panel/'));
server.get('/uploads/:file', async (req, reply) => {
  const f = readUpload((req.params as any).file, 'public');
  if (!f) return reply.status(404).send({ success: false, error: 'not_found' });
  return reply.type(f.mime).header('Cache-Control', 'public, max-age=31536000, immutable').header('X-Content-Type-Options', 'nosniff').send(f.buf);
});
server.get('/panel/', async (_req, reply) => reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').sendFile('panel/index.html'));
// Platform owner admin panel (single page app with hash routes)
server.get('/owner', async (_req, reply) => reply.redirect('/owner/'));
server.get('/owner/', async (_req, reply) => reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').sendFile('owner/index.html'));

// Short addresses
server.get('/', async (_req, reply) => reply.redirect('/panel/'));
server.get('/login', async (_req, reply) => reply.redirect('/panel/#/login'));
server.get('/register', async (req, reply) => {
  const ref = String((req.query as any)?.ref || '').replace(/[^a-z0-9_]/gi, '').slice(0, 40);
  return reply.redirect(`/panel/#/register${ref ? `?ref=${ref}` : ''}`);
});
server.get('/dashboard', async (_req, reply) => reply.redirect('/panel/'));
server.get('/admin', async (_req, reply) => reply.redirect('/owner/'));
server.get('/app', async (_req, reply) => reply.redirect('/panel/#/app'));
server.get('/checkout', async (_req, reply) => reply.type('text/html; charset=utf-8').sendFile('checkout.html'));

const PORT = Number(process.env.PORT) || 4000;
const HOST = '0.0.0.0';

{
  try {
    await server.listen({ port: PORT, host: HOST });
    // Merchant bot (Telegram rich messages / Bale text). Never blocks startup if the Bot API is unreachable.
    void startBots(botsFromEnv()).catch((e) => console.warn('[bot] start failed:', e.message));
    console.log(`Bolgram running: http://localhost:${PORT}/panel/  (owner: /owner/)`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

export default server;

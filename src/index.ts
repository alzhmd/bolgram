import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import rateLimit from '@fastify/rate-limit';
import fastifyJwt from '@fastify/jwt';
import fastifySwagger from '@fastify/swagger';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';

import { deviceRoutes } from './routes/device.routes.js';
import { paymentRoutes } from './routes/payment.routes.js';
import { merchantRoutes } from './routes/merchant.routes.js';
import { adminRoutes } from './routes/admin.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = Fastify({
  logger: true,
});

// Configure Zod Type Provider compilers for Fastify
server.setValidatorCompiler(validatorCompiler);
server.setSerializerCompiler(serializerCompiler);

// Register Fastify JWT plugin
await server.register(fastifyJwt, {
  secret: process.env.JWT_SECRET || 'syncpay-super-secret-production-key-2026',
});

// Enable CORS
await server.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
});

// Swagger & Interactive OpenAPI Documentation Engine
await server.register(fastifySwagger, {
  openapi: {
    info: {
      title: 'SyncPay BD API Engine',
      description: 'Automated MFS Payment Verification & Ingestion REST API (bKash, Nagad, Rocket, Upay)',
      version: '1.0.0',
    },
    servers: [{ url: '/' }],
  },
});

// Swagger JSON Spec Endpoint
server.get('/api-docs/json', async (_req, reply) => {
  return reply.type('application/json').send(server.swagger());
});

// Interactive Swagger UI (Zero-dependency CDN embed to prevent serverless ESM/CJS require crashes)
server.get('/api-docs', async (_req, reply) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SyncPay BD - OpenAPI Specification</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #0b0f19; font-family: system-ui, sans-serif; }
    .topbar { display: none !important; }
    .swagger-ui .info .title { color: #38bdf8 !important; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api-docs/json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;
  return reply.type('text/html; charset=utf-8').send(html);
});

// Rate limiting to prevent brute-force attacks and DDoS
await server.register(rateLimit, {
  max: 120,
  timeWindow: '1 minute',
  allowList: ['127.0.0.1', 'localhost'],
  keyGenerator: (req) => {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') {
      return xff.split(',')[0].trim();
    }
    return req.ip || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
  },
  errorResponseBuilder: (_req, context) => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
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
await server.register(merchantRoutes);
await server.register(adminRoutes);

// Health check
server.get('/health', async (req) => {
  const indexHtmlPath = path.join(publicDir, 'index.html');
  let publicFiles: string[] = [];
  try {
    publicFiles = fs.readdirSync(publicDir);
  } catch (e: any) {
    publicFiles = [e.message];
  }
  return {
    status: 'OK',
    publicDir,
    publicFiles,
    indexExists: fs.existsSync(indexHtmlPath),
    indexLength: indexHtmlContent ? indexHtmlContent.length : 0,
    system: 'SyncPay BD Gateway',
  };
});

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

const indexHtmlPath = path.join(publicDir, 'index.html');
const indexHtmlContent = fs.existsSync(indexHtmlPath) ? fs.readFileSync(indexHtmlPath, 'utf8') : '';

const sendIndex = async (_req: any, reply: any) => {
  const content = indexHtmlContent || (fs.existsSync(indexHtmlPath) ? fs.readFileSync(indexHtmlPath, 'utf8') : '');
  return reply.type('text/html; charset=utf-8').send(content);
};

server.get('/', sendIndex);
server.get('/index', sendIndex);
server.get('/index.html', sendIndex);
server.get('/home', sendIndex);
server.get('/test-index', sendIndex);

server.get('/login', async (_req, reply) => {
  return reply.type('text/html').sendFile('login.html');
});

server.get('/dashboard', async (_req, reply) => {
  return reply.type('text/html').sendFile('dashboard.html');
});

server.get('/admin', async (_req, reply) => {
  return reply.type('text/html').sendFile('admin.html');
});

server.get('/checkout', async (_req, reply) => {
  return reply.type('text/html').sendFile('checkout.html');
});

server.get('/checkout/:slug', async (_req, reply) => {
  return reply.type('text/html').sendFile('checkout.html');
});

server.get('/pay/:slug', async (_req, reply) => {
  return reply.type('text/html').sendFile('checkout.html');
});

server.get('/download', async (_req, reply) => {
  return reply.type('text/html').sendFile('download.html');
});

server.get('/app', async (_req, reply) => {
  return reply.type('text/html').sendFile('download.html');
});

server.get('/docs/api', async (_req, reply) => {
  return reply.type('text/html').sendFile('docs/api.html');
});

server.get('/docs/trx-verification', async (_req, reply) => {
  return reply.type('text/html').sendFile('docs/trx-verification.html');
});

server.get('/docs/webhook', async (_req, reply) => {
  return reply.type('text/html').sendFile('docs/webhook.html');
});

const PORT = Number(process.env.PORT) || 4000;
const HOST = '0.0.0.0';

if (!process.env.VERCEL) {
  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`\n======================================================`);
    console.log(`🚀 SyncPay BD Engine running at: http://localhost:${PORT}`);
    console.log(`📊 Dashboard & Checkout UI:       http://localhost:${PORT}/`);
    console.log(`🌐 Production Domain:             https://syncpaybd.site`);
    console.log(`======================================================\n`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

export default server;

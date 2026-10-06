import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CryptoUtil } from '../utils/crypto.js';
import { dbService } from '../db/database.js';

/**
 * Real server-side authentication (upstream Bolgram trusted an `x-merchant-id` header
 * and left the admin API open). Merchants authenticate with the JWT issued by
 * /api/v1/merchant/auth/login or with their own live API key; admins with the JWT
 * issued by /api/v1/admin/auth/login.
 */
const MERCHANT_PUBLIC = new Set([
  '/api/v1/merchant/auth/register',
  '/api/v1/merchant/auth/login',
  '/api/v1/merchant/brand-info',
]);
const ADMIN_PUBLIC = new Set(['/api/v1/admin/auth/login']);

function bearer(request: FastifyRequest): string | null {
  const h = request.headers.authorization;
  return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

export function merchantFromRequest(request: FastifyRequest): string | null {
  const token = bearer(request);
  if (token && token.split('.').length === 3) {
    const v = CryptoUtil.verifyJwt(token);
    if (v.valid && v.payload?.role === 'merchant' && v.payload.id) return String(v.payload.id);
  }
  const apiKey = (request.headers['x-api-key'] || request.headers['syncpay-api-key'] || request.headers['payflow-api-key'] || token) as
    | string
    | undefined;
  if (apiKey && typeof apiKey === 'string' && !apiKey.startsWith('sandbox_test_')) {
    const m = dbService.getMerchantByApiKey(apiKey.trim());
    if (m) return m.id;
  }
  return null;
}

export async function merchantAuthHook(request: FastifyRequest, reply: FastifyReply) {
  const path = request.url.split('?')[0];
  if (!path.startsWith('/api/v1/merchant/') || MERCHANT_PUBLIC.has(path)) return;
  const merchantId = merchantFromRequest(request);
  if (!merchantId) return reply.status(401).send({ success: false, error: 'Authentication required' });
  (request as any).merchantId = merchantId;
}

export async function adminAuthHook(request: FastifyRequest, reply: FastifyReply) {
  const path = request.url.split('?')[0];
  if (!path.startsWith('/api/v1/admin/') || ADMIN_PUBLIC.has(path)) return;
  const token = bearer(request);
  const v = token ? CryptoUtil.verifyJwt(token) : { valid: false as const };
  if (!v.valid || (v as any).payload?.role !== 'admin') {
    return reply.status(401).send({ success: false, error: 'Admin authentication required' });
  }
  (request as any).admin = (v as any).payload;
}

/** ADMIN_EMAIL + ADMIN_PASSWORD (or ADMIN_PASSWORD_SHA256) from the environment. */
export function checkAdminCredentials(email: string, password: string): boolean {
  const wantEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const wantHash = process.env.ADMIN_PASSWORD_SHA256 || (process.env.ADMIN_PASSWORD ? sha256(process.env.ADMIN_PASSWORD) : '');
  if (!wantEmail || !wantHash) return false;
  const a = Buffer.from(sha256(password));
  const b = Buffer.from(wantHash);
  return email.trim().toLowerCase() === wantEmail && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sha256(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

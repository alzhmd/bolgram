import { FastifyRequest, FastifyReply } from 'fastify';

interface AttemptRecord {
  count: number;
  firstAttempt: number;
  lockedUntil?: number;
}

const MAX_FAILED_ATTEMPTS = 4;
const WINDOW_MS = 3 * 60 * 1000; // 3 minutes
const LOCKOUT_MS = 3 * 60 * 1000; // 3 minutes lockout

// In-memory sliding window cache for rate limiting
const attemptsCache = new Map<string, AttemptRecord>();

// Periodic garbage collection every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of attemptsCache.entries()) {
    if (record.lockedUntil && record.lockedUntil < now) {
      attemptsCache.delete(key);
    } else if (now - record.firstAttempt > WINDOW_MS * 2) {
      attemptsCache.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

function getClientIdentifier(request: FastifyRequest): string {
  const body = request.body as any;
  const invoiceId = body?.invoice_id || (request.query as any)?.invoice_id || '';
  const xff = request.headers['x-forwarded-for'];
  const ip = typeof xff === 'string' ? xff.split(',')[0].trim() : request.ip || '127.0.0.1';
  return `${ip}:${invoiceId}`;
}

/**
 * Fastify preHandler hook to block brute-force TrxID guessing attacks.
 */
export async function fraudShield(request: FastifyRequest, reply: FastifyReply) {
  const key = getClientIdentifier(request);
  const now = Date.now();
  const record = attemptsCache.get(key);

  if (record) {
    if (record.lockedUntil && record.lockedUntil > now) {
      const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
      return reply.code(429).send({
        success: false,
        verified: false,
        error: 'Too Many Attempts',
        message: `Too many incorrect Transaction ID submissions. Please wait ${remainingSec} seconds before trying again.`,
        retry_after: remainingSec,
      });
    }
  }
}

/**
 * Records a failed verification attempt. Call when trx_id fails to verify.
 */
export function recordFailedVerification(request: FastifyRequest) {
  const key = getClientIdentifier(request);
  const now = Date.now();
  const record = attemptsCache.get(key);

  if (!record || now - record.firstAttempt > WINDOW_MS) {
    attemptsCache.set(key, { count: 1, firstAttempt: now });
  } else {
    record.count += 1;
    if (record.count >= MAX_FAILED_ATTEMPTS) {
      record.lockedUntil = now + LOCKOUT_MS;
    }
  }
}

/**
 * Clears attempt history on successful verification.
 */
export function clearVerificationAttempts(request: FastifyRequest) {
  const key = getClientIdentifier(request);
  attemptsCache.delete(key);
}

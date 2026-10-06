import { CryptoUtil } from './crypto.js';

export interface JwtPayload {
  sub?: string;
  id?: string;
  role?: 'merchant' | 'admin';
  name?: string;
  email?: string;
  iat?: number;
  exp?: number;
  [key: string]: any;
}

/**
 * Signs a JWT using CryptoUtil HMAC-SHA256.
 */
export function signJwt(
  payload: Record<string, any>,
  secret?: string,
  expiresInHours: number = 72
): string {
  return CryptoUtil.signJwt(payload, secret, expiresInHours);
}

/**
 * Verifies a JWT using CryptoUtil HMAC-SHA256.
 */
export function verifyJwt(
  token: string,
  secret?: string
): { valid: boolean; payload?: any } {
  return CryptoUtil.verifyJwt(token, secret);
}


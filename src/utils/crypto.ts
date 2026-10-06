import crypto from 'node:crypto';

export class CryptoUtil {
  /**
   * Generates a SHA-256 hash of an API key or device token for secure storage
   */
  public static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
  }

  /**
   * Generates an HMAC-SHA256 signature for webhook payload verification
   * Format: sha256=<hex_digest>
   */
  public static signWebhook(payload: Record<string, any> | string, secret: string): string {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const hmac = crypto.createHmac('sha256', secret).update(data).digest('hex');
    return `sha256=${hmac}`;
  }

  /**
   * Constant-time comparison to prevent timing attacks when verifying webhook signatures
   */
  public static verifyWebhookSignature(payload: string, signatureHeader: string, secret: string): boolean {
    const expected = this.signWebhook(payload, secret);
    try {
      return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  /**
   * Generate secure random token
   */
  public static generateToken(bytes: number = 20): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  /**
   * Generate secure random API key or webhook secret
   */
  public static generateSecret(prefix: string = 'whsec'): string {
    return `${prefix}_${crypto.randomBytes(24).toString('hex')}`;
  }

  /**
   * Hash a password using scrypt with random cryptographic salt
   */
  public static hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  /**
   * Verify password against salt:hash using constant-time comparison
   */
  public static verifyPassword(password: string, combinedHash: string): boolean {
    try {
      const [salt, key] = combinedHash.split(':');
      if (!salt || !key) return false;
      const keyBuffer = Buffer.from(key, 'hex');
      const derivedKey = crypto.scryptSync(password, salt, 64);
      return crypto.timingSafeEqual(keyBuffer, derivedKey);
    } catch {
      return false;
    }
  }

  /**
   * Issue signed cryptographic JWT token
   */
  public static signJwt(
    payload: Record<string, any>,
    secret: string = process.env.JWT_SECRET || 'syncpay_jwt_secret_2026',
    expiresInHours: number = 72
  ): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
    const fullPayload = { ...payload, exp, iat: Math.floor(Date.now() / 1000) };
    const body = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  /**
   * Verify signed JWT token and return payload if valid and not expired
   */
  public static verifyJwt(
    token: string,
    secret: string = process.env.JWT_SECRET || 'syncpay_jwt_secret_2026'
  ): { valid: boolean; payload?: any } {
    try {
      const [header, body, signature] = token.split('.');
      if (!header || !body || !signature) return { valid: false };
      const expectedSig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        return { valid: false };
      }
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return { valid: false };
      }
      return { valid: true, payload };
    } catch {
      return { valid: false };
    }
  }
}


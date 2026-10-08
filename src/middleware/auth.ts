import crypto from 'node:crypto';

/** Platform owner sign-in for /owner: ADMIN_EMAIL + ADMIN_PASSWORD (or ADMIN_PASSWORD_SHA256) from the environment. */
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

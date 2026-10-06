import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * File uploads sent as data URLs in JSON (no multipart dependency). Public files (logos,
 * avatars) are served at /uploads/<file>; private files (identity documents, ticket
 * attachments) only through authenticated routes with readPrivate().
 * Routes that accept uploads need `{ bodyLimit: 8 * 1024 * 1024 }`.
 */
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './data/uploads');
const TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};
export class UploadError extends Error {}

export function saveDataUrl(dataUrl: unknown, opts: { visibility: 'public' | 'private'; maxBytes?: number; allow?: string[] }) {
  const m = typeof dataUrl === 'string' ? dataUrl.match(/^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/) : null;
  if (!m) throw new UploadError('فایل معتبر نیست');
  const mime = m[1].toLowerCase();
  const allow = opts.allow || ['image/png', 'image/jpeg', 'image/webp'];
  if (!allow.includes(mime) || !TYPES[mime]) throw new UploadError('نوع فایل مجاز نیست');
  // SVG can carry scripts; only accept it for private review, never serve it publicly.
  if (mime === 'image/svg+xml' && opts.visibility === 'public') throw new UploadError('نوع فایل مجاز نیست');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > (opts.maxBytes || 2 * 1024 * 1024)) throw new UploadError(`حجم فایل باید کمتر از ${Math.round((opts.maxBytes || 2 * 1024 * 1024) / 1024 / 1024)} مگابایت باشد`);
  const name = `${crypto.randomBytes(12).toString('hex')}.${TYPES[mime]}`;
  const dir = path.join(UPLOAD_DIR, opts.visibility);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buf);
  return { file: name, mime, size: buf.length, url: opts.visibility === 'public' ? `/uploads/${name}` : null };
}

const SAFE = /^[a-f0-9]{24}\.(png|jpg|webp|svg|pdf)$/;
export function readUpload(file: string, visibility: 'public' | 'private') {
  if (!SAFE.test(file)) return null;
  const p = path.join(UPLOAD_DIR, visibility, file);
  if (!fs.existsSync(p)) return null;
  const ext = file.split('.').pop()!;
  const mime = Object.entries(TYPES).find(([, e]) => e === ext)![0];
  return { buf: fs.readFileSync(p), mime };
}

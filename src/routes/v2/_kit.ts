import type { FastifyReply, FastifyRequest } from 'fastify';
import { dbService } from '../../db/database.js';
import { actorOf } from '../../services/access.js';
import { toLatinDigits } from '../../utils/validate.js';

/** Shared helpers for /api/v2 feature plugins (see docs/dev/PANEL_CONVENTIONS.md). */
export const db = () => (dbService as any).db as import('node:sqlite').DatabaseSync;
export const merchantOf = (req: FastifyRequest): any => (req as any).merchant;
export { actorOf };

export function fail(reply: FastifyReply, status: number, error: string, message: string, errors?: Record<string, string>) {
  return reply.status(status).send({ success: false, error, message, ...(errors ? { errors } : {}) });
}

/** ?page=&per_page= → { limit, offset, page, perPage } (per_page 1..100, default 20). */
export function paging(q: any) {
  const perPage = Math.min(100, Math.max(1, Number(q?.per_page) || 20));
  const page = Math.max(1, Number(q?.page) || 1);
  return { page, perPage, limit: perPage, offset: (page - 1) * perPage };
}

/** SQLite datetime text ("YYYY-MM-DD HH:MM:SS", UTC) for comparisons with CURRENT_TIMESTAMP columns. */
export const utcSql = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
/** Accepts ISO or SQLite UTC text and returns ISO 8601. */
export const isoOf = (s: unknown) => {
  if (!s) return null;
  const str = String(s);
  const d = new Date(str.includes('T') ? str : str.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d.toISOString();
};

export const tomanOf = (raw: unknown) => Number(toLatinDigits(String(raw ?? '')).replace(/[^\d]/g, '') || NaN);
export const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک').slice(0, max) : '');

/** CSV that opens correctly in Excel (UTF-8 BOM, CRLF). */
export function csv(reply: FastifyReply, filename: string, header: string[], rows: (string | number | null)[][]) {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(body);
}

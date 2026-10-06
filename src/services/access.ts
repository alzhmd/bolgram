import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { dbService } from '../db/database.js';

/**
 * Who is acting on a store: the owner (merchant account) or a team member (staff token).
 * Roles map to permissions; every /api/v2 route checks one with `requirePerm`.
 * Table team_members is shared: the team feature manages invites, this module resolves sessions.
 */
const db = () => (dbService as any).db as import('node:sqlite').DatabaseSync;

export const ROLES = {
  owner: 'مالک',
  manager: 'مدیر فروشگاه',
  accountant: 'حسابدار',
  cashier: 'صندوق‌دار',
  viewer: 'فقط مشاهده',
} as const;
export type Role = keyof typeof ROLES;

export const PERMS = {
  'invoices:read': 'دیدن فاکتورها',
  'invoices:create': 'ساخت فاکتور',
  'invoices:manage': 'لغو و خروجی فاکتورها',
  'deposits:review': 'تأیید یا رد واریزی‌های بی‌صاحب',
  'reports:read': 'گزارش‌ها',
  'links:read': 'دیدن لینک‌های پرداخت',
  'links:manage': 'ساخت و ویرایش لینک پرداخت',
  'cards:read': 'دیدن کارت‌ها',
  'cards:manage': 'افزودن و ویرایش کارت',
  'wallet:read': 'دیدن کیف پول',
  'wallet:manage': 'شارژ کیف پول و خرید پلن',
  'devices:read': 'دیدن دستگاه‌ها',
  'devices:manage': 'اتصال و حذف دستگاه',
  'bots:manage': 'اتصال ربات',
  'webhooks:manage': 'وب‌هوک',
  'api:manage': 'کلید API و افزونه‌ها',
  'settings:manage': 'تنظیمات فروشگاه',
  'team:manage': 'مدیریت همکاران',
  'trust:manage': 'نماد اعتماد',
  'support:use': 'پشتیبانی',
  'referral:read': 'دعوت دوستان',
  'review:write': 'ثبت نظر',
} as const;
export type Perm = keyof typeof PERMS;
const ALL = Object.keys(PERMS) as Perm[];

export const ROLE_PERMS: Record<Role, Perm[]> = {
  owner: ALL,
  manager: ALL.filter((p) => !['team:manage', 'api:manage', 'settings:manage', 'wallet:manage'].includes(p)),
  accountant: ['invoices:read', 'invoices:manage', 'deposits:review', 'reports:read', 'links:read', 'cards:read', 'wallet:read', 'wallet:manage', 'devices:read', 'support:use'],
  cashier: ['invoices:read', 'invoices:create', 'links:read', 'cards:read', 'devices:read', 'support:use'],
  viewer: ['invoices:read', 'reports:read', 'links:read', 'cards:read', 'wallet:read', 'devices:read'],
};

export interface Actor {
  kind: 'owner' | 'staff';
  id: string;
  name: string;
  role: Role;
  perms: Perm[];
}

export function ensureAccessSchema() {
  const d = db();
  d.exec(`CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, name TEXT, mobile TEXT, email TEXT, role TEXT NOT NULL DEFAULT 'viewer',
    status TEXT NOT NULL DEFAULT 'invited', password_hash TEXT, invite_hash TEXT, invite_expires_at INTEGER,
    token_version INTEGER NOT NULL DEFAULT 0, invited_by TEXT, created_at INTEGER NOT NULL, last_login_at INTEGER)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_team_merchant ON team_members(merchant_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_team_mobile ON team_members(mobile)`);
  d.exec(`CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY, merchant_id TEXT, actor_kind TEXT, actor_id TEXT, actor_name TEXT, action TEXT NOT NULL,
    target TEXT, meta TEXT, ip TEXT, created_at INTEGER NOT NULL)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_audit_merchant ON audit_log(merchant_id, created_at)`);
}

export function ownerActor(m: any): Actor {
  return { kind: 'owner', id: m.id, name: m.name || m.handle || 'مالک', role: 'owner', perms: ROLE_PERMS.owner };
}

/** Token payload → actor; null when a staff session was revoked (removed, disabled, password changed). */
export function resolveActor(m: any, payload: any): Actor | null {
  if (!payload?.staff) return ownerActor(m);
  const t = db().prepare(`SELECT * FROM team_members WHERE id = ? AND merchant_id = ? AND status = 'active'`).get(String(payload.staff), m.id) as any;
  if (!t || Number(t.token_version) !== Number(payload.stv || 0)) return null;
  const role = (t.role in ROLES && t.role !== 'owner' ? t.role : 'viewer') as Role;
  return { kind: 'staff', id: t.id, name: t.name || t.mobile, role, perms: ROLE_PERMS[role] };
}

export const actorOf = (req: FastifyRequest): Actor => (req as any).actor;
export const can = (actor: Actor | undefined, perm: Perm) => !!actor?.perms.includes(perm);

/** Route option: `{ preHandler: requirePerm('cards:manage') }`. */
export function requirePerm(perm: Perm) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!can(actorOf(req), perm)) return reply.status(403).send({ success: false, error: 'forbidden', message: 'نقش شما اجازهٔ این کار را ندارد' });
  };
}

/** Store activity log (shown on the team page and in the owner panel). */
export function audit(req: FastifyRequest | null, merchantId: string | null, action: string, target?: string, meta?: Record<string, unknown>) {
  const a = req ? actorOf(req) : undefined;
  db()
    .prepare(`INSERT INTO audit_log (id, merchant_id, actor_kind, actor_id, actor_name, action, target, meta, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      'al_' + crypto.randomBytes(8).toString('hex'),
      merchantId,
      a?.kind || (req && (req as any).admin ? 'admin' : 'system'),
      a?.id || null,
      a?.name || null,
      action,
      target || null,
      meta ? JSON.stringify(meta) : null,
      req?.ip || null,
      Date.now(),
    );
}

/**
 * In-process domain events and invoice guards. Features subscribe at startup
 * (inside their v2 plugin); emitters never wait for or fail because of subscribers.
 * Amounts are Rial.
 */
export interface EventMap {
  'invoice.created': { merchantId: string; invoiceId: string; amount: number; source: 'panel' | 'bot' | 'api' | 'link' | 'topup' | 'other' };
  'invoice.paid': { merchantId: string; invoiceId: string; amount: number; provider: string; trxId?: string; source: 'auto' | 'manual' | 'customer' };
  'invoice.cancelled': { merchantId: string; invoiceId: string };
  'deposit.held': { merchantId: string; amount: number; provider: string; suspicious: boolean };
  'device.offline': { merchantId: string; deviceId: string; name: string };
  'device.online': { merchantId: string; deviceId: string; name: string };
  'wallet.low': { merchantId: string; balance: number };
  'wallet.credited': { merchantId: string; amount: number; kind: string };
  'ticket.replied': { merchantId: string; ticketId: string; subject: string };
  'trust.decided': { merchantId: string; approved: boolean; note?: string };
  'plan.changed': { merchantId: string; planId: string; expiresAt: string | null };
}
type Handler<K extends keyof EventMap> = (payload: EventMap[K]) => unknown;
const handlers = new Map<keyof EventMap, Handler<any>[]>();

export const events = {
  on<K extends keyof EventMap>(name: K, fn: Handler<K>) {
    handlers.set(name, [...(handlers.get(name) || []), fn]);
  },
  emit<K extends keyof EventMap>(name: K, payload: EventMap[K]) {
    for (const fn of handlers.get(name) || []) {
      Promise.resolve()
        .then(() => fn(payload))
        .catch((e) => console.error(`[events] ${String(name)} handler failed:`, e));
    }
  },
  /** Test helper: wait for queued handlers. */
  settle: () => new Promise((r) => setTimeout(r, 20)),
};

export class GuardError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

type InvoiceGuard = (merchantId: string, amountRial: number) => void; // throws GuardError to refuse
type LimitProvider = (merchantId: string, key: LimitKey) => number | null; // null = unlimited
export type LimitKey = 'cards' | 'links' | 'team' | 'devices';
const guards: InvoiceGuard[] = [];
let limitProvider: LimitProvider | null = null;

export function registerInvoiceGuard(fn: InvoiceGuard) {
  guards.push(fn);
}
/** Called by InvoiceRepository.create for every new invoice (panel, bot, API, links, top-ups). */
export function assertCanInvoice(merchantId: string, amountRial: number) {
  for (const g of guards) g(merchantId, amountRial);
}
export function registerLimitProvider(fn: LimitProvider) {
  limitProvider = fn;
}
const LIMIT_NAMES: Record<LimitKey, string> = { cards: 'کارت', links: 'لینک پرداخت', team: 'همکار', devices: 'دستگاه' };
/** Throws when adding one more item would exceed the merchant's plan. */
export function checkLimit(merchantId: string, key: LimitKey, current: number) {
  const max = limitProvider ? limitProvider(merchantId, key) : null;
  if (max !== null && current >= max) {
    throw new GuardError(402, 'plan_limit', `سقف ${LIMIT_NAMES[key]} در پلن فعلی شما ${new Intl.NumberFormat('fa-IR').format(max)} است؛ برای افزایش، پلن را ارتقا دهید`);
  }
}

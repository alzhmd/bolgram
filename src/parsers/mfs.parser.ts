/**
 * Iranian bank SMS parser (replaces the Bangladeshi MFS rules of upstream Bolgram).
 * Keeps the upstream `MfsParser.parse()` contract so the rest of the engine is unchanged.
 * Amounts are in Rial. Only deposits (credits) are accepted; OTP/password SMS are rejected.
 */
import { createHash } from 'node:crypto';
import { parseBankMessage, type ParseContext } from './ir/parser.js';
import { BUILTIN_TEMPLATES, compileTemplate } from './ir/templates.js';
import { BANKS } from './ir/registry.js';
import { normalizeText } from './ir/persian.js';

export interface ParsedMfsResult {
  success: boolean;
  provider: string;
  trxId?: string;
  amount?: number;
  sender?: string;
  fee?: number;
  balance?: number;
  account?: string;
  bankTime?: string;
  trusted?: boolean;
  rawText: string;
  error?: string;
}

const ctx: ParseContext = {
  banks: BANKS.map((b) => ({ id: b.id, senders: b.senders, keywords: b.keywords.map(normalizeText), notificationPackages: [] })),
  templates: BUILTIN_TEMPLATES.map((t) => compileTemplate(t)!).filter(Boolean),
};

export class MfsParser {
  public static parse(senderAddress: string, body: string, receivedAt: Date = new Date()): ParsedMfsResult {
    const r = parseBankMessage({ sender: senderAddress || '', body, receivedAt }, ctx);
    const provider = r.bankId || 'UNKNOWN';
    if (r.kind === 'sensitive') return { success: false, provider, rawText: '', error: 'OTP/password SMS ignored' };
    if (r.kind !== 'transaction' || !r.amount) {
      return { success: false, provider, rawText: body, error: r.problems.join(', ') || 'Unrecognized bank SMS format' };
    }
    if (r.direction !== 'credit') return { success: false, provider, rawText: body, error: 'Withdrawal SMS ignored' };
    // Iranian deposit SMS rarely carry a tracking number: derive a stable id from the message
    // (account + amount + balance + bank time) so the (merchant, trx_id) unique key blocks replays.
    const trxId =
      r.reference ||
      'IR' + createHash('sha256').update(`${provider}|${r.account}|${r.amount}|${r.balance}|${r.bankTime?.toISOString() ?? r.normalizedBody}`).digest('hex').slice(0, 14).toUpperCase();
    return {
      success: true,
      provider,
      trxId,
      amount: r.amount,
      balance: r.balance ?? undefined,
      account: r.account ?? undefined,
      sender: r.payerCard ?? undefined,
      bankTime: r.bankTime?.toISOString(),
      trusted: r.senderTrusted,
      rawText: body,
    };
  }
}

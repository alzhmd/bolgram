export type Platform = 'telegram' | 'bale';

export class BotApiError extends Error {
  constructor(public method: string, public code: number, public description: string) {
    super(`${method}: ${code} ${description}`);
  }
}

/** Minimal Bot API client; Bale speaks the same protocol at tapi.bale.ai. */
export class BotApi {
  constructor(public readonly platform: Platform, private readonly base: string, private readonly token: string) {}

  async call<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
    const res = await fetch(`${this.base}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json: any = await res.json().catch(() => null);
    if (!json?.ok) throw new BotApiError(method, Number(json?.error_code ?? res.status), String(json?.description ?? res.statusText));
    return json.result as T;
  }
}

export function botsFromEnv(): BotApi[] {
  const bots: BotApi[] = [];
  if (process.env.TELEGRAM_BOT_TOKEN) bots.push(new BotApi('telegram', process.env.TELEGRAM_API_BASE || 'https://api.telegram.org', process.env.TELEGRAM_BOT_TOKEN));
  if (process.env.BALE_BOT_TOKEN) bots.push(new BotApi('bale', process.env.BALE_API_BASE || 'https://tapi.bale.ai', process.env.BALE_BOT_TOKEN));
  return bots;
}

export interface TelegramAlertParams {
  amount: number;
  provider: string;
  trxId: string;
  invoiceId: string;
  customerName?: string;
  customerPhone?: string;
  merchantName?: string;
  botToken?: string;
  chatId?: string;
}

/**
 * Payment alerts to Telegram and Bale (Bale speaks the Telegram Bot API at tapi.bale.ai
 * and works inside Iran). Configure TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID and/or
 * BALE_BOT_TOKEN/BALE_CHAT_ID. TELEGRAM_API_BASE lets you point at a relay when the
 * server can't reach api.telegram.org.
 */
export class TelegramService {
  private static async send(base: string, token: string, chatId: string, text: string): Promise<boolean> {
    try {
      const res = await fetch(`${base}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) console.warn('[BotAlert]', base, res.status, await res.text());
      return res.ok;
    } catch (err: any) {
      console.warn('[BotAlert] delivery failed:', base, err.message);
      return false;
    }
  }

  public static async sendPaymentAlert(params: TelegramAlertParams): Promise<boolean> {
    const time = new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'short', timeStyle: 'short' });
    const toman = new Intl.NumberFormat('fa-IR').format(Math.round(params.amount / 10));
    const text = [
      '✅ پرداخت کارت به کارت تأیید شد',
      `💰 مبلغ: ${toman} تومان`,
      `🏦 بانک: ${params.provider}`,
      `🧾 فاکتور: ${params.invoiceId}`,
      `🔑 شناسه تراکنش: ${params.trxId}`,
      params.customerName ? `👤 مشتری: ${params.customerName}${params.customerPhone ? ` (${params.customerPhone})` : ''}` : '',
      params.merchantName ? `🏢 پذیرنده: ${params.merchantName}` : '',
      `🕒 ${time}`,
    ]
      .filter(Boolean)
      .join('\n');

    const jobs: Promise<boolean>[] = [];
    const tgToken = params.botToken || process.env.TELEGRAM_BOT_TOKEN;
    const tgChat = params.chatId || process.env.TELEGRAM_CHAT_ID;
    if (tgToken && tgChat) jobs.push(this.send(process.env.TELEGRAM_API_BASE || 'https://api.telegram.org', tgToken, tgChat, text));
    if (process.env.BALE_BOT_TOKEN && process.env.BALE_CHAT_ID) {
      jobs.push(this.send(process.env.BALE_API_BASE || 'https://tapi.bale.ai', process.env.BALE_BOT_TOKEN, process.env.BALE_CHAT_ID, text));
    }
    if (!jobs.length) return false;
    return (await Promise.all(jobs)).some(Boolean);
  }
}

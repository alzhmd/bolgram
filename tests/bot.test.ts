import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import Fastify, { FastifyInstance } from 'fastify';
import { v2Routes } from '../src/routes/v2.routes.js';
import { dbService } from '../src/db/database.js';
import { BotApi } from '../src/bot/api.js';
import { handleUpdate, notifyPayment, registerBot, unregisterBots } from '../src/bot/bot.service.js';

/** Fake Bot API: records every call; sendRichMessage can be switched off to test the text fallback. */
function fakeBotApi() {
  const calls: { token: string; method: string; body: any }[] = [];
  let richSupported = true;
  let nextId = 100;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const [, token, method] = req.url!.match(/^\/bot([^/]+)\/(\w+)/) || [];
      const body = raw ? JSON.parse(raw) : {};
      calls.push({ token, method, body });
      res.setHeader('Content-Type', 'application/json');
      if (method === 'sendRichMessage' && !richSupported) return res.end(JSON.stringify({ ok: false, error_code: 404, description: 'Not Found: method not found' }));
      const result = method === 'getMe' ? { id: 1, is_bot: true, username: 'test_bot' } : /^send/.test(method) ? { message_id: nextId++ } : true;
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  return { server, calls, setRich: (v: boolean) => (richSupported = v) };
}

/** Structural checks the Bot API enforces on rich messages. */
function assertValidRich(rm: any) {
  assert.strictEqual(rm.is_rtl, true);
  const walk = (blocks: any[]) => {
    for (const b of blocks) {
      if (b.type === 'buttons') {
        assert.ok(b.buttons.length >= 1 && b.buttons.length <= 8, 'buttons block holds 1-8 buttons');
        for (const btn of b.buttons) {
          const actions = ['url', 'callback_data', 'copy_text'].filter((k) => k in btn);
          assert.strictEqual(actions.length, 1, `exactly one action: ${JSON.stringify(btn)}`);
          if (btn.callback_data) assert.ok(Buffer.byteLength(btn.callback_data) <= 64, 'callback_data <= 64 bytes');
          if (btn.style) assert.ok(['danger', 'success', 'primary', 'link'].includes(btn.style));
        }
      }
      if (b.type === 'table') for (const row of b.cells) for (const c of row) assert.ok(c.align && c.valign, 'cells need align + valign');
      if (b.blocks) walk(b.blocks);
    }
  };
  walk(rm.blocks);
}

describe('Merchant bot (Telegram rich messages, Bale text fallback)', () => {
  let app: FastifyInstance;
  let token = '';
  let merchantId = '';
  const fake = fakeBotApi();
  let tg: BotApi;
  let bale: BotApi;
  const TG_CHAT = 7000 + (Date.now() % 1000);
  const BALE_CHAT = 9000 + (Date.now() % 1000);
  let mid = 1;
  const msg = (api: BotApi, chat: number, text: string) =>
    handleUpdate(api, { update_id: mid, message: { message_id: mid++, chat: { id: chat, type: 'private' }, from: { id: chat, first_name: 'Ali' }, text } });
  const press = (api: BotApi, chat: number, data: string) =>
    handleUpdate(api, { update_id: mid++, callback_query: { id: `cb${mid}`, from: { id: chat }, data, message: { message_id: 55, chat: { id: chat, type: 'private' } } } });
  const last = (tokenName: string, methods: string[]) => [...fake.calls].reverse().find((c) => c.token === tokenName && methods.includes(c.method))!;
  const richText = (rm: any) => JSON.stringify(rm.blocks);
  const auth = () => ({ authorization: `Bearer ${token}` });

  before(async () => {
    await new Promise<void>((r) => fake.server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(fake.server.address() as any).port}`;
    tg = new BotApi('telegram', base, 'TG');
    bale = new BotApi('bale', base, 'BALE');
    registerBot(tg, 'bolgram_test_bot');
    registerBot(bale, 'bolgram_bale_bot');
    app = Fastify();
    await app.register(v2Routes);
    await app.ready();
    const handle = `bot${Date.now() % 1e8}`;
    const mobile = `0913${String(Date.now() % 1e7).padStart(7, '0')}`;
    const res = await app.inject({ method: 'POST', url: '/api/v2/auth/register', payload: { handle, mobile, password: 'Strong-pass-77', terms: true } });
    const body = JSON.parse(res.body);
    token = body.token;
    merchantId = body.merchant.id;
  });
  after(async () => {
    unregisterBots();
    await app.close();
    fake.server.close();
  });

  test('unlinked chat gets the welcome screen; link code from the panel links it', async () => {
    await msg(tg, TG_CHAT, '/start');
    assert.match(richText(last('TG', ['sendRichMessage']).body.rich_message), /خوش آمدید/);

    const code = JSON.parse((await app.inject({ method: 'POST', url: '/api/v2/bots/link-code', headers: auth() })).body);
    assert.match(code.code, /^[A-Z2-9]{8}$/);
    assert.strictEqual(code.telegram_url, `https://t.me/bolgram_test_bot?start=link_${code.code}`);

    await msg(tg, TG_CHAT, `/start link_${code.code}`);
    const sent = last('TG', ['sendRichMessage']).body;
    assertValidRich(sent.rich_message);
    assert.match(richText(sent.rich_message), /اتصال برقرار شد/);

    // One-time: the same code can't link a second chat.
    await msg(tg, TG_CHAT + 1, `/start link_${code.code}`);
    assert.match(richText(last('TG', ['sendRichMessage']).body.rich_message), /کد اتصال معتبر نیست/);

    const links = JSON.parse((await app.inject({ method: 'GET', url: '/api/v2/bots', headers: auth() })).body);
    assert.strictEqual(links.links.length, 1);
    assert.strictEqual(links.links[0].platform, 'telegram');
  });

  test('typed link codes are rate limited', async () => {
    for (let i = 0; i < 5; i++) await msg(tg, TG_CHAT + 2, 'ABCD-EFGH');
    const code = JSON.parse((await app.inject({ method: 'POST', url: '/api/v2/bots/link-code', headers: auth() })).body).code;
    await msg(tg, TG_CHAT + 2, code);
    assert.match(richText(last('TG', ['sendRichMessage']).body.rich_message), /تلاش‌های زیاد/);
  });

  test('add a card in the chat: number message is deleted, bank detected, card saved encrypted', async () => {
    await press(tg, TG_CHAT, 'card:add');
    const edit = last('TG', ['editMessageText']).body;
    assert.strictEqual(edit.message_id, 55);
    assertValidRich(edit.rich_message);

    await msg(tg, TG_CHAT, '۶۱۰۴-۳۳۷۸-۰۰۰۰-۲۰۹۷');
    const cardMsgId = mid - 1;
    assert.ok(fake.calls.some((c) => c.method === 'deleteMessage' && c.body.message_id === cardMsgId), 'card number message is removed from the chat');
    assert.match(richText(last('TG', ['sendRichMessage']).body.rich_message), /ملت/);

    await msg(tg, TG_CHAT, 'علي رضايي');
    assert.match(richText(last('TG', ['sendRichMessage']).body.rich_message), /علی رضایی/);
    await press(tg, TG_CHAT, 'card:save');
    const cards = last('TG', ['editMessageText']).body.rich_message;
    assertValidRich(cards);
    const table = cards.blocks.find((b: any) => b.type === 'table');
    assert.strictEqual(table.is_compact, true);
    assert.ok(cards.blocks.some((b: any) => b.type === 'expandable_blockquote'));
    assert.match(JSON.stringify(table), /۲۰۹۷/);
    assert.doesNotMatch(JSON.stringify(cards), /6104337800002097/);

    const api = JSON.parse((await app.inject({ method: 'GET', url: '/api/v2/cards', headers: auth() })).body);
    assert.strictEqual(api.data.length, 1);
    const stored = (dbService as any).db.prepare('SELECT account_number FROM payment_methods WHERE merchant_id = ?').get(merchantId) as any;
    assert.match(stored.account_number, /^enc:v1:/);
  });

  test('an amount message creates an invoice with copy buttons and a ready customer text', async () => {
    await msg(tg, TG_CHAT, '۲۵۰٬۰۰۰ کفش ورزشی');
    const rm = last('TG', ['sendRichMessage']).body.rich_message;
    assertValidRich(rm);
    const s = JSON.stringify(rm);
    assert.match(s, /فاکتور ساخته شد/);
    assert.match(s, /کفش ورزشی/);
    const para = rm.blocks.find((b: any) => b.type === 'paragraph' && Array.isArray(b.text) && b.text.some((t: any) => t.type === 'button'));
    assert.ok(para, 'inline RichTextButton in the link paragraph');
    assert.match(para.text.find((t: any) => t.type === 'button').button.copy_text.text, /checkout\.html\?invoice_id=INV/);
    assert.ok(rm.blocks.some((b: any) => b.type === 'expandable_blockquote' && /دقیقاً همین مبلغ/.test(b.text)));
    const inv = (dbService as any).db.prepare(`SELECT * FROM invoices WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 1`).get(merchantId) as any;
    assert.strictEqual(inv.status, 'PENDING');
    assert.ok(inv.expected_amount >= 2_500_000 && inv.expected_amount < 2_510_000, 'unique amount near the base price');
  });

  test('Bale gets plain text with an inline keyboard (no rich-only fields)', async () => {
    const code = JSON.parse((await app.inject({ method: 'POST', url: '/api/v2/bots/link-code', headers: auth() })).body);
    assert.strictEqual(code.bale_url, `https://ble.ir/bolgram_bale_bot?start=link_${code.code}`);
    await msg(bale, BALE_CHAT, code.code.slice(0, 4) + '-' + code.code.slice(4).toLowerCase());
    await press(bale, BALE_CHAT, 'home');
    const sent = last('BALE', ['sendMessage', 'editMessageText']);
    assert.ok(!fake.calls.some((c) => c.token === 'BALE' && c.method === 'sendRichMessage'));
    assert.ok(sent.body.text.includes('🏪'));
    const buttons = sent.body.reply_markup.inline_keyboard.flat();
    assert.ok(buttons.length > 3);
    for (const b of buttons) assert.ok(!('style' in b) && !('copy_text' in b), JSON.stringify(b));
  });

  test('payment alerts reach every linked chat; text fallback when rich messages are unavailable', async () => {
    fake.setRich(false);
    const before = fake.calls.length;
    await notifyPayment(merchantId, { amount: 2_500_130, provider: 'mellat', invoiceId: 'INVTEST', trxId: '123456' });
    const sent = fake.calls.slice(before);
    assert.ok(sent.some((c) => c.token === 'TG' && c.method === 'sendRichMessage'), 'tried rich first');
    const tgText = sent.find((c) => c.token === 'TG' && c.method === 'sendMessage');
    assert.ok(tgText && /پرداخت تأیید شد/.test(tgText.body.text) && /۲۵۰٬۰۱۳ تومان/.test(tgText.body.text), 'fell back to text');
    assert.ok(sent.some((c) => c.token === 'BALE' && c.method === 'sendMessage'));
    fake.setRich(true);
  });

  test('password reset (token_version bump) ends bot sessions', async () => {
    (dbService as any).db.prepare('UPDATE merchants SET token_version = coalesce(token_version, 0) + 1 WHERE id = ?').run(merchantId);
    await msg(bale, BALE_CHAT, '/start');
    assert.match(last('BALE', ['sendMessage']).body.text, /خوش آمدید/);
    const links = (dbService as any).db.prepare('SELECT count(*) AS n FROM bot_links WHERE merchant_id = ?').get(merchantId) as any;
    assert.strictEqual(Number(links.n), 1, 'only the Bale link was checked and removed so far');
  });
});

# Bolgram (بولگرام) — conventions for panel features

Iranian card-to-card payment gateway. Money goes **directly to the merchant's own bank cards**; a paired Android
phone forwards bank SMS; every open invoice gets a **unique amount** so a deposit SMS identifies exactly one invoice.
Fork of SyncPay (Fastify 5 + TypeScript, `node:sqlite`), panel is vanilla ES modules (no build step).

## Product rules (everywhere)
- Service name «بولگرام» (`SERVICE_NAME` in `src/bot/bot.service.ts`, `CONFIG.SERVICE_NAME` in `public/panel/assets/js/core.js`). Never «بلگرام».
- **DB stores Rial. People type and read Toman.** API inputs named `amount` are Toman unless the name ends in `_rial`; responses give `*_rial` (and `*_toman` where useful).
- Persian UI, RTL; Persian digits with «٬» separators (`faNum`, `toman` in core.js); Jalali dates in Tehran time (`jDate`, `jDateTime`, `jdate.js`). LTR fields (mobile, email, card, codes, URLs) use class `ltr`.
- Real features only — no mock data, no fake numbers, no "demo" fallbacks. Empty states explain what to do next.
- Security first: scope every query by `merchant_id`; never return full card numbers (`last4` only); validate and length-limit every input; Persian error messages.

## Backend: one plugin per feature
- File `src/routes/v2/<feature>.routes.ts`, `export default async function <feature>Routes(app)`. Already registered inside `v2Routes`
  (`src/routes/v2/index.ts`), so it inherits these hooks:
  - `/api/v2/*` → merchant session verified. `merchantOf(req)` = merchants row, `actorOf(req)` = `{ kind: 'owner'|'staff', id, name, role, perms }`.
    Protect every route: `app.get(path, { preHandler: requirePerm('invoices:read') }, handler)` (`src/services/access.ts` has `PERMS`, `ROLES`, `ROLE_PERMS`).
  - `/api/owner/*` → platform owner (admin JWT from `POST /api/owner/auth/login`) verified; `(req as any).admin`.
  - Anything else (e.g. `/api/pub/...`, `/l/:slug`) is public: validate hard, add `config: { rateLimit: { max, timeWindow } }` on abusable routes.
- Schema: an `ensure<Feature>Schema()` at the top of your plugin with `CREATE TABLE IF NOT EXISTS` and guarded `ALTER TABLE ... ADD COLUMN`
  (check `PRAGMA table_info` first). Prefix your own tables with your feature (e.g. `link_`, `wallet_`, `ticket_`).
- Helpers in `src/routes/v2/_kit.ts`: `db()`, `merchantOf`, `actorOf`, `fail(reply, status, code, faMessage, fieldErrors?)`, `paging(query)`,
  `utcSql`, `isoOf`, `tomanOf`, `str(v, max)`, `csv(reply, filename, header, rows)` (Excel-safe UTF-8 BOM).
- Response shapes: `{ success: true, ... }`; lists `{ success: true, data: [...], page, per_page, total }`; errors
  `{ success: false, error: 'code', message: 'پیام فارسی', errors?: { field: 'پیام' } }`, validation = 422, not found = 404, conflict = 409, plan/wallet = 402.
- Timestamps: SQLite `CURRENT_TIMESTAMP` columns are UTC text `YYYY-MM-DD HH:MM:SS` (`transactions.created_at`, `invoices.created_at`);
  `invoices.expires_at` is ISO. Return ISO with `isoOf()`. New tables may store epoch ms integers.
- Audit important actions: `audit(req, merchantId, 'card.deleted', targetId, meta?)` (table `audit_log`).
- Uploads: data URLs in JSON via `saveDataUrl(dataUrl, { visibility: 'public'|'private', maxBytes, allow })` from `src/utils/uploads.ts`;
  public files are served at `/uploads/<file>`; private ones only through your own authenticated route with `readUpload(file, 'private')`.
  Upload routes need `{ bodyLimit: 8 * 1024 * 1024 }`.

### Existing data (columns that matter)
- `merchants`: id, name, handle (store slug), phone (mobile), email, api_key, webhook_url, status (ACTIVE|SUSPENDED), plan, brand_logo_url, token_version, referred_by (merchant id), created_at, mobile_verified.
- `invoices`: id (INV…), merchant_id, customer_name (note or label), customer_email, expected_amount (Rial, unique), status (PENDING|PAID|EXPIRED|CANCELLED), trx_id, payment_method (bank id), metadata (JSON text), redirect_url, cancel_url, webhook_url, channel (instagram|telegram|in_person|website|other), note, created_at, expires_at.
- `transactions`: confirmed deposits from SMS — merchant_id, device_id, provider (bank id), trx_id, amount (Rial), sender (payer card if known), is_verified, order_id (invoice id), created_at, source.
- `payment_methods` (cards): id, merchant_id, provider_type (bank id), title, account_name (holder), account_number (encrypted), last4, card_hash, is_active, sort_order.
- `devices`: id, merchant_id, device_token, device_name, sim_number, last_seen (UTC text), status, battery_level, device_model, android_version…
- `unmatched_sms` (held deposits): id, device_id, provider, sender, amount, trx_id, raw_sms, status (UNMATCHED|SUSPICIOUS|ASSIGNED|REJECTED), assigned_invoice_id, created_at.
- `team_members`, `audit_log` (`src/services/access.ts`); `bot_links` (`src/bot/bot.service.ts`); `otp_codes`, `auth_failures` (`src/routes/v2.routes.ts`).
- Banks: `BANKS`, `bankByBin` in `src/parsers/ir/registry.ts` (`nameFa`, `color`, `bins`); `bankName(id)` in `src/services/store.service.ts`.

### Services to reuse (do not duplicate)
- `src/services/store.service.ts`: `listCards`, `addCard`, `setCardActive`, `deleteCard`, `createInvoice(merchantId, { amount (Toman), channel, note, source })`,
  `todaySummary`, `recentPayments`, `recentInvoices`, `openDeposits`, `depositCandidates`, `approveDeposit` (marks PAID + webhook + `invoice.paid`), `rejectDeposit`, `StoreError`.
- `InvoiceRepository.create(...)` (Rial) runs invoice guards (`assertCanInvoice`) and emits `invoice.created`; use `source`.
- `src/services/events.ts`: `events.on/emit` with typed `EventMap` (`invoice.created`, `invoice.paid`, `invoice.cancelled`, `deposit.held`, `device.offline`, `device.online`,
  `wallet.low`, `wallet.credited`, `ticket.replied`, `trust.decided`, `plan.changed`), `registerInvoiceGuard`, `registerLimitProvider`, `checkLimit(merchantId, 'cards'|'links'|'team'|'devices', currentCount)`, `GuardError`.
  Subscribe inside your plugin (it runs once at startup). Emit the events your feature owns.
- `WebhookService.dispatch` (`src/services/webhook.service.ts`), `notifyPayment` (bot), `MfsParser.parse(sender, body)` (`src/parsers/mfs.parser.ts`),
  `formatJalali`, `startOfTehranDay`, `startOfTehranMonth`, `tehranParts` (`src/parsers/ir/jalali.ts`), `toFaDigits`, `formatToman` (`src/parsers/ir/persian.ts`).
- Public base URL for links: `publicBase()` in `src/bot/bot.service.ts` (env `PUBLIC_BASE_URL`).

## Frontend (`public/panel/`)
- One module per page: `public/panel/assets/js/pages/<id>.js` exporting `async function render(page, { me, actor, query, sub, go })`.
  Router, guards and nav live in `app.js` / `shell.js` (`NAV` has the permission for each page). Hash routes: `#/invoices`, `#/invoices/INV123?status=PAID`.
- `core.js` exports: `CONFIG, payBase, CTX, can(perm), api(path, { method, body, auth }), session, ApiError, download(path, filename), table(cols, rows, opts), pager(p, onGo),
  useStyle(id, css), fileToDataUrl, toFa, toLatin, fixArabic, faNum, rialToToman, toman(rial), esc, jDate, jTime, jDateTime, ago, normMobile, normEmail, luhn, debounce,
  $, $$, toast(msg, 'ok'|'err'), modal({ title, body, actions, onClose, wide }) → { el, close }, confirmDialog(title, text, okLabel, danger) → Promise<bool>,
  setBusy(btn, busy, label), copy(text, btn), emptyState(icon, title, text, ctaHtml), ICON`.
  `jdate.js`: `toJ, fromJ, fmtJ, parseJ, startOfDay, preset(id), PRESETS, MONTHS, rangeControl(initial, onChange)`.
  `shell.js`: `quickInvoice()` (new-invoice modal), `allowed(pageId)`.
- Always `esc()` user data in HTML. Hide actions the actor can't do (`can('links:manage')`); the API enforces it anyway.
- CSS (`assets/panel.css`, tokens `--bg --surface --surface-2 --border --fg --muted --brand --brand-soft --accent --green --amber --red` and `*-soft`):
  `.page-head`(h1 + `.actions`), `.card`, `.card-head`(h3), `.grid.g2/.g3/.g4`, `.btn` + `.btn-primary/.btn-green/.btn-danger/.btn-ghost/.btn-sm/.btn-block`,
  `.pill` + `.ok/.warn/.bad`, `.chip`, `.field` (label + `.input` + `.hint` + `.err`), `.input.select`, `textarea.input`, `.check`, `.toolbar`, `.range-ctl`,
  `.table-wrap/.table` (cards on phones via `data-label`), `.pager`, `.tabs` (`aria-selected`), `.seg` (`aria-pressed`), `.kv` (dl), `.sheet` + `.sheet-backdrop`,
  `.timeline`, `.stat`, `.code`, `.progress>i`, `.stars`, `.empty`, `.list`, `.kpi`, `.alert.alert-ok/.alert-warn/.alert-err`, `.muted`, `.ltr`, `.num`, `.hidden`, `.sr-only`.
  Page-specific CSS: `useStyle('<id>', css)` using the tokens (both themes). No new colours.
- Quality bar: works at 390px with no horizontal scroll; keyboard and screen-reader friendly (labels, `aria-live` for async results); loading state;
  error toasts; confirm destructive actions; Persian copy that a shop owner understands.
- Charts: hand-written SVG, one axis, thin marks, text in text colours, accessible `<title>`/table fallback (see dashboard hourly chart).

## Tests and checks
- Unit/integration: `tests/<feature>.test.ts` — Fastify + `v2Routes` + register a merchant (see `tests/bot.test.ts`, `tests/auth_v2.test.ts`).
  Run one file: `DB_PATH=<your scratch dir>/<feature>.db node --test --import tsx tests/<feature>.test.ts`. Full suite: `npm test` (serial). Types: `npx tsc --noEmit`.
- Browser: `PORT=<your port> DB_PATH=<scratch>/<feature>-e2e.db BOT_MODE=off node --import tsx src/index.ts &` then
  `node /tmp/claude-0/-home-user-bolgram/7cd0b2bf-51d2-515b-8c8f-32001877a8ff/scratchpad/pw/smoke.mjs http://127.0.0.1:<port> <outDir> <route,route>`
  (Playwright from that folder; Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`). Look at your screenshots.
- External APIs (Telegram, Bale, SMS.IR, Google) are blocked in this sandbox — test against local fakes.

# SyncPay BD / PayFlow MFS — Agent Quick-Navigation & Codebase Index

This document acts as an instant index and lookup directory for AI agents and developers working on `syncpay-bd` / `payflow-mfs`. Use this map to locate any feature, route, database query, or bug location without blind crawling.

---

## 1. System Architecture Map

```
+-------------------------------------------------------------+
|                      FLUTTER FORWARDER                      |
| (zinipay_forwarder/lib/ - SMS Ingest, Notification Listener)|
+------------------------------+------------------------------+
                               | POST /api/v1/device/sms/ingest
                               v
+-------------------------------------------------------------+
|                     BACKEND FASTIFY (src/)                  |
|  - Ingestion & Auth: src/routes/device.routes.ts            |
|  - SMS Regex Parsers: src/parsers/mfs.parser.ts             |
|  - Payment/Checkout: src/routes/payment.routes.ts           |
|  - Merchant Dashboard: src/routes/merchant.routes.ts        |
|  - Superadmin: src/routes/admin.routes.ts                   |
+------------------------------+------------------------------+
                               |
                               +---> Repositories (src/db/repositories/)
                               |      - transaction, invoice, merchant,
                               |        device, api-key
                               v
+-------------------------------------------------------------+
|                       SUPABASE / POSTGRES                   |
|           (src/db/supabase.ts & database.ts)                |
+-------------------------------------------------------------+
                               ^
                               | Fetches stats, logs, channels
+------------------------------+------------------------------+
|                     FRONTEND DASHBOARDS (public/)           |
|  - Merchant: public/dashboard.html, public/dashboard/js/    |
|  - Admin: public/admin.html, public/admin/js/               |
|  - Customer Checkout: public/checkout.html                  |
|  - API Docs: public/docs/                                   |
+-------------------------------------------------------------+
```

---

## 2. File Location Dictionary (Where to Find What)

| Feature / Domain | Primary File(s) | Key Symbols / Exports |
| :--- | :--- | :--- |
| **Server Boot & Plugins** | [`src/index.ts`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/src/index.ts) | `buildApp()`, Fastify plugins, CORS, Static routes |
| **SMS Ingestion & Device Pairing**| [`src/routes/device.routes.ts`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/src/routes/device.routes.ts) | `/api/v1/device/pair`, `/api/v1/device/sms/ingest`, `/heartbeat` |
| **SMS Regex Parsing Engine** | [`src/parsers/mfs.parser.ts`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/src/parsers/mfs.parser.ts) | `parseMfsSms()`, `bKash`, `Nagad`, `Rocket`, `Upay` patterns |
| **Payment API & Checkout Gateway** | [`src/routes/payment.routes.ts`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/src/routes/payment.routes.ts) | `/v1/payment/create`, `/v1/payment/verify`, checkout init |
| **Merchant Auth & Dashboard API** | [`src/routes/merchant.routes.ts`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/src/routes/merchant.routes.ts) | Login, Register, API Key generation, Channels, Settings |
| **Database Repositories** | [`src/db/repositories/`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/src/db/repositories) | `transaction.repository.ts`, `invoice.repository.ts`, `merchant.repository.ts`, `device.repository.ts` |
| **Database Connection & Client** | [`src/db/supabase.ts`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/src/db/supabase.ts) | Supabase client setup, fallback DB handling |
| **Webhook Delivery Service** | [`src/services/webhook.service.ts`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/src/services/webhook.service.ts) | HMAC SHA-256 signature, retry queue, status callback |
| **Fraud & Rate Limiting** | [`src/middleware/fraud-shield.ts`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/src/middleware/fraud-shield.ts) | IP blacklist, suspicious pattern detection |
| **Merchant Web Dashboard** | [`public/dashboard.html`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/public/dashboard.html) | Main UI entry for merchant dashboard |
| **Merchant Dashboard Scripts** | [`public/dashboard/js/`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/public/dashboard/js) | `app.js`, `components.js`, `api.js`, `auth.js`, `i18n.js` |
| **Customer Checkout Page** | [`public/checkout.html`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/public/checkout.html) | Payment selection, TrxID submission, QR display |
| **Admin Panel UI & Logic** | [`public/admin.html`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/public/admin.html) + [`public/admin/js/`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/public/admin/js) | Admin metrics, all merchants, platform fees |
| **Flutter Android Forwarder** | [`zinipay_forwarder/lib/`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/zinipay_forwarder/lib) | `main.dart`, `app_config.dart`, `api_client.dart` |

---

## 3. Instant Bug Diagnosis Table (Symptom -> Cause -> Target File)

| Issue / Symptom | Likely Cause | Go-To File & Action |
| :--- | :--- | :--- |
| **SMS received on phone but not in dashboard** | Ingest endpoint failing or SMS format not matched | Check [`src/parsers/mfs.parser.ts`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/src/parsers/mfs.parser.ts) & [`src/routes/device.routes.ts`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/src/routes/device.routes.ts) |
| **Invoice status stuck on PENDING** | Auto-matching between SMS transaction and Invoice amount/sender failed | Check [`src/services/payment.service.ts`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/src/services/payment.service.ts) and [`src/db/repositories/invoice.repository.ts`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/src/db/repositories/invoice.repository.ts) |
| **Webhook not received by merchant site** | Missing webhook secret, bad URL, or signature mismatch | Check [`src/services/webhook.service.ts`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/src/services/webhook.service.ts) |
| **Merchant Dashboard shows empty charts/tables** | Auth token expired or API response format mismatch | Check [`public/dashboard/js/api.js`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/public/dashboard/js/api.js) & [`public/dashboard/js/app.js`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/public/dashboard/js/app.js) |
| **Device shows OFFLINE even when active** | Heartbeat timestamp threshold exceeded (>120s) | Check [`src/services/device.service.ts`](file:///Users/jahidulislam/.gemini/antigravity-ide/scratch/payflow-mfs/src/services/device.service.ts) |
| **TypeScript / Type mismatch errors** | Strict typing or schema discrepancy | Run `npm run typecheck` (`npx tsc --noEmit`) |

---

## 4. One-Click Diagnostic & Operational Commands

- **Run Full Test Suite**: `npm test` (Executes all 43 unit and integration test suites via Node native runner)
- **Run Type Check**: `npm run typecheck` (or `npx tsc --noEmit`)
- **Run Full Diagnostics**: `npm run diagnose` (Checks TypeScript, env configs, SQLite/PostgreSQL, and parser rules)
- **Run Parser Unit Tests**: `node --test --import tsx tests/parser.test.ts`
- **Simulate Incoming SMS**: `npm run simulate`
- **Run Development Watcher**: `npm run dev` (`tsx watch src/index.ts`)
- **Compile Production Bundle**: `npm run build` (`tsc`)
- **Start Production Server**: `npm start` (`node dist/index.js`)
- **API Swagger Documentation**: Access `http://localhost:4000/docs` (OpenAPI v3 generated via `@fastify/swagger` and `@fastify/swagger-ui`)

---

## 5. Architectural Standards & Optimizations
- **Declarative Parser Engine**: Table-driven rules in `src/parsers/mfs.parser.ts` matching bKash, Nagad, Rocket, and Upay SMS formats without nested imperative branches.
- **Fail-Safe Persistence Layer**: `src/db/repositories/base.repository.ts` guarantees seamless fallback between Supabase (PostgreSQL) and embedded SQLite (`node:sqlite`). UUID validation prevents Postgres syntax aborts.
- **Unified Validation & Type Safety**: `fastify-type-provider-zod` ensures end-to-end schema consistency across endpoints.


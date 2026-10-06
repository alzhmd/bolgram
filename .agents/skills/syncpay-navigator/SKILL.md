---
name: syncpay-navigator
description: Deep architecture navigator and instant bug diagnostic engine for SyncPay BD / PayFlow MFS. Use when locating routes, SMS parsers, database queries, frontend UI logic, or debugging transaction issues.
---

# SyncPay BD Navigator Skill

## Core Responsibilities
- Maps incoming requests directly to the exact file and line without broad searches.
- Verifies system health using `npm run diagnose` or `npm run typecheck`.
- Resolves transaction matching, SMS ingestion, and payment gateway issues.

## Quick Route to File Mapping
- **SMS Forwarding & Device**: `src/routes/device.routes.ts`
- **SMS Ingest Engine**: `src/services/device.service.ts` & `src/parsers/mfs.parser.ts`
- **Merchant Auth & Endpoints**: `src/routes/merchant.routes.ts`
- **Payment Gateway / Checkout**: `src/routes/payment.routes.ts` & `src/services/payment.service.ts`
- **Database Repositories**: `src/db/repositories/`
- **Frontend Dashboard**: `public/dashboard.html` & `public/dashboard/js/`
- **Checkout UI**: `public/checkout.html`
- **Flutter Forwarder**: `zinipay_forwarder/lib/`

## Instant Bug Tracing Checklist
1. If SMS fails to parse: check regex in `src/parsers/mfs.parser.ts`.
2. If invoice doesn't complete: check auto-matching in `src/services/payment.service.ts`.
3. If TypeScript compiler complains: run `npm run typecheck`.
4. If checking overall health: run `npm run diagnose`.

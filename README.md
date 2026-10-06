# SyncPay BD 🇧🇩

> Automated MFS (bKash, Nagad, Rocket, Upay) payment verification engine with zero per-transaction fees. Turn standard Android devices into real-time payment gateways for personal and agent numbers.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](package.json)
[![Fastify](https://img.shields.io/badge/Fastify-5.2-black.svg)](https://fastify.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](tsconfig.json)
[![Latest Release](https://img.shields.io/github/v/release/jahidulislamseo/syncpay-bd?color=orange&label=Release)](https://github.com/jahidulislamseo/syncpay-bd/releases/latest)
[![Download APK](https://img.shields.io/badge/Download-Android%20Forwarder%20APK%20(v1.2.0)-success?logo=android)](https://github.com/jahidulislamseo/syncpay-bd/releases/download/v1.2.0/syncpay-forwarder.apk)

### 📥 Direct Downloads (v1.2.0)

| Asset | Type | Link |
|---|---|---|
| **Android Forwarder Agent** | `.apk` (15 MB, Android 8.0+) | [**Download APK**](https://github.com/jahidulislamseo/syncpay-bd/releases/download/v1.2.0/syncpay-forwarder.apk) |
| **WooCommerce Gateway** | WordPress Plugin (`.zip`) | [**Download Plugin**](https://github.com/jahidulislamseo/syncpay-bd/releases/download/v1.2.0/syncpay-woocommerce-v2.4.2.zip) |
| **WHMCS Payment Module** | Gateway Module (`.zip`) | [**Download Module**](https://github.com/jahidulislamseo/syncpay-bd/releases/download/v1.2.0/syncpay-whmcs-v1.8.0.zip) |
| **PHP / Laravel SDK** | Package (`.zip`) | [**Download SDK**](https://github.com/jahidulislamseo/syncpay-bd/releases/download/v1.2.0/syncpay-php-sdk.zip) |
| **Node.js SDK** | TypeScript SDK (`.zip`) | [**Download SDK**](https://github.com/jahidulislamseo/syncpay-bd/releases/download/v1.2.0/syncpay-node-sdk.zip) |
| **Python Client SDK** | REST Client (`.zip`) | [**Download SDK**](https://github.com/jahidulislamseo/syncpay-bd/releases/download/v1.2.0/syncpay-python-sdk.zip) |

---

## Architecture Overview

SyncPay BD operates on an event-driven loop between mobile network incoming SMS messages, localized device ingestion endpoints, and merchant webhooks.

```
+---------------------------+       Incoming SMS       +------------------------------------+
| Bangladesh MFS Providers  |  =====================>  | Dedicated Android Forwarder Device |
| (bKash, Nagad, Rocket)    |                          | (Foreground Service + Telephony)   |
+---------------------------+                          +-----------------+------------------+
                                                                         |
                                                                         | Encrypted HTTPS / Bearer Token
                                                                         v
+-------------------------------+                     +------------------+------------------+
| Merchant Store / Application  |                     | SyncPay BD Core Engine (Fastify/TS) |
| (WooCommerce, WHMCS, Custom)  | <================== | - Regex MFS Parser                  |
| - Instant Order Completion    |  Automated Webhook  | - TrxID & Amount Matcher Engine     |
+-------------------------------+  (HMAC SHA-256)     | - SQLite / Supabase Multi-Tenant DB |
                                                      +-------------------------------------+
```

1. **Transaction Event**: A customer sends funds via bKash, Nagad, Rocket, or Upay to your designated number.
2. **Device Capture**: The Android agent running on your physical device captures the notification or raw SMS via `Telephony.SMS_RECEIVED` broadcast receivers.
3. **Parse & Match**: SyncPay BD's parsing engine isolates the Transaction ID (`TrxID`), sender number, and exact BDT amount.
4. **Webhook Dispatch**: A cryptographically signed webhook notification (`HMAC-SHA256`) fires to the merchant URL to mark orders as paid.

---

## Features

- **Zero Transaction Fees**: Process unlimited payments through your own SIM cards without paying 1.5% - 2.0% merchant gateway commissions.
- **Multi-Provider Regex Parsing**: Production-tested parsers for bKash (`bKash`), Nagad (`NAGAD`), Rocket (`16216`), and Upay (`UPAY`).
- **Device Health Monitoring**: Track battery levels, network status, active SIM slots, and last heartbeat timestamps directly from the dashboard.
- **Merchant Single-Page Application (SPA)**:
  - Live SMS Stream & Telemetry
  - Quick TrxID Match Tool
  - API Key & Webhook Secret Management
  - Invoice Generator & Dynamic Checkout URLs
  - Package-based Feature Entitlements
- **Offline SMS Caching**: Android agent queues transactions locally when internet access drops and re-syncs upon connection restore.

---

## Project Structure

```
├── src/
│   ├── config/             # Environment variables and runtime configuration
│   ├── db/                 # Repositories and SQLite/Supabase database adapters
│   ├── parsers/            # Regex parsers for bKash, Nagad, Rocket, and Upay
│   ├── routes/             # Fastify REST routes (merchant, device, payment, admin)
│   ├── services/           # Payment verification, transaction matching, and webhooks
│   └── index.ts            # Fastify application entry point
├── public/                 # Merchant Dashboard & Landing Page
│   ├── dashboard.html      # Merchant SPA shell
│   ├── checkout.html       # Hosted payment checkout page
│   ├── admin.html          # Super admin console
│   └── dashboard/          # Frontend assets, auth logic, components, and i18n
├── packages/               # Official Integration SDKs & Plugins
│   ├── woocommerce-gateway/# WordPress / WooCommerce Payment Plugin
│   ├── whmcs-module/       # WHMCS Billing Gateway Module
│   ├── php-sdk/            # Standalone PHP & Laravel SDK
│   ├── node-sdk/           # Node.js & TypeScript SDK
│   └── python-sdk/         # Python Client SDK
├── zinipay_forwarder/      # Flutter & Native Android SMS forwarder source code
├── scripts/                # SMS simulation and database migration tools
└── tests/                  # Integration and unit tests
```

---

## Quick Start

### Prerequisites

- **Node.js**: v20.x or higher
- **npm** or **pnpm**
- Physical Android phone (Android 8.0+) with active MFS SIMs

### 1. Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/jahidulislamseo/syncpay-bd.git
cd syncpay-bd
npm install
```

### 2. Environment Configuration

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Configure your environment variables:

```env
PORT=4000
HOST=0.0.0.0
NODE_ENV=development
API_SECRET=your-secure-random-token
DB_PATH=./payflow.db
BASE_URL=http://localhost:4000
```

### 3. Start Development Server

Run the development server with live reload:

```bash
npm run dev
```

The services will be available at:
- **Landing Page**: [http://localhost:4000](http://localhost:4000)
- **Merchant Dashboard**: [http://localhost:4000/dashboard.html](http://localhost:4000/dashboard.html)
- **Developer Documentation**: [http://localhost:4000/docs/api.html](http://localhost:4000/docs/api.html)

---

## Android Forwarder Setup

The Android Forwarder agent runs as a persistent background service to forward incoming MFS SMS messages to the SyncPay engine.

1. Open `zinipay_forwarder` in Android Studio or VS Code.
2. Build the APK or run directly on your test device:
   ```bash
   cd zinipay_forwarder
   flutter pub get
   flutter build apk --release
   ```
3. Install the generated APK on your device:
   ```bash
   adb install build/app/outputs/flutter-apk/app-release.apk
   ```
4. Open the app, grant SMS and Battery Optimization permissions, then pair with your dashboard by scanning the Device QR code.

---

## API Reference

### Create an Invoice

```http
POST /api/v1/payment/create
Content-Type: application/json
Authorization: Bearer <MERCHANT_API_KEY>

{
  "amount": 1500,
  "orderId": "ORD-98421",
  "customerPhone": "017XXXXXXXX",
  "redirectUrl": "https://yourshop.com/checkout/success",
  "webhookUrl": "https://yourshop.com/api/payment-webhook"
}
```

**Response (`201 Created`):**

```json
{
  "success": true,
  "invoiceId": "INV-89124-BD",
  "paymentUrl": "http://localhost:4000/checkout.html?invoice=INV-89124-BD",
  "amount": 1500,
  "expiresAt": "2026-09-19T10:30:00.000Z"
}
```

### Ingest Incoming SMS (Device Endpoint)

```http
POST /api/v1/device/ingest
Content-Type: application/json
X-Device-Token: <DEVICE_TOKEN>

{
  "sender": "bKash",
  "message": "You have received Tk 1,500.00 from 017XXXXXXXX. Fee Tk 0.00. Balance Tk 25,430.00. TrxID 9K38DF12A at 19/09/2026 15:20",
  "receivedAt": 1789809600000,
  "simSlot": 1
}
```

**Response (`200 OK`):**

```json
{
  "status": "matched",
  "matchedInvoice": "INV-89124-BD",
  "trxId": "9K38DF12A",
  "amount": 1500,
  "provider": "bkash"
}
```

---

## SDKs & Integrations

Pre-packaged integrations ready for deployment:

| Module | Location | Description |
|---|---|---|
| **WooCommerce** | `packages/woocommerce-gateway/` | Native WordPress plugin with custom checkout fields |
| **WHMCS** | `packages/whmcs-module/` | Automated invoice activation module for hosting providers |
| **PHP / Laravel** | `packages/php-sdk/` | PSR-4 compliant composer package with webhook verification |
| **Node.js** | `packages/node-sdk/` | TypeScript client library with type-safe methods |
| **Python** | `packages/python-sdk/` | SyncPay REST client for Django, FastAPI, and Flask |

---

## Testing & Simulation

Test the complete end-to-end flow without waiting for actual mobile SMS transfers:

```bash
# Run unit and integration tests
npm test

# Simulate an incoming bKash payment SMS
npm run simulate
```

---

## Security & Verification

- **HMAC Signatures**: Every outgoing webhook contains an `X-SyncPay-Signature` header calculated using SHA-256 and your merchant webhook secret.
- **Double-Spend Prevention**: The database enforces a unique constraint on all parsed `trx_id` records, preventing duplicate transaction submissions.
- **Zero Raw Credentials**: The engine never requests or handles your MFS PIN or personal login details. It reads only incoming payment notification SMS records.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## API Integrations
SyncPay BD provides standardized endpoints for secure transactional handshakes.

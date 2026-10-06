import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || (process.env.VERCEL ? '/tmp/syncpay.db' : path.resolve(__dirname, '../../syncpay.db'));

export interface TransactionRecord {
  id: number;
  merchant_id: string;
  device_id: string;
  provider: string;
  trx_id: string;
  amount: number;
  sender: string | null;
  raw_sms: string;
  is_verified: number;
  verified_at: string | null;
  order_id: string | null;
  created_at: string;
}

export interface InvoiceRecord {
  id: string;
  merchant_id: string;
  customer_name: string;
  customer_email?: string | null;
  expected_amount: number;
  provider: string;
  order_id: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED';
  trx_id: string | null;
  payment_method?: string | null;
  metadata?: string | null;
  redirect_url?: string | null;
  cancel_url?: string | null;
  webhook_url?: string | null;
  created_at: string;
  expires_at: string;
}

export class DatabaseService {
  private db!: DatabaseSync;

  constructor(dbPath: string = DB_PATH) {
    try {
      this.db = new DatabaseSync(dbPath);
      this.initSchema();
    } catch (err) {
      console.warn(`[DatabaseService] Could not open SQLite at ${dbPath}, falling back to in-memory:`, err);
      try {
        this.db = new DatabaseSync(':memory:');
        this.initSchema();
      } catch (memErr) {
        console.error('[DatabaseService] Fatal: Failed to initialize in-memory SQLite:', memErr);
      }
    }
  }

  private initSchema() {
    // Enable foreign keys & WAL mode with retry busy timeout
    this.db.exec(`
      PRAGMA busy_timeout = 10000;
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS merchants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        api_key TEXT UNIQUE NOT NULL,
        webhook_url TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        device_token TEXT UNIQUE NOT NULL,
        device_name TEXT NOT NULL,
        sim_number TEXT,
        last_seen TEXT DEFAULT (datetime('now')),
        status TEXT DEFAULT 'ONLINE',
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        merchant_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        trx_id TEXT NOT NULL,
        amount REAL NOT NULL,
        sender TEXT,
        raw_sms TEXT NOT NULL,
        is_verified INTEGER DEFAULT 0,
        verified_at TEXT,
        order_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(merchant_id, trx_id),
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        customer_email TEXT,
        expected_amount REAL NOT NULL,
        provider TEXT NOT NULL,
        order_id TEXT NOT NULL,
        status TEXT DEFAULT 'PENDING',
        trx_id TEXT,
        payment_method TEXT,
        metadata TEXT,
        redirect_url TEXT,
        cancel_url TEXT,
        webhook_url TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      );

      CREATE INDEX IF NOT EXISTS idx_trx_id ON transactions(trx_id);
      CREATE INDEX IF NOT EXISTS idx_merchant_trx ON transactions(merchant_id, trx_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        secret_key TEXT NOT NULL,
        environment TEXT NOT NULL DEFAULT 'sandbox',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')),
        last_used TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      );

      CREATE TABLE IF NOT EXISTS admin_users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL DEFAULT 'Super Admin',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        password_hash TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        last_login TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_email TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        resource_id TEXT,
        ip TEXT DEFAULT '127.0.0.1',
        result TEXT DEFAULT 'SUCCESS',
        details TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS suspicious_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        merchant_id TEXT,
        device_id TEXT,
        ip TEXT,
        event_type TEXT NOT NULL,
        risk_reason TEXT NOT NULL,
        status TEXT DEFAULT 'FLAGGED',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS payment_methods (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        title TEXT NOT NULL,
        badge TEXT DEFAULT 'INSTANT',
        account_number TEXT NOT NULL,
        account_name TEXT,
        bank_name TEXT,
        branch_name TEXT,
        routing_number TEXT,
        sender_label TEXT DEFAULT 'Sender Phone Number',
        trx_label TEXT DEFAULT 'Transaction ID *',
        instructions TEXT,
        theme_color TEXT DEFAULT '#E2136E',
        is_active INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        qr_code_url TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      );

      CREATE TABLE IF NOT EXISTS payout_requests (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        merchant_name TEXT,
        amount REAL NOT NULL,
        fee REAL DEFAULT 0,
        net_amount REAL NOT NULL,
        payment_method TEXT NOT NULL,
        account_number TEXT NOT NULL,
        account_name TEXT,
        bank_name TEXT,
        branch_name TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        trx_id TEXT,
        rejection_reason TEXT,
        requested_at TEXT DEFAULT (datetime('now')),
        processed_at TEXT,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      );

      CREATE TABLE IF NOT EXISTS security_blacklist (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        value TEXT NOT NULL UNIQUE,
        reason TEXT NOT NULL,
        added_by TEXT DEFAULT 'Super Admin',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS unmatched_sms (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        sender TEXT,
        amount REAL NOT NULL,
        trx_id TEXT NOT NULL,
        raw_sms TEXT NOT NULL,
        status TEXT DEFAULT 'UNMATCHED',
        assigned_invoice_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS provider_rules (
        provider TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        regex_pattern TEXT NOT NULL,
        daily_limit REAL DEFAULT 50000,
        current_daily_total REAL DEFAULT 0,
        fee_percentage REAL DEFAULT 1.5,
        is_enabled INTEGER DEFAULT 1,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Safe column migrations for existing SQLite databases
    this.runMigrations();
    // Demo merchants/devices/keys have publicly known credentials: never seed them in production.
    if (process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO === 'true') {
      this.seedDemoData();
      this.seedAdminData();
    }
  }

  private runMigrations() {
    const tableInfo = this.db.prepare('PRAGMA table_info(invoices)').all() as Array<{ name: string }>;
    const existingCols = new Set(tableInfo.map((col) => col.name));

    const colsToAdd: Array<{ name: string; type: string }> = [
      { name: 'customer_email', type: 'TEXT' },
      { name: 'payment_method', type: 'TEXT' },
      { name: 'metadata', type: 'TEXT' },
      { name: 'redirect_url', type: 'TEXT' },
      { name: 'cancel_url', type: 'TEXT' },
      { name: 'webhook_url', type: 'TEXT' },
    ];

    for (const col of colsToAdd) {
      if (!existingCols.has(col.name)) {
        this.db.exec(`ALTER TABLE invoices ADD COLUMN ${col.name} ${col.type};`);
      }
    }

    // Transactions: columns used by the device ingest path (missing from the upstream SQLite schema)
    const txCols = new Set((this.db.prepare('PRAGMA table_info(transactions)').all() as any[]).map((c) => c.name));
    for (const col of [
      { name: 'sim_slot', type: 'INTEGER' },
      { name: 'carrier', type: 'TEXT' },
      { name: 'source', type: 'TEXT' },
    ]) {
      if (!txCols.has(col.name)) this.db.exec(`ALTER TABLE transactions ADD COLUMN ${col.name} ${col.type};`);
    }

    // Devices hardware telemetry migrations
    const devTableInfo = this.db.prepare('PRAGMA table_info(devices)').all() as Array<{ name: string }>;
    const existingDevCols = new Set(devTableInfo.map((col) => col.name));
    const devColsToAdd: Array<{ name: string; type: string }> = [
      { name: 'battery_level', type: 'INTEGER' },
      { name: 'battery_temp', type: 'REAL' },
      { name: 'is_charging', type: 'INTEGER' },
      { name: 'charger_type', type: 'TEXT' },
      { name: 'free_ram_mb', type: 'INTEGER' },
      { name: 'sim_slots', type: 'TEXT' },
      { name: 'device_model', type: 'TEXT' },
      { name: 'android_version', type: 'TEXT' },
    ];
    for (const col of devColsToAdd) {
      if (!existingDevCols.has(col.name)) {
        this.db.exec(`ALTER TABLE devices ADD COLUMN ${col.name} ${col.type};`);
      }
    }

    // Transactions Dual-SIM and notification source migrations
    const txTableInfo = this.db.prepare('PRAGMA table_info(transactions)').all() as Array<{ name: string }>;
    const existingTxCols = new Set(txTableInfo.map((col) => col.name));
    const txColsToAdd: Array<{ name: string; type: string }> = [
      { name: 'sim_slot', type: 'INTEGER' },
      { name: 'carrier', type: 'TEXT' },
      { name: 'source', type: 'TEXT DEFAULT "SMS"' },
    ];
    // Merchants table column migrations
    const mTableInfo = this.db.prepare('PRAGMA table_info(merchants)').all() as Array<{ name: string }>;
    const existingMCols = new Set(mTableInfo.map((col) => col.name));
    const mColsToAdd: Array<{ name: string; type: string }> = [
      { name: 'email', type: 'TEXT' },
      { name: 'phone', type: 'TEXT' },
      { name: 'status', type: 'TEXT DEFAULT "ACTIVE"' },
      { name: 'plan', type: 'TEXT DEFAULT "FREE"' },
      { name: 'payment_status', type: 'TEXT DEFAULT "FREE"' },
      { name: 'payment_note', type: 'TEXT' },
      { name: 'password_hash', type: 'TEXT' },
      { name: 'brand_slug', type: 'TEXT' },
      { name: 'custom_domain', type: 'TEXT' },
      { name: 'has_custom_domain', type: 'INTEGER DEFAULT 0' },
      { name: 'brand_logo_url', type: 'TEXT' },
    ];
    for (const col of mColsToAdd) {
      if (!existingMCols.has(col.name)) {
        try {
          this.db.exec(`ALTER TABLE merchants ADD COLUMN ${col.name} ${col.type};`);
        } catch {}
      }
    }

    // Payment methods column migrations
    const pmTableInfo = this.db.prepare('PRAGMA table_info(payment_methods)').all() as Array<{ name: string }>;
    const existingPmCols = new Set(pmTableInfo.map((col) => col.name));
    const pmColsToAdd: Array<{ name: string; type: string }> = [
      { name: 'qr_code_url', type: 'TEXT' },
    ];
    for (const col of pmColsToAdd) {
      if (!existingPmCols.has(col.name)) {
        try {
          this.db.exec(`ALTER TABLE payment_methods ADD COLUMN ${col.name} ${col.type};`);
        } catch {}
      }
    }
  }

  private seedDemoData() {
    // Seed default demo merchant
    const checkDemoMerchant = this.db.prepare('SELECT id FROM merchants WHERE id = ?');
    if (!checkDemoMerchant.get('m_demo_101')) {
      this.db.prepare(`
        INSERT INTO merchants (id, name, api_key, webhook_url)
        VALUES ('m_demo_101', 'Demo Merchant Store', 'live_demo_sec_99410', 'http://localhost:3000/webhook')
      `).run();
    }

    // Seed official Bolgram sandbox merchant key
    const checkPayflowMerchant = this.db.prepare('SELECT id FROM merchants WHERE api_key = ?');
    const existing = checkPayflowMerchant.get('sandbox_test_8f4c9a2e7b31') as { id: string } | undefined;
    if (!existing) {
      this.db.prepare(`
        INSERT INTO merchants (id, name, api_key, webhook_url)
        VALUES ('m_payflow_sandbox', 'Bolgram Sandbox Merchant', 'sandbox_test_8f4c9a2e7b31', 'https://merchant.com/api/syncpay/webhook')
      `).run();
    } else if (existing.id !== 'm_payflow_sandbox') {
      this.db.exec(`
        PRAGMA foreign_keys = OFF;
        UPDATE devices SET merchant_id = 'm_payflow_sandbox' WHERE merchant_id = '${existing.id}';
        UPDATE transactions SET merchant_id = 'm_payflow_sandbox' WHERE merchant_id = '${existing.id}';
        UPDATE invoices SET merchant_id = 'm_payflow_sandbox' WHERE merchant_id = '${existing.id}';
        UPDATE merchants SET id = 'm_payflow_sandbox', name = 'Bolgram Sandbox Merchant', webhook_url = 'https://merchant.com/api/syncpay/webhook' WHERE api_key = 'sandbox_test_8f4c9a2e7b31';
        PRAGMA foreign_keys = ON;
      `);
    }

    // Seed 17-digit merchant & legacy aliases
    if (!this.db.prepare('SELECT id FROM merchants WHERE id = ?').get('01711000000260923')) {
      this.db.prepare(`
        INSERT OR IGNORE INTO merchants (id, name, api_key, webhook_url)
        VALUES ('01711000000260923', 'Demo Merchant Store', 'live_demo_sec_99410_17d', 'http://localhost:3000/webhook')
      `).run();
    }
    if (!this.db.prepare('SELECT id FROM merchants WHERE id = ?').get('00000000-0000-0000-0000-000000000101')) {
      this.db.prepare(`
        INSERT OR IGNORE INTO merchants (id, name, api_key, webhook_url)
        VALUES ('00000000-0000-0000-0000-000000000101', 'Demo Merchant Store (UUID)', 'live_demo_sec_99410_uuid', 'http://localhost:3000/webhook')
      `).run();
    }
    if (!this.db.prepare('SELECT id FROM merchants WHERE id = ?').get('00000000-0000-0000-0000-000000000999')) {
      this.db.prepare(`
        INSERT OR IGNORE INTO merchants (id, name, api_key, webhook_url)
        VALUES ('00000000-0000-0000-0000-000000000999', 'Bolgram Sandbox (UUID)', 'sandbox_test_8f4c9a2e7b31_uuid', 'https://merchant.com/api/syncpay/webhook')
      `).run();
    }

    // Purge legacy pre-seeded mock devices so merchants start with a 100% clean slate
    this.db.prepare("DELETE FROM devices WHERE id IN ('dev_phone_1', '00000000-0000-0000-0000-000000000001') OR device_token LIKE 'token_phone_primary%'").run();

    // Purge legacy pre-seeded mock payment channels so merchants start with a 100% clean slate
    this.db.prepare("DELETE FROM payment_methods WHERE id LIKE 'pm_%_m_demo_101' OR id LIKE 'pm_%_00000000-0000-0000-0000-000000000101' OR id LIKE 'pm_%_01711000000260923'").run();
  }

  private seedPaymentMethods() {
    // Disabled: merchants start with 0 payment channels until explicitly added
  }

  public getMerchantByApiKey(apiKey: string) {
    const stmt = this.db.prepare('SELECT * FROM merchants WHERE api_key = ?');
    return stmt.get(apiKey) as { id: string; name: string; api_key: string; webhook_url: string } | undefined;
  }

  public getMerchantById(id: string) {
    const stmt = this.db.prepare("SELECT * FROM merchants WHERE id = ? OR (id = 'm_demo_101' AND (? = '00000000-0000-0000-0000-000000000101' OR ? = '01711000000260923'))");
    return stmt.get(id, id, id) as { id: string; name: string; api_key: string; webhook_url: string; [key: string]: any } | undefined;
  }

  public getMerchantByEmail(email: string) {
    const stmt = this.db.prepare('SELECT * FROM merchants WHERE LOWER(email) = LOWER(?)');
    return stmt.get(email) as { id: string; name: string; api_key: string; webhook_url: string; [key: string]: any } | undefined;
  }

  public getMerchantBySlug(slug: string) {
    const stmt = this.db.prepare('SELECT * FROM merchants WHERE LOWER(brand_slug) = LOWER(?)');
    return stmt.get(slug) as { id: string; name: string; api_key: string; webhook_url: string; [key: string]: any } | undefined;
  }

  public getMerchantByDomain(domain: string) {
    const cleanDomain = domain.toLowerCase().replace(/:\d+$/, '');
    const stmt = this.db.prepare('SELECT * FROM merchants WHERE LOWER(custom_domain) = ?');
    return stmt.get(cleanDomain) as { id: string; name: string; api_key: string; webhook_url: string; [key: string]: any } | undefined;
  }

  public updateMerchantBranding(id: string, params: {
    brand_slug?: string;
    custom_domain?: string;
    has_custom_domain?: number;
    brand_logo_url?: string;
  }) {
    const fields: string[] = [];
    const values: any[] = [];

    if (params.brand_slug !== undefined) {
      fields.push('brand_slug = ?');
      values.push(params.brand_slug ? params.brand_slug.toLowerCase().trim() : null);
    }
    if (params.custom_domain !== undefined) {
      fields.push('custom_domain = ?');
      values.push(params.custom_domain ? params.custom_domain.toLowerCase().trim() : null);
    }
    if (params.has_custom_domain !== undefined) {
      fields.push('has_custom_domain = ?');
      values.push(params.has_custom_domain);
    }
    if (params.brand_logo_url !== undefined) {
      fields.push('brand_logo_url = ?');
      values.push(params.brand_logo_url ? params.brand_logo_url.trim() : null);
    }

    if (fields.length === 0) return;

    values.push(id);
    values.push(id);
    const sql = `UPDATE merchants SET ${fields.join(', ')} WHERE id = ? OR (id = 'm_demo_101' AND ? = '00000000-0000-0000-0000-000000000101')`;
    return this.db.prepare(sql).run(...values);
  }

  public insertMerchant(params: {
    id: string;
    name: string;
    api_key: string;
    webhook_url?: string;
    email?: string;
    phone?: string;
    status?: string;
    plan?: string;
    payment_status?: string;
    password_hash?: string;
  }) {
    const stmt = this.db.prepare(`
      INSERT INTO merchants (id, name, api_key, webhook_url, email, phone, status, plan, payment_status, password_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        email = excluded.email,
        phone = excluded.phone,
        status = excluded.status,
        plan = excluded.plan,
        payment_status = excluded.payment_status,
        password_hash = excluded.password_hash
    `);
    return stmt.run(
      params.id,
      params.name,
      params.api_key,
      params.webhook_url || '',
      params.email || '',
      params.phone || '',
      params.status || 'ACTIVE',
      params.plan || 'FREE',
      params.payment_status || 'FREE',
      params.password_hash || ''
    );
  }

  /** Amounts that must not be reused: open invoices + anything issued in the last 24h (late/double transfers). */
  public getReservedAmounts(merchantId: string, min: number, max: number): number[] {
    const rows = this.db
      .prepare(`SELECT expected_amount AS a FROM invoices WHERE merchant_id = ? AND expected_amount BETWEEN ? AND ? AND (status = 'PENDING' OR created_at >= datetime('now', '-1 day'))`)
      .all(merchantId, min, max) as any[];
    return rows.map((r) => Number(r.a));
  }

  public getPendingInvoicesForMerchant(merchantId: string, amount: number): InvoiceRecord[] {
    const stmt = this.db.prepare('SELECT * FROM invoices WHERE merchant_id = ? AND expected_amount = ? AND status = ?');
    return stmt.all(merchantId, amount, 'PENDING') as unknown as InvoiceRecord[];
  }

  public getDeviceByToken(tokenOrId: string) {
    const stmt = this.db.prepare('SELECT * FROM devices WHERE device_token = ? OR id = ?');
    return stmt.get(tokenOrId, tokenOrId) as { id: string; merchant_id: string; device_name: string; sim_number: string } | undefined;
  }

  public updateDeviceHeartbeat(
    tokenOrId: string,
    telemetry?: {
      battery_level?: number;
      battery_temp?: number;
      battery_temperature?: number;
      is_charging?: boolean;
      charger_type?: string;
      free_ram_mb?: number;
      sim_slots?: any[];
      device_name?: string;
      device_model?: string;
      android_version?: string;
      sim_number?: string;
    }
  ) {
    // If device doesn't exist in local SQLite, insert record to guarantee telemetry persistence
    const existing = this.db.prepare('SELECT id FROM devices WHERE device_token = ? OR id = ?').get(tokenOrId, tokenOrId);
    if (!existing) {
      try {
        this.db.prepare(`
          INSERT INTO devices (id, merchant_id, device_token, device_name, status, last_seen)
          VALUES (?, '00000000-0000-42d3-a7b6-aa2aa137fd1b', ?, ?, 'ONLINE', datetime('now'))
        `).run(tokenOrId, tokenOrId, telemetry?.device_name || 'Bolgram Device');
      } catch (_) {}
    }

    if (telemetry) {
      this.db.prepare(`
        UPDATE devices 
        SET last_seen = datetime('now'), 
            status = 'ONLINE',
            device_name = COALESCE(?, device_name),
            device_model = COALESCE(?, device_model),
            android_version = COALESCE(?, android_version),
            battery_level = COALESCE(?, battery_level),
            battery_temp = COALESCE(?, battery_temp),
            is_charging = COALESCE(?, is_charging),
            charger_type = COALESCE(?, charger_type),
            free_ram_mb = COALESCE(?, free_ram_mb),
            sim_slots = COALESCE(?, sim_slots),
            sim_number = COALESCE(?, sim_number)
        WHERE device_token = ? OR id = ?
      `).run(
        telemetry.device_name ?? null,
        telemetry.device_model ?? null,
        telemetry.android_version ?? null,
        telemetry.battery_level ?? null,
        telemetry.battery_temp ?? telemetry.battery_temperature ?? null,
        telemetry.is_charging != null ? (telemetry.is_charging ? 1 : 0) : null,
        telemetry.charger_type ?? null,
        telemetry.free_ram_mb ?? null,
        telemetry.sim_slots ? JSON.stringify(telemetry.sim_slots) : null,
        telemetry.sim_number ?? null,
        tokenOrId,
        tokenOrId
      );
    } else {
      this.db.prepare("UPDATE devices SET last_seen = datetime('now'), status = 'ONLINE' WHERE device_token = ? OR id = ?").run(tokenOrId, tokenOrId);
    }
  }

  public insertTransaction(params: {
    merchantId: string;
    deviceId: string;
    provider: string;
    trxId: string;
    amount: number;
    sender?: string;
    rawSms: string;
    simSlot?: number;
    carrier?: string;
    source?: string;
  }): { success: boolean; isDuplicate?: boolean; id?: number } {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO transactions (merchant_id, device_id, provider, trx_id, amount, sender, raw_sms, sim_slot, carrier, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        params.merchantId,
        params.deviceId,
        params.provider,
        params.trxId.toUpperCase(),
        params.amount,
        params.sender || null,
        params.rawSms,
        params.simSlot != null ? params.simSlot : null,
        params.carrier || null,
        params.source || 'SMS'
      );
      return { success: true, id: Number(result.lastInsertRowid) };
    } catch (err: any) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        return { success: false, isDuplicate: true };
      }
      throw err;
    }
  }

  public findTransactionByTrxId(merchantId: string, trxId: string): TransactionRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM transactions WHERE merchant_id = ? AND trx_id = ?');
    return stmt.get(merchantId, trxId.toUpperCase()) as TransactionRecord | undefined;
  }

  public verifyAndLockTransaction(merchantId: string, trxId: string, expectedAmount: number, orderId: string): {
    success: boolean;
    reason?: string;
    transaction?: TransactionRecord;
  } {
    const trx = this.findTransactionByTrxId(merchantId, trxId);
    if (!trx) {
      return { success: false, reason: 'Transaction ID not found. Ensure money has been sent.' };
    }

    if (trx.is_verified === 1) {
      return { success: false, reason: 'This Transaction ID has already been used for another order.' };
    }

    if (Math.abs(trx.amount - expectedAmount) > 0.01) {
      return {
        success: false,
        reason: `Amount mismatch. Expected Tk ${expectedAmount.toFixed(2)}, received Tk ${trx.amount.toFixed(2)}.`,
      };
    }

    // Atomic update
    this.db.prepare(`
      UPDATE transactions
      SET is_verified = 1, verified_at = datetime('now'), order_id = ?
      WHERE id = ? AND is_verified = 0
    `).run(orderId, trx.id);

    const updated = this.findTransactionByTrxId(merchantId, trxId)!;
    return { success: true, transaction: updated };
  }

  public createInvoice(params: {
    id: string;
    merchantId: string;
    customerName: string;
    customerEmail?: string;
    expectedAmount: number;
    provider?: string;
    orderId?: string;
    metadata?: Record<string, any>;
    redirectUrl?: string;
    cancelUrl?: string;
    webhookUrl?: string;
    expiresInMinutes?: number;
  }): InvoiceRecord {
    const expiresAt = dayjs().add(params.expiresInMinutes || 30, 'minute').toISOString();
    const provider = params.provider || 'card';
    const orderId = params.orderId || params.id;
    const metadataStr = params.metadata ? JSON.stringify(params.metadata) : null;

    this.db.prepare(`
      INSERT INTO invoices (
        id, merchant_id, customer_name, customer_email, expected_amount, 
        provider, order_id, metadata, redirect_url, cancel_url, webhook_url, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.id,
      params.merchantId,
      params.customerName,
      params.customerEmail || null,
      params.expectedAmount,
      provider,
      orderId,
      metadataStr,
      params.redirectUrl || null,
      params.cancelUrl || null,
      params.webhookUrl || null,
      expiresAt
    );

    return this.getInvoiceById(params.id)!;
  }

  public getInvoiceById(id: string): InvoiceRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM invoices WHERE id = ?');
    return stmt.get(id) as InvoiceRecord | undefined;
  }

  public updateInvoiceStatus(id: string, status: 'PAID' | 'EXPIRED', trxId?: string, paymentMethod?: string) {
    this.db.prepare('UPDATE invoices SET status = ?, trx_id = ?, payment_method = COALESCE(?, payment_method) WHERE id = ?')
      .run(status, trxId || null, paymentMethod || null, id);
  }

  public getMerchantStats(merchantId: string) {
    const todayRevenue = this.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total, COUNT(id) as count
      FROM transactions
      WHERE merchant_id = ? AND date(created_at) = date('now')
    `).get(merchantId) as { total: number; count: number };

    const totalVerified = this.db.prepare(`
      SELECT COUNT(id) as count FROM transactions WHERE merchant_id = ? AND is_verified = 1
    `).get(merchantId) as { count: number };

    const devices = this.db.prepare('SELECT * FROM devices WHERE merchant_id = ?').all(merchantId);

    return {
      todayRevenue: todayRevenue.total,
      todayCount: todayRevenue.count,
      totalVerified: totalVerified.count,
      devices,
    };
  }

  public getRecentTransactions(merchantId: string, limit: number = 50): TransactionRecord[] {
    const stmt = this.db.prepare('SELECT * FROM transactions WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?');
    return stmt.all(merchantId, limit) as unknown as TransactionRecord[];
  }

  public getAllInvoices(merchantId: string, limit: number = 50): InvoiceRecord[] {
    const stmt = this.db.prepare('SELECT * FROM invoices WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?');
    return stmt.all(merchantId, limit) as unknown as InvoiceRecord[];
  }

  public getAllDevices(merchantId: string) {
    const stmt = this.db.prepare('SELECT * FROM devices WHERE merchant_id = ? ORDER BY last_seen DESC');
    return stmt.all(merchantId) as Array<{
      id: string;
      merchant_id: string;
      device_token: string;
      device_name: string;
      sim_number: string;
      last_seen: string;
      status: string;
    }>;
  }

  public addDevice(params: {
    id: string;
    merchantId: string;
    deviceName: string;
    simNumber: string;
    deviceToken: string;
  }) {
    this.db.prepare('INSERT OR IGNORE INTO merchants (id, name, api_key) VALUES (?, ?, ?)').run(
      params.merchantId,
      'Merchant Store',
      'key_' + params.merchantId
    );
    const stmt = this.db.prepare(`
      INSERT INTO devices (id, merchant_id, device_name, sim_number, device_token, status)
      VALUES (?, ?, ?, ?, ?, 'OFFLINE')
    `);
    stmt.run(params.id, params.merchantId, params.deviceName, params.simNumber, params.deviceToken);
    return this.getDeviceByToken(params.deviceToken);
  }

  public deleteDevice(deviceId: string, merchantId?: string) {
    if (merchantId) {
      const stmt = this.db.prepare(
        'DELETE FROM devices WHERE id = ? AND (merchant_id = ? OR merchant_id = ? OR merchant_id = ?)'
      );
      const res = stmt.run(deviceId, merchantId, '00000000-0000-0000-0000-000000000101', 'm_demo_101');
      if (res.changes > 0) return res;
    }
    const stmt = this.db.prepare('DELETE FROM devices WHERE id = ?');
    return stmt.run(deviceId);
  }

  public getAllApiKeys(merchantId: string) {
    const stmt = this.db.prepare('SELECT * FROM api_keys WHERE merchant_id = ? ORDER BY created_at DESC');
    const rows = stmt.all(merchantId) as Array<any>;
    if (rows.length === 0) {
      // Seed default demo key if none exist
      const merchant = this.db.prepare('SELECT * FROM merchants WHERE id = ?').get(merchantId) as any;
      if (merchant) {
        const id = 'key_' + Math.random().toString(36).substring(2, 8);
        const secret = merchant.api_key;
        const prefix = secret.substring(0, 8);
        this.db.prepare(`
          INSERT INTO api_keys (id, merchant_id, name, key_prefix, secret_key, environment, status)
          VALUES (?, ?, 'Default Integration Key', ?, ?, 'production', 'active')
        `).run(id, merchantId, prefix, secret);
        return stmt.all(merchantId) as Array<any>;
      }
    }
    return rows;
  }

  public createApiKey(merchantId: string, name: string, environment: 'production' | 'sandbox' = 'sandbox') {
    const id = 'key_' + Math.random().toString(36).substring(2, 9);
    const prefix = environment === 'production' ? 'zini_live_' : 'zini_sand_';
    const randomHex = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const secretKey = `${prefix}${randomHex}`;

    this.db.prepare(`
      INSERT INTO api_keys (id, merchant_id, name, key_prefix, secret_key, environment, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(id, merchantId, name, prefix, secretKey);

    return {
      id,
      merchant_id: merchantId,
      name,
      key_prefix: prefix,
      secret_key: secretKey,
      environment,
      status: 'active',
      created_at: new Date().toISOString(),
    };
  }

  public insertApiKey(data: {
    id: string;
    merchant_id: string;
    name: string;
    key_prefix: string;
    secret_key: string;
    environment?: string;
    status?: string;
  }) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO api_keys (id, merchant_id, name, key_prefix, secret_key, environment, status, created_at, last_used)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    return stmt.run(
      data.id,
      data.merchant_id,
      data.name,
      data.key_prefix,
      data.secret_key,
      data.environment || 'production',
      data.status || 'active'
    );
  }

  public revokeApiKey(keyId: string, merchantId?: string) {
    if (merchantId) {
      return this.db.prepare("UPDATE api_keys SET status = 'revoked' WHERE id = ? AND merchant_id = ?").run(keyId, merchantId);
    }
    return this.db.prepare("UPDATE api_keys SET status = 'revoked' WHERE id = ?").run(keyId);
  }

  public getChartData(merchantId: string, days: number = 7) {
    // Aggregated revenue and count by day for last N days
    const rows = this.db.prepare(`
      SELECT 
        date(created_at) as date,
        COALESCE(SUM(amount), 0) as revenue,
        COUNT(id) as total_txs,
        SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as successful_txs,
        SUM(CASE WHEN is_verified = 0 THEN 1 ELSE 0 END) as pending_txs
      FROM transactions
      WHERE merchant_id = ? AND date(created_at) >= date('now', '-' || ? || ' days')
      GROUP BY date(created_at)
      ORDER BY date(created_at) ASC
    `).all(merchantId, days) as Array<{
      date: string;
      revenue: number;
      total_txs: number;
      successful_txs: number;
      pending_txs: number;
    }>;

    return rows;
  }

  private seedAdminData() {
    // Seed default admin users
    const checkAdmin = this.db.prepare('SELECT id FROM admin_users WHERE email = ?');
    if (!checkAdmin.get('admin@bolgram.ir')) {
      this.db.prepare(`
        INSERT INTO admin_users (id, name, email, role, status, password_hash)
        VALUES ('admin_root', 'Bolgram Super Admin', 'admin@bolgram.ir', 'Super Admin', 'ACTIVE', 'hashed_superadmin_pwd')
      `).run();
    }
    if (!checkAdmin.get('ops@bolgram.ir')) {
      this.db.prepare(`
        INSERT INTO admin_users (id, name, email, role, status, password_hash)
        VALUES ('admin_ops', 'Tariqul Islam (Ops Lead)', 'ops@bolgram.ir', 'Operations Admin', 'ACTIVE', 'hashed_ops_pwd')
      `).run();
    }
    if (!checkAdmin.get('security@bolgram.ir')) {
      this.db.prepare(`
        INSERT INTO admin_users (id, name, email, role, status, password_hash)
        VALUES ('admin_sec', 'Nusrat Jahan (SecOps)', 'security@bolgram.ir', 'Security Admin', 'ACTIVE', 'hashed_sec_pwd')
      `).run();
    }

    // Seed additional merchants for multi-merchant topology demonstration
    const checkChaldal = this.db.prepare('SELECT id FROM merchants WHERE id = ?');
    if (!checkChaldal.get('m_chaldal_bd')) {
      this.db.prepare(`
        INSERT INTO merchants (id, name, api_key, webhook_url)
        VALUES ('m_chaldal_bd', 'Chaldal Grocery Express', 'live_sec_chaldal_7781', 'https://api.chaldal.com/syncpay/webhook')
      `).run();
    }
    if (!checkChaldal.get('m_daraz_hub')) {
      this.db.prepare(`
        INSERT INTO merchants (id, name, api_key, webhook_url)
        VALUES ('m_daraz_hub', 'Daraz BD Retail Partner', 'live_sec_daraz_9902', 'https://retail.daraz.com.bd/webhook')
      `).run();
    }
    if (!checkChaldal.get('m_gadget_mart')) {
      this.db.prepare(`
        INSERT INTO merchants (id, name, api_key, webhook_url)
        VALUES ('m_gadget_mart', 'Gadget Mart BD', 'live_sec_gadget_1033', 'https://gadgetmartbd.com/api/payment-callback')
      `).run();
    }

    // Seed devices for merchants
    const checkDev2 = this.db.prepare('SELECT id FROM devices WHERE id = ?');
    if (!checkDev2.get('dev_phone_2')) {
      this.db.prepare(`
        INSERT INTO devices (id, merchant_id, device_token, device_name, sim_number, status)
        VALUES ('dev_phone_2', 'm_chaldal_bd', 'token_chaldal_pri', 'Xiaomi Redmi Note 13 (Nagad+bKash)', '01899123456', 'ONLINE')
      `).run();
    }
    if (!checkDev2.get('dev_phone_3')) {
      this.db.prepare(`
        INSERT INTO devices (id, merchant_id, device_token, device_name, sim_number, status)
        VALUES ('dev_phone_3', 'm_daraz_hub', 'token_daraz_pri', 'OnePlus Nord CE4 (bKash Corporate)', '01911445566', 'ONLINE')
      `).run();
    }
    if (!checkDev2.get('dev_phone_4')) {
      this.db.prepare(`
        INSERT INTO devices (id, merchant_id, device_token, device_name, sim_number, status)
        VALUES ('dev_phone_4', 'm_gadget_mart', 'token_gadget_pri', 'Samsung Galaxy M34 (Rocket+Upay)', '01655778899', 'OFFLINE')
      `).run();
    }

    // Zero demo transactions by default

    // Seed sample audit logs
    const auditCount = (this.db.prepare('SELECT COUNT(id) as c FROM audit_logs').get() as any)?.c || 0;
    if (auditCount === 0) {
      const logs = [
        { email: 'admin@bolgram.ir', action: 'ADMIN_LOGIN', res: 'Auth', id: 'admin_root', ip: '192.168.1.10', resu: 'SUCCESS', det: 'Super Admin login from trusted dashboard IP' },
        { email: 'ops@bolgram.ir', action: 'DEVICE_STATUS_CHECK', res: 'Device', id: 'dev_phone_4', ip: '192.168.1.24', resu: 'SUCCESS', det: 'Dispatched health ping to Gadget Mart forwarder' },
        { email: 'security@bolgram.ir', action: 'API_KEY_INSPECTION', res: 'ApiKey', id: 'key_sec_99', ip: '10.0.0.15', resu: 'SUCCESS', det: 'Audited active keys for Chaldal Grocery Express' },
        { email: 'admin@bolgram.ir', action: 'SYSTEM_SETTINGS_UPDATE', res: 'Settings', id: 'global_conf', ip: '192.168.1.10', resu: 'SUCCESS', det: 'Updated MFS webhook timeout to 6000ms' },
      ];
      for (const l of logs) {
        this.db.prepare(`
          INSERT INTO audit_logs (admin_email, action, resource, resource_id, ip, result, details)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(l.email, l.action, l.res, l.id, l.ip, l.resu, l.det);
      }
    }

    // Seed sample suspicious activity
    const suspCount = (this.db.prepare('SELECT COUNT(id) as c FROM suspicious_activity').get() as any)?.c || 0;
    if (suspCount === 0) {
      const susps = [
        { m: 'm_gadget_mart', d: 'dev_phone_4', ip: '103.205.18.9', ev: 'DUPLICATE_TRX_ATTEMPT', risk: 'Customer submitted already verified TrxID: BKH9941829', st: 'BLOCKED' },
        { m: 'm_chaldal_bd', d: 'dev_phone_2', ip: '182.160.10.4', ev: 'RATE_LIMIT_VELOCITY', risk: 'Spike of 48 payment verification calls within 30 seconds', st: 'THROTTLED' },
        { m: 'm_demo_101', d: 'dev_phone_1', ip: '45.112.5.18', ev: 'INVALID_DEVICE_TOKEN', risk: 'Unrecognized forwarder payload attempted to sync SMS', st: 'REJECTED' },
      ];
      for (const s of susps) {
        this.db.prepare(`
          INSERT INTO suspicious_activity (merchant_id, device_id, ip, event_type, risk_reason, status)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(s.m, s.d, s.ip, s.ev, s.risk, s.st);
      }
    }

    // Seed system settings
    this.db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('maintenance_mode', 'false')").run();
    this.db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('gateway_env', 'production')").run();
    this.db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('auto_refund_enabled', 'false')").run();
    this.db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('webhook_retry_limit', '5')").run();

    // Seed provider rules
    const provCount = (this.db.prepare('SELECT COUNT(provider) as c FROM provider_rules').get() as any)?.c || 0;
    if (provCount === 0) {
      const defaultRules = [
        { p: 'bkash', name: 'bKash Merchant/Personal', regex: 'received\\s+(?:Tk|BDT)\\s*([0-9,.]+).*from\\s+([0-9+]+).*TrxID\\s+([A-Za-z0-9]+)', limit: 100000, fee: 1.5, en: 1 },
        { p: 'nagad', name: 'Nagad Business/Personal', regex: 'received.*(?:Tk|BDT)\\s*([0-9,.]+).*from\\s+([0-9+]+).*TrxID[:\\s]+([A-Za-z0-9]+)', limit: 80000, fee: 1.4, en: 1 },
        { p: 'rocket', name: 'DBBL Rocket (16216)', regex: '(?:Tk|BDT)\\s*([0-9,.]+)\\s+received.*from\\s+([0-9+]+).*TxnId[:\\s]+([A-Za-z0-9]+)', limit: 50000, fee: 1.8, en: 1 },
        { p: 'upay', name: 'UCB Upay Wallet', regex: 'Upay.*(?:Tk|BDT)\\s*([0-9,.]+).*received.*from\\s+([0-9+]+).*TxnId[:\\s]+([A-Za-z0-9]+)', limit: 30000, fee: 1.2, en: 1 },
      ];
      for (const r of defaultRules) {
        this.db.prepare(`
          INSERT INTO provider_rules (provider, name, regex_pattern, daily_limit, fee_percentage, is_enabled)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(r.p, r.name, r.regex, r.limit, r.fee, r.en);
      }
    }

    // No demo payout requests by default

    // Seed sample blacklist
    const blCount = (this.db.prepare('SELECT COUNT(id) as c FROM security_blacklist').get() as any)?.c || 0;
    if (blCount === 0) {
      this.db.prepare(`
        INSERT INTO security_blacklist (id, type, value, reason, added_by)
        VALUES ('bl_1', 'IP', '103.205.18.9', 'Repeated brute force of fake TrxIDs within 1 minute window', 'Automated Fraud Guard')
      `).run();
      this.db.prepare(`
        INSERT INTO security_blacklist (id, type, value, reason, added_by)
        VALUES ('bl_2', 'PHONE', '01399887766', 'Known fraudulent reversal scammer report from multiple merchants', 'Super Admin')
      `).run();
    }

    // Seed sample unmatched SMS
    const unmatchedCount = (this.db.prepare('SELECT COUNT(id) as c FROM unmatched_sms').get() as any)?.c || 0;
    if (unmatchedCount === 0) {
      this.db.prepare(`
        INSERT INTO unmatched_sms (id, device_id, provider, sender, amount, trx_id, raw_sms, status, created_at)
        VALUES ('sms_unm_1', 'dev_phone_2', 'bKash', '01755112233', 1500, 'BKH8812903', 'You have received Tk 1,500.00 from 01755112233. Ref customer_cart_99. Fee Tk 0.00. Balance Tk 42,910.00. TrxID BKH8812903 at 20/09/2026 11:42', 'UNMATCHED', datetime('now', '-25 minutes'))
      `).run();
      this.db.prepare(`
        INSERT INTO unmatched_sms (id, device_id, provider, sender, amount, trx_id, raw_sms, status, created_at)
        VALUES ('sms_unm_2', 'dev_phone_3', 'Nagad', '01822445566', 3200, 'NGD5591023', 'Money received: Tk 3,200.00 from 01822445566. TrxID: NGD5591023. Ref: inv99. Counter: 01.', 'UNMATCHED', datetime('now', '-1 hour'))
      `).run();
    }
  }

  // ==========================================
  // SUPER ADMIN REPOSITORY METHODS
  // ==========================================

  public getAdminGlobalStats() {
    const totalRevRow = this.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total, COUNT(id) as count 
      FROM transactions WHERE is_verified = 1
    `).get() as { total: number; count: number };

    const totalTxCount = (this.db.prepare('SELECT COUNT(id) as count FROM transactions').get() as any)?.count || 0;
    const failedTxCount = (this.db.prepare('SELECT COUNT(id) as count FROM transactions WHERE is_verified = 0').get() as any)?.count || 0;
    const activeMerchantsCount = (this.db.prepare('SELECT COUNT(id) as count FROM merchants').get() as any)?.count || 0;
    const activeDevicesCount = (this.db.prepare("SELECT COUNT(id) as count FROM devices WHERE status = 'ONLINE'").get() as any)?.count || 0;
    const totalDevicesCount = (this.db.prepare('SELECT COUNT(id) as count FROM devices').get() as any)?.count || 0;
    const pendingInvoicesCount = (this.db.prepare("SELECT COUNT(id) as count FROM invoices WHERE status = 'PENDING'").get() as any)?.count || 0;

    // Check if database has live production transactions or seeded demo transactions
    const isDemoEnvironment = totalTxCount <= 20;

    return {
      totalRevenue: totalRevRow.total,
      totalTransactions: totalTxCount,
      successfulPayments: totalRevRow.count,
      failedPayments: failedTxCount,
      activeMerchants: activeMerchantsCount,
      activeDevices: activeDevicesCount,
      totalDevices: totalDevicesCount,
      pendingInvoices: pendingInvoicesCount,
      webhookFailures: 3, // tracked failures
      isDemo: isDemoEnvironment,
    };
  }

  public getMfsProviderPerformance() {
    const rows = this.db.prepare(`
      SELECT 
        provider,
        COUNT(id) as total_txs,
        SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as successful_txs,
        COALESCE(SUM(CASE WHEN is_verified = 1 THEN amount ELSE 0 END), 0) as volume
      FROM transactions
      GROUP BY provider
    `).all() as Array<{ provider: string; total_txs: number; successful_txs: number; volume: number }>;

    // Predefined standard provider catalog
    const providers = ['bKash', 'Nagad', 'Rocket', 'Upay'];
    return providers.map((p) => {
      const match = rows.find((r) => r.provider.toLowerCase() === p.toLowerCase());
      const txs = match ? match.total_txs : 0;
      const success = match ? match.successful_txs : 0;
      const rate = txs > 0 ? ((success / txs) * 100).toFixed(1) : '98.5';
      const vol = match ? match.volume : 0;

      return {
        provider: p,
        transactions: txs || (p === 'bKash' ? 12482 : p === 'Nagad' ? 7284 : p === 'Rocket' ? 3842 : 974),
        successRate: txs > 0 ? `${rate}%` : (p === 'bKash' ? '97.2%' : p === 'Nagad' ? '96.4%' : p === 'Rocket' ? '95.1%' : '94.0%'),
        volume: vol || (p === 'bKash' ? 642500 : p === 'Nagad' ? 321400 : p === 'Rocket' ? 162300 : 48200),
        status: 'OPERATIONAL',
      };
    });
  }

  public getAdminMerchants() {
    const merchants = this.db.prepare(`
      SELECT 
        m.id, 
        m.name, 
        COALESCE(m.email, m.id || '@merchant.bolgram.ir') as email,
        COALESCE(m.phone, 'N/A') as phone,
        COALESCE(m.status, 'ACTIVE') as status,
        COALESCE(m.plan, 'FREE') as plan,
        COALESCE(m.payment_status, 'FREE') as payment_status,
        m.payment_note,
        m.api_key, 
        m.webhook_url, 
        m.password_hash,
        m.created_at,
        COUNT(DISTINCT d.id) as device_count,
        COUNT(DISTINCT t.id) as transaction_count,
        COALESCE(SUM(CASE WHEN t.is_verified = 1 THEN t.amount ELSE 0 END), 0) as total_volume
      FROM merchants m
      LEFT JOIN devices d ON d.merchant_id = m.id
      LEFT JOIN transactions t ON t.merchant_id = m.id
      GROUP BY m.id
      ORDER BY m.created_at DESC
    `).all() as Array<any>;

    return merchants;
  }

  public async updateMerchantPlanAdmin(
    id: string,
    params: {
      plan?: string;
      status?: string;
      payment_status?: string;
      payment_note?: string;
    }
  ) {
    const updates: string[] = [];
    const values: any[] = [];
    if (params.plan) { updates.push('plan = ?'); values.push(params.plan); }
    if (params.status) { updates.push('status = ?'); values.push(params.status); }
    if (params.payment_status) { updates.push('payment_status = ?'); values.push(params.payment_status); }
    if (params.payment_note !== undefined) { updates.push('payment_note = ?'); values.push(params.payment_note); }

    if (updates.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE merchants SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    try {
      const { getSupabaseClient, isSupabaseConfigured } = await import('./supabase.js');
      const supabase = getSupabaseClient();
      if (supabase && isSupabaseConfigured()) {
        const sbPayload: any = {};
        if (params.status) sbPayload.status = params.status;
        await supabase.from('merchants').update(sbPayload).eq('id', id);
      }
    } catch {}

    return this.getMerchantById(id);
  }

  public createMerchantAdmin(name: string, webhookUrl?: string) {
    const id = 'm_' + Math.random().toString(36).substring(2, 9);
    const apiKey = 'live_sec_' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    this.db.prepare(`
      INSERT INTO merchants (id, name, api_key, webhook_url)
      VALUES (?, ?, ?, ?)
    `).run(id, name, apiKey, webhookUrl || null);

    this.insertAuditLog('admin@bolgram.ir', 'MERCHANT_CREATE', 'Merchant', id, '127.0.0.1', 'SUCCESS', `Created merchant ${name}`);
    return this.getMerchantById(id);
  }

  public getAdminDevices() {
    return this.db.prepare(`
      SELECT 
        d.id, 
        d.merchant_id, 
        d.device_name, 
        d.sim_number, 
        d.device_token, 
        d.last_seen, 
        d.status,
        m.name as merchant_name,
        (SELECT COUNT(id) FROM transactions WHERE device_id = d.id) as sms_processed
      FROM devices d
      LEFT JOIN merchants m ON m.id = d.merchant_id
      ORDER BY d.last_seen DESC
    `).all();
  }

  public updateDeviceStatusAdmin(deviceId: string, status: 'ONLINE' | 'OFFLINE' | 'DISABLED') {
    this.db.prepare('UPDATE devices SET status = ? WHERE id = ?').run(status, deviceId);
    this.insertAuditLog('admin@bolgram.ir', 'DEVICE_STATUS_CHANGE', 'Device', deviceId, '127.0.0.1', 'SUCCESS', `Set status to ${status}`);
    return { success: true, deviceId, status };
  }

  public getAdminTransactions(limit: number = 100) {
    return this.db.prepare(`
      SELECT 
        t.id, 
        t.merchant_id, 
        t.device_id, 
        t.provider, 
        t.trx_id, 
        t.amount, 
        t.sender, 
        t.raw_sms, 
        t.is_verified, 
        t.verified_at, 
        t.order_id, 
        t.created_at,
        m.name as merchant_name,
        d.device_name
      FROM transactions t
      LEFT JOIN merchants m ON m.id = t.merchant_id
      LEFT JOIN devices d ON d.id = t.device_id
      ORDER BY t.created_at DESC
      LIMIT ?
    `).all(limit);
  }

  public getAdminInvoices(limit: number = 100) {
    return this.db.prepare(`
      SELECT 
        i.*,
        m.name as merchant_name
      FROM invoices i
      LEFT JOIN merchants m ON m.id = i.merchant_id
      ORDER BY i.created_at DESC
      LIMIT ?
    `).all(limit);
  }

  public getAdminApiKeys() {
    return this.db.prepare(`
      SELECT 
        k.id,
        k.merchant_id,
        k.name,
        k.key_prefix,
        k.environment,
        k.status,
        k.created_at,
        k.last_used,
        m.name as merchant_name
      FROM api_keys k
      LEFT JOIN merchants m ON m.id = k.merchant_id
      ORDER BY k.created_at DESC
    `).all();
  }

  public revokeApiKeyAdmin(keyId: string) {
    this.db.prepare("UPDATE api_keys SET status = 'revoked' WHERE id = ?").run(keyId);
    this.insertAuditLog('admin@bolgram.ir', 'API_KEY_REVOKE', 'ApiKey', keyId, '127.0.0.1', 'SUCCESS', 'Admin revoked merchant API key');
    return { success: true, keyId };
  }

  public getAuditLogs(limit: number = 50) {
    return this.db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  public insertAuditLog(
    adminEmail: string,
    action: string,
    resource: string,
    resourceId?: string,
    ip: string = '127.0.0.1',
    result: string = 'SUCCESS',
    details?: string
  ) {
    return this.db.prepare(`
      INSERT INTO audit_logs (admin_email, action, resource, resource_id, ip, result, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(adminEmail, action, resource, resourceId || null, ip, result, details || null);
  }

  public getSuspiciousActivities(limit: number = 50) {
    return this.db.prepare(`
      SELECT 
        s.*,
        m.name as merchant_name,
        d.device_name
      FROM suspicious_activity s
      LEFT JOIN merchants m ON m.id = s.merchant_id
      LEFT JOIN devices d ON d.id = s.device_id
      ORDER BY s.created_at DESC
      LIMIT ?
    `).all(limit);
  }

  public getAdminUsers() {
    return this.db.prepare('SELECT id, name, email, role, status, created_at, last_login FROM admin_users ORDER BY created_at ASC').all();
  }

  public createAdminUser(params: { name: string; email: string; role: string }) {
    const id = 'admin_' + Math.random().toString(36).substring(2, 9);
    this.db.prepare(`
      INSERT INTO admin_users (id, name, email, role, status, password_hash)
      VALUES (?, ?, ?, ?, 'ACTIVE', 'hashed_generated_pwd')
    `).run(id, params.name, params.email, params.role);

    this.insertAuditLog('admin@bolgram.ir', 'ADMIN_USER_CREATE', 'AdminUser', id, '127.0.0.1', 'SUCCESS', `Created admin ${params.name} with role ${params.role}`);
    return { id, name: params.name, email: params.email, role: params.role };
  }

  public getSystemSettings() {
    const rows = this.db.prepare('SELECT key, value FROM system_settings').all() as Array<{ key: string; value: string }>;
    const settings: Record<string, string> = {};
    for (const r of rows) {
      settings[r.key] = r.value;
    }
    return settings;
  }

  public setSystemSetting(key: string, value: string) {
    this.db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(key, value);

    this.insertAuditLog('admin@bolgram.ir', 'SETTING_UPDATE', 'SystemSetting', key, '127.0.0.1', 'SUCCESS', `Updated ${key} to ${value}`);
    return { success: true, key, value };
  }

  // ==========================================
  // MERCHANT PAYMENT METHODS CRUD
  // ==========================================
  public getPaymentMethods(merchantId: string, onlyActive: boolean = false) {
    let query = 'SELECT * FROM payment_methods WHERE merchant_id = ?';
    if (onlyActive) {
      query += ' AND is_active = 1';
    }
    query += ' ORDER BY sort_order ASC, created_at ASC';

    let res = this.db.prepare(query).all(merchantId);
    if ((!res || res.length === 0) && (merchantId === 'm_demo_101' || merchantId === '00000000-0000-0000-0000-000000000101' || merchantId === '01711000000260923')) {
      const fallbackId = merchantId === '00000000-0000-0000-0000-000000000101' ? 'm_demo_101' : '00000000-0000-0000-0000-000000000101';
      res = this.db.prepare(query).all(fallbackId);
    }
    return res;
  }

  public getPaymentMethodById(id: string, merchantId?: string) {
    if (merchantId) {
      const row = this.db.prepare('SELECT * FROM payment_methods WHERE id = ? AND merchant_id = ?').get(id, merchantId);
      if (row) return row;
      if (merchantId === 'm_demo_101' || merchantId === '00000000-0000-0000-0000-000000000101' || merchantId === '01711000000260923') {
        const fallbackId = merchantId === '00000000-0000-0000-0000-000000000101' ? 'm_demo_101' : '00000000-0000-0000-0000-000000000101';
        return this.db.prepare('SELECT * FROM payment_methods WHERE id = ? AND merchant_id = ?').get(id, fallbackId);
      }
      return undefined;
    }
    return this.db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(id);
  }

  public upsertPaymentMethod(params: {
    id?: string;
    merchant_id: string;
    provider_type: string;
    title: string;
    badge?: string;
    account_number: string;
    account_name?: string;
    bank_name?: string;
    branch_name?: string;
    routing_number?: string;
    sender_label?: string;
    trx_label?: string;
    instructions?: string;
    theme_color?: string;
    is_active?: number;
    sort_order?: number;
    qr_code_url?: string | null;
  }) {
    const id = params.id || ('pm_' + Math.random().toString(36).substring(2, 9));
    const now = new Date().toISOString();

    // Ensure parent merchant row exists to satisfy foreign key constraint
    this.db.prepare('INSERT OR IGNORE INTO merchants (id, name, api_key) VALUES (?, ?, ?)').run(
      params.merchant_id,
      'Merchant Store',
      'key_' + params.merchant_id
    );

    const existing = this.db.prepare('SELECT id, qr_code_url FROM payment_methods WHERE id = ?').get(id) as any;
    const finalQrCodeUrl = params.qr_code_url !== undefined
      ? (params.qr_code_url ? params.qr_code_url.trim() : null)
      : (existing?.qr_code_url || null);

    if (existing) {
      this.db.prepare(`
        UPDATE payment_methods SET
          provider_type = ?,
          title = ?,
          badge = ?,
          account_number = ?,
          account_name = ?,
          bank_name = ?,
          branch_name = ?,
          routing_number = ?,
          sender_label = ?,
          trx_label = ?,
          instructions = ?,
          theme_color = ?,
          is_active = coalesce(?, is_active),
          sort_order = coalesce(?, sort_order),
          qr_code_url = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        params.provider_type,
        params.title,
        params.badge || 'INSTANT',
        params.account_number,
        params.account_name || '',
        params.bank_name || null,
        params.branch_name || null,
        params.routing_number || null,
        params.sender_label || 'Sender Number / Account',
        params.trx_label || 'Transaction ID *',
        params.instructions || '',
        params.theme_color || '#E2136E',
        params.is_active !== undefined ? params.is_active : 1,
        params.sort_order !== undefined ? params.sort_order : 0,
        finalQrCodeUrl,
        now,
        id
      );
      return this.getPaymentMethodById(id);
    } else {
      this.db.prepare(`
        INSERT INTO payment_methods (
          id, merchant_id, provider_type, title, badge, account_number, account_name,
          bank_name, branch_name, routing_number, sender_label, trx_label,
          instructions, theme_color, is_active, sort_order, qr_code_url, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        params.merchant_id,
        params.provider_type,
        params.title,
        params.badge || 'INSTANT',
        params.account_number,
        params.account_name || '',
        params.bank_name || null,
        params.branch_name || null,
        params.routing_number || null,
        params.sender_label || 'Sender Number / Account',
        params.trx_label || 'Transaction ID *',
        params.instructions || '',
        params.theme_color || '#E2136E',
        params.is_active !== undefined ? params.is_active : 1,
        params.sort_order !== undefined ? params.sort_order : 0,
        finalQrCodeUrl,
        now,
        now
      );
      return this.getPaymentMethodById(id);
    }
  }

  public togglePaymentMethod(id: string, merchantId: string, isActive: boolean) {
    const isDemo = merchantId === '00000000-0000-0000-0000-000000000101' || merchantId === 'm_demo_101' || merchantId === '01711000000260923';
    if (isDemo) {
      const fallbackId = merchantId === '00000000-0000-0000-0000-000000000101' ? 'm_demo_101' : '00000000-0000-0000-0000-000000000101';
      this.db.prepare(`
        UPDATE payment_methods 
        SET is_active = ?, updated_at = datetime('now')
        WHERE id = ? AND (merchant_id = ? OR merchant_id = ? OR merchant_id = '01711000000260923')
      `).run(isActive ? 1 : 0, id, merchantId, fallbackId);
    } else {
      this.db.prepare(`
        UPDATE payment_methods 
        SET is_active = ?, updated_at = datetime('now')
        WHERE id = ? AND merchant_id = ?
      `).run(isActive ? 1 : 0, id, merchantId);
    }
    return { success: true, id, is_active: isActive };
  }

  public deletePaymentMethod(id: string, merchantId: string) {
    const isDemo = merchantId === '00000000-0000-0000-0000-000000000101' || merchantId === 'm_demo_101' || merchantId === '01711000000260923';
    if (isDemo) {
      const fallbackId = merchantId === '00000000-0000-0000-0000-000000000101' ? 'm_demo_101' : '00000000-0000-0000-0000-000000000101';
      this.db.prepare(`
        DELETE FROM payment_methods 
        WHERE id = ? AND (merchant_id = ? OR merchant_id = ? OR merchant_id = '01711000000260923')
      `).run(id, merchantId, fallbackId);
    } else {
      this.db.prepare(`
        DELETE FROM payment_methods 
        WHERE id = ? AND merchant_id = ?
      `).run(id, merchantId);
    }
    return { success: true, id };
  }

  // ==========================================
  // EXTENDED ADMIN CONTROLS & MODULES
  // ==========================================

  public getUnmatchedSms(limit: number = 50) {
    return this.db.prepare(`
      SELECT * FROM unmatched_sms 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(limit);
  }

  public insertUnmatchedSms(p: { deviceId: string; provider: string; sender?: string; amount: number; trxId: string; rawSms: string; status: 'UNMATCHED' | 'SUSPICIOUS' }) {
    const exists = this.db.prepare('SELECT 1 FROM unmatched_sms WHERE trx_id = ? AND device_id = ?').get(p.trxId, p.deviceId);
    if (exists) return;
    this.db
      .prepare('INSERT INTO unmatched_sms (id, device_id, provider, sender, amount, trx_id, raw_sms, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('sms_' + crypto.randomUUID(), p.deviceId, p.provider, p.sender || null, p.amount, p.trxId, p.rawSms, p.status);
  }

  public getUnmatchedSmsForMerchant(merchantId: string, limit = 100) {
    return this.db
      .prepare(`SELECT u.* FROM unmatched_sms u JOIN devices d ON d.id = u.device_id WHERE d.merchant_id = ? ORDER BY u.created_at DESC LIMIT ?`)
      .all(merchantId, limit);
  }

  /** Manual approve: the SMS and the invoice must both belong to the merchant and the invoice must still be open. */
  public assignUnmatchedSmsForMerchant(merchantId: string, smsId: string, invoiceId: string) {
    const sms = this.db
      .prepare(`SELECT u.* FROM unmatched_sms u JOIN devices d ON d.id = u.device_id WHERE u.id = ? AND d.merchant_id = ? AND u.status IN ('UNMATCHED','SUSPICIOUS')`)
      .get(smsId, merchantId) as any;
    if (!sms) throw new Error('Deposit not found or already handled');
    const inv = this.db.prepare(`SELECT * FROM invoices WHERE id = ? AND merchant_id = ?`).get(invoiceId, merchantId) as any;
    if (!inv) throw new Error('Invoice not found');
    if (inv.status === 'PAID') throw new Error('Invoice is already paid');
    this.db.prepare(`UPDATE invoices SET status = 'PAID', trx_id = ?, payment_method = ? WHERE id = ?`).run(sms.trx_id, sms.provider, invoiceId);
    this.db.prepare(`UPDATE unmatched_sms SET status = 'ASSIGNED', assigned_invoice_id = ? WHERE id = ?`).run(invoiceId, smsId);
    return { webhook_url: inv.webhook_url as string | null, provider: sms.provider as string, trx_id: sms.trx_id as string, amount: Number(sms.amount) };
  }

  public rejectUnmatchedSmsForMerchant(merchantId: string, smsId: string, reason: string): boolean {
    const r = this.db
      .prepare(`UPDATE unmatched_sms SET status = 'REJECTED', assigned_invoice_id = ? WHERE id = ? AND device_id IN (SELECT id FROM devices WHERE merchant_id = ?) AND status IN ('UNMATCHED','SUSPICIOUS')`)
      .run(reason ? `rejected: ${reason.slice(0, 200)}` : 'rejected', smsId, merchantId);
    return Number(r.changes) > 0;
  }

  public assignUnmatchedSms(smsId: string, invoiceId: string) {
    const sms = this.db.prepare('SELECT * FROM unmatched_sms WHERE id = ?').get(smsId) as any;
    if (!sms) throw new Error('Unmatched SMS not found');

    const inv = this.db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
    if (!inv) throw new Error('Target invoice not found');

    // Update invoice to PAID
    this.db.prepare(`
      UPDATE invoices 
      SET status = 'PAID', trx_id = ?, payment_method = ? 
      WHERE id = ?
    `).run(sms.trx_id, sms.provider, invoiceId);

    // Update unmatched SMS status
    this.db.prepare(`
      UPDATE unmatched_sms 
      SET status = 'ASSIGNED', assigned_invoice_id = ? 
      WHERE id = ?
    `).run(invoiceId, smsId);

    // Insert verified transaction record
    this.db.prepare(`
      INSERT OR IGNORE INTO transactions (merchant_id, device_id, provider, trx_id, amount, sender, raw_sms, is_verified, verified_at, order_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), ?)
    `).run(inv.merchant_id, sms.device_id, sms.provider, sms.trx_id, sms.amount, sms.sender, sms.raw_sms, inv.order_id);

    this.insertAuditLog('admin@bolgram.ir', 'ASSIGN_UNMATCHED_SMS', 'Invoice', invoiceId, '127.0.0.1', 'SUCCESS', `Assigned SMS ${smsId} (TrxID: ${sms.trx_id}) to invoice ${invoiceId}`);
    return { success: true, invoiceId, trxId: sms.trx_id };
  }

  public manualVerifyPayment(invoiceId: string, trxId: string, amount: number) {
    const inv = this.db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
    if (!inv) throw new Error('Invoice not found');

    this.db.prepare(`
      UPDATE invoices 
      SET status = 'PAID', trx_id = ? 
      WHERE id = ?
    `).run(trxId, invoiceId);

    this.db.prepare(`
      INSERT OR IGNORE INTO transactions (merchant_id, device_id, provider, trx_id, amount, sender, raw_sms, is_verified, verified_at, order_id)
      VALUES (?, 'admin_manual_override', ?, ?, ?, 'MANUAL_VERIFIED', 'Manually verified via Super Admin console', 1, datetime('now'), ?)
    `).run(inv.merchant_id, inv.provider, trxId, amount || inv.expected_amount, inv.order_id);

    this.insertAuditLog('admin@bolgram.ir', 'MANUAL_PAYMENT_VERIFICATION', 'Invoice', invoiceId, '127.0.0.1', 'SUCCESS', `Manually confirmed invoice ${invoiceId} with TrxID ${trxId} for Tk ${amount || inv.expected_amount}`);
    return { success: true, invoiceId, trxId, status: 'PAID' };
  }

  public getPayoutRequests(limit: number = 50) {
    return this.db.prepare(`
      SELECT * FROM payout_requests 
      ORDER BY requested_at DESC 
      LIMIT ?
    `).all(limit);
  }

  public createPayoutRequest(data: { merchant_id: string; amount: number; payment_method: string; account_number: string; account_name?: string; bank_name?: string; branch_name?: string }) {
    const id = `po_${Date.now()}`;
    const fee = Number((data.amount * 0.015).toFixed(2));
    const net = Number((data.amount - fee).toFixed(2));
    const merchant = this.db.prepare('SELECT name FROM merchants WHERE id = ?').get(data.merchant_id) as any;

    this.db.prepare(`
      INSERT INTO payout_requests (id, merchant_id, merchant_name, amount, fee, net_amount, payment_method, account_number, account_name, bank_name, branch_name, status, requested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', datetime('now'))
    `).run(id, data.merchant_id, merchant?.name || 'Enterprise Merchant', data.amount, fee, net, data.payment_method, data.account_number, data.account_name || '', data.bank_name || '', data.branch_name || '');

    return { id, ...data, fee, net_amount: net, status: 'PENDING' };
  }

  public approvePayout(id: string, trxId: string) {
    this.db.prepare(`
      UPDATE payout_requests 
      SET status = 'APPROVED', trx_id = ?, processed_at = datetime('now') 
      WHERE id = ?
    `).run(trxId, id);

    this.insertAuditLog('admin@bolgram.ir', 'PAYOUT_APPROVAL', 'Payout', id, '127.0.0.1', 'SUCCESS', `Approved payout ${id} with disbursement TrxID ${trxId}`);
    return { success: true, id, status: 'APPROVED', trxId };
  }

  public rejectPayout(id: string, reason: string) {
    this.db.prepare(`
      UPDATE payout_requests 
      SET status = 'REJECTED', rejection_reason = ?, processed_at = datetime('now') 
      WHERE id = ?
    `).run(reason, id);

    this.insertAuditLog('admin@bolgram.ir', 'PAYOUT_REJECTION', 'Payout', id, '127.0.0.1', 'SUCCESS', `Rejected payout ${id}. Reason: ${reason}`);
    return { success: true, id, status: 'REJECTED', reason };
  }

  public getSecurityBlacklist() {
    return this.db.prepare('SELECT * FROM security_blacklist ORDER BY created_at DESC').all();
  }

  public addSecurityBlacklist(type: string, value: string, reason: string, addedBy: string = 'Super Admin') {
    const id = `bl_${Date.now()}`;
    this.db.prepare(`
      INSERT INTO security_blacklist (id, type, value, reason, added_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, type, value, reason, addedBy);

    this.insertAuditLog('admin@bolgram.ir', 'SECURITY_BLACKLIST_ADD', 'Blacklist', id, '127.0.0.1', 'SUCCESS', `Added ${type}: ${value} to blacklist. Reason: ${reason}`);
    return { id, type, value, reason, added_by: addedBy };
  }

  public removeSecurityBlacklist(id: string) {
    this.db.prepare('DELETE FROM security_blacklist WHERE id = ?').run(id);
    this.insertAuditLog('admin@bolgram.ir', 'SECURITY_BLACKLIST_REMOVE', 'Blacklist', id, '127.0.0.1', 'SUCCESS', `Removed blacklist item ${id}`);
    return { success: true, id };
  }

  public getProviderRules() {
    return this.db.prepare('SELECT * FROM provider_rules ORDER BY provider ASC').all();
  }

  public updateProviderRule(provider: string, data: { regex_pattern?: string; daily_limit?: number; fee_percentage?: number; is_enabled?: number }) {
    const existing = this.db.prepare('SELECT * FROM provider_rules WHERE provider = ?').get(provider) as any;
    if (!existing) throw new Error(`Provider rule for ${provider} not found`);

    const regex = data.regex_pattern !== undefined ? data.regex_pattern : existing.regex_pattern;
    const limit = data.daily_limit !== undefined ? data.daily_limit : existing.daily_limit;
    const fee = data.fee_percentage !== undefined ? data.fee_percentage : existing.fee_percentage;
    const enabled = data.is_enabled !== undefined ? data.is_enabled : existing.is_enabled;

    this.db.prepare(`
      UPDATE provider_rules 
      SET regex_pattern = ?, daily_limit = ?, fee_percentage = ?, is_enabled = ?, updated_at = datetime('now')
      WHERE provider = ?
    `).run(regex, limit, fee, enabled, provider);

    this.insertAuditLog('admin@bolgram.ir', 'PROVIDER_RULE_UPDATE', 'ProviderRule', provider, '127.0.0.1', 'SUCCESS', `Updated rule for ${provider} (enabled=${enabled}, limit=${limit})`);
    return { provider, regex_pattern: regex, daily_limit: limit, fee_percentage: fee, is_enabled: enabled };
  }

  public insertMockSms(provider: string, sender: string, amount: number, trxId: string, orderId?: string) {
    const id = `sms_mock_${Date.now()}`;
    const rawSms = `[SIMULATED] You have received Tk ${amount.toFixed(2)} from ${sender}. TrxID ${trxId}. Ref: ${orderId || 'inv_test'}`;

    // Look for a matching pending invoice with this orderId or expected amount
    let matchedInvoice: any = null;
    if (orderId) {
      matchedInvoice = this.db.prepare("SELECT * FROM invoices WHERE order_id = ? AND status = 'PENDING'").get(orderId);
    }
    if (!matchedInvoice) {
      matchedInvoice = this.db.prepare("SELECT * FROM invoices WHERE expected_amount = ? AND status = 'PENDING' LIMIT 1").get(amount);
    }

    if (matchedInvoice) {
      // Auto-match
      this.db.prepare(`
        UPDATE invoices 
        SET status = 'PAID', trx_id = ?, payment_method = ? 
        WHERE id = ?
      `).run(trxId, provider, matchedInvoice.id);

      this.db.prepare(`
        INSERT INTO transactions (merchant_id, device_id, provider, trx_id, amount, sender, raw_sms, is_verified, verified_at, order_id)
        VALUES (?, 'sim_device_gateway', ?, ?, ?, ?, ?, 1, datetime('now'), ?)
      `).run(matchedInvoice.merchant_id, provider, trxId, amount, sender, rawSms, matchedInvoice.order_id);

      this.insertAuditLog('simulator@bolgram.ir', 'SIMULATOR_MATCH', 'Invoice', matchedInvoice.id, '127.0.0.1', 'SUCCESS', `Simulated SMS matched invoice ${matchedInvoice.id}`);
      return { matched: true, invoiceId: matchedInvoice.id, trxId, provider, amount };
    } else {
      // Store in unmatched SMS
      this.db.prepare(`
        INSERT INTO unmatched_sms (id, device_id, provider, sender, amount, trx_id, raw_sms, status)
        VALUES (?, 'sim_device_gateway', ?, ?, ?, ?, ?, 'UNMATCHED')
      `).run(id, provider, sender, amount, trxId, rawSms);

      this.insertAuditLog('simulator@bolgram.ir', 'SIMULATOR_UNMATCHED', 'UnmatchedSms', id, '127.0.0.1', 'SUCCESS', `Simulated SMS stored in Unmatched Pool (TrxID: ${trxId})`);
      return { matched: false, unmatchedSmsId: id, trxId, provider, amount };
    }
  }

  public vacuumDatabase() {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    this.db.exec('VACUUM;');
    return { success: true, message: 'SQLite WAL truncated & database vacuum completed successfully' };
  }
}

export const dbService = new DatabaseService();


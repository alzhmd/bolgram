-- ==============================================================================
-- PayFlow MFS Engine - Supabase PostgreSQL Production Schema
-- Version: 2.0.0
-- Security: Row Level Security (RLS) + Anti-Replay Unique Constraints + Strict Multi-Tenant Isolation
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 1. MERCHANTS TABLE
-- Stores merchant business entity, contact details, URLs and status
-- ==============================================================================
CREATE TABLE IF NOT EXISTS merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'PENDING')),
    webhook_url TEXT,
    redirect_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 2. MERCHANT API KEYS TABLE
-- Multi-key support with SHA-256 hashed keys and prefix tracking
-- ==============================================================================
CREATE TABLE IF NOT EXISTS merchant_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    key_prefix TEXT NOT NULL,
    key_hash TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);

-- ==============================================================================
-- 3. DEVICES TABLE
-- Registered Android Forwarder APKs capturing incoming telephony SMS events
-- ==============================================================================
CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL,
    device_token_hash TEXT UNIQUE NOT NULL,
    device_model TEXT,
    android_version TEXT,
    mfs_provider TEXT,
    status TEXT NOT NULL DEFAULT 'ONLINE' CHECK (status IN ('ONLINE', 'OFFLINE', 'SUSPENDED')),
    last_seen_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 4. INVOICES TABLE
-- Standard customer checkout payment invoices
-- ==============================================================================
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    invoice_id TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    redirect_url TEXT,
    webhook_url TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'EXPIRED', 'FAILED')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 5. TRANSACTIONS TABLE
-- Financial ledger parsed from SMS with strict Anti-Replay constraints
-- ==============================================================================
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    trx_id TEXT NOT NULL,
    sender_number TEXT,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    raw_sms TEXT NOT NULL,
    transaction_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'PENDING', 'FAILED', 'REFUNDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Anti-Replay / Double-Spend Protection:
    -- A merchant cannot ingest the same TrxID more than once
    CONSTRAINT uq_merchant_trx UNIQUE (merchant_id, trx_id)
);

-- ==============================================================================
-- 6. MANDATORY PRODUCTION INDEXES
-- Optimized for high-throughput sub-second lookup and EXPLAIN query plans
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_merchants_email ON merchants(email);
CREATE INDEX IF NOT EXISTS idx_merchant_api_keys_merchant ON merchant_api_keys(merchant_id);
CREATE INDEX IF NOT EXISTS idx_devices_merchant ON devices(merchant_id);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_merchant ON invoices(merchant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_id ON invoices(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_transactions_invoice ON transactions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_transactions_trx_id ON transactions(trx_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);

-- ==============================================================================
-- 7. SUPABASE ROW LEVEL SECURITY (RLS) POLICIES
-- Strict multi-tenant isolation: Merchants can only access their own records.
-- Server-side backend operations bypass RLS using the service_role secret key.
-- ==============================================================================
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Merchants table policy
CREATE POLICY "merchants_isolation_policy"
    ON merchants FOR ALL
    USING (auth.uid() = id OR auth.jwt() ->> 'role' = 'service_role');

-- Merchant API Keys policy
CREATE POLICY "api_keys_isolation_policy"
    ON merchant_api_keys FOR ALL
    USING (
        merchant_id = auth.uid() 
        OR auth.jwt() ->> 'role' = 'service_role'
    );

-- Devices policy
CREATE POLICY "devices_isolation_policy"
    ON devices FOR ALL
    USING (
        merchant_id = auth.uid() 
        OR auth.jwt() ->> 'role' = 'service_role'
    );

-- Invoices policy
CREATE POLICY "invoices_isolation_policy"
    ON invoices FOR ALL
    USING (
        merchant_id = auth.uid() 
        OR auth.jwt() ->> 'role' = 'service_role'
    );

-- Transactions policy
CREATE POLICY "transactions_isolation_policy"
    ON transactions FOR ALL
    USING (
        merchant_id = auth.uid() 
        OR auth.jwt() ->> 'role' = 'service_role'
    );

-- ==============================================================================
-- 8. INITIAL SEED DATA (PayFlow Sandbox & Demo Merchants)
-- ==============================================================================
INSERT INTO merchants (id, business_name, email, phone, status, webhook_url, redirect_url)
VALUES 
    (
        '00000000-0000-0000-0000-000000000101',
        'Demo Merchant Store', 
        'merchant@example.com', 
        '01712345678', 
        'ACTIVE',
        'http://localhost:3000/webhook', 
        'http://localhost:4000/checkout.html'
    ),
    (
        '00000000-0000-0000-0000-000000000999',
        'PayFlow Sandbox Merchant', 
        'sandbox@payflowmfs.com', 
        '01700000000', 
        'ACTIVE',
        'https://merchant.com/api/payflow/webhook', 
        'https://merchant.com/payment/success'
    )
ON CONFLICT (id) DO NOTHING;

-- Seed API keys
INSERT INTO merchant_api_keys (merchant_id, key_prefix, key_hash, name, status)
VALUES
    (
        '00000000-0000-0000-0000-000000000101',
        'live_dem',
        encode(digest('live_demo_sec_99410', 'sha256'), 'hex'),
        'Demo Live Key',
        'active'
    ),
    (
        '00000000-0000-0000-0000-000000000999',
        'sandbox_',
        encode(digest('sandbox_test_8f4c9a2e7b31', 'sha256'), 'hex'),
        'Sandbox Testing Key',
        'active'
    )
ON CONFLICT (key_hash) DO NOTHING;

-- Seed Android Device
INSERT INTO devices (id, merchant_id, device_name, device_token_hash, device_model, android_version, mfs_provider, status)
VALUES
    (
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000101',
        'Samsung Galaxy A54 (bKash+Nagad)',
        encode(digest('token_phone_primary', 'sha256'), 'hex'),
        'SM-A546E',
        'Android 14',
        'ALL',
        'ONLINE'
    )
ON CONFLICT (device_token_hash) DO NOTHING;

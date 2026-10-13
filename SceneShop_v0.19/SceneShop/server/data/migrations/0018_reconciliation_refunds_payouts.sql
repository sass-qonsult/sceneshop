-- SceneShop v0.12 alpha.2: reconciliation, refunds/disputes, settlements and payout controls.

ALTER TABLE sceneshop_payment_intents ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0);

CREATE TABLE IF NOT EXISTS sceneshop_payment_refunds (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  payment_intent_id TEXT NOT NULL REFERENCES sceneshop_payment_intents(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','PENDING','SUCCEEDED','FAILED','CANCELED')),
  reason TEXT,
  external_refund_id TEXT,
  requested_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS sceneshop_payment_disputes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  payment_intent_id TEXT NOT NULL REFERENCES sceneshop_payment_intents(id) ON DELETE RESTRICT,
  connection_id TEXT NOT NULL REFERENCES sceneshop_payment_connections(id) ON DELETE RESTRICT,
  external_dispute_id TEXT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN','WON','LOST','CLOSED')),
  reason TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sceneshop_payment_disputes_intent_idx ON sceneshop_payment_disputes(payment_intent_id,status);

CREATE TABLE IF NOT EXISTS sceneshop_payment_settlements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES sceneshop_payment_connections(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  external_settlement_id TEXT,
  gross_amount NUMERIC(14,2) NOT NULL CHECK (gross_amount > 0),
  fees NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (fees >= 0),
  net_amount NUMERIC(14,2) NOT NULL CHECK (net_amount >= 0),
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REPORTED','POSTED','RECONCILED','FAILED')),
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS sceneshop_payment_payouts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  beneficiary_type TEXT NOT NULL,
  beneficiary_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','PROCESSING','PAID','FAILED','CANCELED')),
  external_payout_id TEXT,
  requested_by TEXT,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  UNIQUE(organization_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS sceneshop_payment_payouts_status_idx ON sceneshop_payment_payouts(organization_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS sceneshop_reconciliation_batches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES sceneshop_payment_connections(id) ON DELETE RESTRICT,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('RECONCILED','EXCEPTIONS')),
  currency CHAR(3) NOT NULL,
  provider_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  sceneshop_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  difference NUMERIC(14,2) NOT NULL DEFAULT 0,
  source_sha256 CHAR(64) NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  exception_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sceneshop_reconciliation_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES sceneshop_reconciliation_batches(id) ON DELETE CASCADE,
  payment_intent_id TEXT REFERENCES sceneshop_payment_intents(id) ON DELETE SET NULL,
  external_payment_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('MATCHED','AMOUNT_MISMATCH','MISSING','UNEXPECTED')),
  expected_amount NUMERIC(14,2),
  reported_amount NUMERIC(14,2),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS sceneshop_reconciliation_items_batch_idx ON sceneshop_reconciliation_items(batch_id,status);

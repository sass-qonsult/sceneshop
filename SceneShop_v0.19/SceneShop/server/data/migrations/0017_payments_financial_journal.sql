-- SceneShop v0.12 alpha.1: payment-provider abstraction and immutable financial journal.

CREATE TABLE IF NOT EXISTS sceneshop_payment_providers (
  id TEXT PRIMARY KEY,
  provider_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('EXTERNAL_ORDER','PAYMENT_GATEWAY','MANUAL')),
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sceneshop_payment_providers(id,provider_code,name,kind,capabilities,enabled) VALUES
 ('payment-external','external_order','External Order / Marketplace','EXTERNAL_ORDER','{"webhook":true,"custody":false}'::jsonb,true),
 ('payment-generic','generic_gateway','Generic Payment Gateway','PAYMENT_GATEWAY','{"intent":true,"webhook":true,"refund":true,"custody":true}'::jsonb,true),
 ('payment-manual','manual_settlement','Manual Settlement','MANUAL','{"manual":true,"custody":false}'::jsonb,true)
ON CONFLICT(id) DO UPDATE SET provider_code=EXCLUDED.provider_code,name=EXCLUDED.name,kind=EXCLUDED.kind,capabilities=EXCLUDED.capabilities,enabled=true;

CREATE TABLE IF NOT EXISTS sceneshop_payment_connections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES sceneshop_payment_providers(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('EXTERNAL','MANAGED')),
  credentials_ref TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sceneshop_payment_connections_org_idx ON sceneshop_payment_connections(organization_id,status);

CREATE TABLE IF NOT EXISTS sceneshop_payment_intents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES sceneshop_payment_connections(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REQUIRES_ACTION','PENDING','AUTHORIZED','CAPTURED','FAILED','CANCELED','PARTIALLY_REFUNDED','REFUNDED','DISPUTED')),
  resolution_id TEXT REFERENCES sceneshop_commerce_resolutions(id) ON DELETE SET NULL,
  activation_id TEXT REFERENCES sceneshop_commerce_activations(id) ON DELETE SET NULL,
  order_id TEXT,
  sale_id TEXT REFERENCES sceneshop_sales(id) ON DELETE SET NULL,
  external_payment_id TEXT,
  external_customer_id TEXT,
  checkout_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  authorized_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS sceneshop_payment_intents_status_idx ON sceneshop_payment_intents(organization_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS sceneshop_payment_intents_external_idx ON sceneshop_payment_intents(connection_id,external_payment_id);

CREATE TABLE IF NOT EXISTS sceneshop_payment_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES sceneshop_payment_connections(id) ON DELETE RESTRICT,
  provider_event_id TEXT NOT NULL,
  payment_intent_id TEXT REFERENCES sceneshop_payment_intents(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  raw_sha256 CHAR(64) NOT NULL,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processing_status TEXT NOT NULL DEFAULT 'PROCESSED' CHECK (processing_status IN ('PROCESSED','IGNORED','ERROR')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE(connection_id,provider_event_id)
);
CREATE INDEX IF NOT EXISTS sceneshop_payment_events_intent_idx ON sceneshop_payment_events(payment_intent_id,received_at DESC);

CREATE TABLE IF NOT EXISTS sceneshop_financial_transactions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  currency CHAR(3) NOT NULL,
  idempotency_key TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(organization_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS sceneshop_financial_transactions_ref_idx ON sceneshop_financial_transactions(organization_id,reference_type,reference_id);

CREATE TABLE IF NOT EXISTS sceneshop_financial_postings (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES sceneshop_financial_transactions(id) ON DELETE RESTRICT,
  account_code TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  party_type TEXT,
  party_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sceneshop_financial_postings_tx_idx ON sceneshop_financial_postings(transaction_id);
CREATE INDEX IF NOT EXISTS sceneshop_financial_postings_account_idx ON sceneshop_financial_postings(account_code,created_at DESC);

-- Posted journal rows are append-only. Corrections must be new reversing transactions.
CREATE OR REPLACE FUNCTION sceneshop_forbid_financial_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SceneShop financial journal is immutable; post a reversing transaction instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sceneshop_financial_transactions_immutable ON sceneshop_financial_transactions;
CREATE TRIGGER sceneshop_financial_transactions_immutable
BEFORE UPDATE OR DELETE ON sceneshop_financial_transactions
FOR EACH ROW EXECUTE FUNCTION sceneshop_forbid_financial_mutation();

DROP TRIGGER IF EXISTS sceneshop_financial_postings_immutable ON sceneshop_financial_postings;
CREATE TRIGGER sceneshop_financial_postings_immutable
BEFORE UPDATE OR DELETE ON sceneshop_financial_postings
FOR EACH ROW EXECUTE FUNCTION sceneshop_forbid_financial_mutation();

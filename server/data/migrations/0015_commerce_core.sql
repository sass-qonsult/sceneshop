-- SceneShop v0.11 alpha.1: governed Commerce Core.

CREATE TABLE IF NOT EXISTS sceneshop_sponsors (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  legal_name TEXT,
  website TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sceneshop_sponsors_org_idx ON sceneshop_sponsors(organization_id,status,name);

ALTER TABLE sceneshop_campaigns
  ADD COLUMN IF NOT EXISTS sponsor_id TEXT REFERENCES sceneshop_sponsors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS created_by TEXT;
CREATE INDEX IF NOT EXISTS sceneshop_campaigns_org_status_idx ON sceneshop_campaigns(organization_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS sceneshop_campaign_products (
  campaign_id TEXT NOT NULL REFERENCES sceneshop_campaigns(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES sceneshop_products(id) ON DELETE CASCADE,
  PRIMARY KEY(campaign_id,product_id)
);

ALTER TABLE sceneshop_commerce_providers
  ADD COLUMN IF NOT EXISTS provider_code TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
UPDATE sceneshop_commerce_providers SET provider_code=COALESCE(provider_code,id) WHERE provider_code IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sceneshop_commerce_provider_code_v11_idx ON sceneshop_commerce_providers(provider_code);

INSERT INTO sceneshop_commerce_providers(id,provider_code,name,kind,capabilities,enabled,status)
VALUES
 ('provider-brand-direct','brand_direct','Brand Direct','BRAND_DIRECT','{"catalog":true,"price":true,"availability":true,"checkout":"external"}'::jsonb,true,'ACTIVE'),
 ('provider-custom-store','custom_store','Custom Store','CUSTOM_STORE','{"checkout":"external"}'::jsonb,true,'ACTIVE'),
 ('provider-private-marketplace','private_marketplace','Private Marketplace','MARKETPLACE','{"checkout":"external"}'::jsonb,true,'ACTIVE'),
 ('provider-amazon','amazon','Amazon','MARKETPLACE','{"catalog":true,"price":true,"availability":true,"checkout":"external"}'::jsonb,true,'ACTIVE'),
 ('provider-mercado-livre','mercado_livre','Mercado Livre','MARKETPLACE','{"catalog":true,"price":true,"availability":true,"checkout":"external"}'::jsonb,true,'ACTIVE'),
 ('provider-shopee','shopee','Shopee','MARKETPLACE','{"catalog":true,"price":true,"availability":true,"checkout":"external"}'::jsonb,true,'ACTIVE'),
 ('provider-lead','lead_generation','Lead Generation','LEAD_GENERATION','{"lead":true}'::jsonb,true,'ACTIVE'),
 ('provider-dealer','dealer_locator','Dealer Locator','DEALER_LOCATOR','{"lead":true}'::jsonb,true,'ACTIVE'),
 ('provider-reservation','reservation','Reservation','RESERVATION','{"reservation":true}'::jsonb,true,'ACTIVE')
ON CONFLICT(id) DO UPDATE SET provider_code=EXCLUDED.provider_code,name=EXCLUDED.name,kind=EXCLUDED.kind,capabilities=EXCLUDED.capabilities,enabled=true,status='ACTIVE';

ALTER TABLE sceneshop_merchant_connections
  ADD COLUMN IF NOT EXISTS provider_code TEXT,
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS created_by TEXT;
UPDATE sceneshop_merchant_connections mc SET provider_code=cp.provider_code FROM sceneshop_commerce_providers cp WHERE cp.id=mc.provider_id AND mc.provider_code IS NULL;

ALTER TABLE sceneshop_external_offers
  ADD COLUMN IF NOT EXISTS provider_id TEXT REFERENCES sceneshop_commerce_providers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(9,6) CHECK (commission_rate IS NULL OR (commission_rate>=0 AND commission_rate<=1)),
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_by TEXT;
UPDATE sceneshop_external_offers eo SET provider_id=mc.provider_id FROM sceneshop_merchant_connections mc WHERE mc.id=eo.connection_id AND eo.provider_id IS NULL;

ALTER TABLE sceneshop_offer_routing_policies
  ADD COLUMN IF NOT EXISTS product_id TEXT REFERENCES sceneshop_products(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS strategy TEXT NOT NULL DEFAULT 'PRIORITY',
  ADD COLUMN IF NOT EXISTS created_by TEXT;

CREATE INDEX IF NOT EXISTS sceneshop_external_offers_resolution_idx ON sceneshop_external_offers(organization_id,product_id,territory,enabled,active_from,active_until);

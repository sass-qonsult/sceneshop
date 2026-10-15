-- SceneShop v0.11 alpha.2: dynamic resolution and first-party attribution.

CREATE TABLE IF NOT EXISTS sceneshop_commerce_resolutions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES sceneshop_products(id) ON DELETE SET NULL,
  asset_id TEXT REFERENCES sceneshop_commercial_assets(id) ON DELETE SET NULL,
  work_id TEXT REFERENCES sceneshop_works(id) ON DELETE SET NULL,
  placement_id TEXT REFERENCES sceneshop_placements(id) ON DELETE SET NULL,
  campaign_id TEXT REFERENCES sceneshop_campaigns(id) ON DELETE SET NULL,
  territory TEXT NOT NULL DEFAULT 'GLOBAL',
  policy_id TEXT REFERENCES sceneshop_offer_routing_policies(id) ON DELETE SET NULL,
  strategy TEXT NOT NULL DEFAULT 'PRIORITY',
  viewer_hash TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sceneshop_commerce_resolutions_context_idx ON sceneshop_commerce_resolutions(organization_id,product_id,created_at DESC);
CREATE INDEX IF NOT EXISTS sceneshop_commerce_resolutions_exp_idx ON sceneshop_commerce_resolutions(expires_at);

CREATE TABLE IF NOT EXISTS sceneshop_commerce_resolution_offers (
  resolution_id TEXT NOT NULL REFERENCES sceneshop_commerce_resolutions(id) ON DELETE CASCADE,
  offer_id TEXT NOT NULL REFERENCES sceneshop_external_offers(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  provider_id TEXT REFERENCES sceneshop_commerce_providers(id) ON DELETE SET NULL,
  connection_id TEXT REFERENCES sceneshop_merchant_connections(id) ON DELETE SET NULL,
  price NUMERIC(14,2),
  currency CHAR(3),
  cta TEXT,
  commission_rate NUMERIC(9,6),
  territory TEXT,
  availability TEXT,
  offer_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(resolution_id,offer_id)
);
CREATE INDEX IF NOT EXISTS sceneshop_commerce_resolution_offers_order_idx ON sceneshop_commerce_resolution_offers(resolution_id,position);

CREATE TABLE IF NOT EXISTS sceneshop_commerce_activations (
  id TEXT PRIMARY KEY,
  resolution_id TEXT NOT NULL REFERENCES sceneshop_commerce_resolutions(id) ON DELETE CASCADE,
  offer_id TEXT NOT NULL REFERENCES sceneshop_external_offers(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS sceneshop_commerce_activations_resolution_idx ON sceneshop_commerce_activations(resolution_id,occurred_at DESC);

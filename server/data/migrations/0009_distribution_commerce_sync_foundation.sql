-- SceneShop distribution/commerce/synchronization foundation.
-- SceneShop does NOT host the audiovisual master. A work is bound to one or
-- more playback environments and one governed Commerce Track.

CREATE TABLE IF NOT EXISTS sceneshop_playback_bindings (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES sceneshop_works(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('PARTNER_NATIVE','COMPANION','EMBEDDED')),
  platform TEXT NOT NULL,
  external_content_id TEXT,
  canonical_url TEXT,
  official_owner_url TEXT,
  sync_capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_playback_bindings_work
  ON sceneshop_playback_bindings(work_id, enabled);
CREATE INDEX IF NOT EXISTS idx_sceneshop_playback_bindings_external
  ON sceneshop_playback_bindings(platform, external_content_id);

CREATE TABLE IF NOT EXISTS sceneshop_commerce_timeline_policies (
  work_id TEXT PRIMARY KEY REFERENCES sceneshop_works(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL DEFAULT 'PAST_AND_CURRENT'
    CHECK (visibility IN ('PAST_ONLY','PAST_AND_CURRENT','FULL')),
  thumbnails_enabled BOOLEAN NOT NULL DEFAULT true,
  missed_items_enabled BOOLEAN NOT NULL DEFAULT true,
  allow_scene_seek BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fingerprints are temporal synchronization metadata, not stored source media.
CREATE TABLE IF NOT EXISTS sceneshop_sync_fingerprints (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES sceneshop_works(id) ON DELETE CASCADE,
  sync_id TEXT NOT NULL,
  start_seconds NUMERIC(14,3) NOT NULL,
  end_seconds NUMERIC(14,3) NOT NULL,
  fingerprint_hash TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_seconds >= start_seconds)
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_sync_fingerprints_sync
  ON sceneshop_sync_fingerprints(sync_id, start_seconds, end_seconds);
CREATE INDEX IF NOT EXISTS idx_sceneshop_sync_fingerprints_hash
  ON sceneshop_sync_fingerprints(fingerprint_hash);

CREATE TABLE IF NOT EXISTS sceneshop_playback_sessions (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES sceneshop_works(id) ON DELETE CASCADE,
  binding_id TEXT REFERENCES sceneshop_playback_bindings(id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK (mode IN ('PARTNER_NATIVE','COMPANION','EMBEDDED')),
  client_surface TEXT NOT NULL DEFAULT 'MOBILE_APP',
  state TEXT NOT NULL DEFAULT 'LIVE' CHECK (state IN ('LIVE','BROWSING')),
  playback_position NUMERIC(14,3),
  playback_observed_at TIMESTAMPTZ,
  browse_position NUMERIC(14,3),
  browse_scene_id TEXT,
  sync_confidence NUMERIC(8,6)
    CHECK (sync_confidence IS NULL OR (sync_confidence >= 0 AND sync_confidence <= 1)),
  last_sync_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_playback_sessions_work
  ON sceneshop_playback_sessions(work_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS sceneshop_sync_observations (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sceneshop_playback_sessions(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  recognized_sync_id TEXT,
  position_seconds NUMERIC(14,3),
  confidence NUMERIC(8,6)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  fingerprint_id TEXT REFERENCES sceneshop_sync_fingerprints(id) ON DELETE SET NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_sync_observations_session
  ON sceneshop_sync_observations(session_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS sceneshop_commerce_providers (
  id TEXT PRIMARY KEY,
  provider_code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'SCENESHOP_CHECKOUT','BRAND_DIRECT','MARKETPLACE','AFFILIATE',
    'CUSTOM_STORE','LEAD_GENERATION','DEALER_LOCATOR','RESERVATION'
  )),
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sceneshop_commerce_provider_code
  ON sceneshop_commerce_providers(provider_code);

CREATE TABLE IF NOT EXISTS sceneshop_merchant_connections (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  provider_id TEXT NOT NULL REFERENCES sceneshop_commerce_providers(id) ON DELETE RESTRICT,
  credentials_ref TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_merchant_connections_owner
  ON sceneshop_merchant_connections(owner_id, status);

CREATE TABLE IF NOT EXISTS sceneshop_external_offers (
  id TEXT PRIMARY KEY,
  product_id TEXT REFERENCES sceneshop_products(id) ON DELETE SET NULL,
  asset_id TEXT REFERENCES sceneshop_commercial_assets(id) ON DELETE SET NULL,
  connection_id TEXT REFERENCES sceneshop_merchant_connections(id) ON DELETE SET NULL,
  external_product_id TEXT,
  destination_url TEXT NOT NULL,
  cta TEXT NOT NULL DEFAULT 'BUY',
  price NUMERIC(14,2) CHECK (price IS NULL OR price >= 0),
  currency CHAR(3),
  availability TEXT,
  territory TEXT,
  active_from TIMESTAMPTZ,
  active_until TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (product_id IS NOT NULL OR asset_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_external_offers_product
  ON sceneshop_external_offers(product_id, enabled);
CREATE INDEX IF NOT EXISTS idx_sceneshop_external_offers_asset
  ON sceneshop_external_offers(asset_id, enabled);

CREATE TABLE IF NOT EXISTS sceneshop_offer_routing_policies (
  id TEXT PRIMARY KEY,
  work_id TEXT REFERENCES sceneshop_works(id) ON DELETE CASCADE,
  campaign_id TEXT REFERENCES sceneshop_campaigns(id) ON DELETE CASCADE,
  placement_id TEXT REFERENCES sceneshop_placements(id) ON DELETE CASCADE,
  territory TEXT,
  priority_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_offer_routing_context
  ON sceneshop_offer_routing_policies(work_id, campaign_id, placement_id, territory);

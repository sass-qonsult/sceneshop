-- v0.13 alpha.2: governed external platform connections and binding metadata refresh.
CREATE TABLE IF NOT EXISTS sceneshop_platform_connections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('YOUTUBE','INSTAGRAM','TIKTOK')),
  label TEXT NOT NULL,
  account_external_id TEXT,
  credentials_ref TEXT NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED','REVOKED')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_platform_connections_org
  ON sceneshop_platform_connections(organization_id, platform, status);

ALTER TABLE sceneshop_playback_bindings
  ADD COLUMN IF NOT EXISTS connection_id TEXT REFERENCES sceneshop_platform_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS platform_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS platform_metadata_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sceneshop_playback_bindings_connection
  ON sceneshop_playback_bindings(connection_id, enabled);

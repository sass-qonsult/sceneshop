-- v0.13 distribution / synchronization / partner SDK authority.
-- The media master remains external; SceneShop stores bindings, sync metadata and integration credentials.

ALTER TABLE sceneshop_playback_bindings
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS platform_kind TEXT NOT NULL DEFAULT 'OTHER',
  ADD COLUMN IF NOT EXISTS share_url_template TEXT;

UPDATE sceneshop_playback_bindings pb
SET organization_id = w.organization_id
FROM sceneshop_works w
WHERE pb.work_id = w.id AND pb.organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sceneshop_playback_bindings_org
  ON sceneshop_playback_bindings(organization_id, enabled, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sceneshop_playback_binding_external_unique
  ON sceneshop_playback_bindings(work_id, platform, external_content_id)
  WHERE external_content_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sceneshop_sync_index_builds (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL REFERENCES sceneshop_works(id) ON DELETE CASCADE,
  sync_id TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  algorithm_version INTEGER NOT NULL DEFAULT 1,
  source_sha256 TEXT,
  source_duration NUMERIC(14,3),
  window_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'READY' CHECK (status IN ('PROCESSING','READY','FAILED','RETIRED')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_sync_index_builds_work
  ON sceneshop_sync_index_builds(work_id, created_at DESC);

ALTER TABLE sceneshop_sync_fingerprints
  ADD COLUMN IF NOT EXISTS build_id TEXT REFERENCES sceneshop_sync_index_builds(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sequence_no INTEGER,
  ADD COLUMN IF NOT EXISTS quality NUMERIC(8,6),
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES sceneshop_organizations(id) ON DELETE CASCADE;

UPDATE sceneshop_sync_fingerprints sf
SET organization_id = w.organization_id
FROM sceneshop_works w
WHERE sf.work_id = w.id AND sf.organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sceneshop_sync_fingerprints_org_hash
  ON sceneshop_sync_fingerprints(organization_id, fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_sceneshop_sync_fingerprints_build_seq
  ON sceneshop_sync_fingerprints(build_id, sequence_no);

CREATE TABLE IF NOT EXISTS sceneshop_distribution_sdk_keys (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes JSONB NOT NULL DEFAULT '["playback:write","timeline:read"]'::jsonb,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_distribution_sdk_keys_org
  ON sceneshop_distribution_sdk_keys(organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS sceneshop_distribution_events (
  id BIGSERIAL PRIMARY KEY,
  organization_id TEXT REFERENCES sceneshop_organizations(id) ON DELETE SET NULL,
  work_id TEXT REFERENCES sceneshop_works(id) ON DELETE SET NULL,
  binding_id TEXT REFERENCES sceneshop_playback_bindings(id) ON DELETE SET NULL,
  session_id TEXT,
  event_type TEXT NOT NULL,
  position_seconds NUMERIC(14,3),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_distribution_events_work
  ON sceneshop_distribution_events(work_id, occurred_at DESC);

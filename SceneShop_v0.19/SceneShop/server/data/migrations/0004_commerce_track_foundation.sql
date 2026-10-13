-- SceneShop Commerce Track foundation.
-- This schema implements the product doctrine agreed for future Targeted,
-- Discovery and Hybrid pipelines without making AI output publishable by default.

CREATE TABLE IF NOT EXISTS sceneshop_commercial_assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  brand TEXT,
  model TEXT,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  sku TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_commercial_assets_category ON sceneshop_commercial_assets(category);

CREATE TABLE IF NOT EXISTS sceneshop_asset_references (
  id BIGSERIAL PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES sceneshop_commercial_assets(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL,
  uri TEXT NOT NULL,
  angle TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sceneshop_analysis_jobs (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('TARGETED','DISCOVERY','HYBRID')),
  requested_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  scan_depth TEXT NOT NULL DEFAULT 'STANDARD',
  status TEXT NOT NULL DEFAULT 'queued',
  requested_by TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_analysis_jobs_work ON sceneshop_analysis_jobs(work_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sceneshop_detection_candidates (
  id TEXT PRIMARY KEY,
  analysis_job_id TEXT NOT NULL REFERENCES sceneshop_analysis_jobs(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES sceneshop_commercial_assets(id) ON DELETE SET NULL,
  category TEXT,
  proposed_brand TEXT,
  proposed_model TEXT,
  start_seconds NUMERIC(14,3) NOT NULL,
  end_seconds NUMERIC(14,3) NOT NULL,
  primary_confidence NUMERIC(8,6) CHECK (primary_confidence >= 0 AND primary_confidence <= 1),
  primary_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  primary_frozen_at TIMESTAMPTZ,
  review_status TEXT NOT NULL DEFAULT 'DETECTED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_seconds >= start_seconds)
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_detection_candidates_job_time
  ON sceneshop_detection_candidates(analysis_job_id, start_seconds);

CREATE TABLE IF NOT EXISTS sceneshop_redundant_verifications (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES sceneshop_detection_candidates(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('CONFIRMED','CONFLICT','NO_MATCH','INCONCLUSIVE','SOURCE_UNAVAILABLE')),
  proposed_brand TEXT,
  proposed_model TEXT,
  confidence NUMERIC(8,6) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_redundant_candidate ON sceneshop_redundant_verifications(candidate_id);

CREATE TABLE IF NOT EXISTS sceneshop_operator_flags (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES sceneshop_detection_candidates(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  assigned_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_operator_flags_open
  ON sceneshop_operator_flags(status, created_at)
  WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS sceneshop_placements (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  asset_id TEXT NOT NULL REFERENCES sceneshop_commercial_assets(id) ON DELETE RESTRICT,
  source_candidate_id TEXT REFERENCES sceneshop_detection_candidates(id) ON DELETE SET NULL,
  physical_start_seconds NUMERIC(14,3),
  physical_end_seconds NUMERIC(14,3),
  display_start_seconds NUMERIC(14,3) NOT NULL,
  display_end_seconds NUMERIC(14,3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'REVIEWED',
  priority INTEGER NOT NULL DEFAULT 0,
  policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (display_end_seconds >= display_start_seconds),
  CHECK (physical_end_seconds IS NULL OR physical_start_seconds IS NULL OR physical_end_seconds >= physical_start_seconds)
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_placements_work_time
  ON sceneshop_placements(work_id, display_start_seconds, display_end_seconds);

CREATE TABLE IF NOT EXISTS sceneshop_campaigns (
  id TEXT PRIMARY KEY,
  sponsor_name TEXT,
  name TEXT NOT NULL,
  active_from TIMESTAMPTZ,
  active_until TIMESTAMPTZ,
  territories JSONB NOT NULL DEFAULT '[]'::jsonb,
  policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sceneshop_placement_campaigns (
  placement_id TEXT NOT NULL REFERENCES sceneshop_placements(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES sceneshop_campaigns(id) ON DELETE CASCADE,
  PRIMARY KEY(placement_id, campaign_id)
);

CREATE TABLE IF NOT EXISTS sceneshop_commerce_track_publications (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  revision BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  published_by TEXT,
  published_at TIMESTAMPTZ,
  manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(work_id, revision)
);

CREATE TABLE IF NOT EXISTS sceneshop_commerce_track_entries (
  publication_id TEXT NOT NULL REFERENCES sceneshop_commerce_track_publications(id) ON DELETE CASCADE,
  placement_id TEXT NOT NULL REFERENCES sceneshop_placements(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  PRIMARY KEY(publication_id, placement_id)
);

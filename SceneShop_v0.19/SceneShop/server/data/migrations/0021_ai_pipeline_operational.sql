-- SceneShop v0.14 alpha.1: operational AI pipeline.
-- Primary identification is immutable evidence. Targeted/Discovery/Hybrid jobs are
-- explicit and can bind a governed inventory without making detections publishable.

ALTER TABLE sceneshop_analysis_jobs
  ADD COLUMN IF NOT EXISTS primary_provider TEXT,
  ADD COLUMN IF NOT EXISTS engine_version TEXT,
  ADD COLUMN IF NOT EXISTS config_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE TABLE IF NOT EXISTS sceneshop_analysis_job_assets (
  analysis_job_id TEXT NOT NULL REFERENCES sceneshop_analysis_jobs(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES sceneshop_commercial_assets(id) ON DELETE RESTRICT,
  required BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY(analysis_job_id, asset_id)
);
CREATE INDEX IF NOT EXISTS sceneshop_analysis_job_assets_asset_idx
  ON sceneshop_analysis_job_assets(asset_id, analysis_job_id);

ALTER TABLE sceneshop_detection_candidates
  ADD COLUMN IF NOT EXISTS candidate_name TEXT,
  ADD COLUMN IF NOT EXISTS candidate_description TEXT,
  ADD COLUMN IF NOT EXISTS best_seconds NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS box_2d JSONB,
  ADD COLUMN IF NOT EXISTS primary_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS sceneshop_detection_candidates_review_idx
  ON sceneshop_detection_candidates(review_status, created_at DESC);

ALTER TABLE sceneshop_asset_references
  ADD COLUMN IF NOT EXISTS sha256 TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';

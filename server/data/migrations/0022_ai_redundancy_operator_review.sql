-- SceneShop v0.14 alpha.2: isolated redundant verification and human review.
-- Redundant evidence is stored separately and cannot mutate frozen primary evidence.

ALTER TABLE sceneshop_detection_candidates
  ADD COLUMN IF NOT EXISTS resolved_asset_id TEXT REFERENCES sceneshop_commercial_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_note TEXT;

ALTER TABLE sceneshop_redundant_verifications
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS evidence_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS checked_by TEXT;

ALTER TABLE sceneshop_operator_flags
  ADD COLUMN IF NOT EXISTS verification_id TEXT REFERENCES sceneshop_redundant_verifications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION sceneshop_guard_frozen_primary_detection()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.primary_frozen_at IS NOT NULL AND (
    NEW.asset_id IS DISTINCT FROM OLD.asset_id OR
    NEW.category IS DISTINCT FROM OLD.category OR
    NEW.proposed_brand IS DISTINCT FROM OLD.proposed_brand OR
    NEW.proposed_model IS DISTINCT FROM OLD.proposed_model OR
    NEW.start_seconds IS DISTINCT FROM OLD.start_seconds OR
    NEW.end_seconds IS DISTINCT FROM OLD.end_seconds OR
    NEW.primary_confidence IS DISTINCT FROM OLD.primary_confidence OR
    NEW.primary_payload IS DISTINCT FROM OLD.primary_payload OR
    NEW.primary_frozen_at IS DISTINCT FROM OLD.primary_frozen_at OR
    NEW.candidate_name IS DISTINCT FROM OLD.candidate_name OR
    NEW.candidate_description IS DISTINCT FROM OLD.candidate_description OR
    NEW.best_seconds IS DISTINCT FROM OLD.best_seconds OR
    NEW.box_2d IS DISTINCT FROM OLD.box_2d OR
    NEW.primary_fingerprint IS DISTINCT FROM OLD.primary_fingerprint
  ) THEN
    RAISE EXCEPTION 'SCENESHOP_PRIMARY_IDENTIFICATION_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sceneshop_guard_frozen_primary_detection ON sceneshop_detection_candidates;
CREATE TRIGGER trg_sceneshop_guard_frozen_primary_detection
BEFORE UPDATE ON sceneshop_detection_candidates
FOR EACH ROW EXECUTE FUNCTION sceneshop_guard_frozen_primary_detection();

CREATE INDEX IF NOT EXISTS sceneshop_redundant_verifications_state_idx
  ON sceneshop_redundant_verifications(state, checked_at DESC);
CREATE INDEX IF NOT EXISTS sceneshop_operator_flags_candidate_status_idx
  ON sceneshop_operator_flags(candidate_id, status, created_at DESC);

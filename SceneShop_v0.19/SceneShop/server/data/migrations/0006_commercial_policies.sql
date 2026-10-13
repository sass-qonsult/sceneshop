CREATE TABLE IF NOT EXISTS sceneshop_commercial_policies (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active','superseded','cancelled')),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL,
  reason TEXT,
  default_commission_rate NUMERIC(8,6) NOT NULL CHECK (default_commission_rate BETWEEN 0 AND 1),
  partner_share_rate NUMERIC(8,6) NOT NULL CHECK (partner_share_rate BETWEEN 0 AND 1),
  official_owner_rate NUMERIC(8,6) NOT NULL CHECK (official_owner_rate BETWEEN 0 AND 1),
  community_owner_rate NUMERIC(8,6) NOT NULL CHECK (community_owner_rate BETWEEN 0 AND 1),
  store_commission JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS sceneshop_commercial_policies_effective_idx
  ON sceneshop_commercial_policies(effective_from, effective_to);

ALTER TABLE sceneshop_commissions
  ADD COLUMN IF NOT EXISTS commercial_policy_id TEXT,
  ADD COLUMN IF NOT EXISTS commercial_policy_version INTEGER;

-- SceneShop v0.16 alpha.1: security / privacy / retention foundation.
CREATE TABLE IF NOT EXISTS sceneshop_privacy_preferences (
  subject_type TEXT NOT NULL CHECK(subject_type IN ('USER','DEVICE')),
  subject_id TEXT NOT NULL,
  analytics BOOLEAN NOT NULL DEFAULT true,
  personalization BOOLEAN NOT NULL DEFAULT true,
  marketing BOOLEAN NOT NULL DEFAULT false,
  policy_version TEXT NOT NULL DEFAULT '1',
  source TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(subject_type,subject_id)
);
CREATE TABLE IF NOT EXISTS sceneshop_privacy_requests (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  organization_id TEXT REFERENCES sceneshop_organizations(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK(type IN ('EXPORT','DELETE')),
  status TEXT NOT NULL CHECK(status IN ('REQUESTED','PROCESSING','COMPLETED','REJECTED')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  result_ref TEXT,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS sceneshop_privacy_requests_user_idx ON sceneshop_privacy_requests(username,requested_at DESC);
CREATE TABLE IF NOT EXISTS sceneshop_retention_policies (
  organization_id TEXT PRIMARY KEY REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  viewer_days INTEGER NOT NULL DEFAULT 30 CHECK(viewer_days BETWEEN 1 AND 365),
  sync_days INTEGER NOT NULL DEFAULT 30 CHECK(sync_days BETWEEN 1 AND 365),
  activation_days INTEGER NOT NULL DEFAULT 180 CHECK(activation_days BETWEEN 30 AND 2555),
  security_event_days INTEGER NOT NULL DEFAULT 365 CHECK(security_event_days BETWEEN 30 AND 2555),
  audit_days INTEGER NOT NULL DEFAULT 2555 CHECK(audit_days BETWEEN 365 AND 3650),
  financial_days INTEGER NOT NULL DEFAULT 2555 CHECK(financial_days BETWEEN 365 AND 3650),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

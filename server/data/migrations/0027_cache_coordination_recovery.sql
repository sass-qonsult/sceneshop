-- SceneShop v0.17 alpha.2: distributed cache/coordination and recovery verification authority.
-- Redis remains ephemeral/rebuildable. Only PostgreSQL records durable DR checkpoints and verification results.

CREATE TABLE IF NOT EXISTS sceneshop_recovery_checkpoints (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('CREATED','VERIFIED','FAILED')),
  source_revision BIGINT NOT NULL,
  source_snapshot_sha256 TEXT NOT NULL CHECK (source_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  source_latest_migration TEXT NOT NULL,
  source_wal_lsn TEXT,
  manifest JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sceneshop_recovery_checkpoints_status_created_idx
  ON sceneshop_recovery_checkpoints(status, created_at DESC);

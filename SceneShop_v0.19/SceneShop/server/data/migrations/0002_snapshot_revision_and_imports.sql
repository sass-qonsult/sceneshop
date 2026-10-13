-- Adds optimistic concurrency protection to the transitional state snapshot and
-- an auditable manifest for runtime.json migrations.

ALTER TABLE sceneshop_state_snapshots
  ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sceneshop_runtime_imports (
  id BIGSERIAL PRIMARY KEY,
  source_checksum CHAR(64) NOT NULL,
  source_bytes BIGINT NOT NULL,
  source_version INTEGER NOT NULL,
  summary JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sceneshop_runtime_imports_checksum
  ON sceneshop_runtime_imports(source_checksum);

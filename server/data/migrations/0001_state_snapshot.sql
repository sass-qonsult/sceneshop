-- SceneShop v0.9 Data Plane bootstrap.
-- Transitional snapshot table: keeps the v0.8 mutable state compatible while
-- domain repositories are migrated incrementally behind the store facade.

CREATE TABLE IF NOT EXISTS sceneshop_state_snapshots (
  singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  state_version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sceneshop_outbox (
  id BIGSERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  aggregate_type TEXT,
  aggregate_id TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sceneshop_outbox_unpublished
  ON sceneshop_outbox (created_at)
  WHERE published_at IS NULL;

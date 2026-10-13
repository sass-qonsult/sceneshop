-- SceneShop v0.17 alpha.1: scale/reliability foundation.
-- Turns the existing transactional outbox into a horizontally safe leased queue.

ALTER TABLE sceneshop_outbox ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sceneshop_outbox ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE sceneshop_outbox ADD COLUMN IF NOT EXISTS locked_by TEXT;
ALTER TABLE sceneshop_outbox ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE sceneshop_outbox ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE sceneshop_outbox ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS sceneshop_outbox_ready_idx
  ON sceneshop_outbox(next_attempt_at, created_at, id)
  WHERE published_at IS NULL AND dead_lettered_at IS NULL;

CREATE INDEX IF NOT EXISTS sceneshop_outbox_dead_letter_idx
  ON sceneshop_outbox(dead_lettered_at, id)
  WHERE dead_lettered_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS sceneshop_worker_heartbeats (
  worker_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  host TEXT,
  pid INTEGER,
  version TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sceneshop_worker_heartbeats_kind_seen_idx
  ON sceneshop_worker_heartbeats(kind, last_seen_at DESC);

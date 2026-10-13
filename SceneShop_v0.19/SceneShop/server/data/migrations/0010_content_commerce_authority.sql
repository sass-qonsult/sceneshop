-- SceneShop v0.9 alpha.6 — Content / Commerce Track authority.
-- Content lives in PostgreSQL; source video can be temporary processing input.
-- Commerce Track publications are immutable revisions over approved placements.

ALTER TABLE sceneshop_works
  ADD COLUMN IF NOT EXISTS sync_id TEXT;

UPDATE sceneshop_works
   SET sync_id = 'SYNC-' || upper(substr(md5(id), 1, 16))
 WHERE sync_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sceneshop_works_sync_id
  ON sceneshop_works(sync_id) WHERE sync_id IS NOT NULL;

ALTER TABLE sceneshop_commercial_assets
  ADD COLUMN IF NOT EXISTS product_id TEXT REFERENCES sceneshop_products(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sceneshop_commercial_assets_product
  ON sceneshop_commercial_assets(product_id) WHERE product_id IS NOT NULL;

ALTER TABLE sceneshop_placements
  ADD COLUMN IF NOT EXISTS source_track_id TEXT,
  ADD COLUMN IF NOT EXISTS source_scene_id TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

CREATE INDEX IF NOT EXISTS idx_sceneshop_placements_source
  ON sceneshop_placements(source_track_id, source_scene_id)
  WHERE source_track_id IS NOT NULL;

-- Product relation becomes enforceable now that PostgreSQL is authoritative for content.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='fk_sceneshop_scene_products_product'
  ) THEN
    ALTER TABLE sceneshop_scene_products
      ADD CONSTRAINT fk_sceneshop_scene_products_product
      FOREIGN KEY(product_id) REFERENCES sceneshop_products(id) ON DELETE RESTRICT;
  END IF;
END $$;

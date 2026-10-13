-- SceneShop v0.10 alpha.2: tenant ownership and repository-level isolation.
-- Legacy rows remain nullable so pre-v0.10 data can be migrated incrementally.

ALTER TABLE sceneshop_works
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES sceneshop_organizations(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS sceneshop_works_org_idx ON sceneshop_works(organization_id, updated_at DESC);

ALTER TABLE sceneshop_products
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES sceneshop_organizations(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS sceneshop_products_org_idx ON sceneshop_products(organization_id, updated_at DESC);

ALTER TABLE sceneshop_tracks
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES sceneshop_organizations(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS sceneshop_tracks_org_idx ON sceneshop_tracks(organization_id, work_id, updated_at DESC);

ALTER TABLE sceneshop_commercial_assets
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES sceneshop_organizations(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS sceneshop_commercial_assets_org_idx ON sceneshop_commercial_assets(organization_id, status, updated_at DESC);

ALTER TABLE sceneshop_analysis_jobs
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES sceneshop_organizations(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS sceneshop_analysis_jobs_org_idx ON sceneshop_analysis_jobs(organization_id, work_id, created_at DESC);

ALTER TABLE sceneshop_campaigns
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES sceneshop_organizations(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS sceneshop_campaigns_org_idx ON sceneshop_campaigns(organization_id, updated_at DESC);

ALTER TABLE sceneshop_commerce_track_publications
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES sceneshop_organizations(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS sceneshop_commerce_track_publications_org_idx
  ON sceneshop_commerce_track_publications(organization_id, work_id, revision DESC);

ALTER TABLE sceneshop_merchant_connections
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES sceneshop_organizations(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS sceneshop_merchant_connections_org_idx
  ON sceneshop_merchant_connections(organization_id, status, updated_at DESC);

ALTER TABLE sceneshop_external_offers
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES sceneshop_organizations(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS sceneshop_external_offers_org_idx
  ON sceneshop_external_offers(organization_id, enabled, updated_at DESC);

ALTER TABLE sceneshop_offer_routing_policies
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES sceneshop_organizations(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS sceneshop_offer_routing_org_idx
  ON sceneshop_offer_routing_policies(organization_id, work_id, campaign_id, territory);

-- Backfill legacy content when an account/author has exactly one active organization.
WITH unique_org AS (
  SELECT a.author_id, min(m.organization_id) AS organization_id
    FROM sceneshop_accounts a
    JOIN sceneshop_organization_members m ON m.username=a.username AND m.status='ACTIVE'
   WHERE a.author_id IS NOT NULL
   GROUP BY a.author_id
  HAVING count(DISTINCT m.organization_id)=1
)
UPDATE sceneshop_works w
   SET organization_id=u.organization_id
  FROM unique_org u
 WHERE w.organization_id IS NULL AND w.owner_id=u.author_id;

WITH unique_org AS (
  SELECT a.author_id, min(m.organization_id) AS organization_id
    FROM sceneshop_accounts a
    JOIN sceneshop_organization_members m ON m.username=a.username AND m.status='ACTIVE'
   WHERE a.author_id IS NOT NULL
   GROUP BY a.author_id
  HAVING count(DISTINCT m.organization_id)=1
)
UPDATE sceneshop_products p
   SET organization_id=u.organization_id
  FROM unique_org u
 WHERE p.organization_id IS NULL AND p.created_by=u.author_id;

WITH unique_org AS (
  SELECT a.author_id, min(m.organization_id) AS organization_id
    FROM sceneshop_accounts a
    JOIN sceneshop_organization_members m ON m.username=a.username AND m.status='ACTIVE'
   WHERE a.author_id IS NOT NULL
   GROUP BY a.author_id
  HAVING count(DISTINCT m.organization_id)=1
)
UPDATE sceneshop_tracks t
   SET organization_id=u.organization_id
  FROM unique_org u
 WHERE t.organization_id IS NULL AND t.author_id=u.author_id;

UPDATE sceneshop_commerce_track_publications p
   SET organization_id=w.organization_id
  FROM sceneshop_works w
 WHERE p.organization_id IS NULL AND p.work_id=w.id AND w.organization_id IS NOT NULL;

UPDATE sceneshop_commercial_assets a
   SET organization_id=p.organization_id
  FROM sceneshop_products p
 WHERE a.organization_id IS NULL AND a.product_id=p.id AND p.organization_id IS NOT NULL;

-- A legacy work without owner_id can inherit the tenant when all its tracks agree.
WITH unique_track_org AS (
  SELECT work_id, min(organization_id) AS organization_id
    FROM sceneshop_tracks
   WHERE organization_id IS NOT NULL
   GROUP BY work_id
  HAVING count(DISTINCT organization_id)=1
)
UPDATE sceneshop_works w
   SET organization_id=u.organization_id
  FROM unique_track_org u
 WHERE w.organization_id IS NULL AND w.id=u.work_id;

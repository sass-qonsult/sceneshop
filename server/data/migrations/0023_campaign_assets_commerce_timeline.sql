-- SceneShop v0.15 RC hardening: CommercialAsset-first campaigns and routing.

CREATE TABLE IF NOT EXISTS sceneshop_campaign_assets (
  campaign_id TEXT NOT NULL REFERENCES sceneshop_campaigns(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES sceneshop_commercial_assets(id) ON DELETE CASCADE,
  PRIMARY KEY(campaign_id,asset_id)
);
CREATE INDEX IF NOT EXISTS sceneshop_campaign_assets_asset_idx ON sceneshop_campaign_assets(asset_id,campaign_id);

ALTER TABLE sceneshop_offer_routing_policies
  ADD COLUMN IF NOT EXISTS asset_id TEXT REFERENCES sceneshop_commercial_assets(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS sceneshop_offer_routing_asset_idx ON sceneshop_offer_routing_policies(organization_id,asset_id,territory,enabled);

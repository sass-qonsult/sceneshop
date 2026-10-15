-- SceneShop v0.9 financial authority foundation.
-- Commission amounts are frozen at sale time so later policy changes cannot
-- retroactively change historical economics.

CREATE TABLE IF NOT EXISTS sceneshop_commissions (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL UNIQUE REFERENCES sceneshop_sales(id) ON DELETE CASCADE,
  seller_id TEXT,
  order_id TEXT,
  author_id TEXT,
  track_id TEXT,
  partner_id TEXT,
  currency CHAR(3) NOT NULL DEFAULT 'BRL',
  gross_sale NUMERIC(14,2) NOT NULL CHECK (gross_sale >= 0),
  gross_commission NUMERIC(14,2) NOT NULL CHECK (gross_commission >= 0),
  partner_share NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (partner_share >= 0),
  owner_share NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (owner_share >= 0),
  sceneshop_share NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (sceneshop_share >= 0),
  commission_rate NUMERIC(8,6) NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 1),
  split_owner_rate NUMERIC(8,6) NOT NULL CHECK (split_owner_rate >= 0 AND split_owner_rate <= 1),
  partner_share_rate NUMERIC(8,6) NOT NULL CHECK (partner_share_rate >= 0 AND partner_share_rate <= 1),
  status TEXT NOT NULL DEFAULT 'custodia'
    CHECK (status IN ('custodia','congelado','aguardando_kyc','liberado','pago','estornado')),
  release_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sceneshop_commissions_author_release
  ON sceneshop_commissions(author_id, release_at DESC);
CREATE INDEX IF NOT EXISTS idx_sceneshop_commissions_order
  ON sceneshop_commissions(seller_id, order_id);
CREATE INDEX IF NOT EXISTS idx_sceneshop_commissions_status
  ON sceneshop_commissions(status, release_at);

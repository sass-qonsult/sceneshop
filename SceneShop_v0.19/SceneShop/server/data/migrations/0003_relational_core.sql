-- SceneShop v0.9 relational core.
-- These tables are the durable PostgreSQL projection that will progressively
-- replace the transitional JSON snapshot.  The snapshot remains only as a
-- compatibility read model while v0.8 synchronous modules are migrated.

CREATE TABLE IF NOT EXISTS sceneshop_authors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  partner_id TEXT,
  managed_by TEXT,
  kyc_status TEXT NOT NULL DEFAULT 'pendente',
  document TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sceneshop_accounts (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  author_id TEXT REFERENCES sceneshop_authors(id) ON DELETE SET NULL,
  token_version INTEGER NOT NULL DEFAULT 1 CHECK (token_version >= 0),
  demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_accounts_author ON sceneshop_accounts(author_id);

CREATE TABLE IF NOT EXISTS sceneshop_partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT,
  public_key TEXT,
  domains JSONB NOT NULL DEFAULT '[]'::jsonb,
  brand JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sceneshop_works (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  duration_seconds NUMERIC(14,3),
  video_url TEXT,
  poster_url TEXT,
  owner_id TEXT,
  pilot BOOLEAN NOT NULL DEFAULT false,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sceneshop_work_partners (
  work_id TEXT NOT NULL REFERENCES sceneshop_works(id) ON DELETE CASCADE,
  partner_id TEXT NOT NULL REFERENCES sceneshop_partners(id) ON DELETE CASCADE,
  PRIMARY KEY(work_id, partner_id)
);

CREATE TABLE IF NOT EXISTS sceneshop_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  sku TEXT,
  image_url TEXT,
  reference_price NUMERIC(14,2),
  created_by TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_products_category ON sceneshop_products(category);
CREATE INDEX IF NOT EXISTS idx_sceneshop_products_created_by ON sceneshop_products(created_by);

CREATE TABLE IF NOT EXISTS sceneshop_tracks (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  type TEXT NOT NULL,
  author_id TEXT,
  title TEXT NOT NULL,
  offset_seconds NUMERIC(14,3) NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_tracks_work ON sceneshop_tracks(work_id);
CREATE INDEX IF NOT EXISTS idx_sceneshop_tracks_author ON sceneshop_tracks(author_id);

CREATE TABLE IF NOT EXISTS sceneshop_track_scenes (
  track_id TEXT NOT NULL REFERENCES sceneshop_tracks(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL,
  title TEXT,
  start_seconds NUMERIC(14,3) NOT NULL,
  end_seconds NUMERIC(14,3) NOT NULL,
  position INTEGER NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(track_id, scene_id),
  CHECK (end_seconds >= start_seconds)
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_track_scenes_time
  ON sceneshop_track_scenes(track_id, start_seconds, end_seconds);

CREATE TABLE IF NOT EXISTS sceneshop_scene_products (
  track_id TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  match_type TEXT,
  position INTEGER NOT NULL,
  box JSONB,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(track_id, scene_id, product_id, position),
  FOREIGN KEY(track_id, scene_id)
    REFERENCES sceneshop_track_scenes(track_id, scene_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_scene_products_product ON sceneshop_scene_products(product_id);

CREATE TABLE IF NOT EXISTS sceneshop_sellers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cnpj TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  kind TEXT,
  integration TEXT,
  store_url TEXT,
  secret TEXT,
  agreement JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sceneshop_official_offers (
  product_id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sceneshop_sellers(id) ON DELETE RESTRICT,
  price NUMERIC(14,2) NOT NULL CHECK (price >= 0),
  commission NUMERIC(8,6) NOT NULL CHECK (commission >= 0 AND commission <= 1),
  valid_until TIMESTAMPTZ NOT NULL,
  set_by TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_official_offers_seller ON sceneshop_official_offers(seller_id);

CREATE TABLE IF NOT EXISTS sceneshop_issued_offers (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  price_cents BIGINT NOT NULL CHECK (price_cents >= 0),
  currency CHAR(3) NOT NULL,
  commission NUMERIC(8,6) NOT NULL CHECK (commission >= 0 AND commission <= 1),
  work_id TEXT,
  track_id TEXT,
  click_id TEXT,
  partner_id TEXT,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_issued_offers_expires ON sceneshop_issued_offers(expires_at);
CREATE INDEX IF NOT EXISTS idx_sceneshop_issued_offers_seller ON sceneshop_issued_offers(seller_id);

CREATE TABLE IF NOT EXISTS sceneshop_clicks (
  id TEXT PRIMARY KEY,
  track_id TEXT,
  author_id TEXT,
  product_id TEXT,
  store_id TEXT,
  device_id TEXT,
  session_id TEXT,
  partner_id TEXT,
  anonymous BOOLEAN NOT NULL DEFAULT false,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_clicks_author_time ON sceneshop_clicks(author_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sceneshop_clicks_product_time ON sceneshop_clicks(product_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS sceneshop_sales (
  id TEXT PRIMARY KEY,
  click_id TEXT,
  track_id TEXT,
  author_id TEXT,
  product_id TEXT,
  store_id TEXT,
  seller_id TEXT,
  partner_id TEXT,
  offer_id TEXT,
  order_id TEXT,
  value NUMERIC(14,2) NOT NULL CHECK (value >= 0),
  commission_rate NUMERIC(8,6),
  attribution TEXT,
  official BOOLEAN NOT NULL DEFAULT false,
  reversed BOOLEAN NOT NULL DEFAULT false,
  occurred_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_sales_author_time ON sceneshop_sales(author_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sceneshop_sales_order ON sceneshop_sales(seller_id, order_id);

CREATE TABLE IF NOT EXISTS sceneshop_orders (
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  offer_id TEXT,
  sale_id TEXT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL,
  via TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  ordered_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(seller_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_orders_sale ON sceneshop_orders(sale_id);

CREATE TABLE IF NOT EXISTS sceneshop_code_pool (
  seller_id TEXT NOT NULL,
  code TEXT NOT NULL,
  product_id TEXT,
  status TEXT NOT NULL,
  offer_id TEXT,
  reserved_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(seller_id, code)
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_code_pool_available
  ON sceneshop_code_pool(seller_id, product_id)
  WHERE status = 'livre';

CREATE TABLE IF NOT EXISTS sceneshop_reports (
  id TEXT PRIMARY KEY,
  track_id TEXT,
  scene_id TEXT,
  product_id TEXT,
  reason TEXT,
  device_id TEXT,
  weight NUMERIC(12,4),
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS sceneshop_alerts (
  id TEXT PRIMARY KEY,
  alert_key TEXT,
  author_id TEXT,
  rule TEXT,
  severity TEXT,
  detail TEXT,
  status TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_alerts_open ON sceneshop_alerts(status, severity);

CREATE TABLE IF NOT EXISTS sceneshop_audit_log (
  seq BIGINT PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash TEXT,
  entry_hash TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sceneshop_audit_hash ON sceneshop_audit_log(entry_hash);

CREATE TABLE IF NOT EXISTS sceneshop_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT,
  work_id TEXT,
  track_id TEXT,
  device_id TEXT,
  partner_id TEXT,
  occurred_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_events_work_time ON sceneshop_events(work_id, occurred_at DESC);

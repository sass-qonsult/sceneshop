-- SceneShop v0.16 alpha.2: governed privacy execution and anonymization markers.
ALTER TABLE sceneshop_accounts ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;
ALTER TABLE sceneshop_authors ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;
ALTER TABLE sceneshop_privacy_requests ADD COLUMN IF NOT EXISTS processed_by TEXT;
CREATE INDEX IF NOT EXISTS sceneshop_accounts_anonymized_idx ON sceneshop_accounts(anonymized_at) WHERE anonymized_at IS NOT NULL;

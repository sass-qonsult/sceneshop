-- SceneShop v0.9 alpha.5: PostgreSQL becomes the authority for account
-- authentication and login-session revocation. The compatibility snapshot
-- remains available to modules not yet migrated, but account credentials and
-- token_version are no longer overwritten by the generic state projector.

CREATE TABLE IF NOT EXISTS sceneshop_auth_sessions (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES sceneshop_accounts(username) ON DELETE CASCADE,
  token_version INTEGER NOT NULL CHECK (token_version >= 0),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  ip_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_sceneshop_auth_sessions_user_active
  ON sceneshop_auth_sessions(username, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sceneshop_auth_sessions_expiry
  ON sceneshop_auth_sessions(expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE sceneshop_accounts
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

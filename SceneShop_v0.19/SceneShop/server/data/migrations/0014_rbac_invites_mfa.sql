-- SceneShop v0.10 alpha.3: capability RBAC, secure invitations and MFA/session hardening.

ALTER TABLE sceneshop_auth_sessions
  ADD COLUMN IF NOT EXISTS auth_strength TEXT NOT NULL DEFAULT 'PASSWORD'
    CHECK (auth_strength IN ('PASSWORD','MFA')),
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS device_label TEXT;

CREATE INDEX IF NOT EXISTS sceneshop_auth_sessions_strength_idx
  ON sceneshop_auth_sessions(username, auth_strength, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS sceneshop_account_mfa (
  username TEXT PRIMARY KEY REFERENCES sceneshop_accounts(username) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'TOTP' CHECK (method IN ('TOTP')),
  secret_ciphertext TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  secret_tag TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sceneshop_organization_invites
  ADD COLUMN IF NOT EXISTS accepted_by TEXT REFERENCES sceneshop_accounts(username) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS sceneshop_org_invites_target_idx
  ON sceneshop_organization_invites(username, status, expires_at)
  WHERE status='PENDING';

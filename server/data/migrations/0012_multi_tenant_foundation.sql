-- SceneShop v0.10: multi-tenant organization foundation.
CREATE TABLE IF NOT EXISTS sceneshop_organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CONTENT_OWNER','PRODUCER','CHANNEL','BRAND','AGENCY','PLATFORM','RETAILER','OTHER')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','ARCHIVED')),
  created_by TEXT REFERENCES sceneshop_accounts(username) ON DELETE SET NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sceneshop_organization_members (
  organization_id TEXT NOT NULL REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  username TEXT NOT NULL REFERENCES sceneshop_accounts(username) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('OWNER','ADMIN','EDITOR','COMMERCIAL','ANALYST','VIEWER')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INVITED','SUSPENDED')),
  invited_by TEXT REFERENCES sceneshop_accounts(username) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (organization_id, username)
);
CREATE INDEX IF NOT EXISTS sceneshop_org_members_user_idx
  ON sceneshop_organization_members(username, status);
CREATE INDEX IF NOT EXISTS sceneshop_org_members_org_idx
  ON sceneshop_organization_members(organization_id, role, status);

CREATE TABLE IF NOT EXISTS sceneshop_organization_invites (
  id UUID PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES sceneshop_organizations(id) ON DELETE CASCADE,
  email TEXT,
  username TEXT,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','EDITOR','COMMERCIAL','ANALYST','VIEWER')),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REVOKED','EXPIRED')),
  invited_by TEXT REFERENCES sceneshop_accounts(username) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR username IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS sceneshop_org_invites_org_idx
  ON sceneshop_organization_invites(organization_id, status, expires_at);

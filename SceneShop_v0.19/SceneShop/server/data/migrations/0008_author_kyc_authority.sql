-- SceneShop v0.9 alpha.5.1 — Author/KYC PostgreSQL authority.
-- Raw identity documents are never stored here. The database keeps a keyed
-- document hash plus the masked representation used by the product UI.

CREATE TABLE IF NOT EXISTS sceneshop_author_kyc (
  author_id TEXT PRIMARY KEY REFERENCES sceneshop_authors(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','em_analise','aprovado','reprovado')),
  document_hash TEXT UNIQUE,
  document_masked TEXT,
  legal_name TEXT,
  subject_type TEXT CHECK (subject_type IS NULL OR subject_type IN ('PF','PJ')),
  pep BOOLEAN NOT NULL DEFAULT false,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sceneshop_author_kyc_status
  ON sceneshop_author_kyc(status, submitted_at DESC);

-- Bootstrap KYC authority from the existing author projection. Payload data is
-- used only to seed already-known demo/runtime state; later updates are written
-- through the KYC repository and are not reprojected from the JSON snapshot.
INSERT INTO sceneshop_author_kyc(
  author_id,status,document_hash,document_masked,legal_name,subject_type,pep,
  submitted_at,metadata,updated_at)
SELECT a.id,
       COALESCE(NULLIF(a.kyc_status,''),'pendente'),
       NULLIF(a.payload->>'kycDocHash',''),
       a.document,
       NULLIF(a.payload->'kycData'->>'name',''),
       NULLIF(a.payload->'kycData'->>'type',''),
       COALESCE((a.payload->'kycData'->>'pep')::boolean,false),
       CASE
         WHEN (a.payload->'kycData'->>'submittedAt') ~ '^[0-9]+$'
         THEN to_timestamp(((a.payload->'kycData'->>'submittedAt')::double precision) / 1000.0)
         ELSE NULL
       END,
       '{}'::jsonb,
       now()
  FROM sceneshop_authors a
ON CONFLICT(author_id) DO NOTHING;

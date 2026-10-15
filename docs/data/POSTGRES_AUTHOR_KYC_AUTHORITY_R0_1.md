# SceneShop — PostgreSQL Author/KYC Authority R0.1

Status: **v0.9.0-alpha.5.1**

## Purpose

PostgreSQL is the authority for author KYC state. The compatibility snapshot may carry a read copy for legacy modules, but it cannot overwrite an existing PostgreSQL author/KYC record.

## Privacy model

The KYC database does **not** store the raw CPF/CNPJ. It stores:

- a keyed SHA-256/HMAC document hash used for uniqueness;
- the masked document representation used by the UI;
- legal name;
- PF/PJ classification;
- PEP declaration;
- submission/review timestamps and reviewer;
- workflow status.

The bank/Pix field is validated by the current MVP onboarding but is not persisted by this authority layer. A future payments/KYC provider integration must use a dedicated secret/tokenized field, never a generic JSON payload containing raw financial credentials.

## Authoritative write flows

### Submit KYC

`PENDING -> IN_REVIEW`

One PostgreSQL domain transaction writes:

1. `sceneshop_author_kyc` submission/upsert;
2. the public/masked KYC view on `sceneshop_authors`;
3. tamper-evident audit entry;
4. compatibility snapshot revision;
5. `identity.kyc.submitted` outbox event.

`document_hash` is UNIQUE, providing the cross-process duplicate-document barrier.

### Compliance decision

`IN_REVIEW -> APPROVED | REJECTED`

The transaction updates the KYC authority row, author public status, audit chain, snapshot and `identity.kyc.decided` outbox event together.

## Projector rule

The generic state projector may insert a missing author/KYC row for bootstrap/import, using `ON CONFLICT DO NOTHING`. It must not update an existing author or KYC row. This prevents a stale Node snapshot from rolling back compliance decisions.

## Read paths

- `/api/me` uses authoritative principal/author data.
- `/api/me/ledger` resolves author/KYC from the authoritative repository when PostgreSQL is active.
- `/api/aml/kyc` reads the KYC review queue from PostgreSQL.
- withdrawal eligibility consumes the authoritative KYC status.

## Remaining compliance work

AML alerts and payout settlement still have legacy compatibility-state paths in v0.9. They are not declared PostgreSQL-authoritative by this document and remain later Data Plane migration work.

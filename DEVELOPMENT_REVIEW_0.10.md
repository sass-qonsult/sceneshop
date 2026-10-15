# SceneShop — Development Review v0.10

## v0.10.0-alpha.1 — Multi-Tenant Foundation
The v0.10 line began the second major roadmap step with Organization, Membership and organization-scoped roles independent from Account/Author.

## v0.10.0-alpha.2 — Tenant Ownership & Isolation

### Implemented
- PostgreSQL migration `0013_tenant_ownership_isolation.sql`.
- Organization ownership for works, products, tracks, commercial assets, AI jobs, campaigns, Commerce Track publications, merchant connections, external offers and routing policies.
- Legacy backfill only when author → organization mapping is unambiguous.
- Repository-scoped reads for works, products and tracks.
- Repository guards preventing a track from binding a work or private product from another tenant.
- Product updates constrained by both `id` and `organization_id`.
- Commerce Track publications and derived Commercial Assets inherit tenant ownership.
- Studio writes use Organization as the authorization boundary; individual author remains provenance.
- Team collaboration: authorized members can maintain shared organization resources even when created by another member.
- Studio product search returns organization inventory + global catalog, never another tenant's private inventory.
- Anonymous product search/detail excludes organization-private inventory; published commerce data is exposed through governed Commerce Track surfaces instead.
- Organization-aware AI work/inventory lookup.
- Organization-aware official-offer authorization.
- Automatic personal workspace for new community accounts.
- Studio organization selector and automatic `X-SceneShop-Organization` propagation.
- Single-membership users can be auto-bound server-side; multi-membership users use explicit tenant context.

### Current permission matrix
- Works / tracks / AI mutation: OWNER, ADMIN, EDITOR.
- Product inventory mutation: OWNER, ADMIN, EDITOR, COMMERCIAL.
- Official offer mutation: OWNER, ADMIN, COMMERCIAL.
- Organization-scoped reads: active membership, subject to endpoint/global-role compatibility rules.

### Validation
- Unit/contract suite: 102/102 PASS.
- HTTP integration: 31 checks PASS.
- Cross-tenant integration: product created in Organization A is editable by another authorized member of A; the same user cannot see or edit it under Organization B.
- Migration manifest: 13 contiguous migrations; latest `0013_tenant_ownership_isolation.sql`.

### v0.9 release relationship
v0.9 remains isolated on `release/v0.9`, pending only the externally unavailable deterministic npm lock refresh and live PostgreSQL/Redis validation. v0.10 changes remain on their own feature branch.

### Next v0.10 block
RBAC / security hardening: move endpoint authorization from legacy global account roles toward organization capabilities, add invitations lifecycle, and prepare MFA/session policy without weakening the organization isolation established here.


## v0.10.0-alpha.3 — RBAC, invitations and MFA

- Capability-based tenant authorization replaces fixed global-role checks on organization-scoped content, commerce and AI routes.
- Secure one-time organization invitations store only token hashes and support expiration/revocation/acceptance.
- TOTP MFA is functional end-to-end; seeds are AES-256-GCM encrypted at rest.
- MFA login uses a short-lived signed challenge and creates MFA-strength sessions.
- Organizations can require MFA for all write operations.
- Active sessions can be listed and individually revoked; logout-all remains available.
- Studio now supports MFA login, Team & Security management, invites and organization security policy.
- Official track classification follows organization authority rather than a user's legacy global role.
- Validation: 107/107 unit/contract tests and 45 HTTP integration checks pass.

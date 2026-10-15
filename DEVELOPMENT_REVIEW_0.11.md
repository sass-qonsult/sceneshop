# SceneShop — Development Review v0.11

## v0.11.0-alpha.1 — Governed Commerce Core

### Objective
Transform the previously prepared commerce tables into an operational, organization-governed domain without coupling SceneShop to a single marketplace.

### Implemented
- Sponsor/Brand domain scoped by Organization.
- Campaigns with sponsor, lifecycle, territories, products and policy.
- Global Commerce Provider registry with brand-direct, custom/private marketplace, Amazon, Mercado Livre, Shopee, lead, dealer and reservation presets.
- Organization-scoped Merchant Connections.
- External Offers independent from Commerce Timeline timestamps.
- Per-offer editable commission rate (0–100%), price, territory, availability, CTA and validity.
- Explicit routing policies with authorized offer entries.
- Repository/SQL tenant isolation for sponsors, campaigns, connections, offers and routing.
- COMMERCE_READ / COMMERCE_WRITE authorization and MFA enforcement inherited from v0.10.
- Audit events for commercial mutations.
- Migration `0015_commerce_core.sql`.

### Key doctrine
`Commerce Track != Price != Marketplace`. The timeline points to governed commercial assets/products. Commerce Core resolves the authorized offer/destination separately so price, stock, CTA or seller can change without reprocessing the audiovisual content.

### Validation
- Unit/contract regression: **114/114 PASS**.
- HTTP integration: **57 checks PASS**.
- Migration manifest: **15 contiguous migrations**, latest `0015_commerce_core.sql`.
- Local preflight: PASS. Strict npm/PostgreSQL/Redis external release gates remain inherited from earlier release lines.

### Next block
Alpha.2: dynamic offer resolution, first-party attribution and Studio preview, then v0.11 RC preparation.

## v0.11.0-alpha.2 — Dynamic Resolution & First-Party Attribution

### Objective
Turn the governed commercial catalog into an executable consumer path while keeping seller/marketplace selection independent from the audiovisual timeline.

### Implemented
- Dynamic offer resolver using Product/CommercialAsset, territory, active Campaign, Work and Placement context.
- Policy specificity precedence (`Placement > Campaign > Work > Product > Territory/Global`).
- Operational routing for `PRIORITY`, `FIRST_AVAILABLE`, `LOWEST_PRICE` and `BRAND_DIRECT_FIRST`.
- Eligibility filtering for offer/connection status, territory, validity, availability and campaign lifecycle.
- Campaign-product authorization when a Campaign has an explicit product set.
- 30-minute frozen Commerce Resolution containing the exact ordered offer set shown to the consumer.
- Viewer device persisted only as SHA-256 in the resolution record.
- First-party activation records before external redirect.
- Public resolver validates Product/Placement against the currently published Commerce Track.
- Consumer payload exposes SceneShop activation links instead of raw marketplace destination URLs.
- Redirect destinations restricted to HTTP/HTTPS.
- Studio route and preview UI for testing commercial policy without attribution.
- Migration `0016_commerce_resolution_attribution.sql`.
- Compatibility state moves to version 14.

### Validation
- Unit/contract regression: **119/119 PASS**.
- HTTP integration: **62 checks PASS**.
- Migration manifest: **16 contiguous migrations**, latest `0016_commerce_resolution_attribution.sql`.
- Local preflight: PASS. The inherited strict npm-lock/PostgreSQL/Redis live gates remain external release blockers only.

### v0.11 status
Alpha.2 is the last planned alpha for Commerce Core. Next state is v0.11 RC preparation; no alpha.3 is planned unless an objective defect requires it.

## RC preparation
The `release/v0.11` line adds a dedicated CI gate with PostgreSQL 16.15 + Redis 7.4.11. Local deterministic validation remains 119/119 tests + 62 HTTP checks + 16 contiguous migrations. RC promotion remains deliberately blocked until the strict lockfile and live PostgreSQL/Redis gates pass in a networked environment.

# SceneShop Multi-Tenant Foundation R0.1

## Objective
SceneShop separates **global account identity** from **organization membership**. A single authenticated person may operate across multiple producers, channels, brands, agencies or platforms without sharing permissions between tenants.

## Canonical model
- `Account`: global login/security principal.
- `Organization`: commercial/editorial tenant.
- `Membership`: role of an Account inside one Organization.
- `Organization Invite`: future onboarding path; invitation secrets are represented only by a token hash.

## Organization kinds
`CONTENT_OWNER`, `PRODUCER`, `CHANNEL`, `BRAND`, `AGENCY`, `PLATFORM`, `RETAILER`, `OTHER`.

## Organization roles
- `OWNER`: ultimate tenant administrator. At least one active OWNER must remain.
- `ADMIN`: manages ordinary members but cannot grant/remove OWNER or ADMIN privileges.
- `EDITOR`: content/Commerce Track editorial work (enforcement expands in alpha.2).
- `COMMERCIAL`: campaigns, offers and commercial configuration.
- `ANALYST`: reporting/analytics.
- `VIEWER`: read-only organizational access.

These roles are **not** the same as the legacy/global account roles (`author`, `producer`, `moderator`). Platform-level compliance remains separate from tenant permissions.

## Tenant selection
The authenticated token identifies only the Account. A request may select the tenant using:

`X-SceneShop-Organization: <organization-id>`

The middleware verifies an ACTIVE membership on every request. Tenant selection is therefore not trusted from the client and does not require reissuing a token when the user changes organizations.

## APIs introduced
- `GET /api/me/organizations`
- `GET /api/me/context`
- `POST /api/organizations`
- `GET /api/organizations/:id`
- `GET /api/organizations/:id/members`
- `POST /api/organizations/:id/members`
- `PATCH /api/organizations/:id/members/:username`
- `DELETE /api/organizations/:id/members/:username`

## PostgreSQL
Migration `0012_multi_tenant_foundation.sql` creates:
- `sceneshop_organizations`
- `sceneshop_organization_members`
- `sceneshop_organization_invites`

Organization membership is PostgreSQL-authoritative when the PostgreSQL backend is active. Memory/file mode has a compatibility repository for local demonstration and tests.

## Next isolation step
Alpha.2 must attach content and commerce ownership to organizations (`works`, `products`, tracks/campaigns/providers as appropriate) and enforce tenant boundaries in the repositories themselves, not merely in HTTP routes.

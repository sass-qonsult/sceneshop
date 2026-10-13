# SceneShop — Tenant Ownership & Isolation R0.1

## Purpose
v0.10 alpha.2 moves business ownership from an individual author/producer to an Organization. Individual users remain the actors recorded for provenance and audit, while organizations own the durable business resources.

## Canonical ownership
The following resources are organization-scoped in PostgreSQL:
- works;
- products;
- tracks;
- commercial assets and analysis jobs;
- campaigns;
- Commerce Track publications;
- merchant connections;
- external offers;
- offer-routing policies.

`organization_id` is a foreign key to `sceneshop_organizations`. It remains nullable only for pre-v0.10/global compatibility records. New Studio-created business resources carry an organization.

## Isolation rule
Private Studio reads and writes are positive-scoped by organization. The repository query must include the selected `organization_id`; filtering only in the browser/UI is not considered authorization.

A member may collaborate on resources owned by the same organization even when another member originally created them. `createdBy` / `authorId` remains provenance, not the authorization boundary.

## Role matrix — alpha.2
- OWNER / ADMIN / EDITOR: create and edit works and Commerce Tracks; run AI analysis.
- OWNER / ADMIN / EDITOR / COMMERCIAL: create and maintain organization product inventory.
- OWNER / ADMIN / COMMERCIAL: maintain official offers.
- ANALYST: read organization-scoped commercial views where exposed; no content mutation.
- VIEWER: organization context/read-only membership.

Global account roles remain as a compatibility/safety layer in alpha.2. v0.10's next RBAC step will reduce dependence on those legacy global roles.

## Product search
Studio product search returns the selected organization's products plus global catalog products. It never includes another organization's private inventory. Anonymous generic product search/detail exposes only global catalog products; organization-private inventory is surfaced publicly only through governed published commerce surfaces.

## Legacy migration
Migration `0013_tenant_ownership_isolation.sql` backfills legacy records only when an author maps unambiguously to one active organization. Ambiguous legacy rows remain unassigned for operator review rather than being guessed into a tenant.

## Commerce Track publication
A published Commerce Track records its organization. Commercial assets generated from an organization track inherit the organization. The repository rejects a track whose work belongs to another organization and rejects organization-private products from another tenant.

## Workspace selection
The Studio sends the selected tenant through `X-SceneShop-Organization`. If the user belongs to exactly one active organization, the server may select it automatically. Users with multiple memberships must operate with an explicit organization context.

New community accounts receive a personal organization workspace so organization ownership is universal rather than producer-only.

# SceneShop v0.9 — RC Preparation R0.1

Status: **DEVELOP AHEAD OF v0.9.0-alpha.8 / RC NOT YET TAGGED**

## Purpose

This checkpoint removes stale content-authority reads discovered after alpha.8 while preserving the release rule that `v0.9.0-RC.1` may only be tagged after the real PostgreSQL + Redis validation harness and a complete npm lockfile both pass.

## Authority cleanup completed

### Official offer authorization

Producer offer listing and offer authorization no longer inspect `store.state.tracks` or `store.state.userProducts` directly when PostgreSQL is active.

The content repository now exposes:

- `listOfficialProductIdsByAuthorAuthoritative(authorId)`
- `authorOwnsOfficialProductAuthoritative(authorId, productId)`

The PostgreSQL implementation resolves both cases from `sceneshop_tracks`, `sceneshop_scene_products` and `sceneshop_products`.

This prevents a stale Node compatibility snapshot from granting or denying producer access to a product after content has changed on another process.

### AI input authority

The AI Studio endpoints now receive the content repository explicitly. In PostgreSQL mode:

- work ownership/source media are resolved through `getWorkAuthoritative()`;
- producer inventory is resolved through `listProductsByOwnerAuthoritative()`.

The file/memory path remains available as the local/demo fallback.

## Reproducible validation services

`compose.yaml` pins the v0.9 validation baseline to PostgreSQL `16.15-alpine` and Redis `7.4.11-alpine` rather than floating major/minor tags. This prevents a future image refresh from changing the RC validation environment without a source diff.

## Validation

- Node suite: **91/91 PASS**.
- JS/MJS syntax check: PASS.
- HTTP memory-backend smoke:
  - `/api/live`: PASS
  - `/api/ready`: PASS
  - producer login: PASS
  - `/api/me/official-offers`: PASS
  - `/api/ai/status`: PASS
- Migration manifest: 11 contiguous migrations; checksum validation PASS.

## RC gates still open

### 1. Complete package-lock

The project declares production dependencies `pg`, `redis` and `@socket.io/redis-adapter`, but the current lockfile does not yet contain their package trees. `npm run preflight:rc` therefore remains intentionally blocked.

### 2. Real PostgreSQL + Redis validation

`npm run validate:live` is ready to test migrations, persistence/restart, optimistic concurrency, Redis TTL/viewer isolation, Re-sync semantics and Socket.IO Redis Pub/Sub. The current execution environment has no PostgreSQL/Redis/Docker runtime and cannot resolve apt/npm/download hosts, so this checkpoint does **not** claim a live pass.

## Release rule

Do not create `v0.9.0-RC.1` until both RC gates above pass. No alpha.9 is required for these authority fixes; they live on `develop` ahead of the frozen `v0.9.0-alpha.8` tag.

# SceneShop v0.9 alpha.8 — Release Validation Gate R0.1

## Purpose

Alpha.8 closes the local code side of the v0.9 Data Plane and makes the remaining RC gate explicit and machine-checkable. It does **not** claim a live PostgreSQL/Redis validation when those daemons or packages are unavailable.

## Canonical authority split

- **PostgreSQL:** durable identity, KYC, financial transactions, content, Commerce Track publications, durable playback checkpoints, sync observations and per-viewer Browse Head checkpoints.
- **Redis:** ephemeral/high-frequency shared Playback Head, presence, pairing and per-viewer realtime commerce navigation state.
- **SceneShop client:** renders Commerce Timeline and can move its own Browse Head without moving the primary video.

## Viewer state correction

The shared PlaybackSession must never own a single global Browse Head. Alpha.8 adds `sceneshop_playback_viewers`, keyed by `(session_id, device_id)`, with:

- `LIVE | BROWSING` state;
- `browse_position`;
- `browse_scene_id`;
- `updated_at`.

Legacy Browse Head columns on `sceneshop_playback_sessions` remain compatibility-only during the v0.9 transition.

## Migration integrity

`server/data/migration-manifest.js` computes SHA-256 for every migration and validates a contiguous `0001..NNNN` sequence. PostgreSQL health now checks:

- number of applied migrations;
- latest applied migration;
- expected migration count/latest migration;
- migration drift.

Current expected latest migration: `0011_playback_viewer_state.sql`.

## Release preflight

`npm run preflight` validates local source/release metadata without requiring network access.

`npm run preflight:rc` is strict and blocks the Release Candidate when the npm lock tree is incomplete.

The strict gate intentionally requires package-lock entries for:

- `pg`;
- `redis`;
- `@socket.io/redis-adapter`.

## Live validation harness

Run against **real test/dev services**, never production data:

```bash
LIVE_DATABASE_URL=postgres://... \
LIVE_REDIS_URL=redis://... \
npm run validate:live
```

The harness is designed to validate:

1. isolated PostgreSQL migration chain in a random schema;
2. relational health/migration parity;
3. PostgreSQL snapshot round-trip;
4. restart persistence;
5. optimistic concurrency / stale-writer rejection;
6. Redis session creation and TTL;
7. per-viewer Browse Head isolation;
8. Companion re-sync without forcing an exploring viewer to LIVE;
9. Socket.IO Redis Pub/Sub propagation across two server instances.

## Current execution-environment result

Local deterministic regression passes. Live validation is **not executed** in the current sandbox because it has no PostgreSQL/Redis/Docker and outbound package/system installation times out. This remains a hard RC gate rather than being simulated.

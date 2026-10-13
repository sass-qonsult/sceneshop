# SceneShop Redis Realtime Authority R0.1

Status: canonical implementation note for `v0.9.0-alpha.7`.

## Purpose

Redis is the operational authority for short-lived playback/synchronization state. PostgreSQL remains the durable authority for content, identity, finance and audit/checkpoint records.

SceneShop does not store the audiovisual master as a distribution host. Realtime state coordinates one of the approved playback modes: `PARTNER_NATIVE`, `COMPANION`, or `EMBEDDED`.

## State split

### Shared playback state

One playback room owns the shared facts of the reproduction:

- SceneShop session/public pairing code;
- work/content identity;
- selected Commerce Track;
- playback mode and optional binding;
- Playback Head (`playbackPosition`);
- playback observation time;
- play/pause state;
- current commercial scene;
- last physical re-sync confidence/time when applicable;
- active phone presence;
- audience devices that entered the session.

This state is stored with TTL in Redis.

### Per-viewer commerce state

Browse state is never global to the room. Each audience device has its own:

- `LIVE` or `BROWSING` state;
- Browse Head;
- selected commercial scene;
- last update time.

Therefore one consumer can inspect an earlier Omega/Aston Martin/Tom Ford placement while another consumer continues following the live Commerce Track. Neither viewer changes the principal video playback.

## Go Live versus Re-sync

`GO LIVE` is a commerce-navigation operation. It moves one viewer's Browse Head to the current Playback Head and does not identify the media again.

`RE-SYNC` is a physical synchronization operation and is normally specific to `COMPANION`. It obtains/accepts a new content-position observation, corrects the Playback Head, records confidence and may be checkpointed into PostgreSQL. Re-sync does not force viewers that are in `BROWSING` back to live.

## Redis key model

The implementation uses a bounded namespace:

- `sceneshop:playback:session:<CODE>` — shared session hash;
- `sceneshop:playback:session:<CODE>:devices` — admitted anonymous devices;
- `sceneshop:playback:session:<CODE>:phones` — connected Socket.IO client IDs;
- `sceneshop:playback:session:<CODE>:viewer:<DEVICE>` — per-device commerce navigation.

All session keys are ephemeral and receive the same session TTL (currently four hours).

## Multi-node Socket.IO

When `SESSION_BACKEND=redis`, Socket.IO uses `@socket.io/redis-adapter` so room broadcasts and realtime events can cross Node instances. Redis therefore coordinates both state authority and inter-server Socket.IO Pub/Sub.

The adapter does not provide Socket.IO connection-state recovery. SceneShop clients must be able to reconnect, rejoin the public session and rebuild their state from Redis.

## PostgreSQL checkpoint boundary

High-frequency `player:tick` events are intentionally not written to PostgreSQL every second.

PostgreSQL stores durable playback/session records and explicit synchronization observations. The repository writes:

- initial playback session registration;
- selected low-frequency checkpoints;
- explicit Companion re-sync observations and confidence.

This keeps Redis on the hot path while retaining an auditable durable seam.

## Security

The QR/public pairing code is not a controller credential. The player controller token remains a separate high-entropy secret and is never returned by the public session view.

Audience proof continues to use admitted `deviceId` membership. Redis set membership replaces process-local membership when Redis is authoritative.

## Production requirements

Production requires:

- `DATA_BACKEND=postgres`;
- `DATABASE_URL`;
- `SESSION_BACKEND=redis`;
- `REDIS_URL`;
- `@socket.io/redis-adapter` and `redis` runtime dependencies.

`GET /api/ready` and `/api/health` now consider the Data Plane, realtime session backend and Socket.IO adapter health.

## Validation boundary

Deterministic tests cover Redis semantics with an injected Redis-compatible fake and PostgreSQL checkpoint SQL. The current execution environment does not provide a Redis daemon, PostgreSQL daemon or working npm registry, so live Redis Pub/Sub/failover remains a v0.9 alpha.8 validation gate.

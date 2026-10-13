# SceneShop v0.11 RC Preparation R0.1

## Candidate scope
The v0.11 candidate is frozen functionally at `v0.11.0-alpha.2`. No alpha.3 is planned unless an objective defect is found.

## Functional gates already passed locally
- 119/119 unit/contract tests.
- 62 HTTP integration checks.
- 16 contiguous SQL migrations ending at `0016_commerce_resolution_attribution.sql`.
- Local preflight PASS.
- Consumer resolution does not expose merchant destination URLs.
- Activation is recorded before HTTP/HTTPS redirect.
- Tenant isolation for sponsors, campaigns, merchant connections, offers and routing policies.

## External RC gates
The RC tag must not be created until all items below pass in a networked environment:
1. `npm ci` succeeds from the committed lockfile.
2. `npm run preflight:rc` passes with a complete `pg`, `redis` and `@socket.io/redis-adapter` dependency tree.
3. `npm run validate:live` passes against actual PostgreSQL and Redis services.
4. Full migration chain 0001–0016 applies cleanly from an empty database.
5. HTTP integration and regression suite pass in the same CI run.

## CI
`.github/workflows/v0.11-release-gate.yml` provisions PostgreSQL 16.15 and Redis 7.4.11 and executes the complete RC gate.

## Promotion
On successful external gate:
`release/v0.11` → tag `v0.11.0-RC.1` → final regression → `v0.11.0`.

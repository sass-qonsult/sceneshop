#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the SceneShop foundation gate." >&2
  exit 2
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required for the SceneShop foundation gate." >&2
  exit 2
fi

PROJECT="sceneshop-foundation-gate"
COMPOSE=(docker compose -p "$PROJECT" -f compose.yaml -f compose.foundation-gate.yaml)
cleanup() { "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

cleanup
"${COMPOSE[@]}" up -d --wait postgres redis

export LIVE_DATABASE_URL="postgresql://sceneshop:sceneshop_dev_only@127.0.0.1:55432/sceneshop"
export LIVE_REDIS_URL="redis://127.0.0.1:56379"

npm ci --ignore-scripts --no-audit --no-fund
npm run preflight:rc
SCENESHOP_MEMORY=1 DEMO=1 npm test
SCENESHOP_MEMORY=1 DEMO=1 npm run test:api
npm run validate:live

# v0.19+: prove the exact migration set and rollback contract against an isolated PostgreSQL schema.
if node -e "const s=require('./package.json').scripts||{}; process.exit(s['rc:schema:live']?0:1)"; then
  RC_DATABASE_URL="$LIVE_DATABASE_URL" npm run rc:schema:live
fi

ARTIFACT_DIR="${FOUNDATION_ARTIFACT_DIR:-$ROOT/artifacts/foundation-gate}"
mkdir -p "$ARTIFACT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE="$ARTIFACT_DIR/foundation-evidence-$STAMP.json"
GIT_COMMIT="$(git rev-parse HEAD 2>/dev/null || printf unknown)"
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
LOCK_SHA256="$(sha256sum package-lock.json | awk '{print $1}')"
node - "$EVIDENCE" "$STAMP" "$GIT_COMMIT" "$PACKAGE_VERSION" "$LOCK_SHA256" <<'NODE'
const fs = require('fs');
const { collectPreflight } = require('./tools/release-preflight');
(async () => {
  const [evidencePath, stamp, gitCommit, packageVersion, packageLockSha256] = process.argv.slice(2);
  const preflight = await collectPreflight({ rootDir: process.cwd() });
  if (!preflight.lockfile.ok || !preflight.productionDependencies.ok) throw new Error('Foundation evidence cannot be written from a failing preflight.');
  const evidence = {
    schemaVersion: 1,
    gate: `SceneShop ${packageVersion} foundation`,
    ok: true,
    executedAt: stamp,
    gitCommit,
    packageVersion,
    packageLockSha256,
    node: process.version,
    migrations: { count: preflight.migrations.count, latest: preflight.migrations.latest, latestChecksum: preflight.migrations.latestChecksum },
  };
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
NODE

echo "SceneShop ${PACKAGE_VERSION} foundation gate: PASS"
echo "Evidence: $EVIDENCE"

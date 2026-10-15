#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for cmd in docker npm node sha256sum; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "$cmd is required for the SceneShop recovery gate." >&2
    exit 2
  fi
done

docker compose version >/dev/null

PROJECT="sceneshop-recovery-gate"
COMPOSE=(docker compose -p "$PROJECT" -f compose.yaml -f compose.recovery-gate.yaml)
ARTIFACT_DIR="${RECOVERY_ARTIFACT_DIR:-$ROOT/artifacts/recovery-gate}"
mkdir -p "$ARTIFACT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$ARTIFACT_DIR/sceneshop-$STAMP.dump"
CHECKPOINT_JSON="$ARTIFACT_DIR/checkpoint-$STAMP.json"
VERIFY_JSON="$ARTIFACT_DIR/verify-$STAMP.json"
SMOKE_JSON="$ARTIFACT_DIR/restore-smoke-$STAMP.json"
EVIDENCE="$ARTIFACT_DIR/recovery-evidence-$STAMP.json"

cleanup() { "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

"${COMPOSE[@]}" up -d --wait postgres redis postgres_restore redis_fresh

export DATABASE_URL="postgresql://sceneshop:sceneshop_dev_only@127.0.0.1:55432/sceneshop"
export RECOVERY_DATABASE_URL="postgresql://sceneshop:sceneshop_dev_only@127.0.0.1:55433/sceneshop_restore"
export RECOVERY_REDIS_URL="redis://127.0.0.1:56380"

node tools/recovery-seed.js >/dev/null
node tools/recovery-drill.js --checkpoint > "$CHECKPOINT_JSON"
CHECKPOINT_ID="$(node -e "const x=require(process.argv[1]); if(!x.ok||!x.checkpoint?.id) process.exit(2); process.stdout.write(x.checkpoint.id)" "$CHECKPOINT_JSON")"

"${COMPOSE[@]}" exec -T postgres pg_dump -U sceneshop -d sceneshop -Fc > "$BACKUP"
if [[ ! -s "$BACKUP" ]]; then
  echo "PostgreSQL backup is empty." >&2
  exit 3
fi

cat "$BACKUP" | "${COMPOSE[@]}" exec -T postgres_restore pg_restore \
  -U sceneshop -d sceneshop_restore --clean --if-exists --no-owner --no-privileges

DATABASE_URL="$DATABASE_URL" RECOVERY_DATABASE_URL="$RECOVERY_DATABASE_URL" \
  node tools/recovery-drill.js "--verify=$CHECKPOINT_ID" > "$VERIFY_JSON"

RECOVERY_DATABASE_URL="$RECOVERY_DATABASE_URL" RECOVERY_REDIS_URL="$RECOVERY_REDIS_URL" \
  node tools/recovery-restored-smoke.js > "$SMOKE_JSON"

BACKUP_SHA256="$(sha256sum "$BACKUP" | awk '{print $1}')"
BACKUP_BYTES="$(wc -c < "$BACKUP" | tr -d ' ')"
GIT_COMMIT="$(git rev-parse HEAD 2>/dev/null || printf unknown)"
PACKAGE_VERSION="$(node -p "require('./package.json').version")"

node - "$CHECKPOINT_JSON" "$VERIFY_JSON" "$SMOKE_JSON" "$EVIDENCE" "$BACKUP_SHA256" "$BACKUP_BYTES" "$GIT_COMMIT" "$STAMP" <<'NODE'
const fs = require('fs');
const [checkpointPath, verifyPath, smokePath, evidencePath, backupSha256, backupBytes, gitCommit, stamp] = process.argv.slice(2);
const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
const verify = JSON.parse(fs.readFileSync(verifyPath, 'utf8'));
const smoke = JSON.parse(fs.readFileSync(smokePath, 'utf8'));
if (!checkpoint.ok || !verify.ok || !smoke.ok) throw new Error('Recovery gate produced a non-PASS component.');
const packageVersion = require('./package.json').version;
const evidence = {
  schemaVersion: 1,
  gate: `SceneShop ${packageVersion} recovery`,
  ok: true,
  executedAt: stamp,
  gitCommit,
  packageVersion,
  checkpointId: checkpoint.checkpoint.id,
  backup: { sha256: backupSha256, bytes: Number(backupBytes), format: 'pg_dump-custom' },
  verification: verify.verification,
  freshRedisSmoke: smoke,
};
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
NODE

echo "SceneShop ${PACKAGE_VERSION} recovery gate: PASS"
echo "Evidence: $EVIDENCE"

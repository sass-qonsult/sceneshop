#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bash tools/run-foundation-gate.sh
bash tools/run-recovery-gate.sh

echo "SceneShop v0.17 alpha.2 composite gate: PASS"

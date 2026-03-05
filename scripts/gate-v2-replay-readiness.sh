#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8082}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[gate] checking build provenance via /health.version"
BASE_URL="$BASE_URL" bash "$SCRIPT_DIR/check-health-version.sh"

echo "[gate] running v2 idempotency smoke"
BASE_URL="$BASE_URL" bash "$SCRIPT_DIR/smoke-v2-idempotency.sh"

echo "PASS: replay-readiness gate satisfied for ${BASE_URL}"

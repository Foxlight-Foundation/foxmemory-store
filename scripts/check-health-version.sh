#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8082}"
TIMEOUT="${TIMEOUT:-10}"

tmp_json="$(mktemp)"
trap 'rm -f "$tmp_json"' EXIT

status=$(curl -sS --max-time "$TIMEOUT" -o "$tmp_json" -w "%{http_code}" "${BASE_URL}/health")
if [[ "$status" != "200" ]]; then
  echo "BLOCKED: /health returned HTTP ${status}"
  cat "$tmp_json" 2>/dev/null || true
  exit 1
fi

if jq -e '.version and .build and .build.imageDigest' "$tmp_json" >/dev/null; then
  echo "PASS: provenance fields present (.version, .build, .build.imageDigest)"
  jq '{version, build}' "$tmp_json"
  exit 0
fi

echo "BLOCKED: missing provenance fields in /health"
jq '{version, build}' "$tmp_json"
exit 2

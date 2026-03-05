#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8082}"

resp=$(curl -sS "${BASE_URL}/health")
version=$(echo "$resp" | jq -r '.version // empty')

if [[ -z "$version" ]]; then
  echo "BLOCKED: /health.version missing at ${BASE_URL}"
  echo "$resp" | jq .
  exit 2
fi

echo "PASS: /health.version=${version}"

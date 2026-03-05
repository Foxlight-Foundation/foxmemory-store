#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8082}"
USER_ID="${USER_ID:-smoke-user}"
RUN_ID="${RUN_ID:-smoke-run}"
KEY="${IDEMPOTENCY_KEY:-$(uuidgen | tr '[:upper:]' '[:lower:]')}"

payload_a=$(cat <<JSON
{
  "text": "idempotency smoke $(date +%s)",
  "user_id": "${USER_ID}",
  "run_id": "${RUN_ID}",
  "idempotency_key": "${KEY}"
}
JSON
)

payload_b=$(cat <<JSON
{
  "text": "idempotency mismatch $(date +%s)",
  "user_id": "${USER_ID}",
  "run_id": "${RUN_ID}",
  "idempotency_key": "${KEY}"
}
JSON
)

echo "[1/3] initial write"
resp1=$(curl -sS -X POST "${BASE_URL}/v2/memory.write" -H 'Content-Type: application/json' -d "${payload_a}")
echo "$resp1" | jq . >/dev/null

echo "[2/3] replay same key+payload (expect same response)"
resp2=$(curl -sS -X POST "${BASE_URL}/v2/memory.write" -H 'Content-Type: application/json' -d "${payload_a}")
echo "$resp2" | jq . >/dev/null

if [[ "$resp1" != "$resp2" ]]; then
  echo "FAIL: replay payload mismatch"
  exit 1
fi

echo "[3/3] same key + different payload (expect 409)"
status=$(curl -sS -o /tmp/foxmemory-idem-conflict.json -w "%{http_code}" -X POST "${BASE_URL}/v2/memory.write" -H 'Content-Type: application/json' -d "${payload_b}")
if [[ "$status" != "409" ]]; then
  echo "FAIL: expected 409, got ${status}"
  cat /tmp/foxmemory-idem-conflict.json
  exit 1
fi

echo "PASS: idempotency replay/conflict contract holds"

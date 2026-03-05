#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8082}"
USER_ID="${USER_ID:-smoke-user}"
RUN_ID="${RUN_ID:-smoke-run}"
KEY="${IDEMPOTENCY_KEY:-$(uuidgen | tr '[:upper:]' '[:lower:]')}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARTIFACT_DIR="${ARTIFACT_DIR:-./artifacts/idempotency-smoke-${STAMP}}"
mkdir -p "${ARTIFACT_DIR}"

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
canon1=$(echo "$resp1" | jq -S -c .)
printf '%s\n' "$resp1" > "${ARTIFACT_DIR}/resp1.json"
printf '%s\n' "$canon1" > "${ARTIFACT_DIR}/resp1.canon.json"

echo "[2/3] replay same key+payload (expect semantic-equivalent response)"
resp2=$(curl -sS -X POST "${BASE_URL}/v2/memory.write" -H 'Content-Type: application/json' -d "${payload_a}")
canon2=$(echo "$resp2" | jq -S -c .)
printf '%s\n' "$resp2" > "${ARTIFACT_DIR}/resp2.json"
printf '%s\n' "$canon2" > "${ARTIFACT_DIR}/resp2.canon.json"

if [[ "$canon1" != "$canon2" ]]; then
  echo "FAIL: replay payload mismatch"
  echo "first:  $canon1"
  echo "second: $canon2"
  exit 1
fi

echo "[3/3] same key + different payload (expect 409)"
status=$(curl -sS -o "${ARTIFACT_DIR}/resp3-conflict.json" -w "%{http_code}" -X POST "${BASE_URL}/v2/memory.write" -H 'Content-Type: application/json' -d "${payload_b}")
printf '%s\n' "${status}" > "${ARTIFACT_DIR}/resp3-status.txt"
if [[ "$status" != "409" ]]; then
  echo "FAIL: expected 409, got ${status}"
  cat "${ARTIFACT_DIR}/resp3-conflict.json"
  echo "Artifacts: ${ARTIFACT_DIR}"
  exit 1
fi

echo "PASS: idempotency replay/conflict contract holds"
echo "Artifacts: ${ARTIFACT_DIR}"

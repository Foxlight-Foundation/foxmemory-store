#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8082}"
RUN_ID="${RUN_ID:-smoke-idem-$(date +%s)}"
KEY="${KEY:-idem-smoke-$(date +%s)}"

payload1=$(cat <<JSON
{"text":"idempotency smoke marker $(date +%s)","run_id":"$RUN_ID","idempotency_key":"$KEY"}
JSON
)

payload2=$(cat <<JSON
{"text":"idempotency payload mismatch $(date +%s)","run_id":"$RUN_ID","idempotency_key":"$KEY"}
JSON
)

echo "[1/3] First write (expect 200)"
status1=$(curl -sS -o /tmp/idem-1.json -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" \
  -d "$payload1" \
  "$BASE_URL/v2/memory.write")

if [[ "$status1" != "200" ]]; then
  echo "FAIL: first request status=$status1"
  cat /tmp/idem-1.json
  exit 1
fi

echo "[2/3] Replay same key + same payload (expect 200 replay)"
status2=$(curl -sS -o /tmp/idem-2.json -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" \
  -d "$payload1" \
  "$BASE_URL/v2/memory.write")

if [[ "$status2" != "200" ]]; then
  echo "FAIL: replay request status=$status2"
  cat /tmp/idem-2.json
  exit 1
fi

echo "[3/3] Reuse key + different payload (expect 409)"
status3=$(curl -sS -o /tmp/idem-3.json -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" \
  -d "$payload2" \
  "$BASE_URL/v2/memory.write")

if [[ "$status3" != "409" ]]; then
  echo "FAIL: conflict request status=$status3 (expected 409)"
  cat /tmp/idem-3.json
  exit 1
fi

echo "PASS: v2 idempotency replay/conflict behavior looks correct"

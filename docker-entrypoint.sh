#!/usr/bin/env sh
set -eu

QDRANT_STORAGE_PATH="${QDRANT_STORAGE_PATH:-/qdrant/storage}"
QDRANT_HTTP_PORT="${QDRANT_HTTP_PORT:-6333}"

mkdir -p "$QDRANT_STORAGE_PATH"

# Start embedded Qdrant in background
/qdrant/qdrant --storage-dir "$QDRANT_STORAGE_PATH" --service-http-port "$QDRANT_HTTP_PORT" > /tmp/qdrant.log 2>&1 &
QDRANT_PID=$!

# Start API service in foreground
node dist/index.js

# If node exits, clean up qdrant
kill "$QDRANT_PID" 2>/dev/null || true
wait "$QDRANT_PID" 2>/dev/null || true

# foxmemory-store

Node.js + TypeScript Mem0 OSS REST API service.

## Purpose
Self-hosted memory API layer for FoxMemory. Designed to run with either:
- local `foxmemory-infer` (OpenAI-compatible endpoints), or
- any external OpenAI-compatible inference provider.

## Runtime
- Node.js 22+
- TypeScript
- Mem0 OSS (`mem0ai/oss`)

## Endpoints
- `GET /health`
- `POST /v1/memories`
- `POST /v1/memories/search`
- `GET /v1/memories/:id`
- `GET /v1/memories?user_id=...&run_id=...`
- `DELETE /v1/memories/:id`

Back-compat aliases:
- `POST /memory.write`
- `POST /memory.search`

## Inference provider contract (OpenAI-compatible)
- `OPENAI_BASE_URL` (example local infer: `http://foxmemory-infer:8081/v1`)
- `OPENAI_API_KEY` (optional depending on provider)
- `MEM0_LLM_MODEL` (default `gpt-4.1-nano`)
- `MEM0_EMBED_MODEL` (default `text-embedding-3-small`)

## Vector/history config
- `QDRANT_HOST` / `QDRANT_PORT` / `QDRANT_API_KEY` / `QDRANT_COLLECTION`
- `MEM0_HISTORY_DB_PATH` (default `/tmp/history.db`)

## Embedded Qdrant mode
This image bundles Qdrant and starts it automatically inside the same container.

Default behavior:
- Qdrant listens on `127.0.0.1:6333` inside the container
- Store API listens on `0.0.0.0:8082`

Useful env vars:
- `QDRANT_STORAGE_PATH` (default `/qdrant/storage`)
- `QDRANT_HTTP_PORT` (default `6333`)

## Local run
```bash
npm install
npm run dev
```

## Build + start
```bash
npm run build
npm start
```

# foxmemory-store

Node.js + TypeScript Mem0 OSS REST API service.

## Purpose
This service is the self-hosted memory API layer for FoxMemory, aligned with Mem0-style memory operations.

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

## Env vars
- `PORT` (default `8082`)
- `OPENAI_API_KEY` (optional)
- `MEM0_LLM_MODEL` (optional)
- `MEM0_EMBED_MODEL` (optional)
- `QDRANT_HOST` / `QDRANT_PORT` / `QDRANT_API_KEY` / `QDRANT_COLLECTION` (optional)
- `MEM0_HISTORY_DB_PATH` (optional)


## Embedded Qdrant mode
This image now bundles Qdrant and starts it automatically inside the same container.

Default behavior:
- Qdrant listens on `127.0.0.1:6333` inside the container
- Store API listens on `0.0.0.0:8082`

Useful env vars:
- `QDRANT_STORAGE_PATH` (default `/qdrant/storage`)
- `QDRANT_HTTP_PORT` (default `6333`)

Note: bundling both processes in one container is convenient for single-node deployments, but split services are still recommended for production scale and isolation.

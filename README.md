# foxmemory-store

Beginner-friendly memory API service for self-hosted AI apps.

`foxmemory-store` is the "memory brain" API in the FoxMemory stack. It wraps Mem0 OSS and exposes simple REST endpoints for writing and searching memories.

## Why this exists

Most AI apps are stateless by default. This service adds long-term memory so your assistants can remember useful facts across conversations.

## What it does

- Accepts memory writes (messages, metadata, user IDs)
- Supports semantic search over prior memories
- Provides read/delete endpoints
- Uses Mem0 OSS under the hood
- Can point to local inference (`foxmemory-infer`) or external OpenAI-compatible inference

## Architecture in plain English

1. Your app sends a memory write/search request to `foxmemory-store`
2. `foxmemory-store` asks an LLM/embedder provider for processing
3. Embeddings + memory records are stored in Qdrant
4. Search returns relevant memory snippets

See also: `docs/ARCHITECTURE.md` and `docs/API_CONTRACT.md`.

---

## Requirements

- Node.js 22+
- npm 10+
- A vector store (Qdrant)
- An OpenAI-compatible inference API (local or hosted)

## Quick start (local dev)

```bash
npm install
npm run dev
```

Default port: `8082`

Health check:

```bash
curl -s http://localhost:8082/health | jq .
```

---

## Environment variables

### Inference provider (OpenAI-compatible)

- `OPENAI_BASE_URL` — e.g. `http://localhost:8081/v1`
- `OPENAI_API_KEY` — required by many providers
- `MEM0_LLM_MODEL` — default `gpt-4.1-nano`
- `MEM0_EMBED_MODEL` — default `text-embedding-3-small`

### Vector store (Qdrant)

- `QDRANT_HOST`
- `QDRANT_PORT` (default `6333`)
- `QDRANT_API_KEY` (optional)
- `QDRANT_COLLECTION` (default `foxmemory`)

### Local history DB

- `MEM0_HISTORY_DB_PATH` (default `/tmp/history.db`)

---

## API endpoints

- `GET /health`
- `POST /v1/memories`
- `POST /v1/memories/search`
- `GET /v1/memories/:id`
- `GET /v1/memories?user_id=...&run_id=...`
- `DELETE /v1/memories/:id`

Back-compat aliases:

- `POST /memory.write`
- `POST /memory.search`

Detailed request/response examples: `docs/API_CONTRACT.md`

---

## Basic usage examples

### Write memory

```bash
curl -s -X POST http://localhost:8082/v1/memories \
  -H 'content-type: application/json' \
  -d '{
    "user_id":"demo",
    "messages":[{"role":"user","content":"I prefer concise answers."}]
  }'
```

### Search memory

```bash
curl -s -X POST http://localhost:8082/v1/memories/search \
  -H 'content-type: application/json' \
  -d '{"user_id":"demo","query":"response style","top_k":5}'
```

---

## Docker notes

This repo includes an image that can run an embedded Qdrant process in the same container.

If startup issues occur, check:

1. Qdrant reachability (`QDRANT_HOST/QDRANT_PORT`)
2. Inference API URL correctness (`OPENAI_BASE_URL`)
3. API key wiring (`OPENAI_API_KEY`)
4. Writable history DB path (`MEM0_HISTORY_DB_PATH`)

---

## Build and run (production-ish)

```bash
npm run build
npm start
```

## License

MIT (see `LICENSE`)

# foxmemory-store

Beginner-friendly memory API service for self-hosted AI apps.

`foxmemory-store` is the "memory brain" API in the FoxMemory stack. It wraps Mem0 OSS and exposes simple REST endpoints for writing and searching memories.

## Why this exists

Most AI apps are stateless by default. This service adds long-term memory so your assistants can remember useful facts across conversations.

## What it does

- Accepts memory writes (messages, metadata, user IDs) — infer-first with deterministic fallback
- Supports semantic search over prior memories
- Optional **graph memory** (Neo4j) — automatically extracts entities and relations on every write; surfaces them on search
- Full **analytics DB** (SQLite) — persists write/search/graph event history across restarts; powers the `/v2/stats/memories` dashboard endpoint
- **Decision observability** — every write response includes the LLM's reasoning (`decisions.actions[].reason`), extracted facts, and candidate memories; stored to SQLite; queryable via `GET /v2/write-events`
- Runtime-configurable LLM prompts (Call 1, 2, and graph extraction) — persisted and survives restarts
- Provides read, update, delete, and batch-delete endpoints
- Uses Mem0 OSS under the hood (`@foxlight-foundation/mem0ai` fork)
- Can point to local inference (`foxmemory-infer`) or external OpenAI-compatible inference

## Architecture in plain English

1. Your app sends a memory write/search request to `foxmemory-store`
2. `foxmemory-store` asks an LLM/embedder provider for processing
3. Embeddings + memory records are stored in Qdrant
4. Search returns relevant memory snippets

See also: `docs/ARCHITECTURE.md` and `docs/API_CONTRACT.md` (full exhaustive endpoint contract).

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

### Analytics DB

- `FOXMEMORY_ANALYTICS_DB_PATH` — default `/data/foxmemory-analytics.db`. **Must be on a mounted volume** or stats reset on restart. Override to any persistent path on your host (e.g. `/qdrant/storage/foxmemory-analytics.db` if Qdrant storage is already mounted there).

### Graph memory (Neo4j — optional)

Leave unset to disable. When set, enables entity/relation extraction on every write and graph search on every query.

- `NEO4J_URL` — e.g. `bolt://neo4j:7687`
- `NEO4J_USERNAME` — default `neo4j`
- `NEO4J_PASSWORD`
- `MEM0_GRAPH_LLM_MODEL` — default `gpt-4.1-mini`. Separate model for entity extraction; keeps main model fast.
- `MEM0_GRAPH_CUSTOM_PROMPT` — initial graph entity extraction prompt (also settable at runtime via `PUT /v2/config/graph-prompt`)
- `MEM0_GRAPH_SEARCH_THRESHOLD` — cosine similarity for candidate retrieval (default `0.7`)
- `MEM0_GRAPH_NODE_DEDUP_THRESHOLD` — cosine similarity for node deduplication (default `0.9`)
- `MEM0_GRAPH_BM25_TOPK` — BM25 reranking top-K in graph search (default `5`)

### Local history DB (ephemeral)

- `MEM0_HISTORY_DB_PATH` — default `/tmp/history.db` (Mem0-internal, not analytics)

---

## API endpoints

Health & observability:

- `GET /health`, `GET /health.version`
- `GET /v2/health` — same but normalized envelope + **live Neo4j connectivity check**
- `GET /v2/stats` — runtime counters
- `GET /v2/stats/memories` — SQLite analytics (byDay charts, NONE rate, search quality, graph stats)
- `GET /v2/write-events` — queryable write event log with per-decision reasons (debug DELETE/UPDATE behavior)
- `GET /v2/openapi.json` — machine-readable OpenAPI 3.0 spec
- `GET /v2/docs` — interactive Redoc UI (renders the OpenAPI spec; good for humans)
- `GET /v2/docs.md` — full API contract as Markdown (agent-friendly; fetch this to understand all endpoints)

Primary (v2):

- `POST /v2/memories` — write (infer-first with deterministic fallback; returns `decisions`, `relations[]`, `added_entities[]` when graph enabled)
- `POST /v2/memories/search` — semantic search (returns `relations[]` when graph enabled)
- `POST /v2/memories/forget` — batch delete up to 1000 memories by ID
- `GET /v2/memories` — list
- `POST /v2/memories/list` — list (body-based, supports OR filters)
- `GET /v2/memories/:id`
- `PUT /v2/memories/:id`
- `DELETE /v2/memories/:id`
- `GET /v2/graph/relations` — browse raw Neo4j triples for a user/session _(graph-enabled only)_

Config:

- `GET/PUT /v2/config/prompt` — Call 1 (fact extraction) prompt
- `GET/PUT /v2/config/update-prompt` — Call 2 (ADD/UPDATE/DELETE/NONE) prompt
- `GET/PUT /v2/config/graph-prompt` — graph entity extraction prompt _(graph-enabled only)_

Compatibility (v1 — frozen):

- `POST /v1/memories`, `POST /v1/memories/search`
- `GET /v1/memories/:id`, `GET /v1/memories`, `DELETE /v1/memories/:id`

Back-compat aliases:

- `POST /memory.write`, `POST /memory.search`, `POST /memory.raw_write`

Detailed request/response contract: `docs/API_CONTRACT.md`

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

This repo includes an image that bundles an embedded Qdrant binary (tech debt — separate container planned). Multi-stage build: build tools (`python3/make/g++`) are stripped from the runtime image.

If startup issues occur, check:

1. Qdrant reachability (`QDRANT_HOST/QDRANT_PORT`)
2. Inference API URL correctness (`OPENAI_BASE_URL`)
3. API key wiring (`OPENAI_API_KEY`)
4. Analytics DB path on a mounted volume (`FOXMEMORY_ANALYTICS_DB_PATH`)
5. Neo4j bolt URL and password (`NEO4J_URL`, `NEO4J_PASSWORD`) — `GET /v2/health` shows `neo4jConnected`

---

## Build and run (production-ish)

```bash
npm run build
npm start
```

## License

MIT (see `LICENSE`)

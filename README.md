# foxmemory-store

Long-term memory API for self-hosted AI applications.

`foxmemory-store` is the memory persistence layer in the FoxMemory stack. It wraps Mem0 OSS and exposes REST endpoints for writing, searching, and managing memories — with optional graph memory (Neo4j) for entity/relation extraction.

## What it does

- **Memory writes** — sends messages to an LLM, extracts facts worth remembering, stores them as vector embeddings in Qdrant
- **Semantic search** — find relevant memories by query; returns ranked results and (optionally) related graph entities
- **Graph memory** (optional) — on every write, extracts named entities and relations into Neo4j; surfaces them on search
- **Analytics DB** — persists every write/search/graph event to SQLite; powers the `/v2/stats/memories` dashboard endpoint
- **Decision observability** — every write response includes the LLM's per-decision reasoning, extracted facts, and candidates; persisted and queryable via `GET /v2/write-events`
- **Runtime config** — LLM prompts (extraction, update, graph) and active models are runtime-configurable via API and survive restarts
- **Cascade delete** — opt-in graph cleanup on memory delete: orphaned Neo4j nodes/edges are removed when no other memories back them

---

## Requirements

- **Docker** (recommended) — or Node.js 22+ for local dev
- **OpenAI-compatible inference** — hosted OpenAI, local Ollama, or [foxmemory-infer](../foxmemory-infer)
- **Qdrant** — the Docker image bundles an embedded Qdrant binary (simplest path); a separate container is also supported

---

## Getting started

### Option A — Docker with hosted OpenAI (simplest)

The Docker image bundles an embedded Qdrant binary, so this is the fastest way to a working setup.

**1. Pull the image**

```bash
docker pull foxlightfoundation/foxmemory-store:latest
```

**2. Run it**

```bash
docker run -d \
  --name foxmemory-store \
  -p 8082:8082 \
  -p 6333:6333 \
  -v foxmemory_data:/qdrant/storage \
  -e OPENAI_API_KEY=sk-... \
  -e OPENAI_BASE_URL=https://api.openai.com/v1 \
  -e MEM0_LLM_MODEL=gpt-4.1-nano \
  -e MEM0_EMBED_MODEL=text-embedding-3-small \
  -e QDRANT_HOST=127.0.0.1 \
  -e FOXMEMORY_ANALYTICS_DB_PATH=/qdrant/storage/foxmemory-analytics.db \
  foxlightfoundation/foxmemory-store:latest
```

**3. Verify**

```bash
curl -s http://localhost:8082/v2/health | jq .
```

You should see `"ok": true` with `qdrantConnected: true`.

---

### Option B — Docker Compose (recommended for production)

See the [foxmemory-deploy](../foxmemory-deploy) repo for full Compose recipes:

- `compose.one.yml` — embedded Qdrant + Neo4j + foxmemory-infer, all in one stack
- `compose.split.yml` — services split across hosts
- `compose.external.yml` — external Qdrant container

Copy the relevant compose file and a `.env` from `.env.example`:

```bash
cp .env.example .env
# edit .env with your values
docker compose -f path/to/compose.one.yml up -d
```

---

### Option C — Local dev

**1. Install Node.js 22+**

```bash
node --version   # must be 22+
```

**2. Install dependencies**

> **Note:** This repo depends on `@foxlight-foundation/mem0ai`, a private package published to GitHub Packages. You need a GitHub personal access token (PAT) with `read:packages` scope. Set it in your environment before installing:
>
> ```bash
> export NPM_TOKEN=ghp_your_token_here
> ```
>
> The `.npmrc` in the project root is pre-configured to use it.

```bash
npm install
```

**3. Configure environment**

```bash
cp .env.example .env
```

Edit `.env` — minimum required values:

```env
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
QDRANT_HOST=localhost        # assumes Qdrant running locally on port 6333
```

**4. Start Qdrant** (if not using the embedded image)

```bash
docker run -d -p 6333:6333 qdrant/qdrant
```

**5. Start the server**

```bash
npm run dev
```

Default port: `8082`

**6. Verify**

```bash
curl -s http://localhost:8082/v2/health | jq .
```

---

## Enabling graph memory (Neo4j)

Graph memory is **disabled by default**. When enabled, every write runs two extra LLM calls to extract entities and relations, which are stored in Neo4j and surfaced on search.

**Add to your `.env`:**

```env
NEO4J_URL=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=changeme
MEM0_GRAPH_LLM_MODEL=gpt-4.1-mini
```

**Start Neo4j:**

```bash
docker run -d \
  --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/changeme \
  neo4j:5-community
```

Check connectivity after startup:

```bash
curl -s http://localhost:8082/v2/health | jq .diagnostics.neo4jConnected
```

---

## Environment variables

### Inference provider

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible endpoint |
| `OPENAI_API_KEY` | `local-infer-no-key` | API key for the inference provider |
| `MEM0_LLM_MODEL` | `gpt-4.1-nano` | Model for fact extraction and update decisions |
| `MEM0_EMBED_MODEL` | `text-embedding-3-small` | Embedding model — **cannot change after collection is created** |

### Vector store (Qdrant)

| Variable | Default | Description |
|----------|---------|-------------|
| `QDRANT_HOST` | _(required)_ | Qdrant hostname |
| `QDRANT_PORT` | `6333` | Qdrant port |
| `QDRANT_COLLECTION` | `foxmemory` | Collection name |
| `QDRANT_API_KEY` | _(none)_ | Optional, if Qdrant requires auth |

### Analytics DB

| Variable | Default | Description |
|----------|---------|-------------|
| `FOXMEMORY_ANALYTICS_DB_PATH` | `/data/foxmemory-analytics.db` | SQLite path — **must be on a mounted volume** or resets on restart |

### Graph memory (Neo4j — optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `NEO4J_URL` | _(unset = disabled)_ | Bolt URL, e.g. `bolt://neo4j:7687` |
| `NEO4J_USERNAME` | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | _(required if URL set)_ | Neo4j password |
| `MEM0_GRAPH_LLM_MODEL` | `gpt-4.1-mini` | Separate model for entity extraction |
| `MEM0_GRAPH_CUSTOM_PROMPT` | _(none)_ | Initial graph extraction prompt (also settable at runtime) |
| `MEM0_GRAPH_SEARCH_THRESHOLD` | `0.7` | Cosine similarity threshold for graph candidate retrieval |
| `MEM0_GRAPH_NODE_DEDUP_THRESHOLD` | `0.9` | Cosine similarity threshold for node deduplication |
| `MEM0_GRAPH_BM25_TOPK` | `5` | BM25 reranking top-K in graph search |

### Retry / misc

| Variable | Default | Description |
|----------|---------|-------------|
| `MEM0_ADD_RETRIES` | `3` | Retry attempts for `memory.add()` |
| `MEM0_ADD_RETRY_DELAY_MS` | `250` | Delay between retries (ms) |
| `MEM0_HISTORY_DB_PATH` | `/tmp/history.db` | Mem0-internal dedup state — ephemeral, not needed for analytics |

---

## API overview

Full request/response contract: `docs/API_CONTRACT.md` or `GET /v2/docs.md` from a running instance.

### Health & observability

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Service metadata (flat) |
| `GET /v2/health` | Same, normalized envelope + live Neo4j connectivity check |
| `GET /v2/stats` | Runtime counters |
| `GET /v2/stats/memories` | SQLite analytics — write NONE rate, search quality, graph stats, byDay charts |
| `GET /v2/write-events` | Queryable write event log with per-decision LLM reasons |
| `GET /v2/openapi.json` | Machine-readable OpenAPI 3.0 spec |
| `GET /v2/docs` | Interactive Redoc UI |
| `GET /v2/docs.md` | Full API contract as Markdown (agent-friendly) |

### Memory (v2 — primary)

| Endpoint | Description |
|----------|-------------|
| `POST /v2/memories` | Write memories (returns `decisions`, `relations[]`, `added_entities[]` when graph enabled) |
| `POST /v2/memories/search` | Semantic search (returns `relations[]` when graph enabled) |
| `POST /v2/memories/forget` | Batch delete up to 1000 memories by ID; accepts `cascade_graph: true` |
| `GET /v2/memories` | List memories by `user_id` / `run_id` |
| `POST /v2/memories/list` | List with OR filters (body-based) |
| `GET /v2/memories/:id` | Get single memory |
| `PUT /v2/memories/:id` | Update memory text |
| `DELETE /v2/memories/:id` | Delete memory; accepts `?cascade_graph=true` for graph cleanup |

### Graph (v2 — graph-enabled only)

| Endpoint | Description |
|----------|-------------|
| `GET /v2/graph` | Full node+edge graph for a user/session |
| `GET /v2/graph/relations` | Raw Neo4j triples for a user/session |
| `GET /v2/graph/node/:id` | Single node + its neighbors |

### Config

| Endpoint | Description |
|----------|-------------|
| `GET/PUT /v2/config/prompt` | Call 1 (fact extraction) prompt |
| `GET/PUT /v2/config/update-prompt` | Call 2 (ADD/UPDATE/DELETE/NONE) prompt |
| `GET/PUT /v2/config/graph-prompt` | Graph entity extraction prompt _(graph-enabled only)_ |
| `GET /v2/config/models` | Active LLM and embedding model overrides |
| `PUT /v2/config/models` | Override active LLM / graph LLM model at runtime |
| `GET /v2/config/catalog` | List all models in the model catalog |
| `POST /v2/config/catalog` | Add a model to the catalog |
| `GET /v2/config/catalog/:id` | Get catalog entry |
| `PUT /v2/config/catalog/:id` | Update catalog entry |
| `DELETE /v2/config/catalog/:id` | Remove from catalog |

### v1 (frozen — back-compat only)

- `POST /v1/memories`, `POST /v1/memories/search`
- `GET /v1/memories`, `GET /v1/memories/:id`, `DELETE /v1/memories/:id`
- Legacy aliases: `POST /memory.write`, `POST /memory.search`, `POST /memory.raw_write`

---

## Usage examples

### Write a memory

```bash
curl -s -X POST http://localhost:8082/v2/memories \
  -H 'content-type: application/json' \
  -d '{
    "user_id": "demo",
    "messages": [
      { "role": "user", "content": "I prefer concise answers." }
    ]
  }' | jq .
```

Response includes `decisions.actions[].reason` — the LLM's explanation for each ADD/UPDATE/DELETE/NONE decision.

### Search memories

```bash
curl -s -X POST http://localhost:8082/v2/memories/search \
  -H 'content-type: application/json' \
  -d '{
    "user_id": "demo",
    "query": "response style",
    "top_k": 5
  }' | jq .
```

### List all memories for a user

```bash
curl -s "http://localhost:8082/v2/memories?user_id=demo" | jq .
```

### Delete a memory (with graph cascade)

```bash
curl -s -X DELETE "http://localhost:8082/v2/memories/<id>?cascade_graph=true" | jq .
```

`graph_cascade` in the response reports how many orphaned Neo4j edges/nodes were removed. If the memory has no graph links recorded, cascade is a no-op regardless of the flag.

### Inspect write decision reasoning

```bash
curl -s "http://localhost:8082/v2/write-events?user_id=demo&limit=10" | jq '.data[] | {event, reason, memory}'
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| 500 on every write | Qdrant unreachable | Check `QDRANT_HOST`/`QDRANT_PORT`; confirm Qdrant is running |
| Auth errors on write | Bad inference API key or wrong `OPENAI_BASE_URL` | Check `OPENAI_API_KEY` and `OPENAI_BASE_URL` |
| `neo4jConnected: false` in health | Neo4j unreachable or wrong credentials | Check `NEO4J_URL` and `NEO4J_PASSWORD` |
| Analytics reset on restart | Analytics DB not on a volume | Mount a volume and set `FOXMEMORY_ANALYTICS_DB_PATH` to a path on it |
| High write latency (>10s) | All 4 LLM calls serialized | Expected when graph is enabled; use a fast model for `MEM0_GRAPH_LLM_MODEL` |
| NONE rate very high | Extraction prompt too aggressive or content not worth storing | Tune via `PUT /v2/config/prompt` |
| `npm install` fails with 401 | GitHub Packages auth not configured | Set `NPM_TOKEN` env var to a PAT with `read:packages` scope |

---

## Build

```bash
npm run build   # TypeScript → dist/
npm start       # run compiled output
```

---

## License

MIT (see `LICENSE`)

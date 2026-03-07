# foxmemory-store Architecture

## One sentence summary

`foxmemory-store` is a REST wrapper around Mem0 OSS that persists and retrieves AI memories, with optional graph memory (Neo4j) and a built-in analytics SQLite DB.

## Components

| Component | Role |
|-----------|------|
| **Express server** | HTTP API surface (v1 frozen, v2 active) |
| **Mem0 OSS SDK** (`@foxlight-foundation/mem0ai`) | Memory extraction (LLM Call 1 + 2), storage orchestration, retrieval |
| **Inference provider** | OpenAI-compatible endpoint for LLM + embeddings (local `foxmemory-infer` or hosted OpenAI) |
| **Qdrant** | Vector storage and semantic search |
| **Neo4j** _(optional)_ | Knowledge graph storage — entity/relation extraction (LLM Calls 3 + 4) on every write, graph search on every query |
| **FoxAnalyticsDB** | SQLite at `FOXMEMORY_ANALYTICS_DB_PATH` — persists write events, search events, graph events across restarts. Powers `/v2/stats/memories`. |
| **mem0 history DB** | SQLite at `MEM0_HISTORY_DB_PATH` — Mem0-internal state. Ephemeral (`/tmp/history.db`); not used for user analytics. |

## Request flow — write (v2, graph enabled)

```
Client  →  POST /v2/memories
           │
           ├─ Zod validation
           ├─ Idempotency check
           ├─ memory.add() [Mem0 OSS]
           │    ├─ LLM Call 1  (gpt-4.1-nano) — fact extraction → "what to remember"
           │    ├─ LLM Call 2  (gpt-4.1-nano) — ADD/UPDATE/DELETE/NONE decision
           │    ├─ Qdrant write — store embedding + memory text
           │    ├─ LLM Call 3  (gpt-4.1-mini) — graph entity extraction
           │    ├─ LLM Call 4  (gpt-4.1-mini) — graph delete decision
           │    └─ Neo4j write — upsert nodes + relations
           ├─ analyticsDb.recordWriteResults()  → write_events table
           ├─ analyticsDb.recordGraphWrite()    → graph_events table (when graph enabled)
           └─ Response: { ok, data: { mode, result, relations[] } }
```

When graph is disabled: LLM Calls 3+4 and Neo4j write are skipped. `relations` is omitted from the response.

## Request flow — search (v2, graph enabled)

```
Client  →  POST /v2/memories/search
           │
           ├─ Zod validation
           ├─ memory.search() [Mem0 OSS]
           │    ├─ LLM Call    (gpt-4.1-mini) — extract entities from query
           │    ├─ Qdrant      — cosine similarity search
           │    ├─ Neo4j       — graph traversal / BM25 rerank
           │    └─ Returns { results[], relations[] }
           ├─ analyticsDb.recordSearch()  → search_events table (graph_hit flag)
           └─ Response: { ok, data: { results[], relations[] } }
```

## API versioning

- **v1** (`/v1/memories`, `/v1/memories/search`, etc.) — frozen. No new semantics. Kept for back-compat.
- **v2** (`/v2/memories`, `/v2/memories/search`, etc.) — primary interface. Normalized `{ ok, data, meta }` envelope. All new features land here.
- **Legacy aliases** (`/memory.write`, `/memory.search`, `/memory.raw_write`) — back-compat only.

## LLM call budget (per write)

| Graph disabled | Graph enabled |
|----------------|---------------|
| 2 LLM calls (fact extraction + ADD/UPDATE/DELETE/NONE) | 4 LLM calls (+entity extraction + delete decision) |
| ~1–3 s latency | ~5–25 s latency (depends on provider) |

## Analytics DB schema

Tables in `FOXMEMORY_ANALYTICS_DB_PATH`:

- `write_events` — one row per mem0 result event (ADD/UPDATE/DELETE/NONE), plus `call_id` to group events from one `memory.add()` call.
- `search_events` — one row per search, includes `result_count`, `top_score`, `graph_hit`.
- `graph_events` — one row per graph write, includes `entities_added`, `relations_added`.
- `config` — key/value store for persisted runtime config (custom prompts).

**Must be on a mounted volume** — the default path `/data/foxmemory-analytics.db` requires a volume at `/data`. On R720 use `/qdrant/storage/foxmemory-analytics.db`.

## Design choices

- **v1 frozen** — plugin consumers depend on v1 shape; changes go to v2 only.
- **OpenAI-compatible abstraction** — swap local inference (`foxmemory-infer`) for hosted OpenAI without code changes.
- **Separate graph LLM** — `MEM0_GRAPH_LLM_MODEL` lets you use a more capable model (e.g. `gpt-4.1-mini`) for entity extraction without changing the main LLM used for fact extraction.
- **Analytics are self-contained** — no external analytics service; SQLite is enough for a homelab. The DB path should be on a persistent volume.
- **Graph is optional** — leave `NEO4J_URL` unset to disable. Zero overhead when disabled.

## Operational gotchas

- If Qdrant is unreachable, write/search fail with 500.
- If the inference endpoint is miswired, you see auth errors or timeouts on every write.
- If `FOXMEMORY_ANALYTICS_DB_PATH` is not on a mounted volume, analytics reset on container restart.
- If `NEO4J_URL` is set but Neo4j is unreachable, `memory.add()` throws and writes fail. Check `GET /v2/health` → `diagnostics.neo4jConnected`.
- High write latency (>10s) usually means all 4 LLM calls are serialized. Expected when graph is enabled.
- `MEM0_HISTORY_DB_PATH` is ephemeral (`/tmp`) by design — Mem0's internal dedup state, not needed for analytics.

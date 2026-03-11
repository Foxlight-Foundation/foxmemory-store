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
           ├─ analyticsDb.recordWriteResults()  → write_events table (with reason, extracted_facts, candidates)
           ├─ analyticsDb.recordGraphWrite()    → graph_events table (when graph enabled)
           └─ Response: { ok, data: { mode, result, decisions, relations[], added_entities[] } }
```

When graph is disabled: LLM Calls 3+4 and Neo4j write are skipped. `relations` and `added_entities` are omitted from the response.

`decisions` is always present and contains the full observability trace:
- `extractedFacts` — Call 1 output (facts worth remembering)
- `candidates` — existing memories retrieved from Qdrant for Call 2 comparison
- `actions` — per-decision list with `event`, affected memory UUID, and `reason`

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

- `write_events` — one row per mem0 result event (ADD/UPDATE/DELETE/NONE). Key columns: `call_id` (groups events from one `memory.add()` call), `reason` (LLM explanation for the decision), `extracted_facts_json` (Call 1 output), `candidates_json` (existing memories considered by Call 2).
- `search_events` — one row per search, includes `result_count`, `top_score`, `graph_hit`.
- `graph_events` — one row per graph write, includes `entities_added`, `relations_added`.
- `config` — key/value store for persisted runtime config (custom prompts).

**Must be on a mounted volume** — the default path `/data/foxmemory-analytics.db` requires a volume at `/data`. Override `FOXMEMORY_ANALYTICS_DB_PATH` to point at a persistent volume path on your host (e.g. `/qdrant/storage/foxmemory-analytics.db` if Qdrant storage is already mounted there).

## Design choices

- **v1 frozen** — plugin consumers depend on v1 shape; changes go to v2 only.
- **OpenAI-compatible abstraction** — swap local inference (`foxmemory-infer`) for hosted OpenAI without code changes.
- **Separate graph LLM** — `MEM0_GRAPH_LLM_MODEL` lets you use a more capable model (e.g. `gpt-4.1-mini`) for entity extraction without changing the main LLM used for fact extraction.
- **Graph tuning env vars** — `MEM0_GRAPH_SEARCH_THRESHOLD` (0.7), `MEM0_GRAPH_NODE_DEDUP_THRESHOLD` (0.9), `MEM0_GRAPH_BM25_TOPK` (5) allow adjusting graph search precision and entity deduplication sensitivity without code changes.
- **Decision observability** — every write response includes `decisions` (extractedFacts, candidates, actions with reasons). Write events are persisted to SQLite with per-row `reason`, queryable via `GET /v2/write-events`. Primary debugging tool for unexpected DELETE/UPDATE behavior.
- **Analytics are self-contained** — no external analytics service; SQLite is enough for a homelab. The DB path should be on a persistent volume.
- **Graph is optional** — leave `NEO4J_URL` unset to disable. Zero overhead when disabled.
- **Write gate (pre-flight filter)** — regex/length check runs before any LLM call. Drops obvious low-value writes (heartbeats, protocol signals, very short messages) at zero cost. Configurable via `MEM0_MIN_INPUT_CHARS` and `MEM0_SKIP_PATTERNS`. This is a blunt instrument — see "Future: write routing" below.

## Future: write routing

The write gate is intentionally dumb — regex and length only. It catches the obvious cases (heartbeat signals, system tokens) but cannot reason about semantic value.

The right long-term answer is a **lightweight write router**: a model small enough to run in single-digit milliseconds on local hardware that classifies incoming content as worth processing vs. not, before the full 4-LLM pipeline runs.

Candidates worth evaluating when local inference is available:
- **Embedding cosine distance to a "junk" centroid** — build a small labeled set of low-value writes, compute their centroid, reject anything within N distance. ~1ms, no model load.
- **Tiny classification model** (e.g. `smollm2:135m`, `phi-3-mini`, `qwen2.5:0.5b`) — binary classifier prompt: "Is this worth remembering long-term? yes/no". At ~135M params these run in <100ms on an M4.
- **Heuristic scoring** — token count, information density (unique nouns/verbs ratio), presence of named entities — no model at all, but better than regex.

The write gate's `shouldSkipWrite()` function is the extension point. When a router is ready, it replaces or augments that function.

## Operational gotchas

- If Qdrant is unreachable, write/search fail with 500.
- If the inference endpoint is miswired, you see auth errors or timeouts on every write.
- If `FOXMEMORY_ANALYTICS_DB_PATH` is not on a mounted volume, analytics reset on container restart.
- If `NEO4J_URL` is set but Neo4j is unreachable, `memory.add()` throws and writes fail. Check `GET /v2/health` → `diagnostics.neo4jConnected`.
- High write latency (>10s) usually means all 4 LLM calls are serialized. Expected when graph is enabled.
- `MEM0_HISTORY_DB_PATH` is ephemeral (`/tmp`) by design — Mem0's internal dedup state, not needed for analytics.

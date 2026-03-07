# API Contract (Exhaustive)

This document is the canonical HTTP contract for `foxmemory-store`.

- Service default port: `8082`
- Example base URLs:
  - local: `http://localhost:8082`
  - R720 LAN: `http://192.168.0.118:8082`

## Conventions

- All JSON requests require `Content-Type: application/json` unless noted.
- IDs are UUID-like strings.
- Scope keys:
  - `user_id` = long-term scope
  - `run_id` = session scope
- Most v2 success responses use envelope:
  - `{ "ok": true, "data": ... }`
- v2 errors use RFC 9457-style problem payload:
  - `type`, `title`, `status`, `detail` (+ optional `errors`)

---

## 1) Health & Runtime

### `GET /health`

Returns service wiring and diagnostics.

Example:

```json
{
  "ok": true,
  "service": "foxmemory-store",
  "runtime": "node-ts",
  "version": "unknown",
  "build": {
    "commit": "unknown",
    "imageDigest": "unknown",
    "time": "unknown"
  },
  "mem0": "oss",
  "llmModel": "gpt-4.1-nano",
  "embedModel": "text-embedding-3-small",
  "diagnostics": {
    "authMode": "api_key",
    "openaiApiKeyConfigured": true,
    "openaiBaseUrl": "https://api.openai.com/v1"
  }
}
```

### `GET /health.version`

Returns lightweight version/build metadata.

### `GET /stats`

Runtime counters for request/event observability.

Fields:
- `writesByMode` → `infer`, `raw`
- `memoryEvents` → `ADD`, `UPDATE`, `DELETE`, `NONE`
- `requests` → `add`, `search`, `list`, `get`, `delete`, `update`

### `GET /health.version`

Lightweight version/build metadata only (no envelope).

### `GET /v2/health`

Same as `GET /health` but wrapped in normalized envelope:

```json
{ "ok": true, "data": { "service": "foxmemory-store", ... }, "meta": { "version": "v2" } }
```

### `GET /v2/stats`

Same as `GET /stats` but wrapped in normalized envelope:

```json
{ "ok": true, "data": { "startedAt": "...", "uptimeSec": 3600, "writesByMode": {...}, ... }, "meta": { "version": "v2" } }
```

---

## 2) V2 API (Primary)

## 2.1 Write (Infer-first with deterministic fallback)

### `POST /v2/memory.write`
### `POST /v2/memories`

Both endpoints share the same write contract.

Request body:

```json
{
  "text": "I prefer concise answers.",
  "messages": [{ "role": "user", "content": "optional alternate input" }],
  "user_id": "user-123",
  "run_id": "run-456",
  "metadata": { "source": "chat" },
  "infer_preferred": true,
  "fallback_raw": true,
  "idempotency_key": "optional-stable-key"
}
```

Validation:
- One of `user_id` or `run_id` is required.
- One of `text` or non-empty `messages` is required.

Write behavior:
- `infer_preferred=true` (default): try extractive/infer path first.
- If infer yields no results and `fallback_raw=true` (default), write deterministic raw memory (`infer:false`).

Success response:

```json
{
  "ok": true,
  "data": {
    "mode": "inferred | fallback_raw | none",
    "attempts": 3,
    "infer": { "resultCount": 1 },
    "fallback": { "resultCount": 0 },
    "result": { "results": [] },
    "decisions": {
      "extractedFacts": ["User prefers concise answers"],
      "candidates": [
        { "id": "uuid-of-existing-memory", "text": "User likes detailed explanations" }
      ],
      "actions": [
        {
          "event": "DELETE",
          "id": "uuid-of-existing-memory",
          "text": "User likes detailed explanations",
          "reason": "Contradicted by new fact: user prefers concise answers"
        },
        {
          "event": "ADD",
          "id": "uuid-of-new-memory",
          "text": "User prefers concise answers",
          "reason": "New fact not previously stored"
        }
      ]
    },
    "relations": [{ "source": "thomas", "relationship": "prefers", "destination": "concise_answers" }],
    "added_entities": []
  }
}
```

- `decisions` — always present. Shows the full reasoning trace for this write call:
  - `extractedFacts` — output of Call 1 (what the LLM thought was worth remembering from the input)
  - `candidates` — existing memories retrieved from Qdrant for comparison
  - `actions` — Call 2 decision list with `reason` per entry (explains why each memory was ADD/UPDATE/DELETE/NONE)
- `relations` is only present when graph memory is enabled. Contains graph triples added/identified by this write call.
- `added_entities` — graph entities upserted (only when graph enabled).
- When graph is disabled, `relations` and `added_entities` are omitted entirely.

Idempotency:
- Key sources:
  - `Idempotency-Key` header, or
  - `idempotency_key` in body
- Same key + same payload: replay first response.
- Same key + different payload: `409 IDEMPOTENCY_CONFLICT`.
- TTL configurable by `IDEMPOTENCY_TTL_MS` (default 24h, min 60s).

## 2.2 Search

### `POST /v2/memories/search`

Request:

```json
{
  "query": "response style",
  "scope": "session | long-term | all",
  "user_id": "user-123",
  "run_id": "run-456",
  "filters": {},
  "top_k": 5,
  "threshold": 0.5,
  "keyword_search": false,
  "reranking": false,
  "rerank": false,
  "fields": ["memory"],
  "source": "chat"
}
```

Rules:
- Requires at least one of `user_id`, `run_id`, `filters`, unless `scope=all`.
- `scope=all` with both `user_id` and `run_id` merges both lanes and de-dupes.

Success:

```json
{
  "ok": true,
  "data": {
    "results": [],
    "relations": [{ "source": "thomas", "relationship": "prefers", "destination": "concise_answers" }]
  },
  "meta": { "scope": "direct", "count": 0 }
}
```

- `relations` is only present when graph memory is enabled (`NEO4J_URL` configured). Each entry is a `{ source, relationship, destination }` triple.
- Each search is recorded to the analytics DB. `graph_hit` is set to `true` when `relations.length > 0`, powering `searches.graphHitRatePct` in `/v2/stats/memories`.

## 2.3 List

### `GET /v2/memories`

Query params:
- `scope=session|long-term|all`
- `user_id`, `run_id`
- `page`, `page_size` (max 500)

### `POST /v2/memories/list`

Body mirrors list fields and supports `filters` with OR pairs.

Both return:

```json
{
  "ok": true,
  "data": [],
  "meta": { "scope": "direct", "count": 0 }
}
```

## 2.4 Get

### `GET /v2/memories/:id`

Success:

```json
{ "ok": true, "data": { "id": "...", "memory": "..." } }
```

## 2.5 Update

### `PUT /v2/memories/:id`

Request body:

```json
{
  "text": "updated memory text",
  "metadata": { "source": "manual" },
  "idempotency_key": "optional-stable-key"
}
```

Success:

```json
{
  "ok": true,
  "data": {
    "id": "...",
    "memory": "updated memory text"
  }
}
```

## 2.6 Delete

### `DELETE /v2/memories/:id`

Success:

```json
{
  "ok": true,
  "data": {
    "id": "...",
    "deleted": true
  }
}
```

## 2.7 Batch Delete (Forget)

### `POST /v2/memories/forget`

Delete multiple memories in one call. Server-side loop over mem0 `delete()` — reduces client N+1 to a single HTTP request.

Request body:

```json
{
  "memory_ids": ["uuid-1", "uuid-2", "uuid-3"],
  "idempotency_key": "optional-stable-key"
}
```

Validation:
- `memory_ids`: required, array of UUIDs, min 1, max 1000.

Success:

```json
{
  "ok": true,
  "data": {
    "deleted": ["uuid-1", "uuid-2"],
    "count": 2
  },
  "meta": { "version": "v2" }
}
```

Notes:
- Idempotency supported (same key replays first response).
- Each ID is deleted sequentially to avoid overwhelming Qdrant.
- IDs that do not exist are silently skipped by mem0.

## 2.8 Memory Stats (Dashboard)

### `GET /v2/stats/memories?days=30`

Rich analytics from the foxmemory-store SQLite analytics DB. Designed for dashboard bar charts, activity feeds, and search quality monitoring.

Query params:
- `days` (default: 30, max: 365) — lookback window for `byDay`, `searches.byDay`, and `recentActivity`.

Success:

```json
{
  "ok": true,
  "data": {
    "summary": {
      "totalCalls": 142,
      "byEvent": { "ADD": 98, "UPDATE": 44, "DELETE": 4, "NONE": 12 },
      "noneRatePct": 8,
      "writeLatency": { "avgMs": 1240, "minMs": 800, "maxMs": 4200 },
      "model": { "llm": "gpt-4.1-nano", "embed": "text-embedding-3-small" }
    },
    "byDay": [
      { "date": "2026-03-01", "ADD": 5, "UPDATE": 2, "DELETE": 0, "NONE": 1, "avgLatencyMs": 1100 }
    ],
    "recentActivity": [
      {
        "ts": "2026-03-05T12:00:00.000Z",
        "event": "ADD",
        "memoryId": "memory-uuid",
        "userId": "user-123",
        "runId": null,
        "preview": "User prefers concise answers.",
        "latencyMs": 1050,
        "inferMode": true
      }
    ],
    "searches": {
      "total": 88,
      "zeroResultRatePct": 3,
      "graphHitRatePct": 41,
      "avgResults": 4.2,
      "avgTopScore": 0.871,
      "avgLatencyMs": 95,
      "byDay": [
        { "date": "2026-03-01", "count": 12, "zeroResults": 1, "avgLatencyMs": 88 }
      ]
    },
    "graph": {
      "enabled": true,
      "totalWrites": 130,
      "totalRelations": 312,
      "totalEntities": 198,
      "avgWriteLatencyMs": 780
    }
  },
  "meta": { "version": "v2", "days": 30 }
}
```

**Field notes:**
- `summary.totalCalls` — distinct `memory.add()` calls (rows with `call_id`; pre-migration rows not counted).
- `summary.noneRatePct` — % of write *calls* (not rows) where mem0 decided nothing was worth storing. High values (>20%) suggest the extraction prompt needs tuning.
- `searches.zeroResultRatePct` — % of searches returning 0 vector results. Spikes indicate embedding drift or an empty collection.
- `searches.graphHitRatePct` — % of searches that returned graph relations. Only meaningful when `graph.enabled = true`.
- `graph` — always present; `totalRelations/totalEntities/totalWrites` are 0 when graph is disabled.

Dashboard mapping:
- `byDay` → write event bar chart (ADD/UPDATE/DELETE/NONE stacked, x-axis = date)
- `searches.byDay` → search volume + zero-result overlay chart
- `summary.byEvent` → totals card
- `summary.noneRatePct` → prompt quality indicator
- `searches.zeroResultRatePct` → search health indicator
- `graph.totalRelations` → graph size widget (show only when `graph.enabled`)
- `recentActivity` → activity feed / audit log

## 2.9 Write Events Log (Decision Debugger)

### `GET /v2/write-events`

Queryable log of all write events stored in the analytics DB. Primary tool for understanding why a specific ADD/UPDATE/DELETE/NONE decision was made.

Query params (all optional):
- `user_id`, `run_id` — filter by scope
- `memory_id` — filter to events touching a specific memory UUID
- `event_type` — one of `ADD`, `UPDATE`, `DELETE`, `NONE`
- `limit` — default 50, max 500
- `before` — ISO timestamp; return events before this time

Success:

```json
{
  "ok": true,
  "data": {
    "events": [
      {
        "id": "row-uuid",
        "ts": "2026-03-07T10:00:00.000Z",
        "event_type": "DELETE",
        "memory_id": "uuid-of-deleted-memory",
        "user_id": "user-123",
        "run_id": null,
        "memory_text": "User likes detailed explanations",
        "reason": "Contradicted by new fact: user prefers concise answers",
        "extracted_facts": ["User prefers concise answers"],
        "candidates": [
          { "id": "uuid-of-deleted-memory", "text": "User likes detailed explanations" }
        ],
        "call_id": "call-group-uuid",
        "latency_ms": 1840,
        "infer_mode": true
      }
    ],
    "count": 1
  },
  "meta": { "version": "v2" }
}
```

**Field notes:**
- `reason` — the LLM's one-line explanation for why it chose this event. `null` for rows written before this feature was deployed.
- `extracted_facts` — what Call 1 extracted from the triggering input. `null` for pre-feature rows.
- `candidates` — existing memories that were in context for Call 2. `null` for pre-feature rows.
- `call_id` — groups all events from one `memory.add()` call. Use this to see every decision made in a single write.
- Returns 503 when the analytics DB is unavailable.

**Typical debugging workflow:**
1. See an unexpected DELETE in `recentActivity` from `GET /v2/stats/memories`.
2. Note the `memoryId`.
3. `GET /v2/write-events?memory_id=<id>&event_type=DELETE` — see the `reason` and `extracted_facts` that caused it.
4. Use `call_id` to fetch all events from that write: `GET /v2/write-events?call_id=<call_id>` (if added to query params).

---

## 2.10 Prompt Config

Runtime-editable LLM prompts for memory inference. Changes take effect immediately on the next `memory.add()` call. Persisted to SQLite — survives restarts.

### `GET /v2/config/prompt`

Returns the current Call 1 prompt (fact extraction — what memories to extract from the conversation).

```json
{ "ok": true, "data": { "prompt": null, "effective_prompt": "<full active prompt text>", "source": "default", "persisted": true }, "meta": { "version": "v2" } }
```

- `prompt: null` means the mem0 default is active.
- `effective_prompt`: always the full text of the prompt currently in use (custom or default).
- `source`: `"default"` | `"env"` | `"persisted"` | `"api"`

### `PUT /v2/config/prompt`

Set or clear the Call 1 prompt.

Request body:
```json
{ "prompt": "You are a memory extraction assistant. Extract concise factual memories..." }
```

- `prompt: null` resets to the mem0 default.
- Returns the same shape as `GET /v2/config/prompt`.

### `GET /v2/config/update-prompt`

Returns the current Call 2 prompt (update decision — which memories to ADD / UPDATE / DELETE / NONE).

```json
{ "ok": true, "data": { "prompt": null, "effective_prompt": "<full active prompt text>", "source": "default", "persisted": true }, "meta": { "version": "v2" } }
```

### `PUT /v2/config/update-prompt`

Set or clear the Call 2 prompt.

Request body:
```json
{ "prompt": "You are a memory manager. Given existing memories and new facts, decide which to ADD, UPDATE, DELETE, or NONE..." }
```

- `prompt: null` resets to the mem0 default.
- The static preamble is replaced; the dynamic section (existing memories + new facts + output format) is always appended automatically.

### `GET /v2/config/graph-prompt` _(graph-enabled only)_

Returns the current graph entity extraction prompt (Call 3). When set, this is injected as an additional rule into `EXTRACT_RELATIONS_PROMPT` in the mem0 fork.

```json
{ "ok": true, "data": { "prompt": null, "source": "default", "persisted": true } }
```

- `prompt: null` means the built-in `EXTRACT_RELATIONS_PROMPT` default is active.
- `source`: `"default"` | `"env"` | `"persisted"` | `"api"`
- Returns `400 BAD_REQUEST` when graph memory is not enabled.

### `PUT /v2/config/graph-prompt` _(graph-enabled only)_

Set or clear the graph prompt.

Request body:
```json
{ "prompt": "Always extract the user's name as a node labeled 'Person'." }
```

- `prompt: null` resets to the EXTRACT_RELATIONS_PROMPT default.
- Persisted to SQLite and survives restarts.
- Returns `400 BAD_REQUEST` when graph memory is not enabled.

---

## 2.11 Graph Relations Browse _(graph-enabled only)_

### `GET /v2/graph/relations?user_id=&run_id=&limit=`

Returns raw Neo4j relation triples for a given user or session. Thin wrapper around `MemoryGraph.getAll()`.

Query params:
- `user_id` or `run_id` (at least one required)
- `limit` — default 100, max 1000

Success:

```json
{
  "ok": true,
  "data": {
    "relations": [
      { "source": "thomas", "relationship": "prefers", "destination": "concise_answers" },
      { "source": "thomas", "relationship": "uses", "destination": "openclaw" }
    ],
    "count": 2
  },
  "meta": { "version": "v2" }
}
```

- Returns `400 BAD_REQUEST` when graph memory is not enabled.
- Each item matches the `GraphRelation` schema: `{ source, relationship, destination }`.
- Use this endpoint to inspect what the graph has learned, debug entity extraction, or build graph visualizations.

---

## 2.12 OpenAPI Spec

### `GET /v2/openapi.json`

Returns the machine-readable OpenAPI 3.0.3 spec for all `/v2` endpoints. No auth required.

```json
{ "openapi": "3.0.3", "info": { "title": "foxmemory-store v2", ... }, "paths": { ... } }
```

---

## 3) V1 API (Stable/Compatibility)

### `POST /v1/memories`

Body:

```json
{
  "messages": [{ "role": "user", "content": "I like sci-fi" }],
  "user_id": "demo-user",
  "run_id": "session-1",
  "metadata": { "source": "chat" }
}
```

### `POST /v1/memories/search`

Body:

```json
{
  "query": "movie preference",
  "user_id": "demo-user",
  "run_id": "session-1",
  "top_k": 5
}
```

### `GET /v1/memories/:id`
### `GET /v1/memories?user_id=...&run_id=...`
### `DELETE /v1/memories/:id`

---

## 4) Back-compat aliases

### `POST /memory.write`

Body:

```json
{ "text": "remember this", "user_id": "u1", "run_id": "r1" }
```

### `POST /memory.search`

Body:

```json
{ "query": "remember this", "user_id": "u1", "run_id": "r1", "limit": 5 }
```

### `POST /memory.raw_write`

Deterministic ingest lane (bypass inference):

```json
{
  "text": "must-store marker",
  "user_id": "u1",
  "run_id": "r1",
  "metadata": { "reason": "deterministic" }
}
```

Response includes `deterministic: true`.

---

## 5) Error model (v2)

Example validation error:

```json
{
  "type": "https://docs.openclaw.ai/problems/validation_error",
  "title": "VALIDATION_ERROR",
  "status": 400,
  "detail": "Invalid request body",
  "errors": {},
  "ok": false
}
```

Common v2 titles:
- `VALIDATION_ERROR` (400)
- `NOT_FOUND` (404)
- `IDEMPOTENCY_CONFLICT` (409)
- `INTERNAL_ERROR` (500)

---

## 6) Deployment/runtime notes

- OpenAI-compatible provider is controlled by:
  - `OPENAI_BASE_URL`
  - `OPENAI_API_KEY`
- Mem0 model config:
  - `MEM0_LLM_MODEL`
  - `MEM0_EMBED_MODEL`
- Qdrant config:
  - `QDRANT_HOST`, `QDRANT_PORT`, `QDRANT_API_KEY`, `QDRANT_COLLECTION`
- Graph memory (Neo4j — optional):
  - `NEO4J_URL` — Bolt URL, e.g. `bolt://neo4j:7687`. Graph memory is **disabled** unless this is set.
  - `NEO4J_USERNAME` — default: `neo4j`
  - `NEO4J_PASSWORD` — required when `NEO4J_URL` is set
  - `MEM0_GRAPH_LLM_MODEL` — optional separate model for entity/relation extraction. Defaults to `MEM0_LLM_MODEL`. Recommended: `gpt-4.1-mini` (hosted) or `Qwen2.5-14B-Instruct` / `Mistral-Small-3.1` (local).
  - `MEM0_GRAPH_SEARCH_THRESHOLD` — cosine similarity threshold for graph candidate retrieval (default: `0.7`).
  - `MEM0_GRAPH_NODE_DEDUP_THRESHOLD` — cosine similarity threshold for node deduplication during entity upsert (default: `0.9`).
  - `MEM0_GRAPH_BM25_TOPK` — max results returned after BM25 reranking in graph search (default: `5`).

When graph memory is enabled:
- Every `POST /v2/memories` write runs 2 additional LLM calls (entity extraction + relation establishment). Write responses include a top-level `relations` array (graph triples added by this call).
- `POST /v2/memories/search` responses include a `relations` array of `{ source, relationship, destination }` triples from the graph store alongside the vector `results`.
- `GET /v2/health` diagnostics include `graphEnabled`, `neo4jUrl`, `graphLlmModel`, plus live connectivity fields: `neo4jConnected`, `neo4jNodeCount`, `neo4jRelationCount` (and `neo4jError` on failure).
- Graph write events are recorded to the analytics DB (`graph_events` table). Stats visible in `GET /v2/stats/memories` → `graph` block.
- `GET /v2/graph/relations?user_id=` — browse raw Neo4j triples for a user/session.
- `GET/PUT /v2/config/graph-prompt` — runtime-configurable entity extraction prompt, persisted to SQLite.
- `MEM0_GRAPH_CUSTOM_PROMPT` env var sets the initial graph prompt at startup.

Recommended production checks:
1. `GET /health` or `GET /v2/health`
2. `GET /v2/openapi.json` — confirm spec is served
3. one `POST /v2/memories` (write)
4. one `PUT /v2/memories/:id` (update)
5. one `DELETE /v2/memories/:id` (delete)
6. `GET /v2/stats` — confirm request/event counters move
7. `GET /v2/stats/memories` — confirm SQLite history DB is readable

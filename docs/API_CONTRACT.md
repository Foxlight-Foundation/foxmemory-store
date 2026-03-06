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
    "result": { "results": [] }
  }
}
```

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

Rich analytics from the mem0 SQLite history DB. Designed for dashboard bar charts and activity feeds.

Query params:
- `days` (default: 30, max: 365) — lookback window for `byDay` and `recentActivity`.

Success:

```json
{
  "ok": true,
  "data": {
    "summary": {
      "total": 142,
      "active": 138,
      "deleted": 4,
      "byEvent": {
        "ADD": 98,
        "UPDATE": 44,
        "DELETE": 4,
        "NONE": 0
      }
    },
    "byDay": [
      { "date": "2026-03-01", "ADD": 5, "UPDATE": 2, "DELETE": 0 },
      { "date": "2026-03-02", "ADD": 3, "UPDATE": 1, "DELETE": 1 }
    ],
    "recentActivity": [
      {
        "id": "history-uuid",
        "memory_id": "memory-uuid",
        "event": "ADD",
        "old_memory": null,
        "new_memory": "User prefers concise answers.",
        "created_at": "2026-03-05T12:00:00.000Z"
      }
    ]
  },
  "meta": { "version": "v2", "days": 30 }
}
```

Data source: `MEM0_HISTORY_DB_PATH` (default `/tmp/history.db`) — mem0's persistent SQLite history.

Dashboard mapping:
- `byDay` array → bar chart (group by event type, x-axis = date)
- `summary.byEvent` → summary totals card
- `recentActivity` → activity feed / audit log

## 2.9 Prompt Config

Runtime-editable LLM prompts for memory inference. Changes take effect immediately on the next `memory.add()` call. Persisted to SQLite — survives restarts.

### `GET /v2/config/prompt`

Returns the current Call 1 prompt (fact extraction — what memories to extract from the conversation).

```json
{ "ok": true, "data": { "prompt": null, "effective_prompt": "<full active prompt text>", "source": "default", "persisted": true }, "meta": { "version": "v2" } }
```

- `prompt: null` means the mem0 default is active.
- `effective_prompt`: always the full text of the prompt currently in use (custom or default).
- `source`: `"default"` | `"env"` | `"db"`

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

---

## 2.10 OpenAPI Spec

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
  - `MEM0_GRAPH_LLM_MODEL` — optional separate model for entity/relation extraction. Defaults to `MEM0_LLM_MODEL`. Recommended: `gpt-4o-mini` (hosted) or `Qwen2.5-14B-Instruct` / `Mistral-Small-3.1` (local).

When graph memory is enabled:
- Every `POST /v2/memories` write runs 2 additional LLM calls (entity extraction + relation establishment).
- `POST /v2/memories/search` responses include a `relations` array of `{ source, relationship, destination }` triples from the graph store alongside the vector `results`.
- `GET /v2/health` diagnostics include `graphEnabled`, `neo4jUrl`, and `graphLlmModel`.

Recommended production checks:
1. `GET /health` or `GET /v2/health`
2. `GET /v2/openapi.json` — confirm spec is served
3. one `POST /v2/memories` (write)
4. one `PUT /v2/memories/:id` (update)
5. one `DELETE /v2/memories/:id` (delete)
6. `GET /v2/stats` — confirm request/event counters move
7. `GET /v2/stats/memories` — confirm SQLite history DB is readable

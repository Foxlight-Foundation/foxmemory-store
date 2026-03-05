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
  "data": { "results": [] },
  "meta": { "scope": "direct", "count": 0 }
}
```

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

Recommended production checks:
1. `GET /health`
2. one `POST /v2/memory.write`
3. one `PUT /v2/memories/:id`
4. one `DELETE /v2/memories/:id`
5. confirm `/stats` request/event counters move

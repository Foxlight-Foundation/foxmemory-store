# API Contract (Beginner Edition)

Base URL examples:
- local dev: `http://localhost:8082`
- docker deploy: whichever host/port you mapped

## Health

### `GET /health`

Returns service metadata and selected model wiring.

Example response:

```json
{
  "ok": true,
  "service": "foxmemory-store",
  "runtime": "node-ts",
  "mem0": "oss",
  "openaiBaseUrl": "http://infer:8081/v1",
  "llmModel": "gpt-4.1-nano",
  "embedModel": "text-embedding-3-small"
}
```

---

## Write memory

### `POST /v1/memories`

Store one or more messages as memory.

Request body:

```json
{
  "messages": [
    { "role": "user", "content": "I like sci-fi" }
  ],
  "user_id": "demo-user",
  "run_id": "session-1",
  "metadata": { "source": "chat" }
}
```

Validation notes:
- `messages` is required
- each message needs `role` and `content`

---

## Search memory

### `POST /v1/memories/search`

Request body:

```json
{
  "query": "movie preference",
  "user_id": "demo-user",
  "run_id": "session-1",
  "top_k": 5
}
```

Validation notes:
- `query` required
- `top_k` optional, max 100

---

## Get one memory by ID

### `GET /v1/memories/:id`

Returns memory object or `404` if not found.

---

## List memories

### `GET /v1/memories?user_id=...&run_id=...`

Both query params are optional. Use them to scope results.

---

## Delete memory

### `DELETE /v1/memories/:id`

Returns:

```json
{ "ok": true, "id": "..." }
```

---

## Back-compat aliases

### `POST /memory.write`

Input:

```json
{ "text": "remember this", "user_id": "u1", "run_id": "r1" }
```

### `POST /memory.search`

Input:

```json
{ "query": "remember this", "user_id": "u1", "run_id": "r1", "limit": 5 }
```

---

## Common error patterns

- `400` validation error: malformed body
- `401` from upstream inference: bad API key or wrong provider routing
- `5xx` backend/runtime issues (Qdrant unreachable, inference timeout, etc.)

Troubleshooting checklist:
1. `GET /health`
2. verify `OPENAI_BASE_URL`
3. verify `OPENAI_API_KEY`
4. verify Qdrant connection env values

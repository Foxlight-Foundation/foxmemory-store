# foxmemory-store Architecture (n00b-friendly)

## One sentence summary

`foxmemory-store` is a REST wrapper around Mem0 OSS that persists and retrieves memory using embeddings and a vector database.

## Components

- **Express server**: HTTP API surface
- **Mem0 OSS SDK**: memory extraction, storage orchestration, retrieval
- **Inference provider**: OpenAI-compatible endpoint for LLM + embeddings
- **Qdrant**: vector storage/search
- **SQLite history DB path**: local Mem0 history state

## Request flow (write)

1. Client sends `POST /v1/memories`
2. Input validated via Zod
3. Mem0 `add()` called
4. Mem0 invokes embedder + LLM provider
5. Embeddings and records stored in vector store
6. API returns write result JSON

## Request flow (search)

1. Client sends `POST /v1/memories/search`
2. Input validated
3. Mem0 `search()` called
4. Vector similarity + memory retrieval
5. Results returned to caller

## Design choices

- Keep API tiny and predictable
- Use OpenAI-compatible abstraction to swap providers easily
- Keep back-compat aliases for older callers

## Operational gotchas

- If Qdrant is unreachable, write/search fail
- If inference endpoint is miswired, you may see auth errors against default OpenAI endpoint
- Make sure model names match your provider

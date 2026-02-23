# API Contract

## Health
- `GET /health`

## Mem0-style endpoints
- `POST /v1/memories`
- `POST /v1/memories/search`
- `GET /v1/memories/:id`
- `GET /v1/memories?user_id=...&run_id=...`
- `DELETE /v1/memories/:id`

## Back-compat aliases
- `POST /memory.write`
- `POST /memory.search`

## Notes
- request/response payloads are mapped through Mem0 OSS SDK operations
- advanced filtering versions can be added after baseline deployment validation

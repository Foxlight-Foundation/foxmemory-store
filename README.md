# foxmemory-store

Memory storage/retrieval API service for FoxMemory.

## Why this exists
`foxmemory-store` is the durable memory layer. It stores memory entries and serves query-time retrieval.

Goals:
- clear API contract for writes/search
- pluggable backend strategy (metadata DB + vector index)
- deployment-friendly on local/self-hosted infra

## What it does (current scaffold)
- `GET /health`
- `POST /memory.write`
- `POST /memory.search`

Current implementation is in-memory only for scaffold/testing.

## Local usage
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=src gunicorn --bind 0.0.0.0:8082 foxmemory_store.main:app
```

## Container usage
```bash
docker build -t foxmemory-store:dev .
docker run --rm -p 8082:8082 foxmemory-store:dev
```

## Roadmap
- durable metadata store (Postgres)
- vector backend integration
- hybrid retrieval (semantic + keyword + filters)
- retention/consolidation workers

## Docs
- `docs/ARCHITECTURE.md`
- `docs/API_CONTRACT.md`
- `AGENTS.md`

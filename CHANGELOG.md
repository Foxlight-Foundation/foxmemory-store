# Changelog

## Unreleased

### Graph memory observability (no-fork)
- `POST /v2/memories` and `/v2/memory.write` now call `analyticsDb.recordGraphWrite()` after every write when graph is enabled — populates the `graph_events` table and `graph` block in `/v2/stats/memories`
- Write responses now include a top-level `relations[]` array (graph triples added by this call) when graph is enabled
- `GET /v2/health` is now async and includes live Neo4j connectivity diagnostics: `neo4jConnected`, `neo4jNodeCount`, `neo4jRelationCount` (Cypher ping via the MemoryGraph driver)
- New `GET /v2/graph/relations?user_id=&run_id=&limit=` — browse raw Neo4j triples for a user/session (`MemoryGraph.getAll()`)
- New `GET/PUT /v2/config/graph-prompt` — runtime-configurable graph entity extraction prompt; persisted to SQLite, survives restarts; seeded from `MEM0_GRAPH_CUSTOM_PROMPT` env
- `createMemory()` now accepts `customGraphPrompt` and injects it as `graphStore.customPrompt`

### Model update
- Default `MEM0_GRAPH_LLM_MODEL` changed from `gpt-4o-mini` → `gpt-4.1-mini` across all compose files and `.env.example`

### OpenAPI spec
- `POST /v2/memories` response now fully documented (mode, attempts, infer, result, relations)
- `HealthDiagnostics` schema extended with `neo4jConnected`, `neo4jNodeCount`, `neo4jRelationCount`, `neo4jError`
- Added `/graph/relations` and `/config/graph-prompt` paths

### Docs
- `ARCHITECTURE.md` — full rewrite: component table, v2 write/search flow diagrams, LLM call budget, analytics DB schema, updated gotchas
- `README.md` — updated "What it does", full endpoint list, graph/analytics env vars, docker notes
- `API_CONTRACT.md` — sections 2.9–2.11: graph-prompt config, graph relations browse, write response with `relations`, updated deployment notes

---

## 0.2.0

### Analytics DB (FoxAnalyticsDB)
- SQLite analytics DB (`write_events`, `search_events`, `graph_events`, `config` tables)
- `call_id` groups all mem0 events from one `memory.add()` call — NONE rate is now per-call not per-row
- `graph_hit` flag on search events — powers `searches.graphHitRatePct`
- `graph_events` table tracks entities/relations added per graph write
- `GET /v2/stats/memories` — rich analytics endpoint: summary totals, byDay bar chart, recentActivity feed (full text, no truncation), search quality stats, graph block

### Graph memory support
- `NEO4J_URL`/`NEO4J_PASSWORD` env vars enable graph memory via Neo4j
- `MEM0_GRAPH_LLM_MODEL` for a dedicated graph extraction model
- Search responses include `relations[]` when graph enabled

### v2 API additions
- `POST /v2/memories/forget` — batch delete up to 1000 memories by UUID
- `GET /v2/openapi.json` — live OpenAPI 3.0.3 spec
- `GET/PUT /v2/config/prompt` — runtime Call 1 prompt, persisted to SQLite
- `GET/PUT /v2/config/update-prompt` — runtime Call 2 prompt, persisted to SQLite
- `GET /v2/stats/memories` with `days` window parameter

### CI/image
- Multi-stage Dockerfile: build tools stripped from runtime image
- SBOM + provenance attestations in `publish-image.yml`
- `npm` upgraded to latest in both stages (CVE fixes)
- `package.json` overrides for transitive CVEs (form-data, axios, tar, minimatch)
- Qdrant bumped from v1.13.2 → v1.17.0

---

## 0.1.0 - scaffold
- Initial repository scaffold

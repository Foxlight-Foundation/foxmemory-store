# Changelog

## Unreleased

### Decision observability (fork + store)
- Call 2 prompt (ADD/UPDATE/DELETE/NONE) now instructs the LLM to include a `reason` field on every decision
- `memory.add()` return now includes `decisions: { extractedFacts, candidates, actions[] }` — full trace of what Call 1 extracted, which existing memories were compared, and why each action was chosen
- `memory.add()` return now includes `added_entities` from the graph write (was previously dropped)
- `POST /v2/memories` and `/v2/memory.write` responses include top-level `decisions` (always present), `added_entities` (graph-enabled only)
- `write_events` analytics table gains three columns via additive migration (existing DB safe): `reason TEXT`, `extracted_facts_json TEXT`, `candidates_json TEXT`
- New `GET /v2/write-events` — queryable write event log filterable by `user_id`, `run_id`, `memory_id`, `event_type`, `before`; returns `reason`, `extracted_facts[]`, `candidates[]` per row; primary debugging tool for unexpected DELETE/UPDATE decisions

### Graph config fixes (fork)
- **graphStore LLM config bug fixed**: `MEM0_GRAPH_LLM_MODEL` now actually takes effect — `MemoryGraph` was always using `llm.config` instead of `graphStore.llm.config`
- Graph search similarity threshold (`0.7` hardcoded) now configurable via `MEM0_GRAPH_SEARCH_THRESHOLD`
- Node deduplication threshold (`0.9` hardcoded) now configurable via `MEM0_GRAPH_NODE_DEDUP_THRESHOLD`
- BM25 top-K (`5` hardcoded) now configurable via `MEM0_GRAPH_BM25_TOPK`

### Graph memory observability (no-fork)
- `POST /v2/memories` and `/v2/memory.write` now call `analyticsDb.recordGraphWrite()` after every write when graph is enabled — populates the `graph_events` table and `graph` block in `/v2/stats/memories`
- `entitiesAdded` in graph analytics is now accurate (was always 0; now reads from `added_entities` on the write result)
- Write responses now include a top-level `relations[]` array (graph triples added by this call) when graph is enabled
- `GET /v2/health` is now async and includes live Neo4j connectivity diagnostics: `neo4jConnected`, `neo4jNodeCount`, `neo4jRelationCount` (Cypher ping via the MemoryGraph driver)
- New `GET /v2/graph/relations?user_id=&run_id=&limit=` — browse raw Neo4j triples for a user/session (`MemoryGraph.getAll()`)
- New `GET/PUT /v2/config/graph-prompt` — runtime-configurable graph entity extraction prompt; persisted to SQLite, survives restarts; seeded from `MEM0_GRAPH_CUSTOM_PROMPT` env
- `createMemory()` now accepts `customGraphPrompt` and injects it as `graphStore.customPrompt`

### Model update
- Default `MEM0_GRAPH_LLM_MODEL` changed from `gpt-4o-mini` → `gpt-4.1-mini` across all compose files and `.env.example`

### OpenAPI spec
- `POST /v2/memories` response now fully documented (mode, attempts, infer, result, decisions, relations, added_entities)
- `HealthDiagnostics` schema extended with `neo4jConnected`, `neo4jNodeCount`, `neo4jRelationCount`, `neo4jError`
- New schemas: `MemoryDecision`, `MemoryDecisions`, `WriteEventRow`
- Added `/write-events`, `/graph/relations`, `/config/graph-prompt` paths

### Docs
- `ARCHITECTURE.md` — full rewrite: component table, v2 write/search flow diagrams, LLM call budget, analytics DB schema, updated gotchas, decision observability design notes
- `README.md` — updated "What it does", full endpoint list, graph/analytics env vars, new graph tuning env vars
- `API_CONTRACT.md` — section 2.9 (write-events debugger), 2.10 (prompt config), 2.11 (graph relations), 2.12 (openapi); write response updated with `decisions`; deployment notes include graph tuning env vars

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

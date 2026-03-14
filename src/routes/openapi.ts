export const V2_OPENAPI_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "foxmemory-store v2 API",
    description: "Normalized memory persistence API. Success: { ok, data, meta }. Error: { type, title, status, detail, ok: false }.",
    version: "2.0.0",
  },
  servers: [{ url: "/v2", description: "v2 API" }],
  components: {
    schemas: {
      OkEnvelope: {
        type: "object",
        properties: { ok: { type: "boolean", example: true }, data: {}, meta: { type: "object" } },
      },
      ErrorEnvelope: {
        type: "object",
        properties: {
          ok: { type: "boolean", example: false },
          type: { type: "string" },
          title: { type: "string" },
          status: { type: "integer" },
          detail: { type: "string" },
          errors: {},
        },
      },
      Message: {
        type: "object",
        required: ["role", "content"],
        properties: { role: { type: "string" }, content: { type: "string" } },
      },
      GraphRelation: {
        type: "object",
        description: "A knowledge graph triple from Neo4j (only present when graph memory is enabled).",
        properties: {
          source: { type: "string" },
          relationship: { type: "string" },
          destination: { type: "string" },
        },
      },
      ModelCatalogEntry: {
        type: "object",
        required: ["id", "name", "roles"],
        properties: {
          id:          { type: "string", description: "Model ID as used in API calls (e.g. 'gpt-4.1-mini')" },
          name:        { type: "string", description: "Human-readable display name" },
          description: { type: "string", nullable: true, description: "What this model is good/bad for" },
          roles:       { type: "array", items: { type: "string", enum: ["llm", "graph_llm"] }, description: "Which roles this model is valid for" },
          input_mtok:  { type: "number", nullable: true, description: "Cost per million input tokens (USD)" },
          cached_mtok: { type: "number", nullable: true, description: "Cost per million cached input tokens (USD)" },
          output_mtok: { type: "number", nullable: true, description: "Cost per million output tokens (USD)" },
          created_at:  { type: "integer", description: "Unix timestamp of creation" },
        },
      },
      GraphNode: {
        type: "object",
        description: "A Neo4j entity node. Embedding vectors are always stripped.",
        properties: {
          id: { type: "string", description: "Neo4j elementId (e.g. '4:abc123:0'). Use as :id in GET /graph/nodes/:id." },
          labels: { type: "array", items: { type: "string" }, description: "Neo4j labels assigned by mem0 entity extraction (e.g. 'person', 'technology')." },
          name: { type: "string", nullable: true, description: "Entity name — primary display value." },
          properties: { type: "object", description: "All node properties except embedding. Includes user_id, created, and any entity-specific fields." },
        },
      },
      GraphEdge: {
        type: "object",
        description: "A directed Neo4j relationship between two entity nodes.",
        properties: {
          id: { type: "string", description: "Neo4j elementId of the relationship." },
          source: { type: "string", description: "elementId of the start node." },
          target: { type: "string", description: "elementId of the end node." },
          type: { type: "string", description: "Relationship type as free-form natural language (e.g. 'WORKS_AT', 'experienced')." },
          created: { type: "string", nullable: true, description: "ISO timestamp when the relationship was created. Normalized from 'created' or 'created_at'." },
          properties: { type: "object", description: "Additional relationship properties (typically empty)." },
        },
      },
      SearchResponse: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" }, description: "Vector search results from Qdrant." },
          relations: {
            type: "array",
            items: { $ref: "#/components/schemas/GraphRelation" },
            description: "Graph memory results. Only present when NEO4J_URL is configured.",
          },
        },
      },
      HealthDiagnostics: {
        type: "object",
        properties: {
          authMode: { type: "string" },
          openaiApiKeyConfigured: { type: "boolean" },
          openaiBaseUrl: { type: "string", nullable: true },
          graphEnabled: { type: "boolean", description: "True when NEO4J_URL + NEO4J_PASSWORD are set." },
          neo4jUrl: { type: "string", nullable: true },
          graphLlmModel: { type: "string", nullable: true },
          neo4jConnected: { type: "boolean", nullable: true, description: "Live Neo4j connectivity check result. null when graph disabled." },
          neo4jNodeCount: { type: "integer", nullable: true, description: "Total nodes in Neo4j. null when graph disabled or unreachable." },
          neo4jRelationCount: { type: "integer", nullable: true, description: "Total relations in Neo4j. null when graph disabled or unreachable." },
          neo4jError: { type: "string", description: "Error message from Neo4j health check, if any." },
        },
      },
      StatsMemoriesSummary: {
        type: "object",
        properties: {
          totalCalls: { type: "integer", description: "Total memory.add() calls recorded (post-migration)." },
          byEvent: { type: "object", description: "ADD/UPDATE/DELETE/NONE row counts (all-time)." },
          noneRatePct: { type: "integer", description: "% of write calls where mem0 decided no memory was needed." },
          writeLatency: { type: "object", properties: { avgMs: { type: "integer", nullable: true }, minMs: { type: "integer", nullable: true }, maxMs: { type: "integer", nullable: true } } },
          model: { type: "object", properties: { llm: { type: "string" }, embed: { type: "string" } } },
        },
      },
      StatsMemoriesSearches: {
        type: "object",
        properties: {
          total: { type: "integer" },
          zeroResultRatePct: { type: "integer", description: "% of searches that returned 0 results." },
          graphHitRatePct: { type: "integer", description: "% of searches that returned graph relations (requires graph enabled)." },
          avgResults: { type: "number", nullable: true },
          avgTopScore: { type: "number", nullable: true },
          avgLatencyMs: { type: "integer", nullable: true },
          byDay: { type: "array", items: { type: "object", properties: { date: { type: "string" }, count: { type: "integer" }, zeroResults: { type: "integer" }, avgLatencyMs: { type: "integer", nullable: true } } } },
        },
      },
      StatsMemoriesGraph: {
        type: "object",
        description: "Graph memory analytics. totalRelations/totalEntities are 0 when graph is disabled.",
        properties: {
          enabled: { type: "boolean" },
          totalWrites: { type: "integer" },
          totalRelations: { type: "integer" },
          totalEntities: { type: "integer" },
          avgWriteLatencyMs: { type: "integer", nullable: true },
        },
      },
      MemoryDecision: {
        type: "object",
        description: "A single ADD/UPDATE/DELETE/NONE decision made by Call 2, with the LLM's reasoning.",
        properties: {
          event: { type: "string", enum: ["ADD", "UPDATE", "DELETE", "NONE"] },
          id: { type: "string", description: "Memory UUID affected (null for ADD).", nullable: true },
          text: { type: "string", description: "New memory text (or existing text for NONE/DELETE)." },
          old_memory: { type: "string", description: "Previous text before UPDATE. Absent for other events.", nullable: true },
          reason: { type: "string", description: "LLM explanation for this decision.", nullable: true },
        },
      },
      MemoryDecisions: {
        type: "object",
        description: "Full observability trace from a single memory.add() call — what was extracted, what was compared, and why each decision was made.",
        properties: {
          extractedFacts: { type: "array", items: { type: "string" }, description: "Facts extracted from the input by Call 1." },
          candidates: { type: "array", items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } } }, description: "Existing memories that were retrieved and compared by Call 2." },
          actions: { type: "array", items: { $ref: "#/components/schemas/MemoryDecision" }, description: "Decision list from Call 2, one entry per candidate or new fact." },
        },
      },
      WriteEventRow: {
        type: "object",
        description: "One row from write_events, returned by GET /v2/write-events.",
        properties: {
          id: { type: "string" },
          ts: { type: "string", format: "date-time" },
          event_type: { type: "string", enum: ["ADD", "UPDATE", "DELETE", "NONE"] },
          memory_id: { type: "string", nullable: true },
          user_id: { type: "string", nullable: true },
          run_id: { type: "string", nullable: true },
          memory_text: { type: "string", nullable: true },
          reason: { type: "string", nullable: true, description: "LLM reason for this decision (null for rows before this feature was deployed)." },
          extracted_facts: { type: "array", items: { type: "string" }, nullable: true, description: "Call 1 output for this write call (null for pre-feature rows)." },
          candidates: { type: "array", items: { type: "object" }, nullable: true, description: "Existing memories compared by Call 2 (null for pre-feature rows)." },
          call_id: { type: "string", nullable: true },
          latency_ms: { type: "integer", nullable: true },
          infer_mode: { type: "boolean" },
        },
      },
    },
  },
  paths: {
    "/health": { get: { summary: "Service health (v2 envelope)", operationId: "v2Health", responses: { "200": { description: "Health data including graphEnabled, neo4jUrl, graphLlmModel diagnostics.", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/OkEnvelope" }, { type: "object", properties: { data: { type: "object", properties: { diagnostics: { $ref: "#/components/schemas/HealthDiagnostics" } } } } }] } } } } } } },
    "/stats": { get: { summary: "Runtime counters (v2 envelope)", operationId: "v2Stats", responses: { "200": { description: "Stats data" } } } },
    "/openapi.json": { get: { summary: "This spec", operationId: "v2OpenAPI", responses: { "200": { description: "OpenAPI 3.0 JSON" } } } },
    "/docs": { get: { summary: "Interactive API docs (Redoc UI)", operationId: "v2GetDocs", responses: { "200": { description: "HTML page rendering the OpenAPI spec via Redoc" } } } },
    "/docs.md": { get: { summary: "Full API contract (Markdown)", operationId: "v2GetDocsMd", description: "Serves docs/API_CONTRACT.md as text/markdown. Suitable for agent consumption.", responses: { "200": { description: "Markdown text of the full API contract" } } } },
    "/stats/memories": {
      get: {
        summary: "SQLite history DB analytics — byDay bar chart, summary totals, activity feed, search quality, graph stats",
        operationId: "v2StatsMemories",
        parameters: [{ name: "days", in: "query", schema: { type: "integer", minimum: 1, maximum: 365, default: 30 } }],
        responses: { "200": { description: "Memory analytics", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/OkEnvelope" }, { type: "object", properties: { data: { type: "object", properties: { summary: { $ref: "#/components/schemas/StatsMemoriesSummary" }, byDay: { type: "array" }, recentActivity: { type: "array" }, searches: { $ref: "#/components/schemas/StatsMemoriesSearches" }, graph: { $ref: "#/components/schemas/StatsMemoriesGraph" } } } } }] } } } }, "400": { description: "Validation error" } },
      },
    },
    "/jobs/{id}": {
      get: {
        summary: "Poll async write job status and result",
        operationId: "v2GetJob",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" }, description: "Job ID returned by an async write (202 response)." }],
        responses: {
          "200": { description: "Job completed or failed", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, data: { type: "object", properties: { job_id: { type: "string" }, status: { type: "string", enum: ["completed", "failed"] }, created_at: { type: "string", format: "date-time" }, completed_at: { type: "string", format: "date-time", nullable: true }, result: { type: "object", description: "Full write result (same shape as sync 200). Present when status=completed." }, error: { type: "string", description: "Error message. Present when status=failed.", nullable: true } } } } } } } },
          "202": { description: "Job still in progress (pending or running)", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, data: { type: "object", properties: { job_id: { type: "string" }, status: { type: "string", enum: ["pending", "running"] }, created_at: { type: "string", format: "date-time" }, completed_at: { type: "string", format: "date-time", nullable: true } } } } } } } },
          "404": { description: "Job not found or expired" },
        },
      },
    },
    "/memories": {
      post: {
        summary: "Add/infer memories (with optional raw fallback, idempotency, and async mode)",
        operationId: "v2AddMemories",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: {
          messages: { type: "array", items: { $ref: "#/components/schemas/Message" } },
          text: { type: "string" },
          user_id: { type: "string" }, run_id: { type: "string" },
          metadata: { type: "object" },
          infer_preferred: { type: "boolean" }, fallback_raw: { type: "boolean", description: "Deprecated — accepted but ignored. Raw fallback has been removed." }, async: { type: "boolean", description: "When true, return 202 immediately with a job_id. Poll GET /v2/jobs/:id for the result." },
          idempotency_key: { type: "string" },
        } } } } },
        responses: {
          "200": { description: "Write result", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/OkEnvelope" }, { type: "object", properties: { data: { type: "object", properties: {
            mode: { type: "string", enum: ["inferred", "none", "raw", "skipped"] },
            attempts: { type: "integer" },
            infer: { type: "object", properties: { resultCount: { type: "integer" } } },
            result: { type: "object" },
            decisions: { $ref: "#/components/schemas/MemoryDecisions", description: "Full observability trace: extracted facts, candidates compared, and per-decision reasons. Always present." },
            relations: { type: "array", items: { $ref: "#/components/schemas/GraphRelation" }, description: "Graph triples added by this write. Only present when graph memory is enabled." },
            added_entities: { type: "array", items: { type: "object" }, description: "Graph entities upserted by this write. Only present when graph memory is enabled." },
          } } } }] } } } },
          "202": { description: "Async write accepted (async: true). Poll GET /v2/jobs/:id for result.", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, data: { type: "object", properties: { job_id: { type: "string", format: "uuid" }, status: { type: "string", enum: ["pending"] } } }, meta: { type: "object", properties: { version: { type: "string" }, async: { type: "boolean" } } } } } } } },
          "400": { description: "Validation error" },
          "409": { description: "Idempotency conflict" },
          "429": { description: "Too many concurrent async jobs" },
        },
      },
      get: {
        summary: "List memories",
        operationId: "v2ListMemories",
        parameters: [
          { name: "user_id", in: "query", schema: { type: "string" } },
          { name: "run_id", in: "query", schema: { type: "string" } },
          { name: "scope", in: "query", schema: { type: "string", enum: ["session", "long-term", "all"] } },
          { name: "page_size", in: "query", schema: { type: "integer", minimum: 1, maximum: 500 } },
        ],
        responses: { "200": { description: "Memory list" }, "400": { description: "Validation error" } },
      },
    },
    "/memories/list": {
      post: {
        summary: "List memories (body-based, supports filters/OR)",
        operationId: "v2ListMemoriesPost",
        responses: { "200": { description: "Memory list" }, "400": { description: "Validation error" } },
      },
    },
    "/memories/search": {
      post: {
        summary: "Semantic search",
        operationId: "v2SearchMemories",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["query"], properties: {
          query: { type: "string" },
          user_id: { type: "string" }, run_id: { type: "string" },
          scope: { type: "string", enum: ["session", "long-term", "all"] },
          top_k: { type: "integer", minimum: 1, maximum: 100 },
          threshold: { type: "number", minimum: 0, maximum: 1 },
          keyword_search: { type: "boolean" }, reranking: { type: "boolean" },
          source: { type: "string" },
        } } } } },
        responses: { "200": { description: "Search results", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/OkEnvelope" }, { type: "object", properties: { data: { $ref: "#/components/schemas/SearchResponse" } } }] } } } }, "400": { description: "Validation error" } },
      },
    },
    "/memories/forget": {
      post: {
        summary: "Batch delete up to 1000 memories by ID",
        operationId: "v2ForgetMemories",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["memory_ids"], properties: {
          memory_ids: { type: "array", items: { type: "string", format: "uuid" }, minItems: 1, maxItems: 1000 },
          cascade_graph: { type: "boolean", default: false, description: "Opt-in: delete orphaned Neo4j nodes/edges linked to each memory. No-op if link table has no entries for a given memory." },
          idempotency_key: { type: "string" },
        } } } } },
        responses: { "200": { description: "{ deleted: uuid[], count: number, graph_cascade?: { edges_deleted, nodes_deleted } }" }, "400": { description: "Validation error" }, "409": { description: "Idempotency conflict" } },
      },
    },
    "/config/models": {
      get: {
        summary: "Get effective model for each role, with source (env|persisted) and full catalog entry",
        operationId: "v2GetModels",
        responses: { "200": { description: "{ llmModel: ModelConfig, graphLlmModel: ModelConfig }" } },
      },
    },
    "/config/model": {
      put: {
        summary: "Set model override for a role — persisted across restarts, hot-reloads immediately. Value must exist in catalog.",
        operationId: "v2SetModel",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["key", "value"], properties: {
          key: { type: "string", enum: ["llm_model", "graph_llm_model"] },
          value: { type: "string", description: "Model ID from catalog" },
        } } } } },
        responses: { "200": { description: "{ key, value, reloaded: true }" }, "400": { description: "Validation error or model not in catalog for role" } },
      },
    },
    "/config/model/{key}": {
      delete: {
        summary: "Clear model override — reverts to env var default and hot-reloads",
        operationId: "v2DeleteModel",
        parameters: [{ name: "key", in: "path", required: true, schema: { type: "string", enum: ["llm_model", "graph_llm_model"] } }],
        responses: { "200": { description: "{ key, reverted_to, reloaded: true }" }, "400": { description: "Invalid key" } },
      },
    },
    "/config/models/catalog": {
      get: {
        summary: "List model catalog entries, optionally filtered by role",
        operationId: "v2GetCatalog",
        parameters: [{ name: "role", in: "query", schema: { type: "string", enum: ["llm", "graph_llm"] } }],
        responses: { "200": { description: "{ models: ModelCatalogEntry[], count: number }" } },
      },
      post: {
        summary: "Add or replace a model catalog entry",
        operationId: "v2CreateCatalogModel",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ModelCatalogEntry" } } } },
        responses: { "200": { description: "{ model: ModelCatalogEntry }" }, "400": { description: "Validation error" } },
      },
    },
    "/config/models/catalog/{id}": {
      put: {
        summary: "Update an existing model catalog entry (partial updates allowed)",
        operationId: "v2UpdateCatalogModel",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ModelCatalogEntry" } } } },
        responses: { "200": { description: "{ model: ModelCatalogEntry }" }, "404": { description: "Not found" } },
      },
      delete: {
        summary: "Remove a model from the catalog",
        operationId: "v2DeleteCatalogModel",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "{ deleted: string }" }, "404": { description: "Not found" } },
      },
    },
    "/config/prompt": {
      get: { summary: "Get current Call 1 (fact extraction) prompt", operationId: "v2GetPrompt", responses: { "200": { description: "{ prompt: string|null, effective_prompt: string, source: string, persisted: boolean }" } } },
      put: {
        summary: "Set Call 1 (fact extraction) prompt — persisted across restarts",
        operationId: "v2SetPrompt",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["prompt"], properties: { prompt: { type: "string", nullable: true } } } } } },
        responses: { "200": { description: "Updated prompt" }, "400": { description: "Validation error" } },
      },
    },
    "/config/update-prompt": {
      get: { summary: "Get current Call 2 (ADD/UPDATE/DELETE/NONE decision) prompt", operationId: "v2GetUpdatePrompt", responses: { "200": { description: "{ prompt: string|null, effective_prompt: string, source: string, persisted: boolean }" } } },
      put: {
        summary: "Set Call 2 (update decision) prompt — persisted across restarts",
        operationId: "v2SetUpdatePrompt",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["prompt"], properties: { prompt: { type: "string", nullable: true } } } } } },
        responses: { "200": { description: "Updated prompt" }, "400": { description: "Validation error" } },
      },
    },
    "/config/graph-prompt": {
      get: { summary: "Get custom graph entity extraction prompt (Call 3). Only available when graph enabled.", operationId: "v2GetGraphPrompt", responses: { "200": { description: "{ prompt: string|null, source: string, persisted: boolean }" }, "400": { description: "Graph not enabled" } } },
      put: {
        summary: "Set graph entity extraction prompt — persisted across restarts. null resets to EXTRACT_RELATIONS_PROMPT default.",
        operationId: "v2SetGraphPrompt",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["prompt"], properties: { prompt: { type: "string", nullable: true } } } } } },
        responses: { "200": { description: "Updated prompt" }, "400": { description: "Validation error or graph not enabled" } },
      },
    },
    "/config/capture": {
      get: {
        summary: "Get auto-capture message limit — controls how many messages the plugin sends per agent_end capture",
        operationId: "v2GetCaptureConfig",
        responses: { "200": { description: "{ capture_message_limit: number, default: number, source: string, persisted: boolean }" } },
      },
      put: {
        summary: "Set auto-capture message limit — persisted across restarts. Lower values reduce graph thrashing and write latency.",
        operationId: "v2SetCaptureConfig",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["capture_message_limit"], properties: { capture_message_limit: { type: "integer", minimum: 1, maximum: 50, description: "Number of messages the plugin should send per auto-capture write." } } } } } },
        responses: { "200": { description: "Updated capture config" }, "400": { description: "Validation error" } },
      },
      delete: {
        summary: "Clear capture config override — reverts to env var or default (10)",
        operationId: "v2DeleteCaptureConfig",
        responses: { "200": { description: "Reverted capture config" } },
      },
    },
    "/config/roles": {
      get: {
        summary: "Get role name mapping — controls how message roles are labeled for the extraction LLM",
        operationId: "v2GetRolesConfig",
        responses: { "200": { description: "{ user: string, assistant: string, source: string, persisted: boolean }" } },
      },
      put: {
        summary: "Set role names — persisted across restarts. Maps 'user'/'assistant' to real names for extraction.",
        operationId: "v2SetRolesConfig",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { user: { type: "string", minLength: 1, maxLength: 100, description: "Name for the 'user' message role." }, assistant: { type: "string", minLength: 1, maxLength: 100, description: "Name for the 'assistant' message role." } } } } } },
        responses: { "200": { description: "Updated role names" }, "400": { description: "Validation error — at least one of user or assistant must be provided" } },
      },
      delete: {
        summary: "Clear role name overrides — reverts to env vars or defaults ('user', 'assistant')",
        operationId: "v2DeleteRolesConfig",
        responses: { "200": { description: "Reverted role names" } },
      },
    },
    "/graph": {
      get: {
        summary: "Full node+edge graph for a user/run — primary endpoint for graph rendering. Graph-enabled only.",
        operationId: "v2Graph",
        parameters: [
          { name: "user_id", in: "query", schema: { type: "string" } },
          { name: "run_id", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 1000, default: 500 }, description: "Max nodes returned. Edges fetched at limit*4." },
        ],
        responses: {
          "200": { description: "nodes + edges shaped for react-force-graph or equivalent", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/OkEnvelope" }, { type: "object", properties: { data: { type: "object", properties: { nodes: { type: "array", items: { $ref: "#/components/schemas/GraphNode" } }, edges: { type: "array", items: { $ref: "#/components/schemas/GraphEdge" } }, meta: { type: "object", properties: { nodeCount: { type: "integer" }, edgeCount: { type: "integer" } } } } } } }] } } } },
          "400": { description: "Graph not enabled" },
          "500": { description: "Internal error" },
        },
      },
    },
    "/graph/nodes": {
      get: {
        summary: "Paginated flat entity list — for sidebars or search-before-render flows. Graph-enabled only.",
        operationId: "v2GraphNodes",
        parameters: [
          { name: "user_id", in: "query", schema: { type: "string" } },
          { name: "run_id", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
          { name: "page_size", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 100 } },
        ],
        responses: {
          "200": { description: "Paginated node list", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/OkEnvelope" }, { type: "object", properties: { data: { type: "object", properties: { nodes: { type: "array", items: { $ref: "#/components/schemas/GraphNode" } }, page: { type: "integer" }, page_size: { type: "integer" }, count: { type: "integer" } } } } }] } } } },
          "400": { description: "Graph not enabled or validation error" },
        },
      },
    },
    "/graph/nodes/{id}": {
      get: {
        summary: "Single node + full direct neighborhood. Powers click-to-explore. Graph-enabled only.",
        operationId: "v2GraphNodeDetail",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Neo4j elementId (e.g. '4:abc123:0'), returned in all node objects." },
        ],
        responses: {
          "200": { description: "Node + neighbors + connecting edges", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/OkEnvelope" }, { type: "object", properties: { data: { type: "object", properties: { node: { $ref: "#/components/schemas/GraphNode" }, neighbors: { type: "array", items: { $ref: "#/components/schemas/GraphNode" } }, edges: { type: "array", items: { $ref: "#/components/schemas/GraphEdge" } } } } } }] } } } },
          "400": { description: "Graph not enabled" },
          "404": { description: "Node not found" },
          "500": { description: "Internal error" },
        },
      },
    },
    "/graph/search": {
      post: {
        summary: "Find entities by name (substring match) + return their direct neighborhood. Graph-enabled only.",
        operationId: "v2GraphSearch",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["query"], properties: {
          query: { type: "string", description: "Case-insensitive substring matched against node names." },
          user_id: { type: "string" },
          run_id: { type: "string" },
        } } } } },
        responses: {
          "200": { description: "Matched nodes + neighborhood subgraph", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/OkEnvelope" }, { type: "object", properties: { data: { type: "object", properties: { nodes: { type: "array", items: { $ref: "#/components/schemas/GraphNode" } }, edges: { type: "array", items: { $ref: "#/components/schemas/GraphEdge" } }, matchCount: { type: "integer", description: "Number of nodes directly matching the query (total nodes includes their neighbors)." } } } } }] } } } },
          "400": { description: "Validation error or graph not enabled" },
          "500": { description: "Internal error" },
        },
      },
    },
    "/graph/stats": {
      get: {
        summary: "Graph summary — entity type counts, relation type counts, most-connected nodes. Graph-enabled only.",
        operationId: "v2GraphStats",
        parameters: [
          { name: "user_id", in: "query", schema: { type: "string" } },
          { name: "run_id", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Graph summary stats", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/OkEnvelope" }, { type: "object", properties: { data: { type: "object", properties: { nodeCount: { type: "integer" }, edgeCount: { type: "integer" }, byLabel: { type: "object", description: "Node count keyed by entity label (e.g. { person: 12, technology: 6 })." }, byRelationType: { type: "object", description: "Edge count keyed by relation type." }, mostConnected: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, degree: { type: "integer" } } }, description: "Top 10 most-connected nodes by total edge count." } } } } }] } } } },
          "400": { description: "Graph not enabled or validation error" },
          "500": { description: "Internal error" },
        },
      },
    },
    "/graph/relations": {
      get: {
        summary: "Browse raw Neo4j relation triples. Use GET /graph for graph rendering. Graph-enabled only.",
        operationId: "v2GraphRelations",
        parameters: [
          { name: "user_id", in: "query", schema: { type: "string" } },
          { name: "run_id", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 1000, default: 100 } },
        ],
        responses: {
          "200": { description: "{ relations: GraphRelation[], count: number }", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/OkEnvelope" }, { type: "object", properties: { data: { type: "object", properties: { relations: { type: "array", items: { $ref: "#/components/schemas/GraphRelation" } }, count: { type: "integer" } } } } }] } } } },
          "400": { description: "Validation error or graph not enabled" },
          "500": { description: "Internal error" },
        },
      },
    },
    "/write-events": {
      get: {
        summary: "Browse write_events analytics log — primary tool for debugging DELETE/UPDATE decisions",
        operationId: "v2WriteEvents",
        parameters: [
          { name: "user_id", in: "query", schema: { type: "string" } },
          { name: "run_id", in: "query", schema: { type: "string" } },
          { name: "memory_id", in: "query", schema: { type: "string", format: "uuid" }, description: "Filter to events touching a specific memory UUID." },
          { name: "event_type", in: "query", schema: { type: "string", enum: ["ADD", "UPDATE", "DELETE", "NONE"] } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500, default: 50 } },
          { name: "before", in: "query", schema: { type: "string", format: "date-time" }, description: "Return events before this ISO timestamp." },
        ],
        responses: {
          "200": { description: "Event rows with reason, extracted_facts, candidates", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/OkEnvelope" }, { type: "object", properties: { data: { type: "object", properties: { events: { type: "array", items: { $ref: "#/components/schemas/WriteEventRow" } }, count: { type: "integer" } } } } }] } } } },
          "400": { description: "Validation error" },
          "503": { description: "Analytics DB unavailable" },
        },
      },
    },
    "/memory.write": {
      post: {
        summary: "Add memories — alias for POST /memories",
        operationId: "v2MemoryWrite",
        responses: { "200": { description: "Write result" } },
      },
    },
    "/memories/{id}": {
      get: { summary: "Get memory by ID", operationId: "v2GetMemory", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Memory object" }, "404": { description: "Not found" } } },
      put: { summary: "Update memory text", operationId: "v2UpdateMemory", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Updated" }, "404": { description: "Not found" }, "409": { description: "Idempotency conflict" } } },
      delete: { summary: "Delete memory by ID", operationId: "v2DeleteMemory", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "cascade_graph", in: "query", required: false, schema: { type: "boolean", default: false }, description: "Opt-in: delete orphaned Neo4j nodes/edges linked to this memory. No-op if link table has no entries." }], responses: { "200": { description: "{ deleted: true, graph_cascade?: { edges_deleted, nodes_deleted } } — graph_cascade present only when cascade_graph=true and graph enabled" }, "404": { description: "Not found" } } },
    },
  },
} as const;

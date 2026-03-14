import { createApp } from "./app.js";
import {
  effectiveLlmModel,
  effectiveGraphLlmModel,
  EMBED_MODEL,
  AUTH_MODE,
  HAS_OPENAI_API_KEY,
  OPENAI_BASE_URL_SANITIZED,
  GRAPH_ENABLED,
  NEO4J_URL,
  roleUserName,
  roleAssistantName,
} from "./config/env.js";

const PORT = Number(process.env.PORT ?? 8082);

const app = createApp();

app.listen(PORT, () => {
  console.log(`foxmemory-store listening on :${PORT}`);
  console.log(
    "foxmemory-store diagnostics",
    JSON.stringify(
      {
        authMode: AUTH_MODE,
        openaiApiKeyConfigured: HAS_OPENAI_API_KEY,
        openaiBaseUrl: OPENAI_BASE_URL_SANITIZED,
        llmModel: effectiveLlmModel,
        embedModel: EMBED_MODEL,
        qdrantHost: process.env.QDRANT_HOST || null,
        qdrantPort: process.env.QDRANT_PORT ? Number(process.env.QDRANT_PORT) : null,
        qdrantCollection: process.env.QDRANT_COLLECTION || "foxmemory",
        graphEnabled: GRAPH_ENABLED,
        neo4jUrl: NEO4J_URL,
        graphLlmModel: GRAPH_ENABLED ? effectiveGraphLlmModel : null,
        roleNames: { user: roleUserName, assistant: roleAssistantName },
      },
      null,
      0
    )
  );
});

import express from "express";
import {
  ANALYTICS_DB_PATH,
  FOXMEMORY_REGISTRY_DB_PATH,
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
  currentCustomPrompt,
  currentCustomUpdatePrompt,
  currentCustomGraphPrompt,
  captureMessageLimit,
  setCaptureMessageLimit,
  setCurrentCustomPrompt,
  setCurrentCustomUpdatePrompt,
  setCurrentCustomGraphPrompt,
  setEffectiveLlmModel,
  setEffectiveGraphLlmModel,
  setRoleUserName,
  setRoleAssistantName,
} from "./config/env.js";
import { MODEL_CATALOG_SEED } from "./config/defaults.js";
import { initAnalyticsDb, analyticsDb } from "./analytics/db.js";
import { initRegistry, registry } from "./registry/db.js";
import { migrateToRegistry } from "./registry/migrate.js";
import { recreateMemory } from "./memory/factory.js";
import { agentResolver } from "./middleware/agentResolver.js";
import { createHealthRouter } from "./routes/health.js";
import { createMemoriesRouter } from "./routes/memories.js";
import { createConfigRouter } from "./routes/config.js";
import { createGraphRouter } from "./routes/graph.js";
import { createStatsRouter } from "./routes/stats.js";
import { createJobsRouter } from "./routes/jobs.js";
import { createAdminRouter } from "./routes/admin.js";

const AGENT_PREFIX = "/v2/agents/:agentId";

export const createApp = () => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  /* ── Analytics DB ────────────────────────────────────── */
  const db = initAnalyticsDb(ANALYTICS_DB_PATH);
  if (db) {
    const persisted = db.getConfig("custom_prompt");
    if (persisted !== null) {
      setCurrentCustomPrompt(persisted);
      console.log("[config] restored custom prompt from DB");
    }
    const persistedUpdate = db.getConfig("custom_update_prompt");
    if (persistedUpdate !== null) {
      setCurrentCustomUpdatePrompt(persistedUpdate);
      console.log("[config] restored custom update prompt from DB");
    }
    const persistedGraph = db.getConfig("custom_graph_prompt");
    if (persistedGraph !== null) {
      setCurrentCustomGraphPrompt(persistedGraph);
      console.log("[config] restored custom graph prompt from DB");
    }
    const persistedCaptureLimit = db.getConfig("capture_message_limit");
    if (persistedCaptureLimit !== null) {
      const parsed = Number(persistedCaptureLimit);
      if (!isNaN(parsed) && parsed >= 1) {
        setCaptureMessageLimit(parsed);
        console.log(`[config] restored capture message limit from DB: ${parsed}`);
      }
    }
    const persistedRoleUser = db.getConfig("role_user_name");
    if (persistedRoleUser !== null) {
      setRoleUserName(persistedRoleUser);
      console.log(`[config] restored role user name from DB: ${persistedRoleUser}`);
    }
    const persistedRoleAssistant = db.getConfig("role_assistant_name");
    if (persistedRoleAssistant !== null) {
      setRoleAssistantName(persistedRoleAssistant);
      console.log(`[config] restored role assistant name from DB: ${persistedRoleAssistant}`);
    }
    db.seedCatalog(MODEL_CATALOG_SEED);

    const persistedLlmModel = db.getConfig("model_llm");
    if (persistedLlmModel !== null) {
      setEffectiveLlmModel(persistedLlmModel);
      console.log(`[config] restored llm model from DB: ${persistedLlmModel}`);
    }
    const persistedGraphLlmModel = db.getConfig("model_graph_llm");
    if (persistedGraphLlmModel !== null) {
      setEffectiveGraphLlmModel(persistedGraphLlmModel);
      console.log(`[config] restored graph llm model from DB: ${persistedGraphLlmModel}`);
    }

    recreateMemory(currentCustomPrompt, currentCustomUpdatePrompt, currentCustomGraphPrompt);
    console.log("[config] memory instance recreated with restored DB config");
  }

  /* ── Registry DB + migration ─────────────────────────── */
  const reg = initRegistry(FOXMEMORY_REGISTRY_DB_PATH);
  if (reg) {
    console.log("[registry] initialized");
    migrateToRegistry(reg, analyticsDb);
  }

  /* ── Legacy routes (no prefix change) ────────────────── */
  app.use(createHealthRouter());
  app.use(createMemoriesRouter());
  app.use(createConfigRouter());
  app.use(createGraphRouter());
  app.use(createStatsRouter());
  app.use(createJobsRouter());

  /* ── Admin routes ────────────────────────────────────── */
  app.use(createAdminRouter());

  /* ── Agent-scoped routes ─────────────────────────────── */
  // The agentResolver middleware resolves req.agent + req.agentMemory from :agentId.
  // Each agent-scoped router uses mergeParams and the routes embed the full path
  // including :agentId, so Express populates req.params.agentId automatically.
  // We apply agentResolver as a param-aware middleware on the agent path prefix.
  app.use("/v2/agents/:agentId", agentResolver);
  app.use(createMemoriesRouter(AGENT_PREFIX));
  app.use(createConfigRouter(AGENT_PREFIX));
  app.use(createGraphRouter(AGENT_PREFIX));
  app.use(createStatsRouter(AGENT_PREFIX));

  return app;
};

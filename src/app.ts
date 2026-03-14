import express from "express";
import {
  ANALYTICS_DB_PATH,
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
import { recreateMemory } from "./memory/factory.js";
import { createHealthRouter } from "./routes/health.js";
import { createMemoriesRouter } from "./routes/memories.js";
import { createConfigRouter } from "./routes/config.js";
import { createGraphRouter } from "./routes/graph.js";
import { createStatsRouter } from "./routes/stats.js";
import { createJobsRouter } from "./routes/jobs.js";

export const createApp = () => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

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

  app.use(createHealthRouter());
  app.use(createMemoriesRouter());
  app.use(createConfigRouter());
  app.use(createGraphRouter());
  app.use(createStatsRouter());
  app.use(createJobsRouter());

  return app;
};

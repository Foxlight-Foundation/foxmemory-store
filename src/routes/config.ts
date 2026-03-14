import { Router } from "express";
import {
  currentCustomPrompt,
  currentCustomUpdatePrompt,
  currentCustomGraphPrompt,
  setCurrentCustomPrompt,
  setCurrentCustomUpdatePrompt,
  setCurrentCustomGraphPrompt,
  captureMessageLimit,
  setCaptureMessageLimit,
  roleUserName,
  roleAssistantName,
  setRoleUserName,
  setRoleAssistantName,
  effectiveLlmModel,
  effectiveGraphLlmModel,
  setEffectiveLlmModel,
  setEffectiveGraphLlmModel,
  LLM_MODEL,
  GRAPH_LLM_MODEL,
  GRAPH_ENABLED,
  MODEL_ROLES,
  MODEL_KEY_TO_ROLE,
  type ModelRole,
} from "../config/env.js";
import { DEFAULT_EXTRACT_PROMPT, DEFAULT_UPDATE_PROMPT, DEFAULT_CAPTURE_MESSAGE_LIMIT } from "../config/defaults.js";
import { analyticsDb } from "../analytics/db.js";
import { registry } from "../registry/db.js";
import { recreateMemory } from "../memory/factory.js";
import { v2Ok, v2Err } from "../utils/response.js";
import {
  v2PromptSchema,
  v2CaptureConfigSchema,
  v2RolesConfigSchema,
  v2SetModelSchema,
  v2CatalogUpsertSchema,
} from "../schemas/index.js";

const getModelSource = (effective: string, envDefault: string, dbKey: string) => {
  const dbVal = analyticsDb?.getConfig(dbKey) ?? null;
  if (dbVal !== null) return "persisted";
  if (effective === envDefault) return "env";
  return "env";
};

/**
 * @param v2Prefix - The URL prefix for v2 routes. Default "/v2". For agent-scoped routes, pass "/v2/agents/:agentId".
 */
export const createConfigRouter = (v2Prefix = "/v2") => {
  const router = Router({ mergeParams: true });

  router.get(`${v2Prefix}/config/prompt`, (req, res) => {
    const agentId = (req as any).agent?.id as string | undefined;
    if (agentId && registry?.ready) {
      const agentCfg = registry.getAgentConfig(agentId);
      const agentPrompt = agentCfg["custom_prompt"] ?? null;
      const globalPrompt = analyticsDb?.getConfig("custom_prompt") ?? currentCustomPrompt;
      const effective = agentPrompt ?? globalPrompt ?? DEFAULT_EXTRACT_PROMPT();
      const source = agentPrompt ? "agent" : globalPrompt ? "global" : "default";
      return v2Ok(res, { prompt: agentPrompt ?? globalPrompt, effective_prompt: effective, source, persisted: true });
    }
    const dbPrompt = analyticsDb?.getConfig("custom_prompt") ?? null;
    const source = currentCustomPrompt
      ? dbPrompt !== null
        ? "persisted"
        : process.env.MEM0_CUSTOM_PROMPT === currentCustomPrompt
          ? "env"
          : "api"
      : "default";
    return v2Ok(res, {
      prompt: currentCustomPrompt,
      effective_prompt: currentCustomPrompt ?? DEFAULT_EXTRACT_PROMPT(),
      source,
      persisted: analyticsDb?.ready ?? false,
    });
  });

  router.put(`${v2Prefix}/config/prompt`, (req, res) => {
    const parsed = v2PromptSchema.safeParse(req.body);
    if (!parsed.success) {
      return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());
    }
    const newPrompt = parsed.data.prompt;
    const agentId = (req as any).agent?.id as string | undefined;
    if (agentId && registry?.ready) {
      if (newPrompt) {
        registry.setAgentConfig(agentId, "custom_prompt", newPrompt);
      } else {
        registry.deleteAgentConfig(agentId, "custom_prompt");
      }
      console.log(`[config] agent ${agentId} custom prompt updated: ${newPrompt ? `${newPrompt.slice(0, 80)}...` : "reset to global"}`);
      return v2Ok(res, { prompt: newPrompt, source: newPrompt ? "agent" : "global", persisted: true });
    }
    setCurrentCustomPrompt(newPrompt);
    recreateMemory(newPrompt, currentCustomUpdatePrompt, currentCustomGraphPrompt);
    analyticsDb?.setConfig("custom_prompt", newPrompt);
    console.log(`[config] custom prompt updated: ${newPrompt ? `${newPrompt.slice(0, 80)}...` : "reset to default"}`);
    return v2Ok(res, {
      prompt: newPrompt,
      source: newPrompt ? "api" : "default",
      persisted: analyticsDb?.ready ?? false,
    });
  });

  router.get(`${v2Prefix}/config/update-prompt`, (req, res) => {
    const agentId = (req as any).agent?.id as string | undefined;
    if (agentId && registry?.ready) {
      const agentCfg = registry.getAgentConfig(agentId);
      const agentPrompt = agentCfg["custom_update_prompt"] ?? null;
      const globalPrompt = analyticsDb?.getConfig("custom_update_prompt") ?? currentCustomUpdatePrompt;
      const effective = agentPrompt ?? globalPrompt ?? DEFAULT_UPDATE_PROMPT;
      const source = agentPrompt ? "agent" : globalPrompt ? "global" : "default";
      return v2Ok(res, { prompt: agentPrompt ?? globalPrompt, effective_prompt: effective, source, persisted: true });
    }
    const dbPrompt = analyticsDb?.getConfig("custom_update_prompt") ?? null;
    const source = currentCustomUpdatePrompt
      ? dbPrompt !== null
        ? "persisted"
        : process.env.MEM0_CUSTOM_UPDATE_PROMPT === currentCustomUpdatePrompt
          ? "env"
          : "api"
      : "default";
    return v2Ok(res, {
      prompt: currentCustomUpdatePrompt,
      effective_prompt: currentCustomUpdatePrompt ?? DEFAULT_UPDATE_PROMPT,
      source,
      persisted: analyticsDb?.ready ?? false,
    });
  });

  router.put(`${v2Prefix}/config/update-prompt`, (req, res) => {
    const parsed = v2PromptSchema.safeParse(req.body);
    if (!parsed.success) {
      return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());
    }
    const newPrompt = parsed.data.prompt;
    const agentId = (req as any).agent?.id as string | undefined;
    if (agentId && registry?.ready) {
      if (newPrompt) {
        registry.setAgentConfig(agentId, "custom_update_prompt", newPrompt);
      } else {
        registry.deleteAgentConfig(agentId, "custom_update_prompt");
      }
      console.log(`[config] agent ${agentId} custom update prompt updated: ${newPrompt ? `${newPrompt.slice(0, 80)}...` : "reset to global"}`);
      return v2Ok(res, { prompt: newPrompt, source: newPrompt ? "agent" : "global", persisted: true });
    }
    setCurrentCustomUpdatePrompt(newPrompt);
    recreateMemory(currentCustomPrompt, newPrompt, currentCustomGraphPrompt);
    analyticsDb?.setConfig("custom_update_prompt", newPrompt);
    console.log(`[config] custom update prompt updated: ${newPrompt ? `${newPrompt.slice(0, 80)}...` : "reset to default"}`);
    return v2Ok(res, {
      prompt: newPrompt,
      source: newPrompt ? "api" : "default",
      persisted: analyticsDb?.ready ?? false,
    });
  });

  router.get(`${v2Prefix}/config/capture`, (req, res) => {
    const agentId = (req as any).agent?.id as string | undefined;
    if (agentId && registry?.ready) {
      const agentCfg = registry.getAgentConfig(agentId);
      const agentVal = agentCfg["capture_message_limit"] ?? null;
      const globalVal = analyticsDb?.getConfig("capture_message_limit") ?? null;
      const effective = agentVal ? Number(agentVal) : globalVal ? Number(globalVal) : captureMessageLimit;
      const source = agentVal ? "agent" : globalVal ? "global" : "default";
      return v2Ok(res, { capture_message_limit: effective, default: DEFAULT_CAPTURE_MESSAGE_LIMIT, source, persisted: true });
    }
    const dbVal = analyticsDb?.getConfig("capture_message_limit") ?? null;
    const source = dbVal !== null
      ? "persisted"
      : process.env.FOXMEMORY_CAPTURE_MESSAGE_LIMIT
        ? "env"
        : "default";
    return v2Ok(res, {
      capture_message_limit: captureMessageLimit,
      default: DEFAULT_CAPTURE_MESSAGE_LIMIT,
      source,
      persisted: analyticsDb?.ready ?? false,
    });
  });

  router.put(`${v2Prefix}/config/capture`, (req, res) => {
    const parsed = v2CaptureConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());
    }
    const agentId = (req as any).agent?.id as string | undefined;
    if (agentId && registry?.ready) {
      registry.setAgentConfig(agentId, "capture_message_limit", String(parsed.data.capture_message_limit));
      console.log(`[config] agent ${agentId} capture message limit updated: ${parsed.data.capture_message_limit}`);
      return v2Ok(res, { capture_message_limit: parsed.data.capture_message_limit, source: "agent", persisted: true });
    }
    setCaptureMessageLimit(parsed.data.capture_message_limit);
    analyticsDb?.setConfig("capture_message_limit", String(parsed.data.capture_message_limit));
    console.log(`[config] capture message limit updated: ${parsed.data.capture_message_limit}`);
    return v2Ok(res, {
      capture_message_limit: parsed.data.capture_message_limit,
      source: "api",
      persisted: analyticsDb?.ready ?? false,
    });
  });

  router.delete(`${v2Prefix}/config/capture`, (req, res) => {
    const agentId = (req as any).agent?.id as string | undefined;
    if (agentId && registry?.ready) {
      registry.deleteAgentConfig(agentId, "capture_message_limit");
      const globalVal = analyticsDb?.getConfig("capture_message_limit") ?? null;
      const effective = globalVal ? Number(globalVal) : Number(process.env.FOXMEMORY_CAPTURE_MESSAGE_LIMIT || DEFAULT_CAPTURE_MESSAGE_LIMIT);
      console.log(`[config] agent ${agentId} capture message limit reset to global: ${effective}`);
      return v2Ok(res, { capture_message_limit: effective, source: globalVal ? "global" : "default", persisted: true });
    }
    const val = Number(process.env.FOXMEMORY_CAPTURE_MESSAGE_LIMIT || DEFAULT_CAPTURE_MESSAGE_LIMIT);
    setCaptureMessageLimit(val);
    analyticsDb?.setConfig("capture_message_limit", null);
    console.log(`[config] capture message limit reset to default: ${val}`);
    return v2Ok(res, {
      capture_message_limit: val,
      source: process.env.FOXMEMORY_CAPTURE_MESSAGE_LIMIT ? "env" : "default",
      persisted: analyticsDb?.ready ?? false,
    });
  });

  router.get(`${v2Prefix}/config/roles`, (req, res) => {
    const agentId = (req as any).agent?.id as string | undefined;
    if (agentId && registry?.ready) {
      const agentCfg = registry.getAgentConfig(agentId);
      const agentUser = agentCfg["role_user_name"] ?? null;
      const agentAssistant = agentCfg["role_assistant_name"] ?? null;
      const globalUser = analyticsDb?.getConfig("role_user_name") ?? null;
      const globalAssistant = analyticsDb?.getConfig("role_assistant_name") ?? null;
      const effectiveUser = agentUser ?? globalUser ?? roleUserName;
      const effectiveAssistant = agentAssistant ?? globalAssistant ?? roleAssistantName;
      const source = (agentUser || agentAssistant) ? "agent" : (globalUser || globalAssistant) ? "global" : "default";
      return v2Ok(res, { user: effectiveUser, assistant: effectiveAssistant, source, persisted: true });
    }
    const dbUser = analyticsDb?.getConfig("role_user_name") ?? null;
    const dbAssistant = analyticsDb?.getConfig("role_assistant_name") ?? null;
    const source = (dbUser !== null || dbAssistant !== null)
      ? "persisted"
      : (process.env.FOXMEMORY_ROLE_USER_NAME || process.env.FOXMEMORY_ROLE_ASSISTANT_NAME)
        ? "env"
        : "default";
    return v2Ok(res, {
      user: roleUserName,
      assistant: roleAssistantName,
      source,
      persisted: analyticsDb?.ready ?? false,
    });
  });

  router.put(`${v2Prefix}/config/roles`, (req, res) => {
    const parsed = v2RolesConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());
    }
    if (!parsed.data.user && !parsed.data.assistant) {
      return v2Err(res, 400, "VALIDATION_ERROR", "At least one of 'user' or 'assistant' must be provided");
    }
    const agentId = (req as any).agent?.id as string | undefined;
    if (agentId && registry?.ready) {
      if (parsed.data.user) registry.setAgentConfig(agentId, "role_user_name", parsed.data.user);
      if (parsed.data.assistant) registry.setAgentConfig(agentId, "role_assistant_name", parsed.data.assistant);
      const agentCfg = registry.getAgentConfig(agentId);
      console.log(`[config] agent ${agentId} role names updated: user=${agentCfg["role_user_name"] ?? roleUserName}, assistant=${agentCfg["role_assistant_name"] ?? roleAssistantName}`);
      return v2Ok(res, {
        user: agentCfg["role_user_name"] ?? roleUserName,
        assistant: agentCfg["role_assistant_name"] ?? roleAssistantName,
        source: "agent",
        persisted: true,
      });
    }
    if (parsed.data.user) {
      setRoleUserName(parsed.data.user);
      analyticsDb?.setConfig("role_user_name", parsed.data.user);
    }
    if (parsed.data.assistant) {
      setRoleAssistantName(parsed.data.assistant);
      analyticsDb?.setConfig("role_assistant_name", parsed.data.assistant);
    }
    recreateMemory(currentCustomPrompt, currentCustomUpdatePrompt, currentCustomGraphPrompt);
    console.log(`[config] role names updated: user=${roleUserName}, assistant=${roleAssistantName}`);
    return v2Ok(res, {
      user: roleUserName,
      assistant: roleAssistantName,
      source: "api",
      persisted: analyticsDb?.ready ?? false,
    });
  });

  router.delete(`${v2Prefix}/config/roles`, (req, res) => {
    const agentId = (req as any).agent?.id as string | undefined;
    if (agentId && registry?.ready) {
      registry.deleteAgentConfig(agentId, "role_user_name");
      registry.deleteAgentConfig(agentId, "role_assistant_name");
      const globalUser = analyticsDb?.getConfig("role_user_name") ?? roleUserName;
      const globalAssistant = analyticsDb?.getConfig("role_assistant_name") ?? roleAssistantName;
      console.log(`[config] agent ${agentId} role names reset to global: user=${globalUser}, assistant=${globalAssistant}`);
      return v2Ok(res, { user: globalUser, assistant: globalAssistant, source: "global", persisted: true });
    }
    setRoleUserName(process.env.FOXMEMORY_ROLE_USER_NAME || "user");
    setRoleAssistantName(process.env.FOXMEMORY_ROLE_ASSISTANT_NAME || "assistant");
    analyticsDb?.setConfig("role_user_name", null);
    analyticsDb?.setConfig("role_assistant_name", null);
    recreateMemory(currentCustomPrompt, currentCustomUpdatePrompt, currentCustomGraphPrompt);
    console.log(`[config] role names reset to defaults: user=${roleUserName}, assistant=${roleAssistantName}`);
    return v2Ok(res, {
      user: roleUserName,
      assistant: roleAssistantName,
      source: (process.env.FOXMEMORY_ROLE_USER_NAME || process.env.FOXMEMORY_ROLE_ASSISTANT_NAME) ? "env" : "default",
      persisted: analyticsDb?.ready ?? false,
    });
  });

  router.get(`${v2Prefix}/config/graph-prompt`, (req, res) => {
    if (!GRAPH_ENABLED) return v2Err(res, 400, "BAD_REQUEST", "Graph memory is not enabled");
    const agentId = (req as any).agent?.id as string | undefined;
    if (agentId && registry?.ready) {
      const agentCfg = registry.getAgentConfig(agentId);
      const agentPrompt = agentCfg["custom_graph_prompt"] ?? null;
      const globalPrompt = analyticsDb?.getConfig("custom_graph_prompt") ?? currentCustomGraphPrompt;
      const source = agentPrompt ? "agent" : globalPrompt ? "global" : "default";
      return v2Ok(res, { prompt: agentPrompt ?? globalPrompt, source, persisted: true });
    }
    const dbPrompt = analyticsDb?.getConfig("custom_graph_prompt") ?? null;
    const source = currentCustomGraphPrompt
      ? dbPrompt !== null
        ? "persisted"
        : process.env.MEM0_GRAPH_CUSTOM_PROMPT === currentCustomGraphPrompt
          ? "env"
          : "api"
      : "default";
    return v2Ok(res, {
      prompt: currentCustomGraphPrompt,
      source,
      persisted: analyticsDb?.ready ?? false,
    });
  });

  router.put(`${v2Prefix}/config/graph-prompt`, (req, res) => {
    if (!GRAPH_ENABLED) return v2Err(res, 400, "BAD_REQUEST", "Graph memory is not enabled");
    const parsed = v2PromptSchema.safeParse(req.body);
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());
    const newPrompt = parsed.data.prompt;
    const agentId = (req as any).agent?.id as string | undefined;
    if (agentId && registry?.ready) {
      if (newPrompt) {
        registry.setAgentConfig(agentId, "custom_graph_prompt", newPrompt);
      } else {
        registry.deleteAgentConfig(agentId, "custom_graph_prompt");
      }
      console.log(`[config] agent ${agentId} custom graph prompt updated: ${newPrompt ? `${newPrompt.slice(0, 80)}...` : "reset to global"}`);
      return v2Ok(res, { prompt: newPrompt, source: newPrompt ? "agent" : "global", persisted: true });
    }
    setCurrentCustomGraphPrompt(newPrompt);
    recreateMemory(currentCustomPrompt, currentCustomUpdatePrompt, newPrompt);
    analyticsDb?.setConfig("custom_graph_prompt", newPrompt);
    console.log(`[config] custom graph prompt updated: ${newPrompt ? `${newPrompt.slice(0, 80)}...` : "reset to default"}`);
    return v2Ok(res, {
      prompt: newPrompt,
      source: newPrompt ? "api" : "default",
      persisted: analyticsDb?.ready ?? false,
    });
  });

  router.get(`${v2Prefix}/config/models`, (_req, res) => {
    const catalog = analyticsDb?.getCatalogModels() ?? [];
    const findModel = (id: string) => catalog.find((m: any) => m.id === id) ?? null;

    return v2Ok(res, {
      llmModel: {
        value:  effectiveLlmModel,
        source: getModelSource(effectiveLlmModel, LLM_MODEL, "model_llm"),
        model:  findModel(effectiveLlmModel),
      },
      graphLlmModel: {
        value:  effectiveGraphLlmModel,
        source: getModelSource(effectiveGraphLlmModel, GRAPH_LLM_MODEL, "model_graph_llm"),
        model:  findModel(effectiveGraphLlmModel),
      },
    });
  });

  router.put(`${v2Prefix}/config/model`, (req, res) => {
    const parsed = v2SetModelSchema.safeParse(req.body);
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());

    const { key, value } = parsed.data;
    const role = MODEL_KEY_TO_ROLE[key];

    const catalogEntry = analyticsDb?.getCatalogModel(value) ?? null;
    if (!catalogEntry) {
      return v2Err(res, 400, "VALIDATION_ERROR", `Model '${value}' not found in catalog. Add it via POST /v2/config/models/catalog first.`);
    }
    if (!catalogEntry.roles.includes(role)) {
      return v2Err(res, 400, "VALIDATION_ERROR", `Model '${value}' is not valid for role '${role}'. Its roles are: ${catalogEntry.roles.join(", ")}`);
    }

    if (key === "llm_model") setEffectiveLlmModel(value);
    else setEffectiveGraphLlmModel(value);

    analyticsDb?.setConfig(key === "llm_model" ? "model_llm" : "model_graph_llm", value);
    recreateMemory(currentCustomPrompt, currentCustomUpdatePrompt, currentCustomGraphPrompt);
    console.log(`[config] ${key} set to ${value} (hot-reloaded)`);

    return v2Ok(res, { key, value, reloaded: true });
  });

  router.delete(`${v2Prefix}/config/model/:key`, (req, res) => {
    const key = req.params.key;
    if (!["llm_model", "graph_llm_model"].includes(key)) {
      return v2Err(res, 400, "VALIDATION_ERROR", "key must be llm_model or graph_llm_model");
    }

    if (key === "llm_model") {
      setEffectiveLlmModel(LLM_MODEL);
      analyticsDb?.setConfig("model_llm", null);
    } else {
      setEffectiveGraphLlmModel(GRAPH_LLM_MODEL);
      analyticsDb?.setConfig("model_graph_llm", null);
    }

    recreateMemory(currentCustomPrompt, currentCustomUpdatePrompt, currentCustomGraphPrompt);
    console.log(`[config] ${key} cleared, reverted to env default (hot-reloaded)`);

    return v2Ok(res, { key, reverted_to: key === "llm_model" ? LLM_MODEL : GRAPH_LLM_MODEL, reloaded: true });
  });

  router.get(`${v2Prefix}/config/models/catalog`, (req, res) => {
    const role = req.query.role as string | undefined;
    if (role && !MODEL_ROLES.includes(role as ModelRole)) {
      return v2Err(res, 400, "VALIDATION_ERROR", `role must be one of: ${MODEL_ROLES.join(", ")}`);
    }
    const models = analyticsDb?.getCatalogModels(role) ?? [];
    return v2Ok(res, { models, count: models.length });
  });

  router.post(`${v2Prefix}/config/models/catalog`, (req, res) => {
    if (!analyticsDb?.ready) return v2Err(res, 503, "SERVICE_UNAVAILABLE", "Analytics DB not available");
    const parsed = v2CatalogUpsertSchema.safeParse(req.body);
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());
    analyticsDb.upsertCatalogModel(parsed.data);
    const model = analyticsDb.getCatalogModel(parsed.data.id);
    return v2Ok(res, { model });
  });

  router.put(`${v2Prefix}/config/models/catalog/:id`, (req, res) => {
    if (!analyticsDb?.ready) return v2Err(res, 503, "SERVICE_UNAVAILABLE", "Analytics DB not available");
    const existing = analyticsDb.getCatalogModel(req.params.id);
    if (!existing) return v2Err(res, 404, "NOT_FOUND", `Model '${req.params.id}' not found in catalog`);
    const parsed = v2CatalogUpsertSchema.safeParse({ ...existing, ...req.body, id: req.params.id });
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());
    analyticsDb.upsertCatalogModel(parsed.data);
    const model = analyticsDb.getCatalogModel(req.params.id);
    return v2Ok(res, { model });
  });

  router.delete(`${v2Prefix}/config/models/catalog/:id`, (req, res) => {
    if (!analyticsDb?.ready) return v2Err(res, 503, "SERVICE_UNAVAILABLE", "Analytics DB not available");
    const deleted = analyticsDb.deleteCatalogModel(req.params.id);
    if (!deleted) return v2Err(res, 404, "NOT_FOUND", `Model '${req.params.id}' not found in catalog`);
    return v2Ok(res, { deleted: req.params.id });
  });

  return router;
};

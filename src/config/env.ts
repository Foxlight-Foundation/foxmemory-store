import { DEFAULT_CAPTURE_MESSAGE_LIMIT, DEFAULT_SKIP_PATTERNS } from "./defaults.js";

export const PORT = Number(process.env.PORT || 8082);

export const SERVICE_VERSION =
  process.env.HEALTH_VERSION ||
  process.env.SERVICE_VERSION ||
  process.env.IMAGE_DIGEST ||
  process.env.GIT_SHA ||
  "unknown";
export const BUILD_COMMIT = process.env.GIT_SHA || process.env.BUILD_COMMIT || "unknown";
export const BUILD_IMAGE_DIGEST = process.env.IMAGE_DIGEST || "unknown";
export const BUILD_TIME = process.env.BUILD_TIME || "unknown";

export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "local-infer-no-key";
export const HAS_OPENAI_API_KEY = Boolean(process.env.OPENAI_API_KEY);
export const LLM_MODEL = process.env.MEM0_LLM_MODEL || "gpt-4.1-nano";
export const EMBED_MODEL = process.env.MEM0_EMBED_MODEL || "text-embedding-3-small";

export const NEO4J_URL = process.env.NEO4J_URL || null;
export const NEO4J_USERNAME = process.env.NEO4J_USERNAME || "neo4j";
export const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || null;
export const GRAPH_LLM_MODEL = process.env.MEM0_GRAPH_LLM_MODEL || LLM_MODEL;

export let effectiveLlmModel = LLM_MODEL;
export let effectiveGraphLlmModel = GRAPH_LLM_MODEL;

export const setEffectiveLlmModel = (model: string) => { effectiveLlmModel = model; };
export const setEffectiveGraphLlmModel = (model: string) => { effectiveGraphLlmModel = model; };

export const GRAPH_ENABLED = Boolean(NEO4J_URL && NEO4J_PASSWORD);

export const GRAPH_SEARCH_THRESHOLD = process.env.MEM0_GRAPH_SEARCH_THRESHOLD
  ? Number(process.env.MEM0_GRAPH_SEARCH_THRESHOLD) : undefined;
export const GRAPH_NODE_DEDUP_THRESHOLD = process.env.MEM0_GRAPH_NODE_DEDUP_THRESHOLD
  ? Number(process.env.MEM0_GRAPH_NODE_DEDUP_THRESHOLD) : undefined;
export const GRAPH_BM25_TOPK = process.env.MEM0_GRAPH_BM25_TOPK
  ? parseInt(process.env.MEM0_GRAPH_BM25_TOPK, 10) : undefined;

const sanitizeBaseUrl = (url?: string) => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const cleanPath = parsed.pathname.replace(/\/$/, "") || "/";
    return `${parsed.protocol}//${parsed.host}${cleanPath}`;
  } catch {
    return "invalid";
  }
};

export const AUTH_MODE = HAS_OPENAI_API_KEY ? "api_key" : "local-default";
export const OPENAI_BASE_URL_SANITIZED = sanitizeBaseUrl(OPENAI_BASE_URL);

export let currentCustomPrompt: string | null =
  process.env.MEM0_CUSTOM_PROMPT || null;
export let currentCustomUpdatePrompt: string | null =
  process.env.MEM0_CUSTOM_UPDATE_PROMPT || null;
export let currentCustomGraphPrompt: string | null =
  process.env.MEM0_GRAPH_CUSTOM_PROMPT || null;

export const setCurrentCustomPrompt = (p: string | null) => { currentCustomPrompt = p; };
export const setCurrentCustomUpdatePrompt = (p: string | null) => { currentCustomUpdatePrompt = p; };
export const setCurrentCustomGraphPrompt = (p: string | null) => { currentCustomGraphPrompt = p; };

export let captureMessageLimit: number =
  Number(process.env.FOXMEMORY_CAPTURE_MESSAGE_LIMIT || DEFAULT_CAPTURE_MESSAGE_LIMIT);
export const setCaptureMessageLimit = (n: number) => { captureMessageLimit = n; };

export let roleUserName: string = process.env.FOXMEMORY_ROLE_USER_NAME || "user";
export let roleAssistantName: string = process.env.FOXMEMORY_ROLE_ASSISTANT_NAME || "assistant";
export const setRoleUserName = (name: string) => { roleUserName = name; };
export const setRoleAssistantName = (name: string) => { roleAssistantName = name; };

export const ADD_RETRIES = Number(process.env.MEM0_ADD_RETRIES || 3);
export const ADD_RETRY_DELAY_MS = Number(process.env.MEM0_ADD_RETRY_DELAY_MS || 250);

export const ASYNC_JOB_TTL_MS = Number(process.env.ASYNC_JOB_TTL_MS || 3_600_000);
export const ASYNC_JOB_MAX = Number(process.env.ASYNC_JOB_MAX || 100);

export const MIN_INPUT_CHARS = Number(process.env.MEM0_MIN_INPUT_CHARS ?? 1);
export const SKIP_PATTERNS: RegExp[] = (() => {
  const custom = (process.env.MEM0_SKIP_PATTERNS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return [...DEFAULT_SKIP_PATTERNS, ...custom].map(p => new RegExp(p, "i"));
})();

export const IDEM_TTL_MS = Math.max(60_000, Number(process.env.IDEMPOTENCY_TTL_MS || 24 * 60 * 60 * 1000));

export const ANALYTICS_DB_PATH = process.env.FOXMEMORY_ANALYTICS_DB_PATH || "/data/foxmemory-analytics.db";

export const FOXMEMORY_REGISTRY_DB_PATH = process.env.FOXMEMORY_REGISTRY_DB_PATH || "/data/foxmemory-registry.db";
export const DEFAULT_AGENT = process.env.DEFAULT_AGENT || "";

export const REQUIRE_API_KEY_AUTH = process.env.REQUIRE_API_KEY_AUTH === "true";

export type RuntimeStats = {
  startedAt: string;
  writesByMode: { infer: number; raw: number };
  memoryEvents: { ADD: number; UPDATE: number; DELETE: number; NONE: number };
  requests: { add: number; search: number; list: number; get: number; delete: number; update: number };
};

export const runtimeStats: RuntimeStats = {
  startedAt: new Date().toISOString(),
  writesByMode: { infer: 0, raw: 0 },
  memoryEvents: { ADD: 0, UPDATE: 0, DELETE: 0, NONE: 0 },
  requests: { add: 0, search: 0, list: 0, get: 0, delete: 0, update: 0 },
};

export const MODEL_ROLES = ["llm", "graph_llm"] as const;
export type ModelRole = typeof MODEL_ROLES[number];

export const MODEL_KEY_TO_ROLE: Record<string, ModelRole> = {
  llm_model:       "llm",
  graph_llm_model: "graph_llm",
};

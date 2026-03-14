import { Memory } from "@foxlight-foundation/mem0ai/oss";
import type { AgentRecord } from "../registry/types.js";
import {
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  effectiveLlmModel,
  EMBED_MODEL,
  GRAPH_ENABLED,
  NEO4J_URL,
  NEO4J_USERNAME,
  NEO4J_PASSWORD,
  effectiveGraphLlmModel,
  GRAPH_SEARCH_THRESHOLD,
  GRAPH_NODE_DEDUP_THRESHOLD,
  GRAPH_BM25_TOPK,
  roleUserName,
  roleAssistantName,
} from "../config/env.js";
import { hardenGraphJsonContract } from "../utils/json.js";

const pool = new Map<string, { memory: Memory; lastUsed: number }>();
const MAX_POOL_SIZE = 50;

const createAgentMemory = (agent: AgentRecord): Memory => {
  const mem = new Memory({
    version: "v1.1",
    historyDbPath: process.env.MEM0_HISTORY_DB_PATH || "/tmp/history.db",
    roleNames: { user: roleUserName, assistant: roleAssistantName },
    llm: {
      provider: "openai",
      config: {
        apiKey: OPENAI_API_KEY,
        model: effectiveLlmModel,
        ...(OPENAI_BASE_URL ? { baseURL: OPENAI_BASE_URL } : {}),
      },
    },
    embedder: {
      provider: "openai",
      config: {
        apiKey: OPENAI_API_KEY,
        model: EMBED_MODEL,
        ...(OPENAI_BASE_URL ? { baseURL: OPENAI_BASE_URL } : {}),
      },
    },
    ...(process.env.QDRANT_HOST
      ? {
          vectorStore: {
            provider: "qdrant",
            config: {
              host: process.env.QDRANT_HOST,
              port: Number(process.env.QDRANT_PORT || 6333),
              apiKey: process.env.QDRANT_API_KEY,
              collectionName: agent.qdrant_collection,
            },
          },
        }
      : {}),
    ...(GRAPH_ENABLED
      ? {
          enableGraph: true,
          graphStore: {
            provider: "neo4j",
            config: {
              url: NEO4J_URL!,
              username: NEO4J_USERNAME,
              password: NEO4J_PASSWORD!,
              ...(agent.neo4j_database !== "neo4j" ? { database: agent.neo4j_database } : {}),
            },
            ...(GRAPH_SEARCH_THRESHOLD !== undefined ? { searchThreshold: GRAPH_SEARCH_THRESHOLD } : {}),
            ...(GRAPH_NODE_DEDUP_THRESHOLD !== undefined ? { nodeDeduplicationThreshold: GRAPH_NODE_DEDUP_THRESHOLD } : {}),
            ...(GRAPH_BM25_TOPK !== undefined ? { bm25TopK: GRAPH_BM25_TOPK } : {}),
            llm: {
              provider: "openai",
              config: {
                apiKey: OPENAI_API_KEY,
                model: effectiveGraphLlmModel,
                ...(OPENAI_BASE_URL ? { baseURL: OPENAI_BASE_URL } : {}),
              },
            },
          },
        }
      : {}),
  });

  return hardenGraphJsonContract(mem);
};

export const getOrCreateMemory = (agentId: string, agent: AgentRecord): Memory => {
  const entry = pool.get(agentId);
  if (entry) {
    entry.lastUsed = Date.now();
    return entry.memory;
  }

  // LRU eviction if at capacity
  if (pool.size >= MAX_POOL_SIZE) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, val] of pool) {
      if (val.lastUsed < oldestTime) {
        oldestTime = val.lastUsed;
        oldestKey = key;
      }
    }
    if (oldestKey) pool.delete(oldestKey);
  }

  const memory = createAgentMemory(agent);
  pool.set(agentId, { memory, lastUsed: Date.now() });
  return memory;
};

export const evictMemory = (agentId: string): void => {
  pool.delete(agentId);
};

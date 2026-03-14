import { Memory } from "@foxlight-foundation/mem0ai/oss";
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

export const createMemory = (customPrompt?: string | null, customUpdatePrompt?: string | null, customGraphPrompt?: string | null) => {
  const mem = new Memory({
    version: "v1.1",
    historyDbPath: process.env.MEM0_HISTORY_DB_PATH || "/tmp/history.db",
    ...(customPrompt ? { customPrompt } : {}),
    ...(customUpdatePrompt ? { customUpdatePrompt } : {}),
    roleNames: { user: roleUserName, assistant: roleAssistantName },
    llm: {
      provider: "openai",
      config: {
        apiKey: OPENAI_API_KEY,
        model: effectiveLlmModel,
        ...(OPENAI_BASE_URL ? { baseURL: OPENAI_BASE_URL } : {})
      }
    },
    embedder: {
      provider: "openai",
      config: {
        apiKey: OPENAI_API_KEY,
        model: EMBED_MODEL,
        ...(OPENAI_BASE_URL ? { baseURL: OPENAI_BASE_URL } : {})
      }
    },
    ...(process.env.QDRANT_HOST
      ? {
          vectorStore: {
            provider: "qdrant",
            config: {
              host: process.env.QDRANT_HOST,
              port: Number(process.env.QDRANT_PORT || 6333),
              apiKey: process.env.QDRANT_API_KEY,
              collectionName: process.env.QDRANT_COLLECTION || "foxmemory"
            }
          }
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
            },
            ...(customGraphPrompt ? { customPrompt: customGraphPrompt } : {}),
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

let memory = createMemory();

export const getMemory = () => memory;

export const recreateMemory = (customPrompt?: string | null, customUpdatePrompt?: string | null, customGraphPrompt?: string | null) => {
  memory = createMemory(customPrompt, customUpdatePrompt, customGraphPrompt);
  return memory;
};

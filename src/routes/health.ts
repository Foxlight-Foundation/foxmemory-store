import { Router } from "express";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  SERVICE_VERSION,
  BUILD_COMMIT,
  BUILD_IMAGE_DIGEST,
  BUILD_TIME,
  effectiveLlmModel,
  EMBED_MODEL,
  AUTH_MODE,
  HAS_OPENAI_API_KEY,
  OPENAI_BASE_URL_SANITIZED,
  GRAPH_ENABLED,
  NEO4J_URL,
  effectiveGraphLlmModel,
  runtimeStats,
} from "../config/env.js";
import { v2Ok } from "../utils/response.js";
import { checkNeo4jHealth } from "../utils/graph.js";
import { V2_OPENAPI_SPEC } from "./openapi.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const createHealthRouter = () => {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "foxmemory-store",
      runtime: "node-ts",
      version: SERVICE_VERSION,
      build: {
        commit: BUILD_COMMIT,
        imageDigest: BUILD_IMAGE_DIGEST,
        time: BUILD_TIME
      },
      mem0: "oss",
      llmModel: effectiveLlmModel,
      embedModel: EMBED_MODEL,
      diagnostics: {
        authMode: AUTH_MODE,
        openaiApiKeyConfigured: HAS_OPENAI_API_KEY,
        openaiBaseUrl: OPENAI_BASE_URL_SANITIZED,
        graphEnabled: GRAPH_ENABLED,
        neo4jUrl: NEO4J_URL,
        graphLlmModel: GRAPH_ENABLED ? effectiveGraphLlmModel : null,
      }
    });
  });

  router.get("/health.version", (_req, res) => {
    res.json({
      ok: true,
      version: SERVICE_VERSION,
      build: {
        commit: BUILD_COMMIT,
        imageDigest: BUILD_IMAGE_DIGEST,
        time: BUILD_TIME
      }
    });
  });

  router.get("/stats", (_req, res) => {
    const started = Date.parse(runtimeStats.startedAt);
    const uptimeSec = Number.isFinite(started) ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : null;
    res.json({
      ok: true,
      startedAt: runtimeStats.startedAt,
      uptimeSec,
      writesByMode: runtimeStats.writesByMode,
      memoryEvents: runtimeStats.memoryEvents,
      requests: runtimeStats.requests,
      ingestionQueueDepth: null,
    });
  });

  router.get("/v2/health", async (_req, res) => {
    const neo4j = await checkNeo4jHealth();
    return v2Ok(res, {
      service: "foxmemory-store",
      runtime: "node-ts",
      mem0: "oss",
      version: SERVICE_VERSION,
      build: { commit: BUILD_COMMIT, imageDigest: BUILD_IMAGE_DIGEST, time: BUILD_TIME },
      llmModel: effectiveLlmModel,
      embedModel: EMBED_MODEL,
      diagnostics: {
        authMode: AUTH_MODE,
        openaiApiKeyConfigured: HAS_OPENAI_API_KEY,
        openaiBaseUrl: OPENAI_BASE_URL_SANITIZED,
        graphEnabled: GRAPH_ENABLED,
        neo4jUrl: NEO4J_URL,
        graphLlmModel: GRAPH_ENABLED ? effectiveGraphLlmModel : null,
        neo4jConnected: neo4j?.connected ?? null,
        neo4jNodeCount: neo4j?.nodeCount ?? null,
        neo4jRelationCount: neo4j?.relationCount ?? null,
        ...(neo4j?.error ? { neo4jError: neo4j.error } : {}),
      },
    }, { version: "v2" });
  });

  router.get("/v2/openapi.json", (_req, res) => {
    res.json(V2_OPENAPI_SPEC);
  });

  router.get("/v2/docs", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html>
  <head>
    <title>foxmemory-store API v2</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
    <style>body { margin: 0; padding: 0; }</style>
  </head>
  <body>
    <redoc spec-url="/v2/openapi.json" expand-responses="200,201"></redoc>
    <script src="https://cdn.jsdelivr.net/npm/redoc/bundles/redoc.standalone.js"></script>
  </body>
</html>`);
  });

  router.get("/v2/docs.md", (_req, res) => {
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.sendFile(join(__dirname, "../../docs/API_CONTRACT.md"));
  });

  return router;
};

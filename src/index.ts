import express from "express";
import { z } from "zod";
import { Memory } from "mem0ai/oss";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 8082);

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL; // e.g. http://foxmemory-infer:8081/v1
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "local-infer-no-key";
const LLM_MODEL = process.env.MEM0_LLM_MODEL || "gpt-4.1-nano";
const EMBED_MODEL = process.env.MEM0_EMBED_MODEL || "text-embedding-3-small";

const memory = new Memory({
  version: "v1.1",
  historyDbPath: process.env.MEM0_HISTORY_DB_PATH || "/tmp/history.db",
  llm: {
    provider: "openai",
    config: {
      apiKey: OPENAI_API_KEY,
      model: LLM_MODEL,
      ...(OPENAI_BASE_URL ? { openaiBaseUrl: OPENAI_BASE_URL } : {})
    }
  },
  embedder: {
    provider: "openai",
    config: {
      apiKey: OPENAI_API_KEY,
      model: EMBED_MODEL,
      ...(OPENAI_BASE_URL ? { openaiBaseUrl: OPENAI_BASE_URL } : {})
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
    : {})
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "foxmemory-store",
    runtime: "node-ts",
    mem0: "oss",
    openaiBaseUrl: OPENAI_BASE_URL || null,
    llmModel: LLM_MODEL,
    embedModel: EMBED_MODEL
  });
});

const addSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.string() })).min(1),
  user_id: z.string().optional(),
  run_id: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

app.post("/v1/memories", async (req, res) => {
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const body = parsed.data;
  const result = await memory.add(body.messages, {
    userId: body.user_id,
    runId: body.run_id,
    metadata: body.metadata,
    output_format: "v1.1"
  } as any);

  res.json(result);
});

const searchSchema = z.object({
  query: z.string().min(1),
  user_id: z.string().optional(),
  run_id: z.string().optional(),
  top_k: z.number().int().positive().max(100).optional()
});

app.post("/v1/memories/search", async (req, res) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const body = parsed.data;
  const result = await memory.search(body.query, {
    userId: body.user_id,
    runId: body.run_id,
    limit: body.top_k
  } as any);
  res.json(result);
});

app.get("/v1/memories/:id", async (req, res) => {
  try {
    const result = await memory.get(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: String(err) });
  }
});

app.get("/v1/memories", async (req, res) => {
  const userId = req.query.user_id as string | undefined;
  const runId = req.query.run_id as string | undefined;
  const result = await memory.getAll({ userId, runId } as any);
  res.json(result);
});

app.delete("/v1/memories/:id", async (req, res) => {
  await memory.delete(req.params.id);
  res.json({ ok: true, id: req.params.id });
});

// Back-compat aliases
app.post("/memory.write", async (req, res) => {
  const text = String(req.body?.text ?? "");
  const user_id = req.body?.user_id as string | undefined;
  const run_id = req.body?.run_id as string | undefined;
  const result = await memory.add([{ role: "user", content: text }], { userId: user_id, runId: run_id } as any);
  res.json({ ok: true, result });
});

app.post("/memory.search", async (req, res) => {
  const query = String(req.body?.query ?? "");
  const user_id = req.body?.user_id as string | undefined;
  const run_id = req.body?.run_id as string | undefined;
  const limit = Number(req.body?.limit ?? 5);
  const result = await memory.search(query, { userId: user_id, runId: run_id, limit } as any);
  res.json({ ok: true, ...result });
});

app.listen(PORT, () => {
  console.log(`foxmemory-store listening on :${PORT}`);
});

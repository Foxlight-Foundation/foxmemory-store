import express from "express";
import { z } from "zod";
import { Memory } from "mem0ai/oss";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 8082);

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL; // e.g. http://foxmemory-infer:8081/v1
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "local-infer-no-key";
const HAS_OPENAI_API_KEY = Boolean(process.env.OPENAI_API_KEY);
const LLM_MODEL = process.env.MEM0_LLM_MODEL || "gpt-4.1-nano";
const EMBED_MODEL = process.env.MEM0_EMBED_MODEL || "text-embedding-3-small";

function sanitizeBaseUrl(url?: string) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const cleanPath = parsed.pathname.replace(/\/$/, "") || "/";
    return `${parsed.protocol}//${parsed.host}${cleanPath}`;
  } catch {
    return "invalid";
  }
}

const AUTH_MODE = HAS_OPENAI_API_KEY ? "api_key" : "local-default";
const OPENAI_BASE_URL_SANITIZED = sanitizeBaseUrl(OPENAI_BASE_URL);

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

const requireScopeSchema = z
  .object({
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id), {
    message: "One of user_id or run_id is required"
  });

const writeAliasSchema = z
  .object({
    text: z.string().trim().min(1),
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id), {
    message: "One of user_id or run_id is required"
  });

const searchAliasSchema = z
  .object({
    query: z.string().trim().min(1),
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().positive().max(100).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id), {
    message: "One of user_id or run_id is required"
  });

const ADD_RETRIES = Number(process.env.MEM0_ADD_RETRIES || 3);
const ADD_RETRY_DELAY_MS = Number(process.env.MEM0_ADD_RETRY_DELAY_MS || 250);

async function addWithRetries(
  messages: Array<{ role: string; content: string }>,
  opts: { userId?: string; runId?: string; metadata?: Record<string, unknown> }
) {
  let last: any = { results: [] };
  for (let attempt = 1; attempt <= Math.max(1, ADD_RETRIES); attempt++) {
    last = await memory.add(messages, { ...opts, output_format: "v1.1" } as any);
    if (Array.isArray(last?.results) && last.results.length > 0) return last;
    if (attempt < ADD_RETRIES) await new Promise((r) => setTimeout(r, ADD_RETRY_DELAY_MS));
  }
  return last;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "foxmemory-store",
    runtime: "node-ts",
    mem0: "oss",
    llmModel: LLM_MODEL,
    embedModel: EMBED_MODEL,
    diagnostics: {
      authMode: AUTH_MODE,
      openaiApiKeyConfigured: HAS_OPENAI_API_KEY,
      openaiBaseUrl: OPENAI_BASE_URL_SANITIZED
    }
  });
});

const addSchema = z
  .object({
    messages: z.array(z.object({ role: z.string(), content: z.string() })).min(1),
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional(),
    metadata: z.record(z.unknown()).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id), {
    message: "One of user_id or run_id is required"
  });

app.post("/v1/memories", async (req, res) => {
  try {
    const parsed = addSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const body = parsed.data;
    const result = await addWithRetries(body.messages, {
      userId: body.user_id,
      runId: body.run_id,
      metadata: body.metadata
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

const searchSchema = z
  .object({
    query: z.string().trim().min(1),
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional(),
    top_k: z.number().int().positive().max(100).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id), {
    message: "One of user_id or run_id is required"
  });

app.post("/v1/memories/search", async (req, res) => {
  try {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const body = parsed.data;
    const result = await memory.search(body.query, {
      userId: body.user_id,
      runId: body.run_id,
      limit: body.top_k
    } as any);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
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
  try {
    const parsed = requireScopeSchema.safeParse({
      user_id: req.query.user_id,
      run_id: req.query.run_id
    });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const userId = parsed.data.user_id as string | undefined;
    const runId = parsed.data.run_id as string | undefined;
    const result = await memory.getAll({ userId, runId } as any);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.delete("/v1/memories/:id", async (req, res) => {
  try {
    await memory.delete(req.params.id);
    res.json({ ok: true, id: req.params.id });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Back-compat aliases
app.post("/memory.write", async (req, res) => {
  try {
    const parsed = writeAliasSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { text, user_id, run_id } = parsed.data;
    const result = await addWithRetries([{ role: "user", content: text }], {
      userId: user_id,
      runId: run_id
    });
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/memory.search", async (req, res) => {
  try {
    const parsed = searchAliasSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { query, user_id, run_id, limit } = parsed.data;
    const result = await memory.search(query, {
      userId: user_id,
      runId: run_id,
      limit: limit ?? 5
    } as any);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`foxmemory-store listening on :${PORT}`);
  console.log(
    "foxmemory-store diagnostics",
    JSON.stringify(
      {
        authMode: AUTH_MODE,
        openaiApiKeyConfigured: HAS_OPENAI_API_KEY,
        openaiBaseUrl: OPENAI_BASE_URL_SANITIZED,
        llmModel: LLM_MODEL,
        embedModel: EMBED_MODEL,
        qdrantHost: process.env.QDRANT_HOST || null,
        qdrantPort: process.env.QDRANT_PORT ? Number(process.env.QDRANT_PORT) : null,
        qdrantCollection: process.env.QDRANT_COLLECTION || "foxmemory"
      },
      null,
      0
    )
  );
});

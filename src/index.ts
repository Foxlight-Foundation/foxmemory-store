import express from "express";
import { z } from "zod";
import { Memory } from "mem0ai/oss";
import { DatabaseSync } from "node:sqlite";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 8082);
const SERVICE_VERSION =
  process.env.HEALTH_VERSION ||
  process.env.SERVICE_VERSION ||
  process.env.IMAGE_DIGEST ||
  process.env.GIT_SHA ||
  "unknown";
const BUILD_COMMIT = process.env.GIT_SHA || process.env.BUILD_COMMIT || "unknown";
const BUILD_IMAGE_DIGEST = process.env.IMAGE_DIGEST || "unknown";
const BUILD_TIME = process.env.BUILD_TIME || "unknown";

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

const rawWriteSchema = z
  .object({
    text: z.string().trim().min(1),
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional(),
    metadata: z.record(z.unknown()).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id), {
    message: "One of user_id or run_id is required"
  });

const v2WriteSchema = z
  .object({
    text: z.string().trim().min(1).optional(),
    messages: z.array(z.object({ role: z.string(), content: z.string() })).min(1).optional(),
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional(),
    metadata: z.record(z.unknown()).optional(),
    infer_preferred: z.boolean().optional(),
    fallback_raw: z.boolean().optional(),
    idempotency_key: z.string().trim().min(1).max(255).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id), {
    message: "One of user_id or run_id is required"
  })
  .refine((v) => Boolean(v.text || (v.messages && v.messages.length)), {
    message: "Either text or messages is required"
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



type RuntimeStats = {
  startedAt: string;
  writesByMode: { infer: number; raw: number };
  memoryEvents: { ADD: number; UPDATE: number; DELETE: number; NONE: number };
  requests: { add: number; search: number; list: number; get: number; delete: number; update: number };
};

const runtimeStats: RuntimeStats = {
  startedAt: new Date().toISOString(),
  writesByMode: { infer: 0, raw: 0 },
  memoryEvents: { ADD: 0, UPDATE: 0, DELETE: 0, NONE: 0 },
  requests: { add: 0, search: 0, list: 0, get: 0, delete: 0, update: 0 },
};

function trackAddResult(mode: "infer" | "raw", result: any) {
  runtimeStats.writesByMode[mode] += 1;
  const rows = Array.isArray(result?.results) ? result.results : [];
  if (!rows.length) {
    runtimeStats.memoryEvents.NONE += 1;
    return;
  }
  for (const r of rows) {
    // mem0 OSS returns event in r.metadata.event; hosted returns r.event — handle both
    const ev = String(r?.metadata?.event || r?.event || '').toUpperCase();
    if (ev === 'ADD') runtimeStats.memoryEvents.ADD += 1;
    else if (ev === 'UPDATE') runtimeStats.memoryEvents.UPDATE += 1;
    else if (ev === 'DELETE') runtimeStats.memoryEvents.DELETE += 1;
    else runtimeStats.memoryEvents.NONE += 1;
  }
}

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
    version: SERVICE_VERSION,
    build: {
      commit: BUILD_COMMIT,
      imageDigest: BUILD_IMAGE_DIGEST,
      time: BUILD_TIME
    },
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

app.get("/health.version", (_req, res) => {
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


app.get("/stats", (_req, res) => {
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

    runtimeStats.requests.search += 1;
    const body = parsed.data;
    runtimeStats.requests.add += 1;
    const result = await addWithRetries(body.messages, {
      userId: body.user_id,
      runId: body.run_id,
      metadata: body.metadata
    });

    trackAddResult("infer", result);
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
    runtimeStats.requests.search += 1;
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
    runtimeStats.requests.get += 1;
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
    runtimeStats.requests.list += 1;
    const result = await memory.getAll({ userId, runId } as any);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.delete("/v1/memories/:id", async (req, res) => {
  try {
    runtimeStats.requests.delete += 1;
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
    runtimeStats.requests.add += 1;
    const result = await addWithRetries([{ role: "user", content: text }], {
      userId: user_id,
      runId: run_id
    });
    trackAddResult("infer", result);
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
    runtimeStats.requests.search += 1;
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

// Deterministic ingest lane: bypass LLM fact extraction (infer=false)
app.post("/memory.raw_write", async (req, res) => {
  try {
    const parsed = rawWriteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { text, user_id, run_id, metadata } = parsed.data;
    runtimeStats.requests.add += 1;
    const result = await memory.add([{ role: "user", content: text }], {
      userId: user_id,
      runId: run_id,
      metadata,
      infer: false
    } as any);
    trackAddResult("raw", result);
    res.json({ ok: true, deterministic: true, result });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// V2 contract: normalized envelope + explicit scope ergonomics.
const v2FilterSchema = z.record(z.unknown()).optional();
const v2UpdateSchema = z.object({
  text: z.string().trim().min(1),
  metadata: z.record(z.unknown()).optional(),
  idempotency_key: z.string().trim().min(1).max(255).optional()
});

const v2SearchSchema = z
  .object({
    query: z.string().trim().min(1),
    scope: z.enum(["session", "long-term", "all"]).optional(),
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional(),
    filters: v2FilterSchema,
    top_k: z.coerce.number().int().positive().max(100).optional(),
    threshold: z.coerce.number().min(0).max(1).optional(),
    keyword_search: z.boolean().optional(),
    reranking: z.boolean().optional(),
    rerank: z.boolean().optional(),
    fields: z.array(z.string()).optional(),
    source: z.string().trim().min(1).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id || v.scope === "all" || v.filters), {
    message: "One of user_id/run_id/filters is required unless scope=all"
  });

const v2ListSchema = z
  .object({
    scope: z.enum(["session", "long-term", "all"]).optional(),
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional(),
    filters: v2FilterSchema,
    page: z.coerce.number().int().positive().optional(),
    page_size: z.coerce.number().int().positive().max(500).optional(),
    fields: z.array(z.string()).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id || v.scope === "all" || v.filters), {
    message: "One of user_id/run_id/filters is required unless scope=all"
  });

type IdempotencyRecord = {
  fingerprint: string;
  status: number;
  responseBody: unknown;
  createdAt: number;
};

const IDEM_TTL_MS = Math.max(60_000, Number(process.env.IDEMPOTENCY_TTL_MS || 24 * 60 * 60 * 1000));
const idempotencyStore = new Map<string, IdempotencyRecord>();

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

function v2MutationFingerprint(routeKey: string, body: unknown): string {
  return `${routeKey}:${stableJson(body)}`;
}

function pruneIdempotencyStore(now = Date.now()) {
  for (const [key, row] of idempotencyStore.entries()) {
    if (now - row.createdAt > IDEM_TTL_MS) idempotencyStore.delete(key);
  }
}

function getIdempotencyKey(req: any): string | null {
  const raw =
    req?.header?.("Idempotency-Key") ||
    req?.header?.("idempotency-key") ||
    req?.headers?.["idempotency-key"] ||
    req?.body?.idempotency_key;
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return key.length ? key : null;
}

function idempotencyPrecheck(req: any, routeKey: string, payload: unknown):
  | { type: "none" }
  | { type: "replay"; status: number; body: unknown }
  | { type: "conflict"; message: string }
  | { type: "fresh"; key: string; fingerprint: string } {
  pruneIdempotencyStore();
  const key = getIdempotencyKey(req);
  if (!key) return { type: "none" };

  const fingerprint = v2MutationFingerprint(routeKey, payload);
  const existing = idempotencyStore.get(key);
  if (!existing) return { type: "fresh", key, fingerprint };

  if (existing.fingerprint !== fingerprint) {
    return {
      type: "conflict",
      message: "Idempotency key reuse with different request parameters"
    };
  }

  return { type: "replay", status: existing.status, body: existing.responseBody };
}

function idempotencyPersist(key: string, fingerprint: string, status: number, body: unknown) {
  idempotencyStore.set(key, {
    fingerprint,
    status,
    responseBody: body,
    createdAt: Date.now()
  });
}

function extractIdsFromFilters(filters: Record<string, unknown> | undefined): { user_id?: string; run_id?: string; orPairs?: Array<{user_id?: string; run_id?: string}> } {
  if (!filters || typeof filters !== 'object') return {};
  const out: any = {};
  const f: any = filters;
  if (typeof f.user_id === 'string' && f.user_id.trim()) out.user_id = f.user_id.trim();
  if (typeof f.run_id === 'string' && f.run_id.trim()) out.run_id = f.run_id.trim();
  if (Array.isArray(f.OR)) {
    const pairs = f.OR
      .map((x: any) => ({
        user_id: typeof x?.user_id === 'string' ? x.user_id : undefined,
        run_id: typeof x?.run_id === 'string' ? x.run_id : undefined
      }))
      .filter((x: any) => x.user_id || x.run_id);
    if (pairs.length) out.orPairs = pairs;
  }
  if (Array.isArray(f.AND)) {
    for (const x of f.AND) {
      if (!out.user_id && typeof x?.user_id === 'string') out.user_id = x.user_id;
      if (!out.run_id && typeof x?.run_id === 'string') out.run_id = x.run_id;
    }
  }
  return out;
}

function v2Ok(res: any, data: any, meta?: Record<string, unknown>) {
  return res.json({ ok: true, data, ...(meta ? { meta } : {}) });
}

function v2Err(res: any, status: number, code: string, message: string, details?: unknown) {
  const problemType = `https://docs.openclaw.ai/problems/${String(code || "INTERNAL_ERROR").toLowerCase()}`;
  return res.status(status).json({
    type: problemType,
    title: code,
    status,
    detail: message,
    ...(details ? { errors: details } : {}),
    ok: false
  });
}

function resolveScopeIds(input: { scope?: "session" | "long-term" | "all"; user_id?: string; run_id?: string }) {
  if (input.scope === "session") return { user_id: undefined, run_id: input.run_id };
  if (input.scope === "long-term") return { user_id: input.user_id, run_id: undefined };
  return { user_id: input.user_id, run_id: input.run_id };
}

async function v2Write(body: z.infer<typeof v2WriteSchema>) {
  const userId = body.user_id;
  const runId = body.run_id;
  const metadata = body.metadata;
  const inferPreferred = body.infer_preferred !== false;
  const fallbackRaw = body.fallback_raw !== false;
  const messages = body.messages?.length
    ? body.messages
    : [{ role: "user", content: String(body.text || "") }];

  let inferResult: any = { results: [] };
  let rawResult: any = null;

  if (inferPreferred) {
    inferResult = await addWithRetries(messages, {
      userId,
      runId,
      metadata
    });
    if (Array.isArray(inferResult?.results) && inferResult.results.length > 0) {
      trackAddResult("infer", inferResult);
      return {
        mode: "inferred",
        attempts: ADD_RETRIES,
        infer: { resultCount: inferResult.results.length },
        result: inferResult
      };
    }
  }

  if (!fallbackRaw) {
    runtimeStats.writesByMode.infer += 1;
    runtimeStats.memoryEvents.NONE += 1;
    return {
      mode: "none",
      attempts: inferPreferred ? ADD_RETRIES : 0,
      infer: { resultCount: Array.isArray(inferResult?.results) ? inferResult.results.length : 0 },
      result: inferResult
    };
  }

  const rawText = body.text?.trim()
    ? body.text
    : messages
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n")
        .slice(0, 4000);

  rawResult = await memory.add([{ role: "user", content: rawText }], {
    userId,
    runId,
    metadata,
    infer: false
  } as any);

  trackAddResult("raw", rawResult);
  return {
    mode: "fallback_raw",
    attempts: inferPreferred ? ADD_RETRIES : 0,
    infer: { resultCount: Array.isArray(inferResult?.results) ? inferResult.results.length : 0 },
    fallback: { resultCount: Array.isArray(rawResult?.results) ? rawResult.results.length : 0 },
    result: rawResult
  };
}

app.post("/v2/memory.write", async (req, res) => {
  try {
    const parsed = v2WriteSchema.safeParse(req.body);
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());

    const idem = idempotencyPrecheck(req, "POST:/v2/memory.write", parsed.data);
    if (idem.type === "conflict") return v2Err(res, 409, "IDEMPOTENCY_CONFLICT", idem.message);
    if (idem.type === "replay") return res.status(idem.status).json(idem.body);

    runtimeStats.requests.add += 1;
    const t0 = Date.now();
    const out = await v2Write(parsed.data);
    analyticsDb?.recordWriteResults({
      results: out.result?.results || [],
      inputChars: inputCharsFromBody(parsed.data),
      latencyMs: Date.now() - t0,
      inferMode: parsed.data.infer_preferred !== false,
    });
    const body = { ok: true, data: out };
    const status = 200;
    if (idem.type === "fresh") idempotencyPersist(idem.key, idem.fingerprint, status, body);
    return res.status(status).json(body);
  } catch (err: any) {
    return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
  }
});

app.post("/v2/memories", async (req, res) => {
  try {
    const parsed = v2WriteSchema.safeParse(req.body);
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());

    const idem = idempotencyPrecheck(req, "POST:/v2/memories", parsed.data);
    if (idem.type === "conflict") return v2Err(res, 409, "IDEMPOTENCY_CONFLICT", idem.message);
    if (idem.type === "replay") return res.status(idem.status).json(idem.body);

    runtimeStats.requests.add += 1;
    const t0 = Date.now();
    const out = await v2Write(parsed.data);
    analyticsDb?.recordWriteResults({
      results: out.result?.results || [],
      inputChars: inputCharsFromBody(parsed.data),
      latencyMs: Date.now() - t0,
      inferMode: parsed.data.infer_preferred !== false,
    });
    const body = { ok: true, data: out };
    const status = 200;
    if (idem.type === "fresh") idempotencyPersist(idem.key, idem.fingerprint, status, body);
    return res.status(status).json(body);
  } catch (err: any) {
    return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
  }
});

app.post("/v2/memories/search", async (req, res) => {
  try {
    const parsed = v2SearchSchema.safeParse(req.body);
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());

    const body = parsed.data;
    const fids = extractIdsFromFilters((body.filters as any) || undefined);
    const ids = resolveScopeIds({ ...body, user_id: body.user_id || fids.user_id, run_id: body.run_id || fids.run_id });
    const limit = body.top_k ?? 5;

    const runSearch = async (query: string, user_id?: string, run_id?: string) =>
      memory.search(query, {
        userId: user_id,
        runId: run_id,
        limit,
        threshold: body.threshold,
        keyword_search: body.keyword_search,
        reranking: body.reranking ?? body.rerank,
        source: body.source
      } as any);

    if (body.scope === "all" && !body.user_id && !body.run_id) {
      return v2Ok(res, { results: [] }, { scope: "all", count: 0 });
    }

    if (body.scope === "all" && body.user_id && body.run_id) {
      const t0 = Date.now();
      const [a, b] = await Promise.all([
        runSearch(body.query, body.user_id, undefined),
        runSearch(body.query, undefined, body.run_id)
      ]);
      const merged = [...(a?.results || []), ...(b?.results || [])];
      const dedup = Array.from(new Map(merged.map((r: any) => [r.id || JSON.stringify(r), r])).values()).slice(0, limit);
      const topScore = dedup[0]?.score ?? dedup[0]?.similarity ?? undefined;
      analyticsDb?.recordSearch({ user_id: body.user_id, run_id: body.run_id, queryChars: body.query.length, resultCount: dedup.length, topScore, latencyMs: Date.now() - t0 });
      return v2Ok(res, { results: dedup }, { scope: "all", count: dedup.length });
    }

    const t0 = Date.now();
    const result = await runSearch(body.query, ids.user_id, ids.run_id);
    const results = result?.results || [];
    const topScore = (results[0] as any)?.score ?? (results[0] as any)?.similarity ?? undefined;
    analyticsDb?.recordSearch({ user_id: ids.user_id, run_id: ids.run_id, queryChars: body.query.length, resultCount: results.length, topScore, latencyMs: Date.now() - t0 });
    return v2Ok(res, { results }, { scope: body.scope || "direct", count: results.length });
  } catch (err: any) {
    return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
  }
});

app.get("/v2/memories", async (req, res) => {
  try {
    const parsed = v2ListSchema.safeParse(req.query);
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid query", parsed.error.flatten());

    runtimeStats.requests.list += 1;
    const q = parsed.data;
    const ids = resolveScopeIds(q);

    if (q.scope === "all" && q.user_id && q.run_id) {
      const [a, b] = await Promise.all([
        memory.getAll({ userId: q.user_id } as any),
        memory.getAll({ runId: q.run_id } as any)
      ]);
      const merged = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
      const dedup = Array.from(new Map(merged.map((r: any) => [r.id || JSON.stringify(r), r])).values());
      return v2Ok(res, dedup.slice(0, q.page_size || dedup.length), { scope: "all", count: dedup.length });
    }

    const rows = await memory.getAll({ userId: ids.user_id, runId: ids.run_id } as any);
    const list = Array.isArray(rows) ? rows : [];
    return v2Ok(res, list.slice(0, q.page_size || list.length), { scope: q.scope || "direct", count: list.length });
  } catch (err: any) {
    return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
  }
});


app.post("/v2/memories/list", async (req, res) => {
  try {
    const parsed = v2ListSchema.safeParse(req.body || {});
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());

    const q = parsed.data;
    const fids = extractIdsFromFilters((q.filters as any) || undefined);
    const ids = resolveScopeIds({ ...q, user_id: q.user_id || fids.user_id, run_id: q.run_id || fids.run_id });

    if (q.scope === "all" && fids.orPairs?.length) {
      const buckets = await Promise.all(
        fids.orPairs.map((p) => memory.getAll({ userId: p.user_id, runId: p.run_id } as any))
      );
      const merged = buckets.flatMap((b: any) => (Array.isArray(b) ? b : []));
      const dedup = Array.from(new Map(merged.map((r: any) => [r.id || JSON.stringify(r), r])).values());
      return v2Ok(res, dedup.slice(0, q.page_size || dedup.length), { scope: "all", count: dedup.length });
    }

    const rows = await memory.getAll({ userId: ids.user_id, runId: ids.run_id } as any);
    const list = Array.isArray(rows) ? rows : [];
    return v2Ok(res, list.slice(0, q.page_size || list.length), { scope: q.scope || "direct", count: list.length });
  } catch (err: any) {
    return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
  }
});

app.get("/v2/memories/:id", async (req, res) => {
  try {
    runtimeStats.requests.get += 1;
    const row = await memory.get(req.params.id);
    return v2Ok(res, row);
  } catch (err: any) {
    return v2Err(res, 404, "NOT_FOUND", String(err?.message || err));
  }
});

app.put("/v2/memories/:id", async (req, res) => {
  try {
    const parsed = v2UpdateSchema.safeParse(req.body || {});
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());

    const idem = idempotencyPrecheck(req, `PUT:/v2/memories/${req.params.id}`, parsed.data);
    if (idem.type === "conflict") return v2Err(res, 409, "IDEMPOTENCY_CONFLICT", idem.message);
    if (idem.type === "replay") return res.status(idem.status).json(idem.body);

    runtimeStats.requests.update += 1;
    const t0 = Date.now();
    await memory.get(req.params.id);
    const updated = await (memory as any).update(req.params.id, parsed.data.text, parsed.data.metadata ? { metadata: parsed.data.metadata } : undefined);
    runtimeStats.memoryEvents.UPDATE += 1;
    analyticsDb?.recordWriteResults({
      results: [{ id: req.params.id, event: "UPDATE", memory: parsed.data.text }],
      inputChars: parsed.data.text.length,
      latencyMs: Date.now() - t0,
      inferMode: false,
    });
    const body = { ok: true, data: updated || { id: req.params.id, text: parsed.data.text } };
    const status = 200;
    if (idem.type === "fresh") idempotencyPersist(idem.key, idem.fingerprint, status, body);
    return res.status(status).json(body);
  } catch (err: any) {
    if (String(err?.message || err).toLowerCase().includes('not found') || String(err).includes('404') || String(err).includes('Bad Request')) {
      return v2Err(res, 404, "NOT_FOUND", String(err?.message || err));
    }
    return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
  }
});

app.delete("/v2/memories/:id", async (req, res) => {
  try {
    const payload = { id: req.params.id };
    const idem = idempotencyPrecheck(req, `DELETE:/v2/memories/${req.params.id}`, payload);
    if (idem.type === "conflict") return v2Err(res, 409, "IDEMPOTENCY_CONFLICT", idem.message);
    if (idem.type === "replay") return res.status(idem.status).json(idem.body);

    runtimeStats.requests.delete += 1;
    const t0 = Date.now();
    await memory.get(req.params.id);
    await memory.delete(req.params.id);
    runtimeStats.memoryEvents.DELETE += 1;
    analyticsDb?.recordWriteResults({
      results: [{ id: req.params.id, event: "DELETE" }],
      latencyMs: Date.now() - t0,
      inputChars: 0,
      inferMode: false,
    });
    const body = { ok: true, data: { id: req.params.id, deleted: true } };
    const status = 200;
    if (idem.type === "fresh") idempotencyPersist(idem.key, idem.fingerprint, status, body);
    return res.status(status).json(body);
  } catch (err: any) {
    if (String(err?.message || err).toLowerCase().includes('not found') || String(err).includes('404') || String(err).includes('Bad Request')) {
      return v2Err(res, 404, "NOT_FOUND", String(err?.message || err));
    }
    return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
  }
});

// ── v2 observability & analytics ──────────────────────────────────────────

app.get("/v2/health", (_req, res) => {
  return v2Ok(res, {
    service: "foxmemory-store",
    runtime: "node-ts",
    mem0: "oss",
    version: SERVICE_VERSION,
    build: { commit: BUILD_COMMIT, imageDigest: BUILD_IMAGE_DIGEST, time: BUILD_TIME },
    llmModel: LLM_MODEL,
    embedModel: EMBED_MODEL,
    diagnostics: {
      authMode: AUTH_MODE,
      openaiApiKeyConfigured: HAS_OPENAI_API_KEY,
      openaiBaseUrl: OPENAI_BASE_URL_SANITIZED,
    },
  }, { version: "v2" });
});

app.get("/v2/stats", (_req, res) => {
  const started = Date.parse(runtimeStats.startedAt);
  const uptimeSec = Number.isFinite(started) ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : null;
  return v2Ok(res, {
    startedAt: runtimeStats.startedAt,
    uptimeSec,
    writesByMode: runtimeStats.writesByMode,
    memoryEvents: runtimeStats.memoryEvents,
    requests: runtimeStats.requests,
  }, { version: "v2" });
});

// ── FoxAnalyticsDB — our own event log (SQLite, writable, persisted) ────────
//
// mem0's historyDbPath is not populated when using Qdrant as the vector store.
// We instrument every write/search ourselves so we get:
//   - ADD/UPDATE/DELETE/NONE counts with latency → noneRatePct surfaces model quality
//   - per-day breakdown for bar charts
//   - recent activity feed with extracted memory text
//   - search result counts and top scores
//
// Requires FOXMEMORY_ANALYTICS_DB_PATH to be on a mounted volume for persistence.

const ANALYTICS_DB_PATH = process.env.FOXMEMORY_ANALYTICS_DB_PATH || "/data/foxmemory-analytics.db";

class FoxAnalyticsDB {
  private db: DatabaseSync;
  ready = false;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS write_events (
        id         TEXT PRIMARY KEY,
        ts         TEXT NOT NULL,
        event_type TEXT NOT NULL,
        memory_id  TEXT,
        user_id    TEXT,
        run_id     TEXT,
        input_chars INTEGER,
        output_text TEXT,
        llm_model  TEXT,
        latency_ms INTEGER,
        infer_mode INTEGER DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_we_ts    ON write_events(ts);
      CREATE INDEX IF NOT EXISTS idx_we_event ON write_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_we_user  ON write_events(user_id);

      CREATE TABLE IF NOT EXISTS search_events (
        id           TEXT PRIMARY KEY,
        ts           TEXT NOT NULL,
        user_id      TEXT,
        run_id       TEXT,
        query_chars  INTEGER,
        result_count INTEGER,
        top_score    REAL,
        latency_ms   INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_se_ts ON search_events(ts);
    `);
    this.ready = true;
  }

  recordWriteResults(opts: {
    results: any[];
    user_id?: string;
    run_id?: string;
    inputChars: number;
    latencyMs: number;
    inferMode: boolean;
  }) {
    if (!this.ready) return;
    const ts = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT INTO write_events (id, ts, event_type, memory_id, user_id, run_id, input_chars, output_text, llm_model, latency_ms, infer_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    // If mem0 returned no results, record a single NONE row
    const rows = opts.results.length ? opts.results : [null];
    for (const r of rows) {
      const event = r ? String(r?.metadata?.event || r?.event || "NONE").toUpperCase() : "NONE";
      const memText = r?.memory ? String(r.memory).slice(0, 500) : null;
      try {
        stmt.run(
          crypto.randomUUID(), ts, event, r?.id ?? null,
          opts.user_id ?? null, opts.run_id ?? null,
          opts.inputChars, memText, LLM_MODEL,
          opts.latencyMs, opts.inferMode ? 1 : 0
        );
      } catch { /* non-critical — never crash the request */ }
    }
  }

  recordSearch(opts: {
    user_id?: string;
    run_id?: string;
    queryChars: number;
    resultCount: number;
    topScore?: number;
    latencyMs: number;
  }) {
    if (!this.ready) return;
    try {
      this.db.prepare(
        `INSERT INTO search_events (id, ts, user_id, run_id, query_chars, result_count, top_score, latency_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(), new Date().toISOString(),
        opts.user_id ?? null, opts.run_id ?? null,
        opts.queryChars, opts.resultCount, opts.topScore ?? null, opts.latencyMs
      );
    } catch { /* non-critical */ }
  }

  getStats(days: number) {
    if (!this.ready) return null;
    try {
      // All-time event counts
      const eventRows = this.db.prepare(
        `SELECT event_type, COUNT(*) as count FROM write_events GROUP BY event_type`
      ).all() as Array<{ event_type: string; count: number }>;

      const byEvent: Record<string, number> = { ADD: 0, UPDATE: 0, DELETE: 0, NONE: 0 };
      let total = 0;
      for (const r of eventRows) {
        byEvent[r.event_type] = (byEvent[r.event_type] ?? 0) + r.count;
        total += r.count;
      }
      const noneRatePct = total > 0 ? Math.round((byEvent.NONE / total) * 100) : 0;

      // Write latency summary
      const latRow = this.db.prepare(
        `SELECT AVG(latency_ms) as avg, MIN(latency_ms) as min, MAX(latency_ms) as max
         FROM write_events WHERE latency_ms IS NOT NULL`
      ).get() as any;

      // By day — event counts + avg latency per day in window
      const byDayRaw = this.db.prepare(`
        SELECT date(ts) as date, event_type, COUNT(*) as count,
               CAST(AVG(latency_ms) AS INTEGER) as avg_latency_ms
        FROM write_events
        WHERE ts >= datetime('now', '-' || ? || ' days')
        GROUP BY date(ts), event_type
        ORDER BY date(ts) ASC
      `).all(days) as Array<{ date: string; event_type: string; count: number; avg_latency_ms: number | null }>;

      const byDayMap = new Map<string, { date: string; ADD: number; UPDATE: number; DELETE: number; NONE: number; avgLatencyMs: number | null }>();
      for (const r of byDayRaw) {
        if (!byDayMap.has(r.date)) byDayMap.set(r.date, { date: r.date, ADD: 0, UPDATE: 0, DELETE: 0, NONE: 0, avgLatencyMs: null });
        const entry = byDayMap.get(r.date)!;
        if (r.event_type in entry) (entry as any)[r.event_type] += r.count;
        if (r.avg_latency_ms !== null) entry.avgLatencyMs = r.avg_latency_ms;
      }

      // Recent activity (last 20 write events, useful for activity feed)
      const recent = this.db.prepare(`
        SELECT ts, event_type, memory_id, user_id, run_id, output_text, latency_ms, infer_mode
        FROM write_events ORDER BY ts DESC LIMIT 20
      `).all() as any[];

      // Search summary
      const searchRow = this.db.prepare(`
        SELECT COUNT(*) as total,
               CAST(AVG(result_count) * 10 AS INTEGER) / 10.0 as avgResults,
               CAST(AVG(top_score) * 1000 AS INTEGER) / 1000.0 as avgTopScore,
               CAST(AVG(latency_ms) AS INTEGER) as avgLatencyMs
        FROM search_events
      `).get() as any;

      return {
        summary: {
          total,
          byEvent,
          noneRatePct,
          writeLatency: {
            avgMs: latRow?.avg ? Math.round(latRow.avg) : null,
            minMs: latRow?.min ?? null,
            maxMs: latRow?.max ?? null,
          },
          model: { llm: LLM_MODEL, embed: EMBED_MODEL },
        },
        byDay: Array.from(byDayMap.values()),
        recentActivity: recent.map((r: any) => ({
          ts: r.ts,
          event: r.event_type,
          memoryId: r.memory_id,
          userId: r.user_id,
          runId: r.run_id,
          preview: r.output_text ? (r.output_text as string).slice(0, 100) : null,
          latencyMs: r.latency_ms,
          inferMode: r.infer_mode === 1,
        })),
        searches: {
          total: searchRow?.total ?? 0,
          avgResults: searchRow?.avgResults ?? null,
          avgTopScore: searchRow?.avgTopScore ?? null,
          avgLatencyMs: searchRow?.avgLatencyMs ?? null,
        },
      };
    } catch (e) {
      console.error("[analytics] getStats error:", e);
      return null;
    }
  }
}

let analyticsDb: FoxAnalyticsDB | null = null;
try {
  analyticsDb = new FoxAnalyticsDB(ANALYTICS_DB_PATH);
} catch (e) {
  console.warn("[analytics] DB unavailable (set FOXMEMORY_ANALYTICS_DB_PATH to a writable path):", String(e));
}

// ── helper: compute input size (chars) from write body ──────────────────────
function inputCharsFromBody(body: { text?: string; messages?: Array<{ content: string }> }) {
  return (body.text?.length ?? 0) + (body.messages?.reduce((s, m) => s + m.content.length, 0) ?? 0);
}

const v2StatsMemoriesQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(30),
});

app.get("/v2/stats/memories", (req, res) => {
  const parsed = v2StatsMemoriesQuerySchema.safeParse(req.query);
  if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid query", parsed.error.flatten());

  const { days } = parsed.data;
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  const window = { days, from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };

  const stats = analyticsDb?.getStats(days) ?? null;

  if (!stats) {
    return v2Ok(res, {
      summary: {
        total: 0,
        byEvent: { ADD: 0, UPDATE: 0, DELETE: 0, NONE: 0 },
        noneRatePct: 0,
        writeLatency: { avgMs: null, minMs: null, maxMs: null },
        model: { llm: LLM_MODEL, embed: EMBED_MODEL },
      },
      byDay: [],
      recentActivity: [],
      searches: { total: 0, avgResults: null, avgTopScore: null, avgLatencyMs: null },
      _info: analyticsDb === null
        ? "Analytics DB unavailable. Mount a volume and set FOXMEMORY_ANALYTICS_DB_PATH to a writable path."
        : "No data yet — analytics accumulate as writes/searches occur.",
      window,
    }, { version: "v2" });
  }

  return v2Ok(res, { ...stats, window }, { version: "v2" });
});

// ── batch delete ───────────────────────────────────────────────────────────

const v2ForgetSchema = z.object({
  memory_ids: z.array(z.string().uuid()).min(1).max(1000),
  idempotency_key: z.string().trim().min(1).max(255).optional(),
});

app.post("/v2/memories/forget", async (req, res) => {
  try {
    const parsed = v2ForgetSchema.safeParse(req.body);
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());

    const idem = idempotencyPrecheck(req, "POST:/v2/memories/forget", parsed.data);
    if (idem.type === "conflict") return v2Err(res, 409, "IDEMPOTENCY_CONFLICT", idem.message);
    if (idem.type === "replay") return res.status(idem.status).json(idem.body);

    const { memory_ids } = parsed.data;
    const deleted: string[] = [];
    for (const id of memory_ids) {
      await memory.delete(id);
      deleted.push(id);
    }
    runtimeStats.requests.delete += deleted.length;

    const body = { ok: true, data: { deleted, count: deleted.length } };
    if (idem.type === "fresh") idempotencyPersist(idem.key, idem.fingerprint, 200, body);
    return res.json(body);
  } catch (err: any) {
    return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
  }
});

// ── OpenAPI spec ───────────────────────────────────────────────────────────

const V2_OPENAPI_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "foxmemory-store v2 API",
    description: "Normalized memory persistence API. Success: { ok, data, meta }. Error: { type, title, status, detail, ok: false }.",
    version: "2.0.0",
  },
  servers: [{ url: "/v2", description: "v2 API" }],
  components: {
    schemas: {
      OkEnvelope: {
        type: "object",
        properties: { ok: { type: "boolean", example: true }, data: {}, meta: { type: "object" } },
      },
      ErrorEnvelope: {
        type: "object",
        properties: {
          ok: { type: "boolean", example: false },
          type: { type: "string" },
          title: { type: "string" },
          status: { type: "integer" },
          detail: { type: "string" },
          errors: {},
        },
      },
      Message: {
        type: "object",
        required: ["role", "content"],
        properties: { role: { type: "string" }, content: { type: "string" } },
      },
    },
  },
  paths: {
    "/health": { get: { summary: "Service health (v2 envelope)", operationId: "v2Health", responses: { "200": { description: "Health data" } } } },
    "/stats": { get: { summary: "Runtime counters (v2 envelope)", operationId: "v2Stats", responses: { "200": { description: "Stats data" } } } },
    "/openapi.json": { get: { summary: "This spec", operationId: "v2OpenAPI", responses: { "200": { description: "OpenAPI 3.0 JSON" } } } },
    "/stats/memories": {
      get: {
        summary: "SQLite history DB analytics — byDay bar chart, summary totals, activity feed",
        operationId: "v2StatsMemories",
        parameters: [{ name: "days", in: "query", schema: { type: "integer", minimum: 1, maximum: 365, default: 30 } }],
        responses: { "200": { description: "Memory analytics" }, "400": { description: "Validation error" } },
      },
    },
    "/memories": {
      post: {
        summary: "Add/infer memories (with optional raw fallback and idempotency)",
        operationId: "v2AddMemories",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: {
          messages: { type: "array", items: { $ref: "#/components/schemas/Message" } },
          text: { type: "string" },
          user_id: { type: "string" }, run_id: { type: "string" },
          metadata: { type: "object" },
          infer_preferred: { type: "boolean" }, fallback_raw: { type: "boolean" },
          idempotency_key: { type: "string" },
        } } } } },
        responses: { "200": { description: "Write result" }, "400": { description: "Validation error" }, "409": { description: "Idempotency conflict" } },
      },
      get: {
        summary: "List memories",
        operationId: "v2ListMemories",
        parameters: [
          { name: "user_id", in: "query", schema: { type: "string" } },
          { name: "run_id", in: "query", schema: { type: "string" } },
          { name: "scope", in: "query", schema: { type: "string", enum: ["session", "long-term", "all"] } },
          { name: "page_size", in: "query", schema: { type: "integer", minimum: 1, maximum: 500 } },
        ],
        responses: { "200": { description: "Memory list" }, "400": { description: "Validation error" } },
      },
    },
    "/memories/list": {
      post: {
        summary: "List memories (body-based, supports filters/OR)",
        operationId: "v2ListMemoriesPost",
        responses: { "200": { description: "Memory list" }, "400": { description: "Validation error" } },
      },
    },
    "/memories/search": {
      post: {
        summary: "Semantic search",
        operationId: "v2SearchMemories",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["query"], properties: {
          query: { type: "string" },
          user_id: { type: "string" }, run_id: { type: "string" },
          scope: { type: "string", enum: ["session", "long-term", "all"] },
          top_k: { type: "integer", minimum: 1, maximum: 100 },
          threshold: { type: "number", minimum: 0, maximum: 1 },
          keyword_search: { type: "boolean" }, reranking: { type: "boolean" },
          source: { type: "string" },
        } } } } },
        responses: { "200": { description: "Search results" }, "400": { description: "Validation error" } },
      },
    },
    "/memories/forget": {
      post: {
        summary: "Batch delete up to 1000 memories by ID",
        operationId: "v2ForgetMemories",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["memory_ids"], properties: {
          memory_ids: { type: "array", items: { type: "string", format: "uuid" }, minItems: 1, maxItems: 1000 },
          idempotency_key: { type: "string" },
        } } } } },
        responses: { "200": { description: "{ deleted: uuid[], count: number }" }, "400": { description: "Validation error" }, "409": { description: "Idempotency conflict" } },
      },
    },
    "/memory.write": {
      post: {
        summary: "Add memories — alias for POST /memories",
        operationId: "v2MemoryWrite",
        responses: { "200": { description: "Write result" } },
      },
    },
    "/memories/{id}": {
      get: { summary: "Get memory by ID", operationId: "v2GetMemory", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Memory object" }, "404": { description: "Not found" } } },
      put: { summary: "Update memory text", operationId: "v2UpdateMemory", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Updated" }, "404": { description: "Not found" }, "409": { description: "Idempotency conflict" } } },
      delete: { summary: "Delete memory by ID", operationId: "v2DeleteMemory", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Deleted" }, "404": { description: "Not found" } } },
    },
  },
} as const;

app.get("/v2/openapi.json", (_req, res) => {
  res.json(V2_OPENAPI_SPEC);
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

import express from "express";
import { z } from "zod";
import { Memory } from "mem0ai/oss";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 8082);
const SERVICE_VERSION = process.env.SERVICE_VERSION || process.env.GIT_SHA || "unknown";

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
    const ev = String(r?.event || '').toUpperCase();
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
    const out = await v2Write(parsed.data);
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
    const out = await v2Write(parsed.data);
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
      const [a, b] = await Promise.all([
        runSearch(body.query, body.user_id, undefined),
        runSearch(body.query, undefined, body.run_id)
      ]);
      const merged = [...(a?.results || []), ...(b?.results || [])];
      const dedup = Array.from(new Map(merged.map((r: any) => [r.id || JSON.stringify(r), r])).values()).slice(0, limit);
      return v2Ok(res, { results: dedup }, { scope: "all", count: dedup.length });
    }

    const result = await runSearch(body.query, ids.user_id, ids.run_id);
    return v2Ok(res, { results: result?.results || [] }, { scope: body.scope || "direct", count: (result?.results || []).length });
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
    await memory.get(req.params.id);
    const updated = await (memory as any).update(req.params.id, parsed.data.text, parsed.data.metadata ? { metadata: parsed.data.metadata } : undefined);
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
    await memory.get(req.params.id);
    await memory.delete(req.params.id);
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

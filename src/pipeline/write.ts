import { z } from "zod";
import express from "express";
import { randomUUID } from "node:crypto";
import type { Memory } from "@foxlight-foundation/mem0ai/oss";
import {
  runtimeStats,
  ADD_RETRIES,
  GRAPH_ENABLED,
  ASYNC_JOB_MAX,
} from "../config/env.js";
import { getMemory } from "../memory/factory.js";
import { analyticsDb } from "../analytics/db.js";
import { v2WriteSchema } from "../schemas/index.js";
import { v2Ok, v2Err } from "../utils/response.js";
import { inputCharsFromBody } from "../utils/inputChars.js";
import { idempotencyPrecheck, idempotencyPersist } from "../middleware/idempotency.js";
import { shouldSkipWrite } from "./writeGate.js";
import { addWithRetries } from "./retry.js";
import { asyncJobs, type AsyncJob } from "./asyncJobs.js";

export const trackAddResult = (mode: "infer" | "raw", result: any) => {
  runtimeStats.writesByMode[mode] += 1;
  const rows = Array.isArray(result?.results) ? result.results : [];
  if (!rows.length) {
    runtimeStats.memoryEvents.NONE += 1;
    return;
  }
  for (const r of rows) {
    const ev = String(r?.metadata?.event || r?.event || '').toUpperCase();
    if (ev === 'ADD') runtimeStats.memoryEvents.ADD += 1;
    else if (ev === 'UPDATE') runtimeStats.memoryEvents.UPDATE += 1;
    else if (ev === 'DELETE') runtimeStats.memoryEvents.DELETE += 1;
    else runtimeStats.memoryEvents.NONE += 1;
  }
};

export const captureGraphLinks = (result: any, userId?: string, agentId?: string) => {
  if (!analyticsDb?.ready || !GRAPH_ENABLED) return;
  const nodeIds: string[] = result?.added_node_ids ?? [];
  const edgeIds: string[] = result?.added_edge_ids ?? [];
  if (!nodeIds.length && !edgeIds.length) return;
  const rows = Array.isArray(result?.results) ? result.results : [];
  for (const r of rows) {
    const ev = String(r?.metadata?.event || r?.event || "").toUpperCase();
    if (ev === "ADD" || ev === "UPDATE") {
      const memId = r?.id ?? r?.memory_id;
      if (memId) analyticsDb.insertGraphLinks(memId, nodeIds, edgeIds, userId, agentId);
    }
  }
};

export const v2Write = async (body: z.infer<typeof v2WriteSchema>, memoryOverride?: Memory) => {
  const memory = memoryOverride ?? getMemory();
  const userId = body.user_id;
  const runId = body.run_id;
  const metadata = body.metadata;
  const inferPreferred = body.infer_preferred !== false;
  const messages = body.messages?.length
    ? body.messages
    : [{ role: "user", content: String(body.text || "") }];

  const skipReason = shouldSkipWrite(messages);
  if (skipReason) {
    console.log(`[write-gate] skipped write: ${skipReason}`);
    runtimeStats.writesByMode.infer += 1;
    runtimeStats.memoryEvents.NONE += 1;
    return {
      mode: "skipped",
      skip_reason: skipReason,
      result: { results: [] },
      decisions: null,
    };
  }

  let inferResult: any = { results: [] };
  let rawResult: any = null;

  if (inferPreferred) {
    inferResult = await addWithRetries(messages, {
      userId,
      runId,
      metadata
    }, memoryOverride);
    const hasResults = Array.isArray(inferResult?.results) && inferResult.results.length > 0;
    if (hasResults) {
      trackAddResult("infer", inferResult);
      captureGraphLinks(inferResult, userId);
    } else {
      runtimeStats.writesByMode.infer += 1;
      runtimeStats.memoryEvents.NONE += 1;
    }
    return {
      mode: hasResults ? "inferred" : "none",
      attempts: ADD_RETRIES,
      infer: { resultCount: hasResults ? inferResult.results.length : 0 },
      result: inferResult,
      decisions: inferResult?.decisions ?? null,
      ...(GRAPH_ENABLED && hasResults ? { relations: inferResult.relations || [], added_entities: inferResult.added_entities || [] } : {}),
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
  captureGraphLinks(rawResult, userId);
  return {
    mode: "raw",
    attempts: 0,
    infer: { resultCount: 0 },
    result: rawResult,
    decisions: rawResult?.decisions ?? null,
    ...(GRAPH_ENABLED ? { relations: rawResult?.relations || [], added_entities: rawResult?.added_entities || [] } : {}),
  };
};

export const executeWriteAndRecord = async (
  parsed: z.infer<typeof v2WriteSchema>,
  idem: ReturnType<typeof idempotencyPrecheck>,
  memoryOverride?: Memory,
  agentId?: string,
): Promise<{ status: number; body: any }> => {
  const t0 = Date.now();
  const out = await v2Write(parsed, memoryOverride);
  const latencyMs = Date.now() - t0;
  analyticsDb?.recordWriteResults({
    results: out.result?.results || [],
    inputChars: inputCharsFromBody(parsed),
    latencyMs,
    inferMode: parsed.infer_preferred !== false,
    decisions: (out as any).decisions ?? undefined,
    agentId,
  });
  if (GRAPH_ENABLED) {
    const graphRelations: any[] = (out as any).relations || [];
    const addedEntities: any[] = (out as any).added_entities || [];
    analyticsDb?.recordGraphWrite({
      user_id: parsed.user_id,
      run_id: parsed.run_id,
      entitiesAdded: addedEntities.length,
      relationsAdded: graphRelations.length,
      latencyMs,
      agentId,
    });
  }
  const body = { ok: true, data: out };
  const status = 200;
  if (idem.type === "fresh") idempotencyPersist(idem.key, idem.fingerprint, status, body);
  return { status, body };
};

export const handleV2Write = async (
  req: express.Request,
  res: express.Response,
  route: string,
  memoryOverride?: Memory,
) => {
  try {
    const parsed = v2WriteSchema.safeParse(req.body);
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());

    const idem = idempotencyPrecheck(req, route, parsed.data);
    if (idem.type === "conflict") return v2Err(res, 409, "IDEMPOTENCY_CONFLICT", idem.message);
    if (idem.type === "replay") return res.status(idem.status).json(idem.body);

    runtimeStats.requests.add += 1;

    const reqAgentId = (req as any).agent?.id as string | undefined;

    if (parsed.data.async) {
      const inFlightCount = [...asyncJobs.values()].filter(j => j.status === "pending" || j.status === "running").length;
      if (inFlightCount >= ASYNC_JOB_MAX) {
        return v2Err(res, 429, "TOO_MANY_JOBS", `Max ${ASYNC_JOB_MAX} concurrent async jobs. Try again later.`);
      }

      const jobId = randomUUID();
      const job: AsyncJob = {
        id: jobId,
        status: "pending",
        created_at: new Date().toISOString(),
        completed_at: null,
        result: null,
        error: null,
      };
      asyncJobs.set(jobId, job);

      const acceptedBody = {
        ok: true,
        data: { job_id: jobId, status: "pending" },
        meta: { version: "v2", async: true },
      };
      if (idem.type === "fresh") idempotencyPersist(idem.key, idem.fingerprint, 202, acceptedBody);

      (async () => {
        job.status = "running";
        try {
          const noopIdem = { type: "none" as const };
          const { body } = await executeWriteAndRecord(parsed.data, noopIdem, memoryOverride, reqAgentId);
          job.status = "completed";
          job.completed_at = new Date().toISOString();
          job.result = body.data;
        } catch (err: any) {
          job.status = "failed";
          job.completed_at = new Date().toISOString();
          job.error = String(err?.message || err);
          console.error(`[async-job] ${jobId} failed:`, job.error);
        }
      })();

      return res.status(202).json(acceptedBody);
    }

    const { status, body } = await executeWriteAndRecord(parsed.data, idem, memoryOverride, reqAgentId);
    return res.status(status).json(body);
  } catch (err: any) {
    return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
  }
};

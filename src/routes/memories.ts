import { Router } from "express";
import { runtimeStats, GRAPH_ENABLED } from "../config/env.js";
import { getMemory } from "../memory/factory.js";
import { analyticsDb } from "../analytics/db.js";
import { v2Ok, v2Err, extractIdsFromFilters } from "../utils/response.js";
import { graphSession } from "../utils/graph.js";
import { idempotencyPrecheck, idempotencyPersist } from "../middleware/idempotency.js";
import { handleV2Write, trackAddResult, captureGraphLinks } from "../pipeline/write.js";
import { addWithRetries } from "../pipeline/retry.js";
import {
  addSchema,
  searchSchema,
  requireScopeSchema,
  writeAliasSchema,
  searchAliasSchema,
  rawWriteSchema,
  v2SearchSchema,
  v2ListSchema,
  v2UpdateSchema,
  v2ForgetSchema,
} from "../schemas/index.js";

const resolveScopeIds = (input: { scope?: "session" | "long-term" | "all"; user_id?: string; run_id?: string }) => {
  if (input.scope === "session") return { user_id: undefined, run_id: input.run_id };
  if (input.scope === "long-term") return { user_id: input.user_id, run_id: undefined };
  return { user_id: input.user_id, run_id: input.run_id };
};

export const createMemoriesRouter = () => {
  const router = Router();

  router.post("/v1/memories", async (req, res) => {
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
      captureGraphLinks(result, body.user_id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  router.post("/v1/memories/search", async (req, res) => {
    try {
      const parsed = searchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const body = parsed.data;
      runtimeStats.requests.search += 1;
      const memory = getMemory();
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

  router.get("/v1/memories/:id", async (req, res) => {
    try {
      runtimeStats.requests.get += 1;
      const memory = getMemory();
      const result = await memory.get(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(404).json({ error: String(err) });
    }
  });

  router.get("/v1/memories", async (req, res) => {
    try {
      const parsed = requireScopeSchema.safeParse({
        user_id: req.query.user_id,
        run_id: req.query.run_id
      });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const userId = parsed.data.user_id as string | undefined;
      const runId = parsed.data.run_id as string | undefined;
      runtimeStats.requests.list += 1;
      const memory = getMemory();
      const result = await memory.getAll({ userId, runId } as any);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  router.delete("/v1/memories/:id", async (req, res) => {
    try {
      runtimeStats.requests.delete += 1;
      const memory = getMemory();
      await memory.delete(req.params.id);
      res.json({ ok: true, id: req.params.id });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  router.post("/memory.write", async (req, res) => {
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

  router.post("/memory.search", async (req, res) => {
    try {
      const parsed = searchAliasSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const { query, user_id, run_id, limit } = parsed.data;
      runtimeStats.requests.search += 1;
      const memory = getMemory();
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

  router.post("/memory.raw_write", async (req, res) => {
    try {
      const parsed = rawWriteSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const { text, user_id, run_id, metadata } = parsed.data;
      runtimeStats.requests.add += 1;
      const memory = getMemory();
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

  router.post("/v2/memory.write", (req, res) => handleV2Write(req, res, "POST:/v2/memory.write"));
  router.post("/v2/memories", (req, res) => handleV2Write(req, res, "POST:/v2/memories"));

  router.post("/v2/memories/search", async (req, res) => {
    try {
      const parsed = v2SearchSchema.safeParse(req.body);
      if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());

      const body = parsed.data;
      const fids = extractIdsFromFilters((body.filters as any) || undefined);
      const ids = resolveScopeIds({ ...body, user_id: body.user_id || fids.user_id, run_id: body.run_id || fids.run_id });
      const limit = body.top_k ?? 5;

      const memory = getMemory();
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
        const relations = [...(a?.relations || []), ...(b?.relations || [])];
        const topScore = dedup[0]?.score ?? dedup[0]?.similarity ?? undefined;
        analyticsDb?.recordSearch({ user_id: body.user_id, run_id: body.run_id, queryChars: body.query.length, resultCount: dedup.length, topScore, latencyMs: Date.now() - t0, graphHit: relations.length > 0 });
        return v2Ok(res, { results: dedup, ...(GRAPH_ENABLED ? { relations } : {}) }, { scope: "all", count: dedup.length });
      }

      const t0 = Date.now();
      const result = await runSearch(body.query, ids.user_id, ids.run_id);
      const results = result?.results || [];
      const relations = result?.relations || [];
      const topScore = (results[0] as any)?.score ?? (results[0] as any)?.similarity ?? undefined;
      analyticsDb?.recordSearch({ user_id: ids.user_id, run_id: ids.run_id, queryChars: body.query.length, resultCount: results.length, topScore, latencyMs: Date.now() - t0, graphHit: relations.length > 0 });
      return v2Ok(res, { results, ...(GRAPH_ENABLED ? { relations } : {}) }, { scope: body.scope || "direct", count: results.length });
    } catch (err: any) {
      return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
    }
  });

  router.get("/v2/memories", async (req, res) => {
    try {
      const parsed = v2ListSchema.safeParse(req.query);
      if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid query", parsed.error.flatten());

      runtimeStats.requests.list += 1;
      const q = parsed.data;
      const ids = resolveScopeIds(q);
      const memory = getMemory();

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

  router.post("/v2/memories/list", async (req, res) => {
    try {
      const parsed = v2ListSchema.safeParse(req.body || {});
      if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());

      const q = parsed.data;
      const fids = extractIdsFromFilters((q.filters as any) || undefined);
      const ids = resolveScopeIds({ ...q, user_id: q.user_id || fids.user_id, run_id: q.run_id || fids.run_id });
      const memory = getMemory();

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

  router.get("/v2/memories/:id", async (req, res) => {
    try {
      runtimeStats.requests.get += 1;
      const memory = getMemory();
      const row = await memory.get(req.params.id);
      return v2Ok(res, row);
    } catch (err: any) {
      return v2Err(res, 404, "NOT_FOUND", String(err?.message || err));
    }
  });

  router.put("/v2/memories/:id", async (req, res) => {
    try {
      const parsed = v2UpdateSchema.safeParse(req.body || {});
      if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());

      const idem = idempotencyPrecheck(req, `PUT:/v2/memories/${req.params.id}`, parsed.data);
      if (idem.type === "conflict") return v2Err(res, 409, "IDEMPOTENCY_CONFLICT", idem.message);
      if (idem.type === "replay") return res.status(idem.status).json(idem.body);

      runtimeStats.requests.update += 1;
      const t0 = Date.now();
      const memory = getMemory();
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

  router.delete("/v2/memories/:id", async (req, res) => {
    try {
      const payload = { id: req.params.id };
      const idem = idempotencyPrecheck(req, `DELETE:/v2/memories/${req.params.id}`, payload);
      if (idem.type === "conflict") return v2Err(res, 409, "IDEMPOTENCY_CONFLICT", idem.message);
      if (idem.type === "replay") return res.status(idem.status).json(idem.body);

      runtimeStats.requests.delete += 1;
      const t0 = Date.now();
      const memory = getMemory();
      await memory.get(req.params.id);

      const memId = req.params.id;
      const cascadeRequested = req.query.cascade_graph === "true";

      let cascadeEdgeIds: string[] = [];
      let cascadeNodeIds: string[] = [];
      if (cascadeRequested && GRAPH_ENABLED && analyticsDb?.ready) {
        const linkedNodeIds = analyticsDb.getLinkedNodeIds(memId);
        const linkedEdgeIds = analyticsDb.getLinkedEdgeIds(memId);
        if (linkedNodeIds.length || linkedEdgeIds.length) {
          cascadeEdgeIds = linkedEdgeIds.filter(
            (eid) => analyticsDb!.otherMemoriesForEdge(eid, memId) === 0
          );
          cascadeNodeIds = linkedNodeIds.filter(
            (nid) => analyticsDb!.otherMemoriesForNode(nid, memId) === 0
          );
        }
      }

      await memory.delete(memId);

      if (cascadeEdgeIds.length || cascadeNodeIds.length) {
        try {
          await graphSession(async (session) => {
            if (cascadeEdgeIds.length) {
              await session.run(
                "UNWIND $ids AS eid MATCH ()-[r]-() WHERE elementId(r) = eid DELETE r",
                { ids: cascadeEdgeIds }
              );
            }
            if (cascadeNodeIds.length) {
              await session.run(
                "UNWIND $ids AS nid MATCH (n) WHERE elementId(n) = nid AND NOT (n)--() DELETE n",
                { ids: cascadeNodeIds }
              );
            }
          });
        } catch (graphErr: any) {
          console.warn("[cascade-delete] graph cleanup failed:", graphErr?.message || graphErr);
        }
      }

      analyticsDb?.deleteLinksForMemory(memId);

      runtimeStats.memoryEvents.DELETE += 1;
      analyticsDb?.recordWriteResults({
        results: [{ id: memId, event: "DELETE" }],
        latencyMs: Date.now() - t0,
        inputChars: 0,
        inferMode: false,
      });
      const body = {
        ok: true,
        data: {
          id: memId,
          deleted: true,
          graph_cascade: cascadeRequested && GRAPH_ENABLED
            ? { edges_deleted: cascadeEdgeIds.length, nodes_deleted: cascadeNodeIds.length }
            : undefined,
        },
      };
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

  router.post("/v2/memories/forget", async (req, res) => {
    try {
      const parsed = v2ForgetSchema.safeParse(req.body);
      if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());

      const idem = idempotencyPrecheck(req, "POST:/v2/memories/forget", parsed.data);
      if (idem.type === "conflict") return v2Err(res, 409, "IDEMPOTENCY_CONFLICT", idem.message);
      if (idem.type === "replay") return res.status(idem.status).json(idem.body);

      const { memory_ids, cascade_graph } = parsed.data;
      const deleted: string[] = [];
      let totalEdgesDeleted = 0;
      let totalNodesDeleted = 0;
      const memory = getMemory();

      for (const id of memory_ids) {
        let cascadeEdgeIds: string[] = [];
        let cascadeNodeIds: string[] = [];
        if (cascade_graph && GRAPH_ENABLED && analyticsDb?.ready) {
          const linkedNodeIds = analyticsDb.getLinkedNodeIds(id);
          const linkedEdgeIds = analyticsDb.getLinkedEdgeIds(id);
          if (linkedNodeIds.length || linkedEdgeIds.length) {
            cascadeEdgeIds = linkedEdgeIds.filter(
              (eid) => analyticsDb!.otherMemoriesForEdge(eid, id) === 0
            );
            cascadeNodeIds = linkedNodeIds.filter(
              (nid) => analyticsDb!.otherMemoriesForNode(nid, id) === 0
            );
          }
        }

        await memory.delete(id);

        if (cascadeEdgeIds.length || cascadeNodeIds.length) {
          try {
            await graphSession(async (session) => {
              if (cascadeEdgeIds.length) {
                await session.run(
                  "UNWIND $ids AS eid MATCH ()-[r]-() WHERE elementId(r) = eid DELETE r",
                  { ids: cascadeEdgeIds }
                );
              }
              if (cascadeNodeIds.length) {
                await session.run(
                  "UNWIND $ids AS nid MATCH (n) WHERE elementId(n) = nid AND NOT (n)--() DELETE n",
                  { ids: cascadeNodeIds }
                );
              }
            });
            totalEdgesDeleted += cascadeEdgeIds.length;
            totalNodesDeleted += cascadeNodeIds.length;
          } catch (graphErr: any) {
            console.warn(`[cascade-delete] graph cleanup failed for ${id}:`, graphErr?.message || graphErr);
          }
        }

        analyticsDb?.deleteLinksForMemory(id);
        deleted.push(id);
      }
      runtimeStats.requests.delete += deleted.length;

      const body = {
        ok: true,
        data: {
          deleted,
          count: deleted.length,
          graph_cascade: cascade_graph && GRAPH_ENABLED
            ? { edges_deleted: totalEdgesDeleted, nodes_deleted: totalNodesDeleted }
            : undefined,
        },
      };
      if (idem.type === "fresh") idempotencyPersist(idem.key, idem.fingerprint, 200, body);
      return res.json(body);
    } catch (err: any) {
      return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
    }
  });

  return router;
};

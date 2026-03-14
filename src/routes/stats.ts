import { Router } from "express";
import { runtimeStats, effectiveLlmModel, EMBED_MODEL } from "../config/env.js";
import { analyticsDb } from "../analytics/db.js";
import { v2Ok, v2Err } from "../utils/response.js";
import { v2StatsMemoriesQuerySchema, v2WriteEventsQuerySchema } from "../schemas/index.js";

export const createStatsRouter = () => {
  const router = Router();

  router.get("/v2/stats", (_req, res) => {
    const started = Date.parse(runtimeStats.startedAt);
    const uptimeSec = Number.isFinite(started) ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : null;

    let writesByMode = runtimeStats.writesByMode;
    let memoryEvents = runtimeStats.memoryEvents;
    if (analyticsDb?.ready) {
      try {
        const db = (analyticsDb as any).db;
        const modeRow = db.prepare(
          `SELECT
             SUM(CASE WHEN infer_mode = 1 THEN 1 ELSE 0 END) AS infer,
             SUM(CASE WHEN infer_mode = 0 THEN 1 ELSE 0 END) AS raw
           FROM (
             SELECT COALESCE(call_id, id) AS call_key, MAX(infer_mode) AS infer_mode
             FROM write_events
             GROUP BY call_key
           )`
        ).get() as any;
        writesByMode = { infer: Number(modeRow?.infer ?? 0), raw: Number(modeRow?.raw ?? 0) };

        const events = db.prepare(
          `SELECT event_type, COUNT(*) AS n FROM write_events GROUP BY event_type`
        ).all() as any[];
        memoryEvents = { ADD: 0, UPDATE: 0, DELETE: 0, NONE: 0 };
        for (const r of events) {
          if (r.event_type in memoryEvents) (memoryEvents as any)[r.event_type] = Number(r.n);
        }
      } catch {
        // fall through to runtime counters
      }
    }

    return v2Ok(res, {
      startedAt: runtimeStats.startedAt,
      uptimeSec,
      writesByMode,
      memoryEvents,
      requests: runtimeStats.requests,
    }, { version: "v2" });
  });

  router.get("/v2/stats/memories", (req, res) => {
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
          model: { llm: effectiveLlmModel, embed: EMBED_MODEL },
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

  router.get("/v2/write-events", (req, res) => {
    const parsed = v2WriteEventsQuerySchema.safeParse(req.query);
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid query", parsed.error.flatten());
    if (!analyticsDb?.ready) return v2Err(res, 503, "SERVICE_UNAVAILABLE", "Analytics DB not available");

    try {
      const { user_id, run_id, memory_id, event_type, limit, before } = parsed.data;
      const conditions: string[] = [];
      const params: any[] = [];

      if (user_id)    { conditions.push("user_id = ?");    params.push(user_id); }
      if (run_id)     { conditions.push("run_id = ?");     params.push(run_id); }
      if (memory_id)  { conditions.push("memory_id = ?");  params.push(memory_id); }
      if (event_type) { conditions.push("event_type = ?"); params.push(event_type); }
      if (before)     { conditions.push("ts < ?");         params.push(before); }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      params.push(limit);

      const rows = (analyticsDb as any).db.prepare(
        `SELECT id, ts, event_type, memory_id, user_id, run_id, output_text,
                reason, extracted_facts_json, candidates_json, call_id, latency_ms, infer_mode
         FROM write_events ${where}
         ORDER BY ts DESC
         LIMIT ?`
      ).all(...params) as any[];

      const events = rows.map((r: any) => ({
        id: r.id,
        ts: r.ts,
        event_type: r.event_type,
        memory_id: r.memory_id,
        user_id: r.user_id,
        run_id: r.run_id,
        memory_text: r.output_text,
        reason: r.reason ?? null,
        extracted_facts: r.extracted_facts_json ? JSON.parse(r.extracted_facts_json) : null,
        candidates: r.candidates_json ? JSON.parse(r.candidates_json) : null,
        call_id: r.call_id,
        latency_ms: r.latency_ms,
        infer_mode: Boolean(r.infer_mode),
      }));

      return v2Ok(res, { events, count: events.length }, { version: "v2" });
    } catch (err: any) {
      return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
    }
  });

  return router;
};

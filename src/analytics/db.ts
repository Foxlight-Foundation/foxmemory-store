import { DatabaseSync } from "node:sqlite";
import { effectiveLlmModel, EMBED_MODEL, GRAPH_ENABLED } from "../config/env.js";

export class FoxAnalyticsDB {
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
        infer_mode INTEGER DEFAULT 1,
        call_id    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_we_ts    ON write_events(ts);
      CREATE INDEX IF NOT EXISTS idx_we_event ON write_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_we_user  ON write_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_we_call  ON write_events(call_id);

      CREATE TABLE IF NOT EXISTS search_events (
        id           TEXT PRIMARY KEY,
        ts           TEXT NOT NULL,
        user_id      TEXT,
        run_id       TEXT,
        query_chars  INTEGER,
        result_count INTEGER,
        top_score    REAL,
        latency_ms   INTEGER,
        graph_hit    INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_se_ts   ON search_events(ts);
      CREATE INDEX IF NOT EXISTS idx_se_user ON search_events(user_id);

      CREATE TABLE IF NOT EXISTS graph_events (
        id               TEXT PRIMARY KEY,
        ts               TEXT NOT NULL,
        user_id          TEXT,
        run_id           TEXT,
        entities_added   INTEGER,
        relations_added  INTEGER,
        latency_ms       INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_ge_ts   ON graph_events(ts);
      CREATE INDEX IF NOT EXISTS idx_ge_user ON graph_events(user_id);

      CREATE TABLE IF NOT EXISTS config (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_catalog (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        description  TEXT,
        roles        TEXT NOT NULL DEFAULT '[]',
        input_mtok   REAL,
        cached_mtok  REAL,
        output_mtok  REAL,
        created_at   INTEGER DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS memory_graph_links (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        vector_memory_id TEXT NOT NULL,
        graph_node_id    TEXT,
        graph_edge_id    TEXT,
        user_id          TEXT,
        created_at       INTEGER DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_mgl_vector ON memory_graph_links(vector_memory_id);
      CREATE INDEX IF NOT EXISTS idx_mgl_node   ON memory_graph_links(graph_node_id);
      CREATE INDEX IF NOT EXISTS idx_mgl_edge   ON memory_graph_links(graph_edge_id);
    `);
    for (const sql of [
      "ALTER TABLE write_events  ADD COLUMN call_id              TEXT",
      "ALTER TABLE write_events  ADD COLUMN reason               TEXT",
      "ALTER TABLE write_events  ADD COLUMN extracted_facts_json TEXT",
      "ALTER TABLE write_events  ADD COLUMN candidates_json      TEXT",
      "ALTER TABLE search_events ADD COLUMN graph_hit INTEGER DEFAULT 0",
    ]) {
      try { this.db.exec(sql); } catch { /* column already exists */ }
    }
    this.ready = true;
  }

  getConfig(key: string): string | null {
    if (!this.ready) return null;
    const row = this.db.prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setConfig(key: string, value: string | null): void {
    if (!this.ready) return;
    if (value === null) {
      this.db.prepare("DELETE FROM config WHERE key = ?").run(key);
    } else {
      this.db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
    }
  }

  recordWriteResults(opts: {
    results: any[];
    user_id?: string;
    run_id?: string;
    inputChars: number;
    latencyMs: number;
    inferMode: boolean;
    decisions?: { extractedFacts: string[]; candidates: { id: string; text: string }[]; actions: any[] };
  }) {
    if (!this.ready) return;
    const ts = new Date().toISOString();
    const callId = crypto.randomUUID();
    const extractedFactsJson = opts.decisions?.extractedFacts?.length
      ? JSON.stringify(opts.decisions.extractedFacts) : null;
    const candidatesJson = opts.decisions?.candidates?.length
      ? JSON.stringify(opts.decisions.candidates) : null;
    const stmt = this.db.prepare(
      `INSERT INTO write_events (id, ts, event_type, memory_id, user_id, run_id, input_chars, output_text, llm_model, latency_ms, infer_mode, call_id, reason, extracted_facts_json, candidates_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const noneActions = opts.results.length === 0
      ? (opts.decisions?.actions || []).filter((a: any) => String(a?.event || "").toUpperCase() === "NONE")
      : [];
    const rows = opts.results.length ? opts.results : noneActions.length ? noneActions : [null];
    for (const r of rows) {
      const event = r ? String(r?.metadata?.event || r?.event || "NONE").toUpperCase() : "NONE";
      const memText = r?.memory ? String(r.memory).slice(0, 500) : (r?.text ? String(r.text).slice(0, 500) : null);
      const reason = r?.metadata?.reason
        ? String(r.metadata.reason).slice(0, 500)
        : r?.reason ? String(r.reason).slice(0, 500) : null;
      try {
        stmt.run(
          crypto.randomUUID(), ts, event, r?.id ?? null,
          opts.user_id ?? null, opts.run_id ?? null,
          opts.inputChars, memText, effectiveLlmModel,
          opts.latencyMs, opts.inferMode ? 1 : 0, callId,
          reason, extractedFactsJson, candidatesJson
        );
      } catch { /* non-critical */ }
    }
  }

  recordSearch(opts: {
    user_id?: string;
    run_id?: string;
    queryChars: number;
    resultCount: number;
    topScore?: number;
    latencyMs: number;
    graphHit?: boolean;
  }) {
    if (!this.ready) return;
    try {
      this.db.prepare(
        `INSERT INTO search_events (id, ts, user_id, run_id, query_chars, result_count, top_score, latency_ms, graph_hit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(), new Date().toISOString(),
        opts.user_id ?? null, opts.run_id ?? null,
        opts.queryChars, opts.resultCount, opts.topScore ?? null, opts.latencyMs,
        opts.graphHit ? 1 : 0
      );
    } catch { /* non-critical */ }
  }

  recordGraphWrite(opts: {
    user_id?: string;
    run_id?: string;
    entitiesAdded?: number;
    relationsAdded?: number;
    latencyMs: number;
  }) {
    if (!this.ready) return;
    try {
      this.db.prepare(
        `INSERT INTO graph_events (id, ts, user_id, run_id, entities_added, relations_added, latency_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(), new Date().toISOString(),
        opts.user_id ?? null, opts.run_id ?? null,
        opts.entitiesAdded ?? null, opts.relationsAdded ?? null, opts.latencyMs
      );
    } catch { /* non-critical */ }
  }

  getStats(days: number) {
    if (!this.ready) return null;
    try {
      const eventRows = this.db.prepare(
        `SELECT event_type, COUNT(*) as count FROM write_events GROUP BY event_type`
      ).all() as Array<{ event_type: string; count: number }>;

      const byEvent: Record<string, number> = { ADD: 0, UPDATE: 0, DELETE: 0, NONE: 0 };
      for (const r of eventRows) {
        byEvent[r.event_type] = (byEvent[r.event_type] ?? 0) + r.count;
      }

      const callStats = this.db.prepare(`
        SELECT
          COUNT(DISTINCT call_id) as totalCalls,
          COUNT(DISTINCT CASE WHEN event_type = 'NONE' THEN call_id END) as noneCalls
        FROM write_events WHERE call_id IS NOT NULL
      `).get() as any;
      const noneRatePct = (callStats?.totalCalls ?? 0) > 0
        ? Math.round(((callStats.noneCalls ?? 0) / callStats.totalCalls) * 100)
        : 0;
      const totalCalls = callStats?.totalCalls ?? 0;

      const latRow = this.db.prepare(
        `SELECT AVG(latency_ms) as avg, MIN(latency_ms) as min, MAX(latency_ms) as max
         FROM write_events WHERE latency_ms IS NOT NULL`
      ).get() as any;

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

      const recent = this.db.prepare(`
        SELECT ts, event_type, memory_id, user_id, run_id, output_text, reason, latency_ms, infer_mode
        FROM write_events ORDER BY ts DESC LIMIT 20
      `).all() as any[];

      const searchRow = this.db.prepare(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) as zeroResults,
               SUM(CASE WHEN graph_hit = 1 THEN 1 ELSE 0 END) as graphHits,
               CAST(AVG(result_count) * 10 AS INTEGER) / 10.0 as avgResults,
               CAST(AVG(top_score) * 1000 AS INTEGER) / 1000.0 as avgTopScore,
               CAST(AVG(latency_ms) AS INTEGER) as avgLatencyMs
        FROM search_events
      `).get() as any;

      const searchTotal = searchRow?.total ?? 0;
      const zeroResultRatePct = searchTotal > 0
        ? Math.round(((searchRow?.zeroResults ?? 0) / searchTotal) * 100)
        : 0;
      const graphHitRatePct = searchTotal > 0
        ? Math.round(((searchRow?.graphHits ?? 0) / searchTotal) * 100)
        : 0;

      const searchByDayRaw = this.db.prepare(`
        SELECT date(ts) as date,
               COUNT(*) as count,
               SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) as zeroResults,
               CAST(AVG(latency_ms) AS INTEGER) as avgLatencyMs
        FROM search_events
        WHERE ts >= datetime('now', '-' || ? || ' days')
        GROUP BY date(ts)
        ORDER BY date(ts) ASC
      `).all(days) as Array<{ date: string; count: number; zeroResults: number; avgLatencyMs: number | null }>;

      const graphRow = this.db.prepare(`
        SELECT COUNT(*) as totalWrites,
               SUM(relations_added) as totalRelations,
               SUM(entities_added) as totalEntities,
               CAST(AVG(latency_ms) AS INTEGER) as avgLatencyMs
        FROM graph_events
      `).get() as any;

      return {
        summary: {
          totalCalls,
          byEvent,
          noneRatePct,
          writeLatency: {
            avgMs: latRow?.avg ? Math.round(latRow.avg) : null,
            minMs: latRow?.min ?? null,
            maxMs: latRow?.max ?? null,
          },
          model: { llm: effectiveLlmModel, embed: EMBED_MODEL },
        },
        byDay: Array.from(byDayMap.values()),
        recentActivity: recent.map((r: any) => ({
          ts: r.ts,
          event: r.event_type,
          memoryId: r.memory_id,
          userId: r.user_id,
          runId: r.run_id,
          preview: r.output_text ?? r.reason ?? null,
          latencyMs: r.latency_ms,
          inferMode: r.infer_mode === 1,
        })),
        searches: {
          total: searchTotal,
          zeroResultRatePct,
          graphHitRatePct,
          avgResults: searchRow?.avgResults ?? null,
          avgTopScore: searchRow?.avgTopScore ?? null,
          avgLatencyMs: searchRow?.avgLatencyMs ?? null,
          byDay: searchByDayRaw,
        },
        graph: {
          enabled: GRAPH_ENABLED,
          totalWrites: graphRow?.totalWrites ?? 0,
          totalRelations: graphRow?.totalRelations ?? 0,
          totalEntities: graphRow?.totalEntities ?? 0,
          avgWriteLatencyMs: graphRow?.avgLatencyMs ?? null,
        },
      };
    } catch (e) {
      console.error("[analytics] getStats error:", e);
      return null;
    }
  }

  seedCatalog(entries: Array<{ id: string; name: string; description: string; roles: string[]; input_mtok: number | null; cached_mtok: number | null; output_mtok: number | null }>) {
    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO model_catalog (id, name, description, roles, input_mtok, cached_mtok, output_mtok) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const e of entries) {
      stmt.run(e.id, e.name, e.description, JSON.stringify(e.roles), e.input_mtok, e.cached_mtok, e.output_mtok);
    }
  }

  getCatalogModels(role?: string): any[] {
    const rows: any[] = this.db.prepare("SELECT * FROM model_catalog ORDER BY id").all() as any[];
    const out = rows.map((r: any) => ({ ...r, roles: JSON.parse(r.roles ?? "[]") }));
    if (role) return out.filter((r: any) => r.roles.includes(role));
    return out;
  }

  getCatalogModel(id: string): any | null {
    const row: any = this.db.prepare("SELECT * FROM model_catalog WHERE id = ?").get(id) as any;
    if (!row) return null;
    return { ...row, roles: JSON.parse(row.roles ?? "[]") };
  }

  upsertCatalogModel(entry: { id: string; name: string; description?: string | null; roles: string[]; input_mtok?: number | null; cached_mtok?: number | null; output_mtok?: number | null }) {
    this.db.prepare(
      `INSERT INTO model_catalog (id, name, description, roles, input_mtok, cached_mtok, output_mtok)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name        = excluded.name,
         description = excluded.description,
         roles       = excluded.roles,
         input_mtok  = excluded.input_mtok,
         cached_mtok = excluded.cached_mtok,
         output_mtok = excluded.output_mtok`
    ).run(
      entry.id, entry.name, entry.description ?? null, JSON.stringify(entry.roles),
      entry.input_mtok ?? null, entry.cached_mtok ?? null, entry.output_mtok ?? null
    );
  }

  deleteCatalogModel(id: string): boolean {
    const result = this.db.prepare("DELETE FROM model_catalog WHERE id = ?").run(id);
    return (result.changes as number) > 0;
  }

  insertGraphLinks(vectorMemoryId: string, nodeIds: string[], edgeIds: string[], userId?: string) {
    const stmt = this.db.prepare(
      "INSERT INTO memory_graph_links (vector_memory_id, graph_node_id, graph_edge_id, user_id) VALUES (?, ?, ?, ?)"
    );
    for (const nodeId of nodeIds) stmt.run(vectorMemoryId, nodeId, null, userId ?? null);
    for (const edgeId of edgeIds) stmt.run(vectorMemoryId, null, edgeId, userId ?? null);
  }

  getLinkedNodeIds(vectorMemoryId: string): string[] {
    const rows = this.db.prepare(
      "SELECT DISTINCT graph_node_id FROM memory_graph_links WHERE vector_memory_id = ? AND graph_node_id IS NOT NULL"
    ).all(vectorMemoryId) as any[];
    return rows.map((r: any) => r.graph_node_id);
  }

  getLinkedEdgeIds(vectorMemoryId: string): string[] {
    const rows = this.db.prepare(
      "SELECT DISTINCT graph_edge_id FROM memory_graph_links WHERE vector_memory_id = ? AND graph_edge_id IS NOT NULL"
    ).all(vectorMemoryId) as any[];
    return rows.map((r: any) => r.graph_edge_id);
  }

  otherMemoriesForNode(graphNodeId: string, excludeVectorMemoryId: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(DISTINCT vector_memory_id) AS cnt FROM memory_graph_links WHERE graph_node_id = ? AND vector_memory_id != ?"
    ).get(graphNodeId, excludeVectorMemoryId) as any;
    return row?.cnt ?? 0;
  }

  otherMemoriesForEdge(graphEdgeId: string, excludeVectorMemoryId: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(DISTINCT vector_memory_id) AS cnt FROM memory_graph_links WHERE graph_edge_id = ? AND vector_memory_id != ?"
    ).get(graphEdgeId, excludeVectorMemoryId) as any;
    return row?.cnt ?? 0;
  }

  deleteLinksForMemory(vectorMemoryId: string) {
    this.db.prepare("DELETE FROM memory_graph_links WHERE vector_memory_id = ?").run(vectorMemoryId);
  }

  getLinkStats(): { linkedMemories: number; trackedNodes: number; trackedEdges: number } {
    const mem = this.db.prepare("SELECT COUNT(DISTINCT vector_memory_id) AS cnt FROM memory_graph_links").get() as any;
    const nodes = this.db.prepare("SELECT COUNT(DISTINCT graph_node_id) AS cnt FROM memory_graph_links WHERE graph_node_id IS NOT NULL").get() as any;
    const edges = this.db.prepare("SELECT COUNT(DISTINCT graph_edge_id) AS cnt FROM memory_graph_links WHERE graph_edge_id IS NOT NULL").get() as any;
    return { linkedMemories: mem?.cnt ?? 0, trackedNodes: nodes?.cnt ?? 0, trackedEdges: edges?.cnt ?? 0 };
  }
}

export let analyticsDb: FoxAnalyticsDB | null = null;

export const initAnalyticsDb = (path: string): FoxAnalyticsDB | null => {
  try {
    analyticsDb = new FoxAnalyticsDB(path);
    return analyticsDb;
  } catch (e) {
    console.warn("[analytics] DB unavailable (set FOXMEMORY_ANALYTICS_DB_PATH to a writable path):", String(e));
    return null;
  }
};

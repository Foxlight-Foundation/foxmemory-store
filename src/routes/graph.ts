import { Router } from "express";
import { GRAPH_ENABLED } from "../config/env.js";
import { getMemory } from "../memory/factory.js";
import { v2Ok, v2Err } from "../utils/response.js";
import { cleanNode, cleanEdge, neo4jInt, graphSession } from "../utils/graph.js";
import {
  v2GraphRelationsSchema,
  v2GraphQuerySchema,
  v2GraphNodesListSchema,
  v2GraphSearchBodySchema,
  v2GraphStatsQuerySchema,
} from "../schemas/index.js";

/**
 * @param v2Prefix - The URL prefix for v2 routes. Default "/v2". For agent-scoped routes, pass "/v2/agents/:agentId".
 */
export const createGraphRouter = (v2Prefix = "/v2") => {
  const router = Router({ mergeParams: true });

  /** Helper: resolve the Memory instance — agent-scoped if available, otherwise singleton */
  const mem = (req: Express.Request) => (req as any).agentMemory ?? getMemory();

  router.get(`${v2Prefix}/graph/relations`, async (req, res) => {
    if (!GRAPH_ENABLED) {
      return v2Err(res, 400, "BAD_REQUEST", "Graph memory is not enabled (set NEO4J_URL and NEO4J_PASSWORD)");
    }
    const parsed = v2GraphRelationsSchema.safeParse(req.query);
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid query", parsed.error.flatten());

    try {
      const memory = mem(req);
      const graphStore = (memory as any).graphMemory;
      if (!graphStore) return v2Err(res, 503, "SERVICE_UNAVAILABLE", "Graph store not initialized");

      const filters: any = {};
      if (parsed.data.user_id) filters.userId = parsed.data.user_id;
      if (parsed.data.run_id) filters.runId = parsed.data.run_id;

      const relations = await graphStore.getAll(filters, parsed.data.limit ?? 100);
      const list = Array.isArray(relations) ? relations : [];
      return v2Ok(res, { relations: list, count: list.length }, { version: "v2" });
    } catch (err: any) {
      return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
    }
  });

  router.get(`${v2Prefix}/graph`, async (req, res) => {
    if (!GRAPH_ENABLED) return v2Err(res, 400, "BAD_REQUEST", "Graph memory is not enabled (set NEO4J_URL and NEO4J_PASSWORD)");
    const parsed = v2GraphQuerySchema.safeParse(req.query);
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid query", parsed.error.flatten());
    const { user_id, run_id, limit } = parsed.data;
    const params = { user_id: user_id ?? null, run_id: run_id ?? null, limit };
    try {
      return await graphSession(async (session) => {
        const nodeRes = await session.run(
          `MATCH (n)
           WHERE ($user_id IS NULL OR n.user_id = $user_id)
             AND ($run_id IS NULL OR n.run_id = $run_id)
           RETURN n LIMIT $limit`,
          params
        );
        const edgeRes = await session.run(
          `MATCH (n)-[r]->(m)
           WHERE ($user_id IS NULL OR n.user_id = $user_id)
             AND ($run_id IS NULL OR n.run_id = $run_id)
           RETURN r LIMIT $edgeLimit`,
          { ...params, edgeLimit: limit * 4 }
        );
        const nodes = nodeRes.records.map((rec: any) => cleanNode(rec.get("n")));
        const edges = edgeRes.records.map((rec: any) => cleanEdge(rec.get("r")));
        return v2Ok(res, { nodes, edges, meta: { nodeCount: nodes.length, edgeCount: edges.length } });
      });
    } catch (err: any) {
      return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
    }
  });

  router.get(`${v2Prefix}/graph/nodes`, async (req, res) => {
    if (!GRAPH_ENABLED) return v2Err(res, 400, "BAD_REQUEST", "Graph memory is not enabled (set NEO4J_URL and NEO4J_PASSWORD)");
    const parsed = v2GraphNodesListSchema.safeParse(req.query);
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid query", parsed.error.flatten());
    const { user_id, run_id, page, page_size } = parsed.data;
    const params = { user_id: user_id ?? null, run_id: run_id ?? null, skip: page * page_size, limit: page_size };
    try {
      return await graphSession(async (session) => {
        const result = await session.run(
          `MATCH (n)
           WHERE ($user_id IS NULL OR n.user_id = $user_id)
             AND ($run_id IS NULL OR n.run_id = $run_id)
           RETURN n ORDER BY n.name SKIP $skip LIMIT $limit`,
          params
        );
        const nodes = result.records.map((rec: any) => cleanNode(rec.get("n")));
        return v2Ok(res, { nodes, page, page_size, count: nodes.length });
      });
    } catch (err: any) {
      return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
    }
  });

  router.get(`${v2Prefix}/graph/nodes/:id`, async (req, res) => {
    if (!GRAPH_ENABLED) return v2Err(res, 400, "BAD_REQUEST", "Graph memory is not enabled (set NEO4J_URL and NEO4J_PASSWORD)");
    try {
      return await graphSession(async (session) => {
        const nodeRes = await session.run(
          "MATCH (n) WHERE elementId(n) = $id RETURN n",
          { id: req.params.id }
        );
        if (!nodeRes.records.length) return v2Err(res, 404, "NOT_FOUND", "Node not found");

        const neighborRes = await session.run(
          `MATCH (n)-[r]-(m) WHERE elementId(n) = $id
           RETURN r, m, elementId(startNode(r)) as src, elementId(endNode(r)) as tgt`,
          { id: req.params.id }
        );

        const node = cleanNode(nodeRes.records[0].get("n"));
        const neighborMap = new Map<string, object>();
        const edgeMap = new Map<string, object>();

        for (const rec of neighborRes.records) {
          const m = rec.get("m");
          const mid = m.elementId ?? String(m.identity);
          if (!neighborMap.has(mid)) neighborMap.set(mid, cleanNode(m));
          const r = rec.get("r");
          const eid = r.elementId ?? String(r.identity);
          if (!edgeMap.has(eid)) edgeMap.set(eid, cleanEdge(r, rec.get("src"), rec.get("tgt")));
        }

        return v2Ok(res, {
          node,
          neighbors: Array.from(neighborMap.values()),
          edges: Array.from(edgeMap.values()),
        });
      });
    } catch (err: any) {
      return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
    }
  });

  router.post(`${v2Prefix}/graph/search`, async (req, res) => {
    if (!GRAPH_ENABLED) return v2Err(res, 400, "BAD_REQUEST", "Graph memory is not enabled (set NEO4J_URL and NEO4J_PASSWORD)");
    const parsed = v2GraphSearchBodySchema.safeParse(req.body);
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());
    const { query, user_id, run_id } = parsed.data;
    const params = { query: query.toLowerCase(), user_id: user_id ?? null, run_id: run_id ?? null };
    try {
      return await graphSession(async (session) => {
        const matchRes = await session.run(
          `MATCH (n)
           WHERE toLower(n.name) CONTAINS $query
             AND ($user_id IS NULL OR n.user_id = $user_id)
             AND ($run_id IS NULL OR n.run_id = $run_id)
           RETURN n LIMIT 20`,
          params
        );
        if (!matchRes.records.length) return v2Ok(res, { nodes: [], edges: [], matchCount: 0 });

        const matchIds = matchRes.records.map((rec: any) => {
          const n = rec.get("n");
          return n.elementId ?? String(n.identity);
        });

        const subgraphRes = await session.run(
          `MATCH (n)-[r]->(m)
           WHERE elementId(n) IN $ids OR elementId(m) IN $ids
           RETURN n, r, m, elementId(startNode(r)) as src, elementId(endNode(r)) as tgt`,
          { ids: matchIds }
        );

        const nodeMap = new Map<string, object>();
        const edgeMap = new Map<string, object>();

        for (const rec of matchRes.records) {
          const n = rec.get("n");
          nodeMap.set(n.elementId ?? String(n.identity), cleanNode(n));
        }
        for (const rec of subgraphRes.records) {
          for (const field of ["n", "m"]) {
            const node = rec.get(field);
            const nid = node.elementId ?? String(node.identity);
            if (!nodeMap.has(nid)) nodeMap.set(nid, cleanNode(node));
          }
          const r = rec.get("r");
          const eid = r.elementId ?? String(r.identity);
          if (!edgeMap.has(eid)) edgeMap.set(eid, cleanEdge(r, rec.get("src"), rec.get("tgt")));
        }

        return v2Ok(res, {
          nodes: Array.from(nodeMap.values()),
          edges: Array.from(edgeMap.values()),
          matchCount: matchIds.length,
        });
      });
    } catch (err: any) {
      return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
    }
  });

  router.get(`${v2Prefix}/graph/stats`, async (req, res) => {
    if (!GRAPH_ENABLED) return v2Err(res, 400, "BAD_REQUEST", "Graph memory is not enabled (set NEO4J_URL and NEO4J_PASSWORD)");
    const parsed = v2GraphStatsQuerySchema.safeParse(req.query);
    if (!parsed.success) return v2Err(res, 400, "VALIDATION_ERROR", "Invalid query", parsed.error.flatten());
    const { user_id, run_id } = parsed.data;
    const params = { user_id: user_id ?? null, run_id: run_id ?? null };
    try {
      return await graphSession(async (session) => {
        const byLabelRes = await session.run(
          `MATCH (n)
           WHERE ($user_id IS NULL OR n.user_id = $user_id)
             AND ($run_id IS NULL OR n.run_id = $run_id)
           RETURN labels(n)[0] as label, count(*) as count ORDER BY count DESC`,
          params
        );
        const byTypeRes = await session.run(
          `MATCH (n)-[r]->(m)
           WHERE ($user_id IS NULL OR n.user_id = $user_id)
             AND ($run_id IS NULL OR n.run_id = $run_id)
           RETURN type(r) as type, count(*) as count ORDER BY count DESC`,
          params
        );
        const mostConnectedRes = await session.run(
          `MATCH (n)-[r]-(m)
           WHERE ($user_id IS NULL OR n.user_id = $user_id)
             AND ($run_id IS NULL OR n.run_id = $run_id)
           WITH n, count(r) as degree ORDER BY degree DESC LIMIT 10
           RETURN elementId(n) as id, n.name as name, degree`,
          params
        );

        const byLabel: Record<string, number> = {};
        for (const rec of byLabelRes.records) {
          byLabel[String(rec.get("label") ?? "unknown")] = neo4jInt(rec.get("count"));
        }
        const byRelationType: Record<string, number> = {};
        for (const rec of byTypeRes.records) {
          byRelationType[String(rec.get("type"))] = neo4jInt(rec.get("count"));
        }
        const mostConnected = mostConnectedRes.records.map((rec: any) => ({
          id: rec.get("id"),
          name: rec.get("name"),
          degree: neo4jInt(rec.get("degree")),
        }));

        return v2Ok(res, {
          nodeCount: Object.values(byLabel).reduce((a, b) => a + b, 0),
          edgeCount: Object.values(byRelationType).reduce((a, b) => a + b, 0),
          byLabel,
          byRelationType,
          mostConnected,
        });
      });
    } catch (err: any) {
      return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
    }
  });

  router.post(`${v2Prefix}/graph/admin/wipe`, async (req, res) => {
    if (!GRAPH_ENABLED) return v2Err(res, 400, "BAD_REQUEST", "Graph memory is not enabled");
    if (req.headers["x-admin-action"] !== "wipe-graph") {
      return v2Err(res, 400, "BAD_REQUEST", "Missing required header: X-Admin-Action: wipe-graph");
    }
    try {
      return await graphSession(async (session) => {
        const countRes = await session.run("MATCH (n) RETURN count(n) AS c");
        const nodesBefore = neo4jInt(countRes.records[0]?.get("c"));
        await session.run("MATCH (n) DETACH DELETE n");
        console.warn(`[graph/admin/wipe] wiped ${nodesBefore} nodes from Neo4j`);
        return v2Ok(res, { wiped: true, nodes_deleted: nodesBefore });
      });
    } catch (err: any) {
      return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
    }
  });

  return router;
};

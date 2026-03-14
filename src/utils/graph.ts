import { getMemory } from "../memory/factory.js";
import { GRAPH_ENABLED } from "../config/env.js";

export const neo4jInt = (val: any): number => {
  if (val === null || val === undefined) return 0;
  return typeof val?.toNumber === "function" ? val.toNumber() : Number(val);
};

export const cleanNode = (node: any): object => {
  const { embedding, ...props } = node.properties ?? {};
  void embedding;
  return {
    id: node.elementId ?? String(node.identity),
    labels: node.labels ?? [],
    name: props.name ?? null,
    properties: props,
  };
};

export const cleanEdge = (rel: any, src?: string, tgt?: string): object => {
  const { created, created_at, updated_at, ...rest } = rel.properties ?? {};
  return {
    id: rel.elementId ?? String(rel.identity),
    source: src ?? rel.startNodeElementId ?? String(rel.start),
    target: tgt ?? rel.endNodeElementId ?? String(rel.end),
    type: rel.type,
    created: created ?? created_at ?? null,
    properties: rest,
  };
};

export const graphSession = async <T>(fn: (session: any) => Promise<T>): Promise<T> => {
  const memory = getMemory();
  const driver = (memory as any).graphMemory?.graph;
  if (!driver) throw new Error("Graph driver not initialized");
  const session = driver.session();
  try {
    return await fn(session);
  } finally {
    await session.close().catch(() => {});
  }
};

export const checkNeo4jHealth = async (): Promise<{
  connected: boolean;
  nodeCount: number | null;
  relationCount: number | null;
  error?: string;
} | null> => {
  if (!GRAPH_ENABLED) return null;
  const memory = getMemory();
  const driver = (memory as any).graphMemory?.graph;
  if (!driver) return { connected: false, nodeCount: null, relationCount: null, error: "graph driver not initialized" };

  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

  const session = driver.session();
  try {
    const nodeRes = await withTimeout(session.run("MATCH (n) RETURN count(n) AS c"), 3000);
    const relRes = await withTimeout(session.run("MATCH ()-[r]->() RETURN count(r) AS c"), 3000);
    const toNum = (r: any) => {
      const val = r.records?.[0]?.get("c");
      return typeof val?.toNumber === "function" ? val.toNumber() : (Number(val) || 0);
    };
    return { connected: true, nodeCount: toNum(nodeRes), relationCount: toNum(relRes) };
  } catch (e: any) {
    return { connected: false, nodeCount: null, relationCount: null, error: String(e?.message || e).slice(0, 150) };
  } finally {
    await session.close().catch(() => {});
  }
};

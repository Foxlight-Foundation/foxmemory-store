import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { TenantRecord, AgentRecord } from "./types.js";

export class FoxRegistry {
  private db: DatabaseSync;
  ready = false;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        id          TEXT PRIMARY KEY,
        slug        TEXT UNIQUE NOT NULL,
        name        TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS agents (
        id                TEXT PRIMARY KEY,
        tenant_id         TEXT NOT NULL REFERENCES tenants(id),
        slug              TEXT NOT NULL,
        name              TEXT NOT NULL,
        qdrant_collection TEXT NOT NULL,
        neo4j_database    TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'provisioning',
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(tenant_id, slug)
      );

      CREATE TABLE IF NOT EXISTS agent_config (
        agent_id  TEXT NOT NULL REFERENCES agents(id),
        key       TEXT NOT NULL,
        value     TEXT NOT NULL,
        PRIMARY KEY(agent_id, key)
      );

      CREATE TABLE IF NOT EXISTS tenant_api_keys (
        id         TEXT PRIMARY KEY,
        tenant_id  TEXT NOT NULL REFERENCES tenants(id),
        key_hash   TEXT NOT NULL,
        name       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        revoked_at TEXT
      );
    `);
    this.ready = true;
  }

  /* ── Tenants ─────────────────────────────────────────── */

  createTenant = (slug: string, name: string): TenantRecord => {
    const id = randomUUID();
    this.db.prepare(
      "INSERT INTO tenants (id, slug, name) VALUES (?, ?, ?)"
    ).run(id, slug, name);
    return this.getTenant(id)!;
  };

  getTenants = (): TenantRecord[] => {
    return this.db.prepare(
      "SELECT id, slug, name, created_at FROM tenants ORDER BY created_at ASC"
    ).all() as unknown as TenantRecord[];
  };

  getTenant = (id: string): TenantRecord | null => {
    const row = this.db.prepare(
      "SELECT id, slug, name, created_at FROM tenants WHERE id = ?"
    ).get(id) as TenantRecord | undefined;
    return row ?? null;
  };

  getTenantBySlug = (slug: string): TenantRecord | null => {
    const row = this.db.prepare(
      "SELECT id, slug, name, created_at FROM tenants WHERE slug = ?"
    ).get(slug) as TenantRecord | undefined;
    return row ?? null;
  };

  /* ── Agents ──────────────────────────────────────────── */

  createAgent = (
    tenantId: string,
    slug: string,
    name: string,
    qdrantCollection: string,
    neo4jDatabase: string,
  ): AgentRecord => {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO agents (id, tenant_id, slug, name, qdrant_collection, neo4j_database, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`
    ).run(id, tenantId, slug, name, qdrantCollection, neo4jDatabase);
    return this.getAgent(id)!;
  };

  getAgent = (id: string): AgentRecord | null => {
    const row = this.db.prepare(
      "SELECT id, tenant_id, slug, name, qdrant_collection, neo4j_database, status, created_at FROM agents WHERE id = ?"
    ).get(id) as AgentRecord | undefined;
    return row ?? null;
  };

  getAgentBySlug = (tenantId: string, slug: string): AgentRecord | null => {
    const row = this.db.prepare(
      "SELECT id, tenant_id, slug, name, qdrant_collection, neo4j_database, status, created_at FROM agents WHERE tenant_id = ? AND slug = ?"
    ).get(tenantId, slug) as AgentRecord | undefined;
    return row ?? null;
  };

  getAgentsByTenant = (tenantId: string): AgentRecord[] => {
    return this.db.prepare(
      "SELECT id, tenant_id, slug, name, qdrant_collection, neo4j_database, status, created_at FROM agents WHERE tenant_id = ? ORDER BY created_at ASC"
    ).all(tenantId) as unknown as AgentRecord[];
  };

  updateAgentStatus = (id: string, status: AgentRecord["status"]): void => {
    this.db.prepare(
      "UPDATE agents SET status = ? WHERE id = ?"
    ).run(status, id);
  };

  /* ── Agent Config ────────────────────────────────────── */

  getAgentConfig = (agentId: string): Record<string, string> => {
    const rows = this.db.prepare(
      "SELECT key, value FROM agent_config WHERE agent_id = ?"
    ).all(agentId) as Array<{ key: string; value: string }>;
    const config: Record<string, string> = {};
    for (const r of rows) config[r.key] = r.value;
    return config;
  };

  setAgentConfig = (agentId: string, key: string, value: string): void => {
    this.db.prepare(
      "INSERT INTO agent_config (agent_id, key, value) VALUES (?, ?, ?) ON CONFLICT(agent_id, key) DO UPDATE SET value = excluded.value"
    ).run(agentId, key, value);
  };

  deleteAgentConfig = (agentId: string, key: string): void => {
    this.db.prepare(
      "DELETE FROM agent_config WHERE agent_id = ? AND key = ?"
    ).run(agentId, key);
  };

  /* ── Utility ─────────────────────────────────────────── */

  isEmpty = (): boolean => {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS cnt FROM tenants"
    ).get() as { cnt: number };
    return row.cnt === 0;
  };
}

export let registry: FoxRegistry | null = null;

export const initRegistry = (path: string): FoxRegistry | null => {
  try {
    registry = new FoxRegistry(path);
    return registry;
  } catch (e) {
    console.warn("[registry] DB unavailable:", String(e));
    return null;
  }
};

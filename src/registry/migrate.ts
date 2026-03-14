import type { FoxRegistry } from "./db.js";
import type { FoxAnalyticsDB } from "../analytics/db.js";

export const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || "foxlight";
export const DEFAULT_AGENT_SLUG = process.env.DEFAULT_AGENT_SLUG || (process.env.QDRANT_COLLECTION || "foxmemory");

/**
 * Seed the registry with a default tenant + agent if it's empty.
 * Copies any existing config from the analytics DB's config table into agent_config.
 */
export const migrateToRegistry = (registry: FoxRegistry, analyticsDb: FoxAnalyticsDB | null): void => {
  if (!registry.isEmpty()) {
    console.log("[registry/migrate] registry already has data, skipping seed");
    return;
  }

  console.log("[registry/migrate] seeding default tenant and agent...");

  const tenant = registry.createTenant(DEFAULT_TENANT_SLUG, DEFAULT_TENANT_SLUG);
  console.log(`[registry/migrate] created tenant: ${tenant.slug} (${tenant.id})`);

  const qdrantCollection = process.env.QDRANT_COLLECTION || "foxmemory";
  const neo4jDatabase = process.env.NEO4J_DATABASE || "neo4j";

  const agent = registry.createAgent(
    tenant.id,
    DEFAULT_AGENT_SLUG,
    DEFAULT_AGENT_SLUG,
    qdrantCollection,
    neo4jDatabase,
  );
  console.log(`[registry/migrate] created agent: ${agent.slug} (${agent.id}) → qdrant=${qdrantCollection}, neo4j=${neo4jDatabase}`);

  // Copy config from analytics DB into agent_config
  if (analyticsDb?.ready) {
    const CONFIG_KEYS = [
      "custom_prompt",
      "custom_update_prompt",
      "custom_graph_prompt",
      "capture_message_limit",
      "role_user_name",
      "role_assistant_name",
      "model_llm",
      "model_graph_llm",
    ];
    let copied = 0;
    for (const key of CONFIG_KEYS) {
      const val = analyticsDb.getConfig(key);
      if (val !== null) {
        registry.setAgentConfig(agent.id, key, val);
        copied++;
      }
    }
    if (copied > 0) {
      console.log(`[registry/migrate] copied ${copied} config keys from analytics DB to agent_config`);
    }
  }

  console.log("[registry/migrate] seed complete");
};

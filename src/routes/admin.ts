import { Router } from "express";
import { registry } from "../registry/db.js";
import { v2Ok, v2Err } from "../utils/response.js";

export const createAdminRouter = () => {
  const router = Router();

  /* ── Tenants ─────────────────────────────────────────── */

  router.post("/v2/tenants", (req, res) => {
    if (!registry?.ready) return v2Err(res, 503, "SERVICE_UNAVAILABLE", "Registry not available");
    const { slug, name } = req.body ?? {};
    if (!slug || typeof slug !== "string") return v2Err(res, 400, "VALIDATION_ERROR", "slug is required");
    if (!name || typeof name !== "string") return v2Err(res, 400, "VALIDATION_ERROR", "name is required");

    const existing = registry.getTenantBySlug(slug);
    if (existing) return v2Err(res, 409, "CONFLICT", `Tenant with slug '${slug}' already exists`);

    try {
      const tenant = registry.createTenant(slug, name);
      return v2Ok(res, tenant, { version: "v2" });
    } catch (err: any) {
      return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
    }
  });

  router.get("/v2/tenants", (_req, res) => {
    if (!registry?.ready) return v2Err(res, 503, "SERVICE_UNAVAILABLE", "Registry not available");
    const tenants = registry.getTenants();
    return v2Ok(res, { tenants, count: tenants.length }, { version: "v2" });
  });

  router.get("/v2/tenants/:tenantId", (req, res) => {
    if (!registry?.ready) return v2Err(res, 503, "SERVICE_UNAVAILABLE", "Registry not available");
    const tenant = registry.getTenant(req.params.tenantId);
    if (!tenant) return v2Err(res, 404, "NOT_FOUND", `Tenant ${req.params.tenantId} not found`);
    return v2Ok(res, tenant, { version: "v2" });
  });

  /* ── Agents ──────────────────────────────────────────── */

  router.post("/v2/tenants/:tenantId/agents", (req, res) => {
    if (!registry?.ready) return v2Err(res, 503, "SERVICE_UNAVAILABLE", "Registry not available");

    const tenant = registry.getTenant(req.params.tenantId);
    if (!tenant) return v2Err(res, 404, "NOT_FOUND", `Tenant ${req.params.tenantId} not found`);

    const { slug, name } = req.body ?? {};
    if (!slug || typeof slug !== "string") return v2Err(res, 400, "VALIDATION_ERROR", "slug is required");
    if (!name || typeof name !== "string") return v2Err(res, 400, "VALIDATION_ERROR", "name is required");

    const existing = registry.getAgentBySlug(tenant.id, slug);
    if (existing) return v2Err(res, 409, "CONFLICT", `Agent with slug '${slug}' already exists for this tenant`);

    const resourceName = `fm_${tenant.slug}_${slug}`;
    try {
      const agent = registry.createAgent(tenant.id, slug, name, resourceName, resourceName);
      console.log(`[admin] provisioned agent: ${agent.slug} (${agent.id}) → qdrant=${resourceName}, neo4j=${resourceName}`);
      return v2Ok(res, agent, { version: "v2" });
    } catch (err: any) {
      return v2Err(res, 500, "INTERNAL_ERROR", String(err?.message || err));
    }
  });

  router.get("/v2/tenants/:tenantId/agents", (req, res) => {
    if (!registry?.ready) return v2Err(res, 503, "SERVICE_UNAVAILABLE", "Registry not available");

    const tenant = registry.getTenant(req.params.tenantId);
    if (!tenant) return v2Err(res, 404, "NOT_FOUND", `Tenant ${req.params.tenantId} not found`);

    const agents = registry.getAgentsByTenant(tenant.id);
    return v2Ok(res, { agents, count: agents.length }, { version: "v2" });
  });

  router.get("/v2/tenants/:tenantId/agents/:agentId", (req, res) => {
    if (!registry?.ready) return v2Err(res, 503, "SERVICE_UNAVAILABLE", "Registry not available");

    const agent = registry.getAgent(req.params.agentId);
    if (!agent || agent.tenant_id !== req.params.tenantId) {
      return v2Err(res, 404, "NOT_FOUND", `Agent ${req.params.agentId} not found`);
    }

    const config = registry.getAgentConfig(agent.id);
    return v2Ok(res, { ...agent, config }, { version: "v2" });
  });

  router.delete("/v2/tenants/:tenantId/agents/:agentId", (req, res) => {
    if (!registry?.ready) return v2Err(res, 503, "SERVICE_UNAVAILABLE", "Registry not available");

    const agent = registry.getAgent(req.params.agentId);
    if (!agent || agent.tenant_id !== req.params.tenantId) {
      return v2Err(res, 404, "NOT_FOUND", `Agent ${req.params.agentId} not found`);
    }

    registry.updateAgentStatus(agent.id, "archived");
    console.log(`[admin] archived agent: ${agent.slug} (${agent.id})`);
    return v2Ok(res, { ...agent, status: "archived" }, { version: "v2" });
  });

  return router;
};

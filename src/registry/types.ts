export interface TenantRecord {
  id: string;
  slug: string;
  name: string;
  created_at: string;
}

export interface AgentRecord {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  qdrant_collection: string;
  neo4j_database: string;
  status: "provisioning" | "active" | "deprovisioning" | "archived";
  created_at: string;
}

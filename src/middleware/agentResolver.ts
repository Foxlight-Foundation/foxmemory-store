import type { Request, Response, NextFunction } from "express";
import type { Memory } from "@foxlight-foundation/mem0ai/oss";
import type { AgentRecord } from "../registry/types.js";
import { registry } from "../registry/db.js";
import { getOrCreateMemory } from "../memory/pool.js";
import { getMemory } from "../memory/factory.js";
import { DEFAULT_AGENT } from "../config/env.js";
import { v2Err } from "../utils/response.js";

declare global {
  namespace Express {
    interface Request {
      agent?: AgentRecord;
      agentMemory?: Memory;
    }
  }
}

/**
 * Middleware for agent-scoped routes (`:agentId` in params).
 * Looks up the agent in the registry, attaches `req.agent` and `req.agentMemory`.
 */
export const agentResolver = (req: Request, res: Response, next: NextFunction): void => {
  const agentId = req.params.agentId;

  if (!agentId) {
    // Legacy route — resolve via DEFAULT_AGENT or fall back to singleton
    if (DEFAULT_AGENT && registry?.ready) {
      const agent = registry.getAgent(DEFAULT_AGENT);
      if (agent) {
        req.agent = agent;
        req.agentMemory = getOrCreateMemory(agent.id, agent);
      }
    }
    next();
    return;
  }

  if (!registry?.ready) {
    v2Err(res, 503, "SERVICE_UNAVAILABLE", "Registry not available");
    return;
  }

  const agent = registry.getAgent(agentId);
  if (!agent) {
    v2Err(res, 404, "NOT_FOUND", `Agent ${agentId} not found`);
    return;
  }

  if (agent.status !== "active") {
    v2Err(res, 503, "SERVICE_UNAVAILABLE", `Agent ${agentId} is ${agent.status}, not active`);
    return;
  }

  req.agent = agent;
  req.agentMemory = getOrCreateMemory(agent.id, agent);
  next();
};
